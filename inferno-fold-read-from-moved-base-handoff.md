# Handoff: a fold is read from where the base ref stands now, so a base rewritten after the fold turns the files it brought in into changes outside the item's ownership

Met 2026-11-18 on Skoft_CRA, intent `the-public-sites-light-theme-is-spectrum-on-every-page`, on the build at `f3be640a`. The code is the same at the branch tip `f0f06aaf`: `S/run-fold.cjs` is byte-identical, and `S/run-attribute.cjs` differs by one line that names the ledger.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

## What is wrong

`foldRanges` (`S/run-fold.cjs:30-40`) says what a fold of the base brought into the run branch. Per base ref it takes `tip = merge-base(HEAD, ref)` and `held = merge-base(<baseline>, tip)`. That is the fold only while every commit HEAD merged from the base is still an ancestor of that ref.

The flow folds the local base itself: `foldBase` (`S/run-gate.cjs:79-103`) merges `<base>` and then `origin/<base>`, and ship does the same at `S/run-ship.cjs:104`. So a run branch takes in commits the local base holds and origin does not hold yet. When the local base is then rewritten, by a `git rebase origin/<base>` before its push, those commits get new shas. HEAD holds the old ones, the ref holds the copies, and `merge-base(HEAD, ref)` falls back to the last commit both still share. Everything the fold brought in beyond that commit is in no range.

`foldedSince` (`S/run-attribute.cjs:48-57`, called at `:104`) then leaves those files out of the base's set. `unexplainedChanges` flags them, no dispatch claims them, and `verify-item` lists them as `outside` (`:110`) and fails on that (`S/run-item-proof.cjs:372`). The item is held for files no builder of the intent touched.

A new fold of the base hides it: the copies come in, `merge-base(HEAD, ref)` is the ref's tip again, and the range names the same files. It returns with the next rewrite of the base.

Three other readers take the same ranges and are wrong the same way, read in the code and not met in a run:

- `foldedAlone` (`S/run-fold.cjs:130-144`): a claimed file the base alone changed reads as changed by someone else, which is the refusal "accepted dispatch bytes changed".
- `baseLines` through `S/run-item-proof.cjs:431`: a line the base added reads as the item's own in its proof. That is section 12 of the first handoff again, for this one case.
- `foldBound` and `ownFiles` (`S/run-intent-fold.cjs:38` and `:64`): `<base>...HEAD` names the old copies' files as the intent's own, so under `review.outside` the intent review is bound to them.

`verify-item --since HEAD` is no way around it: it leaves the dispatch record, so a path the orchestrator granted reads as outside.

## Evidence

Delta (`ruben@100.82.4.124`), tree `~/dev/Skoft_CRA-inferno-the-public-sites-light-theme-is-spectrum-on-every-page`, read 2026-11-18 13:23Z to 13:40Z. All times UTC. Delta's own clock and reflog are in EST.

The base on that machine, from `git reflog show main` in `~/dev/Skoft_CRA`:

- 2026-11-17 18:48Z to 19:33Z: four commits on local `main` that origin does not hold: `e4493dfda`, `b1236c44a`, `b2919fbaf`, `5ed4b11e5`. A fifth, `49c866e16`, follows at 2026-11-18 01:02Z.
- `main` is rebased onto `origin/main` at 2026-11-17 23:12:50Z, 2026-11-18 02:36:54Z and 05:14:22Z. After the last one the five are `c15f5e3db`, `833a5748d`, `9c8db7c3a`, `51186b244` and `e6efe23c5`.
- 2026-11-18 08:48:15Z: `098cfe117` on local `main`. Rebased at 13:20:57Z, it is `0c3a2eb28`.

The run branch, from `git log --first-parent --merges`:

- `899789443`, 2026-11-17 23:04:35Z, "Merge branch 'main'": second parent `5ed4b11e5`.
- `03a8441d1`, 2026-11-18 00:11:00Z, "Merge branch 'main'": second parent `ef217497c`, the first rebase's result.
- `b629dae90`, 02:21:29Z, "Merge branch 'main'": second parent `49c866e16`. One second later `56ecdb175` merges `origin/main` at `ddcd7622d`.

The item: the chain of `spl-the-chrome-the-buttons-and-the-shared-plates-are-lit` and `spl-the-light-ground-is-the-spectrum-field`. Its dispatch `9215265e` was accepted at 13:07:50Z on HEAD `1d0b9c860`. The first baseline of its lineage is `6b37f3d7a` of 2026-11-17 12:38:19Z (records under `~/.cache/specsmd-inferno/Skoft_CRA/dispatch/25684ec9.../`). The session's `verify-item` listed nine files under `src/`, `src-tauri/` and `integration/` as outside ownership.

Recomputed with the git calls `foldRanges` and `foldedSince` make, for baseline `6b37f3d7a`:

| State | `main` | `origin/main` | `held` | `tip`, local ref | `tip`, origin ref | Changed since the baseline, in no range |
| --- | --- | --- | --- | --- | --- | --- |
| At the refusal, HEAD `1d0b9c860` | `a9f5f217f` | `08a795423` | `a490056ec` | `ddcd7622d` | `ddcd7622d` | the nine below |
| After the fold `8f2ec552c` of 13:10:37Z | `a9f5f217f` | `08a795423` | `a490056ec` | `a9f5f217f` | `43e4d9bfc` | none of the nine |
| After the rebase of 13:20:57Z, HEAD `6090bf853` | `0c3a2eb28` | `08a795423` | `a490056ec` | `43e4d9bfc` | `43e4d9bfc` | `scripts/integration-decide.mjs`, `scripts/real-app-lane-base.test.mjs` |

The nine: `integration/lib/startup-capture.mjs`, `integration/lib/startup-capture.test.mjs`, `integration/lib/startup-capture-worker.mjs`, `src/lib/dossier/generate-round.svelte.ts`, `src/lib/dossier/generate-round.test.ts`, `src/lib/wizard/evidence.test.ts`, `src/lib/wizard/evidence.ts`, `src-tauri/src/commands/product/traces_tests.rs`, `src-tauri/src/dossier/store/integrity.rs`.

- They are exactly the files of `e4493dfda`, `b1236c44a`, `b2919fbaf` and `5ed4b11e5`. No commit of the intent's own touched them: `git log --first-parent --no-merges 6b37f3d7a..1d0b9c860 -- <the nine>` is empty.
- `git merge-base --is-ancestor 49c866e16 1d0b9c860` holds, and the same against `a9f5f217f` does not: HEAD has the old commits and the base has their copies.
- `git diff 1d0b9c860 a9f5f217f -- <the nine>` is empty. The run branch holds each of them byte for byte as the base holds it.
- The third row is the same defect one rewrite later: the two files are those of `098cfe117`, which `8f2ec552c` folded and the rebase of 13:20:57Z replaced. The next `verify-item` of an item whose baseline predates `8f2ec552c` is expected to list them. That row is computed, not met.
- `git rev-list --count --right-only --no-merges a9f5f217f...49c866e16` is 5. With `--cherry-pick` it is 0: every commit the old tip holds beyond the base has a commit of the same patch on the base.

The installed flow there: `flow.lock` reads `source_commit: f3be640a...`, and `check-lock` says 356 files match.

## How to fix

Read a fold from what HEAD merged, and never from where a base ref stands today.

1. `foldRanges` keeps today's range per ref, which also covers a fold that was a fast-forward.
2. It adds one range per merge commit on HEAD's own line since the baseline (`git rev-list --first-parent --merges <baseline>..HEAD`) whose second parent was the base: `{ held: merge-base(M^1, M^2), tip: M^2 }`.
3. A second parent was the base when a base ref holds it, or when every commit it holds beyond that ref has a commit of the same patch on the ref: `git rev-list --count --cherry-pick --right-only --no-merges <ref>...<M^2>` is 0. The first is today's case. The second is the rewritten base.
4. A range that an earlier one already covers is dropped, as today.
5. All four readers take the ranges from that one function, so they are fixed together.

A second parent that fails both tests is no fold, and its files stay outside. That is right: a commit the base dropped or changed is no longer the base's. A rebase that resolved a conflict by hand changes the patch and lands there too, and a new fold of the base still clears it.

Tests, in `run-fold.test.cjs` and `run-attribution.test.cjs`, on a fixture with a remote:

- the local base holds a commit that changes file X and origin does not; the run branch folds the base; origin moves; the local base is rebased onto it. `foldRanges` still names X, and `verify-item` of an item whose baseline predates the fold lists nothing outside;
- the same after the base was rebased twice, and after a second fold followed by a second rebase;
- a merge of a branch that never was the base, whose commits have no copy on the base, still lists its files as outside;
- a base commit that was amended to a different patch after the fold still lists its file as outside;
- `foldedAlone`, `baseLines` and `foldBound` each get one case on the rewritten base: the claimed file the base alone changed is accepted, the base's added line is not the item's, and the review is not bound to the old copies' files.

## Which part is the flow and which the host

The reading is the flow's. A local base that is rebased before its push is ordinary git, and the flow chooses to fold that local ref.

The host can lower how often it meets this, and that is no part of this row: on Delta the local `main` held direct builds for hours and was rebased four times in fifteen hours. A local base brought up with `git merge origin/main`, or pushed before a run branch folds it, never loses a commit a run branch holds.

## Until it is built

When `verify-item` lists files outside ownership that no builder of the intent touched and that the base holds byte for byte, fold the base again (`git merge main` in the intent's tree, or the next integrate or gate, which folds by itself) and run `verify-item` again. It can return after each rebase of the local base, and the same step clears it. Never `--since HEAD` for an item that holds a grant.
