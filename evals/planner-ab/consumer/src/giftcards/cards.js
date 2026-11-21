'use strict';

const crypto = require('node:crypto');

const clock = require('../clock');
const { cents } = require('../money');
const store = require('./store');
const { recordMovement } = require('../ledger/movements');

/** A card is valid for a year from the day it is issued. */
const VALID_DAYS = 365;

class CardError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function newCode() {
  return crypto.randomBytes(6).toString('hex').toUpperCase();
}

/** Issues a card with a zero balance, then loads the bought amount as its first movement. */
function issueCard({ amountCents, currency, buyerEmail, recipientEmail, orderId }) {
  cents(amountCents);
  const issued = clock.now();
  const card = {
    code: newCode(),
    currency,
    balanceCents: 0,
    buyerEmail,
    recipientEmail,
    issuedAt: issued.toISOString(),
    expiresAt: clock.addDays(issued, VALID_DAYS).toISOString(),
  };
  store.saveCard(card);
  return recordMovement({ code: card.code, deltaCents: amountCents, reason: 'issue', orderId });
}

function getCard(code) {
  const card = store.loadCard(code);
  if (!card) throw new CardError('UNKNOWN_CARD', `no card ${code}`);
  return card;
}

function isExpired(card, at = clock.now()) {
  return new Date(card.expiresAt) <= at;
}

module.exports = { CardError, VALID_DAYS, issueCard, getCard, isExpired };
