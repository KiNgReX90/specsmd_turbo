---
id: gs-the-orchestrator-and-planner-texts-follow
title: "The orchestrator and planner texts follow the queued gate"
intent: a-gate-folds-only-when-it-is-next-to-ship-a-superseded-lane-is-proven-stopped-a-running-lanes-red-is-seen-at-once-and-no-retry-or-missing-record-passes-as-proof
kind: docs-only
complexity: medium
mode: autopilot
status: pending
depends_on: [gs-supersede-proves-the-running-lanes-stopped, gs-ship-runs-the-host-cleanup-once-the-worktree-is-gone]
created: 2026-11-06
---

# Work Item: The orchestrator and planner texts follow the queued gate

## Description

The texts for plan items 2a to 2g, and plan item 2h. Every behaviour named here exists in the scripts once the earlier items of this intent landed; read their usage in `S/run.cjs` (`S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`) before writing.

1. **Claude orchestrator.** `src/flows/inferno/agents/orchestrator/agent.md` Finalize step 1 (:109) and step 2 (:110). Say, each once and only as the scripts behave:
   - with `verification.merge_slot` set, `gate --detach` takes a ticket and folds only at the head of the repository's queue; behind it, detach and wait exit 4 queued, and `--wait` folds and starts the gate when the ticket reaches the head, so exit 4 still means call wait again;
   - a lane whose `red_line` matches a line of its log turns the wait red while the lane walks on; once the fix is committed, `run.cjs gate --tree {path} --detach --supersede` stops the running lanes, proves them stopped through each lane's `stop` check and gates the fix, and refuses when the fix changes nothing a running lane proves;
   - an instrument red is accepted only when the lane's `accept_check` passes.
   Keep every sentence the inferno-flow test pins (`src/__tests__/unit/inferno/inferno-flow.test.ts:233-240`).
2. **Codex orchestrator.** The same facts in `src/flows/inferno/codex/skills/specsmd-inferno/references/procedure.md:133`, every call with `--config .specs-inferno/config.codex.yaml`.
3. **Script map and config template.** `src/flows/inferno/agents/orchestrator/skills/orchestrate/SKILL.md:13` names the `slot` command and `gate --detach --supersede` and `--lanes-only`. `src/flows/inferno/agents/orchestrator/config.example.yaml` documents, commented out beside the lanes (:45-64), `verification.merge_slot`, `review.outside` and each lane's `accept_check`, `stop` and `red_line`, one comment line each saying what the key switches on and that a host without it runs as before. `src/flows/inferno/README.codex.md:46` adds `slot` to the commands `--config` applies to.
   The same block documents `verification.ship_cleanup`, commented out under `verification:`, in one comment line: the host command ship and teardown run from the primary checkout once the worktree and branch are gone, with `INFERNO_BRANCH` and `INFERNO_TREE` set, whose failure prints its line and never undoes the ship (`S/run-ship.cjs` from `gs-ship-runs-the-host-cleanup-once-the-worktree-is-gone`).
4. **Planner.** In `src/flows/inferno/agents/planner/agent.md:163` and its copy `src/flows/inferno/commands/inferno-planner.md:163`, replace "A file shared with a pending intent is intent-level `depends_on_intents`, which may point at an `on_hold` intent but never at a completed one and never in a cycle." with "A file shared with a pending intent is an intent-level `depends_on_intents` edge only when the later intent calls, tests, extends or rewrites what the earlier adds; it may point at an `on_hold` intent, never at a completed one or in a cycle."

Budget: measured on Skoft_CRA on 2026-11-06, the Claude orchestrator loads 4887 of 5000 words with `agent.md` at 3285 and the Claude planner 4474 of 4500 with `commands/inferno-planner.md` at 3111; `gs-no-flake-rerun-passes-as-proof` already cut about 29 words from step 1. No date, counted duration or tally enters any of these files: the slot's bounds are the script's.

## Acceptance Criteria

- [ ] `npx vitest run __tests__/unit/inferno __tests__/unit/installer` in `src/` reports 0 failed, including the planner drift case (`inferno-flow.test.ts:53`), the gate text case (:233) and the date and tally case (:385).
- [ ] `wc -w < src/flows/inferno/agents/orchestrator/agent.md` prints 3370 or less, `wc -w < src/flows/inferno/commands/inferno-planner.md` prints 3124 or less, and `wc -w < src/flows/inferno/codex/skills/specsmd-inferno/references/procedure.md` prints 2900 or less.
- [ ] `grep -c 'calls, tests, extends or rewrites what the earlier adds' src/flows/inferno/agents/planner/agent.md src/flows/inferno/commands/inferno-planner.md` prints 1 for each.
- [ ] `grep -c -E 'merge_slot|supersede|red_line|accept_check' src/flows/inferno/agents/orchestrator/agent.md` prints 3 or more, and the same over `procedure.md` prints 3 or more.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/agent.md
      reason: Finalize steps 1 and 2 at 109-110
    - path: src/flows/inferno/codex/skills/specsmd-inferno/references/procedure.md
      reason: the Codex gate step at 133
    - path: src/flows/inferno/agents/orchestrator/config.example.yaml
      reason: the verification block and lanes at 45-64
    - path: src/flows/inferno/agents/planner/agent.md
      reason: the shared file sentence at 163
    - path: src/flows/inferno/commands/inferno-planner.md
      reason: the drift tested copy of the planner at 163
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs
      reason: the usage the texts describe, read only
  patterns:
    - path: src/flows/inferno/agents/orchestrator/agent.md
      reason: Finalize step 2 at 110 is the register and length to keep
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: the drift, gate text and narrative cases
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/agent.md
    - src/flows/inferno/codex/skills/specsmd-inferno/references/procedure.md
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/SKILL.md
    - src/flows/inferno/agents/orchestrator/config.example.yaml
    - src/flows/inferno/README.codex.md
    - src/flows/inferno/agents/planner/agent.md
    - src/flows/inferno/commands/inferno-planner.md
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-printed-calls.test.cjs
probes:
    - run: "grep -c 'A file shared with a pending intent is intent-level' src/flows/inferno/commands/inferno-planner.md"
      shows: "1"
    - run: "grep -c merge_slot src/flows/inferno/agents/orchestrator/config.example.yaml || true"
      shows: "0"

## Technical Notes

- Plan 2h, Ruben's yes on 2026-11-06: a shared file is an edge only when the later intent calls, tests, extends or rewrites what the earlier adds. Skoft_CRA's lane intent already plans by it.
- The Codex planner procedure carries no shared-file rule (`src/flows/inferno/codex/skills/specsmd-inferno-planner/references/procedure.md:59-61`), so it needs no change.
- The word bounds leave about 25 words of the Claude orchestrator's and planner's ceilings for the host's charter; the reinstall recipe measures the installed total with the budget script.
- Proven stays proven: text only; no script, proof or record changes.

## Dependencies

- gs-supersede-proves-the-running-lanes-stopped
- gs-ship-runs-the-host-cleanup-once-the-worktree-is-gone
