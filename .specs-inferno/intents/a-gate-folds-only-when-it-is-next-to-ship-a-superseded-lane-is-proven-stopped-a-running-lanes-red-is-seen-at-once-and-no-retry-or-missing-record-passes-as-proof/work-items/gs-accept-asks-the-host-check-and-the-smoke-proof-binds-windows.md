---
id: gs-accept-asks-the-host-check-and-the-smoke-proof-binds-windows
title: "Accept asks the host's check, and the smoke proof binds the Windows lane"
intent: a-gate-folds-only-when-it-is-next-to-ship-a-superseded-lane-is-proven-stopped-a-running-lanes-red-is-seen-at-once-and-no-retry-or-missing-record-passes-as-proof
kind: behavior
complexity: high
mode: autopilot
status: pending
depends_on: []
created: 2026-11-06
---

# Work Item: Accept asks the host's check, and the smoke proof binds the Windows lane

## Description

Plan items 2d and 2e with amendment 3. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`.

1. **Three optional lane keys.** In `S/run-lane-config.cjs`, `validLane` (:17-22) accepts beside `command` and `scope` an optional `accept_check` and `stop` (each a non-empty string) and `red_line` (a string `new RegExp` compiles); the refusal message (:28-30) names them. `configuredLanes` (:48-52) carries each one that is set. `inheritLanes` already copies a lane whole, so a `--config` file inherits them. `stop` and `red_line` get their readers in later items.
2. **Accept asks the host.** In `S/run-lanes.cjs` `accept` (:190-219), after the `NOTHING_TO_ACCEPT` refusal (:205-208) and before the record is written (:209-210): when `lane.accept_check` is set, run it with `lib.runShell` in the tree, logging to `lane-<name>-accept-<stamp>.log` in the branch cache dir, with these set in the environment: `INFERNO_LANE` the lane name, `INFERNO_LANE_LOG` the accepted result's `log`, `INFERNO_LANE_RUN` its `run`, `INFERNO_GATE_CONFIG` the config path relative to the tree (the `config` field `S/run-proofs.cjs:63` computes). `lib.runShell` (`S/run-lib.cjs:351-372`) inherits `process.env`, so set them on `process.env` in this one-shot process. A non-zero exit returns exit 2 with `refused: the <name> lane's accept_check exited <code>: <its last non-empty output line>` and `log <path>`, and writes no `.instrument-red` record. Exit 0 continues to today's record and lines.
3. **The smoke proof binds the Windows lane.** `laneProof` (:34-36) takes the config. When the lane is `smoke` and a `windows` lane is configured, the key is `commandProof(tree, {}, selected, \`${smoke.command} (folds windows: ${windows.command})\`, <the sorted unique union of both scopes>)`; any other lane keys as today. Every caller passes the config it already holds (:80, :99, :104, :141, :203, :226).
4. **The lane sees the gate's config.** `laneNow` (:96-115) sets `process.env.INFERNO_GATE_CONFIG` to the same tree-relative config path before `lib.runShell` (:103), so the lane command and its children read the config the gate used.

The first red test: "accept runs the lane's accept_check and refuses on its non-zero exit, writing no record", which fails today because accept records any instrument red against a harness fix on the base.

## Acceptance Criteria

- [ ] `S/run-lanes.test.cjs` new cases, on `S/run-lanes-fixture.cjs` with a lane `accept_check` stub `node check.cjs <exit>` that writes its environment to a file outside the tree:
  - "accept runs the lane's accept_check and refuses on its non-zero exit, writing no record": `smoke --accept --harness-fix <sha>` exits 2 with the check's last line, no `.instrument-red` file exists, and `green` exits 3.
  - "an accept_check that exits 0 accepts and saw the lane, its run, its log and the config": the stub's file holds `INFERNO_LANE=smoke`, the run and log of `lane-smoke-job.result.json`, and `INFERNO_GATE_CONFIG=.specs-inferno/config.yaml`; `green` exits 0.
  - "the smoke proof changes when the windows lane's command changes, and with no windows lane keys as before": the smoke proof file differs between two windows commands and equals `commandProof(tree, {}, selected, smoke.command, smoke.scope).file` with no windows lane.
  - "the lane command sees INFERNO_GATE_CONFIG": a lane stub that writes the variable gets `.specs-inferno/config.yaml`, and the `--config` file's relative path when one is selected.
- [ ] `S/run-lanes-config.test.cjs` new case "accept_check, stop and red_line are optional strings, and a red_line that is no pattern is refused": `red_line: "("` refuses with `BAD_CONFIG`; a lane with all three set is read with all three.
- [ ] The existing accept cases (`S/run-lanes.test.cjs:70-215`) pass unchanged: a lane without `accept_check` accepts as today.
- [ ] `node --test S/run-lanes.test.cjs S/run-lanes-config.test.cjs S/run-lanes-wait.test.cjs` reports 0 fail.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
      reason: laneProof at 34-36, laneNow at 96-115, accept at 190-219
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lane-config.cjs
      reason: validLane at 17-22 and configuredLanes at 48-52
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-proofs.cjs
      reason: commandProof at 61-67 makes the relative config field, read only
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
      reason: laneNow at 96-115 runs a host command with runShell into a branch cache log
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-fixture.cjs
      reason: the stub lane and config builder at 40-75
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.test.cjs
      reason: the accept cases at 70-215 and the new cases
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-config.test.cjs
      reason: the lane shape case at 31-48 and the new key case
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lane-config.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-fixture.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.test.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-config.test.cjs
probes:
    - run: "grep -cF 'return proofs.commandProof(tree, {}, selected, lane.command, lane.scope);' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs"
      shows: "1"
    - run: "grep -c accept_check src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lane-config.cjs || true"
      shows: "0"
finalize_check: "node --test src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.test.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-config.test.cjs"

## Technical Notes

- The flow names its variables `INFERNO_*` (as `INFERNO_FLOW_BUDGET`, `S/run-budget.cjs:29`, and `INFERNO_MUTANT`), never the host's `DF_*`: the flow is installed in Skoft_Files too and carries no host name. Skoft_CRA's lane intent reads `INFERNO_GATE_CONFIG` and `INFERNO_LANE_LOG` where its brief wrote `DF_GATE_CONFIG` and `DF_LANE_LOG`; the value of the config variable is the tree-relative path its brief pinned.
- Amendment 3: the host's check accepts a run without `verdicts.json` only on the lane's own closing line with every class line PREDATES; that predicate is the host's (Skoft_CRA `scripts/integration-lane-fold.mjs:112-117`), the flow only runs the check and honours its exit.
- The key change revokes every smoke proof on a host with both lanes, once. The council found none of the live Skoft_CRA intents holding a lane proof (plan, B missed 3), and Skoft_Files configures no Windows lane, so its smoke proofs keep their keys.
- Proven stays proven: a lane without the new keys validates, keys, accepts and runs exactly as today; accept can only refuse more, and a smoke proof now stands only for the Windows definition it was minted under, which `green` already lets it stand for (`S/run-lanes.cjs:222-235`).

## Dependencies

(none)
