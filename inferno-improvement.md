# INFERNO improvement: what is left, the rollout and the measure

Rewritten 2026-11-10. The improvement plan that stood here is built on this branch as version 0.1.82, so its packages are gone from this file. Its full text is in this file's history at `da955489`. Six handoff files went with it, because what they asked for is built too: the flow fixes, the three run defects, the ownership grant, the deferred item, the lane exception and the remote mutants. `CHANGELOG.md` says what each one became.

This file now holds four things: what is still open, how the flow reaches a host, how we judge it there, and where the first host's findings go.

The flow has not carried real work yet. The owner decided on 2026-11-10 to install it on the app repo from this branch, before the merge, and to watch it there.

## 1. What is still open

Each line names where the gap shows. `S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

1. **The flow-fixes intent is open in this repo's own ledger.** `.specs-inferno/state.yaml` holds it as `awaiting-manual`. Three of its five items are `pending`: `ri-integrate-on-the-base-diffs-from-since-or-origin` with `review: fix`, `ri-a-run-branch-keeps-the-config-it-was-given` with `review: fix`, and `ri-integrate-refuses-only-the-dirt-it-reads-or-commits` with no review. Their code and tests are on this branch. None was reviewed clean or integrated through the runner, and the intent was never closed or archived. To finish: one re-read of each open review under the delta rule, then `close-intent` and `archive-intent`.
2. **The planner launcher still lands with a bare integrate.** `src/flows/inferno/claude/commands/inferno-planner.md:68` says `run.cjs integrate` with no `--since` and no host landing command. The base item built `--since`, and the launcher text was not moved with it.
3. **The release steps are half proved.** `src/package.json` is 0.1.82 and the changelog entry stands under `[Unreleased]`. On 2026-11-10, at `b41af916`, `npm run validate:all` was green on a test machine and `npm pack` worked. The install eval fails, because it installs the ideation flow (`inferno-0.1.82-host-install-handoff.md`, section 4). The e2e smoke has no record. The branch is not merged.
4. **P0's own run was skipped.** The readout exists (`evals/review-loop/stats.cjs`, `tokens.cjs`, `measure.cjs`). It was never run on the measured intent, and the plan correction that run would have given was never made. Section 3 replaces it: the first host intent is measured against the old numbers.
5. **P5, new scope is a new item, is left on purpose.** It waits on a classification of the 75 later findings, which nobody made. The reviewer has no scope check (`src/flows/inferno/agents/reviewer/agent.md:18-24`), and a grant still widens an item (`src/flows/inferno/agents/orchestrator/agent.md:70`).
6. **P8, the live test and the break test, is left on purpose.** It waits on the owner's go. Nothing of it exists.
7. **P11 holds half of what it planned.** The plan lint checks that an acceptance criterion carries a code span. It does not check that the criterion states the value its test must show, because only a reader can judge that (`S/run-plan-lint.cjs:13-16`). This is recorded as dropped, unless a reader check is wanted.
8. **P9 went further than its text.** The plan said the reviewer's last check keeps ownership and secrets. It is secrets only now (`src/flows/inferno/agents/reviewer/agent.md:24`), and ownership is held by the attribution in `verify-item` alone. No test pins that the host's rules are gone from the reviewer's text.
9. **Leftovers on the machine the work ran on.** None holds work that is missing from this branch, and all may go: the stopped intent's worktree and branch, the scratch worktrees of the flow repo, the mirrors on the test machines, and a local `main` that is three commits ahead of `origin/main`. Reset that `main` to `origin/main`, so those three commits reach `main` only through this branch.

## 2. Rollout to a host

- One reinstall commit. A session that was running before it keeps its old agent definitions, so every orchestrator session restarts, or re-reads its definition at its next item boundary.
- An item whose review was recorded before the reinstall keeps that review. Its next review follows the new rules.
- A host runs `/specsmd-inferno-standards` once and approves the draft before its first intent on the new flow. Without the folder the flow runs as before, with no rule files to judge against.
- An intent planned before the reinstall builds from its old items. The plan lint and the cross-check apply to plans written after it.
- A host that runs its own second review per item decides whether the quality lens replaces it.
- A host sets `models.oracle_hard` only when its account has that tier. Without it every ask takes the normal route.
- A host whose tests run on another machine through a wrapper names that wrapper under `mutate.session`, so a batch of mutants shares one sync and one slot.
- A host that seals definition files names them and their reseal command under `mutate.sealed`.

The app repo on 2026-11-10: 0.1.81 is installed and five intents are running on it. A compatibility run against its live ledgers and configs read them all, and found the state changes additive. The install itself is refused: the flow's text is over the host's word ceiling in five roles, and seven host tests that pin the flow go red (`inferno-0.1.82-host-install-handoff.md`, sections 1 and 2). The host works around it by raising its ceilings to the measured sizes until the flow's text is trimmed, and by moving its own pins in the install commit. The reinstall landed on 2026-11-10 as one commit, and the flow took over for every session at once when the primary checkout was moved forward to it, because every orchestrator runs the scripts from there. A session that started before it re-reads its definition at its next item boundary.

## 3. How we know it worked

Run the readout on the first host intent of ten or more items built after the reinstall:

```bash
node evals/review-loop/stats.cjs --tree <intent worktree> --base <ref> --intent <id> [--head <ref>]
```

Pass `--intent`. A branch that folded the base carries the review files of every intent that shipped meanwhile, and without the flag their items count in the totals.

The readout was rehearsed on the app repo on 2026-11-10, on the old flow, and it reads host data as it stands. Two more old numbers came out of it. The intent of the first table, still running, stood at 4.2 rounds per item over 26 items, 12.2 mutants per acceptance criterion and 59 ownership grants. A second intent of 4 items, built the same day on the old flow by an orchestrator that told its reviewers to confirm a verbatim pin by reading it and to cap their mutants, stood at 2.3 rounds per item, 5.7 mutants per criterion and 4 grants. That second intent is the plan's review chain done by hand, so it is the nearest thing to a forecast.

The old numbers come from one intent of 28 items on the app repo, built by 0.1.81. 18 of its items had a recorded review. They were read from the history of that intent's review files between base `2181a171c` and branch commit `a9af3d0ca`.

| Measure | Before | Target |
| --- | --- | --- |
| Review rounds per item | 3.9 (70 over 18 items) | 2.5 or lower |
| Highest round count of one item | 8 | 4 at most, by construction |
| Mutants per acceptance criterion | 12.4 (1201 over 97 criteria) | 1.5 or lower |
| Fix rounds that are serious only through a surviving mutant | 18 of 45 | under one in five |
| Reviewer tokens per item, both lenses together | 513M cache-read tokens over the session, context per round median 174k | at least a third lower |
| Oracle asks on the hard route | none, it needed the user | under one in five |
| Whole-plan check rounds per intent | 5 and 6 | 3 at most: one pass and two fix rounds |
| Ownership grants per intent | 35 | under 10 |
| Findings of the quality lens per item | none, it did not exist | reported, with their severity |
| Intent review findings of blocker or major weight | measure on the same intent | no rise per item |
| Gate reds per intent | measure on the same intent | no rise |

The last two rows are the quality check. If either rises, the package that caused it is reverted before the next intent starts.

How the numbers are read:

- A round is one recorded version of an item review file. `tree`, `commit` and `reviewer` lines are ignored when two versions are compared, and two recordings with the same content count once.
- A fix round is minor-only when every finding is `minor` and no mutant reads `caught: no`. That is `weightOf` in `S/run-review-file.cjs`.
- A fix round is serious only through a survivor when it has no blocker or major finding whose evidence is something other than a surviving mutant.
- A mutant names a numbered criterion when its `criterion` starts with a number. Everything else is free text.
- Tokens are summed once per API message id. Context per round is input plus cache-read plus cache-creation tokens of that message.

### Items built wholly on 0.1.82, counted by hand

Until the readout reads both lenses and counts a mutant once (section 4 of `inferno-0.1.82-run-defects-handoff.md`), each item whose builder and reviewers were all dispatched after the reinstall gets one row here. The full readout follows on the first intent of ten or more such items.

| Item, on the app repo | Rounds, both lenses | Round 1 findings | Mutants per criterion | Grants | Build commit to clean review |
| --- | --- | --- | --- | --- | --- |
| `a14-the-store-holds-a-vulnerability-the-maker-found`, 2026-11-10, review records `d650ef038` and `3ff216c44` | 2 | contract: 1 blocker, 1 minor. quality: 1 major, 2 minor | 1.0 (6 proposals, 6 criteria), none run at the item, all owed to the intent review | 1 | 21 minutes |
| `doc-each-stated-law-prints-its-notified-body-in-point-7`, 2026-11-10, review records `2f938490c` and `208302195` | 2 | contract: 1 blocker, 1 minor. quality: 4 minor | 0.9 (15 proposals and 2 pins, 17 criteria), none run at the item, all owed to the intent review | 3 | 33 minutes |

What the rows show. Both items closed in 2 rounds, with the same two reviewers back for round 2. Neither ran a mutant at the item, so the whole mutant load of these intents lands at the intent review (section 3 of the handoff). On the first row the quality lens found a major finding of its own in round 1. The readout printed "12 in 2 rounds" for its 6 proposals and "30 in 2 rounds" for the 15 of the second row, which is the double count of the handoff.

## 4. Findings from the first host

A session that meets a defect in the new flow works around it and adds one handoff file beside this one, named `inferno-<what>-handoff.md`: what is wrong, the evidence and how to fix it. Nothing is built on the host's account. This section lists those files, newest last, with the date and one line each.

- 2026-11-10, `inferno-0.1.82-host-install-handoff.md`. Found before the install, by a compatibility run. The flow's text is over the host's word ceiling in five roles, which blocks the install. Seven host tests that pin the flow go red, three of them on rules the host asked the flow to carry. The flow's YAML reader turns a list item with a trailing comment into a map. The install eval installs the ideation flow. Two flow test files read files that only the source repository holds, so they fail in every host.

- 2026-11-10, `inferno-0.1.82-run-defects-handoff.md`. From real work, in the first hour on the new flow. An item that owns a file under `.specs-inferno/` can never be reviewed, because the proof leaves those paths out and the check that reads it counts them. Output over 64 KiB is cut when `run.cjs` writes to a pipe, which loses the line that names the next step. No mutant runs at an item that has a quality review, because the mutant step allows one uncommitted review file and such an item has two, so every proposal waits for the intent review. The readout does not read the quality lens and counts a carried mutant again in every round, so two rows of the measure in section 3 cannot be read from it yet. A proposal that never ran and whose code a correction moved to another file locks a clean intent review: the runner refuses the record for the missing mutant, and refuses the reviewer's own mutant for that criterion because the dead one is still held as owed. A finding the user has put after the release cannot be recorded as such: an item can leave on the user's word and a finding cannot, so the orchestrator takes those findings out of the review by hand. Later defects are added to that file.

## 5. Not built, and why

- **A worktree per item.** Turbo has it, and it removes a whole class of waits between siblings. On a host with a compile tree per worktree it costs gigabytes and cold builds. The flow fixes on this branch remove those waits inside the shared worktree instead.
- **Fresh fix builders.** Turbo dispatches every fix fresh. INFERNO resumes the warm builder, whose thread reached 467k tokens. Measure it with the readout before changing it.
- **The orchestrator's own thread.** 390M tokens at about 267k of context per round was the third largest cost. It has no design yet.
- **The rest of Turbo's inception.** The questions to the user and the one human approval, the record that a script renders into specs, the drawn Code Scaffold, the overview page and the Confluence and Jira sync. They serve a team that signs off a plan. INFERNO plans without a person.
