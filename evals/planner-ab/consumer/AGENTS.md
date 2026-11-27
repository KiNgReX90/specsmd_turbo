# AGENTS.md

Instructions for coding agents in the Acme Shop repository. Read them before you change anything.

## Layout

- `src/giftcards/`: issuing cards, their store and redemption at checkout.
- `src/ledger/`: every balance movement of a card. The only module that changes a balance.
- `src/accounting/`: the nightly export the accountants import, and its queue.
- `src/orders/`: checkout, the order store and refunds.
- `src/payments/`: the card payment provider client.
- `src/notify/`: emails and their templates.
- `src/http/`: the route table of the public API.
- `docs/`: the decision records and the accounting export format.
- `test/`: one test file per module, `node --test`.

## Rules

- Money is integer cents. Never use a float for money, not even in a test.
- A card's balance changes only through `recordMovement` in `src/ledger/movements.js`. It writes
  the movement, saves the card and queues the accounting line in one call. Never call
  `saveCard` to change a balance.
- A redemption that would take a balance below zero is refused with `INSUFFICIENT_BALANCE`.
- A refund goes back to the card that paid, never to a new card.
- Every email goes through `sendEmail` with a template from `src/notify/templates.js`.
- The accounting export format is a contract with the accountants: `docs/accounting-export.md`
  is its source, and a new line type is added there first.

## Before you commit

Run `npm test`. Never commit a red test.
