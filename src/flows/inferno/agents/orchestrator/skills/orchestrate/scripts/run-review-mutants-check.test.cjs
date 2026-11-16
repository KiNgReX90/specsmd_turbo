const assert = require("node:assert/strict");
const test = require("node:test");

const { INTENT_TREE, git, run, worktree, write } = require("./review-fixture.cjs");
const { INTENT_REVIEW, REVIEW, itemReview, mutantRepo, proposal, read, record, runs, withMutants } = require("./run-review-mutants-fixture.cjs");

// A criterion only a plain check proves takes the check as its mutant's test, and the entry says
// `check: true`. The key travels with the entry wherever the runner takes it: the item review that
// proposes it, the delta review that carries it and reruns its survivor, the intent review that
// runs it while its item review owes it, a survivor given another test, and a withdrawn entry.

// The check: exit 0 while every line of the expect file finds its text, else 1, with no runner's summary.
const PLAIN = String.raw`'use strict';
const fs = require('fs');
const [spec, log] = process.argv.slice(2);
if (log) fs.appendFileSync(log, spec + '\n');
const missed = fs.readFileSync(spec, 'utf8').split('\n').filter(Boolean).filter((line) => {
  const at = line.indexOf(' ');
  return !fs.readFileSync(line.slice(0, at), 'utf8').includes(line.slice(at + 1));
});
process.exit(missed.length > 0 ? 1 : 0);
`;

const SCAN = ".specs-inferno/intents/alpha/scan.yaml";
const shown = (result) => result.out + result.err;
const repo = () => mutantRepo({ files: { "checks/plain.cjs": PLAIN } });
/** A proposal whose test is the plain check, marked as one. */
const plain = (criterion, options = {}, check = "true") =>
  proposal(criterion, options).replace("checks/has.cjs", "checks/plain.cjs") + (check ? `    check: ${check}\n` : "");
const TWO = { line: 2, find: "a2 = 2", replace: "a2 = 8" };
const ONE_CHECK = plain(1);
const STRONG_TWO_CHECK = plain(2, { ...TWO, expect: "checks/a2.expect" });
const WEAK_TWO_CHECK = plain(2, { ...TWO, expect: "checks/two.expect" });

function intentReview(fixture, tree, body) {
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, body);
  return run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
}

/** The intent worktree, its scan collected, and a-one's first review `body` recorded beside a sibling's work, so its proposals stay owed. */
function owedTree(body) {
  const fixture = repo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, SCAN, "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "scan"]);
  write(tree, "docs/b.md", "a-two is mid-build\n");
  write(tree, REVIEW, body);
  assert.equal(record(fixture, [], tree).code, 0);
  git(tree, ["checkout", "--", "docs/b.md"]);
  assert.deepEqual(runs(fixture), []);
  return { fixture, tree };
}

test("an item review's check proposals run as checks, and the file keeps check: true on each", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, withMutants(ONE_CHECK, STRONG_TWO_CHECK));
  const result = record(fixture);
  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /mutants: 2 ran, 2 caught, 0 survived, 0 without a verdict/);
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/a2.expect", "checks/one.expect", "checks/a2.expect"],
    "each check on the tree as it is, then on its mutant");
  assert.equal((read(fixture.root, REVIEW).match(/ {4}test: node checks\/plain\.cjs \S+ \.\.\/runs\.log\n {4}check: true\n {4}caught: yes\n/g) || []).length, 2);
});

test("an entry's check reads true or is left out", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, withMutants(plain(1, {}, "yes")));
  const result = record(fixture);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /mutants entry 1 check reads yes; write check: true for a test that is a plain check, or leave it out/);
  assert.deepEqual(runs(fixture), []);
});

test("a delta review carries a check entry, and its survivor reruns as a check", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, withMutants(ONE_CHECK, WEAK_TWO_CHECK));
  const first = record(fixture);
  assert.equal(first.code, 2, shown(first));
  assert.match(first.out, /mutants: 2 ran, 1 caught, 1 survived/);
  runs(fixture);
  write(fixture.root, "checks/two.expect", "src/a.ts a2 = 2\n");
  git(fixture.root, ["commit", "-qam", "the check of criterion 2 now reads the value"]);
  assert.equal(run(fixture, ["review", "--item", "a-one", "--tree", fixture.root]).code, 3);
  write(fixture.root, REVIEW, itemReview(""));

  const result = record(fixture);

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/two.expect", "checks/two.expect"]);
  assert.match(result.out, /mutants: 1 ran, 1 caught, 0 survived/);
  assert.equal((read(fixture.root, REVIEW).match(/ {4}check: true\n {4}caught: yes\n/g) || []).length, 2);
});

test("the intent review runs an item's owed check proposals as checks", () => {
  const { fixture, tree } = owedTree(withMutants(ONE_CHECK, STRONG_TWO_CHECK));
  const result = intentReview(fixture, tree, "verdict: clean\n");
  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /mutants: 2 ran, 2 caught, 0 survived, 0 without a verdict/);
  assert.equal((read(tree, INTENT_REVIEW).match(/ {4}check: true\n {4}caught: yes\n/g) || []).length, 2);
});

test("a survivor given a check as its other test takes the key with it", () => {
  const weak = proposal(2, { ...TWO, expect: "checks/two.expect" });
  const { fixture, tree } = owedTree(withMutants(ONE_CHECK, weak));
  const first = intentReview(fixture, tree, "verdict: clean\n");
  assert.equal(first.code, 2, shown(first));
  assert.match(first.out, /mutants: 2 ran, 1 caught, 1 survived/);
  runs(fixture);
  write(tree, "checks/new.expect", "src/a.ts a2 = 2\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a check that reads a2"]);

  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${plain("a-one:2", { ...TWO, expect: "checks/new.expect" })}`);

  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /mutants: 1 ran, 1 caught, 0 survived/);
  assert.match(read(tree, INTENT_REVIEW), / {4}test: node checks\/plain\.cjs checks\/new\.expect \.\.\/runs\.log\n {4}check: true\n {4}was: node checks\/has\.cjs checks\/two\.expect \.\.\/runs\.log\n {4}caught: yes\n/);
});

test("a check entry is withdrawn by its copy as recorded, key and all", () => {
  const { fixture, tree } = owedTree(withMutants(ONE_CHECK, WEAK_TWO_CHECK));
  const first = intentReview(fixture, tree, "verdict: clean\n");
  assert.equal(first.code, 2, shown(first));
  write(tree, "docs/b.md", "a docs change\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a docs change"]);
  runs(fixture);
  const survivor = plain("a-one:2", { ...TWO, expect: "checks/two.expect" });
  const strong = plain("a-one:2", { ...TWO, expect: "checks/a2.expect" });

  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${strong}withdrawn:\n${survivor}    caught: no\n    reason: its check never reads the line\n`);

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/a2.expect", "checks/a2.expect"], "only the new proposal ran, as a check");
  assert.match(read(tree, INTENT_REVIEW), /^withdrawn:\n {2}- criterion: a-one:2\n(?:.*\n){5} {4}check: true\n {4}caught: no\n {4}reason: /m);
});
