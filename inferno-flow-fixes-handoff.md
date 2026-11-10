# INFERNO flow fixes, stopped mid-run: handoff

Written 2026-11-10. The work below was running in this repo and was stopped on the owner's order at about 07:25 local time. The session that ran it is closed. No more tokens go into it until a session picks it up.

**Everything is on this one branch, `inferno-improvement`, which is pull request 5.** The three handoff documents and all of the stopped work are in it. Nothing has to be fetched from another branch or from the machine it ran on.

## 1. What is on this branch

| Part | Where | State |
| --- | --- | --- |
| The improvement plan | `inferno-improvement.md` | A plan. Nothing of it is built |
| This handoff | `inferno-flow-fixes-handoff.md` | |
| Three run defects another session met | `inferno-run-defects-2026-11-10-handoff.md` | One is fixed by this branch, two are open. See section 6 |
| The stopped intent | Merged in at `4446e8b2` | Two of five items integrated, two built and in a fix review, one not built |
| The base item's correction | Merged in at `d135d299` | Half done and unverified. Its new tests are red on purpose until it is finished |
| Three finished direct builds | Merged in at `a1b2c08d` | Finished. Never proved together by one test run |
| The mutate seal | Merged in at `b2dec453` | Written, never tested |

Every part was merged with its own history, so each commit above is still there. `git branch <name> <commit>` gives any part back on its own.

**The tree of this branch has never been tested as a whole.** One merge had a conflict, in the usage text of `run.cjs`, and both sides' lines were kept. Every changed script parses. Nothing more is proved.

`main` on `origin` is `49260ca4` and holds none of this.

## 2. What this work is

Fixes to the current INFERNO flow, found while the app repo ran a 28-item intent. They were queued here because a host's installed flow copies are locked and change only through a reinstall. `inferno-improvement.md` is the larger change and builds on top of them.

On the app repo no running intent depends hard on any of these fixes: each one has a workaround there. Two workarounds rest on every session remembering them, so those two fixes matter most: the ledger commit (the first item below) and the mutate verdict (section 4).

## 3. The intent

Intent `integrate-checks-what-a-base-commit-changed-and-lands-beside-busy-siblings-verify-item-waits-only-on-overlap-and-a-run-branch-keeps-its-config`. Its brief, its work items and its review files are under `.specs-inferno/intents/<that id>/`.

| Item | Status | What is left |
| --- | --- | --- |
| `ri-the-ledger-commit-stages-only-what-completion-wrote` | Completed | Nothing |
| `ri-verify-item-waits-only-on-an-overlapping-open-dispatch` | Completed | Nothing |
| `ri-a-run-branch-keeps-the-config-it-was-given` | Review said fix: one minor finding, and 3 of 20 mutants survived. The correction is in, 155 of 155 tests green | One re-read of the correction against the review file |
| `ri-integrate-on-the-base-diffs-from-since-or-origin` | Review said fix: one major and three minor findings, and 2 of 8 mutants survived. The correction is half done in `check-doubles.cjs`, `check-doubles.test.cjs` and `run-integrate-base.test.cjs`. Findings 3 and 4 were in work | Finish findings 1 to 4 from its review file, get its tests green, one re-read |
| `ri-integrate-refuses-only-the-dirt-it-reads-or-commits` | Not built. Complexity high, four acceptance criteria | The whole item. Its part 3 is the fix for a landing that refuses after `main` moved: hash the union of the running checks' scopes, reusing `ownershipOverlaps` from `run-peers.cjs` |

**The ledger on this branch still says the intent is running on its own branch.** `.specs-inferno/state.yaml` names the intent as claimed, and the INFERNO runner would look for a branch and a dispatch log that exist only on the machine the work ran on. Finish the three open items by hand on this branch, against their specs and review files. When they are done, close and archive the intent in the ledger with the state writer, so `main` does not receive a claim nobody holds.

## 4. Direct builds

| What | State |
| --- | --- |
| Mutate verdict: a red run is caught only when a test summary reports a failure | In, as `ecdbb0b3` |
| Scan: the plan collect writes every gap line to a file the planner is resumed from | In, as `b5aea0b4` |
| A Turbo test that fails where `PATH` holds no `node`: it now spawns the running node by its path | In, as `a1b2c08d` |
| Mutate seal: a host lists sealed files under `mutate.sealed`, and mutate reseals before the test when a mutant sits in one | In, as `b2dec453`, never tested. It changes `config.example.yaml`, `run-lib.cjs`, `run-mutate-batch.cjs`, `run-mutate-journal.cjs`, `run-mutate.cjs` and `run.cjs`, and adds `run-mutate-seal.cjs` with its test |
| Planner launcher line (`claude/commands/inferno-planner.md:68`): a direct build lands with the host's own landing command | Not started. It needs the base item's `integrate --since` first |
| Plan-time scan rule: the whole plan once with one repair, then a slice per item at its dispatch | Not started. Package P12 of `inferno-improvement.md` is built in its place |

The first `validate:all` of `b5aea0b4` and `ecdbb0b3` was 2453 of 2454. Its one red was the Turbo `PATH` test, which `a1b2c08d` fixes.

## 5. The order to finish it

1. **See where the branch stands.** Run `cd src && npm run validate:all` and the script tests under `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. The base item's new tests are expected red. Anything else that is red comes from the untested mutate seal or from the merge, and is fixed first.
2. **The mutate seal.** Get its own tests green, or take it out with `git revert -m 1` of its merge when the owner says it is not worth finishing.
3. **The config item.** One re-read of its correction.
4. **The base item.** Finish the correction, tests green, one re-read.
5. **The fifth item.** Build it and review it.
6. **The two open defects of section 6.**
7. **Close and archive the intent in the ledger.**
8. **Then the improvement plan**, on this same branch. Package P1 edits `run-mutate-batch.cjs`, which the mutate seal also edits, so step 2 comes before it.
9. **One merge of this branch into `main`**, when everything on it is green.

Hold each re-read to the delta rule of package P2: a new finding only as a blocker or a major on a line the correction changed, no new mutants, and only the survivors run again. Without that the old loop can run on, which is what the improvement plan exists to end.

## 6. The run defects handoff

`inferno-run-defects-2026-11-10-handoff.md`, beside this file, holds three defects another session met while it ran an intent, each with its evidence and a way to fix it.

| Defect | State |
| --- | --- |
| The completion's ledger commit sweeps up an unrecorded review file | Fixed on this branch by the first item of section 3 |
| One stale diagnosis probe stops the whole frontier (`run-frontier.cjs:172`) | Open. Nobody has built it |
| A fold of the base re-owes the review of every item that lists a shared registry file (`run-review.cjs:290`) | Open. Nobody has built it. Package P3 of the improvement plan changes the same reader, so build this one first or inside P3 |

## 7. What waits on this

- **The reinstall on the app repo**, from 0.1.81 to the released version. It waits on this branch reaching `main` and then on the owner's word.
- Once the mutate seal ships, the app repo names its sealed definition files and its reseal command under `mutate.sealed` in its own config.

## 8. Start from a fresh clone

```bash
git fetch origin
git switch inferno-improvement
git log --oneline --merges origin/main..HEAD   # the parts, one merge each
cd src && npm run validate:all
```

## 9. Leftovers on the machine it ran on

None of them holds work that is missing from this branch. All may go.

- The intent's own worktree and branch, with the base item's correction uncommitted. It is the same content as `d135d299`.
- The primary checkout, with the mutate seal uncommitted. It is the same content as `b2dec453`. Two untracked files there, `inferno-lifecycle.html` and `src/specsmd-0.1.76.tgz`, were there before this work and are not part of it.
- Local `main`, three commits ahead of `origin/main`. Those are the three finished direct builds. Reset it to `origin/main` once this branch is fetched, so they reach `main` only through this branch.
- Two scratch worktrees and one clean worktree detached at local `main`.
- The mirrors of this repo and of the intent worktree on the test machines.
