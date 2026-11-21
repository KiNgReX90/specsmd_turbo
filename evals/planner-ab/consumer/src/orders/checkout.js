'use strict';

const clock = require('../clock');
const { cents } = require('../money');
const { redeem } = require('../giftcards/redeem');
const psp = require('../payments/psp');
const { sendEmail } = require('../notify/mailer');
const store = require('./store');

let nextId = 1;

function totalOf(lines) {
  return lines.reduce((sum, line) => sum + cents(line.unitCents) * line.qty, 0);
}

/**
 * Places an order. The gift card pays first, up to its balance or the total; the card payment
 * pays the rest. An order paid by gift card alone has no card payment.
 */
function checkout({ email, currency, lines, giftCard = null }) {
  const id = `ord-${nextId++}`;
  const totalCents = totalOf(lines);
  const payments = [];
  let left = totalCents;
  if (giftCard) {
    const amountCents = Math.min(giftCard.amountCents, left);
    redeem({ code: giftCard.code, amountCents, currency, orderId: id });
    payments.push({ method: 'giftcard', code: giftCard.code, amountCents });
    left -= amountCents;
  }
  if (left > 0) {
    const { paymentId } = psp.charge({ orderId: id, amountCents: left, currency });
    payments.push({ method: 'card', paymentId, amountCents: left });
  }
  const order = { id, email, currency, lines, totalCents, payments, refunds: [], status: 'paid', placedAt: clock.now().toISOString() };
  store.saveOrder(order);
  sendEmail(email, 'order-receipt', { orderId: id, totalCents, currency });
  return order;
}

function resetIds() {
  nextId = 1;
}

module.exports = { checkout, totalOf, resetIds };
