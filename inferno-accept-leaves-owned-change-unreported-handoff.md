# Handoff: accept-dispatch takes a changed-paths list that leaves out a path the dispatch owns and its own window changed, so the slip first shows as an outside path in a sibling's verify-item, after the accept is frozen

Row 0av. Met on the first host on 2026-11-20 by the Delta session of `maintain-leaves-a-permanent-licence-if-skoft-stops`, on the build at `a8873ebb`, and read in its dispatch records, its transcript and the code there; the tip `d2fbc8f4` holds the same `src/`. Row 0ah is a change made between two dispatches; this row is a change made inside one and left out of its accept.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `a8873ebb`.

## What is wrong

1. **The accept checks one direction.** `accept-dispatch` refuses a reported path its window did not change (`S/run-dispatch.cjs:232-235`, "accepted paths have no dispatch patch"), and takes a list that leaves out a path the window did change. That is right for a path another builder in the tree may have changed beside it, and wrong for a path the dispatch's own ownership holds: no overlapping dispatch can own it (`refuseOverlap`), so a change to it inside the window is this dispatch's.
2. **The slip surfaces late and elsewhere.** The change stays in the record's snapshot delta with no claim. The item's own verify-item would print `owned but not in changed_files ... run dispatch-log for it again and accept-dispatch its full list, or each sibling's review names them outside` (`S/run-item-proof.cjs:411-414`), and a sibling's verify-item lists the path outside its ownership (`S/run-attribute.cjs:115-120`). By then the accept is frozen: a second accept with another list is refused (`S/run-dispatch.cjs:224-226`), and so is a grant to that dispatch.
3. **A deletion is the easy one to miss.** A builder told to delete a file reports what it edited; a deleted path is in no diff a session reads at the accept.

## Evidence

The first host's Delta (Debian), intent `maintain-leaves-a-permanent-licence-if-skoft-stops`, tree `~/dev/Skoft_CRA-inferno-maintain-leaves-a-permanent-licence-if-skoft-stops`, records under `~/.cache/specsmd-inferno/Skoft_CRA/dispatch/996604407b4d.../`, transcript `36ee241a-45e4-4f66-888e-e6b05737f7dc.jsonl`. Read on Delta 2026-11-21, read only. Times UTC.

- 2026-11-20 18:04:57Z, dispatch `0f30ffce` of the tester item `mlp-the-tester-seeds-the-term-licence-and-walks-an-ended-maintain-key`, granted `integration/can-fail/TC-021.patch`; the builder wrote it. 19:04:59Z, accepted with `["integration/can-fail/TC-021.patch"]`.
- 19:05:0xZ, dispatch `8cd457fe` of the same item, brief "Editable: scripts/tester/stubs/license.mjs, and delete integration/can-fail/TC-021.patch". Its record holds the patch in `assignment.ownership.editable` and in `beforeSnapshot`, and not in `acceptedSnapshot`: its window deleted it. 19:05:54Z, accepted with `["scripts/tester/stubs/license.mjs"]` alone, exit 0.
- Later, the worker item's verify-item (`mlp-the-worker-leaves-a-licence-with-every-paid-maintain-term`): `outside ... ownership.editable: integration/can-fail/TC-021.patch`, a path no commit ever held (`git log --all`). The session cleared it with a fresh `dispatch-log` of the worker item, a grant of that path and `accept-dispatch []` (dispatch `94d0def1`, 23:39Z), which credits the deletion to the wrong item.
- The session's FLOW line, verbatim: "FLOW verify-item of a sibling item named a file outside its ownership that was never committed (integration/can-fail/TC-021.patch, created and deleted in a tester dispatch I accepted with that path) and an accepted dispatch's grant is frozen | evidence: verify-item mlp-the-worker-leaves-a-licence-with-every-paid-maintain-term 'outside ... ownership.editable: integration/can-fail/TC-021.patch' while git log --all holds no such path | workaround: a fresh dispatch-log with a grant of that path and accept-dispatch [] cleared it."

## How to fix

1. **The accept refuses an owned change left out.** In `acceptDispatch` (`S/run-dispatch.cjs:222-235`), the paths of the window's snapshot delta that the dispatch's ownership holds (its spec's editable and its grants) and the list leaves out are a refusal, exit 2, before anything is written: `<path> changed in this dispatch's window and is its own, a deletion included: add it to --changed-paths`. Delta paths outside its ownership stay the peers' question, as today.
2. **The late repair names the right call.** When a sibling's verify-item lists as outside a path an accepted, frozen record of another item owns and left unreported, its line names that item and the repair that credits it there: a fresh `dispatch-log` of that item and `accept-dispatch` with the path, which the accept takes as carried (`S/run-dispatch.cjs:233`).

Tests, beside the dispatch suite:

- A dispatch granted a file whose window deletes it, accepted without the file, is refused naming it; accepted with it, recorded.
- A dispatch whose window holds a change to a path it does not own, left out of the list, is accepted as today.
- A sibling's verify-item over a frozen record that left an owned deletion unreported names the owning item and the carried accept.

## Which part is the flow and which the host

All of it is the flow's. Nothing here is for the builder of the row on the host's side.

## Until it is built

On the host: before `accept-dispatch`, list what the builder changed in its own paths with `git status --short -- <its editable paths and grants>` and put every one in `--changed-paths`, deletions included. A sibling's verify-item that names such a path outside is repaired by a fresh `dispatch-log` of the item that owns it and `accept-dispatch` with that path, not by a grant to the sibling.
