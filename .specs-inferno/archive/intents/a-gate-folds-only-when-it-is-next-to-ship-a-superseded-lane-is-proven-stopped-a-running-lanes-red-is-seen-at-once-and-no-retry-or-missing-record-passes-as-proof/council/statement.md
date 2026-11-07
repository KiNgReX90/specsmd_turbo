# Two intent statements from the gate-speed council (decided 2026-11-06, Ruben's yes on the plan)

Source of truth for both: `/tmp/claude-1000/-home-ruben-dev-Skoft-CRA/10ee763f-4921-4768-b404-94d0e19b444a/scratchpad/council/r3-plan-v2.md` (the plan; its "Objections" lines carry the code evidence) and `r3-amendments.md` in the same folder (six binding amendments). The plan's hard constraint: no check is dropped, weakened or skipped; speed only from not repeating proven work, parallel work, earlier reds, no waits on nothing, and a trustworthy instrument. Every item states why nothing proven before stops being proven.

## Statement 2, in /home/ruben/dev/specsmd_new (the flow), installed into Skoft_CRA

**A gate folds only when it is next to ship, a superseded lane is proven stopped, a running lane's red is seen at once, and no retry or missing record passes as proof.**

Scope: plan item 2, a to h, plus amendments 1, 3 and 4. Every new behaviour is config-gated (`verification.merge_slot`, `review.outside`, `verification.<lane>.accept_check`) so Skoft_Files, which installs the same flow, is unchanged until it opts in. Ends with one "Reinstall the flow" commit in Skoft_CRA in the shape of d81f2307e (check-lock matches, flow text budget, the run-*.test.cjs suites pass), landed on main after the high-contrast intent ships; that commit also turns the Skoft_CRA config keys on.

Constraints:
- Flow scripts run from the primary checkout for every orchestrator the moment they land, so every change reads today's job, proof and gate files unchanged; a live gate or lane job without a ticket counts as the head (plan 2a shim).
- The `flake_rerun` removal (2f) revokes the proofs a gate result names `flake`; the Skoft_CRA config keys themselves are removed today by a direct build.
- Each half is harmless without statement 1: before Skoft_CRA's `verdicts.json` exists, accept falls back to the host `accept_check` (amendment 3).
