'use strict';

// verify-item on a late correction: a sibling that ran wholly between two of the item's own
// attempts ran after the item, not beside it, so its change to a file both own is its own.

const assert = require('node:assert/strict');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');

const ITEMS = { a: ['shared.cjs', 'a.cjs'], b: ['shared.cjs', 'b.cjs'] };

/** Item a built and accepted, then item b, which depends on it, on the same shared file. */
function builtInOrder(t, land) {
  const f = fixture(t, ITEMS);
  const one = f.start('--item', 'a');
  f.write('shared.cjs', 'a\n');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['shared.cjs', 'a.cjs']);
  assert.equal(f.verify('a').code, 0);
  if (land) f.land('shared.cjs', 'a.cjs');
  const two = f.start('--item', 'b');
  f.write('shared.cjs', 'a\nb\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(two, ['shared.cjs', 'b.cjs']);
  assert.equal(f.verify('b').code, 0);
  if (land) f.land('shared.cjs', 'b.cjs');
  return { f, one, two };
}

test('a late correction of an item a later sibling built on passes, and the sibling\'s change stays the sibling\'s', (t) => {
  for (const land of [true, false]) {
    const { f } = builtInOrder(t, land);
    const fix = f.start('--item', 'a');
    f.write('shared.cjs', 'a fixed\nb\n');
    f.accepted(fix, ['shared.cjs']);
    const result = f.verify('a');
    assert.equal(result.code, 0, `land ${land}: ${result.out}`);
    assert.deepEqual(result.data.outside, [], `land ${land}`);
    assert.deepEqual(result.data.unreported, [], `land ${land}`);
    assert.deepEqual(result.data.dispatches[0].changed, ['a.cjs', 'shared.cjs']);
  }
});

test('the same correction while the sibling is still open waits for it, as before', (t) => {
  const f = fixture(t, ITEMS);
  const one = f.start('--item', 'a');
  f.write('shared.cjs', 'a\n');
  f.accepted(one, ['shared.cjs']);
  f.land('shared.cjs');
  const two = f.start('--item', 'b');
  f.write('shared.cjs', 'a\nb\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  const fix = f.start('--item', 'a');
  f.write('shared.cjs', 'a fixed\nb\n');
  f.accepted(fix, ['shared.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, new RegExp(`dispatch ${two} for b is still open`));
});

test('a sibling that was open while one of the item\'s own attempts was open is still refused at a shared file', (t) => {
  // The sibling starts after the first attempt was accepted and is accepted after the correction began.
  const late = fixture(t, ITEMS);
  const first = late.start('--item', 'a');
  late.write('shared.cjs', 'a\n');
  late.accepted(first, ['shared.cjs']);
  const sibling = late.start('--item', 'b');
  const fix = late.start('--item', 'a');
  late.write('shared.cjs', 'a\nb\n');
  late.accepted(sibling, ['shared.cjs']);
  late.write('shared.cjs', 'a fixed\nb\n');
  late.accepted(fix, ['shared.cjs']);
  const racing = late.verify('a');
  assert.equal(racing.code, 2, racing.out);
  assert.match(racing.out, new RegExp(`overlaps at shared\\.cjs with dispatch ${sibling}: [^\\n]*--items a,b`));

  // The sibling starts while the first attempt runs and is accepted before the correction began.
  const early = fixture(t, ITEMS);
  const one = early.start('--item', 'a');
  const two = early.start('--item', 'b');
  early.write('shared.cjs', 'a\n');
  early.accepted(one, ['shared.cjs']);
  early.write('shared.cjs', 'a\nb\n');
  early.accepted(two, ['shared.cjs']);
  const again = early.start('--item', 'a');
  early.write('shared.cjs', 'a fixed\nb\n');
  early.accepted(again, ['shared.cjs']);
  const beside = early.verify('a');
  assert.equal(beside.code, 2, beside.out);
  assert.match(beside.out, new RegExp(`overlaps at shared\\.cjs with dispatch ${two}`));
});

test('a sibling that changed a file the item owns after the item\'s last attempt is refused, as before', (t) => {
  const f = fixture(t, ITEMS);
  const one = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['a.cjs']);
  const two = f.start('--item', 'b');
  f.write('shared.cjs', 'b\n');
  f.accepted(two, ['shared.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, new RegExp(`overlaps at shared\\.cjs with dispatch ${two}`));
});

test('a sibling that ran between two attempts still answers for a change outside its own ownership', (t) => {
  const f = fixture(t, { a: ['shared.cjs', 'a.cjs'], b: ['b.cjs'] });
  const one = f.start('--item', 'a');
  f.write('shared.cjs', 'a\n');
  f.accepted(one, ['shared.cjs']);
  const two = f.start('--item', 'b');
  f.write('shared.cjs', 'a\nb\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(two, ['shared.cjs', 'b.cjs']);
  const fix = f.start('--item', 'a');
  f.write('shared.cjs', 'a fixed\nb\n');
  f.accepted(fix, ['shared.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, new RegExp(`dispatch ${two} for b claims shared\\.cjs outside its ownership`));
});

test('a change two siblings claim is refused when one ran beside the item, though the other ran between its attempts', (t) => {
  const f = fixture(t, { ...ITEMS, c: ['shared.cjs', 'c.cjs'] });
  const one = f.start('--item', 'a');
  const beside = f.start('--item', 'c');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['a.cjs']);
  const between = f.start('--item', 'b');
  f.write('shared.cjs', 'b\n');
  f.accepted(between, ['shared.cjs']);
  f.accepted(beside, ['shared.cjs']);
  const fix = f.start('--item', 'a');
  f.write('shared.cjs', 'b\nfixed by a\n');
  f.accepted(fix, ['shared.cjs']);
  // The only change to shared.cjs lies in the one stretch both siblings ran across. --peers reads
  // the records in the order it names them, so the first order finds the run between a's attempts first.
  for (const peers of [[between, beside], [beside, between]]) {
    const result = f.verify('a', '--peers', JSON.stringify(peers));
    assert.equal(result.code, 2, `${peers}: ${result.out}`);
    assert.match(result.out, new RegExp(`overlaps at shared\\.cjs with dispatch ${beside}`));
  }
});
