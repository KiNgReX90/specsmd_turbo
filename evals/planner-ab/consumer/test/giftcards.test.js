'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { resetAll } = require('./reset');
const clock = require('../src/clock');
const { issueCard, getCard } = require('../src/giftcards/cards');
const { redeem } = require('../src/giftcards/redeem');
const { adjustBalance } = require('../src/giftcards/adjust');
const { movementsOf } = require('../src/ledger/movements');

beforeEach(resetAll);

const issue = (amountCents = 5000) =>
  issueCard({ amountCents, currency: 'EUR', buyerEmail: 'buyer@example.com', recipientEmail: 'friend@example.com', orderId: 'ord-buy' });

test('an issued card holds its amount for a year, loaded as one movement', () => {
  const card = issue();
  assert.equal(getCard(card.code).balanceCents, 5000);
  assert.equal(card.expiresAt, '2027-03-01T10:00:00.000Z');
  assert.deepEqual(movementsOf(card.code).map((m) => [m.reason, m.deltaCents, m.balanceCents]), [['issue', 5000, 5000]]);
});

test('a redemption takes the amount off and records it', () => {
  const card = issue();
  redeem({ code: card.code, amountCents: 1200, currency: 'EUR', orderId: 'ord-1' });
  assert.equal(getCard(card.code).balanceCents, 3800);
  assert.equal(movementsOf(card.code)[1].reason, 'redeem');
});

test('a redemption over the balance is refused whole', () => {
  const card = issue(1000);
  assert.throws(() => redeem({ code: card.code, amountCents: 1001, currency: 'EUR', orderId: 'ord-1' }), { code: 'INSUFFICIENT_BALANCE' });
  assert.equal(getCard(card.code).balanceCents, 1000);
});

test('an expired card cannot be redeemed', () => {
  const card = issue();
  clock.pin('2027-03-02T00:00:00Z');
  assert.throws(() => redeem({ code: card.code, amountCents: 100, currency: 'EUR', orderId: 'ord-1' }), { code: 'EXPIRED' });
});

test('a card in another currency cannot be redeemed', () => {
  const card = issue();
  assert.throws(() => redeem({ code: card.code, amountCents: 100, currency: 'USD', orderId: 'ord-1' }), { code: 'CURRENCY' });
});

test('a support adjustment needs a note and moves the balance', () => {
  const card = issue();
  assert.throws(() => adjustBalance({ code: card.code, deltaCents: 100 }));
  adjustBalance({ code: card.code, deltaCents: -300, note: 'double load' });
  assert.equal(getCard(card.code).balanceCents, 4700);
});
