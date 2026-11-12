'use strict';

const { format } = require('../money');

/** Every email the shop sends, by template name. Each returns its subject and body. */
const TEMPLATES = {
  'card-delivered': ({ code, amountCents, currency, expiresAt }) => ({
    subject: 'Your Acme Shop gift card',
    body: `Your gift card ${code} holds ${format(amountCents, currency)} and is valid until ${expiresAt.slice(0, 10)}.`,
  }),
  'order-receipt': ({ orderId, totalCents, currency }) => ({
    subject: `Your order ${orderId}`,
    body: `Thank you for your order. You paid ${format(totalCents, currency)}.`,
  }),
  'refund-confirmation': ({ orderId, amountCents, currency }) => ({
    subject: `Refund for order ${orderId}`,
    body: `We refunded ${format(amountCents, currency)} to your card.`,
  }),
};

function render(name, data) {
  const template = TEMPLATES[name];
  if (!template) throw new Error(`no email template ${name}`);
  return template(data);
}

module.exports = { TEMPLATES, render };
