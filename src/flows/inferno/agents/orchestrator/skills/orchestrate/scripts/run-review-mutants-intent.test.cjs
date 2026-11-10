const assert = require("node:assert/strict");
const test = require("node:test");

const { INTENT_TREE, git, run, worktree, write } = require("./review-fixture.cjs");
const {
  CAUGHT_ONE, INTENT_REVIEW, REVIEW, SURVIVES_TWO, mutantRepo, proposal, read, record, runs, withMutants,
} = require("./run-review-mutants-fixture.cjs");
const { parseItemReview } = require("./run-review-file.cjs");

// The intent review's mutants, run by the runner when it records review.yaml. A proposal an item
// review left owed, because a sibling's uncommitted work stood in the tree, runs here from the
// same entry. The intent reviewer proposes, as <item>:<n>, only for a criterion still without a
// mutant, and never runs one. A later intent review carries what ran and reruns only survivors.

const SCAN = ".specs-inferno/intents/alpha/scan.yaml";
const shown = (result) => result.out + result.err;

/** The intent worktree with the scan collected. */
function intentTree() {
  const fixture = mutantRepo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, SCAN, "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "scan"]);
  return { fixture, tree };
}

/** Dispatch the intent review, write what its reviewer wrote, and record it. */
function intentReview(fixture, tree, body) {
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, body);
  return run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
}

/** Item a-one reviewed beside a sibling's uncommitted work, so both its proposals stay owed. */
function owedByItem() {
  const { fixture, tree } = intentTree();
  write(tree, "docs/b.md", "a-two is mid-build\n");
  write(tree, REVIEW, withMutants(CAUGHT_ONE, SURVIVES_TWO));
  const item = record(fixture, [], tree);
  assert.equal(item.code, 0, shown(item));
  assert.match(item.out, /2 proposals stay owed to the intent review/);
  git(tree, ["checkout", "--", "docs/b.md"]);
  assert.deepEqual(runs(fixture), []);
  return { fixture, tree };
}

test("the intent review runs the proposals an item review left owed, from the same entries", () => {
  const { fixture, tree } = owedByItem();
  const result = intentReview(fixture, tree, "verdict: clean\n");

  assert.equal(result.code, 2, shown(result));
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/two.expect"]);
  assert.match(result.out, /mutants: 2 ran, 1 caught, 1 survived/);
  assert.match(result.out, /^FIX a-one: a-one:2 src\/a\.ts:2: the runner broke src\/a\.ts:2 .*stayed green/m);
  const owed = parseItemReview(tree, REVIEW, "a-one", { recorded: true }).mutants;
  const intent = read(tree, INTENT_REVIEW);
  for (const entry of owed) {
    assert.ok(intent.includes(`criterion: a-one:${entry.criterion}\n    file: ${entry.file}\n    line: ${entry.line}\n`), intent);
  }
  assert.match(intent, /^verdict: fix$/m);
  assert.match(intent, /criterion: a-one:1\n(?:.*\n){5}    caught: yes/);
  assert.match(intent, /criterion: a-one:2\n(?:.*\n){5}    caught: no/);
  assert.match(intent, /severity: major\n    owner: a-one\n    mutant: a-one:2/);
  assert.equal(read(tree, "src/a.ts"), "export const a = 1;\nexport const a2 = 2;\n");
  assert.equal(git(tree, ["status", "--porcelain"]), "");
});

test("the next intent review carries what was caught and reruns only the survivor", () => {
  const { fixture, tree } = owedByItem();
  assert.equal(intentReview(fixture, tree, "verdict: clean\n").code, 2);
  runs(fixture);
  write(tree, "checks/two.expect", "src/a.ts a2 = 2\n");
  git(tree, ["commit", "-qam", "the test of criterion 2 now reads the value"]);

  const result = intentReview(fixture, tree, "verdict: clean\n");

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/two.expect"], "the owed item entries ran once, here, and are carried now");
  assert.match(result.out, /intent review clean, recorded/);
});

test("the intent reviewer proposes for a criterion still without a mutant, and the runner runs it", () => {
  const { fixture, tree } = intentTree();
  write(tree, REVIEW, withMutants(CAUGHT_ONE));
  assert.equal(record(fixture, [], tree).code, 0);
  assert.deepEqual(runs(fixture), ["checks/one.expect"]);

  const refused = intentReview(fixture, tree, "verdict: clean\n");
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, /a-one owes a caught mutant for criteria 2 "a2 reads two". Propose one mutant for each under mutants, its criterion written <item>:<n>; the runner runs it/);
  assert.deepEqual(runs(fixture), []);

  write(tree, INTENT_REVIEW, `verdict: clean\nmutants:\n${proposal("a-one:2", { line: 2, find: "a2 = 2", replace: "a2 = 8", expect: "checks/a2.expect" })}`);
  const recorded = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
  assert.equal(recorded.code, 0, shown(recorded));
  assert.deepEqual(runs(fixture), ["checks/a2.expect"]);
});

test("an intent proposal names <item>:<n> and a criterion without a mutant, or it is refused before anything runs", () => {
  const { fixture, tree } = intentTree();
  write(tree, REVIEW, withMutants(CAUGHT_ONE));
  assert.equal(record(fixture, [], tree).code, 0);
  runs(fixture);
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  for (const [criterion, pattern] of [
    ["2", /mutants entry 1 criterion reads 2; name it <item>:<n>/],
    ["a-nine:1", /mutants entry 1 names a-nine, which is no work item of this intent/],
    ["a-one:3", /mutants entry 1 names criterion 3, and a-one has 2 acceptance criteria/],
    ["a-one:1", /mutants proposes one for a-one:1, which has a mutant its item review caught/],
  ]) {
    write(tree, INTENT_REVIEW, `verdict: clean\nmutants:\n${proposal(criterion)}`);
    const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
    assert.equal(result.code, 2, shown(result));
    assert.match(result.err, pattern);
    assert.deepEqual(runs(fixture), []);
  }
});

test("a proposal that reads no verdict leaves the criterion owed and the reviewer's file as it wrote it", () => {
  const { fixture, tree } = intentTree();
  write(tree, REVIEW, withMutants(CAUGHT_ONE));
  assert.equal(record(fixture, [], tree).code, 0);
  runs(fixture);
  const body = `verdict: clean\nmutants:\n${proposal("a-one:2", { line: 2, find: "a2 = 2", replace: "a2 = 8" })
    .replace(/test: .*\n/, "test: node -e \"process.exit(1)\"\n")}`;

  const result = intentReview(fixture, tree, body);

  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /a-one owes a caught mutant for criteria 2/);
  assert.equal(read(tree, INTENT_REVIEW), body);
  assert.equal(read(tree, "src/a.ts"), "export const a = 1;\nexport const a2 = 2;\n");
});
