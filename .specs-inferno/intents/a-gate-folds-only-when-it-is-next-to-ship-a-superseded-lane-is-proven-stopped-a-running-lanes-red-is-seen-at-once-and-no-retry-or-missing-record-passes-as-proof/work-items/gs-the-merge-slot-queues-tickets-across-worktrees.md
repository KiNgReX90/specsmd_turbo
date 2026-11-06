---
id: gs-the-merge-slot-queues-tickets-across-worktrees
title: "The merge slot queues tickets across every worktree of a repository"
intent: a-gate-folds-only-when-it-is-next-to-ship-a-superseded-lane-is-proven-stopped-a-running-lanes-red-is-seen-at-once-and-no-retry-or-missing-record-passes-as-proof
kind: architecture
complexity: high
mode: autopilot
status: completed
completed_at: 2026-11-06T17:10:10Z
depends_on: []
created: 2026-11-06
---

# Work Item: The merge slot queues tickets across every worktree of a repository

## Description

The store behind plan item 2a and amendment 1, with no caller yet. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`.

1. **A lock any file can use.** In `S/state-store.cjs`, extract `withFileLock(lockFile, fn, { timeoutMs, label })` from `acquire` (:91-118) and the owner, candidate and release lines of `withStateLock` (:121-140). `withStateLock` delegates to it with the same lock path (`lockPath`, :38-44), the same timeout and the same `STATE_LOCKED` messages; `label` names the held thing in the messages of any other lock. Export it.
2. **The queue.** New module `S/run-slot.cjs`. One queue per repository in `<git common dir>/inferno-merge-slot.json` (resolve the common dir as `lockPath` does), locked by `withFileLock` on `<git common dir>/inferno-merge-slot.lock`, written with `atomicWrite` (`S/state-store.cjs:66`). A ticket is `{ holder, tree, intent, taken, activity }`, times in ISO. Every function takes a `now` (default `Date.now()`) so tests drive the clock.
   - `take(tree, { holder, intent }, now)`: holder defaults to `lib.currentBranch(tree)`. A holder already queued keeps its place and renews its `activity`. Returns `{ head, ahead, out }`: `head` true when nothing is ahead, `ahead` the holders ahead in order.
   - `renew(tree, holder, now)` and `release(tree, holder)`; both are no-ops for a holder not queued.
   - `queue(tree, now)`: evicts, then returns `{ heads, tickets, out }`. Eviction removes a ticket whose `activity` is more than 30 minutes old, printing `evicted <holder>: no gate, wait or review since <activity>`, except while the ticket's tree holds an intent review dispatch newer than its `activity` and younger than 120 minutes; past that cap it prints `evicted <holder>: its intent review has no verdict after the cap`. The dispatch file is `path.join(lib.cacheDir(tree), lib.currentBranch(tree), 'intent-review-dispatch.json')`, the formula of `S/run-intent-review.cjs:33`; export it here as `reviewDispatchPath(tree)`.
   - The shim: each worktree of `worktreeEntries(lib.primaryRoot(tree))` (`S/run-worktrees.cjs:17-26`) with a live job (`jobs.everyJob(tree).some(jobs.alive)`, `S/run-jobs.cjs:39-59`) and no ticket for its branch is a head ahead of every ticket, named `running without a ticket: <branch>`. A ticket's holder is at the head only when no shim head and no earlier ticket stands before it.
   - This module never reads a config: its callers ask `mergeSlot(config)` (`S/run-config-gates.cjs`, added by `gs-a-kb-sync-keeps-the-intent-review-current`) whether to use it.

The first red test: "tickets queue first come, first served", which fails today because `S/run-slot.cjs` does not exist.

## Acceptance Criteria

- [ ] New `S/run-slot.test.cjs` passes:
  - "tickets queue first come, first served, and a second take keeps its place": take A, take B, take A again; A is the head, B has `ahead` `['A']`; release A; B is the head.
  - "a ticket with no activity for 30 minutes is evicted with a line": `queue(tree, taken + 31 min)` drops it and prints the eviction line.
  - "an open review dispatch holds a ticket up to 120 minutes": a dispatch file newer than the activity keeps the ticket at +31 min and drops it at +121 min with the cap line.
  - "a live job in a worktree with no ticket is the head" (Linux only): a second worktree whose branch cache holds a gate job file naming a live `node -e ... run.cjs` process, as `S/run-lanes-config.test.cjs:84-106` builds one; a ticket taken from the first worktree reports `ahead` `['running without a ticket: <branch>']`.
  - "two processes taking at once both land in the queue": two `node -e` children call `take` with different holders at the same moment; the file holds both tickets, once each.
- [ ] `node --test S/run-slot.test.cjs S/state-transactions.test.cjs S/state-transition.test.cjs` reports 0 fail.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/state-store.cjs
      reason: lockPath at 38-44, atomicWrite at 66, acquire at 91-118, withStateLock at 121-140
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-jobs.cjs
      reason: jobPaths, alive and everyJob at 19-59 decide a live job
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-worktrees.cjs
      reason: worktreeEntries at 17-26 lists every linked worktree
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-intent-review.cjs
      reason: the dispatch file formula at 33, read only here
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/state-store.cjs
      reason: the ledger lock is the lock and write discipline the queue mirrors
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-config.test.cjs
      reason: the live job fixture at 84-106
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transactions.test.cjs
      reason: the ledger lock stays as it is
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-config.test.cjs
      reason: the pattern of the new suite run-slot.test.cjs
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/state-store.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-slot.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-slot.test.cjs
probes:
    - run: "ls src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-slot.cjs 2>/dev/null | wc -l"
      shows: "0"
    - run: "grep -c 'function withStateLock' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/state-store.cjs"
      shows: "1"
finalize_check: "node --test src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-slot.test.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transactions.test.cjs"

## Technical Notes

- The queue sits in the git common dir, not in `lib.cacheDir`, because the cache dir is keyed by the primary checkout's basename (`S/run-lib.cjs:383-386`) and two clones of one name would share it.
- The 30 and 120 minute bounds are the council's (plan 2a, amendment 1) and live in this module as named constants; no agent text states them.
- The shim is what makes the install safe while gates run: a gate or lane that an older runner started has no ticket and still holds the head until it ends.
- The lock extraction must not change a ledger refusal: `S/state-transactions.test.cjs` and `S/state-transition.test.cjs` run unchanged.
- Proven stays proven: nothing reads the queue yet, and no proof, job or review file is touched.

## Dependencies

(none)
