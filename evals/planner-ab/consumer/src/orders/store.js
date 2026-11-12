'use strict';

/** The order store, by order id. */

const orders = new Map();

function saveOrder(order) {
  orders.set(order.id, JSON.parse(JSON.stringify(order)));
  return order;
}

function loadOrder(id) {
  const order = orders.get(id);
  return order ? JSON.parse(JSON.stringify(order)) : null;
}

function reset() {
  orders.clear();
}

module.exports = { saveOrder, loadOrder, reset };
