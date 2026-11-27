# AGENTS.md

Instructions for coding agents in the Acme Shop repository. Acme Shop sells digital gift
cards that customers buy online and recipients redeem at checkout.

## Layout

- `api/`: order and card service, TypeScript on Node 22 with Postgres.
- `web/`: React storefront; it calls the API only through `web/src/client/`.
- `jobs/`: the nightly expiry sweep and the email retry queue.
- `schema/`: JSON schemas of the public payloads; a change here is a contract change.
- `migrations/`: numbered SQL migrations; a shipped migration is never edited.

## Before you commit

1. Run `npm run check`: lint, type check and unit tests of every package.
2. Run `npm run test:api` when you touched `api/`, `jobs/` or `migrations/`.
3. Run `npm run test:web` when you touched `web/`.

Never commit a red check, and never commit a `.env` file or a card code.

## Rules that protect money

- Amounts are integer cents. No floats for money anywhere, tests included.
- Only `api/src/ledger/` changes a balance, by writing a ledger row and updating the cached
  balance in one transaction.
- A redemption below zero is refused with `INSUFFICIENT_BALANCE` and never partly applied.
- A card keeps the currency it was bought in. Refunds go back to the paying card.

## Rules that protect codes

- Codes come only from `api/src/codes/`, twelve characters from the reduced alphabet.
- Store a code only as a salted hash. Logs, errors and snapshots show the last four
  characters at most.
- Five wrong attempts in one session lock redemption for fifteen minutes.
- Configuration and secrets are read only through `api/src/config.ts`.

## Tests

- A change ships with the tests that prove it; a bug fix starts with a failing test.
- Build rows with the factories in `api/test/factories/`.
- Control time with `api/test/clock.ts`; a test never sleeps.
- Storefront tests find elements by role and visible text.

## Style

- Strict TypeScript: no `any`, and a non-null assertion carries a comment saying why it holds.
- Use the shop's words in names: card, order, design, redemption, ledger.
- A database function takes the transaction as its first argument.
- Files stay under four hundred lines.

## Review

Changes to `schema/`, `migrations/` or `api/src/ledger/` need a second reviewer. Every change
goes through a merge request with a green pipeline; nobody pushes to `main` directly.

Ask before you guess when a requirement has two readings or a change moves money in a way the
tests do not cover.
