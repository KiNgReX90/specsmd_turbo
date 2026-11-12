const assert = require("node:assert/strict");
const test = require("node:test");

const { INTENT_TREE, git, run, worktree, write } = require("./review-fixture.cjs");
const {
  A_EDITABLE, INTENT_REVIEW, REVIEW, itemSpec, mutantRepo, proposal, read, record, recordedByHand, runs, withMutants,
} = require("./run-review-mutants-fixture.cjs");
const { itemProofs, mutantGaps } = require("./run-mutant-coverage.cjs");
const { parseYaml } = require("./run-lib.cjs");

// A review recorded before its entries repeated their criterion's words may credit a mutant to the
// wrong criterion: its reviewer numbered them in the order it wrote them. The intent review moves
// such a mutant to the criterion it breaks, under `moved`, as `{from: <item>:<n as recorded>,
// criterion: <item>:<the one it breaks>, says: <that criterion's opening words>}`. The criterion it
// leaves is owed again and takes a proposal in the same file; the one it moves to is held. Every
// later record carries the move over.

const SPEC = ".specs-inferno/intents/alpha/work-items/a-one.md";
const SCAN = ".specs-inferno/intents/alpha/scan.yaml";
const THREE = ["a reads one", "the gift card page shows its balance", "a2 reads two"];
const shown = (result) => result.out + result.err;

/** A mutant the released flow recorded under `criterion`, its own `caught` as given (none: it never ran). */
const released = (criterion, { line, find, replace, expect, caught }) =>
  `  - criterion: ${criterion}\n    file: src/a.ts\n    line: ${line}\n    find: "${find}"\n    replace: "${replace}"\n` +
  `    test: node checks/has.cjs ${expect} ../runs.log\n${caught ? `    caught: ${caught}\n` : ""}`;
const ONE = { line: 1, find: "a = 1", replace: "a = 7", expect: "checks/one.expect" };
const BREAKS_THREE = { line: 2, find: "a2 = 2", replace: "a2 = 8", expect: "checks/a2.expect" };
/** Numbered in order: its second entry breaks criterion 3. */
const inOrder = (caught) => `item: a-one\nverdict: clean\nfiles: [src/a.ts]\nfindings: []\nmutants:\n` +
  `${released(1, { ...ONE, caught })}${released(2, { ...BREAKS_THREE, caught })}`;

const CARD = proposal("a-one:2", { file: "src/card.ts", find: "balance", replace: "nothing", expect: "checks/card.expect" });
const move = (from, criterion, says) => `moved:\n  - from: ${from}\n    criterion: ${criterion}\n    says: ${says}\n`;
const MOVE = move("a-one:2", "a-one:3", "A2 reads two");
const FINDING = "findings:\n  - criterion: a-one:3\n    file: src/a.ts\n    line: 2\n    evidence: read it\n    fix: test it\n" +
  "    severity: minor\n    owner: a-one\n";

/** The intent worktree: a-one with three criteria and a line per criterion, its review recorded as `body`. */
function intentTree(body) {
  const fixture = mutantRepo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/card.ts", 'export const card = "balance";\n');
  write(tree, "checks/card.expect", "src/card.ts balance\n");
  write(tree, SPEC, itemSpec("a-one", THREE, [...A_EDITABLE, "checks/a2.expect", "src/card.ts", "checks/card.expect"]));
  write(tree, SCAN, "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "three criteria and the scan"]);
  if (body) recordedByHand(tree, body);
  return { fixture, tree };
}

/** Dispatch the intent review, write what its reviewer wrote, and record it. */
function intentReview(fixture, tree, body) {
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, body);
  return run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
}

const intentDoc = (tree) => parseYaml(read(tree, INTENT_REVIEW));
const gaps = (tree) => {
  const doc = intentDoc(tree);
  return mutantGaps(itemProofs(tree, "alpha", ["a-one"]), doc.mutants || [], doc.pins || []);
};

test("a criterion held by a mutant that breaks another refuses a proposal, and the refusal says how to move it", () => {
  const { fixture, tree } = intentTree(inOrder("yes"));
  assert.deepEqual(mutantGaps(itemProofs(tree, "alpha", ["a-one"]), []), ['a-one owes a caught mutant or a checked pin for criteria 3 "a2 reads two"']);
  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${CARD}`);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /mutants proposes one for a-one:2, which has a mutant its item review caught; propose only for a criterion still without one/);
  assert.match(result.err, /under moved write from: <item>:<n as its item review recorded it>, criterion: <item>:<the n it breaks>, says: <that criterion's opening words>/);
  assert.deepEqual(runs(fixture), []);
});

test("after a move the criterion left behind takes a proposal, and the one moved to is no longer owed", () => {
  const { fixture, tree } = intentTree(inOrder("yes"));
  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${CARD}${MOVE}`);
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/card.expect"], "only the left criterion's own proposal ran");
  assert.deepEqual(intentDoc(tree).moved, [{ from: "a-one:2", criterion: "a-one:3", says: "A2 reads two" }]);
  assert.deepEqual(gaps(tree), []);
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 0, "the recorded intent review stands, its move counted");
});

test("without the left criterion's proposal a clean review is refused for it, not for the one moved to", () => {
  const { fixture, tree } = intentTree(inOrder("yes"));
  const result = intentReview(fixture, tree, `verdict: clean\n${MOVE}`);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /a-one owes a caught mutant or a checked pin for criteria 2 "the gift card page shows its balance"\./);
});

test("a move is checked against the words of the criterion it names, and must move a mutant its item review recorded", () => {
  const { fixture, tree } = intentTree(inOrder("yes"));
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  for (const [entry, pattern] of [
    [move("a-one:2", "a-one:1", "a2 reads two"), /moved entry 1 names criterion 1, and its says is how criterion 3 opens: name it 3/],
    [move("a-one:3", "a-one:2", "the gift card page"), /moved entry 1 moves a-one:3, and the review of a-one recorded no mutant under 3/],
    [move("a-one:2", "a-one:2", "the gift card page"), /moved entry 1 moves a-one:2 to itself/],
    [move("a-one:2", "a-two:1", "a2 reads two"), /moved entry 1 moves a mutant of a-one to a-two; a mutant moves within its item/],
    [move("a-one:2", "a-one:9", "a2 reads two"), /moved entry 1 names criterion 9, and a-one has 3 acceptance criteria/],
    [move("2", "a-one:3", "a2 reads two"), /moved entry 1 from reads 2; name it <item>:<n>/],
    [`${MOVE}  - from: a-one:2\n    criterion: a-one:1\n    says: a reads one\n`, /moved holds a-one:2 twice; move a mutant once/],
  ]) {
    write(tree, INTENT_REVIEW, `verdict: clean\nmutants:\n${CARD}${entry}`);
    const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
    assert.equal(result.code, 2, shown(result));
    assert.match(result.err, pattern);
    assert.deepEqual(runs(fixture), []);
  }
});

test("a mutant whose words were checked when its item review recorded it is not moved", () => {
  const { fixture, tree } = intentTree();
  write(tree, REVIEW, withMutants(proposal(1), proposal(3, { ...BREAKS_THREE, says: "a2 reads two" })));
  assert.equal(record(fixture, [], tree).code, 0);
  runs(fixture);
  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${CARD}${move("a-one:3", "a-one:1", "a reads one")}`);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /moved entry 1 moves a-one:3, whose words the review of a-one checked when it recorded it/);
});

test("a move leaves an entry whose words were checked under its number, beside one without them under the same number", () => {
  const card = released(3, { line: 1, find: "balance", replace: "nothing", expect: "checks/card.expect", caught: "yes" }).replace("src/a.ts", "src/card.ts");
  const said = released(3, { ...BREAKS_THREE, caught: "yes" }).replace("criterion: 3\n", "criterion: 3\n    says: a2 reads two\n");
  const { fixture, tree } = intentTree(`item: a-one\nverdict: clean\nfiles: [src/a.ts]\nfindings: []\nmutants:\n${released(1, { ...ONE, caught: "yes" })}${card}${said}`);
  const result = intentReview(fixture, tree, `verdict: clean\n${move("a-one:3", "a-one:2", "the gift card page shows its")}`);
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), []);
  assert.deepEqual(gaps(tree), [], "criterion 3 keeps its checked entry, criterion 2 takes the moved one");
});

test("an intent proposal or pin that repeats its criterion's words is held to them", () => {
  const { fixture, tree } = intentTree(inOrder("yes"));
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  const wrong = proposal("a-one:2", { file: "src/card.ts", find: "balance", replace: "nothing", expect: "checks/card.expect", says: "a2 reads two" });
  const pin = "pins:\n  - criterion: a-one:2\n    says: a2 reads two\n    file: src/card.ts\n    test: checks/card.expect\n" +
    "    text: \"the card shows its balance\"\n";
  for (const [body, pattern] of [
    [`verdict: clean\nmutants:\n${wrong}${MOVE}`, /mutants entry 1 names criterion 2, and its says is how criterion 3 opens: name it 3/],
    [`verdict: clean\n${pin}${MOVE}`, /pins entry 1 names criterion 2, and its says is how criterion 3 opens: name it 3/],
  ]) {
    write(tree, INTENT_REVIEW, body);
    const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
    assert.equal(result.code, 2, shown(result));
    assert.match(result.err, pattern);
    assert.deepEqual(runs(fixture), []);
  }
  write(tree, INTENT_REVIEW, `verdict: clean\nmutants:\n${CARD.replace("criterion: a-one:2\n", "criterion: a-one:2\n    says: The Gift card page\n")}${MOVE}`);
  const right = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
  assert.equal(right.code, 0, shown(right));
});

test("an item proposal that never ran is placed under the criterion it was moved to", () => {
  const { fixture, tree } = intentTree(inOrder(null));
  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${CARD}${MOVE}`);
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture).sort(), ["checks/a2.expect", "checks/card.expect", "checks/one.expect"]);
  const entries = intentDoc(tree).mutants.map((entry) => [entry.criterion, entry.find, entry.caught]);
  assert.deepEqual(entries.sort(), [["a-one:1", "a = 1", "yes"], ["a-one:2", "balance", "yes"], ["a-one:3", "a2 = 2", "yes"]]);
  assert.deepEqual(gaps(tree), []);
});

test("a mutant an earlier intent review ran under the wrong number is moved, and the move is carried into the next review", () => {
  const { fixture, tree } = intentTree(inOrder(null));
  const first = intentReview(fixture, tree, `verdict: fix\n${FINDING}`);
  assert.equal(first.code, 2, shown(first));
  assert.match(read(tree, INTENT_REVIEW), /criterion: a-one:2\n(?:.*\n){5}    caught: yes/);
  runs(fixture);

  write(tree, "docs/notes.md", "the fix\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a fix"]);
  const moved = intentReview(fixture, tree, `verdict: clean\nmutants:\n${CARD}${MOVE}`);
  assert.equal(moved.code, 0, shown(moved));
  assert.deepEqual(runs(fixture), ["checks/card.expect"], "what ran before is carried, under the number it moved to");
  const entries = intentDoc(tree).mutants.map((entry) => [entry.criterion, entry.find]);
  assert.deepEqual(entries.sort(), [["a-one:1", "a = 1"], ["a-one:2", "balance"], ["a-one:3", "a2 = 2"]]);

  write(tree, "docs/notes.md", "another fix\n");
  git(tree, ["commit", "-qam", "another fix"]);
  const next = intentReview(fixture, tree, "verdict: clean\n");
  assert.equal(next.code, 0, shown(next));
  assert.deepEqual(intentDoc(tree).moved, [{ from: "a-one:2", criterion: "a-one:3", says: "A2 reads two" }], "the runner carried the move");
  assert.deepEqual(gaps(tree), []);
});
