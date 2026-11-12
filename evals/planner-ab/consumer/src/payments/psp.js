'use strict';

/**
 * The client of the card payment provider. In this repository it is a stand-in that records
 * what it was asked, so checkout and refunds can be tested without the network.
 */

const calls = [];

function charge({ orderId, amountCents, currency }) {
  calls.push({ kind: 'charge', orderId, amountCents, currency });
  return { paymentId: `pay-${orderId}`, amountCents };
}

function refund({ paymentId, amountCents }) {
  calls.push({ kind: 'refund', paymentId, amountCents });
  return { refundId: `ref-${paymentId}-${calls.length}`, amountCents };
}

function callsMade() {
  return calls.map((call) => ({ ...call }));
}

function reset() {
  calls.length = 0;
}

module.exports = { charge, refund, callsMade, reset };
