# Handoff: a delta review that a peer's change re-owes before any builder took the item's open finding records that same finding again and counts it as a new miss, so one unfixed finding climbs the ladder to the oracle

Row 0au. Met on the first host on 2026-11-20 by the Delta session of `the-product-page-wears-chapter-arcs`, on the build at `a8873ebb`, and read in the code there and in the intent's commits; the tip `24c9b3fc` holds the same `src/`.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `a8873ebb`.

## What is wrong

1. **A peer's change re-owes the review.** A recorded review stays current only while no commit since it changed a file it lists, unless that commit is a clean fold or a case block of another item (`S/run-review-hash.cjs:3-17`). A correction of another item in a shared file therefore re-owes this item's review, also when this item's last record is a `fix` whose finding no builder has taken yet.
2. **Every serious fix record is a new miss.** The record adds one to the item's misses whenever its findings weigh serious (`S/state-review.cjs:139`, `misses = previous + (serious ? 1 : 0)`), whether or not a correction of the item lies between the last record and this one. The ladder reads that count (`S/run-review-ladder.cjs:92-99`): miss 2 a fresh escalate builder, miss 3 the oracle, miss 4 the user. A finding marked `repeat` goes to the oracle at once (`S/run-review-file.cjs:240-261`), so marking it does not help.
3. **So an open finding is counted once per peer change.** Nobody tried to fix it, the delta review rightly finds it still open, and the item climbs one rung for each change a sibling made to a shared file.

## Evidence

The first host's Delta (Debian), intent `the-product-page-wears-chapter-arcs`, tree `~/dev/Skoft_CRA-inferno-the-product-page-wears-chapter-arcs`, item `pca-each-chapter-opens-with-its-arc-and-the-index-counts-it`. Read on Delta 2026-11-21, read only. Times UTC.

- 2026-11-20 23:05:17Z, `bf8aa6b6d`, "docs(overlay): the product menu stands on the rail's ground, every other overlay is the panel raised": the shell item's wording correction, in `docs/DESIGN.md`, `integration/TEST-CASES.md`, `integration/overlay-material.test.mjs` and `scripts/integration-journeys-board.mjs`.
- 23:05:29Z, `3efc4c331`, the item's review `fix`: `read: 4ca2632b0..e66eaa9d0`, one major finding on `integration/lib/layout-probe.mjs:224`; the ledger goes from `review_misses: 1` to `review_misses: 2`, `review_weight: serious`.
- 23:27:48Z, `c5764b50b`, the delta review the hash re-owed: `read: e66eaa9d0..3efc4c331`, whose only change in the item's listed files is `bf8aa6b6d`. The contract review's findings are unchanged; the ledger goes to `review_misses: 3`, `review_tier: escalate`. No builder of the item ran between the two records.
- The session's FLOW line, verbatim: "FLOW a delta review the flow owes before a builder may take an open finding re-records that same finding and counts it as a new miss, so one unfixed finding escalated pca-each-chapter-opens-with-its-arc-and-the-index-counts-it to the oracle | evidence: review commits 3efc4c331 (fix, 2 misses) and c5764b50b (same finding, read e66eaa9d0..3efc4c331, 'escalate, 3 misses'); the delta held only bf8aa6b6d, a shell item wording fix in a shared file | workaround: following the escalation, oracle dispatch 6c758f50 asked, its decision goes to an escalate builder".
- Cost: one oracle call and an escalate builder for a finding the warm builder never saw, and the item one rung from the user.

## How to fix

1. **No attempt, no miss.** In the record (`S/state-review.cjs:125-160`), when the item's last record was `fix` and no correction of the item lies between that record's commit and this one (no `dispatch-log` of the item since, and no commit whose message carries `Item: <id>`), a `fix` record keeps the previous `review_misses`, `review_weight` and `review_tier`. Its findings replace the old ones, so a finding the peer's change added still reaches the builder.
2. **The correction comes first.** After a `fix` record with no correction yet, `review --item` for a review a peer's change re-owed prints the correction owed (the open findings, to the actor the ladder names) instead of a delta dispatch. The correction's own review then reads the peer's change too, so nothing goes unread.

Tests, beside `S/state-review.test.cjs` and the review ladder's:

- Two serious `fix` records of one item with a peer's commit to a listed file between them and no dispatch of the item: the second leaves `review_misses` where the first put it, and `nextActor` names the same actor.
- The same with a correction dispatched and committed between them: the second adds one, as today.
- After a `fix` record and a peer's change, `review --item` prints the correction, not a delta dispatch.

## Which part is the flow and which the host

All of it is the flow's. Nothing here is for the builder of the row on the host's side.

## Until it is built

On the host: when an item's last record is `fix` and no builder has taken its finding yet, send the finding to its builder before any delta review of that item, and record once after the correction. A delta review recorded first counts the same finding as a new miss.
