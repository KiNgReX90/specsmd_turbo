const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { git, run, write } = require("./review-fixture.cjs");
const { REVIEW } = require("./run-review-mutants-fixture.cjs");
const { itemReviewed, planned, shown } = require("./run-criterion-marks-fixture.cjs");
const { parseQualityReview, qualityPath } = require("./run-review-quality.cjs");
const { RunError } = require("./run-lib.cjs");

// The item review and its quality lens are held to the rule the intent review is: a recorded file
// sent back to its reviewer and edited in place keeps the keys the runner wrote, and while each
// holds the value the committed file holds, the record reads past it and writes it anew.

const read = (tree, rel) => fs.readFileSync(path.join(tree, rel), "utf8");
const edited = (tree, rel, change = (text) => text) => write(tree, rel, change(`# read again\n${read(tree, rel)}`));
const recordAs = (fixture, tree, id) => run(fixture, ["review", "--item", "a-one", "--tree", tree, "--reviewer", id]);

test("a recorded item review edited in place with the runner's keys left in records again", () => {
  const { fixture, tree } = planned();
  itemReviewed(fixture, tree);
  edited(tree, REVIEW);

  const result = recordAs(fixture, tree, "rev-2");

  assert.equal(result.code, 0, shown(result));
  const text = read(tree, REVIEW);
  for (const key of ["tree", "commit", "reviewer"]) assert.equal(text.match(new RegExp(`^${key}: `, "gm")).length, 1, `${key} once`);
  assert.match(text, /^reviewer: rev-2$/m);
  assert.equal(git(tree, ["status", "--porcelain", "--", REVIEW]), "");
});

test("an item review whose recorded key the reviewer changed is refused as before", () => {
  const { fixture, tree } = planned();
  itemReviewed(fixture, tree);
  edited(tree, REVIEW, (text) => text.replace(/^commit: .*$/m, "commit: 0000000"));

  const result = recordAs(fixture, tree, "rev-2");

  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /commit is written when the review is recorded, so drop it\. send this back to the reviewer that wrote the file, then run the same command again\./);
});

test("a quality review sent back keeps the runner's keys, and one that changed them or was never recorded is refused", () => {
  const { tree } = planned();
  const rel = qualityPath("alpha", "a-one");
  const keys = `tree: abc\ncommit: ${git(tree, ["rev-parse", "HEAD"])}\nreviewer: q-1\n`;
  write(tree, rel, `item: a-one\nverdict: clean\nfiles: [src/a.ts]\n${keys}`);
  const refused = (pattern) => (error) => error instanceof RunError && pattern.test(error.message);
  assert.throws(() => parseQualityReview(tree, rel, "a-one", { recorded: false }), refused(/tree is written when the review is recorded/));
  git(tree, ["add", "--", rel]);
  git(tree, ["commit", "-qm", "the quality review, recorded", "--", rel]);

  edited(tree, rel);
  assert.equal(parseQualityReview(tree, rel, "a-one", { recorded: false }).verdict, "clean");
  edited(tree, rel, (text) => text.replace("reviewer: q-1", "reviewer: q-9"));
  assert.throws(() => parseQualityReview(tree, rel, "a-one", { recorded: false }), refused(/reviewer is written when the review is recorded/));
});

test("a recorded key that holds a list, never a value the runner writes, is refused even unchanged", () => {
  const { tree } = planned();
  const rel = qualityPath("alpha", "a-one");
  write(tree, rel, `item: a-one\nverdict: clean\nfiles: [src/a.ts]\ncommit: ${git(tree, ["rev-parse", "HEAD"])}\nreviewer: [q-1]\n`);
  git(tree, ["add", "--", rel]);
  git(tree, ["commit", "-qm", "a quality review committed by hand", "--", rel]);

  edited(tree, rel);

  assert.throws(() => parseQualityReview(tree, rel, "a-one", { recorded: false }),
    (error) => error instanceof RunError && /reviewer is written when the review is recorded/.test(error.message));
});
