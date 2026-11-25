# INFERNO: what to build next

Written 2026-11-12. This is the one list of everything open on this branch. Every line has a verdict: BUILD NOW, DONE, MEASURED ON THE HOST or NOT NOW. A NOT NOW names its reason and what unlocks it. Nothing here is a plan for some later day: what says BUILD NOW can start today.

Thirty-three rows wait for a builder, rows 0ag to 0bm in section 2. Version 0.1.85 holds the six items of section 1b, the rows of sections 1c, 1d, 1e, 1g and 1h and the nine sections of section 1f, and the release steps ran on the tree that holds them all. A host's next finding arrives as a new row in section 2. The thinner work items are measured on the first host and are no work for the builder (section 4).

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

Where the older text went, so that nothing built reads as open:

- `inferno-future-improvements.md` is gone from this branch. Of its eight items six are built or struck (sections 1b and 3). The measurement of the first is section 4, its one standing rule is under section 2, and the one idea left unbuilt is in section 5. Its text is in this branch's history at `d5d82fa1`.
- The handoff file `inferno-0.1.84-run-defects-handoff.md` holds only the sections still to build, and none is open today. Its sections 1 to 11 are in history at the same commit, 12 to 14 at `120be9b4`, 15 to 23 at `1aa836a2`, and 24 to 26 at `f0f06aaf`.
- Every other handoff file keeps only its open defects. Once all it holds is built, it leaves the branch, and its row or section here names it with the commit that holds its text. Fourteen are gone this way, and thirty-three stand today, those of rows 0ag to 0bm: `inferno-remote-run-wrapped-in-local-seat-handoff.md` (row 0o), `inferno-rename-proof-stale-handoff.md` (section 1f), the five files of rows 0p to 0t (section 1g) and the seven files of rows 0u to 0x and 0ab to 0af (section 1h). The text of the first ten is in history at `f0f06aaf`, that of the next two at `ba8a86c2` and that of the last two at `f1c2c772`, as it last stood, and the first seven each have a first line there that says they are built. Defects 3 and 5 of `inferno-review-record-defects-handoff.md` were cut from it before, and their text is in history at `1aa836a2`.
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
| 0o | A test the host's wrapper carries takes no seat on this machine's build wrapper | `inferno-remote-run-wrapped-in-local-seat-handoff.md`, gone, in history at `f0f06aaf` | `e659ab4a` |

That handoff named one case it left as it is: an integrate or gate command a host writes out with its wrapper, with no `verification.session` whose match reaches it, still takes a local seat, since no config key says such a command is carried.

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
| `inferno-rename-proof-stale-handoff.md`, gone, in history at `f0f06aaf` | A proof over an item that renames a file is stale the moment it is written: section 15 | `1248629b` |
| `inferno-review-record-defects-handoff.md`, defect 3, gone, in history at `1aa836a2` | verify-item's proof omits a committed rename's source: section 15 | `1248629b` |
| `inferno-review-record-defects-handoff.md`, defect 5, gone, in history at `1aa836a2` | A reviewer does not know a check criterion can take a mutant: section 20, whose `check: true` the reviewer's texts and the runner's hint name, in place of the inline test wrapper the handoff asked for | `96c75c27` |

## 1g. DONE: five rows the first host met on 2026-11-17 and 2026-11-18

Built on this branch on 2026-11-18. `CHANGELOG.md` says what each one does.

| Row | What | Handoff | Built in |
| --- | --- | --- | --- |
| 0p | The test of a first write reads its lower bound from the clock the file is stamped with | `inferno-first-write-clock-lag-handoff.md`, gone, in history at `f0f06aaf` | `7b3df6ef` |
| 0q | The test of a refused grant compares the record, never the stat index | `inferno-grant-test-stat-index-age-handoff.md`, gone, in history at `f0f06aaf` | `7b3df6ef` |
| 0r | A gate run again after a red command on unchanged code records its cause, and ship keeps the red log | `inferno-regate-cause-not-recorded-handoff.md`, gone, in history at `f0f06aaf` | `7fdf4b8b`, `a0eb164b`, `f6ad13a7` |
| 0s | A mutant test whose command is missing reads that as its reason, and the batch runs it once | `inferno-mutant-command-not-found-handoff.md`, gone, in history at `f0f06aaf` | `17490143`, `d3c0ee95` |
| 0t | The real cargo test runs without the host's rustc wrapper, so it never starts the machine's sccache server | `inferno-cargo-test-takes-sccache-server-handoff.md`, gone, in history at `f0f06aaf` | `93b7f0a3` |

What a host may now use, from row 0r: a gate run again on the code a finalize command was red on takes `run.cjs gate --detach --cause "<why>" --by <who>`. The cause is bound to the proof the rerun's green minted, so a commit outside a scoped command's scope keeps it and one inside it drops it. Ship writes that cause into the merge commit as one `exception: <command> rerun <json>` line, under the same limit as a lane accept: two of a command on the base refuse the next, until a commit carries `Fixes-intermittent: <command>`. The red log is kept under `<cache>/rerun-evidence/`, which no branch cleanup owns, and ship removes the record once the merge commit that carries its line is written. The orchestrator's texts say when to use the call.

Row 0s: an entry that says `check: true` still reads caught under exit 126 or 127, since its check was green on the tree as it is. Row 0t: the test sets one key, an empty `RUSTC_WRAPPER`, not the two the handoff named. Measured on cargo 1.94.1, an empty `RUSTC_WRAPPER` beats a wrapper named in a config and one named by `CARGO_BUILD_RUSTC_WRAPPER`, so the second key never decides.

The release steps (row 7) ran on `28f9e200`, the tree that holds all five.

## 1h. DONE: twelve rows the first host met on 2026-11-16 and 2026-11-18

Built on this branch, all twelve: on 2026-11-18 rows 0u to 0ab first, then rows 0ac and 0ad, two defects the first host met in runs that day on the build at `f3be640a`, and on 2026-11-19 rows 0ae and 0af, one it met in a run on 2026-11-18 on that build and one in its release gate the same day on the build at `fa5eea22`. `CHANGELOG.md` says what each one does.

| Row | What | Handoff | Built in |
| --- | --- | --- | --- |
| 0u | A test file an item moves keeps the switch-off it already had: verify-item reads it against the move's source | `inferno-moved-test-switch-off-handoff.md`, gone, in history at `f0f06aaf` | `7983ecbd` |
| 0v | A path the range deleted goes under `gone` and never under `paths`, in a first review and a delta, in both lenses | `inferno-review-record-defects-handoff.md`, defect 1, gone, in history at `f0f06aaf` | `480495b4` |
| 0w | The record stamps the commit its review read, not HEAD, so a correction committed before the record owes the delta that reads it | `inferno-review-record-defects-handoff.md`, defect 2, gone, in history at `f0f06aaf` | `b26b876e`, `1e5d06bb` |
| 0x | A record runs as its own process with `review ... --detach`, and `review ... --wait` blocks on it, as the gate's pair does | `inferno-review-record-defects-handoff.md`, defect 4, gone, in history at `f0f06aaf` | `81d5d674` |
| 0y | A probe is judged by what it printed, so a count that prints what `shows` says and exits 1 is no drift | `inferno-0.1.84-run-defects-handoff.md`, section 24, in history at `f0f06aaf` | `74dde5c9` |
| 0z | A sibling's commit to a file two items own, named in its `Item:` trailer, gives a fresh proof and an owed review, never `DISPATCH_PROOF` | `inferno-0.1.84-run-defects-handoff.md`, section 25, in history at `f0f06aaf` | `f5a2d440`, `a4f22d5d` |
| 0aa | A delta whose earlier verdict holds writes the range it read into its file, so the record takes it | `inferno-0.1.84-run-defects-handoff.md`, section 26, in history at `f0f06aaf` | `b26b876e`, `1e5d06bb` |
| 0ab | A rerun's cause is counted and written under its command's name: the rest after `verification.session.match`, else the command with the gate tree's path as `{tree}` | `inferno-rerun-cap-keyed-on-wrapped-command-handoff.md`, gone, in history at `f0f06aaf` | `771b05f0`, `a5e99826` |
| 0ac | A fold is read from what the run branch merged, so a base rewritten after the fold no longer turns the files it brought in into changes outside the item's ownership | `inferno-fold-read-from-moved-base-handoff.md`, gone, in history at `ba8a86c2` | `013d7663` |
| 0ad | The existence check of `context.required` and `reads` holds an item only until a builder took it, so a built item that deleted a file it had to read no longer stops the frontier | `inferno-frontier-stops-on-built-items-deleted-read-handoff.md`, gone, in history at `ba8a86c2` | `f05ba070`, `a4e5fa87` |
| 0ae | `dispatch-log` refuses a dispatch whose frozen ownership overlaps an open one of another item and names each item it took in, and the overlap refusal of `verify-item` prints the calls that clear it: one `dispatch-log` over both chains and its `accept-dispatch` | `inferno-overlap-refusal-names-no-call-handoff.md`, gone, in history at `f1c2c772` | `26f1735f` |
| 0af | A detached worktree keeps its gate, lane, owner and other run records in a folder named by the tree, so a gate in one detached tree no longer answers another's wait, retires its accept or refuses the accept it owes | `inferno-detached-trees-share-state-handoff.md`, gone, in history at `f1c2c772` | `4bcbb001` |

One more was found and built beside rows 0w and 0aa, with no row: an intent review dispatch printed again before its record no longer moves what the record binds, and a delta intent review whose earlier verdict holds can be recorded with its `read: <range>` line (`67e00841`, `07678051`). One more beside row 0af, with no row either: a rerun cause beside a proof was taken as this tree's when its `branch` matched, so one detached tree's green printed another's cause, and it is read from the tree's own folder now (`4bcbb001`).

Row 0ae's handoff saw two options beside its row that were no way on, and neither needs a line: `verify-item --since <ref>` compares against a ref instead of the item's dispatch, whose signed ownership holds its grants, so it lists a granted file as outside, and `--peers []` lets no other dispatch explain a change, so it lists the other chain's files as outside. Each does what its help line says, and no step of the flow calls either.

A host sets no new key. What a host may now use: `run.cjs review --item <id> --reviewer <agent-id> --detach` starts a record as its own process and `run.cjs review --item <id> --wait` blocks on it, and the intent review's record takes the same flags (row 0x). A delta's dispatch asks each lens for a `read: <range>` line, which a review file may hold (row 0aa). A rerun is counted under its command's name, so a commit with `Fixes-intermittent: <name>` lifts the limit (row 0ab). An item's commit carries one `Item: <id>` line per item it lands in its last paragraph, which lets a sibling's commit to a shared file pass (row 0z). The orchestrator's texts say to write it. What a host will see differently: an item a builder took is no longer held to the paths its `context.required` and `reads` name, while an item nobody took is checked as before, and an oracle ask in the dispatch log is no longer read as a builder having taken the item, as `defer-item` already reads it, so the diagnosis probe of an item that only had an oracle ask is replayed (row 0ad). A fold of a local base rebased or amended before its push keeps the files it brought in as the base's, as long as the base holds a commit of the same patch for each commit the run branch merged (row 0ac). Row 0ac leaves two cases as they are, each with its line in section 5. What a host will see differently from row 0ae: a `dispatch-log` whose frozen ownership overlaps an open dispatch of another item exits 2 where it exited 0, before it writes anything, naming that dispatch, its items and the shared path with the two ways on, its `accept-dispatch` or one `dispatch-log` over both as one chain. A dispatch left open, its builder halted or never accepted, refuses a later overlapping one too: its `accept-dispatch` closes it, with what it changed or `[]`, and a fresh `dispatch-log` of that record's own item retires it. A correction of the same item or chain is never refused, nor is the one dispatch that joins two chains. `dispatch-log` prints a `took in <item>` line after `logged` for each item it covered beyond the ones it was named for, and its payload has `taken_in`. From row 0af: a detached tree's records sit in `<cache>/.detached/<tree>-<hash>/`, the tree's folder name reduced to letters, digits, dot, underscore and hyphen, and 8 hex of the hash of its real path, and it takes its merge slot ticket under that name, while a tree on a branch keeps `<cache>/<branch>/` byte for byte. Records keep `branch` as written, `HEAD` for a detached tree. Records a detached tree wrote before the install stay in `<cache>/HEAD/` and nothing reads them, and a host tool that built `<cache>/HEAD/` by hand reads the `log` line a gate prints instead. A tree moved with `git worktree move` gets a new folder and finds nothing of its old one, and a tree that leaves its branch or checks one out changes folder with it, so a wait after a detach ends `NO_GATE_JOB` with the start call. `gate --wait` refuses a gate job of another tree (`GATE_OTHER_TREE`). Rows 0ae and 0af each leave one case as it is, with its line in section 5.

The release steps (row 7) ran on `1ddb0401`, the tree that holds the first eight, rows 0u to 0ab, again on `de204782`, the tree that holds the first ten, rows 0u to 0ad, and again on `814b3c28`, the tree that holds all twelve.

## 2. BUILD NOW: thirty-seven rows

A host's next finding arrives here as a row, with its section in the handoff file. Row 0ag is a defect the first host met on 2026-11-19 while moving a running intent from one machine to another, on the build at `f3be640a`, read in the code there and at `50721c90` and reproduced on both with the script in its handoff. Row 0ah is a defect the first host met on 2026-11-19 at an intent review on the build at `a8873ebb`, reproduced there and at `f3be640a` with the script in its handoff. Row 0ai is a defect the first host met on 2026-11-19 at an item integrate on the build at `a8873ebb`, reproduced there with the script in its handoff. Row 0aj is a defect the first host met on 2026-11-19 at an intent review on the build at `a8873ebb`, measured there on the item's own files and reproduced there with the script in its handoff. Row 0ak is a defect the first host met on 2026-11-20 in a builder on the build at `a8873ebb`, read in the builder's and the orchestrator's transcripts and measured over every subagent transcript on that machine with the script in its handoff. Row 0al is a defect the first host met on 2026-11-20 at an intent review on the build at `a8873ebb`, measured there on the intent's own specs, counted over every plan of that host and reproduced there with the script in its handoff. Row 0am is a defect the first host met from 2026-11-17 to 2026-11-19 in a run on the builds at `f3be640a` and `a8873ebb`, read in the orchestrator's transcript and reproduced on `a8873ebb` and the tip with the script in its handoff. Row 0an is a defect the first host met in the same run, measured with the flow's own readers over its plan and its archive and reproduced on `a8873ebb` and the tip with the script in its handoff. Row 0ao is a defect the first host met on 2026-11-19 at the ship of that run on the build at `a8873ebb`, reproduced there and at the tip with the script in its handoff. Row 0ap is a want the first host's oracle measured on 2026-11-20 over the transcript of that run and with a scratch preload on the runner at `a8873ebb`, while it designed a temporary capture of the flow that this row ends. Row 0aq is a want of the same oracle, counted on 2026-11-20 over the Agent and message calls of that run's transcript. Row 0ar is a defect the first host met on 2026-11-20 at the claim of its first release-line intent on the build at `a8873ebb`, read in the code there and reproduced there and at the tip with the script in its handoff. Row 0as is a want the first host's test-manager met on 2026-11-20 on the build at `a8873ebb` while building the host's fix for a cost measured in a shipped run, read in the code there. Row 0at is a defect the first host met on 2026-11-21 in an intent on the build at `a8873ebb`, read in the code there. Row 0au is a defect the first host met on 2026-11-20 at an item review on the build at `a8873ebb`, read in the intent's commits and the code there. Row 0av is a defect the first host met on 2026-11-20 in an intent on the build at `a8873ebb`, read in its dispatch records, its transcript and the code there. Row 0aw is a defect the first host met on 2026-11-21 in an intent on the build at `a8873ebb`, read in its dispatch records and its tree's history, and reproduced on the tip. Row 0ax is a defect the first host met on 2026-11-21 on the build at `a8873ebb`, measured on Delta and again on Alpha. Row 0ay is a defect the first host met on 2026-11-21 on the build at `a8873ebb`, read in its agent texts and its transcripts. Row 0az is a defect the first host met on 2026-11-21 in its install of `a8873ebb`. Row 0ba is a gap the first host met on 2026-11-21 on the build at `a8873ebb`, read in the planner and state texts. Row 0bb is a defect the first host met on 2026-11-21 on the build at `a8873ebb`, reproduced on the tip. Row 0bc is a defect the first host found on 2026-11-21, when its lead asked whether finished intents can ship as a merge train, read in the code of the build at `a8873ebb`, measured there and reproduced on the tip with the script in its handoff. Row 0bd is a gap the first host measured on 2026-11-21 in its ship-loss count. Row 0be is a race the first host met on 2026-11-21 in a final gate on Delta. Row 0bf is a waste the first host met on 2026-11-21 at a ship on Delta. Row 0bg is a defect the first host met on 2026-11-23 in a direct build of its config, on the build at `a8873ebb`, reproduced there and on the tip with the script in its handoff. Row 0bh is a defect the first host met on 2026-11-23 at an item review of a release-line intent on the build at `a8873ebb`, read in the intent's commits and the code there and reproduced on the tip with the script in its handoff. Row 0bi is a waste the first host measured on 2026-11-23 in a builder on Delta, on an item its planner cut by the text of the build at `a8873ebb`, which the tip holds unchanged. Row 0bj is a waste the first host measured on 2026-11-23 over its planners' transcripts on Alpha, read in the planner text of the build at `a8873ebb`, which the tip holds unchanged. Row 0bk is a waste the first host measured on 2026-11-24 in its open plan on main, where an audit cut 17 of the 34 intent edges its planners wrote, read in the planner text and plan-lint of the build at `a8873ebb`, which the tip holds unchanged. Row 0bl is a defect the first host read on 2026-11-24 in the build at `a8873ebb`, which the tip holds unchanged, while it set up its first session hosted on a machine where heavy work must not run; no run has met it yet. Row 0bm is a defect the first host met on 2026-11-24 on Delta, in a session that resumed an intent Omega had paused, on the build at `a8873ebb`, which the tip holds unchanged. Row 0bn is a defect the first host met on 2026-11-24 and 2026-11-25 on Delta, at the first reviews of two items of one intent, on the build at `a8873ebb`, which the tip holds unchanged. Row 0bo is a waste the first host met on 2026-11-24 and 2026-11-25 on Delta, where two sessions' verify-item and integrate calls outlasted the agent's two-hour tool cap, on the build at `a8873ebb`, which the tip holds unchanged. Row 0bp is a defect the first host met on 2026-11-25 on its main, where plan-lint refused two planned intents after an archive, on the build at `a8873ebb`, which the tip holds unchanged. Row 0bq is a waste the first host read on 2026-11-25 in a running item prove on Delta, on the build at `a8873ebb`, which the tip holds unchanged.

| Row | What | Handoff |
| --- | --- | --- |
| 0ag | `select` lists a busy intent with no live owner under `busy` with its reason, leaves its own process chain out of the busy check, and prints the lines a session acts on before those the 30-line cap may cut, so a session told to resume an intent finds it | `inferno-select-hides-resumed-intent-handoff.md` |
| 0ah | `dispatch-log` refuses a change no dispatch made since the tree's last snapshot, and `verify-item` keeps such a change between two of an item's attempts out of its `outside` list, so a late correction of an older item can be verified, and names the chain that clears such a change already in an item's first baseline, and reads a stretch of such changes that a peer's run writes back to the bytes it found as no change | `inferno-gap-change-blocks-late-correction-handoff.md` |
| 0ai | `integrate` run again on the code a command of it was red on takes the `--cause` call its red prints, as the gate does, and the cause rides the green that rerun minted into the gate and the ship, so an intermittent met at integrate is recorded and counted as one met at the gate | `inferno-integrate-rerun-records-no-cause-handoff.md` |
| 0aj | An item entry that repeats its criterion's words under `says` names the one criterion those words open as the spec stands, never its number alone, and the delta record writes the number they open, so a commit of the spec alone that inserts or removes a criterion no longer credits a mutant to its neighbour | `inferno-spec-change-moves-mutant-credit-handoff.md` |
| 0ak | Every Claude role that runs commands, the three builders, both reviewers and the oracle, waits for a command it started by the runtime's exit notification, never by a loop or `sleep` over its output, bounds a wait for a line with `timeout 1800`, and returns only when nothing it started still runs, so no subagent's answer is held behind a wait of its own | `inferno-subagent-waits-by-loop-handoff.md` |
| 0al | A gate mark followed by the full stop of its sentence is read as the mark, any other `(gate:` a criterion holds that the reader cannot take is a plan lint finding, and the owed line of a criterion past the lint names it, so a criterion the gate proves is never owed a mutant in silence | `inferno-gate-mark-full-stop-unread-handoff.md` |
| 0am | `dispatch-log` refuses the first dispatch of an item one of whose dependencies is not integrated and not in the same dispatch, and `frontier` prints a built item as `built`, never `ready`, so no builder starts in the one tree while the item before it owes its review record and its integrate | `inferno-dispatch-before-integrate-handoff.md` |
| 0an | A gate mark on a criterion that counts is a plan lint finding and proves nothing at a review, since no gate runs the count, a check mutant may break a comment line, and the planner names a build among what ends on a mark, so a count is proven by its check mutant and never by a gate that does not run it | `inferno-gate-mark-on-count-handoff.md` |
| 0ao | Ship deletes a merged run branch against the base it just merged into, also when the branch is one commit past its upstream, and prints a left-to-do line that passes, so a pushed run branch ships with exit 0 and the host's cleanup runs | `inferno-ship-branch-upstream-handoff.md` |
| 0ap | `run.cjs` journals each call (step, argv, tree, branch, head, exit, ms, error code, the next call it printed, and per check its start, end, seconds and log) and its detached gate, lane and record jobs their start, end and exit, into `<cacheDir>/journal/<day>.jsonl`, outside the branch folder ship's cleanup removes | `inferno-runner-keeps-no-journal-handoff.md` |
| 0aq | Each dispatch the runner prints carries a `describe <item-id> <dispatch id> <role>` line, and the orchestrator opens each spawn's description and each correction's summary with it, so every subagent run joins to its item without a prompt read | `inferno-agent-call-names-no-item-handoff.md` |
| 0ar | An intent's own `base_branch` wins over `delivery.base_branch`, and claim, ship and teardown on a base the primary checkout is not on work in a worktree detached at `origin/<base>` and read that base's ledger, and every step reads `origin/<base>` where no local base branch exists, so a release-line intent runs through the runner while the primary checkout stays on main | `inferno-release-line-intent-base-handoff.md` |
| 0as | A host key `verification.item_checks` (paths and a check) adds its check to every verify-item whose change reaches those paths, an item with no `finalize_check` included, so a host guard runs before the item commits without keying on the flow's `verify-<stamp>` folder name | `inferno-item-checks-by-path-handoff.md` |
| 0at | A running integrate or gate marks the tree, and a review record, a mutate, or a dispatch whose ownership meets that run's checks refuses while one runs there, as a running record already keeps them out, so no mutant and no builder edit lands under a running check, and a moved command names the paths that moved and the jobs alive in the tree | `inferno-record-races-running-integrate-handoff.md` |
| 0au | A fix record with no correction of the item since the last record keeps its misses, weight and tier, and after a fix record a review a peer's change re-owes prints the correction first, so an open finding nobody tried to fix never climbs the ladder | `inferno-delta-review-recounts-open-finding-handoff.md` |
| 0av | accept-dispatch refuses a list that leaves out a path the dispatch owns and its window changed, a deletion included, and a sibling's verify-item that meets such a frozen record names the owning item and its carried accept, so an owned change is never left unclaimed | `inferno-accept-leaves-owned-change-unreported-handoff.md` |
| 0aw | A grant and verify-item read a sibling's change as beside the item only against the item's attempts that owned the path, so a sibling integrated before the attempt that takes the path no longer refuses it, and a fresh dispatch after the sibling integrates clears the refusal as it says | `inferno-grant-refused-after-sibling-integrates-handoff.md` |
| 0ax | `gate --wait` computes an ended lane's verdict once per wait and polls at the queue's 5 s, so a lane that ended red no longer costs half a core for the rest of the wait | `inferno-gate-wait-recomputes-lane-key-handoff.md` |
| 0ay | The contract and quality reviewers carry the Skill tool and load a skill a standard names before they judge the paths it covers, as the builders do | `inferno-reviewer-cannot-load-skill-handoff.md` |
| 0az | The Claude installer splits INFERNO as it splits AI-DLC Turbo, so each role is an agent only and only the commands a person types are commands | `inferno-roles-installed-twice-handoff.md` |
| 0ba | The planner's append takes a claimed intent on its run branch, and the orchestrator names that path, so a run that needs a new item never edits the ledger by hand | `inferno-claimed-intent-takes-no-new-item-handoff.md` |
| 0bb | verify-item reads a fold as the base's alone with the file's merge attribute, as the review binding does, so a `merge=union` append-only file folds without a fresh dispatch | `inferno-union-fold-reads-as-unexplained-handoff.md` |
| 0bc | `gate --base <ref>` and `green --base <ref>` read the intent review against the base they fold, and `review --base <ref>` records against it, so a gate on the gated head of the intent ahead keeps a review that head never touched, and the follower ships on that gate once the head ahead merged | `inferno-gate-base-skips-review-handoff.md` |
| 0bd | One runner step starts the gate's finalize commands and touched lanes once the last item integrates, beside the scan and the intent review, and the gate reuses their proofs on the unchanged tree | `inferno-gate-tests-start-after-intent-review-handoff.md` |
| 0be | The mutate batch waits for a held signal past a poll before each run, and a run a late signal overlapped reads not run, so `run-mutate-check.test.cjs:101` holds under load | `inferno-held-signal-seen-one-tick-late-handoff.md` |
| 0bf | A host key names the paths no check reads, which every proof leaves out as it leaves out the ledger, so a fold of only those paths on the base ships without a gate | `inferno-ship-regates-on-unread-path-fold-handoff.md` |
| 0bg | A command's own scope takes a path under `.specs-inferno/` it names into its proof, and the gate's rerun line reads what the red command reads, so a commit of the host's config alone runs every check that reads it | `inferno-config-change-moves-no-proof-handoff.md` |
| 0bh | The item review's record stamps, for each lens, the end of the print its `read` line names, which the record already holds to a print of that lens, and the oldest end only for a lens that names none, and a dispatch printed again asks for that line, a first review's too, so a record after a correction no longer owes a delta over a correction both lenses read | `inferno-record-stamps-first-print-handoff.md` |
| 0bi | An item stops at three surfaces when each surface has its own sources to read, and the size rule counts each surface's sources as files, so a mechanism over more surfaces splits by surface and no builder carries five places' reading and work to its last call | `inferno-item-surfaces-own-sources-handoff.md` |
| 0bj | The planner's first batch reads an outline of the open intents, one line each with its range in the file, id, status, title and dependencies, and reads an entry's range only for a plausible overlap, the intent it extends or the anchor it writes at, so no planner reads state.yaml whole or makes its own slice | `inferno-planner-reads-whole-state-handoff.md` |
| 0bk | The planner writes an intent edge only where an item of the later intent reads a file, symbol, field or migration that an item of the earlier one creates and the base lacks, the edge names that evidence, and plan-lint refuses an edge without it, so a shared file, a regenerated seal, a shared list or pin and a sweep are folds the second to land resolves and hold no intent back | `inferno-ownership-as-dependency-handoff.md` |
| 0bl | A check mutant and a diagnosis probe are placed the way an item's own check is, through the host's `mutate.run` or `verification.run` with the wrapper's refusals read, so a session hosted where heavy work must not run sends them to the host's test machine, and a check keeps its exit code as its verdict | `inferno-check-and-probe-run-on-session-machine-handoff.md` |
| 0bm | A reviewed item's dispatch records move with its intent to another machine, checked against git and signed again there, and verify-item's `--since` excuses the base's fold and takes the item's grants, so an item reviewed on one machine is proven on another | `inferno-dispatch-record-stays-on-its-machine-handoff.md` |
| 0bn | `run.cjs review --item` prints its reviewer dispatches whole, past the 30-line cap of a plain answer, so the first review of an item with many criteria keeps every `standards` and `lint` line of the quality dispatch, both `write` paths, the one-message line and the record call | `inferno-review-dispatch-cut-by-line-cap-handoff.md` |
| 0bo | `verify-item` and `integrate` get the `--detach` and `--wait` form that `gate` and `review` have, so no call that runs checks or a real-app prove for hours outlasts the agent's tool call cap | `inferno-verify-and-integrate-outlast-tool-cap-handoff.md` |
| 0bp | The path check finds a file of an archived intent where the archive put it, and `archive-intent` names every open spec line that still points at the old place, so an archive leaves no open item refused by plan-lint or the frontier | `inferno-archive-leaves-required-paths-behind-handoff.md` |
| 0bq | verify-item hands `real_app.prove` the commit the item's work starts from as `INFERNO_SINCE`, so a host lane can narrow an item's prove to that item's own cases and mutants | `inferno-item-prove-gets-no-item-range-handoff.md` |

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

**A fold that was a fast-forward of a base rewritten later.** Row 0ac reads a fold of a rewritten base from the merge commit that brought it in, and a fast-forward leaves none, so the files it brought in still read as outside the item's ownership. The way on is the handoff's own: fold the base again (the next integrate or gate does) and run `verify-item` again. Reason: none of the folds in the handoff's evidence was a fast-forward, and that step clears it. Unlocks: a host that meets it in a run.

**A switch-off the base added, counted twice after a second fold of a rewritten base.** After a base rewritten between two folds is folded again, an old commit and its copy sit in two fold ranges, two commits of one patch, so a switch-off the base added at the source of a test file the item moved can count twice there, and a second switch-off the item puts on that same test reads as the base's. Reason: it takes a base rewritten between two folds, a test file the item moved and a switch-off by both the base and the item on one test of it, all at once, and the handoff's evidence holds no such case. Unlocks: a host that rewrites its local base between folds while its items move test files, or an item review that finds a switch-off `verify-item` let pass.

**Two clones of one folder name on one branch share a folder.** The cache folder of a repository is named by the folder name of its primary checkout, so two clones with the same folder name on one machine, on the same branch, still share `<cache>/<name>/<branch>/` after row 0af. The wait refuses the other clone's gate job (`GATE_OTHER_TREE`), and the readers of a lane and its accept do not. Reason: closing it moves every path a host reads, the folder of every tree on a branch among them, and the handoff's evidence holds no such pair of clones. Unlocks: a host that keeps two clones of one repository under one folder name on one machine and gates both on one branch.

**A chain call over two intents.** When two intents share one tree, the refusals of `verify-item` and `grant` print a chain call over the items of both, which one `dispatch-log` cannot take, since it logs the items of one intent. It was so before row 0ae, and the refusal row 0ae adds to `dispatch-log` leaves the chain call out there and names only the open dispatch's `accept-dispatch`. Reason: the handoff's evidence is two chains of one intent, and a call that joins two intents needs one dispatch record over both, which the flow does not have. Unlocks: a host that builds two intents in one tree and meets one of these refusals.

**The merge of this pull request.** The branch carries real work on the first host from this branch, by the owner's choice. The merge is the owner's word and nothing here waits on it.
