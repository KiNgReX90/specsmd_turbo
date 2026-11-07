# Round 3 amendments: the six objections left open after the final sign-off (r3f-A.md, r3f-B.md)

All six only add checks; none changes the plan's direction. They are binding on the build of `r3-plan-v2.md` and every planner and builder brief carries them. Each is re-verified at the cited line by whoever builds it; a claim that fails there goes back to this session.

1. Slot eviction (A, plan 2a): an open `intent-review-dispatch.json` holds the head ticket until its verdict is recorded, capped at 2 h with a printed line. Book the base-delta review after a large merge as up to 60 min, not 10 to 20.
2. `verdicts.json` (A, plan 1h and 2d): a journey's entry is the worst class over all its lines, red-first lines included; each red-first test is listed with its own class. A branch-green journey with an unproven red first is never "green".
3. Accept before item 1 lands (A, plan 2d): accept calls a host check (`verification.<lane>.accept_check`). Skoft_CRA's check accepts a run without `verdicts.json` only when its log holds the lane's own closing line and every class line is PREDATES (the test `acceptable()` applies at `scripts/integration-lane-fold.mjs:112-117`). A lane that walked nothing stays refused.
4. `review.outside` (A, plan 2g): a wiki/** or grok/** path is exempt only when the branch's version equals the base's (`git diff <base>...HEAD -- <path>` is empty). An intent's own wiki or grok edit still voids its review.
5. Windows verdict identity (B, plan item 1k and settled 2): `verdictKey` (`scripts/integration-lane-files.mjs:169`) and `awaitWindows` (`scripts/integration-lane-fold.mjs:83`) bind the selected Windows command and scope hash and reject a verdict whose identity differs.
6. Lock holder (B, plan item 3): the `LOCK_WAIT_SECONDS` value is a direct build; the holder record and its refusal line move into the lane intent (item 1), under the batch rule `docs/WORKING-AGREEMENT.md:215`.
