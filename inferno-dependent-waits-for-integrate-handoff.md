# Handoff: an item's dependents are released only at its integrate, because integrate and the review record prove the one tree a next builder would edit, so no two items of one chain overlap

Row 0bw. Met on the first host on 2026-11-26 on Omega and Delta, in the single chains of its running intents, on the build installed there, `a8873ebb`. The tip holds the same `src/`.

`S/` below is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of the tip `49d32594`, whose orchestrator files equal the installed copy byte for byte. Row 0am, still open, makes `dispatch-log` refuse what frontier holds. This row moves the point frontier releases at, and so changes 0am's refusal.

## What is wrong

1. **frontier releases at integrate.** `completedIds` holds the integrated items (`S/run-frontier.cjs:163`, `itemIntegrated` at `:55-57`), and `unblocked` asks every `depends_on` to be in it (`:169`). The rest print `waiting` (`:239`). The text dispatches the next item after the integrate (`src/flows/inferno/agents/orchestrator/agent.md:78`).
2. **Integrate proves the live tree.** It refuses an uncommitted file that a check it runs reads, since the check reads the working tree and a host wrapper mirrors it (`S/run-integrate.cjs:255-261`). A run whose scope moved under it fails (`:320-323`, `S/run-proofs.cjs:186-189`).
3. **The record proves the live tree too.** It refuses over an uncommitted file the item owns or its review lists (`S/run-review.cjs:305-317`, `DIRTY`). It runs no mutant while any other uncommitted work is in the tree, and its proposals move to the intent review (`busy`, `S/run-mutant-runs.cjs:59-68`, and `:235-237`). Its mutants are written into the tree in place (row 0at).
4. **So a next builder blocks or weakens each proof of the item before it.** Releasing the dependent only at the integrate is what keeps them apart. Row 0am measured what an early dispatch costs on today's code: a record with no mutant (five proposals moved to the intent review), a record refused `DIRTY`, and up to 4 h 31 min with no integrate.

## Evidence

The measurements are the item-speed oracle's of 2026-11-26, `/home/ruben/.local/share/skoft-agents/Skoft_CRA/tech-lead/oracle/oracle-item-speed-20261126.md`, over the five items integrated that day. The plans in flight are single chains on one cargo tree. An item's loop took 127 min: build 39.5, two cold reviews 18.2, the record with its mutants 8.3, corrections 12.5, oracle 4.1, integrate 29.3 and turns 15.3. The next item's build waits for all of it but the build, about 88 min an item. Released at the commit, that build would run beside the reviews, the record, the corrections and the integrate. The oracle counts up to 0.6 h an item, an expectation that depends on how often a correction changes what the next builder reads.

## How to fix

1. **A proof tree.** `run.cjs worktree` also makes one detached worktree of the intent at a fixed path beside it (`<tree>.proof`). It runs `worktree.bootstrap` there once (`S/run-worktrees.cjs:124`), and `teardown` removes it. Its run records go to the detached folder `S/run-state-dir.cjs:11-16` already names. A fixed path keeps a host's remote copy of it warm.
2. **Integrate proves the commit there.** Every form folds the base into the live branch as today, then checks the proof tree out at that HEAD and runs every check there. Proofs are keyed by content in a folder every tree of the repository shares (`S/run-proofs.cjs:150-158`, `S/run-lib.cjs:370-373`), so a proof the proof tree mints holds for the live branch's commit. The landing reads each command's proof for the committed HEAD (`scopeHash` with `ref`, `S/run-proofs.cjs:25-40`) and runs a command that has none in the proof tree. The dirt refusal (`S/run-integrate.cjs:259-261`) and the moved check (`:320-323`) then read the proof tree, where only the run writes. The fold keeps its own refusal of a dirty file git will not merge across (`S/run-gate.cjs:89-93`).
3. **The review and the record read the commit there.** The lens dispatch names the proof tree as the tree to read. The record runs its mutants there, after any run there ended (row 0at's mark, kept per tree), and binds the listed files as the commit holds them (`filesHash` with `ref`, `S/run-review-hash.cjs:37`). The landing reads the review at the committed HEAD too (`itemReviewCurrent`, `:230-239`, and the status check of `standsSince`, `:210`). The review file is written and committed in the live tree, as today.
4. **frontier releases at the commit.** `unblocked` (`S/run-frontier.cjs:169`) also takes a dependency that is committed: its verify-item proof is `current` at HEAD (`proofAtHead`, `S/run-item-proof.cjs:137-163`), its ladder has not ended, and none of its files is dirty. A dependent still waits while its `ownership.editable` meets the dependency's files, the editable list with every path a dispatch of it claimed or was granted (`S/run-item-proof.cjs:153`). It prints `waiting <item> on <dependency> (shares <path>)`, because a correction of the dependency may need that file.
5. **The refusals follow.** Row 0am's `WAITING` in `dispatch-log` refuses a dependent whose dependency is neither integrated nor committed as in step 4, or shares a file with it, naming the path. 0am's frontier line for a built item (`built <item> owes ...`) stays. `integrate --item` refuses `WAITING` while a dependency is not integrated, so items still land in dependency order. Today nothing in integrate reads `depends_on`.
6. **A correction of the dependency.** It cannot change a file the dependent owns. The dependent waits on a shared file (step 4), and a grant of one of its files to the correction is refused while the dependent's dispatch is open (`refuseOverlap`, `S/run-dispatch-overlap.cjs:41-53`), which offers to join the two as one chain (`:49`). When the correction's commit changes a file the dependent's `context` manifest names, frontier, run after that commit (step 8), prints `delta <dependent> <path>`. Those lines ride the dependent builder's next correction as its deltas from predecessors (`agent.md:53`, `:70`), so they add no round while its first review asks for a fix, as 5 of 5 did on 2026-11-26. A review of the dependent that lists such a file is owed again by the hash rule (`S/run-review-hash.cjs:14-17`). The dependent lands only on its own green integrate, after its dependency's.
7. **One compile tree still takes one builder at a time.** `agent.md:60` serializes builders that share a compile tree. So the dependency's correction goes to its warm builder once the dependent's builder has handed back, and neither compiles the other's half-made edit. That is one reason the 0.6 h is an upper bound.
8. **Text.** `agent.md:78` also runs frontier after each item's commit, and dispatches what it released in the round of that item's review.

Weighed and not chosen: a tree of its own for the next builder. It would leave integrate and the record as they are and spare step 7's wait. It would carry each dispatch record between trees, since `dispatchDirectory` keys them by the tree's real path (`S/run-snapshot.cjs:61-63`), and the dependent's review would wait until its commit joins the branch.

Tests:

- In `S/run-frontier.test.cjs`: a dependency committed with a current verify-item proof releases its dependent as `ready`. A dependent that shares an editable or granted path prints `waiting ... (shares <path>)`. A dependency with no current proof keeps its dependent waiting.
- In `S/run-dispatch.test.cjs`: row 0am's cases under the new rule, and a dependent that shares a path is refused `WAITING` with the path.
- In `S/run-integrate-beside.test.cjs`: with a dependent's uncommitted file inside a running check's scope, integrate runs its checks in the proof tree, goes green and completes the item. A landing on the same commit runs nothing. `integrate --item <dependent>` is refused `WAITING` before its dependency integrates.
- In `S/run-review-mutants.test.cjs`: with another builder's uncommitted file in the live tree, an item's record runs its mutants in the proof tree and owes nothing to the intent review.
- In `S/run-review-fold.test.cjs`: a review recorded at the commit stays current at the landing while a file it lists is dirty in the live tree.

## Which part is the flow and which the host

All of it is the flow's. The host's part, not for the builder of the row: its wrapper sends the proof tree as any tree of the repository, since it keys on the root commit (`/home/ruben/.local/share/skoft-agent-hooks/remote-run.sh:170-172`). Each machine keeps a second copy per intent, with one cold compile (`cargo test` 1,265 s cold against 605 s warm, by the oracle) and its disk. Omega read 102.0 GiB against its 90.0 GiB prune line in support-period's `session-o67eke-open.log` at 15:25:22Z.

## Why row 0am's evidence no longer bites

- **The mutants that moved to the intent review.** The record runs them in the proof tree, at the item's commit, where no builder's file is.
- **The record refused `DIRTY` over `src-tauri/src/commands/license.rs`.** The next builder owns no file of the item before it, and the record binds the commit in the proof tree, so another builder's edit in the live tree is nothing it reads.
- **No integrate for hours.** Integrate's checks run in the proof tree. In the live tree a builder's file meets only the fold, which merges past every file the base did not change.

Row 0at keeps its rule inside each tree. Row 0bl is unchanged: a `check: true` mutant runs bare in the tree where the record runs, now the proof tree (`S/run-mutate-check.cjs:15-17`). Row 0bu's run at the commit is the run of step 2.

## Until it is built

Row 0am's workaround stands. The orchestrator dispatches only an item `frontier` prints `ready` that has no dispatch or review yet, and a dependent waits for its dependency's integrate. With row 0bu's brief line the integrate checks start at the commit, beside the reviews, so that wait is shorter. Items of a frontier that do not depend on each other go out in one round, as today (`agent.md:40`).
