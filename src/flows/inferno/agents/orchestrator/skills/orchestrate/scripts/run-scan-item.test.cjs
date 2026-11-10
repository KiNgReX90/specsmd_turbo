const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { INTENT_TREE, git, repo, run, worktree, write } = require("./review-fixture.cjs");

// The slice check: once per item, just before its dispatch, one cross-checker reads the item's
// spec against the tree its predecessors left. The plan's cross-check read the item before any
// predecessor landed, so it cannot see what only shows now. One scan, no rounds, and nothing waits
// on it but a conflict, which goes to the planner once.

const INSTALLED = { ".claude/agents/specsmd-inferno-scanner.md": "---\nname: specsmd-inferno-scanner\n---\n" };
const CODEX_PROCEDURE = "../../../../../codex/skills/specsmd-inferno/references/procedure.md";

/** An intent worktree whose first item, a-one, has landed; a-two depends on it. */
function landed() {
  const fixture = repo({ files: INSTALLED });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\nexport function limit() { return 20; }\n");
  git(tree, ["commit", "-qam", "a-one landed"]);
  return { fixture, tree };
}

const scan = (fixture, tree, args = []) => run(fixture, ["scan", "--tree", tree, ...args]);
const dispatchLines = (out) => [...out.matchAll(/^dispatch (\S+)(?: model \S+)? scan (\S+) brief (\S+)$/gm)];
const LINE = (claim, kind) => `  - file: src/a.ts\n    line: 2\n    kind: ${kind}\n    claim: ${claim}\n    proof: "rg -n limit src"\n`;
const answer = (brief, lines = "") =>
  write(path.dirname(brief), path.basename(brief).replace(/\.md$/, ".yaml"), `question: slice\nlines:${lines ? `\n${lines}` : " []\n"}`);

/** The slice check of a-two dispatched and answered with `lines`, then collected by the printed call. */
function checked(lines) {
  const { fixture, tree } = landed();
  const sent = scan(fixture, tree, ["--item", "a-two"]);
  assert.equal(sent.code, 3, sent.out + sent.err);
  answer(dispatchLines(sent.out)[0][3], lines);
  const collect = /^then (run\.cjs scan --collect .*) collects it$/m.exec(sent.out);
  assert.ok(collect, sent.out);
  return { fixture, tree, sent, collected: run(fixture, collect[1].split(" ").slice(1)) };
}

test("an item with a predecessor gets one cross-checker over its spec, its predecessors and what they landed, inside a small budget", () => {
  const { fixture, tree } = landed();
  const sent = scan(fixture, tree, ["--item", "a-two"]);
  assert.equal(sent.code, 3, sent.out + sent.err);
  const lines = dispatchLines(sent.out);
  assert.equal(lines.length, 1, sent.out);
  assert.equal(lines[0][2], "slice");
  const text = fs.readFileSync(lines[0][3], "utf8");
  assert.match(text, /^# INFERNO slice check: a-two$/m);
  assert.match(text, /^- item \.specs-inferno\/intents\/alpha\/work-items\/a-two\.md: read it whole$/m);
  const base = git(tree, ["merge-base", "HEAD", "main"]).slice(0, 7);
  assert.match(text, new RegExp(`^- predecessors: work-items/a-one\\.md, landed in git diff ${base}\\.\\.HEAD`, "m"));
  for (const kind of ["wrong_assumption", "rebuilt", "conflict"]) assert.match(text, new RegExp(`^- ${kind}: `, "m"));
  assert.doesNotMatch(text, /^- (gap|misreading|deviation): /m);
  assert.match(text, /at most 8 tool calls/);
  assert.match(text, /When the budget is spent, stop/);
});

test("an item with no predecessor gets no slice check: the plan's cross-check read the tree it builds on", () => {
  const { fixture, tree } = landed();
  const result = scan(fixture, tree, ["--item", "a-one"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(dispatchLines(result.out).length, 0, result.out);
  assert.match(result.out, /a-one has no predecessor in alpha/);
});

test("an item whose only depends_on names no item of its intent gets no slice check", () => {
  const { fixture, tree } = landed();
  const spec = ".specs-inferno/intents/alpha/work-items/a-two.md";
  const text = fs.readFileSync(path.join(tree, spec), "utf8").replace(/^depends_on: \[.*\]$/m, "depends_on: [z-gone]");
  write(tree, spec, text);
  const result = scan(fixture, tree, ["--item", "a-two"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(dispatchLines(result.out).length, 0, result.out);
  assert.match(result.out, /a-two has no predecessor in alpha/);
});

test("a wrong assumption or a rebuilt part goes into the dispatch as a measured fact, and nothing waits", () => {
  const { collected } = checked(`${LINE("a-two adds limit() while a-one built it", "rebuilt")}${LINE("a-two reads limit 10", "wrong_assumption")}`);
  assert.equal(collected.code, 0, collected.out + collected.err);
  assert.match(collected.out, /^SLICE s-1 rebuilt src\/a\.ts:2: a-two adds limit\(\) while a-one built it \(proof: rg -n limit src\)$/m);
  assert.match(collected.out, /^SLICE s-2 wrong_assumption /m);
  assert.match(collected.out, /paste each SLICE line into the dispatch of a-two as the measured fact/);
  assert.doesNotMatch(collected.out, /planner/);
});

test("a conflict goes to the planner once, and the next call for that item dispatches nothing", () => {
  const { fixture, tree, collected } = checked(`${LINE("a-two caps at 10, a-one built 20", "conflict")}${LINE("a-two reads limit 10", "wrong_assumption")}`);
  assert.equal(collected.code, 2, collected.out + collected.err);
  assert.match(collected.out, /^SLICE s-1 conflict /m);
  assert.match(collected.out, /send every conflict SLICE line to the planner once/);
  assert.match(collected.out, /no second slice check/);
  const again = scan(fixture, tree, ["--item", "a-two"]);
  assert.equal(again.code, 0, again.out + again.err);
  assert.equal(dispatchLines(again.out).length, 0, again.out);
  assert.match(again.out, /slice check of a-two ran once/);
});

test("a clean slice check says dispatch it, and a sibling landing between dispatch and collect does not void it", () => {
  const { fixture, tree } = landed();
  const sent = scan(fixture, tree, ["--item", "a-two"]);
  answer(dispatchLines(sent.out)[0][3]);
  write(tree, "docs/b.md", "a sibling landed\n");
  git(tree, ["commit", "-qam", "a sibling landed"]);
  const clean = scan(fixture, tree, ["--collect", "--item", "a-two"]);
  assert.equal(clean.code, 0, clean.out + clean.err);
  assert.match(clean.out, /no finding in the slice check of a-two: dispatch it/);
});

test("a slice line of a kind outside the three is refused", () => {
  const { collected } = checked(LINE("no consumer", "gap"));
  assert.equal(collected.code, 2, collected.out + collected.err);
  assert.match(collected.err, /wrong_assumption, rebuilt or conflict/);
});

test("the orchestrator runs the slice check beside its probes, on both hosts", () => {
  const claude = fs.readFileSync(path.resolve(__dirname, "../../../agent.md"), "utf8");
  const probes = claude.split("\n").find((line) => line.startsWith("Run `run.cjs probes {item-id} --tree {path}`"));
  assert.ok(probes);
  assert.match(probes, /`run\.cjs scan --item \{item-id\} --tree \{path\}`/);
  assert.match(probes, /`SLICE`/);
  const codex = fs.readFileSync(path.resolve(__dirname, CODEX_PROCEDURE), "utf8");
  const bullet = codex.split("\n").find((line) => line.includes("run.cjs probes <item-id>"));
  assert.match(bullet, /`run\.cjs scan --item <item-id> --tree <path> --config \.specs-inferno\/config\.codex\.yaml`/);
});
