---
id: gs-a-running-lane-red-ends-the-wait
title: "A running lane's red line ends the wait while the lane walks on"
intent: a-gate-folds-only-when-it-is-next-to-ship-a-superseded-lane-is-proven-stopped-a-running-lanes-red-is-seen-at-once-and-no-retry-or-missing-record-passes-as-proof
kind: behavior
complexity: medium
mode: autopilot
status: completed
completed_at: 2026-11-06T18:39:16Z
depends_on: [gs-accept-asks-the-host-check-and-the-smoke-proof-binds-windows]
created: 2026-11-06
---

# Work Item: A running lane's red line ends the wait while the lane walks on

## Description

Plan item 2c. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`. Today a lane's log is found only from its result, written when the walk ends (`S/run-lanes.cjs:113`), so `gate --wait` reports a lane red only at the end of the whole walk.

1. **The running lane names its log.** `S/run-jobs.cjs` `jobPaths` (:19-27) gains `run: <stem>.run.json`. `laneNow` (`S/run-lanes.cjs:96-115`) writes `{ run: runId, log, started }` to `jobPaths(tree, lane.name).run` with `writeRecord` (:38-43) before `lib.runShell` (:103).
2. **The wait reads it.** `laneState` (:118-125): for a running lane whose config sets `red_line` (validated by `gs-accept-asks-the-host-check-and-the-smoke-proof-binds-windows`) and whose run file's `started` is not before the job's `started`, read the log and take the first line matching `new RegExp(red_line)`; when there is one, return `{ lane, state: 'running-red', pid: job.pid, log, line }`. `laneState` takes the config for this, from `waitAll` (:155).
3. **The line ends the wait.** `describeLane` (:133-147) maps `running-red` to verdict `red` with the one line `RED lane <name> while it walks: <line> -> <log>`. `waitAll` already returns exit 2 on a red verdict (:166-169), and nothing stops the lane: it walks on and writes its result as today.
4. **The fixture.** `S/run-lanes-fixture.cjs` lane stub (:68-77) gains the token `redwait`: print `PRODUCT RED demo: red on the branch` to stdout, then hold like `wait`.

The first red test: "a running lane's red line ends the wait with exit 2 while the lane walks on", which exits 4 today.

## Acceptance Criteria

- [ ] `S/run-lanes-wait.test.cjs` new cases:
  - "a running lane's red line ends the wait with exit 2 while the lane walks on": lane `smoke` on `redwait` with `red_line: "^PRODUCT RED "`; `gate --wait --minutes 0.1` exits 2 and prints `RED lane smoke while it walks: PRODUCT RED demo: red on the branch`, and the lane job is still alive afterwards (`jobs.alive` on `lane-smoke-job.json`).
  - "without red_line the same lane keeps the wait at 4".
  - "a line the pattern does not match keeps the wait at 4": `red_line: "^NOT RED FIRST "`.
  - "a red line from an earlier run of the lane is not read": a run file whose `started` precedes the live job's keeps the wait at 4.
- [ ] `node --test S/run-lanes-wait.test.cjs S/run-lanes.test.cjs S/run-lanes-config.test.cjs` reports 0 fail.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
      reason: laneNow at 96-115, laneState at 118-125, describeLane at 133-147, waitAll at 153-187
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-jobs.cjs
      reason: jobPaths at 19-27
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-fixture.cjs
      reason: the lane stub at 68-77
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
      reason: writeRecord at 38-43 and the product-red branch of describeLane at 136-138
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-wait.test.cjs
      reason: the wait cases at 20-96, which the new cases join
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-jobs.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-fixture.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-wait.test.cjs
probes:
    - run: "grep -c 'pid: job.pid, log: paths.log' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs"
      shows: "1"
    - run: "grep -c 'run.json' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-jobs.cjs || true"
      shows: "0"
finalize_check: "node --test src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-wait.test.cjs"

## Technical Notes

- The pattern is the host's because only the host knows which class lines a branch owes. Skoft_CRA's are `PRODUCT RED`, `NOT RED FIRST`, `BRANCH HARNESS RED` and `CARRIED FIXED` (`scripts/integration-classify.mjs:30`), each at the start of a line (`scripts/integration-lane-fold.mjs:112-117`); the reinstall recipe in the brief sets that pattern.
- The log is read whole on each poll; a lane log is small next to the 500 ms poll of `waitAll` (:185), and only a running lane with `red_line` set is read.
- With the slot of `gs-the-gate-folds-only-at-the-head-of-the-slot`, the exit 2 releases the ticket while the lane walks on, and the shim keeps that tree at the head until the lane ends or is superseded.
- Proven stays proven: the run file is new and read only for a running lane with `red_line` set; a lane's result, proof and accept are untouched, and an early red only ends a wait sooner than its exit 10 would.

## Dependencies

- gs-accept-asks-the-host-check-and-the-smoke-proof-binds-windows
