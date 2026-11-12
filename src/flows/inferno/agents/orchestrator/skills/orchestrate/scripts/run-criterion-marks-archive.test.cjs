const assert = require("node:assert/strict");
const test = require("node:test");

const { git, write } = require("./review-fixture.cjs");
const { ARCHIVED_SPEC, MARKED, UNMARKED, aOne, archived, itemReviewed, planned } = require("./run-criterion-marks-fixture.cjs");
const { itemProofs, mutantGaps } = require("./run-mutant-coverage.cjs");

// Whether a gate mark was planned is read over the spec's whole life, across the move of its
// intent into the archive. The commit that closes and archives the intent moves the spec and
// ticks its checkboxes, which changes no criterion's text, so a mark the plan held from its first
// commit still counts. A mark that arrives with the archive, or after it beside other work, is
// as late as one added before it; one added after it in a commit of the spec alone counts.

const caught = [{ criterion: "a-one:1", caught: "yes" }, { criterion: "a-one:3", caught: "yes" }];
const late = (tree) => itemProofs(tree, "alpha", ["a-one"])[0].late;
const LATE = `a-one owes a caught mutant or a checked pin for criteria 2 "${MARKED}" ` +
  "(its gate mark came after the item's first review, outside a commit of its spec alone)";

test("a mark the plan held from its first commit still counts once the archive moved the spec and ticked it", () => {
  const { fixture, tree } = planned();
  itemReviewed(fixture, tree);
  archived(tree);

  assert.match(git(tree, ["show", "HEAD:" + ARCHIVED_SPEC]), /- \[x\] the size cap holds/);
  assert.deepEqual(late(tree), []);
  assert.deepEqual(mutantGaps(itemProofs(tree, "alpha", ["a-one"]), caught), []);
});

test("a mark added in the commit that archives the intent counts for nothing", () => {
  const { fixture, tree } = planned(UNMARKED);
  itemReviewed(fixture, tree);
  archived(tree, (spec) => spec.replace(UNMARKED, MARKED));

  assert.deepEqual(late(tree), [1]);
  assert.deepEqual(mutantGaps(itemProofs(tree, "alpha", ["a-one"]), caught), [LATE]);
});

test("a mark added after the archive beside another file counts for nothing", () => {
  const { fixture, tree } = planned(UNMARKED);
  itemReviewed(fixture, tree);
  archived(tree);
  write(tree, ARCHIVED_SPEC, aOne().replace(/- \[ \] /g, "- [x] "));
  write(tree, "docs/b.md", "the notes moved too\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a mark beside other work"]);

  assert.deepEqual(late(tree), [1]);
  assert.deepEqual(mutantGaps(itemProofs(tree, "alpha", ["a-one"]), caught), [LATE]);
});

test("a mark added after the archive in a commit of the spec alone counts", () => {
  const { fixture, tree } = planned(UNMARKED);
  itemReviewed(fixture, tree);
  archived(tree);
  write(tree, ARCHIVED_SPEC, aOne().replace(/- \[ \] /g, "- [x] "));
  git(tree, ["commit", "-qm", "criterion 2 is proven at the gate", "--", ARCHIVED_SPEC]);

  assert.deepEqual(late(tree), []);
});
