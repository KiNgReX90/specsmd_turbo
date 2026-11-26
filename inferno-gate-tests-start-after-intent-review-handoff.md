# Handoff: the gate's full suites and lanes start only after the intent review, so a red only they can find is met last, when every fix costs a full gate again

Row 0bd. Met on the first host on 2026-11-21 by its test-manager, from the ship-loss count of that day, and again on 2026-11-24 and 2026-11-25 on Beta, where it cost 9.4 h (below); the tip `e360b9a1` holds the same texts.

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

### Met on the first host again: the suite ran after the early lanes and met its red 9.4 h late

The same intent on Beta, on 2026-11-24 and 2026-11-25. Its last item integrated at 23:22:40Z, and the session then followed this row's workaround in the order it gave: the early lanes first, the browser suite by hand after them. The lanes-only smoke walk took Beta's one machine lock at 23:22:45Z and held it 3.6 h. `npm run test:e2e`, started in the tree at 23:22:54Z, waited behind it. Its log reads "remote-run: auto has no machine to send to from RexOnWindows (every machine is taken out ...), so it holds this machine's own lock", then "still waiting for the machine lock ..., 170 min", then `Terminated`. No later step ran the suite before the final gate. Integrate runs no browser suite on this host, which keeps it in `verification.finalize` on purpose (its `.specs-inferno/config.yaml:721-728` on main `187e4d124`). The flow's integrate selection returns nothing without an `integrate_e2e` section (`S/run-e2e-impact.cjs:22-25` and `:60-62`, called at `S/run-integrate.cjs:112`). The suite next started at 08:37:41Z on 2026-11-25, on `cf9490711`, and read red at 09:05:06Z: 2 failed and 1686 passed in 17.8 min, both reds in `e2e/record-recovery.spec.ts:173` at line 196. Run in the foreground at 23:22:54Z it would have read red at about 23:41Z, 9.4 h earlier, before the scan, the intent review and every gate proof. Its fix voided the gate's proofs on `cf9490711`. The late find, with a criterion question that also came late, took the intent out of the host's release 0.2.

So after the last item no step runs the finalize commands that integrate never ran before a lane starts. On a host with one machine lock the two cannot run at once, and the lane of hours takes the machine the suite of minutes needs. The host's own rule for its gate is cheapest first, so that a break surfaces early (`.specs-inferno/config.yaml:150-151`).

The same intent's second late red, 20.6 h from its first sign to the find, is the host's and not this row's. Its early lane walked the case on 2026-11-25 and saw it red beside other walks at 04:30:53Z, and the host's lane keeps only a walk alone as the verdict (its `scripts/integration-lane-pool.mjs:242-251`).

Read on Alpha on 2026-11-26 from the host's test-manager files: the hours and the table of every check in `/home/ruben/.local/share/skoft-agents/Skoft_CRA/test-manager/late-find/cause.md`, the decision (P1 and its FLOW finding) in `oracle.md` beside it, and the two suite logs under `evidence/` there (`slt-e2e-20261124T232254Z.log`, `e2e/e2e-a-licence-slot-20261125T083741Z.log`).

## How to fix

1. **One step that starts the gate's checks early, cheapest first.** `gate --detach --early` (or `--lanes-only` widened): once the last item integrates, fold the base into the tree as the gate does, then run the finalize commands on that tree to their verdicts, and start the touched lanes only when they are green, with no ticket, minting proofs as the gate does. A command with a proof for the tree is skipped, as in the gate. A red finalize command starts no lane: it goes to its item's builder, and the step runs again on the fix. So a lane of hours never holds the machine a suite of minutes waits for, and no fix the suite asks for voids a lane walk. It is refused while an item is pending or in flight, and it runs beside the scan and the intent review.
2. **The procedure names it.** Finalize step 1 starts it first, then runs the scan and the intent review. Each red it reports goes to its item's builder at once. The gate that follows reuses every proof whose tree did not change, and folds and walks only what did.
3. **It yields to the review.** A review record or a fix that lands while it runs supersedes it the way `--supersede` does today, so no early run is judged on a tree that has moved.

Tests, beside `S/run-gate.test.cjs`:

- With every item integrated, the early step folds the base, then starts the finalize commands and the touched lanes with no ticket, and a gate on the unchanged tree after it starts none of them again.
- With an item pending, it is refused.
- It starts no lane before every finalize command it runs is green, and a red one starts no lane at all.
- A commit after it, before the gate, makes the gate run again what that commit's scope reaches.

## Which part is the flow and which the host

The step and the procedure are the flow's. The host's own part landed as `242f0174e` on its `main` (an item that edits a tester case proves that case's tests at its integrate).

## Until it is built

On the host since 2026-11-26, cheapest first: once the last item integrates, fold main into the tree, then run the finalize command that only the gate runs (`test:e2e`) by hand in the tree as the gate would, in the foreground, to its verdict. A red goes to its item's builder at once and the suite runs again. On its green, start `run.cjs gate --tree <tree> --detach --lanes-only`, then the scan and the intent review, and the final gate reuses both proofs. No commit that changes a lane module lands on main while that walk runs. Before 2026-11-26 the order was the lanes first, which cost the 9.4 h above.
