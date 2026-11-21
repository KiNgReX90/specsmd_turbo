'use strict';

/** Puts every in-memory store back to empty and pins the clock, before each test. */

const clock = require('../src/clock');

function resetAll() {
  require('../src/giftcards/store').reset();
  require('../src/ledger/movements').reset();
  require('../src/accounting/queue').drain();
  require('../src/orders/store').reset();
  require('../src/orders/checkout').resetIds();
  require('../src/payments/psp').reset();
  require('../src/notify/mailer').reset();
  clock.pin('2026-03-01T10:00:00Z');
}

module.exports = { resetAll };
