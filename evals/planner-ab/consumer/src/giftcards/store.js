'use strict';

/**
 * The card store. It keeps cards by code and knows nothing about balances: a balance change
 * goes through recordMovement in src/ledger/movements.js, which calls saveCard itself.
 */

const cards = new Map();

function saveCard(card) {
  cards.set(card.code, { ...card });
  return card;
}

function loadCard(code) {
  const card = cards.get(code);
  return card ? { ...card } : null;
}

function allCards() {
  return [...cards.values()].map((card) => ({ ...card }));
}

function reset() {
  cards.clear();
}

module.exports = { saveCard, loadCard, allCards, reset };
