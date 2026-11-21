# Handoff: a claimed intent has no documented way to take a new item, since the planner appends only into a pending intent and `state-transition.cjs` has no verb for it

Row 0ba. Met on the first host on 2026-11-21 by the Omega session `licence-forbids` (its outbox line 96), on the build at `a8873ebb`; the tip `aa221d96` holds the same texts.

## What is wrong

1. **The planner's append is for a pending intent.** Its `integrate` class extends "a `pending` intent" in APPEND mode (`src/flows/inferno/agents/planner/agent.md:92`, the same at `src/flows/inferno/commands/inferno-planner.md:92`). A claimed intent is `in_progress`, so no text covers it.
2. **The single writer has no verb for it.** `state-transition.cjs` takes claim, unclaim, block, unblock, complete, defer, review, close, archive and check (`S/state-transition.cjs:349-364`), and the orchestrator is told never to hand-edit the ledger. A run that finds it needs one more item has no named path.
3. **Mechanically it already works.** The session's planner appended the item on the run branch, and `plan-lint` and `frontier` read it clean. A session that does not think of that hand-edits `state.yaml`, which the orchestrator's rules forbid.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Row 0ba is not P5 in section 4, which decides whether new scope found in the review loop should become a new item. This row is only how an item is added to a claimed intent once that is decided.

## Evidence

- The session's FLOW line, verbatim: "FLOW state-transition.cjs has no add-item for a claimed intent | evidence: its usage lists claim/unclaim/block/complete/review/defer/close/archive/check only | workaround: the planner appended nru-the-update-host-and-the-scope-check-reserve-the-content-from-mining in APPEND mode on my branch (plan-lint clean, frontier 0), committed as spec bcc4ae3c1".
- The lines above, read on the tip 2026-11-21.

## How to fix

1. **The planner's append takes a claimed intent.** In `agent.md` and `inferno-planner.md`, `integrate` covers an `in_progress` intent too. It writes in that intent's run tree and on its run branch, never on the base, and wires the new item behind the items it depends on. `plan-lint` and the plan-time cross-check run as for a pending intent.
2. **The orchestrator names it.** One line in the orchestrator's procedure: a new item for the claimed intent goes through the planner launcher in the run tree, and the ledger is never edited by hand.

Tests, beside `src/__tests__/unit/inferno/inferno-flow.test.ts`:

- The planner text's `integrate` class names an `in_progress` intent and its run branch.
- The orchestrator text names the planner for a new item of the claimed intent.

## Which part is the flow and which the host

All of it is the flow's. Nothing here is for the builder of the row on the host's side.

## Until it is built

On the host: a new item for a claimed intent is written by the planner launcher in APPEND mode in the run tree, committed on the run branch, then checked with `plan-lint` and `frontier`. Never by a hand edit of `state.yaml`.
