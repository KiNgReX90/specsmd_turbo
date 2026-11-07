---
id: gs-a-direct-build-takes-the-slot-and-starts-only-the-lanes
title: "A direct build takes the slot by hand and starts only the lanes"
intent: a-gate-folds-only-when-it-is-next-to-ship-a-superseded-lane-is-proven-stopped-a-running-lanes-red-is-seen-at-once-and-no-retry-or-missing-record-passes-as-proof
kind: api
complexity: medium
mode: autopilot
status: completed
completed_at: 2026-11-06T22:46:33Z
depends_on: [gs-the-gate-folds-only-at-the-head-of-the-slot]
created: 2026-11-06
---

# Work Item: A direct build takes the slot by hand and starts only the lanes

## Description

The flow side of plan item 2i, in the shape Skoft_CRA's lane intent pinned (`/home/ruben/dev/Skoft_CRA/.specs-inferno/intents/the-real-app-lane-reports-each-red-as-it-walks-and-proves-every-journey-it-planned/brief.md`, Notes, "Flow interface"): its `scripts/integrate-direct.mjs` takes a ticket before it commits on main, starts both lanes through the flow, waits, pushes and releases. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`.

1. **`run.cjs slot`.** A new command handled by a `slotCommand(options)` exported from `S/run-slot.cjs`:
   - `slot --take --holder <name> [--tree <dir>] [--config <file>]`: exit 0 at the head, exit 4 behind with `queued behind <holder> (<n> ahead)`; eviction lines print first.
   - `slot --renew --holder <name>` and `slot --release --holder <name>`: exit 0.
   - `slot [--tree <dir>]` alone prints the queue, the shim heads first, one line per holder.
   - With `mergeSlot(config)` false every form prints `no verification.merge_slot in <file>: there is no queue` and exits 0, so a driver on a host without the key never waits.
   - `S/run.cjs`: `--take`, `--renew`, `--release` and `--lanes-only` join `FLAGS` (:154); `slot` joins `COMMANDS` (:120-148) and stays out of `OWNING` (:151); the USAGE text (:44-100) carries the lines `node run.cjs slot --take --holder <name> [--tree <dir>]`, `node run.cjs slot --release --holder <name> [--tree <dir>]` and `node run.cjs gate --detach --lanes-only [--since <ref>] [--tree <dir>]`, verbatim, because Skoft_CRA's contract test reads them from the installed usage.
2. **`gate --detach --lanes-only [--since <ref>]`.** In `gateDetach` (`S/run-gate.cjs:310-346`): with `--lanes-only`, refuse a dirty tree and a live job as today, then take no ticket (the caller holds one), skip `intentFor`, the fold and the review refusal, start the configured lanes `startLanes` (:332) picks from `changedPaths(tree, options.since || mergeBase(tree, base))`, and write a gate job file with no pid, its `config` (as :339 records it), `lanes_only: true` and those lanes, plus a result file `{ ok: true, lanes_only: true, results: [], hash: lib.codeTreeHash(tree) }`, so `gate --wait` (:362-375) waits on the lanes alone through `waitAll`. `--since` is refused without `--lanes-only`, and `--lanes-only` without `--detach`.
3. **Printed calls.** `S/run-call.cjs` gains `slotCall(tree, verb, holder)` for any line that prints a slot call.

The first red test: "slot --take exits 4 behind another holder", which fails today with `unknown command: slot`.

## Acceptance Criteria

- [ ] New `S/run-slot-cli.test.cjs` passes:
  - "slot --take exits 4 behind another holder and 0 at the head": two holders on one fixture repository with `merge_slot: true`.
  - "slot --release frees the head for the next holder".
  - "slot without merge_slot says there is no queue and exits 0".
  - "the usage carries the three driver lines": `node run.cjs --help` contains each verbatim.
  - "gate --detach --lanes-only on the base branch starts the lanes the diff since --since touched, and gate --wait waits on them": on `main` with a commit touching `src/`, `--since HEAD~1` starts the smoke lane, no finalize command runs, and the wait exits 0 green; with `--since HEAD` it prints `SKIP smoke`.
  - "--since without --lanes-only is refused".
- [ ] `node --test S/run-slot-cli.test.cjs S/run-gate-cli.test.cjs S/run-lanes.test.cjs S/run.test.cjs` reports 0 fail, and `npx vitest run __tests__/unit/inferno/printed-calls.test.ts` in `src/` reports 0 failed.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs
      reason: USAGE at 44-100, COMMANDS at 120-148, OWNING at 151, FLAGS at 154
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs
      reason: gateDetach at 310-346 and gateWait at 362-375
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/state-store.cjs
      reason: run-slot.cjs lands beside it from gs-the-merge-slot-queues-tickets-across-worktrees, its take, renew, release and queue sit behind the command
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-call.cjs
      reason: the printed call builders at 39-117
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
      reason: accept at 190-219 is a lane command with its own usage refusal and exit
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate-cli.test.cjs
      reason: the detach and wait cases stay green
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.test.cjs
      reason: the argument parser cases stay green
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-slot.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-call.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-slot-cli.test.cjs
probes:
    - run: "grep -c 'const FLAGS = new Set' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs"
      shows: "1"
    - run: "grep -c 'lanes-only' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs || true"
      shows: "0"
finalize_check: "node --test src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-slot-cli.test.cjs"

## Technical Notes

- Skoft_CRA's lane intent pinned `slot --take`, `slot --release` and `gate --detach --lanes-only`; this item adds `--since`, because on the base branch the merge base is HEAD and no lane would see the commit the driver just made. The driver passes its pre-edit sha.
- `--lanes-only` takes no ticket because the driver already holds one under its own holder name; a second ticket for the branch would queue the driver behind itself.
- The synthesized green result names `lanes_only`, so nothing reads it as a finalize proof: no proof file is written for it.
- Proven stays proven: both forms are new; a call without them takes today's path, and a lane started this way mints and checks its proof exactly as a gate's lane does.

## Dependencies

- gs-the-gate-folds-only-at-the-head-of-the-slot
