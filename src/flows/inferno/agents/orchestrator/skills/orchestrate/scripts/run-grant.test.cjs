'use strict';

// An ownership grant the orchestrator makes after dispatch-log: `run.cjs grant` records it on the
// signed dispatch, and verify-item and every sibling's check read it from there.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { fixture, spec } = require('./run-attribution-fixture.cjs');

/** Every file of the fixture's cache with its bytes, where the signed dispatch records live. */
function cacheBytes(f) {
  const files = {};
  for (const name of fs.readdirSync(f.cache, { recursive: true })) {
    const file = path.join(f.cache, name);
    if (fs.statSync(file).isFile()) files[name] = fs.readFileSync(file, 'utf8');
  }
  return files;
}

const SPEC = '.specs-inferno/intents/alpha/work-items/a.md';

test('a path granted after dispatch-log is the item\'s at verify-item, and the spec is never edited', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const dispatch = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('other.cjs', 'the count this item moved\n');
  const granted = f.call('grant', dispatch, '--path', 'other.cjs', '--tree', f.root);
  assert.equal(granted.code, 0, granted.out);
  assert.deepEqual(granted.data.granted.map((entry) => [entry.path, entry.signer]), [['other.cjs', 'orchestrator']]);
  assert.deepEqual(granted.data.started, ['a.cjs']);
  f.accepted(dispatch, ['a.cjs', 'other.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
  assert.deepEqual(result.data.dispatches[0].granted, ['other.cjs']);
  assert.equal(f.git('status', '--porcelain', '--', SPEC), '');
  const again = f.verify('a');
  assert.equal(again.code, 0, again.out);
});

test('without the grant the same change is outside the item, as before', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const dispatch = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('other.cjs', 'the count this item moved\n');
  f.accepted(dispatch, ['a.cjs', 'other.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.outside, ['other.cjs']);
});

test('a grant outlives a correction: the next dispatch-log of the item carries it', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const first = f.start('--item', 'a');
  assert.equal(f.call('grant', first, '--path', 'other.cjs', '--tree', f.root).code, 0);
  f.write('other.cjs', 'granted\n');
  f.accepted(first, ['other.cjs']);
  const fix = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 3;\n');
  f.accepted(fix, ['a.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].granted, ['other.cjs']);
});

test('a grant is idempotent and leaves dispatch-log of the same id as it was', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const id = 'd-fixed';
  assert.equal(f.start('--item', 'a', '--dispatch-id', id), id);
  for (let round = 0; round < 2; round += 1) {
    const granted = f.call('grant', id, '--path', 'other.cjs', '--tree', f.root);
    assert.equal(granted.code, 0, granted.out);
    assert.deepEqual(granted.data.granted.map((entry) => entry.path), ['other.cjs']);
  }
  const owned = f.call('grant', id, '--path', 'a.cjs', '--tree', f.root);
  assert.equal(owned.code, 0, owned.out);
  assert.deepEqual(owned.data.granted.map((entry) => entry.path), ['other.cjs']);
  assert.equal(f.start('--item', 'a', '--dispatch-id', id), id);
});

test('a grant on a dispatch that does not exist, was accepted, or was superseded is refused by name', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const missing = f.call('grant', 'no-such-dispatch', '--path', 'other.cjs', '--tree', f.root);
  assert.equal(missing.code, 2, missing.out);
  assert.match(missing.out, /no dispatch no-such-dispatch/);

  const first = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(first, ['a.cjs']);
  const closed = f.call('grant', first, '--path', 'other.cjs', '--tree', f.root);
  assert.equal(closed.code, 2, closed.out);
  assert.match(closed.out, new RegExp(`dispatch ${first} for a is already accepted[^\\n]*dispatch-log`));

  const open = f.start('--item', 'a');
  f.start('--item', 'a');
  const superseded = f.call('grant', open, '--path', 'other.cjs', '--tree', f.root);
  assert.equal(superseded.code, 2, superseded.out);
  assert.match(superseded.out, new RegExp(`dispatch ${open} for a was superseded`));
});

test('a grant names one exact path inside the tree and outside the ledger', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const dispatch = f.start('--item', 'a');
  for (const [file, reason] of [['../escape.cjs', /inside the tree/], ['.specs-inferno/state.yaml', /ledger/], ['src/*.cjs', /exact/]]) {
    const refused = f.call('grant', dispatch, '--path', file, '--tree', f.root);
    assert.equal(refused.code, 2, `${file}: ${refused.out}`);
    assert.match(refused.out, reason, file);
  }
  f.write('lib/helper.cjs', 'module.exports = 1;\n');
  const directory = f.call('grant', dispatch, '--path', 'lib', '--tree', f.root);
  assert.equal(directory.code, 2, directory.out);
  assert.match(directory.out, /never a directory/);
  const usage = f.call('grant', dispatch, '--tree', f.root);
  assert.equal(usage.code, 1, usage.out);
});

test('a sibling waits for an open dispatch whose grant overlaps its ownership', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs', 'shared.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(two, ['b.cjs']);
  const before = f.verify('b');
  assert.equal(before.code, 0, before.out);
  assert.equal(f.call('grant', one, '--path', 'shared.cjs', '--tree', f.root).code, 0);
  const waiting = f.verify('b');
  assert.equal(waiting.code, 2, waiting.out);
  assert.match(waiting.out, new RegExp(`dispatch ${one} for a is still open`));
});

test('a sibling reads a granted change as the granting dispatch\'s own', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  assert.equal(f.call('grant', one, '--path', 'other.cjs', '--tree', f.root).code, 0);
  f.write('other.cjs', 'granted to a\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['other.cjs']);
  f.accepted(two, ['b.cjs']);
  const sibling = f.verify('b');
  assert.equal(sibling.code, 0, sibling.out);
  assert.deepEqual(sibling.data.outside, []);
});

test('a sibling that changes a path granted to another dispatch overlaps it', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs', 'other.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  assert.equal(f.call('grant', one, '--path', 'other.cjs', '--tree', f.root).code, 0);
  f.write('other.cjs', 'both touched it\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['other.cjs']);
  f.accepted(two, ['b.cjs']);
  const result = f.verify('b');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /overlaps at other\.cjs/);
});

test('a path the dispatch already owns through a directory entry leaves the signed record as it was', (t) => {
  const f = fixture(t, { a: ['src/'] });
  const dispatch = f.start('--item', 'a');
  const before = cacheBytes(f);
  const owned = f.call('grant', dispatch, '--path', 'src/a.cjs', '--tree', f.root);
  assert.equal(owned.code, 0, owned.out);
  assert.deepEqual(owned.data.granted, []);
  assert.deepEqual(owned.data.started, ['src/']);
  assert.deepEqual(cacheBytes(f), before);
});

test('a correction whose spec now lists an earlier grant starts with that path once, never as granted', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const first = f.start('--item', 'a');
  assert.equal(f.call('grant', first, '--path', 'other.cjs', '--tree', f.root).code, 0);
  f.write('.specs-inferno/intents/alpha/work-items/a.md', spec('a', ['a.cjs', 'other.cjs']));
  const fix = f.start('--item', 'a');
  const read = f.call('grant', fix, '--path', 'other.cjs', '--tree', f.root);
  assert.equal(read.code, 0, read.out);
  assert.deepEqual(read.data.granted, []);
  assert.deepEqual(read.data.started, ['a.cjs', 'other.cjs']);
});
