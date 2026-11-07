---
id: gs-the-gate-folds-only-at-the-head-of-the-slot
title: "The gate folds and starts only at the head of the merge slot"
intent: a-gate-folds-only-when-it-is-next-to-ship-a-superseded-lane-is-proven-stopped-a-running-lanes-red-is-seen-at-once-and-no-retry-or-missing-record-passes-as-proof
kind: behavior
complexity: high
mode: autopilot
status: completed
completed_at: 2026-11-06T20:09:31Z
depends_on: [gs-no-flake-rerun-passes-as-proof, gs-a-kb-sync-keeps-the-intent-review-current, gs-the-merge-slot-queues-tickets-across-worktrees, gs-a-running-lane-red-ends-the-wait]
created: 2026-11-06
---

# Work Item: The gate folds and starts only at the head of the merge slot

## Description

Plan item 2a wired into the gate, with amendment 1. Everything here runs only when `mergeSlot(config)` (`S/run-config-gates.cjs`) is true; otherwise every path is today's. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`; `slot` is `S/run-slot.cjs`. The holder of an intent tree is its branch.

1. **Detach takes a ticket.** `gateDetach` (`S/run-gate.cjs:310-346`): after `refuseDirty` and the live-job refusal (:315-321) and before `foldBase` (:326), `slot.take(tree, { intent })`. Behind the head it folds nothing and starts nothing, and returns exit 4 with the eviction lines of the call, `queued behind <first holder ahead> (<n> ahead); nothing folded`, and `wait with: <gateWaitCall(tree)>`. At the head it goes on as today.
2. **Wait waits in the queue.** `gateWait` (:362-375), after the config check: renew the tree's ticket. While the tree holds a ticket behind the head, block, reading `slot.queue` every 5 seconds, until the ticket reaches the head or the deadline; at the deadline exit 4 with the queued line and `call <gateWaitCall(tree)> again`. At the head with no gate job started since the ticket's `taken` (no job file, or `job.started` earlier), run `gateDetach(options)` and return its result when it is not exit 0 (a review refusal is exit 3, a fold conflict throws), else wait on the new job as today. A tree with no ticket waits exactly as today, so `NO_GATE_JOB` still names how to start one.
3. **A red wait releases.** `waitAll` (`S/run-lanes.cjs:166-169`) releases the tree's ticket before it returns exit 2. An exit 0 or 3 keeps it: the tree is next to ship or owes an accept.
4. **Ship and teardown release.** `ship` (`S/run-ship.cjs:113`) releases the branch's ticket right after `verified against`; `removeWorktree` (:131-139) releases it too, so `teardown` frees a slot an interrupted ship held.
5. **Activity renews.** `reviewIntent` (`S/run-intent-review.cjs:128`) renews the tree's ticket on every call, and `dispatchPath` (:33) becomes `slot.reviewDispatchPath`, so the eviction hold reads the file the review writes. `accept` (`S/run-lanes.cjs:190`) renews on success.
6. **Usage.** `S/run.cjs` USAGE: `gate --detach` and `gate --wait` say exit 4 also means queued behind another intent's ticket.

The first red test: "a second gate --detach queues behind the first and folds nothing", which fails today because the second gate folds and starts at once.

## Acceptance Criteria

- [ ] New `S/run-slot-gate.test.cjs` on `S/run-lanes-fixture.cjs` with `merge_slot: true` and two intent worktrees of one fixture repository passes:
  - "a second gate --detach queues behind the first and folds nothing": with a new base commit to fold, the second tree's detach exits 4 with `queued behind`, its `git rev-parse HEAD` is unchanged and it has no `gate-job.json`.
  - "the queued tree's wait folds and starts once the head's wait is red": the head's lane on `1` makes its wait exit 2; the second tree's `gate --wait` then prints `folded main into` and `gate started`, and exits 0 once green.
  - "teardown and a red wait free the slot, an exit 3 keeps it": `slot.queue` after each.
  - "an intent review call renews the ticket": `activity` moves.
  - "without merge_slot both trees start at once": the second detach exits 0 and folds.
- [ ] `node --test S/run-slot-gate.test.cjs S/run-gate-cli.test.cjs S/run-ship.test.cjs S/run-lanes-wait.test.cjs S/run-intent-review.test.cjs` reports 0 fail.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs
      reason: gateDetach at 310-346 and gateWait at 362-375
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
      reason: waitAll at 153-187 and accept at 190-219
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-ship.cjs
      reason: ship at 104-113 and removeWorktree at 131-139
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-intent-review.cjs
      reason: dispatchPath at 33 and reviewIntent at 128-171
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/state-store.cjs
      reason: run-slot.cjs lands beside it from gs-the-merge-slot-queues-tickets-across-worktrees, read its take, renew, release, queue and reviewDispatchPath there
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lane-config.cjs
      reason: run-config-gates.cjs lands beside it from gs-a-kb-sync-keeps-the-intent-review-current, its mergeSlot decides whether a call uses the slot
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
      reason: the deadline loop of waitAll at 176-186 is the shape of the queued wait
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-call.cjs
      reason: gateWaitCall at 68 builds every printed wait call
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate-cli.test.cjs
      reason: the detach and wait cases at 67-125 stay green
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-ship.test.cjs
      reason: ship and teardown stay green
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-ship.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-intent-review.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-slot.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-slot-gate.test.cjs
probes:
    - run: "grep -c 'if (existing) {' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs"
      shows: "1"
    - run: "grep -c 'return lanes.waitAll' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs"
      shows: "1"
finalize_check: "node --test src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-slot-gate.test.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate-cli.test.cjs"

## Technical Notes

- "A gate folds only when it is next to ship": the fold at :326 moves behind the ticket, and the ticket is held from detach through ship, so a queued intent folds a base that no longer moves under it.
- The intent review's own fold (`S/run-intent-review.cjs:161`) stays outside the slot; it renews the ticket instead, and amendment 1 holds the head while its dispatch has no verdict.
- `gate --wait` starting the gate at the head keeps the orchestrator's loop unchanged: exit 4 still means call wait again.
- A red tree whose lane still walks is released by the wait and held at the head by the shim of `S/run-slot.cjs` until the lane ends or `gate --detach --supersede` stops it, so no second walk queues on the same remote machine behind a lock.
- Old job files carry no ticket; the shim reads them as the head, so a gate an older runner started is never overtaken.
- Proven stays proven: the slot changes when a fold happens, never what the gate runs or proves; `ship` still refuses a tree that changed after its gate (`S/run-ship.cjs:88-93`).

## Dependencies

- gs-no-flake-rerun-passes-as-proof
- gs-a-kb-sync-keeps-the-intent-review-current
- gs-the-merge-slot-queues-tickets-across-worktrees
- gs-a-running-lane-red-ends-the-wait
