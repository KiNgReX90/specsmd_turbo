# Handoff: a commit to a path no check is meant to read still moves the proof of every unscoped finalize command, so ship's fold of such a commit on the base owes a whole gate again

Row 0bf. Met on the first host on 2026-11-21 by the Delta session of `the-product-page-wears-chapter-arcs` (outbox line 285), on the build at `a8873ebb`; the tip `9d8eafea` holds the same code.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

## What is wrong

1. **Ship re-checks the folded tree.** It folds the base (`S/run-ship.cjs:98-111`), then requires `green` (`:113-117`), which fails when any finalize command has no proof for the tree now (`S/run-gate.cjs`, `green`: `missing`).
2. **An unscoped command reads every path.** A command with no `finalize_scopes` entry hashes the whole tree but the ledger (`scopeHash` with no scope, `S/run-proofs.cjs:27-60`; the ledger is left out by `lib.inLedger`). So a commit on the base that touches only a knowledge folder moves its proof, and ship exits 3.
3. **A host cannot say "no check reads this".** Scopes are allow-lists with no negation (`lib.matchesAny`, `S/run-lib.cjs:312-314`). So an unscoped command that must read nearly everything, such as a secret scan, cannot leave out one folder without listing every other one. A new top-level folder would then escape it.

## Evidence

- The session's WASTE line, verbatim: "WASTE grok commit landing on a closed main | lost: about 0.5 h of Delta gate | fix: grok/wiki pushes take main.lock too, or ship accepts a fold that touches only grok/ and wiki/".
- The host lets its knowledge-base sessions push `grok/` and `wiki/` to `main` past the ship lock on purpose (their commits reach `main` in the same turn, the host's `CLAUDE.md`), so the first half of the session's fix is not open to it.
- The host's finalize commands, read on Alpha 2026-11-21 with the installed `readConfig`: eight carry a scope and none of those scopes, nor the smoke or Windows lane's, names `grok/` or `wiki/`. Three are unscoped: `npm install`, `npm run check:secrets` and `npm run verify:site`. Those three are what the fold moved.

## How to fix

1. **A host key for paths no check reads.** `verification.unchecked` (a list of globs, default empty): `scopeHash` leaves those paths out for every command, scoped or not, as it leaves out the ledger. So does a lane's proof. A commit that touches only them moves no proof, and ship's `green` after such a fold passes with no gate.
2. **The key is never a hiding place for code.** `plan-lint` and `verify-item` refuse an item that owns a path under it, and `gate` prints `unchecked: <globs>` once per run, so a reader sees what no check read.

Tests, beside `S/run-proofs.test.cjs` and `S/run-ship.test.cjs`:

- With `unchecked: [kb/**]`, a commit under `kb/` keeps the proof of an unscoped command and of a scoped one, and ship after folding it exits 0.
- A commit outside it still moves the unscoped command's proof, and ship exits 3 as today.
- An item that owns `kb/x.md` is refused by `plan-lint`.

## Which part is the flow and which the host

The key is the flow's. The host's own part: give `npm install` and `npm run verify:site` the scopes of what they read. Then a `grok/` or `wiki/` fold moves only `npm run check:secrets`, which should keep reading every path until the flow's key lets the host leave out the two folders. The host's pre-commit hook already scans their commits.

## Until it is built

On the host: a ship refused with exit 3 after folding a `main` that moved only by `grok/` or `wiki/` commits owes a gate of only the unscoped commands, and it gates once more as `run.cjs ship` says.
