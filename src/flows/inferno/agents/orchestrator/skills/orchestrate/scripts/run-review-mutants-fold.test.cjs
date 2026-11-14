const assert = require("node:assert/strict");
const test = require("node:test");

const { CONFIG, git, run, write } = require("./review-fixture.cjs");
const {
  A_EDITABLE, A_ONE, CAUGHT_ONE, INTENT_REVIEW, caughtTree, itemSpec, proposal, read, runs, withMutants,
} = require("./run-review-mutants-fixture.cjs");
const { intentRecordCall, intentReviewCall } = require("./run-call.cjs");

// A fold of the base that rewrites the line an item review's caught mutant broke, or the copy its
// checked pin read, leaves a recorded clean intent review with a gap the review never had: that
// proof is about code the fold replaced. The fold moved the tree, so the review is owed anyway, and
// no record of the recorded file can close the gap: its dispatch read another tree. The gate names
// the review call, whose dispatch reads the fold as a delta and whose reviewer may propose for the
// criterion the fold opened.

const GATED = CONFIG.replace("verification:\n", "verification:\n  finalize:\n    - echo gated\n");
const SENTENCE = "Gift cards never expire and keep their full value.";
const COPY = { "src/notice.html": `<p>${SENTENCE}</p>\n`, "checks/notice.test.cjs": `says(['${SENTENCE}']);\n` };
const PIN = `pins:\n  - criterion: 2\n    says: a2 reads two\n    file: src/notice.html\n    test: checks/notice.test.cjs\n    text: "${SENTENCE}"\n`;
const shown = (result) => result.out + result.err;
const quoted = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A clean intent review recorded over a-one's item review `body`, then main moves `files`. */
function foldOwed(body, files, config = GATED) {
  const { fixture, tree } = caughtTree({ config, files: COPY }, body);
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, "verdict: clean\n");
  const recorded = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
  assert.equal(recorded.code, 0, shown(recorded));
  for (const [rel, text] of Object.entries(files)) write(fixture.root, rel, text);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "main rewrites a line the intent's proof reads"]);
  return { fixture, tree };
}

/** The gate after the fold: the review is owed with its gap, and the step is the review call, never a record. */
function gatedAfterFold(fixture, tree, gap) {
  const gated = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gated.code, 3, shown(gated));
  assert.match(gated.out, /^folded main into /m);
  assert.match(gated.out, /^intent review owed: the code changed since the review read it at [0-9a-f]{7}$/m);
  assert.match(gated.out, new RegExp(`^intent review owed: ${quoted(INTENT_REVIEW)}: verdict clean while ${quoted(gap)}\\. Propose one mutant`, "m"));
  assert.match(gated.out, /^the fold moved the tree from [0-9a-f]{7}; the reviewer reads the base delta from there$/m);
  assert.match(gated.out, new RegExp(`^run ${quoted(intentReviewCall(tree))} first, then gate again$`, "m"));
  assert.doesNotMatch(gated.out, new RegExp(`send this back|${quoted(intentRecordCall(tree))}`));
}

/** The review call dispatches the delta from the recorded review, and the reviewer's proof for the opened criterion records clean. */
function closedByDelta(fixture, tree, gap, body) {
  const dispatched = run(fixture, ["review", "--tree", tree]);
  assert.equal(dispatched.code, 3, shown(dispatched));
  assert.match(dispatched.out, new RegExp(`^intent review owed for alpha: ${quoted(INTENT_REVIEW)}: verdict clean while ${quoted(gap)}\\.`, "m"));
  assert.match(dispatched.out, new RegExp(`^ {2}previous ${quoted(INTENT_REVIEW)}`, "m"), "a delta of the recorded review");
  write(tree, INTENT_REVIEW, body);
  const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-2"]);
  assert.equal(result.code, 0, shown(result));
  const gated = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gated.code, 0, shown(gated));
  return result;
}

test("a fold that rewrites the line an item's caught mutant broke owes the review, and its delta takes a mutant for the criterion", () => {
  const { fixture, tree } = foldOwed(undefined, { "src/a.ts": "export const a = 0 + 1;\nexport const a2 = 2;\n", "checks/one.expect": "src/a.ts 0 + 1\n" });
  const gap = 'a-one owes a caught mutant or a checked pin for criteria 1 "a reads one"';

  gatedAfterFold(fixture, tree, gap);

  const own = proposal("a-one:1", { find: "0 + 1", replace: "0 + 7" });
  const result = closedByDelta(fixture, tree, gap, `verdict: clean\nmutants:\n${own}`);
  assert.match(result.out, /mutants: 1 ran, 1 caught, 0 survived, 0 without a verdict/);
  assert.deepEqual(runs(fixture), ["checks/one.expect"]);
  assert.match(read(tree, INTENT_REVIEW), /criterion: a-one:1\n(?:.*\n){5} {4}caught: yes/);
});

test("a fold that rewrites the copy an item's checked pin read owes the review the same way", () => {
  const changed = "Gift cards expire after one year of rest.";
  const { fixture, tree } = foldOwed(`${withMutants(CAUGHT_ONE)}${PIN}`,
    { "src/notice.html": `<p>${changed}</p>\n`, "checks/notice.test.cjs": `says(['${changed}']);\n` });
  const gap = 'a-one owes a caught mutant or a checked pin for criteria 2 "a2 reads two"';

  gatedAfterFold(fixture, tree, gap);

  const pin = PIN.replace("criterion: 2\n    says: a2 reads two", "criterion: a-one:2").replace(SENTENCE, changed);
  closedByDelta(fixture, tree, gap, `verdict: clean\n${pin}`);
  assert.match(read(tree, INTENT_REVIEW), /pins:\n {2}- criterion: a-one:2\n/);
});

test("under review.outside a fold of a file the intent never changed keeps the review bound and owes a whole review for the gap", () => {
  const outside = GATED.replace("  model: model-review\n", '  model: model-review\n  outside: ["**"]\n');
  const { fixture, tree } = foldOwed(undefined, { "src/a.ts": "export const a = 0 + 1;\nexport const a2 = 2;\n", "checks/one.expect": "src/a.ts 0 + 1\n" },
    outside);
  const gap = 'a-one owes a caught mutant or a checked pin for criteria 1 "a reads one"';

  const gated = run(fixture, ["gate", "--tree", tree]);

  assert.equal(gated.code, 3, shown(gated));
  assert.doesNotMatch(gated.out, /the code changed since the review/);
  assert.match(gated.out, new RegExp(`^intent review owed: ${quoted(INTENT_REVIEW)}: verdict clean while ${quoted(gap)}\\. Propose one mutant`, "m"));
  assert.match(gated.out, new RegExp(`^run ${quoted(intentReviewCall(tree))} first, then gate again$`, "m"));
  const dispatched = run(fixture, ["review", "--tree", tree]);
  assert.equal(dispatched.code, 3, shown(dispatched));
  assert.doesNotMatch(dispatched.out, /^ {2}previous /m, "the recorded review binds the tree, so the reviewer reads the intent whole");
  write(tree, INTENT_REVIEW, `verdict: clean\nmutants:\n${proposal("a-one:1", { find: "0 + 1", replace: "0 + 7" })}`);
  const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-2"]);
  assert.equal(result.code, 0, shown(result));
  assert.equal(run(fixture, ["gate", "--tree", tree]).code, 0);
});

test("a recorded review refused for anything but a gap still goes back to its reviewer and its record", () => {
  const { fixture, tree } = foldOwed(undefined, { "docs/notes.md": "the notes of main\n" });
  write(tree, INTENT_REVIEW, `${read(tree, INTENT_REVIEW)}notes: read twice\n`);
  git(tree, ["commit", "-qam", "a note in the recorded review"]);

  const gated = run(fixture, ["gate", "--tree", tree]);

  assert.equal(gated.code, 3, shown(gated));
  assert.match(gated.out, new RegExp(`^intent review owed: ${quoted(INTENT_REVIEW)}: unknown key notes: .*send this back to the reviewer that wrote the file, ` +
    `then run ${quoted(intentRecordCall(tree))} to record it\\.$`, "m"));
  assert.match(gated.out, new RegExp(`^run ${quoted(intentRecordCall(tree))} first, then gate again$`, "m"));
});

test("a count that fails on a moved tree reads its own error, as before", () => {
  const { fixture, tree } = foldOwed(undefined, { "docs/notes.md": "the notes of main\n" });
  write(tree, ".specs-inferno/intents/alpha/work-items/a-one.md", itemSpec("a-one", A_ONE, [...A_EDITABLE, '""']));
  write(tree, "docs/b.md", "a-two moved on\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "an ownership entry that names no path"]);

  const gated = run(fixture, ["gate", "--tree", tree]);

  assert.equal(gated.code, 3, shown(gated));
  assert.match(gated.out, /^intent review owed: Ownership requires a path: item a-one lists `- ""` under ownership\.editable at /m);
  assert.doesNotMatch(gated.out, /undefined/);
});
