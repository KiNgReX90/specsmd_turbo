const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { git, run, write } = require("./review-fixture.cjs");
const { INTENT_REVIEW, proposal } = require("./run-review-mutants-fixture.cjs");
const { SPEC, UNMARKED, aOne, intentReview, itemReviewed, planned, shown } = require("./run-criterion-marks-fixture.cjs");
const { intentRecordCall } = require("./run-call.cjs");

// A recorded intent review the gate or the ship refuses goes back to the reviewer that wrote it,
// which edits it in place. The keys the runner wrote when it recorded the file stay in, and while
// each holds the value the committed file holds it is the runner's own: the record reads past it
// and writes it anew. The refusal names that record call, never "the same command".

const read = (tree) => fs.readFileSync(path.join(tree, INTENT_REVIEW), "utf8");
const SECOND = proposal("a-one:2", { replace: "a = 5" });
const RECORD = (tree) => intentRecordCall(tree).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A clean intent review on record, then criterion 2's mark struck in a commit of its spec alone, so the review owes it a mutant. */
function owing() {
  const { fixture, tree } = planned();
  itemReviewed(fixture, tree);
  const recorded = intentReview(fixture, tree);
  assert.equal(recorded.code, 0, shown(recorded));
  write(tree, SPEC, aOne(UNMARKED));
  git(tree, ["commit", "-qm", "criterion 2 is proven by a test after all", "--", SPEC]);
  return { fixture, tree };
}

/** The recorded file as its reviewer edits it in place: one more mutant, the rest kept as it is. */
function sentBack(tree, change = (text) => text) {
  const text = read(tree);
  assert.match(text, /^tree: /m);
  write(tree, INTENT_REVIEW, change(text.replace(/^tree: /m, `${SECOND}tree: `)));
}

test("the gate and green send a refused intent review back and name the record call to run after", () => {
  const { fixture, tree } = owing();

  const gated = run(fixture, ["gate", "--tree", tree]);
  const greened = run(fixture, ["green", "--tree", tree]);

  for (const result of [gated, greened]) {
    assert.equal(result.code, 3, shown(result));
    assert.match(result.out, new RegExp(`intent review owed: .*a-one owes a caught mutant or a checked pin for criteria 2 .*` +
      `send this back to the reviewer that wrote the file, then run ${RECORD(tree)} to record it`));
    assert.doesNotMatch(result.out, /the same command/);
  }
  assert.match(gated.out, new RegExp(`run ${RECORD(tree)} first, then gate again`));
});

test("a recorded intent review edited in place with the runner's keys left in records again", () => {
  const { fixture, tree } = owing();
  sentBack(tree);

  const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-2"]);

  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /intent review clean, recorded/);
  const text = read(tree);
  for (const key of ["tree", "commit", "reviewer"]) assert.equal(text.match(new RegExp(`^${key}: `, "gm")).length, 1, `${key} once`);
  assert.match(text, /^reviewer: rev-2$/m);
  assert.deepEqual(git(tree, ["status", "--porcelain", "--", INTENT_REVIEW]), "");
  assert.equal(run(fixture, ["gate", "--tree", tree]).code, 0);
});

const FIX = "verdict: fix\nfindings:\n  - criterion: a-one:1\n    file: src/a.ts\n    line: \"1\"\n    evidence: e\n    fix: f\n" +
  "    severity: major\n    owner: a-one\n";

test("a recorded fix review with no mutant to run, sent back, holds each of the runner's keys once after its record", () => {
  const { fixture, tree } = planned();
  itemReviewed(fixture, tree);
  assert.equal(intentReview(fixture, tree, FIX).code, 2);
  write(tree, INTENT_REVIEW, `# read again\n${read(tree)}`);

  const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-2"]);

  assert.equal(result.code, 2, shown(result));
  assert.match(result.out, /intent review fix, recorded/);
  const text = read(tree);
  for (const key of ["tree", "commit", "reviewer"]) assert.equal(text.match(new RegExp(`^${key}: `, "gm")).length, 1, `${key} once`);
  assert.match(text, /^reviewer: rev-2$/m);
});

test("a recorded key the reviewer changed is refused as before", () => {
  const { fixture, tree } = owing();
  sentBack(tree, (text) => text.replace(/^tree: .*$/m, "tree: 0000000000000000000000000000000000000000"));

  const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-2"]);

  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /tree is written when the review is recorded, so drop it\. send this back to the reviewer that wrote the file, then run the same command again\./);
});

test("a file never recorded that carries tree is refused as before", () => {
  const { fixture, tree } = planned();
  itemReviewed(fixture, tree);

  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${proposal("a-one:1")}` +
    `${proposal("a-one:3", { line: 2, find: "a2 = 2", replace: "a2 = 8", expect: "checks/a2.expect" })}tree: abc\n`);

  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /tree is written when the review is recorded, so drop it/);
});
