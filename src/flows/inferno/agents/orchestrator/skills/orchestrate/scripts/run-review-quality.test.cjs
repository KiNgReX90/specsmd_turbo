const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, INTENT_TREE, STATE, git, repo, run, worktree, write } = require("./review-fixture.cjs");
const quality = require("./run-review-quality.cjs");
const { weightOf } = require("./run-review-file.cjs");

// The quality lens beside the contract review (P6 of the improvement plan). A first review of an
// item with production code prints both dispatches, to go out in one message; each lens writes its
// own file, and the record step waits for every lens it dispatched before the ledger moves. The
// two files read as one review: `fix` when either says so, the same fault from both lenses once
// at the higher severity, a serious quality finding a miss, and a minor-only pair settles. In a
// delta each lens re-reads its own findings from its own previous file. An item of kind test, or
// whose change is docs or config only, gets no quality lens, and a review recorded before the
// lens existed reads and counts as before.

const REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const QUALITY = ".specs-inferno/intents/alpha/reviews/quality/a-one.yaml";
const CODEX = ".specs-inferno/config.codex.yaml";
const ledger = (tree) => fs.readFileSync(path.join(tree, ".specs-inferno/state.yaml"), "utf8");
const shown = (result) => result.out + result.err;

const CLEAN = "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n";
const contractFix = (severity = "major", file = "src/a.ts", line = 1) => `item: a-one
verdict: fix
files: [src/a.ts]
findings:
  - criterion: AC1 the value reads two
    file: ${file}
    line: ${line}
    evidence: read ${file}, it exports the unchecked value
    fix: export the checked value
    severity: ${severity}
`;
const QCLEAN = "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n";
const qualityFix = (severity = "major", { line = 1, files = "src/a.ts", extra = "" } = {}) => `item: a-one
verdict: fix
files: [${files}]
findings:
  - id: Q1
    check: security
    file: src/a.ts
    line: ${line}
    evidence: read src/a.ts, the gift card amount is never checked
    fix: check the amount before it is used
    severity: ${severity}
${extra}`;

const LINTED = CONFIG.replace("verification:\n", "verification:\n  lint:\n    - npm run lint\n    - cargo clippy\n");
const QUALITY_CONFIG = `${LINTED}roles:
  reviewer-quality:
    model: model-quality
standards:
  - file: code.md
    paths: ["src/**"]
  - file: docs.md
    paths: ["docs/**"]
real_app:
  paths: ["e2e/**"]
`;
const STANDARDS = {
  ".specs-inferno/standards/code.md": "# Code\n\n## Names\n\nA name says what it holds.\n",
  ".specs-inferno/standards/docs.md": "# Docs\n\n## Tone\n\nPlain words.\n",
};

/**
 * An intent worktree in which a-one's work is committed: by default one production line, else the
 * files `change` names. `review` runs the item review in it, both reviewers named.
 */
function host(options = {}) {
  const fixture = repo({ ...options, files: { ...STANDARDS, ...(options.files || {}) } });
  const tree = worktree(fixture, INTENT_TREE);
  const flags = options.args || [];
  const at = (args) => run(fixture, [...args, "--tree", tree, ...flags]);
  for (const [rel, body] of Object.entries(options.change || { "src/a.ts": "export const a = 2;\n" })) write(tree, rel, body);
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a-one built"]);
  const review = (extra = []) => at(["review", "--item", "a-one", "--reviewer", "rev-1", "--quality-reviewer", "rev-q", ...extra]);
  return { fixture, tree, at, review };
}

/** The lines of one dispatch block: its dispatch line and the indented lines under it. */
function block(out, agent) {
  const lines = out.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^dispatch ${agent}\\b`).test(line));
  assert.ok(start >= 0, `no dispatch of ${agent} in: ${out}`);
  const end = lines.findIndex((line, index) => index > start && !line.startsWith("  "));
  return lines.slice(start, end === -1 ? undefined : end);
}

/** The first round of a-one recorded with both lenses: the dispatch printed, both files written, the record run. */
function firstRound(h, contract, qualityBody) {
  assert.equal(h.review().code, 3);
  write(h.tree, REVIEW, contract);
  write(h.tree, QUALITY, qualityBody);
  return h.review();
}

// --- which items get the lens ----------------------------------------------------------

test("an item of kind test gets no quality lens, whatever it changed", () => {
  assert.equal(quality.qualityLens("test", ["src/a.ts"]), false);
  assert.equal(quality.qualityLens("TEST", ["src/a.test.ts"]), false);
  assert.equal(quality.qualityLens("behavior", ["src/a.ts"]), true);
});

test("a change of documents only gets no quality lens", () => {
  assert.equal(quality.qualityLens("docs-only", ["docs/guide.md", "README", "notes/plan.rst", "CHANGELOG.md"]), false);
  assert.equal(quality.qualityLens("behavior", ["docs/guide.mdx", "docs/api.adoc", "LICENSE"]), false);
});

test("a change of configuration only gets no quality lens", () => {
  const config = ["package.json", "config/app.yaml", ".github/workflows/ci.yml", "Cargo.toml", ".gitignore", ".env.example", "yarn.lock", "setup.cfg"];
  assert.equal(quality.qualityLens("config-only", config), false);
  assert.equal(quality.qualityLens("behavior", ["tsconfig.json", "docs/b.md"]), false, "documents and configuration hold no production code either");
});

test("one production file beside documents or configuration keeps the lens, whatever kind the item claims", () => {
  assert.equal(quality.qualityLens("config-only", ["package.json", "src/gift-card.ts"]), true);
  assert.equal(quality.qualityLens("docs-only", ["docs/b.md", "src/b.ts"]), true);
  assert.equal(quality.qualityLens("behavior", ["vite.config.ts"]), true, "a config written as code is code");
  assert.equal(quality.qualityLens("behavior", ["Dockerfile"]), true);
  assert.equal(quality.qualityLens("behavior", [".specs-inferno/state.yaml"]), false, "the ledger is no change of the item");
  assert.equal(quality.qualityLens("behavior", []), false);
});

// --- the first review ----------------------------------------------------------------------

test("a first review prints the contract and the quality dispatch, to be sent in one message", () => {
  const h = host({ config: QUALITY_CONFIG });
  const result = h.review();

  assert.equal(result.code, 3, shown(result));
  const contract = block(result.out, "specsmd-inferno-reviewer");
  const lens = block(result.out, "specsmd-inferno-reviewer-quality");
  assert.ok(result.out.indexOf(contract[0]) < result.out.indexOf(lens[0]), "the contract lens first, as today");
  assert.match(contract.join("\n"), /^ {2}real-app /m, "the contract lens keeps its real-app line");
  assert.match(contract.join("\n"), /^ {2}write \.specs-inferno\/intents\/alpha\/reviews\/a-one\.yaml$/m);
  assert.equal(lens[0], "dispatch specsmd-inferno-reviewer-quality model model-quality item a-one");
  const range = /^ {2}range ([0-9a-f]+\.\.[0-9a-f]+) paths (.+)$/m.exec(contract.join("\n"));
  assert.deepEqual(lens.slice(1), [
    `  range ${range[1]} paths ${range[2]}`,
    "  spec .specs-inferno/intents/alpha/work-items/a-one.md",
    "  brief .specs-inferno/intents/alpha/brief.md",
    "  standards .specs-inferno/standards/code.md",
    "  lint npm run lint",
    "  lint cargo clippy",
    `  write ${QUALITY}`,
  ]);
  assert.match(result.out, /^send both dispatches in one message/m);
  assert.match(result.out, /review --item a-one --reviewer <agent-id> --quality-reviewer <quality-agent-id> --tree /);
  const payload = JSON.parse(h.review(["--json"]).out);
  assert.equal(payload.quality.agent, "specsmd-inferno-reviewer-quality");
  assert.equal(payload.quality.write, QUALITY);
  assert.deepEqual(payload.quality.lint, ["npm run lint", "cargo clippy"]);
});

test("a host with no lint, no rule files and no role pin dispatches the lens on its own pin with only its range, spec, brief and write", () => {
  // A builder tier's model is no pin of the quality lens.
  const h = host({ config: CONFIG.replace("models:\n", "models:\n  quality: model-wrong\n") });
  const lens = block(h.review().out, "specsmd-inferno-reviewer-quality");
  assert.equal(lens[0], "dispatch specsmd-inferno-reviewer-quality item a-one");
  assert.deepEqual(lens.slice(1).map((line) => line.trim().split(" ")[0]), ["range", "spec", "brief", "write"]);
});

test("a lint key that is no list of commands is refused before any dispatch", () => {
  const h = host({ config: CONFIG.replace("verification:\n", "verification:\n  lint: npm run lint\n") });
  const result = h.review();
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /BAD_CONFIG.*verification\.lint.*list of shell commands/);
});

test("the lint block config.example.yaml documents parses once it is uncommented and gives the dispatch its lint lines", () => {
  const example = fs.readFileSync(path.join(__dirname, "../../../config.example.yaml"), "utf8");
  const block = /^ {2}# lint:.*\n(?: {2}# {3}- .*\n)+/m.exec(example)[0].replace(/^ {2}# ?/gm, "  ").replace(/\s+#.*$/m, "");
  const { parseYaml } = require("./run-lib.cjs");
  assert.deepEqual(quality.lintCommands(parseYaml(`verification:\n${block}`), "config.example.yaml"), ["npm run lint"]);
  assert.deepEqual(quality.lintCommands({}, "config.yaml"), [], "a host with no lint key runs none");
  assert.throws(() => quality.lintCommands({ verification: { lint: ["npm run lint", " "] } }, "config.yaml"), /list of shell commands/);
});

test("the Codex host names its own agent for the lens", () => {
  const codex = `roles:\n  reviewer_quality:\n    agent: specsmd_inferno_reviewer_quality\n    model: codex-quality\ndelivery:\n  base_branch: main\n`;
  const h = host({ files: { [CODEX]: codex }, args: ["--config", CODEX] });
  const result = h.review();
  assert.equal(result.code, 3, shown(result));
  assert.match(result.out, /^dispatch specsmd_inferno_reviewer item a-one$/m);
  assert.match(result.out, /^dispatch specsmd_inferno_reviewer_quality model codex-quality item a-one$/m);
  assert.doesNotMatch(result.out, /specsmd-inferno-/);
});

test("an item of kind test, a docs-only change and a config-only change get the contract dispatch alone", () => {
  const cases = [
    { state: STATE.replace("kind: behavior", "kind: test") },
    { change: { "docs/a.md": "how a reads\n" }, editable: ["src/a.ts", "docs/a.md"] },
    { change: { "config/app.json": "{}\n" }, editable: ["src/a.ts", "config/app.json"] },
  ];
  for (const options of cases) {
    const h = host(options);
    const result = h.review();
    assert.equal(result.code, 3, shown(result));
    assert.match(result.out, /^dispatch specsmd-inferno-reviewer model model-review item a-one$/m);
    assert.doesNotMatch(result.out, /reviewer-quality|one message|--quality-reviewer/, JSON.stringify(options));
    write(h.tree, REVIEW, CLEAN);
    assert.equal(h.review().code, 0, "the contract file alone records the review");
  }
  const mixed = host({ change: { "config/app.json": "{}\n", "src/a.ts": "export const a = 3;\n" }, editable: ["src/a.ts", "config/app.json"] });
  assert.match(mixed.review().out, /^dispatch specsmd-inferno-reviewer-quality item a-one$/m, "one config file beside production code keeps the lens");
});

// --- the record step waits for every lens -----------------------------------------------

test("the record step writes nothing while one lens file is missing and names the dispatch to send again", () => {
  const h = host({ config: QUALITY_CONFIG });
  const owed = h.review();
  const lens = block(owed.out, "specsmd-inferno-reviewer-quality");
  write(h.tree, REVIEW, CLEAN);
  const before = git(h.tree, ["rev-parse", "HEAD"]);

  const waiting = h.review();

  assert.equal(waiting.code, 3, shown(waiting));
  assert.match(waiting.out, new RegExp(`^refusing to record the review of a-one: ${QUALITY.replace(/\./g, "\\.")} is not written`, "m"));
  assert.deepEqual(block(waiting.out, "specsmd-inferno-reviewer-quality"), lens, "the same dispatch, to send again");
  assert.doesNotMatch(waiting.out, /^dispatch specsmd-inferno-reviewer item/m, "the lens that wrote is not sent again");
  assert.doesNotMatch(ledger(h.tree), /review:/);
  assert.equal(git(h.tree, ["rev-parse", "HEAD"]), before);
  assert.doesNotMatch(fs.readFileSync(path.join(h.tree, REVIEW), "utf8"), /^commit:/m);

  write(h.tree, QUALITY, QCLEAN);
  const recorded = h.review();
  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(ledger(h.tree), /review: clean/);
  assert.equal(git(h.tree, ["status", "--porcelain"]), "", "both files and the ledger are committed");
  const written = fs.readFileSync(path.join(h.tree, QUALITY), "utf8");
  assert.match(written, /^reviewer: rev-q$/m);
  assert.match(written, /^commit: [0-9a-f]{40}$/m);
  assert.match(fs.readFileSync(path.join(h.tree, REVIEW), "utf8"), /^reviewer: rev-1$/m);
});

test("a quality file written first waits for the contract file, and the contract dispatch is named", () => {
  const h = host();
  assert.equal(h.review().code, 3);
  write(h.tree, QUALITY, QCLEAN);
  const waiting = h.review();
  assert.equal(waiting.code, 3, shown(waiting));
  assert.match(waiting.out, /^refusing to record the review of a-one: \.specs-inferno\/intents\/alpha\/reviews\/a-one\.yaml is not written/m);
  assert.match(waiting.out, /^dispatch specsmd-inferno-reviewer model model-review item a-one$/m);
  assert.doesNotMatch(ledger(h.tree), /review:/);
});

test("both files written but no quality reviewer named is refused, and the call to run names both", () => {
  const h = host();
  assert.equal(h.review().code, 3);
  write(h.tree, REVIEW, CLEAN);
  write(h.tree, QUALITY, QCLEAN);
  const result = h.at(["review", "--item", "a-one", "--reviewer", "rev-1"]);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /NO_REVIEWER.*quality reviewer.*--quality-reviewer <quality-agent-id>/);
  assert.doesNotMatch(ledger(h.tree), /review:/);
});

test("a quality file is held to its own schema: no mutant, a known check, a rule only on a rule finding", () => {
  const cases = [
    [`${QCLEAN}mutants: []\n`, /unknown key mutants/],
    [qualityFix().replace("check: security", "check: style"), /check reads style/],
    [qualityFix().replace("id: Q1", "id: F1"), /id reads F1/],
    [qualityFix().replace("check: security", "check: rule"), /names no rule/],
    [qualityFix("major", { extra: "    rule: code.md, Names\n" }), /rule.*only on a rule finding/],
    [qualityFix("major", { extra: "lint:\n  - command: npm run lint\n    exit: 1\n    taken: [Q7]\n" }), /taken names Q7/],
    [qualityFix("major", { extra: "lint:\n  - command: npm run lint\n    exit: failed\n" }), /exit must be the command's exit code/],
    [qualityFix("major", { extra: "lint:\n  - command: npm run lint\n    exit: 1\n    taken: Q1\n" }), /taken must be a list/],
    [`${QCLEAN}commit: abc1234\n`, /commit is written when the review is recorded/],
    [QCLEAN.replace("item: a-one", "item: a-two"), /item reads a-two/],
    [QCLEAN.replace("verdict: clean", "verdict: maybe"), /verdict must be clean or fix/],
    [qualityFix("major", { extra: "    mutant: AC1\n" }), /names a mutant/],
    [qualityFix("major").replace("findings:\n", "findings:\n  - id: Q1\n    check: fit\n    file: src/a.ts\n    line: 3\n    evidence: e\n    fix: f\n    severity: minor\n"), /repeats the id Q1/],
    [qualityFix("major", { extra: "    repeat: yes\n" }), /repeat reads yes/],
    [qualityFix("major", { extra: "    oracle: true\n" }), /rule or oracle.*only on a rule finding/],
  ];
  for (const [body, refusal] of cases) {
    const h = host();
    assert.equal(h.review().code, 3);
    write(h.tree, REVIEW, CLEAN);
    write(h.tree, QUALITY, body);
    const result = h.review();
    assert.equal(result.code, 2, shown(result));
    assert.match(result.err, refusal);
    assert.doesNotMatch(ledger(h.tree), /review:/);
  }
});

// --- one verdict ------------------------------------------------------------------------

test("a clean contract review and a quality fix make a fix, and the serious quality finding is a miss", () => {
  const h = host();
  const result = firstRound(h, CLEAN, qualityFix("major", { extra: "lint:\n  - command: npm run lint\n    exit: 0\n" }));

  assert.equal(result.code, 2, shown(result));
  assert.match(result.out, /^FINDING Q1 security src\/a\.ts:1: read src\/a\.ts, the gift card amount is never checked\. fix: check the amount before it is used$/m);
  assert.match(ledger(h.tree), /review: fix/);
  assert.match(ledger(h.tree), /review_misses: 1/);
  assert.match(ledger(h.tree), /review_weight: serious/);
  assert.match(result.out, /^next strong model-strong specsmd-inferno-builder: a fresh builder takes a-one over/m);
});

test("a rule finding the item's own criterion asks to break names the rule and goes to the oracle", () => {
  const rule = qualityFix("major").replace("check: security", "check: rule") + "    rule: code.md, Names\n    oracle: true\n";
  const result = firstRound(host({ config: QUALITY_CONFIG }), CLEAN, rule);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.out, /^FINDING Q1 rule \(code\.md, Names\) src\/a\.ts:1: /m);
  assert.match(result.out, /^ORACLE Q1: the item's own criterion asks to break code\.md, Names, so the oracle decides it/m);
});

test("a first quality review that marks a finding repeat is refused, as the contract lens's is", () => {
  const h = host();
  const result = firstRound(h, CLEAN, qualityFix("major", { extra: "    repeat: true\n" }));
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /quality\/a-one\.yaml: repeat: true marks a kind an earlier round/);
  assert.doesNotMatch(ledger(h.tree), /review:/);
});

test("a contract fix beside a clean quality review is a fix too", () => {
  const h = host();
  const result = firstRound(h, contractFix("major"), QCLEAN);
  assert.equal(result.code, 2, shown(result));
  assert.match(ledger(h.tree), /review: fix/);
});

test("the same file and line from both lenses goes to the builder once, at the higher severity", () => {
  const h = host();
  const result = firstRound(h, contractFix("minor"), qualityFix("blocker"));

  assert.equal(result.code, 2, shown(result));
  assert.equal(result.out.match(/^FINDING /gm).length, 1, result.out);
  const payload = JSON.parse(h.review(["--json"]).out);
  assert.equal(payload.findings.length, 1);
  assert.equal(payload.findings[0].severity, "blocker");
  assert.match(ledger(h.tree), /review_weight: serious/);

  const apart = host();
  const two = firstRound(apart, contractFix("minor"), qualityFix("minor", { line: 2 }));
  assert.equal(two.out.match(/^FINDING /gm).length, 2, "another line is another fault");
});

test("the one reading weighs both lenses: a serious finding of either is serious, minors of both are minor", () => {
  const contract = { verdict: "fix", files: ["src/a.ts"], findings: [{ criterion: "AC1", file: "src/a.ts", line: "1", severity: "minor" }], mutants: [], survivors: [], pins: [] };
  const lens = (severity, extra = {}) => ({ verdict: "fix", files: ["src/b.ts"], findings: [{ id: "Q1", check: "fit", file: "src/a.ts", line: "4", severity, ...extra }], lint: [] });
  assert.equal(weightOf(quality.mergeReviews(contract, lens("minor"))).weight, "minor");
  assert.equal(weightOf(quality.mergeReviews(contract, lens("major"))).weight, "serious");
  assert.equal(weightOf(quality.mergeReviews(contract, lens("minor", { repeat: "true" }))).weight, "repeat");
  const same = (extra) => ({ ...lens("major", extra), findings: [{ ...lens("major", extra).findings[0], line: "1" }] });
  assert.equal(weightOf(quality.mergeReviews({ ...contract, findings: [{ ...contract.findings[0], repeat: "true" }] }, same())).weight, "repeat",
    "the one finding kept repeats when the dropped one did");
  assert.equal(weightOf(quality.mergeReviews(contract, same({ repeat: "true" }))).weight, "repeat");
  assert.deepEqual(quality.mergeReviews(contract, lens("minor")).files, ["src/a.ts", "src/b.ts"]);
  assert.equal(quality.mergeReviews(contract, null), contract, "no quality file reads as the contract review alone");
  const clean = { ...contract, verdict: "clean", findings: [] };
  assert.equal(quality.mergeReviews(clean, { ...lens("minor"), verdict: "clean", findings: [] }).verdict, "clean");
  assert.equal(quality.mergeReviews(clean, lens("minor")).verdict, "fix");
});

test("a minor-only pair settles once the correction stays inside the files either lens lists", () => {
  const h = host();
  dispatchedVerified(h, { "src/a.ts": "export const a = 2; // built\n", "src/a2.test.ts": "// the amount\n" });
  const result = firstRound(h, contractFix("minor"), qualityFix("minor", { files: "src/a.ts, src/a2.test.ts" }));
  assert.equal(result.code, 2, shown(result));
  assert.match(ledger(h.tree), /review_weight: minor/);
  assert.match(ledger(h.tree), /review_misses: 0/);

  // The correction touches a file only the quality review lists: inside the files the one review lists.
  dispatchedVerified(h, { "src/a2.test.ts": "// the amount is checked\n" });
  const settled = h.review();

  assert.equal(settled.code, 0, shown(settled));
  assert.match(settled.out, /^review a-one settled at /m);
  assert.match(ledger(h.tree), /review: settled/);
});

/** A builder's turn as the orchestrator runs it, then the commit, then verify-item. */
function dispatchedVerified(h, written) {
  const logged = h.at(["dispatch-log", "alpha", "--item", "a-one", "--tier", "cheap", "--agent", "specsmd-inferno-builder-cheap", "--json"]);
  assert.equal(logged.code, 0, shown(logged));
  for (const [rel, body] of Object.entries(written)) write(h.tree, rel, body);
  const accepted = h.at(["accept-dispatch", JSON.parse(logged.out).dispatch_id, "--changed-paths", JSON.stringify(Object.keys(written))]);
  assert.equal(accepted.code, 0, shown(accepted));
  git(h.tree, ["add", "--", ...Object.keys(written)]);
  git(h.tree, ["commit", "-qm", "a builder turn"]);
  const verified = h.at(["verify-item", "a-one"]);
  assert.equal(verified.code, 0, shown(verified));
}

// --- the delta ----------------------------------------------------------------------------

test("in a delta each lens re-reads from its own previous file, a lens clean last round too", () => {
  for (const [contract, lens] of [[contractFix("major"), qualityFix("major")], [contractFix("major"), QCLEAN]]) {
    const h = host();
    assert.equal(firstRound(h, contract, lens).code, 2);
    const read = /^commit: ([0-9a-f]+)$/m.exec(fs.readFileSync(path.join(h.tree, QUALITY), "utf8"))[1];
    write(h.tree, "src/a.ts", "export const a = 4;\n");
    git(h.tree, ["commit", "-qam", "the fix"]);

    const result = h.review();

    assert.equal(result.code, 3, shown(result));
    const first = block(result.out, "specsmd-inferno-reviewer");
    const second = block(result.out, "specsmd-inferno-reviewer-quality");
    assert.equal(first[1], `  previous ${REVIEW}`);
    assert.equal(second[1], `  previous ${QUALITY}`);
    assert.match(second[2], new RegExp(`^ {2}range ${read.slice(0, 7)}[0-9a-f]*\\.\\.[0-9a-f]+ paths src/a\\.ts$`));
    assert.match(result.out, /^send both dispatches in one message/m);

    // The contract lens answers first: the record waits and sends the quality delta again as it went out.
    write(h.tree, REVIEW, CLEAN);
    const waiting = h.review();
    assert.equal(waiting.code, 3, shown(waiting));
    assert.deepEqual(block(waiting.out, "specsmd-inferno-reviewer-quality"), second);
    assert.match(ledger(h.tree), /review: fix/);
  }
});

test("a delta quality file that adds a new minor is refused under the delta rule", () => {
  const h = host();
  assert.equal(firstRound(h, contractFix("major"), qualityFix("major")).code, 2);
  write(h.tree, "src/a.ts", "export const a = 4;\n");
  git(h.tree, ["commit", "-qam", "the fix"]);
  assert.equal(h.review().code, 3);
  write(h.tree, REVIEW, CLEAN);
  write(h.tree, QUALITY, qualityFix("minor").replace("id: Q1", "id: Q2").replace("never checked", "checked twice"));
  const result = h.review();
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /quality\/a-one\.yaml: findings entry 1 is new and minor/);
  assert.match(ledger(h.tree), /review_misses: 1\n/, "nothing recorded");
});

// --- a review recorded before the lens -------------------------------------------------------

test("a review recorded with no quality file reads and counts as before, and its next review adds the lens", () => {
  const h = host();
  // The released flow dispatched one reviewer and recorded its file alone.
  write(h.tree, REVIEW, contractFix("major"));
  const recorded = h.at(["review", "--item", "a-one", "--reviewer", "rev-1"]);
  assert.equal(recorded.code, 2, shown(recorded));
  assert.match(ledger(h.tree), /review_misses: 1/);
  const again = h.review();
  assert.equal(again.code, 2, shown(again));
  assert.match(again.out, /^review a-one fix for the current files/m);

  write(h.tree, "src/a.ts", "export const a = 4;\n");
  git(h.tree, ["commit", "-qam", "the fix"]);
  const next = h.review();

  assert.equal(next.code, 3, shown(next));
  assert.equal(block(next.out, "specsmd-inferno-reviewer")[1], `  previous ${REVIEW}`);
  const lens = block(next.out, "specsmd-inferno-reviewer-quality");
  assert.doesNotMatch(lens.join("\n"), /previous/, "the lens reads the item for the first time");
  const fork = git(h.tree, ["merge-base", "HEAD", "main"]).slice(0, 7);
  assert.match(lens[1], new RegExp(`^ {2}range ${fork}[0-9a-f]*\\.\\.`), "over the whole item, not only the fix");
});

test("the item's integrate reads the one review, so a recorded pair lands", () => {
  const h = host();
  // The quality lens lists a file the contract lens does not: the ledger's hash is over both.
  assert.equal(firstRound(h, CLEAN, "item: a-one\nverdict: clean\nfiles: [src/a.ts, src/b.ts]\n").code, 0);
  const integrated = h.at(["integrate", "--item", "a-one"]);
  assert.equal(integrated.code, 0, shown(integrated));
});

test("a quality file written with no dispatch on record is recorded too, and stays open until the lens reads again", () => {
  const h = host();
  // No review call printed the dispatch here: the files written decide what the round records.
  write(h.tree, REVIEW, contractFix("major"));
  write(h.tree, QUALITY, qualityFix("major", { line: 2 }));
  const recorded = h.review();
  assert.equal(recorded.code, 2, shown(recorded));
  assert.equal(git(h.tree, ["status", "--porcelain"]), "");
  assert.match(fs.readFileSync(path.join(h.tree, QUALITY), "utf8"), /^reviewer: rev-q$/m);

  write(h.tree, "src/a.ts", "export const a = 4;\n");
  git(h.tree, ["commit", "-qam", "the fix"]);
  write(h.tree, REVIEW, CLEAN);
  const contractOnly = h.at(["review", "--item", "a-one", "--reviewer", "rev-1"]);
  assert.equal(contractOnly.code, 2, shown(contractOnly));
  assert.match(contractOnly.out, /^FINDING Q1 security src\/a\.ts:2: /m, "the quality finding nobody re-read is still open");
  assert.match(ledger(h.tree), /review: fix/);
});

test("a pending quality file binds the files it lists: one of them uncommitted refuses the review", () => {
  const h = host();
  assert.equal(h.review().code, 3);
  write(h.tree, REVIEW, CLEAN);
  write(h.tree, QUALITY, "item: a-one\nverdict: clean\nfiles: [src/a.ts, src/b.ts]\n");
  write(h.tree, "src/b.ts", "export const b = 3;\n");
  const result = h.review();
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /DIRTY.*src\/b\.ts/);
  assert.doesNotMatch(ledger(h.tree), /review:/);
});
