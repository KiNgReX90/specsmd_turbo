const assert = require("node:assert/strict");
const test = require("node:test");

const { INTENT_TREE, git, run, worktree, write } = require("./review-fixture.cjs");
const {
  A_EDITABLE, A_ONE, CAUGHT_ONE, INTENT_REVIEW, REVIEW, itemReview, itemSpec, mutantRepo, proposal, read, record, runs,
} = require("./run-review-mutants-fixture.cjs");
const { parseItemReview } = require("./run-review-file.cjs");

// A proposal an item review left owed, whose line a later commit moved into another file. The
// intent review places every owed proposal before it judges anything: one whose text the item's
// changed files hold on exactly one line runs there; one it cannot place is kept as caught none
// with its why, held by nothing and counted as caught by nothing, so the first refusal names its
// criterion and the reviewer's own proposal for it is taken in the same record.

const SCAN = ".specs-inferno/intents/alpha/scan.yaml";
const SPEC = ".specs-inferno/intents/alpha/work-items/a-one.md";
const QUALITY = ".specs-inferno/intents/alpha/reviews/quality/a-one.yaml";
const shown = (result) => result.out + result.err;
const STRONG_TWO = proposal(2, { line: 2, find: "a2 = 2", replace: "a2 = 8", expect: "checks/a2.expect" });
const FINDING = "findings:\n  - criterion: 1\n    file: src/a.ts\n    line: 1\n    evidence: read src/a.ts, a belongs in its own module\n" +
  "    fix: move a into src/c.ts\n    severity: major\n";

/** The intent worktree with the scan collected and `before` committed. */
function intentTree(before = {}) {
  const fixture = mutantRepo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, SCAN, "lines: []\n");
  for (const [rel, body] of Object.entries(before)) write(tree, rel, body);
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "scan"]);
  return { fixture, tree };
}

/** A round of a-one after its correction, which added production code and so owes the quality lens too. */
function nextRound(fixture, tree) {
  assert.equal(run(fixture, ["review", "--item", "a-one", "--tree", tree]).code, 3);
  write(tree, REVIEW, itemReview(""));
  write(tree, QUALITY, "item: a-one\nverdict: clean\nfiles: [src/c.ts]\n");
  return ["--quality-reviewer", "rev-q"];
}

/** Record a-one's review beside a sibling's uncommitted work, so every proposal it carries stays owed. */
function owedRound(fixture, tree, body, code, args = []) {
  write(tree, "docs/b.md", "a-two is mid-build\n");
  if (body) write(tree, REVIEW, body);
  const result = record(fixture, args, tree);
  assert.equal(result.code, code, shown(result));
  assert.match(result.out, /2 proposals stay owed to the intent review/);
  git(tree, ["checkout", "--", "docs/b.md"]);
  assert.deepEqual(runs(fixture), []);
}

/** Commit the correction: a's line leaves src/a.ts for src/c.ts as `line`, and its test follows it. */
function moveA(tree, line, expect, extra = {}) {
  write(tree, "src/a.ts", "export { a } from './c';\nexport const a2 = 2;\n");
  write(tree, "src/c.ts", `${line}\n`);
  write(tree, "checks/one.expect", `src/c.ts ${expect}\n`);
  write(tree, SPEC, itemSpec("a-one", A_ONE, [...A_EDITABLE, "src/c.ts", "src/legacy.ts"]));
  for (const [rel, body] of Object.entries(extra)) write(tree, rel, body);
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a moves into its own module"]);
}

/** Dispatch the intent review, write what its reviewer wrote, and record it. */
function intentReview(fixture, tree, body) {
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, body);
  return run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
}

test("an owed proposal whose line moved and changed no longer locks a clean intent review", () => {
  const { fixture, tree } = intentTree();
  owedRound(fixture, tree, itemReview(`mutants:\n${CAUGHT_ONE}${STRONG_TWO}`), 0);
  moveA(tree, "export const a = 0 + 1;", "0 + 1");

  const refused = intentReview(fixture, tree, "verdict: clean\n");

  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, /verdict clean while a-one owes a caught mutant or a checked pin for criteria 1 "a reads one"\. Propose one mutant/);
  assert.deepEqual(runs(fixture), [], "nothing ran before the refusal");
  assert.equal(read(tree, INTENT_REVIEW), "verdict: clean\n");

  const own = proposal("a-one:1", { file: "src/c.ts", find: "0 + 1", replace: "0 + 7" });
  write(tree, INTENT_REVIEW, `verdict: clean\nmutants:\n${own}`);
  const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);

  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /intent review clean, recorded/);
  assert.match(result.out, /mutants: 2 ran, 2 caught, 0 survived, 1 without a verdict/);
  assert.match(result.out, /^MUTANT a-one:1 no verdict: src\/a\.ts:1 changed, and find no longer marks one line of it; /m);
  assert.deepEqual(runs(fixture), ["checks/a2.expect", "checks/one.expect"]);
  const intent = read(tree, INTENT_REVIEW);
  assert.match(intent, /criterion: a-one:1\n {4}file: src\/a\.ts\n(?:.*\n){4} {4}caught: none\n {4}why: "src\/a\.ts:1 changed, and find no longer marks one line of it"/);
  assert.match(intent, /criterion: a-one:1\n {4}file: src\/c\.ts\n(?:.*\n){4} {4}caught: yes/);
  assert.equal(git(tree, ["status", "--porcelain"]), "");
});

test("an owed proposal whose line moved as it was runs at its new place, counted from the review that proposed it", () => {
  // An older owned file and a file a-one does not own hold the find as well; neither is a place.
  const { fixture, tree } = intentTree({ "src/legacy.ts": "// a = 1 was the default once\n" });
  owedRound(fixture, tree, itemReview(`${FINDING}mutants:\n${CAUGHT_ONE}${STRONG_TWO}`, "fix"), 2);
  moveA(tree, "export const a = 1;", "= 1;", { "docs/b.md": "a = 1 now lives in c\n" });
  owedRound(fixture, tree, null, 0, nextRound(fixture, tree));

  const result = intentReview(fixture, tree, "verdict: clean\n");

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/a2.expect"]);
  assert.match(result.out, /mutants: 2 ran, 2 caught, 0 survived, 0 without a verdict/);
  assert.match(read(tree, INTENT_REVIEW), /criterion: a-one:1\n {4}file: src\/c\.ts\n {4}line: 1\n(?:.*\n){3} {4}caught: yes/);

  write(tree, "docs/b.md", "a-two is done\n");
  git(tree, ["commit", "-qam", "a-two built"]);
  const again = intentReview(fixture, tree, "verdict: clean\n");
  assert.equal(again.code, 0, shown(again));
  assert.deepEqual(runs(fixture), [], "the entry placed once is carried, not owed again");
  assert.equal((read(tree, INTENT_REVIEW).match(/criterion: a-one:1\n/g) || []).length, 1);
});

test("the intent reviewer's copy of the moved proposal at its new place is the owed one, run once", () => {
  const { fixture, tree } = intentTree();
  owedRound(fixture, tree, itemReview(`mutants:\n${CAUGHT_ONE}${STRONG_TWO}`), 0);
  moveA(tree, "export const a = 1;", "= 1;");
  const copy = proposal("a-one:1", { file: "src/c.ts" });

  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${copy}`);

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/a2.expect"]);
  assert.equal((read(tree, INTENT_REVIEW).match(/criterion: a-one:1\n/g) || []).length, 1);
});

test("an item's next round follows a moved line into the file the correction moved it to", () => {
  const { fixture, tree } = intentTree();
  owedRound(fixture, tree, itemReview(`${FINDING}mutants:\n${CAUGHT_ONE}${STRONG_TWO}`, "fix"), 2);
  moveA(tree, "export const a = 1;", "= 1;");
  const args = nextRound(fixture, tree);

  const result = record(fixture, args, tree);

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/a2.expect"]);
  const recorded = parseItemReview(tree, REVIEW, "a-one", { recorded: true });
  assert.deepEqual(recorded.mutants.map((m) => [m.criterion, m.file, m.line, m.caught]), [["1", "src/c.ts", "1", "yes"], ["2", "src/a.ts", "2", "yes"]]);
});
