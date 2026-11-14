'use strict';

// verify-item on one dispatch over several completed items: the record joins their histories,
// and each keeps its own. A peer overlaps only beside an attempt of the history that claims or
// owns the file it changed, and the batch's own attempt counts for every item it covers.

const assert = require('node:assert/strict');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');

const ITEMS = { a: ['a.cjs'], b: ['shared.cjs', 'b.cjs'], c: ['shared.cjs', 'c.cjs'] };

/** The dispatch ids of a and b in both orders, so the record's sorted `previous` lists either first. */
const ORDERS = [['1-a', '2-b'], ['2-a', '1-b']];

/** Items a and b each completed, the batch over both started and accepted on a fix of a. */
function batched(f) {
  const batch = f.start('--items', 'a,b');
  f.write('a.cjs', 'module.exports = 3;\n');
  f.accepted(batch, ['a.cjs']);
  return batch;
}

/** Item b completed on shared.cjs, then item a beside a peer c that changed shared.cjs after b ended. */
function peerBesideA(f, idA, idB) {
  const b = f.start('--item', 'b', '--dispatch-id', idB);
  f.write('shared.cjs', 'b\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(b, ['shared.cjs', 'b.cjs']);
  assert.equal(f.verify('b').code, 0);
  const a = f.start('--item', 'a', '--dispatch-id', idA);
  const peer = f.start('--item', 'c');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('shared.cjs', 'b\nc\n');
  f.write('c.cjs', 'module.exports = 2;\n');
  f.accepted(a, ['a.cjs']);
  f.accepted(peer, ['shared.cjs', 'c.cjs']);
  assert.equal(f.verify('a').code, 0);
}

test('a peer beside one item of a batch that changed a file only another item owns passes', (t) => {
  for (const [idA, idB] of ORDERS) {
    const f = fixture(t, ITEMS);
    peerBesideA(f, idA, idB);
    batched(f);
    const result = f.verify('--items', 'a,b');
    assert.equal(result.code, 0, `${idA} ${idB}: ${result.out}`);
    assert.deepEqual(result.data.outside, []);
    assert.deepEqual(result.data.unreported, []);
  }
});

test('a correction that continues the batch keeps the histories the batch joined apart', (t) => {
  const f = fixture(t, ITEMS);
  peerBesideA(f, '1-a', '2-b');
  batched(f);
  const fix = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 4;\n');
  f.accepted(fix, ['a.cjs']);
  const result = f.verify('--items', 'a,b');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches.map((entry) => entry.dispatch_id), [fix]);
});

test('the same peer beside the attempt of the item that owns the file is refused, as before', (t) => {
  for (const [idA, idB] of ORDERS) {
    const f = fixture(t, ITEMS);
    const b = f.start('--item', 'b', '--dispatch-id', idB);
    const peer = f.start('--item', 'c');
    f.write('shared.cjs', 'b\n');
    f.write('b.cjs', 'module.exports = 2;\n');
    f.accepted(b, ['shared.cjs', 'b.cjs']);
    f.write('shared.cjs', 'b\nc\n');
    f.write('c.cjs', 'module.exports = 2;\n');
    f.accepted(peer, ['shared.cjs', 'c.cjs']);
    const a = f.start('--item', 'a', '--dispatch-id', idA);
    f.write('a.cjs', 'module.exports = 2;\n');
    f.accepted(a, ['a.cjs']);
    batched(f);
    const result = f.verify('--items', 'a,b');
    assert.equal(result.code, 2, `${idA} ${idB}: ${result.out}`);
    assert.match(result.out, new RegExp(`overlaps at shared\\.cjs with dispatch ${peer}`));
  }
});

test('a peer beside the batch\'s own attempt is refused at a file the batch claims or owns', (t) => {
  for (const claims of [true, false]) {
    const f = fixture(t, ITEMS);
    const b = f.start('--item', 'b');
    f.write('b.cjs', 'module.exports = 2;\n');
    f.accepted(b, ['b.cjs']);
    const a = f.start('--item', 'a');
    f.write('a.cjs', 'module.exports = 2;\n');
    f.accepted(a, ['a.cjs']);
    const batch = f.start('--items', 'a,b');
    const peer = f.start('--item', 'c');
    f.write('shared.cjs', 'c\n');
    f.write('c.cjs', 'module.exports = 2;\n');
    f.accepted(peer, ['shared.cjs', 'c.cjs']);
    f.write('a.cjs', 'module.exports = 3;\n');
    if (claims) f.write('shared.cjs', 'c\nfixed\n');
    f.accepted(batch, claims ? ['a.cjs', 'shared.cjs'] : ['a.cjs']);
    const result = f.verify('--items', 'a,b');
    assert.equal(result.code, 2, `claims ${claims}: ${result.out}`);
    assert.match(result.out, new RegExp(`overlaps at shared\\.cjs with dispatch ${peer}`));
  }
});

// A file the items a and b own neither of: other.cjs, which only the peer c owns.
const WIDE = { ...ITEMS, c: ['shared.cjs', 'c.cjs', 'other.cjs', 'late.cjs'], d: ['shared.cjs', 'd.cjs'], e: ['late.cjs'] };

/** Item a completed on its own file. */
function builtA(f) {
  const a = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(a, ['a.cjs']);
}

test('a peer beside the batch\'s own attempt is refused at a file only an item of the batch with no history owns', (t) => {
  const f = fixture(t, WIDE);
  const b = f.start('--item', 'b');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(b, ['b.cjs']);
  builtA(f);
  const batch = f.start('--items', 'a,b,e');
  const peer = f.start('--item', 'c');
  f.write('late.cjs', 'c\n');
  f.accepted(peer, ['late.cjs']);
  f.write('a.cjs', 'module.exports = 3;\n');
  f.accepted(batch, ['a.cjs']);
  const result = f.verify('--items', 'a,b,e');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, new RegExp(`overlaps at late\\.cjs with dispatch ${peer}`));
});

test('a peer beside the batch\'s own attempt is refused at a file the batch claims outside its ownership', (t) => {
  const f = fixture(t, WIDE);
  const b = f.start('--item', 'b');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(b, ['b.cjs']);
  builtA(f);
  const batch = f.start('--items', 'a,b');
  const peer = f.start('--item', 'c');
  f.write('other.cjs', 'c\n');
  f.accepted(peer, ['other.cjs']);
  f.write('other.cjs', 'c\nbatch\n');
  f.accepted(batch, ['other.cjs']);
  const result = f.verify('--items', 'a,b');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, new RegExp(`overlaps at other\\.cjs with dispatch ${peer}`));
});

test('a peer beside an item of the batch is refused at a file that item claimed or carried outside its ownership', (t) => {
  for (const carried of [false, true]) {
    const f = fixture(t, WIDE);
    const first = f.start('--item', 'b');
    const peer = f.start('--item', 'c');
    f.write('other.cjs', 'b and c\n');
    // Carried: a correction of b reports the file its first attempt, never accepted, changed.
    const b = carried ? f.start('--item', 'b') : first;
    f.write('b.cjs', 'module.exports = 2;\n');
    f.accepted(peer, ['other.cjs']);
    f.accepted(b, ['b.cjs', 'other.cjs']);
    builtA(f);
    batched(f);
    const result = f.verify('--items', 'a,b');
    assert.equal(result.code, 2, `carried ${carried}: ${result.out}`);
    assert.match(result.out, new RegExp(`overlaps at other\\.cjs with dispatch ${peer}`), `carried ${carried}`);
  }
});

test('of two peers across one change, the one beside the item that owns the file is named, in either order', (t) => {
  const f = fixture(t, WIDE);
  const b = f.start('--item', 'b');
  const besideB = f.start('--item', 'd');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(b, ['b.cjs']);
  const a = f.start('--item', 'a');
  const besideA = f.start('--item', 'c');
  f.write('shared.cjs', 'c and d\n');
  f.accepted(besideB, ['shared.cjs']);
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(a, ['a.cjs']);
  f.accepted(besideA, ['shared.cjs']);
  batched(f);
  for (const peers of [[besideA, besideB], [besideB, besideA]]) {
    const result = f.verify('--items', 'a,b', '--peers', JSON.stringify(peers));
    assert.equal(result.code, 2, `${peers}: ${result.out}`);
    assert.match(result.out, new RegExp(`overlaps at shared\\.cjs with dispatch ${besideB}`));
  }
});
