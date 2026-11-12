# INFERNO: what to build next

Written 2026-11-12. This is the one list of everything open on this branch. Every line has a verdict: BUILD NOW, DONE, MEASURE FIRST or NOT NOW. A NOT NOW names its reason and what unlocks it. Nothing here is a plan for some later day: what says BUILD NOW can start today.

Build section 2 from top to bottom. Version 0.1.85 on this branch holds the six items of section 1b. Rows 0b to 0e came in after those were built: they go into 0.1.85 if its release steps have not run yet, and into the next release otherwise.

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

What is left for these is on the host: it sets the new keys it needs (`mutate.checks`, `real_app.prove`, `verification.<lane>.verdicts`) in its own time. `mutate.run` it sets together with `mutate.wrapped` once it installs 0.1.85.

## 1b. DONE: six items of the build list, built as 0.1.85

Built on this branch on 2026-11-12. `CHANGELOG.md` says what each one does.

| Was order | What | Built in |
| --- | --- | --- |
| 0 | A host says what counts as an already wrapped mutant test (`mutate.wrapped`) | `e3bb0844` |
| 1 | The install says that a running session keeps the old flow | `9bb841e5` |
| 2 | A work item names the functions it writes through, and `frontier` finds the callers it missed (`writes:`) | `1fb7906c` |
| 3 | The checks of one integrate take one slot together (`verification.session`) | `7ac83452` |
| 4 | The config step proposes the tools that fit the host, per role (`run.cjs tools`) | `5ab4fd5f` |
| 5 | A planner A/B eval, one command (`evals/planner-ab/`) | `cd3f5dfd` |

Still owed from item 5: one recorded run of both arms in the pull request text. Item 6 below reads that run.

## 2. BUILD NOW, in this order

"Done when" is the proof the item is finished.

| Order | What | Specified in | Done when |
| --- | --- | --- | --- |
| 0b | **A mutant is checked against the criterion it names.** A reviewer that numbers its mutants in the order it wrote them credits them to the wrong criteria, and the runner takes the numbers as written. The dispatch prints the numbered criteria, each entry repeats the criterion's opening words, and the intent review can move a recorded one. | `inferno-0.1.84-run-defects-handoff.md`, section 2 | A review numbered in order past a skipped criterion is refused and the message names the right number. A review whose numbers and words agree records as today. After a move the criterion left behind takes a proposal in the intent review. |
| 0c | **A proof that exists only after the merge has its own kind.** An external criterion with no evidence file stops the ship, also when only the ship makes the proof possible, such as a timer that runs from the default branch. A fourth proof, `after_ship`, is listed as owed by the ship and marked in the brief at plan time. | `inferno-0.1.84-run-defects-handoff.md`, section 3 | A review with one `after_ship` entry and no file is green and the ship prints the owed line. The same entry spelled `external` is refused as today. An `after_ship` entry for a criterion the brief does not mark is refused. |
| 0d | **A fold that touches nothing of the intent keeps its review.** Any folded file voids the intent review today, and the reviewer is handed the whole base delta. `review.outside: ["**"]` already binds the review to the files the intent changed; say so, test it, and let the delta dispatch name the files a fold did touch. | `inferno-0.1.84-run-defects-handoff.md`, section 4 | With the key, a fold of a file the intent never touched leaves the review current and the gate does not owe it. A fold that changes a file the intent changed owes the review and the dispatch names that file. |
| 0e | **The frontier lets a later item need a file an earlier item creates.** The existence check of `context.required` and `reads` skips a path that an item this one depends on owns and has not completed yet, and plan-lint makes the same check. | `inferno-0.1.84-run-defects-handoff.md`, section 5 | A plan whose second item requires a file its first item owns gives a frontier of the first item. The same plan without the `depends_on` is refused. After the first item completes without creating the file, the frontier refuses the second. |
| 6 | **Thinner work items.** The planner stops writing prose that explains what the code does and keeps what a builder cannot get alone. | improvement 1 | It is adopted only on numbers: the eval of item 5, then one intent built both ways, show that the builder's cost (rounds, output tokens, wall time, red integrate steps per item) rises less than the planner's cost falls. If it does not, the text change is reverted and this line says so. |
| 7 | **The release steps on the combined tree.** `npm run validate:all`, `npm pack`, both install evals and the e2e smoke, on 0.1.85. | `dev_release_guide.md` | Each result is one line in the pull request text. |

Two notes for whoever builds:

- `verification.session` has a second half that is not flow work. A host's wrapper needs commands to open a session, run in it and close it. The first host adds them to its own wrapper and sets the key.
- Item 6 is the only one that can make things worse without anyone seeing it, because a builder that searches longer still finishes. That is why it stays behind a number.

## 3. DONE: strike it

**Improvement 6, bring the docs repo back onto the canonical scripts.** Canonical holds both module splits today (`S/run-integrate.cjs`, `S/run-probes.cjs`, `S/run-proofs.cjs` and `S/run-dispatch.cjs`, `S/run-processes.cjs`, `S/state-store.cjs`). The five hosts on the first host's machine were reinstalled from this branch on 2026-11-11 and 2026-11-12, each with a lock that matches every installed file, and none holds a tracked copy under `.codex/skills/` or a stray planner file. If a host exists that is not on that machine, run `node .specsmd/inferno/check-lock.cjs` there; a match closes it for that host too.

## 4. MEASURE FIRST: one read-only count decides

**P5, new scope is a new item.** The design: a requirement that appears in the review loop becomes a new item of the same intent, the original item closes on its own criteria, and a grant only ever answers an existing criterion.

- The count: classify the findings of round 2 and later on the first host as "on an acceptance criterion", "on the bar" or "beyond the contract", and record what asked for each ownership grant. It reads review files and changes nothing.
- Build it when at least 30% of those findings are beyond the contract. Below that the design costs more than it saves.
- Who: the count needs the first host's review files, so the session that monitors that host makes it and writes the number here.

## 5. NOT NOW

**P8, the live test and the break test.** A live tester tries each intent on the running application, and a breaker attacks marked items from the outside. Reason: it adds wall time and tokens to every intent, and the first host has two test machines whose queue is its bottleneck this week. Unlocks: the owner's word, after the first host's release, and a host that names how its application starts and stops under `verification.live`.

**The merge of this pull request.** The branch carries real work on the first host from this branch, by the owner's choice. The merge is the owner's word and nothing here waits on it.
