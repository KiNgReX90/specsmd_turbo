# Handoff: verify-item has no host key that adds a check to every item whose change reaches a path, so a host guard that knows which paths it covers waits for integrate, or the host keys a wrapper step on the flow's `verify-<stamp>` folder name

Row 0as. Met on the first host on 2026-11-20 by its test-manager, building the host's fix for a cost an observer measured in the shipped intent `candidate-1-the-ground`, on the build at `a8873ebb`. Read in the code there; the tip `fc8d6d99` holds the same `src/`.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `a8873ebb`.

## What is wrong

1. **An item's checks come from its own spec only.** `verify-item` runs each item's `finalize_check` and nothing else (`S/run-item-proof.cjs:380-381`); an item with none prints `PASS <id> carries no finalize_check` (`:385`) and runs nothing. The planner writes `finalize_check`, item by item.
2. **The host has scoping for integrate and none for verify-item.** `verification.finalize_scopes` selects an integrate command by the paths a landing changed (`S/run-integrate.cjs:157-162`, validated beside `S/run-config-gates.cjs:85`). No key says "run this check at verify-item for every item whose change reaches these paths". A host guard that knows exactly which paths it covers then first runs inside a suite at integrate, minutes or hours later and after the item committed.
3. **So the host reaches into the flow's internals.** The only place a host can add a check to every verify-item is its session run step, and the only way that step can tell a verify-item from an integrate or a gate is the folder name the flow gives the session, `verify-<stamp>` (`S/run-item-check.cjs:55`, beside `integrate-<stamp>` and `gate-<stamp>`). A rename in the flow silently skips the host's guard, and an item with no `finalize_check` never reaches the step at all.

## Evidence

- The cost, from the shipped intent `candidate-1-the-ground` on the first host's Delta: the door item embedded two wire files with `include_str!`, and the two host guards that name such a file (`scripts/embedded-bytes.test.mjs`, `scripts/consumer-edges.test.mjs`) ran only inside `npm run test:definitions` at integrate. Two red integrates (2026-11-18 13:34Z to 16:02Z, and 23:43Z to 2026-11-19 00:24Z), the corrections `81267b7f1`, `34cee4a0e` and `ddb47bf6d` and one rerun: 3 h 38 min. Both guards end in seconds as single-file tests.
- The host's workaround, `2a1961324` on `direct/item-guards` (not yet on main): `scripts/item-guards.mjs` (128 lines) wraps the session run step (`verification.session.run: "node scripts/lint-ratchet-base.mjs node scripts/item-guards.mjs bash .../remote-run.sh session run"`), tells a verify-item session by `/^verify-./.test(basename(dirname(INFERNO_SESSION)))`, reads `git status` for a change under `src-tauri/`, and runs the guards before the item's check. Its 211-line test holds the folder name through the flow's own `runItemChecks`. Its config comment adds "An item that changes src-tauri/ carries a finalize_check, since ... an item with no check runs nothing."
- test-manager's FLOW line, 2026-11-20: "verify-item has no host key that adds a check to every item whose change reaches a path (wanted: `verification.item_checks` with paths and check), so the host adds its guards in the session run step and keys on the flow's `verify-<stamp>` folder name."

## How to fix

1. **A host key.** `verification.item_checks`, a list of `{ paths: [<glob>, ...], check: "<command>" }`, validated as `finalize_scopes` globs are (`globList`).
2. **verify-item adds what reaches.** In `S/run-item-proof.cjs` before `runItemChecks` (`:380`), each entry whose `paths` match a path the verified change touches (the paths verify-item already reads for ownership: the item's diff since its baseline and its uncommitted and untracked files) joins the checks, after the items' own `finalize_check`s and once per command, an item with no `finalize_check` included. They run through `runItemChecks` as the item's own do, so `verification.run`, `verification.session` and the refused reading place them alike, and a red is the item's red, back to its builder. The proof records them, so an unchanged tree does not run them again.
3. **The usage and the config text** name the key beside `finalize_scopes`.

Tests, beside `S/run-item-check.test.cjs` and the verify-item suite:

- An item with no `finalize_check` that changed `src/a.ts`, with an entry for `src/**` whose check fails, is red at verify-item with that check's log.
- An item that changed only `docs/` runs no entry.
- An entry whose check equals the item's own `finalize_check` runs once.
- With `verification.session`, the entry's check runs in the same session as the item's own.

## Which part is the flow and which the host

The key is the flow's. The host's part, not for the builder of the row: at the install the host drops `scripts/item-guards.mjs` from `verification.session.run`, sets `item_checks: [{ paths: ["src-tauri/**"], check: "node --import ./scripts/headless-env.mjs --test scripts/embedded-bytes.test.mjs scripts/consumer-edges.test.mjs" }]`, and items that change `src-tauri/` no longer need a `finalize_check` for the guards to run.

## Until it is built

On the host: `2a1961324` (`scripts/item-guards.mjs` in the session run step) once it lands. An item that changes `src-tauri/` carries a `finalize_check`, or the guards do not run at its verify-item.
