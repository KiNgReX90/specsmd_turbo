const assert = require("node:assert/strict");
const test = require("node:test");

const { git, write } = require("./review-fixture.cjs");
const { CAUGHT_ONE, REVIEW, mutantRepo, read, record, withMutants } = require("./run-review-mutants-fixture.cjs");

// A path one mutant's test command left changed can turn the next mutant's test red for the wrong
// reason, so the record of a review takes no verdict from such a batch: it names the path and the
// two ways out (a seal under mutate.sealed, or a test command that leaves the tree as it found it),
// and records nothing.

test("an item review whose mutant's test appends to a tracked file is refused, names the path, and is not recorded", () => {
  const fixture = mutantRepo();
  const ledger = read(fixture.root, ".specs-inferno/state.yaml");
  const head = git(fixture.root, ["rev-parse", "HEAD"]);
  const body = withMutants(CAUGHT_ONE.replace("test: node", "test: echo more >> docs/b.md && node"));
  write(fixture.root, REVIEW, body);

  const result = record(fixture);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /ERROR \[MUTATE_RESTORE\] .*not restored: the test command left docs\/b\.md changed.*Nothing is recorded/);
  assert.match(result.err, /mutate\.sealed.*the test command must leave the tree as it found it/);
  assert.equal(read(fixture.root, ".specs-inferno/state.yaml"), ledger, "the ledger holds no review");
  assert.equal(git(fixture.root, ["rev-parse", "HEAD"]), head, "nothing is committed");
  assert.equal(read(fixture.root, REVIEW), body, "the reviewer's file is as it wrote it");
});
