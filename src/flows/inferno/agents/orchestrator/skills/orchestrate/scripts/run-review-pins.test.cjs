'use strict';

// A criterion whose test pins reader-facing copy verbatim is held by a pin the reviewer read,
// not by a mutant: a mutant of that copy only asks a question the test file answers. The review
// lists it under `pins` as {criterion, file, test, text}, and the runner checks it when it records
// the file: the text, of at least four words, stands verbatim in the product file and in the test,
// the product file is no test file, and the test is a test file or a test path of the item. A
// checked pin counts where a caught mutant does, in the item review or the intent review.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { INTENT_TREE, git, run, worktree, write } = require('./review-fixture.cjs');
const { CAUGHT_ONE, INTENT_REVIEW, REVIEW, itemSpec, A_ONE, A_EDITABLE, mutantRepo, read, record, runs, withMutants } =
  require('./run-review-mutants-fixture.cjs');
const { parseItemReview } = require('./run-review-file.cjs');
const { itemProofs, mutantGaps } = require('./run-mutant-coverage.cjs');

const SENTENCE = 'Gift cards never expire and keep their full value.';
const COPY = {
  // The page wraps the sentence across two lines; the test holds it on one.
  'src/notice.html': '<p>Gift cards never expire and\n  keep their full value.</p>\n',
  'checks/notice.test.cjs': `says(['${SENTENCE}']);\n`,
  'checks/copy-check.cjs': `says(['${SENTENCE}']);\n`,
};
const SCAN = '.specs-inferno/intents/alpha/scan.yaml';
const shown = (result) => result.out + result.err;

/** A pin as a reviewer writes it; an item review's repeats its criterion's opening words under says. */
function pin(criterion, { file = 'src/notice.html', test: pinTest = 'checks/notice.test.cjs', text = SENTENCE } = {}) {
  const says = A_ONE[Number(criterion) - 1];
  return `  - criterion: ${criterion}\n${says ? `    says: ${says}\n` : ''}    file: ${file}\n    test: ${pinTest}\n    text: "${text}"\n`;
}

/** Criterion 1 by a mutant its test catches, criterion 2 by a pin. */
const withPins = (...pins) => `${withMutants(CAUGHT_ONE)}pins:\n${pins.join('')}`;

function pinRepo() {
  return mutantRepo({ files: COPY });
}

test('a criterion held by a checked pin owes no mutant: the item review records clean and keeps the pin', () => {
  const fixture = pinRepo();
  write(fixture.root, REVIEW, withPins(pin(2)));
  const result = record(fixture);
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ['checks/one.expect'], 'only the mutant ran; the pin was read');
  const review = parseItemReview(fixture.root, REVIEW, 'a-one', { recorded: true });
  assert.deepEqual(review.pins, [{ criterion: '2', says: 'a2 reads two', file: 'src/notice.html', test: 'checks/notice.test.cjs', text: SENTENCE }]);
  assert.deepEqual(mutantGaps(itemProofs(fixture.root, 'alpha', ['a-one']), []), []);
});

test('a criterion with neither a caught mutant nor a checked pin is still a gap', () => {
  const fixture = pinRepo();
  write(fixture.root, REVIEW, withMutants(CAUGHT_ONE));
  assert.equal(record(fixture).code, 0);
  assert.deepEqual(mutantGaps(itemProofs(fixture.root, 'alpha', ['a-one']), []),
    ['a-one owes a caught mutant or a checked pin for criteria 2 "a2 reads two"']);
  // The intent review's own pin closes it.
  const pins = [{ criterion: 'a-one:2', file: 'src/notice.html', test: 'checks/notice.test.cjs', text: SENTENCE }];
  assert.deepEqual(mutantGaps(itemProofs(fixture.root, 'alpha', ['a-one']), [], pins), []);
});

test('the runner refuses a pin it cannot check, before any mutant runs', () => {
  const fixture = pinRepo();
  for (const [entry, pattern] of [
    [pin(2, { text: 'Gift cards always expire and keep their full value.' }),
      /pins entry 1 text does not stand verbatim in src\/notice\.html/],
    [pin(2, { file: 'src/a.ts', text: 'a2 = 2;' }), /pins entry 1 text holds 1 word/],
    [pin(2, { test: 'checks/two.expect' }),
      /pins entry 1 names checks\/two\.expect as its test, and that is no test file and no test path of a-one/],
    [pin(2, { file: 'src/missing.html' }), /pins entry 1 names src\/missing\.html, which is not in the tree/],
    [pin(2, { file: 'checks/notice.test.cjs' }), /pins entry 1 names checks\/notice\.test\.cjs as the product file, and that is a test file/],
    [pin(2, { text: 'Gift cards never' }), /pins entry 1 text holds 3 words/],
    [pin('AC2'), /pins entry 1 criterion reads AC2; name the acceptance criterion by its number alone/],
    [pin(2, { file: '.specs-inferno/state.yaml' }), /pins entry 1 names \.specs-inferno\/state\.yaml; a pin reads the code, never the ledger/],
  ]) {
    write(fixture.root, REVIEW, withPins(entry));
    const result = record(fixture);
    assert.equal(result.code, 2, `${entry}\n${shown(result)}`);
    assert.match(result.err, pattern, entry);
    assert.deepEqual(runs(fixture), [], entry);
  }
});

test('a pin whose text is in the product file but not in its test is refused', () => {
  const fixture = pinRepo();
  write(fixture.root, 'checks/notice.test.cjs', "says(['Gift cards never expire.']);\n");
  git(fixture.root, ['commit', '-qam', 'the test pins less']);
  write(fixture.root, REVIEW, withPins(pin(2)));
  const result = record(fixture);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /pins entry 1 text does not stand verbatim in checks\/notice\.test\.cjs/);
});

test('the floor counts only words that hold a letter, so a count or a computed value keeps its mutant', () => {
  const fixture = pinRepo();
  write(fixture.root, 'src/notice.html', '<p>Total 12 00 of 40 99</p>\n');
  write(fixture.root, 'checks/notice.test.cjs', "says(['Total 12 00 of 40 99']);\n");
  git(fixture.root, ['commit', '-qam', 'a computed total']);
  write(fixture.root, REVIEW, withPins(pin(2, { text: 'Total 12 00 of 40 99' })));
  const result = record(fixture);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /pins entry 1 text holds 2 words; a pin holds reader-facing copy of at least 4, and a pattern, a count or a computed value keeps its mutant/);
});

test("a test the item's manifest names counts as the pin's test whatever its file name", () => {
  const fixture = pinRepo();
  const spec = itemSpec('a-one', A_ONE, A_EDITABLE)
    .replace('    - path: checks/has.cjs\n      reason: proof\n', '    - path: checks/has.cjs\n      reason: proof\n    - path: checks/copy-check.cjs\n      reason: copy\n');
  write(fixture.root, '.specs-inferno/intents/alpha/work-items/a-one.md', spec);
  git(fixture.root, ['commit', '-qam', 'the copy check is a test path']);
  write(fixture.root, REVIEW, withPins(pin(2, { test: 'checks/copy-check.cjs' })));
  const result = record(fixture);
  assert.equal(result.code, 0, shown(result));
});

test('a delta review carries the pins over, refuses a new one, and drops one whose copy moved away', () => {
  const fixture = pinRepo();
  write(fixture.root, REVIEW, itemReview(`findings:\n  - criterion: AC1\n    file: src/a.ts\n    line: 1\n    evidence: read it\n` +
    `    fix: name it\n    severity: minor\nmutants:\n${CAUGHT_ONE}pins:\n${pin(2)}`, 'fix'));
  assert.equal(record(fixture).code, 2);
  runs(fixture);

  write(fixture.root, 'src/a.ts', 'export const a = 1; // named\nexport const a2 = 2;\n');
  git(fixture.root, ['commit', '-qam', 'the fix']);
  write(fixture.root, REVIEW, itemReview(`pins:\n${pin(1, { text: 'keep their full value. Gift' })}`));
  const refused = record(fixture);
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, /pins entry 1 is new: a delta review writes no pin/);

  write(fixture.root, REVIEW, itemReview(''));
  const carried = record(fixture);
  assert.equal(carried.code, 0, shown(carried));
  assert.match(read(fixture.root, REVIEW), /pins:\n {2}- criterion: 2\n {4}says: a2 reads two\n {4}file: src\/notice\.html\n/);

  write(fixture.root, 'src/a.ts', 'export const a = 1; // named twice\nexport const a2 = 2;\n');
  write(fixture.root, 'src/notice.html', '<p>Gift cards expire after a year.</p>\n');
  git(fixture.root, ['commit', '-qam', 'the copy changed']);
  write(fixture.root, REVIEW, itemReview(''));
  const dropped = record(fixture);
  assert.equal(dropped.code, 0, shown(dropped));
  assert.match(dropped.out, /^PIN 2 no longer holds: text does not stand verbatim in src\/notice\.html, so the intent review owes criterion 2 a caught mutant or a checked pin$/m);
  assert.doesNotMatch(read(fixture.root, REVIEW), /^pins:/m);
});

test('a delta review over a review that held only a pin writes the carried pin back', (t) => {
  const fixture = pinRepo();
  write(fixture.root, REVIEW, itemReview(`findings:\n  - criterion: AC1\n    file: src/a.ts\n    line: 1\n    evidence: read it\n` +
    `    fix: name it\n    severity: minor\npins:\n${pin(2)}`, 'fix'));
  assert.equal(record(fixture).code, 2);
  write(fixture.root, 'src/a.ts', 'export const a = 1; // named\nexport const a2 = 2;\n');
  git(fixture.root, ['commit', '-qam', 'the fix']);
  write(fixture.root, REVIEW, itemReview(''));
  const carried = record(fixture);
  assert.equal(carried.code, 0, shown(carried));
  assert.deepEqual(runs(fixture), []);
  assert.match(read(fixture.root, REVIEW), /pins:\n {2}- criterion: 2\n/);
});

function intentTree() {
  const fixture = pinRepo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, SCAN, 'lines: []\n');
  git(tree, ['add', '-A']);
  git(tree, ['commit', '-qm', 'scan']);
  return { fixture, tree };
}

function intentReview(fixture, tree, body) {
  assert.equal(run(fixture, ['review', '--tree', tree]).code, 3);
  write(tree, INTENT_REVIEW, body);
  return run(fixture, ['review', '--tree', tree, '--reviewer', 'rev-1']);
}

test("an item review's checked pin counts at the intent review, and stops counting once its copy changed", () => {
  const { fixture, tree } = intentTree();
  write(tree, REVIEW, withPins(pin(2)));
  assert.equal(record(fixture, [], tree).code, 0);
  write(tree, 'src/notice.html', '<p>Gift cards expire after a year.</p>\n');
  git(tree, ['commit', '-qam', 'the copy changed after its review']);
  const refused = intentReview(fixture, tree, 'verdict: clean\n');
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, /a-one owes a caught mutant or a checked pin for criteria 2 "a2 reads two"/);

  fs.rmSync(path.join(tree, INTENT_REVIEW));
  write(tree, 'src/notice.html', COPY['src/notice.html']);
  git(tree, ['commit', '-qam', 'the copy is back']);
  const clean = intentReview(fixture, tree, 'verdict: clean\n');
  assert.equal(clean.code, 0, shown(clean));
});

test('the intent review closes a criterion with a pin of its own, checked the same way', () => {
  const { fixture, tree } = intentTree();
  write(tree, REVIEW, withMutants(CAUGHT_ONE));
  assert.equal(record(fixture, [], tree).code, 0);
  runs(fixture);

  const refused = intentReview(fixture, tree, 'verdict: clean\n');
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, /a-one owes a caught mutant or a checked pin for criteria 2 "a2 reads two"\. Propose one mutant for each under mutants, its criterion written <item>:<n>, or a pin under pins where its test pins reader-facing copy verbatim/);

  write(tree, INTENT_REVIEW, `verdict: clean\npins:\n${pin('a-one:2', { text: 'Gift cards never expire and keep their whole value.' })}`);
  const wrong = run(fixture, ['review', '--tree', tree, '--reviewer', 'rev-1']);
  assert.equal(wrong.code, 2, shown(wrong));
  assert.match(wrong.err, /pins entry 1 text does not stand verbatim in src\/notice\.html/);
  write(tree, INTENT_REVIEW, `verdict: clean\npins:\n${pin('2')}`);
  const unnamed = run(fixture, ['review', '--tree', tree, '--reviewer', 'rev-1']);
  assert.equal(unnamed.code, 2, shown(unnamed));
  assert.match(unnamed.err, /pins entry 1 criterion reads 2; name it <item>:<n>/);

  // Its test is a test path of a-one's manifest, whatever its file name.
  const spec = itemSpec('a-one', A_ONE, A_EDITABLE)
    .replace('    - path: checks/has.cjs\n      reason: proof\n', '    - path: checks/has.cjs\n      reason: proof\n    - path: checks/copy-check.cjs\n      reason: copy\n');
  fs.rmSync(path.join(tree, INTENT_REVIEW));
  write(tree, '.specs-inferno/intents/alpha/work-items/a-one.md', spec);
  git(tree, ['commit', '-qam', 'the copy check is a test path']);
  const recorded = intentReview(fixture, tree, `verdict: clean\npins:\n${pin('a-one:2', { test: 'checks/copy-check.cjs' })}`);
  assert.equal(recorded.code, 0, shown(recorded));
  assert.deepEqual(runs(fixture), []);
  assert.match(read(tree, INTENT_REVIEW), /pins:\n {2}- criterion: a-one:2\n/);

  // The next intent review carries the pin while it stands, and drops it once the copy changed.
  write(tree, 'docs/b.md', 'a-two moved on\n');
  git(tree, ['commit', '-qam', 'a later change']);
  const carried = intentReview(fixture, tree, 'verdict: clean\n');
  assert.equal(carried.code, 0, shown(carried));
  assert.match(read(tree, INTENT_REVIEW), /pins:\n {2}- criterion: a-one:2\n/);
  write(tree, 'src/notice.html', '<p>Gift cards expire after a year.</p>\n');
  git(tree, ['commit', '-qam', 'the copy changed']);
  const dropped = intentReview(fixture, tree, 'verdict: clean\n');
  assert.equal(dropped.code, 2, shown(dropped));
  assert.match(dropped.err, /a-one owes a caught mutant or a checked pin for criteria 2/);
});

/** An item review body over a-one's files. */
function itemReview(body, verdict = 'clean') {
  return `item: a-one\nverdict: ${verdict}\nfiles: [src/a.ts, checks/one.expect, checks/two.expect]\n${body}`;
}
