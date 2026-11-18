const assert = require("node:assert/strict");
const test = require("node:test");

// When the batch skips an entry because an earlier run of its test found no command, the record
// writes no `caught` on it: it never ran, so it stays owed to the intent review, is no survivor and
// keeps the item review from nothing. The entry that did run keeps `caught: none` with the reason.
// A review recorded under the released flow, whose 127 read the generic reason, reads as before.

const { git, run, write } = require("./review-fixture.cjs");
const { REVIEW, itemReview, mutantRepo, proposal, record, recordedByHand, runs, withMutants } = require("./run-review-mutants-fixture.cjs");
const { parseItemReview } = require("./run-review-file.cjs");
const { itemProofs, mutantGaps, owedProposals } = require("./run-mutant-coverage.cjs");

const shown = (result) => result.out + result.err;
const withTest = (entry, test) => entry.replace(/test: .*\n/, `test: "${test}"\n`);
const SECOND = { line: 2, find: "a2 = 2", replace: "a2 = 8", expect: "checks/two.expect" };

test("an item review whose two mutants share a test that exits 127 runs it once: the first reads none, the second stays owed", () => {
  const fixture = mutantRepo();
  const shopgen = "echo checks/one.expect >> ../runs.log; shopgen build";
  write(fixture.root, REVIEW, withMutants(withTest(proposal(1), shopgen), withTest(proposal(2, SECOND), shopgen)));

  const result = record(fixture);

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/one.expect"], "the test ran once");
  assert.match(result.out, /^mutants: 1 ran, 0 caught, 0 survived, 1 without a verdict$/m);
  assert.match(result.out, /^MUTANT 1 no verdict: the test's command was not found \(exit 127\): bash: line 1: shopgen: command not found; /m);
  assert.match(result.out, /^MUTANT 2 not run, as the test of criterion 1 found no command, so it stays owed to the intent review$/m);
  const recorded = parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true });
  assert.equal(recorded.verdict, "clean", "a skipped entry is no survivor");
  assert.deepEqual(recorded.mutants.map((m) => [m.criterion, m.caught]), [["1", "none"], ["2", undefined]]);
  assert.match(recorded.mutants[0].why, /^the test's command was not found \(exit 127\)/);
  assert.equal(recorded.mutants[1].why, undefined);
  assert.deepEqual(owedProposals(fixture.root, "alpha", ["a-one"]).map(({ entry }) => entry.criterion), ["2"], "the skipped entry is owed to the intent review");
  assert.equal(git(fixture.root, ["status", "--porcelain"]), "");
});

test("a delta review whose survivors' test now exits 127 records the first as none and leaves the skipped one owed, not a survivor", () => {
  const fixture = mutantRepo({ files: { "checks/t.sh": "echo ran >> ../runs.log\nnode checks/has.cjs checks/two.expect\n" } });
  const weak = "bash checks/t.sh";
  write(fixture.root, REVIEW, withMutants(withTest(proposal(1), weak), withTest(proposal(2, SECOND), weak)));
  const first = record(fixture);
  assert.equal(first.code, 2, shown(first));
  assert.match(first.out, /mutants: 2 ran, 0 caught, 2 survived/);
  runs(fixture);
  // The builder's fix: a stronger expectation, and a test that now calls a tool the tree lacks.
  write(fixture.root, "checks/two.expect", "src/a.ts a2 = 2\n");
  write(fixture.root, "checks/t.sh", "echo ran >> ../runs.log\nshopgen build\n");
  git(fixture.root, ["commit", "-qam", "the fix"]);
  assert.equal(run(fixture, ["review", "--item", "a-one", "--tree", fixture.root]).code, 3);
  write(fixture.root, REVIEW, itemReview(""));

  const delta = record(fixture);

  assert.equal(delta.code, 0, shown(delta));
  assert.deepEqual(runs(fixture), ["ran"], "the rerun ran the test once");
  const recorded = parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true });
  assert.equal(recorded.verdict, "clean");
  assert.deepEqual(recorded.findings, []);
  assert.deepEqual(recorded.mutants.map((m) => [m.criterion, m.caught]), [["1", "none"], ["2", undefined]]);
  assert.match(recorded.mutants[0].why, /^the test's command was not found \(exit 127\): checks\/t\.sh: line 2: shopgen: command not found; /);
});

test("a review the released flow recorded with a 127 read as no test summary still parses and counts as before", () => {
  const fixture = mutantRepo();
  const none = `${proposal(1)}    caught: none\n    why: "no test summary reports a failure (exit 127)"\n`;
  const caught = `${proposal(2, { ...SECOND, expect: "checks/a2.expect" })}    caught: yes\n`;
  recordedByHand(fixture.root, `item: a-one\nverdict: clean\nfiles: [src/a.ts]\nfindings: []\nmutants:\n${none}${caught}`);

  const current = run(fixture, ["review", "--item", "a-one", "--tree", fixture.root]);
  assert.equal(current.code, 0, shown(current));
  const recorded = parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true });
  assert.deepEqual(recorded.mutants.map((m) => [m.criterion, m.caught, m.why]),
    [["1", "none", "no test summary reports a failure (exit 127)"], ["2", "yes", undefined]]);
  assert.deepEqual(mutantGaps(itemProofs(fixture.root, "alpha", ["a-one"]), []), ['a-one owes a caught mutant or a checked pin for criteria 1 "a reads one"']);
  assert.deepEqual(owedProposals(fixture.root, "alpha", ["a-one"]), [], "an entry that read no verdict is no proposal still owed a run");
});
