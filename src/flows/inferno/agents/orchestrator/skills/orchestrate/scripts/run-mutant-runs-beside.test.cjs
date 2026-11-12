const assert = require("node:assert/strict");
const test = require("node:test");

const { CONFIG, git, write } = require("./review-fixture.cjs");
const { CAUGHT_ONE, REVIEW, mutantRepo, proposal, read, record, runs, withMutants } = require("./run-review-mutants-fixture.cjs");
const { parseItemReview } = require("./run-review-file.cjs");

// One intent worktree holds several items at once: while an item's record runs its mutants, a
// sibling's builder may edit beside it and a sibling's reviewers may write their files. A verdict
// stands when the file the mutant broke and the paths the host's reseal changed are back. Any other
// path that moved is printed as a warning, and the verdicts are recorded. A sibling's pending review
// file does not hold the mutants back at the start either: no test reads it and no mutant touches it.

const SIBLING = ".specs-inferno/intents/alpha/reviews/a-two.yaml";
const shown = (result) => result.out + result.err;

/** A builder of a-two still running on the tree: its dispatch started and was never accepted. */
function openDispatch(fixture, editable = ["docs/b.md", "src/b.ts"]) {
  const old = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = fixture.cache;
  try {
    require("./run-dispatch.cjs").recordDispatch(fixture.root, { intent: "alpha", item: "a-two", dispatch_id: "build-a-two", editable });
  } finally {
    if (old === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = old;
  }
}

/** a-one's first review with criterion 1's proposal, its test run after `before`. */
const reviewRunning = (before) => withMutants(CAUGHT_ONE.replace("test: node", `test: ${before} && node`));

function recorded(fixture) {
  return parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true }).mutants.map((m) => [m.criterion, m.caught]);
}

/** Refused with MUTATE_RESTORE: nothing reaches the ledger or a commit, and the reviewer's file is as it wrote it. */
function refused(fixture, body, args = []) {
  const ledger = read(fixture.root, ".specs-inferno/state.yaml");
  const head = git(fixture.root, ["rev-parse", "HEAD"]);
  write(fixture.root, REVIEW, body);
  const result = record(fixture, args);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /ERROR \[MUTATE_RESTORE\] .*Nothing is recorded/);
  assert.equal(read(fixture.root, ".specs-inferno/state.yaml"), ledger, "the ledger holds no review");
  assert.equal(git(fixture.root, ["rev-parse", "HEAD"]), head, "nothing is committed");
  assert.equal(read(fixture.root, REVIEW), body, "the reviewer's file is as it wrote it");
  return result;
}

test("a sibling's reviewer that writes its file during the batch leaves the verdicts recorded, and the file is named as moved", () => {
  const fixture = mutantRepo();
  write(fixture.root, REVIEW, reviewRunning(`echo item: a-two > ${SIBLING}`));

  const result = record(fixture);

  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /mutants: 1 ran, 1 caught, 0 survived/);
  assert.match(result.out, /^WARNING moved during the batch: \.specs-inferno\/intents\/alpha\/reviews\/a-two\.yaml \(the review file of a-two\); it may be another dispatch's work/m);
  assert.doesNotMatch(result.out, /mutate\.sealed/, "another item's file is never named as left behind");
  assert.deepEqual(recorded(fixture), [["1", "yes"]]);
  assert.equal(read(fixture.root, SIBLING), "item: a-two\n");
  assert.equal(git(fixture.root, ["status", "--porcelain"]), `?? ${SIBLING}`, "the sibling's file stays uncommitted, outside the record");
});

test("a path a sibling's open dispatch owns, changed during the batch, leaves the verdicts recorded with a warning", () => {
  const fixture = mutantRepo();
  openDispatch(fixture);
  write(fixture.root, REVIEW, reviewRunning("echo mid-build >> docs/b.md"));

  const result = record(fixture);

  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /^WARNING moved during the batch: docs\/b\.md \(owned by dispatch build-a-two of a-two\)/m);
  assert.deepEqual(recorded(fixture), [["1", "yes"]]);
  assert.equal(read(fixture.root, "docs/b.md"), "docs\nmid-build\n", "the sibling's work is left as it is");
});

test("a sibling's dispatch open at the start and accepted during the batch still owns what it changed: the verdicts are recorded", () => {
  const dispatchModule = JSON.stringify(require.resolve("./run-dispatch.cjs"));
  const accept = `require(${dispatchModule}).acceptDispatch(process.cwd(), { dispatch_id: "build-a-two", changed_paths: ["docs/b.md"] });\n`;
  const fixture = mutantRepo({ files: { "accept.cjs": accept } });
  openDispatch(fixture);
  write(fixture.root, REVIEW, reviewRunning("echo mid-build >> docs/b.md && node accept.cjs"));

  const result = record(fixture);

  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /^WARNING moved during the batch: docs\/b\.md \(claimed by dispatch build-a-two of a-two\)/m);
  assert.deepEqual(recorded(fixture), [["1", "yes"]]);
  assert.equal(read(fixture.root, "docs/b.md"), "docs\nmid-build\n", "the sibling's work is left as it is");
});

test("beside a sibling's open dispatch, a path nobody owns leaves the verdicts recorded, with the warning and the hint", () => {
  const fixture = mutantRepo();
  openDispatch(fixture);
  write(fixture.root, REVIEW, reviewRunning("mkdir -p gen && echo x > gen/new.txt"));

  const result = record(fixture);

  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /^WARNING changed during the batch: gen\/new\.txt, while dispatch build-a-two of a-two ran beside it, so it may be another dispatch's work/m);
  assert.match(result.out, /if the test command wrote it: a sealed file goes under mutate\.sealed/);
  assert.deepEqual(recorded(fixture), [["1", "yes"]]);
});

test("a file the batch broke that is not back records nothing, beside a sibling's open dispatch too", () => {
  const fixture = mutantRepo();
  openDispatch(fixture, ["docs/b.md", "src/**"]);
  // A test that stages the file it reads: the restore then checks the mutant out of the index again.
  const result = refused(fixture, reviewRunning("git add src/a.ts"));
  assert.match(result.err, /src\/a\.ts/);
});

test("a file of the item under review that the test left changed records nothing, beside a sibling's open dispatch too", () => {
  const fixture = mutantRepo();
  openDispatch(fixture);
  const result = refused(fixture, reviewRunning("echo 'src/a.ts export' >> checks/two.expect"));
  assert.match(result.err, /checks\/two\.expect/);
});

test("a sealed path the batch left changed records nothing, beside a sibling's open dispatch too", () => {
  const fixture = mutantRepo({ files: { ".specs-inferno/config.sealed.yaml": `${CONFIG}mutate:\n  sealed:\n    - paths: ["gen/**"]\n      reseal: "true"\n` } });
  openDispatch(fixture);
  const result = refused(fixture, reviewRunning("mkdir -p gen && echo x > gen/seal.txt"), ["--config", ".specs-inferno/config.sealed.yaml"]);
  assert.match(result.err, /gen\/seal\.txt/);
});

test("a path the reseal changed that is not back records nothing, beside a sibling's open dispatch too", () => {
  const seal = "'use strict';\nrequire('fs').appendFileSync('manifest.txt', 'sealed\\n');\n";
  const sealed = `${CONFIG}mutate:\n  sealed:\n    - paths: ["defs/**"]\n      reseal: "node seal.cjs"\n`;
  const fixture = mutantRepo({
    files: { "defs/value.txt": "1\n", "manifest.txt": "seal\n", "seal.cjs": seal, ".specs-inferno/config.sealed.yaml": sealed },
  });
  openDispatch(fixture);
  const value = proposal(1, { file: "defs/value.txt", find: "1", replace: "2" }).replace(/test: .*\n/, "test: chmod a-w manifest.txt && false\n");
  const result = refused(fixture, withMutants(value), ["--config", ".specs-inferno/config.sealed.yaml"]);
  assert.match(result.err, /manifest\.txt, which a reseal changed/);
});

test("a sibling's review file pending at the start does not hold the mutants back, and is left as it is", () => {
  const fixture = mutantRepo();
  write(fixture.root, SIBLING, "item: a-two\n");
  write(fixture.root, REVIEW, withMutants(CAUGHT_ONE));

  const result = record(fixture);

  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /mutants: 1 ran, 1 caught, 0 survived/);
  assert.deepEqual(runs(fixture), ["checks/one.expect"]);
  assert.deepEqual(recorded(fixture), [["1", "yes"]]);
  assert.equal(git(fixture.root, ["status", "--porcelain"]), `?? ${SIBLING}`);
});

test("a sibling's uncommitted code beside its review file still holds the mutants back", () => {
  const fixture = mutantRepo();
  write(fixture.root, SIBLING, "item: a-two\n");
  write(fixture.root, "docs/b.md", "a-two is mid-build\n");
  write(fixture.root, REVIEW, withMutants(CAUGHT_ONE));

  const result = record(fixture);

  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /no mutant ran: the tree holds uncommitted work in docs\/b\.md, so 1 proposal stays owed to the intent review/);
  assert.deepEqual(runs(fixture), []);
});
