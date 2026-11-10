'use strict';

// verify-item beside a dispatch nobody accepted yet: it waits only when that dispatch's frozen
// ownership overlaps the reviewed item's, or when a change no dispatch claims could be its escape.

const assert = require('node:assert/strict');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');

test('verify-item verifies beside an open dispatch with disjoint frozen ownership', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs'] });
  const one = f.start('--item', 'a');
  f.start('--item', 'b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['a.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
});

test('verify-item still waits on an open dispatch whose frozen ownership overlaps', (t) => {
  const f = fixture(t, { a: ['shared.cjs', 'a.cjs'], b: ['shared.cjs', 'b.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['a.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, new RegExp(`dispatch ${two} for b is still open[\\s\\S]*accept-dispatch`));
});

test('a change no dispatch claims beside an open one waits for it', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.write('other.cjs', 'escaped\n');
  f.accepted(one, ['a.cjs']);
  const waiting = f.verify('a');
  assert.equal(waiting.code, 2, waiting.out);
  assert.match(waiting.out, new RegExp(`dispatch ${two} for b is still open`));
  assert.doesNotMatch(waiting.out, /other\.cjs/);
  f.accepted(two, ['b.cjs']);
  const named = f.verify('a');
  assert.equal(named.code, 2, named.out);
  assert.deepEqual(named.data.outside, ['other.cjs']);
});

test('a ledger change beside a disjoint open dispatch is no reason to wait', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs'] });
  const one = f.start('--item', 'a');
  f.start('--item', 'b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('.specs-inferno/state.yaml', 'intents:\n  - id: alpha\n    status: in_progress\n    work_items:\n' +
    '      - id: a\n        status: in_progress\n      - id: b\n        status: in_progress\n');
  f.accepted(one, ['a.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
});

test('a correction of a landed item beside a disjoint open one is explained by that item\'s accepted attempt', (t) => {
  const f = fixture(t, { b: ['b.cjs'], c: ['c.cjs'] });
  const two = f.start('--item', 'b');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(two, ['b.cjs']);
  f.land('b.cjs');
  const later = f.start('--item', 'c');
  f.write('c.cjs', 'module.exports = 2;\n');
  f.accepted(later, ['c.cjs']);
  f.start('--item', 'b');
  f.write('b.cjs', 'module.exports = 3;\n');
  const result = f.verify('c');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
});
