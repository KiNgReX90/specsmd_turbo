# INFERNO flow fixes, stopped mid-run: handoff

Written 2026-11-10. The work below was running in this repo and was stopped on the owner's order at about 07:25 local time. The session that ran it is closed. No more tokens go into it until a session picks it up together with `inferno-improvement.md`.

**Everything it needs is on this remote.** Nothing has to be fetched from the machine it ran on.

## 1. Where everything is

| Branch on `origin` | Head | What it holds |
| --- | --- | --- |
| `inferno-improvement` | this branch | Pull request 5, the one place for every handoff: this file, the improvement plan `inferno-improvement.md` and the run defects `inferno-run-defects-2026-11-10-handoff.md` |
| `inferno-intent/integrate-checks-what-a-base-commit-changed-and-lands-beside-busy-siblings-verify-item-waits-only-on-overlap-and-a-run-branch-keeps-its-config-20261109T194552Z` | `4446e8b2` | The intent: two items integrated, two built and in a fix review, one not built |
| `handoff/base-item-correction-wip` | `d135d299` | One commit on top of the intent head: the half-done, unverified correction of the base item |
| `handoff/flow-fixes-main` | `a1b2c08d` | Three finished commits on top of `main` that were never pushed to `main`, because their test run did not finish |
| `handoff/mutate-seal-wip` | `b2dec453` | One commit on top of `handoff/flow-fixes-main`: the mutate seal, written and never tested |

`main` on `origin` is `49260ca4` and holds none of this work.

## 2. What this work is

Fixes to the current INFERNO flow, found while the app repo ran a 28-item intent. They were queued here because a host's installed flow copies are locked and change only through a reinstall. `inferno-improvement.md` is the larger change and builds on top of them.

On the app repo no running intent depends hard on any of these fixes: each one has a workaround there. Two workarounds rest on every session remembering them, so those two fixes matter most: the ledger commit (the first item below) and the mutate verdict (section 4).

## 3. The intent

Five items. `main` at `49260ca4` is folded into the branch.

| Item | Status | What is left |
| --- | --- | --- |
| `ri-the-ledger-commit-stages-only-what-completion-wrote` | Completed, integrated at `5fcdaa05` | Nothing |
| `ri-verify-item-waits-only-on-an-overlapping-open-dispatch` | Completed, integrated at `350cf394` | Nothing |
| `ri-a-run-branch-keeps-the-config-it-was-given` | Review said fix: one minor finding, and 3 of 20 mutants survived. The correction is committed as `4446e8b2`, 155 of 155 tests green | One re-review, which was stopped before a verdict. Then record it and integrate |
| `ri-integrate-on-the-base-diffs-from-since-or-origin` | Review said fix: one major and three minor findings, and 2 of 8 mutants survived. The correction is half done, on `handoff/base-item-correction-wip`: `check-doubles.cjs`, `check-doubles.test.cjs`, `run-integrate-base.test.cjs`. The new tests ran red as expected, and findings 3 and 4 were in work | Finish findings 1 to 4, verify, commit on the intent branch, one re-review, integrate |
| `ri-integrate-refuses-only-the-dirt-it-reads-or-commits` | Not built. It depends on the base item and the ledger item. Complexity high, four acceptance criteria | The whole item. Its part 3 is the fix for a landing that refuses after `main` moved: hash the union of the running checks' scopes, reusing `ownershipOverlaps` from `run-peers.cjs` |

After the items: intent scan, intent review, gate, close and archive, ship.

The review files of the two open items are on the intent branch, under `.specs-inferno/intents/<intent>/reviews/`. They hold every finding with its fix.

**Two traps.**

- The dispatch log lives in a cache on the machine the work ran on, and it is not on this remote. The base item's correction was an open dispatch there. On another machine, start that correction as a fresh dispatch from the work-in-progress commit.
- A rebase onto the new `main` orphaned the first dispatch baselines of the config item and the base item. A bare `run.cjs verify-item` there names everything since the stale root as outside the item. Prove an item's own commit with `git show --stat`, or with `--since` once the tree is clean.

## 4. Direct builds

| What | State |
| --- | --- |
| Mutate verdict: a red run is caught only when a test summary reports a failure | `ecdbb0b3` on `handoff/flow-fixes-main` |
| Scan: the plan collect writes every gap line to a file the planner is resumed from | `b5aea0b4` on `handoff/flow-fixes-main` |
| A Turbo test that fails where `PATH` holds no `node`: it now spawns the running node by its path | `a1b2c08d` on `handoff/flow-fixes-main` |
| Mutate seal: a host lists sealed files under `mutate.sealed`, and mutate reseals before the test when a mutant sits in one | `b2dec453` on `handoff/mutate-seal-wip`. Written, never tested. It changes `config.example.yaml`, `run-lib.cjs`, `run-mutate-batch.cjs`, `run-mutate-journal.cjs`, `run-mutate.cjs` and `run.cjs`, and adds `run-mutate-seal.cjs` with its test |
| Planner launcher line (`claude/commands/inferno-planner.md:68`): a direct build lands with the host's own landing command | Not started. It needs the base item's `integrate --since` on `main` first |
| Plan-time scan rule: the whole plan once with one repair, then a slice per item at its dispatch | Not started. Package P12 of `inferno-improvement.md` is built in its place |

The first `validate:all` of `b5aea0b4` and `ecdbb0b3` was 2453 of 2454. Its one red was the Turbo `PATH` test, which `a1b2c08d` fixes. No `validate:all` has run on `a1b2c08d` itself.

## 5. The order to finish it

1. **The three finished commits.** Run `cd src && npm run validate:all` on `handoff/flow-fixes-main`. On green, fast-forward `main` to it and push.
2. **The mutate seal.** Run its tests on `handoff/mutate-seal-wip`. Land it when green. It edits `run-mutate-batch.cjs`, which package P1 of the improvement plan also edits, so it lands before P1.
3. **The config item.** One re-review, record, integrate.
4. **The base item.** Take the work-in-progress commit into the intent worktree as uncommitted changes with `git cherry-pick -n d135d299`. Finish the correction, one re-review, integrate.
5. **The fifth item.** Build it, review it, integrate.
6. **Ship the intent.**
7. **The two open defects of section 6.**
8. **Then the improvement plan.**

For steps 3 to 5, hold each re-review to the delta rule of package P2 by hand, in the reviewer's dispatch: a new finding only as a blocker or a major on a line the correction changed, no new mutants, and only the survivors run again. Without that the old loop can run on, which is what the improvement plan exists to end.

If the base item needs more than one further round, split the intent the way the app repo has done by hand: ship the three integrated items, and move the base item and the fifth item to a successor intent. The ledger fix then reaches a host without waiting for them.

## 6. The run defects handoff

`inferno-run-defects-2026-11-10-handoff.md`, beside this file, holds three defects another session met while it ran an intent, each with its evidence and a way to fix it.

| Defect | State |
| --- | --- |
| The completion's ledger commit sweeps up an unrecorded review file | Already fixed by the first item of section 3, integrated at `5fcdaa05`. It reaches a host when the intent ships |
| One stale diagnosis probe stops the whole frontier (`run-frontier.cjs:172`) | Open. Nobody has built it |
| A fold of the base re-owes the review of every item that lists a shared registry file (`run-review.cjs:290`) | Open. Nobody has built it. Package P3 of the improvement plan changes the same reader, so build this one first or inside P3 |

## 7. What waits on this

- **The reinstall on the app repo**, from 0.1.81 to the released version. It waits on the intent shipping and then on the owner's word.
- Once the mutate seal ships, the app repo names its sealed definition files and its reseal command under `mutate.sealed` in its own config.

## 8. Start from a fresh clone

```bash
git fetch origin
git branch -r                                   # the branches of section 1
git log --oneline origin/main..origin/handoff/flow-fixes-main
git worktree add ../intent "inferno-intent/integrate-checks-what-a-base-commit-changed-and-lands-beside-busy-siblings-verify-item-waits-only-on-overlap-and-a-run-branch-keeps-its-config-20261109T194552Z"
git -C ../intent cherry-pick -n d135d299        # the base item's half-done correction, uncommitted
node src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs frontier <intent id> --tree ../intent
```

## 9. Leftovers on the machine it ran on

These exist only there, and none holds work that is missing from this remote.

- The intent worktree, with the base item's correction uncommitted. It is the same content as `d135d299`.
- The primary checkout, with the mutate seal uncommitted. It is the same content as `b2dec453`. Two untracked files there, `inferno-lifecycle.html` and `src/specsmd-0.1.76.tgz`, were there before this work and are not part of it.
- Local `main`, three commits ahead of `origin/main`. It is the same as `handoff/flow-fixes-main`.
- A clean worktree detached at local `main`, a scratch worktree detached at `bc64ec53` and a scratch worktree on branch `review-scratch-ri-config-rereview`. All three may go.
- The mirrors of this repo and of the intent worktree on the test machines. They may go.
