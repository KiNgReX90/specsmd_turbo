'use strict';

const clock = require('../clock');
const psp = require('../payments/psp');
const { sendEmail } = require('../notify/mailer');
const store = require('./store');
const { totalOf } = require('./checkout');

class RefundError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Refunds an order, whole or the given line indexes. Only the card payment is refunded today:
 * an order with a gift card share is refused, because the share has no way back onto the card.
 */
function refundOrder({ orderId, lineIndexes = null }) {
  const order = store.loadOrder(orderId);
  if (!order) throw new RefundError('UNKNOWN_ORDER', `no order ${orderId}`);
  if (order.status === 'refunded') throw new RefundError('ALREADY_REFUNDED', `order ${orderId} is refunded`);
  if (order.payments.some((payment) => payment.method === 'giftcard')) {
    throw new RefundError('GIFT_CARD_SHARE', `order ${orderId} was paid with a gift card, which cannot be refunded yet`);
  }
  const lines = lineIndexes === null ? order.lines : lineIndexes.map((index) => order.lines[index]);
  const amountCents = totalOf(lines);
  const card = order.payments.find((payment) => payment.method === 'card');
  const { refundId } = psp.refund({ paymentId: card.paymentId, amountCents });
  order.refunds.push({ refundId, amountCents, lineIndexes, at: clock.now().toISOString() });
  const refunded = order.refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
  order.status = refunded >= order.totalCents ? 'refunded' : 'partially-refunded';
  store.saveOrder(order);
  sendEmail(order.email, 'refund-confirmation', { orderId, amountCents, currency: order.currency });
  return order;
}

module.exports = { RefundError, refundOrder };
