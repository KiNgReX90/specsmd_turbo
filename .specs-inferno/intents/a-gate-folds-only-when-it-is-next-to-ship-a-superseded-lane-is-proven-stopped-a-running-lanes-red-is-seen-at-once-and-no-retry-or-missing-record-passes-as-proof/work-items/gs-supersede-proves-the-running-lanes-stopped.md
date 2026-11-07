---
id: gs-supersede-proves-the-running-lanes-stopped
title: "Supersede starts a gate only after the running lanes are proven stopped"
intent: a-gate-folds-only-when-it-is-next-to-ship-a-superseded-lane-is-proven-stopped-a-running-lanes-red-is-seen-at-once-and-no-retry-or-missing-record-passes-as-proof
kind: behavior
complexity: high
mode: autopilot
status: completed
completed_at: 2026-11-07T00:25:40Z
depends_on: [gs-a-direct-build-takes-the-slot-and-starts-only-the-lanes]
created: 2026-11-06
---

# Work Item: Supersede starts a gate only after the running lanes are proven stopped

## Description

Plan item 2b. Today a fix cannot gate while the tree's earlier lane still walks (`GATE_RUNNING`, `S/run-gate.cjs:315-321`), and nothing proves a stopped walk is gone. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`.

1. **Jobs record their head.** `gateDetach` passes `head: <HEAD after the fold>` into the gate job's fields (:339) and `startLanes` into each lane job's (`S/run-lanes.cjs:88`).
2. **`gate --detach --supersede`.** New module `S/run-supersede.cjs`, called by `gateDetach` in place of the live-job refusal when `options.supersede` is set (`--supersede` without `--detach` is `BAD_ARGS`). Over the tree's live jobs (`jobs.everyJob(tree).filter(jobs.alive)`), every refusal comes before any signal:
   - no live lane job: refused, `nothing to supersede: no lane of this tree is running`; a live gate job alone keeps today's `GATE_RUNNING`.
   - a live job without `head` (an older runner started it): refused, `the running gate predates supersede; wait for it: <gateWaitCall>`.
   - a live lane whose config has no `stop` (validated by `gs-accept-asks-the-host-check-and-the-smoke-proof-binds-windows`): refused, `cannot prove the <lane> lane stopped: set verification.<lane>.stop`.
   - no path of `git diff --name-only <job.head> HEAD` lies in the scope of a live lane: refused, `the fix changes nothing a running lane proves; wait for it: <gateWaitCall>`.
   Then: write `supersede-pending.json` (lanes, pids, logs) in the branch cache dir; send SIGTERM to each live job's process group (`process.kill(-pid)`; `jobs.detach` spawns detached, `S/run-jobs.cjs:73-75`), poll `jobs.alive` up to 10 s, then SIGKILL; run each superseded lane's `stop` with `lib.runShell` in the tree, with `INFERNO_LANE`, `INFERNO_LANE_PID`, `INFERNO_LANE_LOG` (from the lane's run file, `gs-a-running-lane-red-ends-the-wait`) and `INFERNO_GATE_CONFIG` set. When every stop exits 0 and no job pid is alive: delete the pending file, release the tree's ticket (`slot.release`), print `superseded <lane> lane pid <pid>: stopped, proven by its stop check`, and continue with today's detach, which takes a new ticket. Otherwise exit 2 with each failing stop's last line and its log, and keep the pending file.
3. **A pending supersede blocks a plain detach.** While `supersede-pending.json` exists, `gate --detach` without `--supersede` refuses `SUPERSEDE_PENDING`, `a superseded lane is not proven stopped: run <gateSupersedeCall(tree)>`, and `--supersede` reruns the recorded lanes' stop checks.
4. **Calls and usage.** `S/run-call.cjs` gains `gateSupersedeCall(tree)`; `--supersede` joins `FLAGS` and the USAGE of `S/run.cjs`.

The first red test: "supersede stops a walking lane whose scope the fix touched and starts the gate on the fix", which fails today with `GATE_RUNNING`.

## Acceptance Criteria

- [ ] New `S/run-supersede.test.cjs` on `S/run-lanes-fixture.cjs` (Linux only, like `S/run-lanes-config.test.cjs:84`), with lane `smoke` on `wait` and a `stop` stub `node stop.cjs <exit>` that writes its environment to a file outside the tree, passes:
  - "supersede stops a walking lane whose scope the fix touched and starts the gate on the fix": after a commit to `src/`, `gate --detach --supersede` exits 0, the old lane pid is dead, the stop stub saw `INFERNO_LANE=smoke` and the old pid, and `lane-smoke-job.json` names a new pid.
  - "a fix outside every running lane's scope is refused and the lane walks on": a commit to `docs/` only; exit 2 and the old lane is alive.
  - "a running lane with no stop is refused before any signal": the lane stays alive.
  - "a failing stop keeps the supersede pending and a plain detach refuses": `stop` exits 1; exit 2, then `gate --detach` refuses `SUPERSEDE_PENDING`; with `stop` at 0, `--supersede` then starts the gate.
  - "a running job without head is refused": a hand-written job file without `head` naming a live `run.cjs` process.
- [ ] `node --test S/run-supersede.test.cjs S/run-lanes-wait.test.cjs S/run-gate-cli.test.cjs S/run-slot-gate.test.cjs` reports 0 fail.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs
      reason: gateDetach at 310-346 with the live job refusal at 315-321
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-jobs.cjs
      reason: alive at 39-52, everyJob at 55-59, detach at 69-85
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
      reason: startLanes at 72-93 writes the lane jobs
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/state-store.cjs
      reason: run-slot.cjs lands beside it from gs-the-merge-slot-queues-tickets-across-worktrees, its release frees the old ticket
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs
      reason: FLAGS and USAGE
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-processes.cjs
      reason: stopOwnedProcesses at 126-145 signals only a process it can identify
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-wait.test.cjs
      reason: the detach refusal while a lane runs at 88-96 stays green
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-config.test.cjs
      reason: the live job fixture at 84-106 the new suite run-supersede.test.cjs mirrors
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-supersede.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-call.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-supersede.test.cjs
probes:
    - run: "grep -c supersede src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs || true"
      shows: "0"
    - run: "ls src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-supersede.cjs 2>/dev/null | wc -l"
      shows: "0"
finalize_check: "node --test src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-supersede.test.cjs"

## Technical Notes

- The host proves the stop because only it knows where the walk runs: Skoft_CRA's walks escape the lane's process group (`claude-build` runs each in its own group, plan A1d) and run on Delta or as a Beta task. The council's "refused when the fix touches neither BUILD_INPUTS nor HARNESS" is the lane scope here, which is `PROVEN_PATHS` on Skoft_CRA.
- Skoft_CRA's lane intent records lane owners (`<cache>/dossierforge/lane-owners/<lane>/<name>.json`) but pins no stop command; its `verification.<lane>.stop` command reads those records, kills the walk pids and the Beta task and proves the Delta lock free. Until that command is on main, supersede on Skoft_CRA refuses and the orchestrator waits, as today.
- Killing the gate job stops the finalize runner; a finalize command it wrapped can outlive it, and it can mint no proof, because only the killed runner writes one (`S/run-proofs.cjs:85-103`).
- Proven stays proven: supersede only stops work and starts the same gate on the fixed tree; a lane proof is minted only by a lane that finished, and the pending file keeps a half-stopped walk from being raced by a new one.

## Dependencies

- gs-a-direct-build-takes-the-slot-and-starts-only-the-lanes
