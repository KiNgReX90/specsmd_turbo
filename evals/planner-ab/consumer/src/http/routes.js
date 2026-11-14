'use strict';

/** The public API: method and path to handler. The server maps an error's code to a 4xx. */

const { issueCard, getCard } = require('../giftcards/cards');
const { checkout } = require('../orders/checkout');
const { refundOrder } = require('../orders/refund');
const { buildExport } = require('../accounting/export');
const { sendEmail } = require('../notify/mailer');

const ROUTES = {
  'POST /cards': (body) => {
    const card = issueCard(body);
    sendEmail(card.recipientEmail, 'card-delivered', { code: card.code, amountCents: card.balanceCents, currency: card.currency, expiresAt: card.expiresAt });
    return card;
  },
  'GET /cards/:code': (body, params) => {
    const card = getCard(params.code);
    return { code: card.code, balanceCents: card.balanceCents, currency: card.currency, expiresAt: card.expiresAt };
  },
  'POST /orders': (body) => checkout(body),
  'POST /orders/:id/refund': (body, params) => refundOrder({ orderId: params.id, lineIndexes: body.lineIndexes || null }),
  'POST /admin/accounting-export': () => ({ file: buildExport() }),
};

const STATUS = { UNKNOWN_CARD: 404, UNKNOWN_ORDER: 404, EXPIRED: 409, CURRENCY: 409, INSUFFICIENT_BALANCE: 409, ALREADY_REFUNDED: 409, GIFT_CARD_SHARE: 409 };

module.exports = { ROUTES, STATUS };
