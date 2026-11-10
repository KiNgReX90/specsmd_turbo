# INFERNO flow fixes, stopped mid-run: handoff

Written 2026-11-10. The work below was running in this repo and was stopped on the owner's order at about 07:25 local time. No more tokens go into it until a session picks it up together with `inferno-improvement.md`.

The state comes from the session that ran the work and was checked against the repository. Read it again before you act, with the commands in section 6: a queued gate may still have pushed three commits after this note was written.

## 1. What this work is

Fixes to the current INFERNO flow, found while the app repo ran a 28-item intent. They were queued here because a host's installed flow copies are locked and change only through a reinstall. `inferno-improvement.md` is the larger change and builds on top of them.

On the app repo no running intent depends hard on any of these fixes: each one has a workaround there. Two workarounds rest on every session remembering them, so those two fixes matter most: the ledger commit (item 1 below) and the mutate verdict (section 3).

## 2. The intent

Intent `integrate-checks-what-a-base-commit-changed-and-lands-beside-busy-siblings-verify-item-waits-only-on-overlap-and-a-run-branch-keeps-its-config`. Branch `inferno-intent/<that id>-20261109T194552Z`, head `4446e8b2`, in its own linked worktree. `main` at `49260ca4` is folded in.

| Item | Status | What is left |
| --- | --- | --- |
| `ri-the-ledger-commit-stages-only-what-completion-wrote` | Completed, integrated at `5fcdaa05` | Nothing |
| `ri-verify-item-waits-only-on-an-overlapping-open-dispatch` | Completed, integrated at `350cf394` | Nothing |
| `ri-a-run-branch-keeps-the-config-it-was-given` | Review said fix: one minor finding and 3 of 20 mutants survived. The correction is committed as `4446e8b2`, 155 of 155 tests green | One re-review, which was stopped before a verdict. Then record it and integrate |
| `ri-integrate-on-the-base-diffs-from-since-or-origin` | Review said fix: one major and three minor findings, 2 of 8 mutants survived. The correction is half done and uncommitted in the intent worktree: `check-doubles.cjs`, `check-doubles.test.cjs`, `run-integrate-base.test.cjs`. The new tests ran red as expected. Dispatch `9c354929` is open | Finish findings 1 to 4, accept the dispatch, verify, commit, one re-review, integrate |
| `ri-integrate-refuses-only-the-dirt-it-reads-or-commits` | Not built. It depends on the base item and the ledger item. Complexity high, four acceptance criteria | The whole item. Its part 3 is the fix for a landing that refuses after `main` moved: hash the union of the running checks' scopes, reusing `ownershipOverlaps` from `run-peers.cjs` |

After the items: intent scan, intent review, gate, close and archive, ship.

**A trap.** The rebase onto the new `main` orphaned the first dispatch baselines of the config item and the base item. A bare `run.cjs verify-item` there names everything since the stale root as outside the item. Prove the item's own commit with `git show --stat`, or with `--since` once the tree is clean.

## 3. Direct builds

| What | State |
| --- | --- |
| Mutate verdict: a red run is caught only when a test summary reports a failure | Committed on local `main` as `ecdbb0b3`. Not pushed when this was written |
| Scan: the plan collect writes every gap line to a file the planner is resumed from | Committed on local `main` as `b5aea0b4`. Not pushed when this was written |
| A Turbo test that fails where `PATH` holds no `node`: it now spawns the running node by its path | Committed on local `main` as `a1b2c08d`. Not pushed when this was written |
| Mutate seal: a host lists sealed files under `mutate.sealed`, and mutate reseals before the test when a mutant sits in one | Written, uncommitted and unverified in the primary checkout. Modified: `config.example.yaml`, `run-lib.cjs`, `run-mutate-batch.cjs`, `run-mutate-journal.cjs`, `run-mutate.cjs`, `run.cjs`. New: `run-mutate-seal.cjs` and its test |
| Planner launcher line (`claude/commands/inferno-planner.md:68`): a direct build lands with the host's own landing command | Not started. It needs the base item's `integrate --since` on `main` first |
| Plan-time scan rule: the whole plan once with one repair, then a slice per item at its dispatch | Not started. Package P12 of `inferno-improvement.md` is built in its place |

The first `validate:all` of `b5aea0b4` and `ecdbb0b3` was 2453 of 2454, and its one red was the Turbo `PATH` test that `a1b2c08d` fixes. A `validate:all` of `a1b2c08d` was still queued on a test machine when the work stopped. The stopped session pushes the three commits when that run is green, without force, and pushes nothing when it is red.

## 4. The order to finish it

1. **`main` first.** Check whether the three commits are on `origin/main`. When they are not, run `validate:all` on local `main` and push on green.
2. **The mutate seal.** Run its tests. Commit it when green, drop it when the owner says so. It edits `run-mutate-batch.cjs`, which package P1 of the improvement plan also edits, so it lands before P1.
3. **The config item.** One re-review, record, integrate.
4. **The base item.** Finish the correction, one re-review, integrate.
5. **The fifth item.** Build it, review it, integrate.
6. **Ship the intent.**
7. **Then the improvement plan.** It owns other files, apart from the one overlap in step 2.

For steps 3 to 5, hold each re-review to the delta rule of package P2 by hand, in the reviewer's dispatch: a new finding only as a blocker or a major on a line the correction changed, no new mutants, and only the survivors run again. Without that the old loop can run on, which is what the improvement plan exists to end.

If the base item needs more than one further round, split the intent the way the app repo has done by hand: ship the three integrated items, and move the base item and the fifth item to a successor intent. The ledger fix then reaches a host without waiting for them.

## 5. What waits on this

- **The reinstall on the app repo**, from 0.1.81 to the released version. It waits on the intent shipping and then on the owner's word.
- Once the mutate seal ships, the app repo names its sealed definition files and its reseal command under `mutate.sealed` in its own config.

## 6. Read the state again first

```bash
git fetch origin
git log --oneline origin/main..main          # local commits that are not pushed
git status --porcelain                       # the primary checkout: the seal work
git worktree list                            # the intent worktree and the scratch ones
git -C <intent worktree> status --porcelain  # the base item's half-done correction
git -C <intent worktree> log --oneline -5
node src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs frontier <intent id> --tree <intent worktree>
```

## 7. What may be cleaned up, and when

- The intent worktree holds work. It goes with the ship.
- A clean worktree detached at local `main` ran the gate. It goes once that gate has ended.
- A scratch worktree detached at `bc64ec53` belongs to the base item's builder. It holds a copy of the correction plus what is probably a mutant in `run-integrate.cjs`, so it is not the source of truth. It may go.
- A scratch worktree on branch `review-scratch-ri-config-rereview` is clean and may go, with its branch.
- The mirrors of this repo and of the intent worktree on the test machines hold no work. They may go once nothing runs in them.
- Two untracked files in the primary checkout, `inferno-lifecycle.html` and `src/specsmd-0.1.76.tgz`, were there before this work and belong to nobody in it.
