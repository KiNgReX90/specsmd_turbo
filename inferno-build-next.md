# INFERNO: what to build next

Written 2026-11-12. This is the one list of everything open on this branch. Every line has a verdict: BUILD NOW, DONE or NOT NOW. A NOT NOW names its reason and what unlocks it. Nothing here is a plan for some later day: what says BUILD NOW can start today.

Build section 2 from top to bottom. Version 0.1.85 on this branch holds the six items of section 1b and the ten rows of section 1c. What is left to build is three lines: row 0l, which a host met on 2026-11-13, the numbers behind the thinner work items, and the release steps.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

## 1. DONE: the fourteen findings of the first host, built as 0.1.84

The first host handed off fourteen findings on 0.1.83. All fourteen are built on this branch as 0.1.84, and the first host installed it on 2026-11-12 with the shipped suite green there. Nothing of them is left to build. Their text is in this branch's history at `912c9feb`.

| Section | Finding | Built in |
| --- | --- | --- |
| 1 | A recorded review that lists a deleted file stops the item review | `3516f6ec` |
| 2 | A helper named `fit` reads as a switched-off test | `b793d5c4` |
| 3 | A ship without `ship_cleanup` says nothing | `9a1a900c` |
| 4 | A real-app test is first run by the final gate's lane | `60d6b62d`, `30a17de2` (`real_app.prove`) |
| 5 | A review file with a `>-` value is refused | `b751ae76` |
| 6 | A review that lists an owned ledger file is refused | `875dbbd2` |
| 7 | A granted file is left out of a correction's review | `875dbbd2`, `4284b202` |
| 8 | A late correction of a completed item cannot be verified | `7bdf52ff` |
| 9 | A sibling's write during a mutant batch throws the batch away | `0c54fb03` |
| 10 | A killed Rust build reads as "did not build", and a host cannot place mutant tests | `894dd5fe` (`mutate.run`) |
| 11 | A mutant whose test is a check can never read caught | `894dd5fe` (`mutate.checks`) |
| 12 | A line the base added in a fold reads as the item's own | `be93c4c4` |
| 13 | A grant takes a file another dispatch changed beside it | `7bdf52ff` |
| 14 | A product red with no `verdicts` key ends with no step | `075d2bc2` |

What is left for these is on the host: it sets the new keys it needs (`mutate.checks`, `real_app.prove`, `verification.<lane>.verdicts`) in its own time. `mutate.run`, `mutate.wrapped` and `verification.refused` it sets with its install of the build that holds section 1c.

## 1b. DONE: six items of the build list, built as 0.1.85

Built on this branch on 2026-11-12. `CHANGELOG.md` says what each one does. The first host installed it the same day with the shipped suite green there, and set `verification.session` and `mutate.session`.

| Was order | What | Built in |
| --- | --- | --- |
| 0 | A host says what counts as an already wrapped mutant test (`mutate.wrapped`) | `e3bb0844` |
| 1 | The install says that a running session keeps the old flow | `9bb841e5` |
| 2 | A work item names the functions it writes through, and `frontier` finds the callers it missed (`writes:`) | `1fb7906c` |
| 3 | The checks of one integrate take one slot together (`verification.session`) | `7ac83452` |
| 4 | The config step proposes the tools that fit the host, per role (`run.cjs tools`) | `5ab4fd5f` |
| 5 | A planner A/B eval, one command (`evals/planner-ab/`) | `cd3f5dfd` |

Still owed from item 5: one recorded run of both arms in the pull request text. Item 6 below reads that run.

## 1c. DONE: ten rows the first host met or measured, built into 0.1.85

Built on this branch on 2026-11-12 and 2026-11-13. Each is a section of `inferno-0.1.84-run-defects-handoff.md`, which says what went wrong on the host. The shipped suite is green for this build on the first host's test machine. Four other hosts on that machine run it since 2026-11-13, and the first host installs it once the work it has at a final gate has landed.

| Row | What | Handoff section | Built in |
| --- | --- | --- | --- |
| 0b | A mutant is checked against the criterion it names (`says`, and `moved` in the intent review) | 2 | `38a92dc1`, `1b6e50c7` |
| 0c | A proof that exists only after the merge has its own kind (`after_ship`) | 3 | `f93ce251` |
| 0d | A fold that touches nothing of the intent keeps its review (`review.outside: ["**"]`) | 4 | `760c3d67` |
| 0e | The frontier lets a later item need a file an earlier item creates | 5 | `f93ce251` |
| 0f | A mutate session serves the whole batch | 6 | `8ed26fcf` |
| 0g | A check the wrapper refused to run is no verdict (`verification.refused`, exit 5) | 7 | `2bb00704`, `0f12ff4b`, `f22031c8` |
| 0h | A dispatch over several completed items keeps their histories apart | 8 | `b1871434` |
| 0i | A gate mark reads through the host's wrapper | 9 | `ddf14505` |
| 0j | The archive is no change of a gate mark | 10 | `a58ae92d` |
| 0k | The evidence of an external criterion keeps the review that waits for it | 11 | `760c3d67`, test `f7fc058f` |

## 2. BUILD NOW, in this order

"Done when" is the proof the item is finished.

| Order | What | Specified in | Done when |
| --- | --- | --- | --- |
| 0l | **A caught mutant counts only while its line stands.** An item review's caught mutant whose line a correction removed still counts for its criterion, and the intent review is refused a fresh one. A pin is already held to the tree as it is. | `inferno-0.1.84-run-defects-handoff.md`, section 12 | A delta review prints one line for a carried caught mutant that can no longer be placed, the coverage owes that criterion, and the intent review's mutant for it is taken and run. A mutant whose line only moved counts as today. |
| 6 | **Thinner work items: the numbers.** The text change is built in `7c770d7c`: the planner keeps prose about the code out of a work item. What is owed is the proof that it may stay. | improvement 1 | It stays only on numbers: the eval of item 5, then one intent built both ways, show that the builder's cost (rounds, output tokens, wall time, red integrate steps per item) rises less than the planner's cost falls. If it does not, the text change is reverted and this line says so. |
| 7 | **The release steps on the combined tree.** `npm run validate:all`, `npm pack`, both install evals and the e2e smoke, on 0.1.85. | `dev_release_guide.md` | Each result is one line in the pull request text. |

Two notes for whoever builds:

- `verification.session` has a second half that is not flow work. A host's wrapper needs commands to open a session, run in it and close it. The first host's wrapper has them since 2026-11-12, proven on both its test machines, and the host set the key with its install of 0.1.85. Measured there on one machine: an integrate of three small checks went from 259 seconds to 54.
- Item 6 is the only one that can make things worse without anyone seeing it, because a builder that searches longer still finishes. That is why it stays behind a number.

## 3. DONE: strike it

**Improvement 6, bring the docs repo back onto the canonical scripts.** Canonical holds both module splits today (`S/run-integrate.cjs`, `S/run-probes.cjs`, `S/run-proofs.cjs` and `S/run-dispatch.cjs`, `S/run-processes.cjs`, `S/state-store.cjs`). The five hosts on the first host's machine were reinstalled from this branch on 2026-11-11 and 2026-11-12, each with a lock that matches every installed file, and none holds a tracked copy under `.codex/skills/` or a stray planner file. If a host exists that is not on that machine, run `node .specsmd/inferno/check-lock.cjs` there; a match closes it for that host too.

## 4. MEASURED, NOT NOW: P5

**P5, new scope is a new item.** The design: a requirement that appears in the review loop becomes a new item of the same intent, the original item closes on its own criteria, and a grant only ever answers an existing criterion. The rule was to build it when at least 30% of the findings of round 2 and later are beyond the contract.

The count, made read-only on the first host on 2026-11-13:

- What was read: every finding first written in round 2 or later of an item review, contract and quality, in the six intents the host shipped with reviews recorded since 2026-11-10. That is 59 items, 95 review files and 252 recorded rounds, built on 0.1.81 to 0.1.85. 60 findings.
- 28 are on an acceptance criterion or a step of the item's description. 17 are on the bar: the 10 of the quality review, and 7 that name a rule file, a constraint of the brief or a regression of the correction. 15 are beyond the contract.
- That is 25%. Four findings can be read either way, and it stays between 22% and 28% wherever they are placed.
- All 15 name a decision or an amendment written during the item's own loop. 10 are in one item that took six rounds and three decisions, 4 in one item whose amendment was committed 13 seconds after its first review, and 1 names a host decision. Those two items ran their rounds before 0.1.83 was installed. The other four intents hold 16 of the 60 findings and none beyond the contract.
- 13 of the 28 on a criterion are one item with two criteria that have no end, read over five rounds of ever narrower cases. P5 does not answer that.
- Grants in the same period: 13 grants and 2 withdrawals, all but one commit in one intent. 8 of the 13 went to the item that holds 10 of the 15 findings, two of them in the same commit as a decision. The other 5, by their subject lines, gave an item a test or a fixture of a neighbour that its change reached.

Verdict: not now. The count is under the threshold, and what it found is two items, both before 0.1.83. Unlocks: a count on intents built wholly on 0.1.85 that reads 30% or more. If it comes back, the count names the one moment a rule could act on: a decision file or an amendment written while an item is in its loop.

## 5. NOT NOW

**P8, the live test and the break test.** A live tester tries each intent on the running application, and a breaker attacks marked items from the outside. Reason: it adds wall time and tokens to every intent, and the first host has two test machines whose queue is its bottleneck this week. Unlocks: the owner's word, after the first host's release, and a host that names how its application starts and stops under `verification.live`.

**The merge of this pull request.** The branch carries real work on the first host from this branch, by the owner's choice. The merge is the owner's word and nothing here waits on it.
