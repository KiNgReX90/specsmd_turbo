const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const WRITER = path.join(__dirname, "state-transition.cjs");

const { git, markReviewed, run, write } = require("./review-fixture.cjs");
const { ARCHIVED_SPEC, MARKED, SPEC, UNMARKED, aOne, archived, intentReview, itemReviewed, planned, shown } = require("./run-criterion-marks-fixture.cjs");
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

/** Close and archive alpha through the ledger's writer, tick a-one's boxes, and commit it all as one commit. */
function closedAndArchived(tree) {
  const state = path.join(tree, ".specs-inferno/state.yaml");
  const proof = git(tree, ["rev-parse", "--short", "HEAD"]).trim();
  markReviewed(state, ["a-two"]);
  const writer = (args) => execFileSync(process.execPath, [WRITER, ...args, "--intent", "alpha", "--file", state], { cwd: tree });
  for (const id of ["a-one", "a-two"]) writer(["complete-item", "--item", id, "--proof", proof]);
  writer(["close-intent"]);
  writer(["archive-intent"]);
  const spec = fs.readFileSync(path.join(tree, ARCHIVED_SPEC), "utf8");
  write(tree, ARCHIVED_SPEC, spec.replace(/- \[ \] /g, "- [x] "));
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "specsmd(alpha): close and archive"]);
}

test("an intent whose mark was planned before its first review, closed and archived in one commit, ships with no intent review owed", () => {
  const { fixture, tree } = planned();
  itemReviewed(fixture, tree);
  const reviewed = intentReview(fixture, tree);
  assert.equal(reviewed.code, 0, shown(reviewed));
  closedAndArchived(tree);

  assert.deepEqual(late(tree), []);
  const gated = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gated.code, 0, shown(gated));
  const result = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /shipped/);
});

test("a mark added after the first review beside other work reads late before the archive and after it", () => {
  const { fixture, tree } = planned(UNMARKED);
  itemReviewed(fixture, tree);
  write(tree, SPEC, aOne());
  write(tree, "docs/b.md", "the notes moved too\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a mark beside other work"]);
  assert.deepEqual(late(tree), [1], "before the archive");

  archived(tree);

  assert.deepEqual(late(tree), [1], "after the archive");
  assert.deepEqual(mutantGaps(itemProofs(tree, "alpha", ["a-one"]), caught), [LATE]);
});
