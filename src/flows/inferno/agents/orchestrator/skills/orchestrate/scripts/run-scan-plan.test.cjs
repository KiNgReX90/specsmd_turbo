const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, repo, run, write } = require("./review-fixture.cjs");
const { READER_WORDS, planCuts } = require("./run-scan-slices.cjs");

// The plan-time cross-check: one reader takes the brief and every work item in one batch. A plan
// too large for one reader is cut along its dependency chains, one cross-checker per cut, all
// spawned in one message. It asks Turbo's five kinds of problem inside a budget of tool calls.

const CLAUDE_ROLE = ".claude/agents/specsmd-inferno-scanner.md";
const CODEX_ROLE = ".codex/agents/specsmd_inferno_scanner.toml";
const CODEX = ".specs-inferno/config.codex.yaml";
const INSTALLED = { [CLAUDE_ROLE]: "---\nname: specsmd-inferno-scanner\n---\n", [CODEX_ROLE]: 'name = "specsmd_inferno_scanner"\n' };
const PLAN = ".specs-inferno/intents/beta";
const KINDS = ["conflict", "gap", "misreading", "deviation", "wrong_assumption"];

/** An item of `words` words, its frontmatter and title included, depending on the items it names. */
function item(id, words, depends = []) {
  const header = 16 + Math.max(depends.length - 1, 0);
  const body = Array.from({ length: Math.max(words - header, 0) }, (_, index) => `w${index}`).join(" ");
  return `---\nid: ${id}\ntitle: "${id}"\nintent: beta\nstatus: pending\ndepends_on: [${depends.join(", ")}]\n---\n\n# Work Item: ${id}\n\n${body}\n`;
}

/** A beta plan of the given items, each `[id, words, depends]`, under a brief of `brief` words. */
function plan(items, brief = 3, files = {}) {
  const all = { ...INSTALLED, ...files, [`${PLAN}/brief.md`]: Array.from({ length: brief }, () => "b").join(" ") };
  for (const [id, words, depends] of items) all[`${PLAN}/work-items/${id}.md`] = item(id, words, depends || []);
  return repo({ files: all });
}

const cuts = (fixture, budget) => planCuts(fixture.root, "beta", budget).map((cut) => cut.items);
const scan = (fixture, args) => run(fixture, ["scan", "--tree", fixture.root, ...args]);
const dispatchLines = (out) => [...out.matchAll(/^dispatch (\S+)(?: model \S+)? scan (\S+) brief (\S+)$/gm)];
const LINE = (claim, kind = "gap") =>
  `  - file: src/a.ts\n    line: 1\n    kind: ${kind}\n    claim: ${claim}\n    proof: "rg -n producer src"\n`;
const answer = (brief, lines = "") =>
  write(path.dirname(brief), path.basename(brief).replace(/\.md$/, ".yaml"), `question: cross-check\nlines:${lines ? `\n${lines}` : " []\n"}`);

test("a plan within one reader's budget, brief included, is one cut in dependency order", () => {
  const items = [["b-two", 30, ["b-one"]], ["b-one", 30]];
  assert.deepEqual(cuts(plan(items, 10), 80), [["b-one", "b-two"]]);
  assert.equal(cuts(plan(items, 30), 80).length, 2, "the brief counts against every reader's budget");
});

test("a plan within one reader's budget keeps each chain together, whatever the order of its files", () => {
  const items = [["x-1", 20], ["x-2", 20], ["x-3", 20, ["x-1"]], ["x-4", 20, ["x-2"]]];
  assert.deepEqual(cuts(plan(items, 3), 1000), [["x-1", "x-3", "x-2", "x-4"]]);
});

test("a plan with no work item yet gets one cross-checker for its brief", () => {
  const fixture = plan([]);
  const result = scan(fixture, ["--plan", "beta"]);
  assert.equal(result.code, 3, result.out + result.err);
  const lines = dispatchLines(result.out);
  assert.equal(lines.length, 1, result.out);
  assert.match(fs.readFileSync(lines[0][3], "utf8"), /^- cut: none: the plan has no work item yet, so check its brief\.md$/m);
});

test("a plan past the budget is cut along its dependency chains: a chain that fits stays whole, and small chains share a cut", () => {
  const fixture = plan([
    ["a-one", 32], ["a-two", 32, ["a-one"]],
    ["b-one", 20], ["b-two", 20, ["b-one"]], ["b-three", 24, ["b-two"]],
    ["c-one", 16], ["d-one", 16],
  ], 10);
  assert.deepEqual(cuts(fixture, 90), [["a-one", "a-two", "c-one"], ["b-one", "b-two", "b-three", "d-one"]]);
});

test("a chain too large for one reader is cut in its dependency order, and an item past the budget is a cut alone", () => {
  const fixture = plan([
    ["e-four", 30, ["e-three"]], ["e-one", 30], ["e-three", 30, ["e-two"]], ["e-two", 30, ["e-one"]],
    ["f-huge", 500],
  ], 10);
  assert.deepEqual(cuts(fixture, 80), [["e-one", "e-two"], ["e-three", "e-four"], ["f-huge"]]);
});

test("a plan within the budget gets one cross-checker for the brief and every item", () => {
  const fixture = plan([["b-one", 40], ["b-two", 40, ["b-one"]]]);
  const result = scan(fixture, ["--plan", "beta"]);
  assert.equal(result.code, 3, result.out + result.err);
  const lines = dispatchLines(result.out);
  assert.equal(lines.length, 1, result.out);
  assert.equal(lines[0][2], "cross-check");
  assert.match(result.out, /^spawn this one in one message$/m);
  const text = fs.readFileSync(lines[0][3], "utf8");
  assert.match(text, /^- cut: work-items\/b-one\.md, work-items\/b-two\.md$/m);
  assert.doesNotMatch(text, /other cuts/);
});

test("a plan past the budget dispatches a cross-checker per cut in one message, each told its cut, the others, the kinds and the budget", () => {
  const big = Math.floor(READER_WORDS / 2) + 100;
  const fixture = plan([["a-one", big], ["a-two", 50, ["a-one"]], ["b-one", big], ["b-two", 50, ["b-one"]]]);
  const result = scan(fixture, ["--plan", "beta"]);
  assert.equal(result.code, 3, result.out + result.err);
  const lines = dispatchLines(result.out);
  assert.equal(lines.length, 2, result.out);
  assert.match(result.out, /^spawn these 2 in one message$/m);
  assert.doesNotMatch(result.out, /once they return/);
  const owned = lines.map((line) => {
    const text = fs.readFileSync(line[3], "utf8");
    for (const kind of KINDS) assert.match(text, new RegExp(`^- ${kind}: `, "m"));
    assert.match(text, /at most 12 tool calls/);
    assert.match(text, /grep before you read/);
    assert.match(text, /line ranges only/);
    assert.match(text, /When the budget is spent, stop/);
    assert.doesNotMatch(text, /exhaustive|LEGAL|MAKER|BUILD/);
    assert.match(text, /^- other cuts, which other cross-checkers read: /m);
    assert.match(text, new RegExp(`^- result ${line[3].replace(/\.md$/, ".yaml").replace(/[.]/g, "\\.")}$`, "m"));
    return /^- cut: (.+)$/m.exec(text)[1].split(", ").map((rel) => path.basename(rel, ".md"));
  });
  assert.deepEqual(owned, [["a-one", "a-two"], ["b-one", "b-two"]]);
});

test("on Codex the cuts are spawned three to a message", () => {
  const big = READER_WORDS + 10;
  const fixture = plan([["a-one", big], ["b-one", big], ["c-one", big], ["d-one", big]], 3,
    { [CODEX]: "roles:\n  scanner:\n    model: model-codex-scan\n" });
  const result = scan(fixture, ["--plan", "beta", "--config", CODEX]);
  assert.equal(result.code, 3, result.out + result.err);
  assert.equal(dispatchLines(result.out).length, 4, result.out);
  assert.match(result.out, /^spawn these 3 in one message$/m);
  assert.match(result.out, /^once they return, spawn this one in one message$/m);
});

test("a cut's brief lists the project's rule files that apply to its items, for a deviation to name", () => {
  const config = `${CONFIG}standards:\n  - file: code.md\n    paths: ["src/**"]\n  - file: docs.md\n    paths: ["docs/**"]\n`;
  const fixture = repo({
    config,
    files: { ...INSTALLED, ".specs-inferno/standards/code.md": "# Code\n", ".specs-inferno/standards/docs.md": "# Docs\n" },
  });
  const result = run(fixture, ["scan", "--tree", fixture.root, "--plan", "alpha"]);
  assert.equal(result.code, 3, result.out + result.err);
  const text = fs.readFileSync(dispatchLines(result.out)[0][3], "utf8");
  assert.match(text, /^- standards: \.specs-inferno\/standards\/code\.md, \.specs-inferno\/standards\/docs\.md$/m);
  const bare = repo({ files: INSTALLED });
  const plain = run(bare, ["scan", "--tree", bare.root, "--plan", "alpha"]);
  assert.match(fs.readFileSync(dispatchLines(plain.out)[0][3], "utf8"), /^- standards: none listed for these items$/m);
});

/** The plan dispatched and its one reader answered with `lines`; then the collect. */
function collected(lines) {
  const fixture = plan([["b-one", 40]]);
  const [first] = dispatchLines(scan(fixture, ["--plan", "beta"]).out);
  answer(first[3], lines);
  return scan(fixture, ["--collect", "--plan", "beta"]);
}

test("every one of the five kinds reaches the planner as a GAP line", () => {
  const gaps = collected(KINDS.map((kind) => LINE(`a ${kind}`, kind)).join(""));
  assert.equal(gaps.code, 2, gaps.out + gaps.err);
  assert.deepEqual([...gaps.out.matchAll(/^GAP (\S+) (\S+) /gm)].map((m) => [m[1], m[2]]),
    KINDS.map((kind, index) => [`r1-${index + 1}`, kind]));
});

test("a plan-time line without one of the five kinds is refused", () => {
  for (const lines of [`  - file: src/a.ts\n    line: 1\n    claim: c\n    proof: "rg x"\n`, LINE("c", "MAKER"), LINE("c", "BUILD")]) {
    const refused = collected(lines);
    assert.equal(refused.code, 2, refused.out + refused.err);
    assert.match(refused.err, /conflict, gap, misreading, deviation or wrong_assumption/);
  }
});

test("a result that answers another question than the cross-check is refused, naming that cut's cross-checker", () => {
  const big = Math.floor(READER_WORDS / 2) + 100;
  const fixture = plan([["a-one", big], ["b-one", big]]);
  const briefs = dispatchLines(scan(fixture, ["--plan", "beta"]).out).map((line) => line[3]);
  assert.equal(briefs.length, 2);
  for (const brief of briefs) answer(brief);
  write(path.dirname(briefs[1]), path.basename(briefs[1]).replace(/\.md$/, ".yaml"), "question: wiring\nlines: []\n");
  const wrong = scan(fixture, ["--collect", "--plan", "beta"]);
  assert.equal(wrong.code, 2, wrong.out + wrong.err);
  assert.match(wrong.err, /question must be cross-check/);
  assert.match(wrong.err, /the cross-check-2 scanner/);
});

test("--only is refused, with the call that works printed", () => {
  const fixture = plan([["b-one", 40]]);
  for (const args of [["--only", "wiring", "--plan", "beta"], ["--only", "wiring"]]) {
    const refused = scan(fixture, args);
    assert.equal(refused.code, 1, refused.out + refused.err);
    assert.match(refused.err, /the scan takes no --only/);
  }
  assert.match(scan(fixture, ["--only", "wiring", "--plan", "beta"]).err, new RegExp(`run run\\.cjs scan --plan beta --tree ${fixture.root}$`, "m"));
});

test("a plan that builds on an unmerged intent is not cross-checked until that intent merges", () => {
  const state = "project:\n  name: demo\nintents:\n  - id: alpha\n    title: \"Alpha\"\n    status: in_progress\n" +
    "    depends_on_intents: []\n    work_items: []\n  - id: beta\n    title: \"Beta\"\n    status: pending\n" +
    "    depends_on_intents: [alpha]\n    work_items: []\n";
  const files = { ...INSTALLED, [`${PLAN}/brief.md`]: "# Intent: Beta\n", [`${PLAN}/work-items/b-one.md`]: item("b-one", 10) };
  const held = scan(repo({ files, state }), ["--plan", "beta"]);
  assert.equal(held.code, 3, held.out + held.err);
  assert.equal(dispatchLines(held.out).length, 0, held.out);
  assert.match(held.out, /builds on alpha, not merged/);
});

test("collect refuses results when the plan's items changed since the dispatch", () => {
  const fixture = plan([["b-one", 40]]);
  const [first] = dispatchLines(scan(fixture, ["--plan", "beta"]).out);
  answer(first[3]);
  write(fixture.root, `${PLAN}/work-items/b-seven.md`, item("b-seven", 10, ["b-one"]));
  const moved = scan(fixture, ["--collect", "--plan", "beta"]);
  assert.equal(moved.code, 3, moved.out + moved.err);
  assert.match(moved.out, /b-seven/);
  assert.match(moved.out, /run\.cjs scan --plan beta/);
});

test("the scanner role checks a plan once inside a budget, for the five kinds, and stays exhaustive over a diff", () => {
  const role = fs.readFileSync(path.resolve(__dirname, "../../../../scanner/agent.md"), "utf8");
  const diff = role.slice(0, role.indexOf("## At plan time"));
  const planned = role.slice(role.indexOf("## At plan time"), role.indexOf("## The result file"));
  assert.match(diff, /Be exhaustive within your range/);
  assert.match(diff, /no cap on lines/);
  for (const kind of KINDS) assert.match(planned, new RegExp(`\`${kind}\``));
  assert.match(planned, /budget/);
  assert.match(planned, /grep before you read/);
  assert.match(planned, /line ranges only/);
  assert.match(planned, /in one batch/);
  assert.match(planned, /each earlier finding and only the parts the repair changed/);
  assert.doesNotMatch(role, /LEGAL|MAKER|BUILD|exhaustive within your range or slice/);
});
