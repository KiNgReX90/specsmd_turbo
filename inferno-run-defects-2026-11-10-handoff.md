# Handoff: three INFERNO run defects met on 2026-11-10

Met while orchestrating the Skoft_CRA intent `the-confirmed-launch-findings-are-fixed-before-the-freeze`. Each one was worked around there, and none is built here. Paths are under `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

## 1. The completion's ledger commit sweeps up an unrecorded review file

**What is wrong.** `commitLedger` (`run-integrate.cjs:52`) stages `state.yaml` and the whole folder `.specs-inferno/intents/<id>`. A review that a reviewer has written but `run.cjs review` has not recorded yet sits in that folder, so a completion of another item commits it. `run-review.cjs` treats a review as pending only while `git status` shows the file dirty (`pending` at about :259). The swept review is no longer pending, and the next `run.cjs review` answers "review owed" as if no review had been written.

**Evidence.** In Skoft_CRA, `fc510bfa9` ("complete w2-the-bundled-syft-hands-over-the-files-it-could-not-read") committed `reviews/w2-documents-names-a-filed-version-whose-files-changed.yaml`. That file was the documents item's round 4 review, written but not recorded. The next `run.cjs review --item w2-documents-...` printed "review owed ... the item changed since the last review". The workaround was a commit that put back the recorded version (`ab024a391`), followed by recording the written one.

**How to fix.** Stage only what the completion wrote: `state.yaml` and the completed item's own spec file. Add a test in which a dirty `reviews/<other>.yaml` survives a completion, still dirty and still pending.

## 2. One stale diagnosis probe stops the whole frontier

**What is wrong.** `run-frontier.cjs:172` replays the diagnosis probes of every ready item and returns exit 2 on the first stale one, without printing the ready list. An item that is ready but already built on the intent branch, and in its review loop, has a probe that measured the tree before its own fix. So the probe is stale by design, and it blocks every other item from showing as ready.

**Evidence.** In Skoft_CRA at `af7f483b9`, `run.cjs frontier` printed only three INVALID lines and nothing else:
- the installers item's `grep -c '^function communityInstalls'`;
- the scan report's `git grep -c 'unreadable_files' ... | wc -l` (expected 0, got 2);
- the filed-version item's `set_readonly` count (expected 0, got 2).
All three items were already built and under review. The two items that were truly ready, the OSV item and the settings item, never appeared. The orchestrator read the ready set straight from `state.yaml`.

**How to fix.** Replay diagnosis probes only for ready items that have no dispatch-log entry and no review yet, since only those are about to be built on that evidence. Report a stale probe against its own item and keep printing the rest of the ready list. A fixture test: one built item with a stale probe and one fresh ready item, where the fresh one is listed.

## 3. A fold of the base re-owes a review of every item that lists a shared registry

**What is wrong.** An item's review is current only while `filesHash` over every file it lists is unchanged (`run-review.cjs:290`). Items list shared registries whole, such as `integration/TEST-CASES.md`, where every intent reserves its own case blocks. When a fold of main adds another intent's reservation to that file, every item that lists it owes a review, though none of its own lines changed. The same happens when one item adds to a file a sibling also lists, for example the documents item's two lines in `dossier/store/generate.rs`, which the filed-version item lists.

**Evidence.** In Skoft_CRA, the fold `fa05a3ad3` changed only `integration/TEST-CASES.md`: main reserved TC-367 for another intent, and this intent's case moved to TC-368. The documents item was then refused at integrate (`ITEM_REVIEW_OWED`) and needed a reviewer round to confirm that its TC-364 block hashed the same. After the Syft item's fold (`6a2ef47a1`), the scan report and the filed-version item each needed the same delta review.

**How to fix.** Two parts, of which the first is the larger saving:
- For a registry file that names its blocks by id (`### TC-NNN`), hash only the blocks of the cases the item names in `cases:`, not the whole file.
- For any file, leave out of the hash the hunks that a fold of the base brought in since the review commit (`git diff <review_commit>..HEAD` minus the merge's first-parent diff from the base). Only the branch's own changes to an item's files then re-owe its review.
Tests: a fold that adds an unrelated `### TC-` block leaves a clean review current, and a sibling's change to the item's own case block still re-owes it.
