'use strict';

/** Sends every email through one template. The outbox stands in for the mail service. */

const { render } = require('./templates');

const outbox = [];

function sendEmail(to, template, data) {
  if (!to) throw new Error(`email ${template} has no recipient`);
  const { subject, body } = render(template, data);
  outbox.push({ to, template, subject, body });
}

function sent() {
  return outbox.map((mail) => ({ ...mail }));
}

function reset() {
  outbox.length = 0;
}

module.exports = { sendEmail, sent, reset };
