'use strict';

const { cents } = require('../money');
const { CardError, getCard, isExpired } = require('./cards');
const { recordMovement } = require('../ledger/movements');

/** Takes `amountCents` off a card for an order. All or nothing. */
function redeem({ code, amountCents, currency, orderId }) {
  cents(amountCents);
  const card = getCard(code);
  if (isExpired(card)) throw new CardError('EXPIRED', `card ${code} expired on ${card.expiresAt}`);
  if (card.currency !== currency) throw new CardError('CURRENCY', `card ${code} is in ${card.currency}`);
  if (card.balanceCents < amountCents) throw new CardError('INSUFFICIENT_BALANCE', `card ${code} holds ${card.balanceCents}`);
  return recordMovement({ code, deltaCents: -amountCents, reason: 'redeem', orderId });
}

module.exports = { redeem };
