const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { INTENT_TREE, git, repo, run, worktree, write } = require("./review-fixture.cjs");
const { CAUGHT_ONE, SURVIVES_TWO, itemReview, mutantRepo, recordedByHand, withMutants } = require("./run-review-mutants-fixture.cjs");
const { parseItemReview } = require("./run-review-file.cjs");

// A delta review reads the fix and nothing else. When its file is recorded, every finding the
// previous review held may come back verbatim (criterion, file, evidence and fix, and owner in an
// intent review), whatever its severity and wherever it sits. A
// finding the previous review did not hold is new: it is a blocker or a major, and it names a
// file the range changed, `git diff --name-only <review_commit>..HEAD`. A finding that carries
// `mutant` is the runner's and is neither. Only a file being recorded is held to the rule: a
// review on record, of the released flow or of a delta recorded before it, reads as before.

const ITEM_REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const INTENT_REVIEW = ".specs-inferno/intents/alpha/review.yaml";
const STATE = ".specs-inferno/state.yaml";

const shown = (result) => result.out + result.err;
const read = (tree, rel) => fs.readFileSync(path.join(tree, rel), "utf8");

/** A finding as a reviewer writes it, `extra` holding owner or mutant lines. */
function finding({ criterion = "1", file = "src/a.ts", line = 1, evidence = "read it", fix = "fix it", severity = "major", extra = "" } = {}) {
  return `  - criterion: ${criterion}\n    file: ${file}\n    line: ${line}\n    evidence: ${evidence}\n    fix: ${fix}\n    severity: ${severity}\n${extra}`;
}

/** The first review's two findings: a major on the line the fix will change, a minor on a file the fix leaves alone. */
const OPEN_MAJOR = { evidence: "src/a.ts exports 1 where criterion 1 asks for 2", fix: "export 2" };
const OPEN_MINOR = { criterion: "2", file: "src/b.ts", evidence: "b is named for nothing it holds", fix: "rename b", severity: "minor" };

const itemFix = (...findings) => `item: a-one\nverdict: fix\nfiles: [src/a.ts]\nfindings:\n${findings.join("")}`;
const recordItem = (fixture) => run(fixture, ["review", "--item", "a-one", "--tree", fixture.root, "--reviewer", "rev-1"]);

/** a-one reviewed fix with both findings, and a fix committed that changes src/a.ts alone. */
function itemFixed() {
  const fixture = repo();
  write(fixture.root, ITEM_REVIEW, itemFix(finding(OPEN_MAJOR), finding(OPEN_MINOR)));
  const first = recordItem(fixture);
  assert.equal(first.code, 2, shown(first));
  write(fixture.root, "src/a.ts", "// the value criterion 1 asks for\nexport const a = 2;\n");
  git(fixture.root, ["commit", "-qam", "the fix"]);
  return fixture;
}

/** The delta file is refused with `problem`, and nothing is recorded: the ledger and HEAD stay as they were. */
function itemRefused(fixture, body, problem) {
  const head = git(fixture.root, ["rev-parse", "HEAD"]);
  const state = read(fixture.root, STATE);
  write(fixture.root, ITEM_REVIEW, body);
  const result = recordItem(fixture);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, problem);
  assert.equal(git(fixture.root, ["rev-parse", "HEAD"]), head);
  assert.equal(read(fixture.root, STATE), state);
}

test("a delta file whose new finding is minor is refused, on a file of the range too", () => {
  const fixture = itemFixed();
  itemRefused(fixture, itemFix(finding({ ...OPEN_MAJOR, line: 2 }), finding({ line: 1, evidence: "the comment says nothing", fix: "drop it", severity: "minor" })),
    /BAD_REVIEW.*findings entry 2 is new and minor: a delta review adds no minor/);
});

test("a new blocker or major on a file outside the range is refused, with the range's files named", () => {
  const fixture = itemFixed();
  itemRefused(fixture, itemFix(finding({ file: "src/b.ts", evidence: "b breaks criterion 2", fix: "restore b", severity: "blocker" })),
    /BAD_REVIEW.*findings entry 1 names src\/b\.ts, which the range [0-9a-f]{7,}\.\.[0-9a-f]{7,} did not change.*src\/a\.ts/);
});

test("a new blocker or major on a file of the range is accepted", () => {
  const fixture = itemFixed();
  write(fixture.root, ITEM_REVIEW, itemFix(finding({ line: 2, evidence: "the fix exports 2 and the test still reads 1", fix: "make the test read 2", severity: "blocker" })));
  const result = recordItem(fixture);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.out, /^review a-one fix, recorded at /m);
});

test("an earlier finding repeated verbatim is accepted whatever its severity, its line moved or not", () => {
  const fixture = itemFixed();
  write(fixture.root, ITEM_REVIEW, itemFix(finding({ ...OPEN_MAJOR, line: 2 }), finding({ ...OPEN_MINOR, extra: "    repeat: true\n" })));
  const result = recordItem(fixture);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.out, /^FINDING 2 src\/b\.ts:1: b is named for nothing it holds/m);
});

test("an earlier finding with another criterion, evidence or fix is a new one; another severity is the same finding regraded", () => {
  const fixture = itemFixed();
  for (const changed of [{ criterion: "3" }, { evidence: "read it again" }, { fix: "rename b to total" }]) {
    itemRefused(fixture, itemFix(finding({ ...OPEN_MINOR, ...changed })), /findings entry 1 is new and minor/);
    itemRefused(fixture, itemFix(finding({ ...OPEN_MINOR, ...changed, severity: "major" })), /findings entry 1 names src\/b\.ts, which the range/);
  }
  write(fixture.root, ITEM_REVIEW, itemFix(finding({ ...OPEN_MAJOR, severity: "minor" }), finding({ ...OPEN_MINOR, severity: "major" })));
  const regraded = recordItem(fixture);
  assert.equal(regraded.code, 2, shown(regraded));
});

test("a finding that carries mutant is the runner's: neither an earlier one to repeat nor a new one to refuse", () => {
  const fixture = mutantRepo();
  write(fixture.root, ITEM_REVIEW, withMutants(CAUGHT_ONE, SURVIVES_TWO));
  assert.equal(recordItem(fixture).code, 2);
  write(fixture.root, "checks/one.expect", "src/a.ts a = 1\nsrc/a.ts export\n");
  git(fixture.root, ["commit", "-qam", "a fix that leaves the survivor's test as it was"]);
  const copied = finding({ criterion: "2", line: 2, evidence: "copied from the runner", fix: "none", severity: "minor", extra: "    mutant: 2\n" });
  write(fixture.root, ITEM_REVIEW, itemReview(`findings:\n${copied}`, "fix"));
  const result = recordItem(fixture);
  assert.equal(result.code, 2, shown(result));
  const recorded = parseItemReview(fixture.root, ITEM_REVIEW, "a-one", { recorded: true });
  assert.deepEqual(recorded.findings.map((one) => [one.mutant, one.severity]), [["2", "major"]], "the runner wrote its own finding again");
});

test("a review recorded under the released flow still parses, a delta recorded before this rule reads as recorded, and only the file being recorded is held to it", () => {
  const fixture = repo();
  recordedByHand(fixture.root, itemFix(finding(OPEN_MAJOR)), "fix");
  write(fixture.root, "src/a.ts", "export const a = 2;\n");
  git(fixture.root, ["commit", "-qam", "the fix"]);
  // The released flow's delta: a new minor on a file the fix left alone, on record.
  recordedByHand(fixture.root, itemFix(finding({ ...OPEN_MINOR, evidence: "b reads oddly" })), "fix");
  const recorded = parseItemReview(fixture.root, ITEM_REVIEW, "a-one", { recorded: true });
  assert.deepEqual(recorded.findings.map((one) => one.file), ["src/b.ts"]);
  const current = run(fixture, ["review", "--item", "a-one", "--tree", fixture.root]);
  assert.equal(current.code, 2, shown(current));
  assert.match(current.out, /^review a-one fix for the current files/m);
  write(fixture.root, "src/a.ts", "export const a = 3;\n");
  git(fixture.root, ["commit", "-qam", "another fix"]);
  itemRefused(fixture, itemFix(finding({ ...OPEN_MINOR, evidence: "b still reads oddly" })), /findings entry 1 is new and minor/);
});

/** An intent worktree with an empty scan and a clean review of a-one, so the intent review is owed. */
function intentStarted() {
  const fixture = repo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  write(tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the work"]);
  write(tree, ITEM_REVIEW, "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n");
  assert.equal(run(fixture, ["review", "--item", "a-one", "--tree", tree, "--reviewer", "rev-item"]).code, 0);
  return { fixture, tree };
}

const OWNED = "    owner: a-one\n";
const intentFix = (...findings) => `verdict: fix\nfindings:\n${findings.join("")}`;
const recordIntent = (fixture, tree) => run(fixture, ["review", "--tree", tree, "--reviewer", "rev-int"]);

/** The intent reviewed fix with both findings, a fix committed on src/a.ts alone, and the delta dispatched. */
function intentFixed() {
  const { fixture, tree } = intentStarted();
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, intentFix(finding({ ...OPEN_MAJOR, extra: OWNED }), finding({ ...OPEN_MINOR, extra: OWNED })));
  const first = recordIntent(fixture, tree);
  assert.equal(first.code, 2, shown(first));
  write(tree, "src/a.ts", "export const a = 2;\n");
  git(tree, ["commit", "-qam", "the fix"]);
  const delta = run(fixture, ["review", "--tree", tree]);
  assert.equal(delta.code, 3, shown(delta));
  return { fixture, tree };
}

test("an intent review's delta is held to the same rule", () => {
  const { fixture, tree } = intentFixed();
  const refusals = [
    [finding({ evidence: "a reads oddly", fix: "rename a", severity: "minor", extra: OWNED }), /findings entry 1 is new and minor/],
    [finding({ file: "src/b.ts", evidence: "b breaks", fix: "restore b", extra: OWNED }), /findings entry 1 names src\/b\.ts, which the range/],
    [finding({ ...OPEN_MINOR, extra: "    owner: a-two\n" }), /findings entry 1 is new and minor/],
  ];
  for (const [body, problem] of refusals) {
    write(tree, INTENT_REVIEW, intentFix(body));
    const refused = recordIntent(fixture, tree);
    assert.equal(refused.code, 2, shown(refused));
    assert.match(refused.err, problem);
  }
  write(tree, INTENT_REVIEW, intentFix(finding({ ...OPEN_MINOR, line: 3, extra: OWNED }), finding({ evidence: "a now breaks c", fix: "keep c", extra: OWNED })));
  const accepted = recordIntent(fixture, tree);
  assert.equal(accepted.code, 2, shown(accepted));
  assert.match(accepted.out, /^intent review fix, recorded at /m);
});
