const assert = require("node:assert/strict");
const test = require("node:test");

const { git, run, write } = require("./review-fixture.cjs");
const {
  A_EDITABLE, CAUGHT_ONE, REVIEW, itemReview, itemSpec, mutantRepo, proposal, read, record, recordedByHand, runs, withMutants,
} = require("./run-review-mutants-fixture.cjs");
const { parseItemReview } = require("./run-review-file.cjs");
const { itemProofs, mutantGaps } = require("./run-mutant-coverage.cjs");
const { criteriaLines, saysProblem } = require("./run-criterion-says.cjs");

// A first item review names each mutant and pin by its criterion's number and repeats that
// criterion's opening words under `says`. The dispatch prints the numbered criteria, so nobody
// counts lines, and the record compares the words with the criterion at the number written: a
// review numbered in order past a skipped criterion is refused, naming the number whose text does
// open with those words. A review recorded before the key existed still reads as it did.

const SPEC = ".specs-inferno/intents/alpha/work-items/a-one.md";
const THREE = ["a reads one", "the **gift card** page shows its balance", "a2 reads two"];
const shown = (result) => result.out + result.err;
const ledger = (fixture) => read(fixture.root, ".specs-inferno/state.yaml");

/** a-one with three criteria, the second without a mutant of its own in the reviews below. */
function threeCriteria() {
  const fixture = mutantRepo();
  write(fixture.root, SPEC, itemSpec("a-one", THREE, [...A_EDITABLE, "checks/a2.expect"]));
  git(fixture.root, ["commit", "-qam", "a third criterion"]);
  return fixture;
}

const ONE = proposal(1, { says: "a reads one" });
/** The mutant whose line breaks criterion 3, numbered as written. */
const twoBreaks = (criterion) => proposal(criterion, { line: 2, find: "a2 = 2", replace: "a2 = 8", expect: "checks/a2.expect", says: "a2 reads two" });

function refused(fixture, body, pattern) {
  const before = ledger(fixture);
  write(fixture.root, REVIEW, body);
  const result = record(fixture);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, pattern);
  assert.equal(ledger(fixture), before, "nothing is recorded");
  assert.deepEqual(runs(fixture), [], "a refused review runs no mutant");
  return result;
}

test("the dispatch of a first item review prints every criterion with its number and opening words", () => {
  const fixture = threeCriteria();
  const result = run(fixture, ["review", "--item", "a-one", "--tree", fixture.root]);
  assert.equal(result.code, 3, shown(result));
  assert.match(result.out, /^ {2}criteria: each mutant and pin names one by its number below and repeats under says the words shown beside it$/m);
  assert.match(result.out, /^ {2}criterion 1 says "a reads one"\n {2}criterion 2 says "the \*\*gift card\*\* page shows its"\n {2}criterion 3 says "a2 reads two"$/m);
});

test("a review numbered in order past a skipped criterion is refused, and the message names the right number", () => {
  const fixture = threeCriteria();
  const result = refused(fixture, withMutants(ONE, twoBreaks(2)),
    /BAD_REVIEW.*mutants entry 2 names criterion 2, and its says is how criterion 3 opens: name it 3 when that is the criterion it proves/);
  assert.doesNotMatch(result.err, /gift card/, "the refusal never prints the words of the number written");
});

test("a review whose numbers and words agree records as today", () => {
  const fixture = threeCriteria();
  write(fixture.root, REVIEW, withMutants(ONE, twoBreaks(3)));
  const result = record(fixture);
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/a2.expect"]);
  assert.match(result.out, /mutants: 2 ran, 2 caught, 0 survived/);
  const recorded = parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true });
  assert.deepEqual(recorded.mutants.map((m) => [m.criterion, m.says, m.caught]), [["1", "a reads one", "yes"], ["3", "a2 reads two", "yes"]]);
  assert.deepEqual(mutantGaps(itemProofs(fixture.root, "alpha", ["a-one"]), []),
    ['a-one owes a caught mutant or a checked pin for criteria 2 "the **gift card** page shows its balance"']);
});

test("a first item review's entry without says is refused, and the refusal names no criterion's words", () => {
  const fixture = threeCriteria();
  const result = refused(fixture, withMutants(ONE, proposal(3, { line: 2, find: "a2 = 2", replace: "a2 = 8", says: null })),
    /BAD_REVIEW.*mutants entry 2 has no says: repeat the opening words of the criterion it names, as the dispatch shows them/);
  assert.doesNotMatch(result.err, /a2 reads two/);
});

test("a pin of a first item review repeats its criterion's words the same way", () => {
  const fixture = mutantRepo({ files: { "src/notice.html": "<p>Gift cards never expire at all.</p>\n", "checks/notice.test.cjs": "says('Gift cards never expire at all.');\n" } });
  const pin = (says) => `pins:\n  - criterion: 2\n${says ? `    says: ${says}\n` : ""}    file: src/notice.html\n    test: checks/notice.test.cjs\n` +
    '    text: "Gift cards never expire at all."\n';
  refused(fixture, `${withMutants(ONE)}${pin("a reads one")}`, /BAD_REVIEW.*pins entry 1 names criterion 2, and its says is how criterion 1 opens: name it 1/);
  refused(fixture, `${withMutants(ONE)}${pin(null)}`, /BAD_REVIEW.*pins entry 1 has no says/);
  write(fixture.root, REVIEW, `${withMutants(ONE)}${pin("A2 reads two")}`);
  const result = record(fixture);
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true }).pins.map((p) => [p.criterion, p.says]), [["2", "A2 reads two"]]);
});

test("says forgives case, blanks, punctuation and markdown marks, and holds to the criterion's own opening", () => {
  const criteria = ["The **total** shows the fee, rounded to cents", "The total shows the [refund](docs/refund.md) line", "Card balance"];
  for (const said of ["the total shows the fee", "THE  `total`   shows the fee,", "the total, shows: the fee rounded to cents."]) {
    assert.equal(saysProblem("a-one", criteria, 1, said), null, said);
  }
  assert.equal(saysProblem("a-one", criteria, 2, "the total shows the refund line"), null, "a link reads as its text");
  assert.equal(saysProblem("a-one", criteria, 3, "card balance"), null, "a criterion shorter than the minimum is repeated whole");
  assert.match(saysProblem("a-one", criteria, 1, "the total shows"), /says opens criteria 1 and 2 alike; repeat more of the words of criterion 1/);
  assert.match(saysProblem("a-one", criteria, 1, "the total shows the refund"), /names criterion 1, and its says is how criterion 2 opens: name it 2/);
  assert.match(saysProblem("a-one", criteria, 3, "card"), /says holds 1 word; repeat at least 2 of the criterion's opening words/);
  assert.match(saysProblem("a-one", criteria, 1, "the fee is rounded"), /no acceptance criterion of a-one opens with those words/);
  assert.match(saysProblem("a-one", criteria, 1, "**"), /says holds no word/);
  assert.deepEqual(criteriaLines(criteria).slice(1), [
    '  criterion 1 says "The **total** shows the fee, rounded"',
    '  criterion 2 says "The total shows the [refund](docs/refund.md) line"',
    '  criterion 3 says "Card balance"',
  ]);
  assert.deepEqual(criteriaLines([]), []);
  // Two criteria alike past the first six words each show as many as tell them apart.
  assert.deepEqual(criteriaLines(["the card page shows the balance in cents", "the card page shows the balance in euros", "a short one"]).slice(1), [
    '  criterion 1 says "the card page shows the balance in cents"',
    '  criterion 2 says "the card page shows the balance in euros"',
    '  criterion 3 says "a short one"',
  ]);
});

// A review the released flow recorded holds no says, and a delta review carries its entries.
const RECORDED = `item: a-one
verdict: clean
files: [src/a.ts]
findings: []
mutants:
  - criterion: 1
    file: src/a.ts
    line: 1
    find: "a = 1"
    replace: "a = 7"
    test: node checks/has.cjs checks/one.expect ../runs.log
    caught: yes
`;

test("a recorded review without says still parses and reads as before, and its delta records without one", () => {
  const fixture = mutantRepo();
  recordedByHand(fixture.root, RECORDED);
  const recorded = parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true });
  assert.deepEqual(recorded.mutants.map((m) => [m.criterion, m.caught, m.says]), [["1", "yes", undefined]]);
  assert.deepEqual(mutantGaps(itemProofs(fixture.root, "alpha", ["a-one"]), []), ['a-one owes a caught mutant or a checked pin for criteria 2 "a2 reads two"']);

  write(fixture.root, "src/a.ts", "export const a = 1;\nexport const a2 = 2; // two\n");
  git(fixture.root, ["commit", "-qam", "a fix"]);
  const owed = run(fixture, ["review", "--item", "a-one", "--tree", fixture.root]);
  assert.equal(owed.code, 3, shown(owed));
  assert.doesNotMatch(owed.out, /criterion 1 says/, "a delta review is shown no criteria to number");
  write(fixture.root, REVIEW, itemReview(`mutants:\n${CAUGHT_ONE.replace(/ {4}says: .*\n/, "")}`));
  const delta = record(fixture);
  assert.equal(delta.code, 0, shown(delta));
  assert.deepEqual(parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true }).mutants.map((m) => [m.criterion, m.caught, m.says]),
    [["1", "yes", undefined]]);
});
