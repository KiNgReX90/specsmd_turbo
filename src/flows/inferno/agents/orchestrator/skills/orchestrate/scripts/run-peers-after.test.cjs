'use strict';

// verify-item on a late correction: a sibling that ran wholly between two of the item's own
// attempts ran after the item, not beside it, so its change to a file both own is its own.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { fixture, printedCalls } = require('./run-attribution-fixture.cjs');

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
  const fix = f.startOverlapping('a');
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
  const fix = late.startOverlapping('a');
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
  const two = early.startOverlapping('b');
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
  const beside = f.startOverlapping('c');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['a.cjs']);
  const between = f.startOverlapping('b');
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

/** Two chains that own shared.cjs through one item each, built and landed one after the other. */
const CHAINS = { r1: ['shared.cjs', 'r1.cjs'], r2: ['r2.cjs'], l1: ['shared.cjs', 'l1.cjs'], l2: ['l2.cjs'] };

test('the overlap refusal prints the calls that join both chains, and run as printed they clear it with the grant still read', (t) => {
  const f = fixture(t, CHAINS);
  for (const chain of [['r1', 'r2'], ['l1', 'l2']]) {
    const id = f.start('--items', chain.join(','));
    const files = [...new Set(chain.flatMap((item) => CHAINS[item]))];
    for (const file of files) f.write(file, `${file} by ${chain.join(',')}\n`);
    f.accepted(id, files);
    f.land(...files);
  }
  // The two corrections side by side: the one named for r2 alone, and the one of l1 written past the door.
  const fix = f.start('--item', 'r2');
  assert.equal(f.call('grant', fix, '--path', 'other.cjs', '--tree', f.root).code, 0);
  const beside = f.startOverlapping('l1');
  f.write('shared.cjs', 'fixed by l1\n');
  f.accepted(beside, ['shared.cjs']);
  f.write('other.cjs', 'granted change\n');
  f.accepted(fix, ['other.cjs']);
  f.land('shared.cjs');
  const held = f.verify('r2');
  assert.equal(held.code, 2, held.out);
  assert.match(held.out, new RegExp(`overlaps at shared\\.cjs with dispatch ${beside}: [^\\n]*joins the two histories, so the items are one chain from then on`));
  const [join, accept, again, ...more] = printedCalls(held.out);
  assert.equal(join, `dispatch-log alpha --items r2,r1,l1,l2 --tier <tier> --agent <agent> --tree ${f.root}`);
  assert.equal(accept, `accept-dispatch <dispatch_id> --changed-paths '[]' --tree ${f.root}`);
  assert.equal(again, `verify-item --items r2,r1 --tree ${f.root}`);
  assert.deepEqual(more, []);

  const joined = f.asPrinted(join.replace('<tier>', 'strong').replace('<agent>', 'builder'));
  assert.equal(joined.code, 0, joined.out);
  assert.equal(joined.data.log, path.join(f.cache, 'specsmd-inferno', path.basename(f.root), 'dispatch', 'alpha.log'));
  const closed = f.asPrinted(accept.replace('<dispatch_id>', joined.data.dispatch_id));
  assert.equal(closed.code, 0, closed.out);
  const cleared = f.asPrinted(again);
  assert.equal(cleared.code, 0, cleared.out);
  assert.deepEqual([cleared.data.outside, cleared.data.unreported], [[], []]);
  assert.deepEqual(cleared.data.dispatches[0].granted, ['other.cjs']);
  for (const item of ['r2', 'l1']) assert.equal(f.verify(item).code, 0, item);
});
