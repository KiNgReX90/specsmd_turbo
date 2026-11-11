# INFERNO 0.1.82: defects met in real work on its first host

Met from 2026-11-10 on, on Skoft_CRA, after the 0.1.81 to 0.1.82 reinstall. Each one was worked around there, and none is built here. New ones are added at the end. `S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

## 1. An item that owns a file under `.specs-inferno/` can never be reviewed

What is wrong. `itemFiles` in `S/run-item-proof.cjs` (:269-275) leaves every path under `.specs-inferno/` out of the proof's `paths`. `proofAtHead` in the same file (:110-119) then lists what changed since the baseline and is owned by the item, without that filter, and answers `stale` when one of those is missing from `paths`. So an item whose `ownership.editable` names a file under `.specs-inferno/`, a host config for instance, and changes it, has a proof that is stale the moment it is written. `review --item` answers "verify-item owed" after every green `verify-item`, with no way out.

Evidence. Intent `the-installers-carry-their-notices-and-the-release-checks-its-own-duties`, item `r4r-every-installer-carries-its-licence-and-third-party-notices`, whose editable list named `.specs-inferno/config.yaml` and `.specs-inferno/config.codex.yaml`, because the item adds a finalize scope. Worked around in the host's commit `f65d6e1ac` by taking the two config files out of the item's ownership.

How to fix. Hold both sides to one rule. Either `proofAtHead` drops the paths under `.specs-inferno/` from `changed` before it compares, or `itemFiles` keeps the ones the item owns. The first matches what the recorder already says, that the ledger is never part of the code a review binds. Then say in the planner text which of the two a plan may do: an item may own a host config, or a config change is the orchestrator's own commit. A test: an item that owns `.specs-inferno/config.yaml` and one source file changes both, `verify-item` passes, and `review --item` dispatches a reviewer.

## 2. Output over 64 KiB is cut when `run.cjs` writes to a pipe

What is wrong. `S/run.cjs` writes its result with `process.stdout.write` (:254-256) and then ends with `process.exit` (:263-277). On a pipe Node writes without waiting, so whatever has not left the buffer when the process exits is lost. An orchestrator that pipes the output, to `tail`, to `cut` or to a JSON reader, loses the end of a long answer, and the end is where the next step is printed.

Evidence. `review --item` for the item of section 1 printed a range of about 500 paths, 75,089 bytes in all. Piped, it lost the `write` line of the quality dispatch and the closing `then` line, and with `--json` the JSON had no end. Redirected to a file, all of it arrived.

How to fix. Set `process.exitCode` and let the process end by itself, or exit from the callback of the last `stdout.write`. A test: a result larger than 64 KiB, read through a pipe, arrives whole and its last line is the `then` line. Beside it: a dispatch that prints 500 paths is more than a reviewer's brief should carry in text, so print the count and write the list to a file the dispatch points at.

## 3. No mutant runs at an item that has a quality review

What is wrong. The record of an item review runs the reviewer's mutant proposals only on a tree that holds nothing uncommitted but the review file being recorded: `busy(tree, rel)` in `S/run-mutant-runs.cjs` (:46-52) allows the one path `rel`. An item with production code owes two lenses, and `S/run-review.cjs` records both in one call (:198-230), so at that moment two review files are uncommitted: the contract file and `reviews/quality/<item>.yaml`. `busy` reads the second as a sibling's work, no mutant runs, and the record then commits both files. Every proposal of every such item stays owed to the intent review. Nothing is lost, because the intent review runs them on a clean tree. But the item loses its caught mutant per criterion, and a survivor now shows at the end of the intent as a major finding, when its builder is cold, instead of in the item's own round.

Evidence. Item `r4r-every-installer-carries-its-licence-and-third-party-notices` on Skoft_CRA: `review --item --reviewer --quality-reviewer` printed "no mutant ran: the tree holds uncommitted work in .../reviews/quality/r4r-every-installer-carries-its-licence-and-third-party-notices.yaml, so 5 proposals stay owed to the intent review", and recorded both files in the host's commit `5de2b04b4`. There is no workaround at the item: the two lenses cannot be recorded apart.

How to fix. `busy` takes the set of files this record signs, which `run-review.cjs` already holds as `signed` (:230), and allows all of them. A test: an item with both lenses pending records, its proposals run, and each lands with `caught` in the contract file.

## 4. The readout cannot yet judge the flow it was built to judge

What is wrong. Two things in `evals/review-loop/`, both seen on the first item that finished its review loop after the reinstall.

- It does not read the quality lens. The readers key on `intents/<id>/reviews/<item>.yaml` (`history.cjs`, the `reviews` pattern), so `reviews/quality/<item>.yaml` is never counted. The item's readout said 2 rounds and no later finding, while the item had a third round: a minor finding of the quality lens, settled by its warm builder. Two rows of the measure cannot be filled: the findings of the quality lens per item, and the reviewer tokens of both lenses together.
- It counts a carried mutant again in every round. `stats.cjs` adds up the mutants each recorded version of a review file lists. On the old flow every round planted new ones, so the sum was the number run. On 0.1.82 a later round carries the caught mutants over and runs only the survivors, and the file does not say which of its mutants ran in this round. The item's readout said "28 in 2 rounds, so 7.0 per acceptance criterion" for 15 mutants in round 1 and 13 listed in round 2, of which 2 were the survivors of round 1.

Evidence. Skoft_CRA, intent `the-app-shows-its-licence-its-notices-and-its-data-sources`, item `r4a-about-opens-the-licences-and-credits-the-data-sources`, review records `d8f1d2131` and `2a42e8220` on its intent branch. Its first round was written by a reviewer dispatched before the reinstall, so the item is no clean measure of the new flow either way.

How to fix. Read both lenses: rounds, fix rounds and findings by weight for `reviews/quality/` beside the contract file, and one total per item. Count a mutant once: key it by criterion, file, line, find and replace, and count a later listing only when its verdict changed, or have the runner mark in the review file which mutants it ran in this record. Until then the row "mutants per acceptance criterion" reads too high on the new flow.

## 5. A proposal that never ran and whose code moved to another file locks a clean intent review

What is wrong. The first half was seen on the host. The second half is read from the scripts: the host took the way out named below at once, on 2026-11-11, so the two refusals were never provoked there. That way out worked as described: the runner printed "no verdict: <file>:<line> changed, and find no longer marks one line of it; propose another for <item>:<n> in the next intent review" for each dead entry, and the record landed with verdict `fix` on the reviewer's one minor finding that lists them.

- At the item. A correction between two rounds moves the line a mutant names into another file. The round 2 review is a delta review, and `refuseNew` in `S/run-review-file.cjs` (:275) lets it hold only what the last review held, where `sameMutant` (:241) compares the file. So the reviewer cannot name the new place. `locate` in `S/run-mutant-runs.cjs` (:84) follows a line inside its own file only. When the mutant never ran, which is every mutant of an item with two lenses (section 3), the dead entry stays in the item review as a proposal without a verdict.
- At the intent review. `intentMutants` in `S/run-review-mutants.cjs` (:155) takes that entry up as owed (`owedProposals`, `S/run-mutant-coverage.cjs` :55). A clean record that proposes nothing for the criterion counts the entry as caught before it runs, runs it, gets `caught: none` from `locate`, finds the gap afterwards, puts the review file back and refuses with "verdict clean while ... owes a caught mutant". Nothing is recorded, so the `none` is lost. The refusal says to propose one mutant for the criterion. A record that does is refused by `refuseSecond` (:143), "which has a mutant this record runs", because the dead entry is still held as owed. The two refusals send the reviewer back and forth.

The ways out today are a pin, which fits only a criterion whose test pins reader-facing copy verbatim, or a record that is not clean: the reviewer writes the unrunnable mutants as a finding of its own, the record lands with verdict `fix` and keeps the entries as `caught: none`, and the next intent review may then propose at the new place, because `held` leaves out an entry that reads `none`.

Evidence. Skoft_CRA, intent `the-article-14-filings-are-due-on-time-and-complete`, item `a14-a-found-vulnerability-reads-right-on-its-case`. Its review records `a4643d3de` and `97815ac49` hold mutants for criteria 1 and 3 at `src/lib/vuln/reporting-case/CaseCard.svelte:79` (find `Boolean(id)`) and `src/lib/vuln/OwedBanner.svelte:82` (find `ids.join(', ')`), neither with a verdict. The correction of the quality finding of round 1 moved both lines into `src/lib/vuln/reporting-case/case-findings.ts` (:67 and :72), and neither file holds its find any more.

How to fix. Three changes, the first one enough to end the lock.

- In `intentMutants`, place every owed proposal with `locate` before `refuseSecond` and before the first gap check. One that cannot be placed is kept as `caught: none` with its why, is left out of `held`, and is not counted as caught. Then the first refusal already names the criterion, and the reviewer's own proposal for it is accepted in the same record.
- Let `locate` look further than the entry's own file: when that file no longer holds the find, search the files the item changed since the review that proposed it, and take the one line that holds it once.
- A test: an item review records a proposal that never ran, a later commit moves its line to another file, and the intent review that proposes one mutant for that criterion at the new place records clean.

## 6. A finding the user has put after the release cannot be recorded as such

What is wrong. This is a gap, not a fault. An item the user drops leaves through `state-transition.cjs defer-item`, with its reason on record. A finding has no such way out. `verdictParts` in `S/run-review-file.cjs` (:287-309) refuses `clean` with any finding and with any surviving mutant, whatever its severity. A host whose user has set a release bar, where only a named class of finding blocks and the rest is built in the first update, can therefore never record an intent review that says so. The orchestrator moves those findings out of the review by hand into a file of its own making and has the reviewer write the review again with only the blocking ones. The recorded review then no longer holds what the reviewer found, and the full first round survives only as a side file nobody reads by rule.

Evidence. Skoft_CRA, intent `the-confirmed-launch-findings-are-fixed-before-the-freeze`, intent review of 2026-11-11: 20 findings and 3 survivors in the first round, of which the user's bar keeps a few. On its intent branch, `.specs-inferno/intents/<id>/review-2026-11-11-round1.yaml` is the first round kept by hand and `first-update.md` (:10-29) is where the rest went. The same was done by hand on 0.1.81 for an intent of 4 items with 5 minor findings.

How to fix. Give a finding the way out an item has, and keep it narrow.

- The intent review file takes a list `deferred`: each entry is a finding as written, plus `to`, a file in the intent folder, and `reason`. The recorder checks that the `to` file exists and names the finding's file and line. The verdict rule leaves `deferred` entries out, so a review whose every open finding is deferred records `clean`.
- The reviewer never defers. The orchestrator moves an entry with one command, `state-transition.cjs defer-finding --intent <id> --entry <n> --to <file> --reason <text>`, on a rule the user gave. Which severities may leave is the host's, in a rule file under `.specs-inferno/standards/`. Without such a file only `minor` may, and a surviving mutant never without it.
- The gate and the ship summary print the number of deferred findings and the file that holds them, so the next plan picks them up.
- A test: an intent review with one blocker and two minor findings, the two deferred under the default rule, stays `fix` until the blocker is closed and then records `clean` with both entries kept.

## 7. A test command that writes into the tree leaves it changed, and the runner says every file is restored

What is wrong. The mutant runner puts back the file it broke and, for a host that names its seal under `mutate.sealed`, the paths its own reseal changed (`S/run-mutate-seal.cjs`). It does not look at what the test command itself wrote. A host that has not set `mutate.sealed` gets reviewers who reseal inside the test command, since nothing else makes their test reach the code. After the record the broken file is back and the seal is not: it holds the digest of the mutant. The runner reports `restored: true` and "every file is restored", and the next step meets a file nobody wrote. An orchestrator that stages everything commits a seal that no longer matches its files.

Evidence. Skoft_CRA, intent `the-article-14-filings-are-due-on-time-and-complete`, intent review record of 2026-11-11, batch `mutate-batch-20261111T015925Z-664741`. A mutant in a definition template carried the test `node scripts/lib/definitions/pack.mjs --write && <test>`. After the record `definitions/pack-manifest.json` was changed in the tree, and the host's pack check named 1 problem. The host has since set `mutate.sealed` (its commit `cb922e68a`). Proof there: the same byte change fails the pack check with no reseal, and with the key set one mutant run reseals, the check passes, and the tree is clean afterwards.

How to fix. Two small things.

- After a batch, and after a single mutant, the runner reads `git status` and compares it with what it read before the first write. A path that changed and is not one it restored makes the result `restored: false`, names the path, and says that a host which seals files names them under `mutate.sealed`. A test: a test command that appends to a tracked file ends with that refusal.
- The installer, or the config check, tells a host what section 2 of `inferno-improvement.md` only says in prose: a host config with no `mutate` block gets one line at install that names `mutate.sealed` and `mutate.session` and what each is for.

