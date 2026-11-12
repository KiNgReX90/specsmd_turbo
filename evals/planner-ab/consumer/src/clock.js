'use strict';

/** The one clock of the service, so a test can pin the date. */
let pinned = null;

function now() {
  return pinned ? new Date(pinned) : new Date();
}

function pin(iso) {
  pinned = iso;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

module.exports = { now, pin, addDays };
