'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { cents, share, format } = require('../src/money');

test('cents refuses a float', () => {
  assert.throws(() => cents(1.5), TypeError);
});

test('share splits in proportion and gives the remainder cent to the largest weight', () => {
  assert.deepEqual(share(1000, [2500, 7500]), [250, 750]);
  assert.deepEqual(share(1001, [1, 2]), [333, 668]);
  assert.deepEqual(share(500, [0, 0]), [0, 0]);
});

test('format writes cents as currency', () => {
  assert.equal(format(12345, 'EUR'), 'EUR 123.45');
  assert.equal(format(-5, 'EUR'), '-EUR 0.05');
});
