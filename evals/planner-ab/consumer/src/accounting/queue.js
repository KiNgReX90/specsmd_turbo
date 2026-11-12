'use strict';

/** The lines waiting for tonight's accounting export. The export drains them. */

const pending = [];

function enqueue(line) {
  pending.push(line);
}

function drain() {
  return pending.splice(0, pending.length);
}

function size() {
  return pending.length;
}

module.exports = { enqueue, drain, size };
