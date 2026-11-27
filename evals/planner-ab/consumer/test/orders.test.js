'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { resetAll } = require('./reset');
const { issueCard, getCard } = require('../src/giftcards/cards');
const { checkout } = require('../src/orders/checkout');
const { refundOrder } = require('../src/orders/refund');
const psp = require('../src/payments/psp');
const { sent } = require('../src/notify/mailer');

beforeEach(resetAll);

const LINES = [{ sku: 'mug', qty: 1, unitCents: 1500 }, { sku: 'tea', qty: 2, unitCents: 500 }];

test('the gift card pays first and the card payment pays the rest', () => {
  const card = issueCard({ amountCents: 1000, currency: 'EUR', buyerEmail: 'b@example.com', recipientEmail: 'r@example.com' });
  const order = checkout({ email: 'r@example.com', currency: 'EUR', lines: LINES, giftCard: { code: card.code, amountCents: 1000 } });
  assert.equal(order.totalCents, 2500);
  assert.deepEqual(order.payments.map((p) => [p.method, p.amountCents]), [['giftcard', 1000], ['card', 1500]]);
  assert.equal(getCard(card.code).balanceCents, 0);
  assert.equal(sent().at(-1).template, 'order-receipt');
});

test('an order paid by card alone is refunded whole through the provider', () => {
  const order = checkout({ email: 'c@example.com', currency: 'EUR', lines: LINES });
  const refunded = refundOrder({ orderId: order.id });
  assert.equal(refunded.status, 'refunded');
  assert.deepEqual(psp.callsMade().at(-1), { kind: 'refund', paymentId: `pay-${order.id}`, amountCents: 2500 });
  assert.equal(sent().at(-1).template, 'refund-confirmation');
});

test('a refund of some lines leaves the order partially refunded', () => {
  const order = checkout({ email: 'c@example.com', currency: 'EUR', lines: LINES });
  const refunded = refundOrder({ orderId: order.id, lineIndexes: [1] });
  assert.equal(refunded.status, 'partially-refunded');
  assert.equal(refunded.refunds[0].amountCents, 1000);
});

test('an order with a gift card share is refused for now', () => {
  const card = issueCard({ amountCents: 1000, currency: 'EUR', buyerEmail: 'b@example.com', recipientEmail: 'r@example.com' });
  const order = checkout({ email: 'r@example.com', currency: 'EUR', lines: LINES, giftCard: { code: card.code, amountCents: 1000 } });
  assert.throws(() => refundOrder({ orderId: order.id }), { code: 'GIFT_CARD_SHARE' });
});
