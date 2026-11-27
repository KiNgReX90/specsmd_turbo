const assert = require("node:assert/strict");
const test = require("node:test");

const { INTENT_TREE, git, run, worktree, write } = require("./review-fixture.cjs");
const {
  A_EDITABLE, A_ONE, CAUGHT_ONE, INTENT_REVIEW, REVIEW, caughtTree, itemReview, itemSpec, mutantRepo, proposal, read, record, runs, withMutants,
} = require("./run-review-mutants-fixture.cjs");
const { archived } = require("./run-criterion-marks-fixture.cjs");
const { parseItemReview } = require("./run-review-file.cjs");
const { itemProofs, mutantGaps } = require("./run-mutant-coverage.cjs");

// An item review's caught mutant counts for its criterion only while its line can still be placed
// on the tree as it is: on its own line, on the one line of its file that holds its find, or on the
// one line of the files the item changed since its first review that holds it. One that can no
// longer be placed proves nothing about the code that replaced it: a delta item review says so in
// one line and keeps the entry as recorded, the coverage owes its criterion, and the intent review
// may give that criterion a mutant of its own.

const SPEC = ".specs-inferno/intents/alpha/work-items/a-one.md";
const QUALITY = ".specs-inferno/intents/alpha/reviews/quality/a-one.yaml";
const shown = (result) => result.out + result.err;
const GAP_ONE = 'a-one owes a caught mutant or a checked pin for criteria 1 "a reads one"';
const OWES_ONE = "; the intent review owes criterion 1 a caught mutant or a checked pin";
const gaps = (tree) => mutantGaps(itemProofs(tree, "alpha", ["a-one"]), []);

/** The intent worktree in which a-one's first review caught a mutant for each of its two criteria. */
function caught() {
  const caughtBoth = caughtTree();
  assert.deepEqual(gaps(caughtBoth.tree), []);
  return caughtBoth;
}

/** Commit a correction of a-one: `files` as given, and its spec owning `owned` besides its own paths. */
function corrected(tree, files, owned = []) {
  for (const [rel, body] of Object.entries(files)) write(tree, rel, body);
  if (owned.length > 0) write(tree, SPEC, itemSpec("a-one", A_ONE, [...A_EDITABLE, ...owned]));
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the correction"]);
}

/** a-one's delta review after its correction, both lenses clean, recorded; `file` is the production file both list. */
function deltaReview(fixture, tree, file = "src/a.ts") {
  const owed = run(fixture, ["review", "--item", "a-one", "--tree", tree]);
  assert.equal(owed.code, 3, shown(owed));
  assert.match(owed.out, /^dispatch specsmd-inferno-reviewer-quality item a-one$/m, "the correction changed production code");
  write(tree, REVIEW, itemReview("").replace("[src/a.ts,", `[${file},`));
  write(tree, QUALITY, `item: a-one\nverdict: clean\nfiles: [${file}]\n`);
  const result = record(fixture, ["--quality-reviewer", "rev-q"], tree);
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), [], "a caught entry is carried, never run again");
  return result;
}

/** Dispatch the intent review, write what its reviewer wrote, and record it. */
function intentReview(fixture, tree, body) {
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, body);
  return run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
}

const OWN_ONE = (find) => proposal("a-one:1", { file: "src/a.ts", find, replace: "0 + 7" });

test("a caught mutant whose line a correction rewrote stops counting, and the intent review's own mutant for it runs", () => {
  const { fixture, tree } = caught();
  corrected(tree, { "src/a.ts": "export const a = 0 + 1;\nexport const a2 = 2;\n", "checks/one.expect": "src/a.ts 0 + 1\n" });

  const delta = deltaReview(fixture, tree);

  assert.match(delta.out, new RegExp(`^MUTANT 1 \\(src/a\\.ts:1, find "a = 1"\\) no longer stands: src/a\\.ts:1 changed, and find no longer ` +
    `marks one line of it${OWES_ONE}$`, "m"));
  assert.doesNotMatch(delta.out, /^MUTANT 2/m);
  const recorded = parseItemReview(tree, REVIEW, "a-one", { recorded: true });
  assert.deepEqual(recorded.mutants.map((m) => [m.criterion, m.file, m.line, m.find, m.caught]),
    [["1", "src/a.ts", "1", "a = 1", "yes"], ["2", "src/a.ts", "2", "a2 = 2", "yes"]], "the entry stays as recorded");
  assert.deepEqual(gaps(tree), [GAP_ONE]);

  const refused = intentReview(fixture, tree, "verdict: clean\n");
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, new RegExp(`verdict clean while ${GAP_ONE}\\. Propose one mutant`));

  write(tree, INTENT_REVIEW, `verdict: clean\nmutants:\n${OWN_ONE("0 + 1")}`);
  const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);

  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /mutants: 1 ran, 1 caught, 0 survived, 0 without a verdict/);
  assert.deepEqual(runs(fixture), ["checks/one.expect"]);
  assert.match(read(tree, INTENT_REVIEW), /criterion: a-one:1\n {4}file: src\/a\.ts\n {4}line: 1\n {4}find: 0 \+ 1\n(?:.*\n){2} {4}caught: yes/);
});

test("a proposal still owed whose line a correction rewrote is told once, as the run's own no verdict", () => {
  const fixture = mutantRepo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "scan"]);
  write(tree, "docs/b.md", "a-two is mid-build\n");
  write(tree, REVIEW, withMutants(CAUGHT_ONE));
  assert.match(record(fixture, [], tree).out, /1 proposal stays owed to the intent review/);
  git(tree, ["checkout", "--", "docs/b.md"]);
  corrected(tree, { "src/a.ts": "export const a = 0 + 1;\nexport const a2 = 2;\n" });

  const delta = deltaReview(fixture, tree);

  assert.match(delta.out, new RegExp(`^MUTANT 1 no verdict: src/a\\.ts:1 changed, and find no longer marks one line of it${OWES_ONE}$`, "m"));
  assert.doesNotMatch(delta.out, /no longer stands/);
});

/** The intent review's refusal of a second mutant for criterion 1, which its item review's caught one still holds. */
function refusedSecond(fixture, tree, own) {
  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${own}`);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /mutants proposes one for a-one:1, which has a mutant its item review caught/);
  assert.deepEqual(runs(fixture), []);
}

test("a caught mutant whose line only moved within its file counts as before", () => {
  const { fixture, tree } = caught();
  corrected(tree, { "src/a.ts": "// the values\nexport const a = 1;\nexport const a2 = 2;\n" });

  const delta = deltaReview(fixture, tree);

  assert.doesNotMatch(delta.out, /no longer stands/);
  assert.deepEqual(gaps(tree), []);
  refusedSecond(fixture, tree, proposal("a-one:1", { line: 2 }));
});

test("a caught mutant whose line moved into a file the item changed since its first review counts as before", () => {
  const { fixture, tree } = caught();
  corrected(tree, {
    "src/a.ts": "export { a } from './c';\nexport const a2 = 2;\n", "src/c.ts": "export const a = 1;\n",
  }, ["src/c.ts"]);

  const delta = deltaReview(fixture, tree);

  assert.doesNotMatch(delta.out, /no longer stands/);
  assert.deepEqual(gaps(tree), []);
  refusedSecond(fixture, tree, proposal("a-one:1", { file: "src/c.ts" }));
});

test("a find two lines of the files the item changed since hold has no place, so its mutant no longer stands", () => {
  const { fixture, tree } = caught();
  corrected(tree, {
    "src/a.ts": "export { a } from './c';\nexport const a2 = 2;\n", "src/c.ts": "export const a = 1;\n", "src/d.ts": "export const a = 1;\n",
  }, ["src/c.ts", "src/d.ts"]);

  const delta = deltaReview(fixture, tree);

  assert.match(delta.out, new RegExp("^MUTANT 1 \\(src/a\\.ts:1, find \"a = 1\"\\) no longer stands: src/a\\.ts:1 changed, and find no longer " +
    `marks one line of it; 2 lines of the files the item changed since hold it, so none is its place${OWES_ONE}$`, "m"));
  assert.deepEqual(gaps(tree), [GAP_ONE]);
});

test("a caught mutant whose file is gone no longer stands", () => {
  const { fixture, tree } = caught();
  git(tree, ["rm", "-q", "src/a.ts"]);
  corrected(tree, { "src/c.ts": "export const a = 0 + 1;\nexport const a2 = 0 + 2;\n" }, ["src/c.ts"]);

  const delta = deltaReview(fixture, tree, "src/c.ts");

  assert.match(delta.out, new RegExp(`^MUTANT 1 \\(src/a\\.ts:1, find "a = 1"\\) no longer stands: src/a\\.ts is not a committed file, ` +
    `so nothing could restore it${OWES_ONE}$`, "m"));
  assert.deepEqual(gaps(tree), ['a-one owes a caught mutant or a checked pin for criteria 1 "a reads one", 2 "a2 reads two"']);
});

test("a mutant its item moved into another file counts as before once the intent is archived", () => {
  const { tree } = caught();
  corrected(tree, { "src/a.ts": "export { a } from './c';\nexport const a2 = 2;\n", "src/c.ts": "export const a = 1;\n" }, ["src/c.ts"]);
  assert.deepEqual(gaps(tree), [], "before the archive");

  archived(tree);

  assert.deepEqual(gaps(tree), [], "after the archive");
});
