---
id: ri-verify-item-waits-only-on-an-overlapping-open-dispatch
title: "Verify-item waits only on an open dispatch whose frozen ownership overlaps the item's"
intent: integrate-checks-what-a-base-commit-changed-and-lands-beside-busy-siblings-verify-item-waits-only-on-overlap-and-a-run-branch-keeps-its-config
kind: behavior
complexity: high
mode: autopilot
status: pending
depends_on: []
created: 2026-11-09
---

# Work Item: Verify-item waits only on an open dispatch whose frozen ownership overlaps the item's

## Description

Fixes the defect tooling item 9 names. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`. `openDispatches` (`S/run-attribute.cjs:26-31`) lists every dispatch started at or after the item's first baseline that nobody accepted, whatever it owns, and `attribute` (:195-200) refuses on the first one: `dispatch <id> for <items> is still open: run accept-dispatch ...` (`DISPATCH_PROOF`). Three cases assert it today with disjoint ownership (`S/run-attribution.test.cjs:101-113`, `S/run-attribution-peers.test.cjs:111-127` and `:318-330`). Skoft_CRA wave 2 held three accepted corrections 1 to 2 hours behind an unrelated builder.

The refusal exists because an open dispatch's changes are explained by nothing: the default peers are accepted records only (:98), `unexplainedChanges` validates each peer as accepted (`S/run-peers.cjs:86`), and an attempt nobody accepted claims no path (`S/run-peers.cjs:37`). Every dispatch record freezes its ownership at `dispatch-log` (`assignment.ownership.editable`, refused if changed at `S/run-dispatch.cjs:149-150`), so an open dispatch can be attributed by that frozen list, as the statement asks.

1. **`openDispatches`** returns the open records themselves (each with its `assignment`), not only id and items.
2. **`attribute`.** For each reviewed record, split the open dispatches by overlap: an open dispatch overlaps when any entry of its frozen `assignment.ownership.editable` overlaps any entry of the reviewed record's frozen list or of the reviewed items' spec `editable` (`editableOf`, :141-148), with `lib.overlaps(left, right, tree)` (`S/run-owned.cjs:124-126`), the predicate dispatch and batching already share. An overlapping one refuses exactly as :197-200 does today. The disjoint ones go to `verifyDispatch` as `options.open`.
3. **`verifyDispatch` and `unexplainedChanges`.** `unexplainedChanges(tree, own, editable, peers, now, folded, open)` adds each open record's lineage to the runs: the record is validated with `dispatch.validateDispatch(tree, record, {}, false)`, its accepted earlier attempts keep their windows and claims as `windows` builds them (:32-63), and its open tail runs from its own baseline to the end of the timeline and claims every changed path its frozen ownership covers (`lib.ownedBy(file, record.assignment.ownership.editable, tree)`). `checkPeerChange` (:66-76) still guards each claimed change.
4. **A change no dispatch claims beside an open one.** When a disjoint open dispatch is running and the timeline still flags a path (an `outside` or `unreported` from `unexplainedChanges`, not the reviewed item's own claimed paths outside its ownership at :101), `attribute` refuses with the same `is still open` refusal naming that open dispatch, never naming the path outside the reviewed item: it may be the open builder's own escape, which only its `accept-dispatch` attributes.

The first red test: "verify-item verifies beside an open dispatch with disjoint frozen ownership", which exits 2 with `is still open` at `2205834`.

## Acceptance Criteria

- [ ] New `S/run-attribution-open.test.cjs` on `fixture` of `S/run-attribution-fixture.cjs` (`start`, `write`, `accepted`, `verify`, `land`):
  - "verify-item verifies beside an open dispatch with disjoint frozen ownership": `a` owns `a.cjs`, `b` owns `b.cjs`, both started, both written, only `a` accepted; `verify('a')` exits 0 with `outside` `[]`.
  - "verify-item still waits on an open dispatch whose frozen ownership overlaps": `a` owns `shared.cjs` and `a.cjs`, `b` owns `shared.cjs` and `b.cjs`, `b` open; `verify('a')` exits 2 with `dispatch <b's id> for b is still open`.
  - "a change no dispatch claims beside an open one waits for it": as the first case plus an `other.cjs` nobody owns; `verify('a')` exits 2 with `is still open` naming `b`'s dispatch, and its output does not name `other.cjs` as outside `a`; after `accepted(b, ['b.cjs'])` the same call exits 2 with `other.cjs` in `outside`.
  - "a correction of a landed item beside a disjoint open one is explained by that item's accepted attempt": the flow of `S/run-attribution-peers.test.cjs:318-330`, now exiting 0 for `verify('c')`.
- [ ] The three cases that asserted the wait for a disjoint dispatch assert the new rule: `S/run-attribution.test.cjs:101-113` becomes "verify-item verifies an item beside a disjoint open dispatch, and waits on nothing once it is accepted"; `S/run-attribution-peers.test.cjs:121` expects `verify('b')` exit 0 with `outside` `[]` while `c` is open, the rest of that case unchanged; `S/run-attribution-peers.test.cjs:318-330` moves to the new suite as its fourth case.
- [ ] `node --test S/run-attribution-open.test.cjs S/run-attribution.test.cjs S/run-attribution-peers.test.cjs S/run-dispatch.test.cjs` reports 0 fail, run through `remote-run.sh` as `dispatch.constraints` say.
- [ ] `wc -l` of `S/run-attribute.cjs` and `S/run-peers.cjs` each prints 500 or less.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribute.cjs
      reason: openDispatches at 26-31, verifyDispatch at 77-112, attribute and its refusal at 177-208
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-peers.cjs
      reason: windows at 32-63 gives an unaccepted tail no claims, unexplainedChanges at 82-121 validates peers as accepted at 86
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-dispatch.cjs
      reason: validateDispatch at 102-110, lineage at 112-127, effective at 129-137, the frozen ownership at 140-170, currentRecords at 227-238
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-owned.cjs
      reason: overlaps at 124-126 and ownedBy at 129-138
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-peers.cjs
      reason: windows and checkPeerChange are how a peer's change is claimed and guarded
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribution-fixture.cjs
      reason: fixture with start, write, accepted, verify and land at 29-107
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribution.test.cjs
      reason: the open-dispatch case at 101-113 changes, the rest stay green
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribution-peers.test.cjs
      reason: the cases at 111-127 and 318-330 change, the overlap refusals at 24-35 stay
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribute.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-peers.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribution.test.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribution-peers.test.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribution-open.test.cjs
probes:
    - run: "grep -n -F 'const open = openDispatches(tree, dispatch.effective(tree, record));' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribute.cjs | cut -d: -f1"
      shows: "196"
    - run: "cat src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribution.test.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribution-peers.test.cjs | grep -c -F 'is still open'"
      shows: "3"
    - run: "grep -n -F 'dispatch.claimedPaths(member) : []' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-peers.cjs | cut -d: -f1"
      shows: "37"
    - run: "wc -l < src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribute.cjs"
      shows: "210"
diagnosis:
  claim: "attribute refuses on the first open dispatch openDispatches lists, whatever that dispatch owns"
  probe: "grep -n -F 'if (open.length > 0) {' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribute.cjs"
  shows: "197:    if (open.length > 0) {"
finalize_check: "wc -l src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-attribute.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-peers.cjs | awk '$2 !~ /^total$/ && $1 > 500 { bad = 1 } END { exit bad }'"

## Technical Notes

- Decision: overlap is read on the frozen lists, the record's `assignment.ownership.editable` on both sides plus the reviewed items' spec `editable`. A spec widened after dispatch never grants an open builder a path (the existing case `S/run-attribution.test.cjs:130` holds the same line for the reviewed item).
- Decision: an unexplained change beside a disjoint open dispatch waits rather than naming the path outside the reviewed item. That change may be the open builder's escape, and naming it outside sends the wrong builder a correction; the wait ends at that dispatch's `accept-dispatch`, after which `checkPeerChange` or the reviewed item's own check names it correctly.
- Decision: a dispatch that started before the reviewed item's baseline and is still open stays outside `openDispatches`, as today (`startsFrom`, :20-23).
- `--peers <json>` keeps its meaning, the accepted records that may explain a change; the open records travel separately as `options.open`.
- Concurrency: an open builder keeps writing while verify-item reads. Its window has no end snapshot, so the tree as verify-item reads it (`now`, :85) closes the timeline, and a change inside its frozen ownership is claimed whatever bytes it holds at that moment.

## Dependencies

(none)
