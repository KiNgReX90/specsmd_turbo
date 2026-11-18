# INFERNO: what to build next

Written 2026-11-12. This is the one list of everything open on this branch. Every line has a verdict: BUILD NOW, DONE, MEASURED ON THE HOST or NOT NOW. A NOT NOW names its reason and what unlocks it. Nothing here is a plan for some later day: what says BUILD NOW can start today.

What waits for a builder is in section 2. Version 0.1.85 holds the six items of section 1b, the rows of sections 1c, 1d, 1e and 1g and the nine sections of section 1f, and the release steps ran on the tree that holds them all. A host's next finding arrives as a new row in section 2. The thinner work items are measured on the first host and are no work for the builder (section 4).

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

Where the older text went, so that nothing built reads as open:

- `inferno-future-improvements.md` is gone from this branch. Of its eight items six are built or struck (sections 1b and 3). The measurement of the first is section 4, its one standing rule is under section 2, and the one idea left unbuilt is in section 5. Its text is in this branch's history at `d5d82fa1`.
- The handoff file `inferno-0.1.84-run-defects-handoff.md` holds only the sections still to build: 24, 25 and 26, rows 0y, 0z and 0aa. Its sections 1 to 11 are in history at the same commit, 12 to 14 at `120be9b4`, and 15 to 23 at `1aa836a2`.
- Every other handoff file keeps only its open defects, or, once all it holds is built, says so in its first line, with the commit and its row or section here, and that it can be removed from the branch, its text staying in history. Seven are marked built: `inferno-remote-run-wrapped-in-local-seat-handoff.md` (row 0o), `inferno-rename-proof-stale-handoff.md` (section 1f) and the five files of rows 0p to 0t (section 1g). Defects 3 and 5 of `inferno-review-record-defects-handoff.md` are cut from it, and their text is in history at `1aa836a2`.
- `inferno-generalization-plan.md` and `todo.md` are older backlogs that came from main. They ask nothing of whoever builds here, and what they hold is no commitment.

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

No run of the eval is owed. It stays as the tool for a planner text change that needs both arms side by side. The thinner work items are measured on the first host's own intents (section 4).

`verification.session` has a second half on the host: its wrapper needs commands to open a session, run in it and close it. The first host's wrapper has them since 2026-11-12. Measured there on one machine: an integrate of three small checks went from 259 seconds to 54.

## 1c. DONE: ten rows the first host met or measured, built into 0.1.85

Built on this branch on 2026-11-12 and 2026-11-13. Each was a section of the handoff file, which said what went wrong on the host; the column names the section as it stood at `d5d82fa1`. The build at `f3be640a`, which holds sections 1c and 1d, runs on the four other hosts of the first host's machine since 2026-11-13, and on the first host since 2026-11-14, with the shipped suite green on its test machine.

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

## 1d. DONE: three rows the first host met on 2026-11-13, built into 0.1.85

Built on this branch on 2026-11-13. `CHANGELOG.md` says what each one does. The handoff column names the section as it stood at `120be9b4`.

| Row | What | Handoff section | Built in |
| --- | --- | --- | --- |
| 0l | A caught mutant counts only while its line stands | 12 | `771be02a`, `65b9550e` |
| 0m | An item's own check goes where the host's tests go (`verification.run`, `verification.wrapped`) | 13 | `0461e9c6`, `6659c35e` |
| 0n | An accepted instrument red holds through the fold of its fix | 14 | `e9aa44fc`, `7108c32b` |

The release steps (row 7) ran on `f3be640a`, the tree that holds all three: each result is one line in the pull request text. The e2e smoke runs again on the flow as it is (`43fae93a`).

## 1e. DONE: one row the first host met on 2026-11-17

Built on this branch on 2026-11-17. `CHANGELOG.md` says what it does.

| Row | What | Handoff | Built in |
| --- | --- | --- | --- |
| 0o | A test the host's wrapper carries takes no seat on this machine's build wrapper | `inferno-remote-run-wrapped-in-local-seat-handoff.md`, marked built | `e659ab4a` |

That handoff file names one case it leaves as it is: an integrate or gate command a host writes out with its wrapper, with no `verification.session` whose match reaches it, still takes a local seat, since no config key says such a command is carried.

## 1f. DONE: nine sections of the handoff file, built into 0.1.85

The first host met them on 2026-11-14 and 2026-11-15, and they had no row. Built on this branch on 2026-11-16. `CHANGELOG.md` says what each one does: `a6ef039d` wrote the entries of eight and the config wizard's texts, and `f4c9caec` the entry of section 18 and the planner's texts. The handoff column names the section as it stood at `1aa836a2`.

| Handoff section | What | Built in |
| --- | --- | --- |
| 15 | An item that moves a file with `git mv` gets a current proof | `1248629b` |
| 16 | A rule file under `.specs-inferno/standards/` is product, not ledger | `c1a015a7` |
| 17 | A command that reads the merge base keeps its green only at that base (`verification.base_scoped`) | `b42cc6bb`, `4e8a9a73` |
| 18 | A criterion an integrate command proves takes a gate mark | `74f220ad` |
| 19 | A gate mark on a completed item is held to the config | `1b779637` |
| 20 | A mutant whose test is a plain check reads a verdict (`check: true` in its entry) | `96c75c27`, `8a2d47df` |
| 21 | The `Tester proves:` line names case ids only, and `gate --detach` checks the cases before it starts a lane | `13327fde`, `bc4154bf` |
| 22 | A local base that lags its origin no longer makes synced files the intent's own | `4e6d1ab0` |
| 23 | A refusal is read only from a run's last line, and on the host's refusal exit (`verification.refused_exit`) | `e4c9a93c` |

A host may set two new keys: `verification.base_scoped` lists the commands whose verdict reads the merge base, and `verification.refused_exit` names the exit its wrapper refuses with, beside `verification.refused`. A host with `verification.refused` and no `verification.refused_exit` sees one change: a matching line that is not the last one of the run is a FAIL. The release steps (row 7) ran on `32ef7f9b`, the tree that holds all nine.

Three defects of handoff files that had no row are the same as two of these sections, and the same commits built them. The triage of 2026-11-18 read each in the code:

| Handoff | Defect | Built in |
| --- | --- | --- |
| `inferno-rename-proof-stale-handoff.md`, marked built | A proof over an item that renames a file is stale the moment it is written: section 15 | `1248629b` |
| `inferno-review-record-defects-handoff.md`, defect 3 | verify-item's proof omits a committed rename's source: section 15 | `1248629b` |
| `inferno-review-record-defects-handoff.md`, defect 5 | A reviewer does not know a check criterion can take a mutant: section 20, whose `check: true` the reviewer's texts and the runner's hint name, in place of the inline test wrapper the handoff asked for | `96c75c27` |

## 1g. DONE: five rows the first host met on 2026-11-17 and 2026-11-18

Built on this branch on 2026-11-18. `CHANGELOG.md` says what each one does.

| Row | What | Handoff | Built in |
| --- | --- | --- | --- |
| 0p | The test of a first write reads its lower bound from the clock the file is stamped with | `inferno-first-write-clock-lag-handoff.md`, marked built | `7b3df6ef` |
| 0q | The test of a refused grant compares the record, never the stat index | `inferno-grant-test-stat-index-age-handoff.md`, marked built | `7b3df6ef` |
| 0r | A gate run again after a red command on unchanged code records its cause, and ship keeps the red log | `inferno-regate-cause-not-recorded-handoff.md`, marked built | `7fdf4b8b`, `a0eb164b`, `f6ad13a7` |
| 0s | A mutant test whose command is missing reads that as its reason, and the batch runs it once | `inferno-mutant-command-not-found-handoff.md`, marked built | `17490143`, `d3c0ee95` |
| 0t | The real cargo test runs without the host's rustc wrapper, so it never starts the machine's sccache server | `inferno-cargo-test-takes-sccache-server-handoff.md`, marked built | `93b7f0a3` |

What a host may now use, from row 0r: a gate run again on the code a finalize command was red on takes `run.cjs gate --detach --cause "<why>" --by <who>`. The cause is bound to the proof the rerun's green minted, so a commit outside a scoped command's scope keeps it and one inside it drops it. Ship writes that cause into the merge commit as one `exception: <command> rerun <json>` line, under the same limit as a lane accept: two of a command on the base refuse the next, until a commit carries `Fixes-intermittent: <command>`. The red log is kept under `<cache>/rerun-evidence/`, which no branch cleanup owns, and ship removes the record once the merge commit that carries its line is written. The orchestrator's texts say when to use the call.

Row 0s: an entry that says `check: true` still reads caught under exit 126 or 127, since its check was green on the tree as it is. Row 0t: the test sets one key, an empty `RUSTC_WRAPPER`, not the two the handoff named. Measured on cargo 1.94.1, an empty `RUSTC_WRAPPER` beats a wrapper named in a config and one named by `CARGO_BUILD_RUSTC_WRAPPER`, so the second key never decides.

The release steps (row 7) ran on `28f9e200`, the tree that holds all five.

## 2. BUILD NOW: nine rows

A host's next finding arrives here as a row, with its section in the handoff file. Rows 0u to 0aa are the open defects of two handoff files and three sections that had no row; the triage of 2026-11-18 read each in the code and found it open. Row 0ab is the first host's finding of 2026-11-18 on row 0r as built, read in the code at `35f12380` before its install. Row 0ac is a defect the first host met in a run on 2026-11-18, on the build at `f3be640a`, read in the code at `f0f06aaf` and found unchanged there.

| Row | What | Handoff |
| --- | --- | --- |
| 0u | A test file an item moves keeps the switch-off it already had, and verify-item reads it against the move's source | `inferno-moved-test-switch-off-handoff.md` |
| 0v | A path the range deleted goes under `gone` and never under `paths`, in a first review and a delta, in both lenses | `inferno-review-record-defects-handoff.md`, defect 1 |
| 0w | The record stamps the commit its review read, not HEAD, so a correction committed before the record still owes a review | `inferno-review-record-defects-handoff.md`, defect 2 |
| 0x | A record that owes mutants runs detached, or the orchestrator's text says to run it in the background | `inferno-review-record-defects-handoff.md`, defect 4 |
| 0y | A count probe that prints what `shows` says and exits 1 is no drift, or plan-lint names it | `inferno-0.1.84-run-defects-handoff.md`, section 24 |
| 0z | A sibling's commit to a file two items own gives a fresh proof and an owed review, never `DISPATCH_PROOF` | `inferno-0.1.84-run-defects-handoff.md`, section 25 |
| 0aa | A delta reviewer whose verdict holds writes its file again, or the record accepts an unchanged clean file | `inferno-0.1.84-run-defects-handoff.md`, section 26 |
| 0ab | A rerun's cause is counted and written under its command's name, the rest after `verification.session.match`, never the wrapped command with a tree path in it | `inferno-rerun-cap-keyed-on-wrapped-command-handoff.md` |
| 0ac | A fold is read from what HEAD merged, so a base rewritten after the fold no longer turns the files it brought in into changes outside the item's ownership | `inferno-fold-read-from-moved-base-handoff.md` |

One standing rule: a change to one host's planner text is measured on the other host before it is ported, with `evals/planner-ab`. "Read a subsystem per round" cut one host's planning by about a fifth and made the other about half again more expensive.

## 3. DONE: strike it

**The docs repo is back on the canonical scripts.** Canonical holds both module splits today (`S/run-integrate.cjs`, `S/run-probes.cjs`, `S/run-proofs.cjs` and `S/run-dispatch.cjs`, `S/run-processes.cjs`, `S/state-store.cjs`). The five hosts on the first host's machine were reinstalled from this branch on 2026-11-11 and 2026-11-12, each with a lock that matches every installed file, and none holds a tracked copy under `.codex/skills/` or a stray planner file. If a host exists that is not on that machine, run `node .specsmd/inferno/check-lock.cjs` there; a match closes it for that host too.

## 4. MEASURED ON THE HOST: nothing here is for the builder

Both lines are read from the first host's own intents by the session that monitors that host. Neither asks the builder for anything. A result that asks for a change arrives as a new row in section 2.

**Thinner work items: do they stay.** The text change is built in `7c770d7c`: the planner keeps prose about the code out of a work item. It can make things worse without anyone seeing it, because a builder that searches longer still finishes, so it stays behind a number.

- What is read: the review-loop readout (`evals/review-loop/stats.cjs`) of the first intents the first host plans after it installs the build that holds `7c770d7c`, until they hold ten items together. No intent is built twice and no eval run is paid for.
- Against what: the same readout of the host's intents planned before that install.
- The rule: the text change stays, unless the review rounds per item or the builder's output tokens per item read more than a quarter above the intents before. Then a row to revert `7c770d7c` goes on top of section 2.
- When: the first host installed that build on 2026-11-14, and every intent it ran until then was planned before. The first reading comes with the first intent it plans after that install.

**P5, new scope is a new item: measured, not now.** The design: a requirement that appears in the review loop becomes a new item of the same intent, the original item closes on its own criteria, and a grant only ever answers an existing criterion. The rule was to build it when at least 30% of the findings of round 2 and later are beyond the contract.

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

**The commands of one integrate run beside each other.** One slot for the whole integrate is built (`verification.session`), and it took the queue and the sync out of every command but the first. Running the commands beside each other helps only while a host has machines free. Unlocks: a host whose integrate is still slow with an empty queue.

**The merge of this pull request.** The branch carries real work on the first host from this branch, by the owner's choice. The merge is the owner's word and nothing here waits on it.
