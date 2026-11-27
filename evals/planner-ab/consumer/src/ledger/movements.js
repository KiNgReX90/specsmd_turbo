'use strict';

/**
 * Every balance movement of every card. recordMovement is the only way a balance changes: it
 * appends the movement, saves the card with its new balance and queues the accounting line, so
 * the three never disagree. A caller that saves a card with a new balance itself leaves the
 * accountants a balance they cannot explain.
 */

const clock = require('../clock');
const { cents } = require('../money');
const store = require('../giftcards/store');
const queue = require('../accounting/queue');

/** The reasons the accounting export knows, each with its line type (docs/accounting-export.md). */
const REASONS = { issue: 'GC-ISSUE', redeem: 'GC-REDEEM', adjust: 'GC-ADJUST' };

const movements = [];

function recordMovement({ code, deltaCents, reason, orderId = null, note = null }) {
  cents(deltaCents);
  if (!REASONS[reason]) throw new Error(`unknown movement reason ${reason}`);
  const card = store.loadCard(code);
  if (!card) throw new Error(`no card ${code}`);
  const balanceCents = card.balanceCents + deltaCents;
  if (balanceCents < 0) throw new Error(`movement would take card ${code} below zero`);
  const movement = {
    id: movements.length + 1,
    code,
    deltaCents,
    balanceCents,
    currency: card.currency,
    reason,
    orderId,
    note,
    at: clock.now().toISOString(),
  };
  movements.push(movement);
  store.saveCard({ ...card, balanceCents });
  queue.enqueue({ type: REASONS[reason], movement });
  return { ...card, balanceCents };
}

function movementsOf(code) {
  return movements.filter((movement) => movement.code === code).map((movement) => ({ ...movement }));
}

function movementsOfOrder(orderId) {
  return movements.filter((movement) => movement.orderId === orderId).map((movement) => ({ ...movement }));
}

function reset() {
  movements.length = 0;
}

module.exports = { REASONS, recordMovement, movementsOf, movementsOfOrder, reset };
