'use strict';

/** Money is integer cents everywhere. These helpers refuse anything else. */

function cents(value) {
  if (!Number.isInteger(value)) throw new TypeError(`not integer cents: ${value}`);
  return value;
}

/** Splits `total` over `weights` in proportion, the remainder cent going to the largest weight. */
function share(total, weights) {
  cents(total);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const parts = weights.map((weight) => Math.floor((total * weight) / sum));
  const rest = total - parts.reduce((a, b) => a + b, 0);
  const largest = weights.indexOf(Math.max(...weights));
  parts[largest] += rest;
  return parts;
}

function format(value, currency) {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(cents(value));
  return `${sign}${currency} ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

module.exports = { cents, share, format };
