# Handoff: the gate's full suites and lanes start only after the intent review, so a red only they can find is met last, when every fix costs a full gate again

Row 0bd. Met on the first host on 2026-11-21 by its test-manager, from the ship-loss count of that day; the tip `44be8319` holds the same texts.

## What is wrong

1. **The order puts the slowest checks last.** Finalize runs the intent review first, then `gate --detach`, which starts the finalize commands and the binary lanes (`src/flows/inferno/agents/orchestrator/agent.md:111-112`). Integrate runs only the scoped checks of each item.
2. **The runner can start the lanes early, and nothing says to.** `gate --detach --lanes-only` starts the lanes the diff touched with no fold, no finalize command and no ticket (`run.cjs` usage, `S/run-lanes-only.cjs`). No step starts the finalize commands that way, and the orchestrator's procedure names neither.
3. **So a red that only the full suite or a lane can show waits for the review loop.** The fix then gates again from the start. A proof minted earlier on the same tree would have been reused: proofs are keyed by command, config and scope hash (`S/run-proofs.cjs:150-158`), and lanes skip on a proof (`S/run-lanes.cjs:106-113`).

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

## Evidence

- test-manager's FLOW line, verbatim: "FLOW: run.cjs has no step that starts the gate's test:e2e and smoke lane once the last item integrates, beside the scan and the intent review, so the gate could reuse them on an unchanged tree. 15.4 h of arcs' 30.1 h were reds only the final gate met (ship-loss class 3, /home/ruben/.local/share/skoft-agents/Skoft_CRA/tech-lead/ship-loss-20261121.md); the host part landed as 242f0174e."
- The ship-loss file, class 3: "Another layer's test that the intent broke and only the final gate runs, 15.4 h (10%), all arcs: 13 e2e reds at G1 (7.5), TC-242 and TC-240 in the smoke lane at G2 (5.0), TC-240's can-fail at G3 (2.8)".

### Met on the first host: the early lanes voided by main moving under them

Beta (WSL), intent `a-licence-slot-is-taken-only-by-real-use-and-the-maker-reads-the-rule-first`, on `a8873ebb`, following this row's workaround. The session started `gate --detach --lanes-only` at 2026-11-24T23:22:42Z, before the scan and the intent review, on a branch last folded at 21:40:41Z (`6be5996ed`, main at `a7b8ed4c7`). Its smoke walk (run `20261124T232245Z-996076`) ran 13136 s and ended `moved`, code 10, at about 03:02Z on 2026-11-25. The host's walk voids the journeys whose tester files changed on main under it (`movedUnderWalk`, the host's `scripts/integration-lane-moved.mjs:55`). Three commits to lane modules had reached main: `5ab96a3a5`, committed at 23:16:52Z, six minutes before the walk began and not folded, then `e680c4d04` (00:15:16Z) and `6eb7cef7a` (00:39:11Z). The intent review's fold (`dfccfbe4c`, 01:27:41Z) brought exactly those three commits. So 3.6 hours of lanes were lost. A fold of the base right before the early lanes would have taken in the first commit. The other two landed under the walk, which no order of steps prevents: the host keeps such landings off main while a lane walks.

## How to fix

1. **One step that starts the gate's checks early.** `gate --detach --early` (or `--lanes-only` widened): once the last item integrates, fold the base into the tree as the gate does, then start every finalize command and every touched lane on that tree, with no ticket, minting proofs as the gate does. It is refused while an item is pending or in flight, and it runs beside the scan and the intent review.
2. **The procedure names it.** Finalize step 1 starts it first, then runs the scan and the intent review. Each red it reports goes to its item's builder at once. The gate that follows reuses every proof whose tree did not change, and folds and walks only what did.
3. **It yields to the review.** A review record or a fix that lands while it runs supersedes it the way `--supersede` does today, so no early run is judged on a tree that has moved.

Tests, beside `S/run-gate.test.cjs`:

- With every item integrated, the early step folds the base, then starts the finalize commands and the touched lanes with no ticket, and a gate on the unchanged tree after it starts none of them again.
- With an item pending, it is refused.
- A commit after it, before the gate, makes the gate run again what that commit's scope reaches.

## Which part is the flow and which the host

The step and the procedure are the flow's. The host's own part landed as `242f0174e` on its `main` (an item that edits a tester case proves that case's tests at its integrate).

## Until it is built

On the host: once the last item integrates, fold main into the tree, then start `run.cjs gate --tree <tree> --detach --lanes-only` before the scan and the intent review. No commit that changes a lane module lands on main while that walk runs. Then run the finalize commands that only the gate runs (`test:e2e`) by hand in the tree as the gate would, so a red reaches its builder before the review loop.
