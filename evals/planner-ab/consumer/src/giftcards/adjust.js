'use strict';

const { cents } = require('../money');
const { getCard } = require('./cards');
const { recordMovement } = require('../ledger/movements');

/** A support correction of a card's balance, with the reason support gave. */
function adjustBalance({ code, deltaCents, note }) {
  cents(deltaCents);
  if (!note) throw new Error('an adjustment needs a note');
  getCard(code);
  return recordMovement({ code, deltaCents, reason: 'adjust', note });
}

module.exports = { adjustBalance };
