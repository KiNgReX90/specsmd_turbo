# CLAUDE.md

Guidance for agents that work in the Acme Shop repository. Acme Shop sells digital gift
cards: a customer picks a design and an amount, pays, and the card arrives by email with a
code the recipient redeems at checkout. Read this file before you change anything.

## What lives where

- `api/` is the order and card service, TypeScript on Node 22, with a Postgres database.
- `web/` is the storefront, a React app that talks only to `api/` through `web/src/client/`.
- `jobs/` holds the scheduled work: the nightly expiry sweep and the email retry queue.
- `schema/` holds the JSON schemas of every public payload. A change there is a contract change.
- `migrations/` holds the numbered SQL migrations. Never edit one that has shipped; add a new one.
- `docs/` holds the decision records. Read the newest one on a topic before you change it.

## Commands

- `npm run check` runs the linter, the type check and the unit tests of every package.
- `npm run test:api` runs the API tests against a throwaway database it starts itself.
- `npm run test:web` runs the storefront tests in a headless browser.
- `npm run db:reset` rebuilds the local database from the migrations and the seed data.
- `npm run dev` starts the API on port 4100 and the storefront on port 4200.

Run `npm run check` before every commit. A red check is never committed, not even as a work in
progress.

## Money and balances

- Amounts are integer cents in a `bigint` column and a `number` in code. Never use a float for
  money, not even in a test.
- A card's balance changes only through `api/src/ledger/`. Every change writes a ledger row
  first and updates the cached balance in the same transaction.
- A redemption that would take a balance below zero is refused with `INSUFFICIENT_BALANCE`. It
  never partially succeeds.
- Currency is fixed per card at purchase. A card bought in euros is redeemed in euros.
- Refunds go back to the card that paid, never to a new card, and they write their own ledger
  row with the order it refunds.

## Codes and security

- A card code is twelve characters from the reduced alphabet in `api/src/codes/alphabet.ts`,
  with no vowels and no look-alike pairs. Never generate one anywhere else.
- A code is stored only as a salted hash. Logs, errors and test snapshots never hold a code in
  the clear; use the last four characters when you need to tell two cards apart.
- Five wrong code attempts from one session lock redemption for fifteen minutes.
- Secrets come from the environment through `api/src/config.ts`. Never read `process.env`
  anywhere else, and never commit a `.env` file.

## Emails

- Every customer email is a template under `api/templates/email/`, in English and in Dutch.
  A new template ships both languages or none.
- A failed send goes to the retry queue in `jobs/email-retry/` and is retried three times with
  growing waits, then reported to the support inbox.
- The recipient's address is validated at checkout. Do not validate it again at send time.

## Tests

- Every change ships with the tests that prove it. A bug fix starts with a test that fails for
  the reason the bug exists.
- API tests use the factories in `api/test/factories/`. Do not build rows by hand.
- A test that needs the clock uses `api/test/clock.ts` and never sleeps.
- The storefront tests select elements by role and visible text, never by class name.

## Style

- TypeScript strict mode everywhere. No `any`, no non-null assertion without a comment that
  says why it holds.
- Names say what a thing is in the shop's words: card, order, design, redemption, ledger.
- A function that touches the database takes the transaction as its first argument.
- Keep files under four hundred lines. Split by responsibility before a file passes that.
- Comments explain why, not what. Delete a comment the code already says.

## Commits and reviews

- One change per commit, with a subject that says what the shop does differently afterwards.
- A change to `schema/`, `migrations/` or `api/src/ledger/` needs a second reviewer.
- Never push to `main` directly. Every change goes through a merge request with a green pipeline.

## When you are unsure

Stop and ask when a requirement could mean two things, when a change would touch money in a
way the tests do not cover, or when a migration would rewrite existing rows. A short question
costs less than a wrong balance.
