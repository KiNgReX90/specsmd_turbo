'use strict';

// verify-item after the intent folded the base in: the base's lines and bytes are the base's.

const assert = require('node:assert/strict');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');

const TESTS = 'src/gift_cards/tests/balance.rs';
const IGNORE = '#[ignore = "regenerates the golden files only"]';

/** A Rust test file of the named tests, each switched off with `IGNORE` for `true` or with the line given. */
const rust = (...tests) => tests.map(([name, ignore]) => `${ignore ? `${ignore === true ? IGNORE : ignore}\n` : ''}#[test]\nfn ${name}() {\n    assert_eq!(1, 1);\n}\n`).join('\n');

/** An intent whose item `a` owns the Rust test file, which the base and the intent both hold already. */
function rustIntent(t) {
  const f = fixture(t, { a: [TESTS] });
  f.moveBase(TESTS, rust(['starts_at_zero'], ['grows_on_top_up'], ['shrinks_on_spend']));
  f.git('merge', '-q', '--ff-only', 'main');
  return f;
}

/** Item `a` adds a test at the end of the file and lands; the base then switches one test off and the intent folds. */
function foldedRustIntent(t) {
  const f = rustIntent(t);
  const dispatch = f.start('--item', 'a');
  f.write(TESTS, rust(['starts_at_zero'], ['grows_on_top_up'], ['shrinks_on_spend'], ['expires_after_a_year']));
  f.accepted(dispatch, [TESTS]);
  f.land(TESTS);
  f.moveBase(TESTS, rust(['starts_at_zero'], ['grows_on_top_up', true], ['shrinks_on_spend']));
  f.git('merge', '-q', '--no-edit', 'main');
  return f;
}

test('a test the base switched off in a file the item also edits is the base\'s after the fold', (t) => {
  const f = foldedRustIntent(t);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.tests_changed.switched_off, []);
  assert.deepEqual(result.data.tests_changed.modified, [TESTS]);
});

test('the item switching a test off after the fold, with the base\'s own words, is still refused', (t) => {
  const f = foldedRustIntent(t);
  const fix = f.start('--item', 'a');
  f.write(TESTS, rust(['starts_at_zero', true], ['grows_on_top_up', true], ['shrinks_on_spend'], ['expires_after_a_year']));
  f.accepted(fix, [TESTS]);
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.tests_changed.switched_off, [{ file: TESTS, line: 1, text: IGNORE }]);
});

for (const [how, own] of [
  ['rewrites the base\'s switch-off line with another reason', '#[ignore = "too slow on the build machine"]'],
  ['deletes the base\'s switch-off line and writes one of its own kind in its place', '#[cfg_attr(not(feature = "goldens"), ignore)]'],
]) {
  test(`the item that ${how} after the fold is refused at that line as the item's`, (t) => {
    const f = foldedRustIntent(t);
    const fix = f.start('--item', 'a');
    f.write(TESTS, rust(['starts_at_zero'], ['grows_on_top_up', own], ['shrinks_on_spend'], ['expires_after_a_year']));
    f.accepted(fix, [TESTS]);
    const result = f.verify('a');
    assert.equal(result.code, 2, result.out);
    assert.deepEqual(result.data.tests_changed.switched_off, [{ file: TESTS, line: 6, text: own }]);
  });
}

test('the base\'s lines of two folds are both the base\'s, and the item\'s line between them is the item\'s', (t) => {
  const f = rustIntent(t);
  const first = f.start('--item', 'a');
  f.write(TESTS, rust(['starts_at_zero'], ['grows_on_top_up'], ['shrinks_on_spend'], ['expires_after_a_year']));
  f.accepted(first, [TESTS]);
  f.land(TESTS);
  f.moveBase(TESTS, rust(['starts_at_zero', true], ['grows_on_top_up'], ['shrinks_on_spend']));
  f.git('merge', '-q', '--no-edit', 'main');
  f.moveBase(TESTS, rust(['starts_at_zero', true], ['grows_on_top_up'], ['shrinks_on_spend', true]));
  f.git('merge', '-q', '--no-edit', 'main');
  const clean = f.verify('a');
  assert.equal(clean.code, 0, clean.out);
  assert.deepEqual(clean.data.tests_changed.switched_off, []);
  const fix = f.start('--item', 'a');
  f.write(TESTS, rust(['starts_at_zero', true], ['grows_on_top_up', true], ['shrinks_on_spend', true], ['expires_after_a_year']));
  f.accepted(fix, [TESTS]);
  const refused = f.verify('a');
  assert.equal(refused.code, 2, refused.out);
  assert.deepEqual(refused.data.tests_changed.switched_off, [{ file: TESTS, line: 7, text: IGNORE }]);
});

test('a fold that changed bytes an accepted dispatch recorded asks no new dispatch when the change is the base\'s alone', (t) => {
  const f = fixture(t, { a: ['card.cjs'] });
  const lines = (top, bottom) => `const top = ${top};\n\n\n\n\nconst middle = 0;\n\n\n\n\nconst bottom = ${bottom};\n`;
  f.moveBase('card.cjs', lines(1, 1));
  f.git('merge', '-q', '--ff-only', 'main');
  const dispatch = f.start('--item', 'a');
  f.write('card.cjs', lines(1, 2));
  f.accepted(dispatch, ['card.cjs']);
  f.land('card.cjs');
  f.moveBase('card.cjs', lines(3, 1));
  f.git('merge', '-q', '--no-edit', 'main');
  f.moveBase('other.cjs', 'moved again\n');
  f.git('merge', '-q', '--no-edit', 'main');
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
  f.write('card.cjs', `${lines(3, 2)}// written after the fold\n`);
  const edited = f.verify('a');
  assert.equal(edited.code, 2, edited.out);
  assert.match(edited.out, /accepted dispatch bytes changed at card\.cjs/);
});

test('a fold whose merge someone resolved by hand still asks for the dispatch again', (t) => {
  const f = fixture(t, { a: ['card.cjs'] });
  const dispatch = f.start('--item', 'a');
  f.write('card.cjs', 'module.exports = 2;\n');
  f.accepted(dispatch, ['card.cjs']);
  f.land('card.cjs');
  f.moveBase('card.cjs', 'module.exports = 3;\n');
  assert.throws(() => f.git('merge', '-q', '--no-edit', 'main'));
  f.write('card.cjs', 'module.exports = 5;\n');
  f.git('add', 'card.cjs');
  f.git('commit', '-qm', 'the fold, resolved by hand');
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /accepted dispatch bytes changed at card\.cjs/);
});

test('a line of the base tip is followed into the tree past insertions, deletions and changes, and a changed line is lost', () => {
  const { carried, hunksOf } = require('./run-fold.cjs');
  const hunks = hunksOf('@@ -2,0 +3,2 @@\n+a\n+b\n@@ -5 +7,0 @@\n-c\n@@ -8,2 +9 @@\n-d\n-e\n+f\n');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((line) => carried(hunks, line)), [1, 2, 5, 6, null, 7, 8, null, null, 10]);
});
