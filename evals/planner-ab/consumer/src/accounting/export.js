'use strict';

/**
 * The nightly accounting export: one CSV line per queued movement, in the format of
 * docs/accounting-export.md. The accountants' import refuses a file with a line type it does
 * not know, so a new type is agreed in that document first.
 */

const queue = require('./queue');

const HEADER = 'type;date;card;order;amount_cents;currency;balance_cents';
const KNOWN = new Set(['GC-ISSUE', 'GC-REDEEM', 'GC-ADJUST']);

function line({ type, movement }) {
  if (!KNOWN.has(type)) throw new Error(`the export format has no line type ${type}`);
  return [type, movement.at.slice(0, 10), movement.code, movement.orderId || '', movement.deltaCents,
    movement.currency, movement.balanceCents].join(';');
}

/** Drains the queue into the text of one export file. */
function buildExport() {
  const lines = queue.drain().map(line);
  return [HEADER, ...lines].join('\n') + '\n';
}

module.exports = { HEADER, KNOWN, buildExport, line };
