const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const { INTENT_TREE, git, run, worktree, write } = require("./review-fixture.cjs");
const { CAUGHT_ONE, INTENT_REVIEW, REVIEW, SURVIVES_TWO, mutantRepo, proposal, read, record, runs, withMutants } = require("./run-review-mutants-fixture.cjs");

// A survivor of the intent review may take another test. The next intent reviewer writes the
// carried entry again with the same criterion, file, line, find and replace and a test that should
// catch it: the record runs it with that test and keeps the old one as `was`. Anything else for
// that criterion is still a second mutant. A current fix review whose survivor would now be caught
// with no change to the code under review runs its survivors again when asked to.

const SCAN = ".specs-inferno/intents/alpha/scan.yaml";
const shown = (result) => result.out + result.err;
const OLD_TEST = "node checks/has.cjs checks/two.expect ../runs.log";
const NEW_TEST = "node checks/has.cjs checks/new.expect ../runs.log";

/** Dispatch the intent review, write what its reviewer wrote, and record it. */
function intentReview(fixture, tree, body) {
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, body);
  return run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
}

/** a-one's proposals owed by its item review, then an intent review whose record leaves a-one:2 a survivor of `two`. */
function survivor(two = SURVIVES_TWO) {
  const fixture = mutantRepo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, SCAN, "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "scan"]);
  write(tree, "docs/b.md", "a-two is mid-build\n");
  write(tree, REVIEW, withMutants(CAUGHT_ONE, two));
  assert.equal(record(fixture, [], tree).code, 0);
  git(tree, ["checkout", "--", "docs/b.md"]);
  const first = intentReview(fixture, tree, "verdict: clean\n");
  assert.equal(first.code, 2, shown(first));
  assert.match(first.out, /mutants: 2 ran, 1 caught, 1 survived/);
  runs(fixture);
  return { fixture, tree };
}

/** The builder's answer to the survivor: a test that reads the value, and no change to the code. */
function newTest(tree) {
  write(tree, "checks/new.expect", "src/a.ts a2 = 2\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a test that reads a2"]);
}

const retest = (changes = {}) => proposal("a-one:2", { line: 2, find: "a2 = 2", replace: "a2 = 8", expect: "checks/new.expect", ...changes });

test("a carried survivor given another test runs with it, reads caught yes and keeps its old test as was", () => {
  const { fixture, tree } = survivor();
  newTest(tree);

  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${retest()}`);

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/new.expect"], "only the survivor ran, with its new test");
  assert.match(result.out, /mutants: 1 ran, 1 caught, 0 survived/);
  const written = read(tree, INTENT_REVIEW);
  assert.match(written, new RegExp(`criterion: a-one:2\\n(?:.*\\n){3} {4}replace: "a2 = 8"\\n {4}test: ${NEW_TEST}\\n {4}was: ${OLD_TEST}\\n {4}caught: yes\\n`));
  assert.doesNotMatch(written, /mutant: a-one:2/, "the survivor's finding is gone");

  write(tree, "docs/b.md", "a-two is done\n");
  git(tree, ["commit", "-qam", "a-two built"]);
  const again = intentReview(fixture, tree, "verdict: clean\n");
  assert.equal(again.code, 0, shown(again));
  assert.deepEqual(runs(fixture), [], "the entry with its new test is the item's owed proposal, not owed again");
  assert.equal((read(tree, INTENT_REVIEW).match(/criterion: a-one:2\n/g) || []).length, 1);
});

test("an entry for a survivor's criterion that differs in anything but its test, or one for a caught entry, is still a second mutant", () => {
  const { fixture, tree } = survivor();
  newTest(tree);
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  const caughtOne = proposal("a-one:1", { expect: "checks/new.expect" });
  for (const entry of [retest({ replace: "a2 = 9" }), retest({ line: 1 }), caughtOne]) {
    write(tree, INTENT_REVIEW, `verdict: clean\nmutants:\n${entry}`);
    const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
    assert.equal(result.code, 2, shown(result));
    assert.match(result.err, /mutants proposes one for a-one:\d, which has a mutant this record runs/, entry);
    const hint = /To give its survivor another test, write that entry again \(src\/a\.ts:2, find "a2 = 2", replace "a2 = 8"\) with only test changed/;
    if (entry === caughtOne) assert.doesNotMatch(result.err, /another test/, "a caught entry has no survivor to retest");
    else assert.match(result.err, hint);
    assert.deepEqual(runs(fixture), []);
  }
});

const FINDING = "findings:\n  - criterion: a-one:1\n    file: src/a.ts\n    line: 1\n    evidence: read src/a.ts, a is exported bare\n" +
  "    fix: name what a holds\n    severity: minor\n    owner: a-one\n";

/**
 * A recorded fix intent review whose survivor a-one:2 reads its expectation outside the tree, which
 * then turns strong: the survivor would now be caught with no commit. `own` is the reviewer's own findings.
 */
function outsideSurvivor(own = "") {
  const fixture = mutantRepo();
  const tree = worktree(fixture, INTENT_TREE);
  write(path.dirname(tree), "outside.expect", "src/a.ts export\n");
  write(tree, SCAN, "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "scan"]);
  write(tree, "docs/b.md", "a-two is mid-build\n");
  write(tree, REVIEW, withMutants(CAUGHT_ONE, proposal(2, { line: 2, find: "a2 = 2", replace: "a2 = 8", expect: "../outside.expect" })));
  assert.equal(record(fixture, [], tree).code, 0);
  git(tree, ["checkout", "--", "docs/b.md"]);
  assert.equal(intentReview(fixture, tree, `verdict: ${own ? "fix" : "clean"}\n${own}`).code, 2);
  runs(fixture);
  write(path.dirname(tree), "outside.expect", "src/a.ts a2 = 2\n");
  return { fixture, tree };
}

test("a current fix review runs its survivors again when asked, and the plain call names how to ask", () => {
  const { fixture, tree } = outsideSurvivor();

  const plain = run(fixture, ["review", "--tree", tree]);
  assert.equal(plain.code, 2, shown(plain));
  assert.match(plain.out, /^intent review fix for the current tree/m);
  assert.match(plain.out, /^a survivor whose builder answered without a change to the code under review: run .* --rerun survivors to run the surviving mutants again$/m);
  assert.match(JSON.parse(run(fixture, ["review", "--tree", tree, "--json"]).out).rerun, / --rerun survivors$/);
  assert.deepEqual(runs(fixture), [], "the plain call runs nothing");

  const head = git(tree, ["rev-parse", "HEAD"]);
  const rerun = run(fixture, ["review", "--tree", tree, "--rerun", "survivors"]);

  assert.equal(rerun.code, 0, shown(rerun));
  assert.deepEqual(runs(fixture), ["../outside.expect"], "only the survivor ran");
  assert.match(rerun.out, /mutants: 1 ran, 1 caught, 0 survived/);
  assert.match(rerun.out, /intent review clean, recorded/);
  assert.equal(git(tree, ["rev-list", "--count", `${head}..HEAD`]), "1", "one record");
  assert.match(read(tree, INTENT_REVIEW), /^reviewer: rev-1$/m, "the record keeps the reviewer that wrote it");
  assert.match(read(tree, INTENT_REVIEW), /^verdict: clean$/m);
  assert.equal(git(tree, ["status", "--porcelain"]), "");

  const nothing = run(fixture, ["review", "--tree", tree, "--rerun", "survivors"]);
  assert.equal(nothing.code, 1, shown(nothing));
  assert.match(nothing.err, /--rerun survivors runs the surviving mutants of a current fix intent review, and this one says clean/);
  assert.doesNotMatch(run(fixture, ["review", "--tree", tree]).out, /--rerun/, "a clean review names no rerun");
});

test("a rerun keeps the reviewer's own findings, and a fix review with no survivor left has nothing to rerun", () => {
  const { fixture, tree } = outsideSurvivor(FINDING);

  const rerun = run(fixture, ["review", "--tree", tree, "--rerun", "survivors"]);

  assert.equal(rerun.code, 2, shown(rerun));
  assert.match(rerun.out, /mutants: 1 ran, 1 caught, 0 survived/);
  assert.match(rerun.out, /^intent review fix, recorded/m);
  const written = read(tree, INTENT_REVIEW);
  assert.match(written, /evidence: "read src\/a\.ts, a is exported bare"/);
  assert.doesNotMatch(written, /mutant: a-one:2/);
  assert.doesNotMatch(run(fixture, ["review", "--tree", tree]).out, /--rerun/, "no survivor is left to name");
  const nothing = run(fixture, ["review", "--tree", tree, "--rerun", "survivors"]);
  assert.equal(nothing.code, 1, shown(nothing));
  assert.match(nothing.err, /and this one holds no surviving mutant with a line to break/);
});

test("a rerun that cannot record leaves the recorded review as it was", () => {
  const { fixture, tree } = outsideSurvivor();
  // A record written before reviewers were named: the rerun asks for one.
  write(tree, INTENT_REVIEW, read(tree, INTENT_REVIEW).replace(/^reviewer: .*\n/m, ""));
  git(tree, ["commit", "-qam", "an older record"]);
  const recorded = read(tree, INTENT_REVIEW);

  const refused = run(fixture, ["review", "--tree", tree, "--rerun", "survivors"]);

  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, /NO_REVIEWER/);
  assert.equal(read(tree, INTENT_REVIEW), recorded);
  assert.equal(git(tree, ["status", "--porcelain"]), "");
  const named = run(fixture, ["review", "--tree", tree, "--rerun", "survivors", "--reviewer", "rev-2"]);
  assert.equal(named.code, 0, shown(named));
  assert.match(read(tree, INTENT_REVIEW), /^reviewer: rev-2$/m);
});

test("a rerun is refused for a review that is owed, and for any other value", () => {
  const { fixture, tree } = survivor();
  const wrong = run(fixture, ["review", "--tree", tree, "--rerun", "everything"]);
  assert.equal(wrong.code, 1, shown(wrong));
  assert.match(wrong.err, /BAD_ARGS.*--rerun takes survivors/);
  newTest(tree);
  const owed = run(fixture, ["review", "--tree", tree, "--rerun", "survivors"]);
  assert.equal(owed.code, 1, shown(owed));
  assert.match(owed.err, /--rerun survivors runs the surviving mutants of a current fix intent review, and this one is owed: the code changed since/);
  assert.deepEqual(runs(fixture), []);
});

test("a reviewer's copy of a survivor is no other test: it runs as carried and keeps no was", () => {
  const { fixture, tree } = survivor();
  write(tree, "docs/b.md", "a-two is done\n");
  git(tree, ["commit", "-qam", "a-two built"]);

  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${SURVIVES_TWO.replace("criterion: 2", "criterion: a-one:2")}`);

  assert.equal(result.code, 2, shown(result));
  assert.deepEqual(runs(fixture), ["checks/two.expect"]);
  assert.doesNotMatch(read(tree, INTENT_REVIEW), /was:/);
});

test("a survivor given a second test that misses too keeps its first test as was when it is given a third", () => {
  const { fixture, tree } = survivor();
  write(tree, "checks/new.expect", "src/a.ts const\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a test that reads too little"]);
  assert.equal(intentReview(fixture, tree, `verdict: clean\nmutants:\n${retest()}`).code, 2);
  assert.match(read(tree, INTENT_REVIEW), new RegExp(`test: ${NEW_TEST}\\n {4}was: ${OLD_TEST}\\n {4}caught: no`));
  runs(fixture);
  write(tree, "checks/third.expect", "src/a.ts a2 = 2\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a test that reads a2"]);

  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${retest({ expect: "checks/third.expect" })}`);

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/third.expect"]);
  assert.match(read(tree, INTENT_REVIEW), new RegExp(`test: node checks/has.cjs checks/third.expect ../runs.log\\n {4}was: ${OLD_TEST}\\n {4}caught: yes`));
});
