'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { resetAll } = require('./reset');
const { issueCard } = require('../src/giftcards/cards');
const { redeem } = require('../src/giftcards/redeem');
const { HEADER, buildExport, line } = require('../src/accounting/export');
const queue = require('../src/accounting/queue');

beforeEach(resetAll);

test('every movement becomes one export line, and the export drains the queue', () => {
  const card = issueCard({ amountCents: 2000, currency: 'EUR', buyerEmail: 'b@example.com', recipientEmail: 'r@example.com', orderId: 'ord-buy' });
  redeem({ code: card.code, amountCents: 500, currency: 'EUR', orderId: 'ord-7' });
  const file = buildExport().trim().split('\n');
  assert.equal(file[0], HEADER);
  assert.deepEqual(file.slice(1), [
    `GC-ISSUE;2026-03-01;${card.code};ord-buy;2000;EUR;2000`,
    `GC-REDEEM;2026-03-01;${card.code};ord-7;-500;EUR;1500`,
  ]);
  assert.equal(queue.size(), 0);
});

test('a line type the format does not know is refused', () => {
  assert.throws(() => line({ type: 'GC-OTHER', movement: { at: '2026-03-01T00:00:00Z' } }), /no line type GC-OTHER/);
});
