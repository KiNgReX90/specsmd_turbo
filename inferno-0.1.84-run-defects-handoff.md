# INFERNO 0.1.84: defects met in real work on the first host

One file for the defects a host session meets on 0.1.84, newest last. Each section says what is wrong, the evidence and how to fix it. Nothing here is built on the host's account: the host works around it and writes the section.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

The fourteen sections of the 0.1.83 file are built as 0.1.84 and installed on the first host on 2026-11-12, where the shipped suite is green. That file is gone, and its text is in this branch's history at `912c9feb`.

## 1. `mutate.run` wraps a hand-wrapped test a second time unless it is spelled exactly like the key

**Built as 0.1.85 in `e3bb0844` (`mutate.wrapped`). Nothing of this section is left to build.**

Found 2026-11-12 on the app repo by reading 0.1.84 before setting the key. Not met in a run: the host holds the key back because of it.

### What would happen

- The host's review files already carry mutant tests that go through its wrapper, written by hand over two days. They spell the wrapper four ways: the wrapper's absolute path, its path under `~`, either of those behind an environment prefix such as `REMOTE_RUN_MACHINES=delta`, and either of those inside double quotes.
- `mutate.run` leaves a test alone only when it "already starts with the wrapper's own words": `text.startsWith(run.words)` (`startsWrapped`, `S/run-mutate-host.cjs:74-77`). The key can hold one spelling. Every test in another spelling is wrapped again.
- A test wrapped twice runs the wrapper on the other machine, where it does not exist or has no tree to send. The run prints no test summary and reads no verdict. Every owed proposal that an intent review carries from those files would then read `caught: none`, and a clean intent review would be refused for each of them.

### Why it matters for a host that adopts the key late

A host that sets `mutate.run` on its first day has no hand-wrapped tests. A host that ran without the key, which is every host until 0.1.84, has them in every recorded review, and a carried proposal cannot be rewritten: a delta review may not change a mutant, and a recorded file is not edited.

### What the flow should do

- The host says what counts as already wrapped, as it does for a session: a regex beside the key, such as `mutate.wrapped`, matched at the start of the test as the reviewer wrote it. Without it the rule stays as it is, the wrapper's own words.
- Or the two keys meet: a test that `mutate.session.match` matches is never wrapped by `mutate.run`. A host that sets both writes the regex once.
- Tests: with the regex set, a test behind an environment prefix, one with the wrapper's absolute path and one with its path under `~` each run as written. A bare test is wrapped once.

### One more thing a host must know

`{test}` goes in as one shell word, so the wrapper has to run its last argument under a shell. A wrapper that runs its arguments as a command line, as this host's does, takes the key as `<wrapper> {tree} bash -c {test}`. The example in `config.example.yaml` should say so in its comment.

### How the host gets through

It does not set `mutate.run` yet. Its orchestrators keep telling every reviewer to start each mutant's test with the wrapper.

## 2. A mutant numbered by its place in the review is credited to the wrong criterion, and nothing can move it

Met 2026-11-12 on the app repo, in the first review of an item with twelve acceptance criteria.

### What happened

- The item's spec lists its twelve criteria as unnumbered `- [ ]` lines. The reviewer proposed ten mutants and numbered them 1 to 10 in the order it wrote them. It proposed none for criteria 2, 3 and 7, and two for criterion 8, so from the second entry on the number is not the criterion's.
- The runner took each number as written. `itemCriterion` (`S/run-review-file.cjs:321-326`) checks only that the number is a whole number inside the count. `names` (`S/run-mutant-coverage.cjs:92-97`) then credits the entry to the criterion at that position.

| Written as | The line it breaks belongs to criterion | Result |
| --- | --- | --- |
| 1 | 1 | caught |
| 2 | 4 | not placed |
| 3 | 5 | not placed |
| 4 | 6 | caught |
| 5 | 8 | caught |
| 6 | 8 | caught |
| 7 | 9 | caught |
| 8 | 10 | not placed |
| 9 | 11 | caught |
| 10 | 12 | caught |

- Criteria 4, 5, 7 and 10 now read as held by a caught mutant, and no mutant that breaks them was ever caught. Criterion 7 never had one at all.
- The intent review cannot repair it. A proposal for `<item>:4`, `:5`, `:7` or `:10` is refused by `refuseSecond` (`S/run-review-mutants.cjs:155-169`), "which has a mutant its item review caught". An item delta review may propose no mutant (`refuseNew`).
- The other half is waste: the runner says the item still owes criteria 8, 11 and 12, which each have a real caught mutant under another number.

### Why it is easy to do

The reviewer counts the lines itself. Its definition says "named by the criterion's number, 1 for the first", and nothing it is handed carries the numbers. A reviewer that skips one criterion and keeps counting is wrong on every entry after it, and the file still parses.

### What the flow should do

- The dispatch of a first item review prints the criteria with their numbers, each with its opening words, so nobody counts lines.
- Each mutant and each pin of a first item review repeats the opening words of the criterion it names, under a key such as `says`. The runner compares them with the criterion at that number and refuses the file on a mismatch, naming the number whose text does start with those words. The reviewer is still there at that point and writes the file again.
- A way out for a review that is already recorded: the intent review may move an item's mutant to the criterion it breaks, as an entry of its own with the item's recorded number and the right one, checked against the criterion's words the same way. The criterion it leaves is owed again unless another entry holds it.
- Tests: a review numbered in order past a skipped criterion is refused and the message names the right number. A review whose numbers and words agree records as today. After a move, the criterion left behind takes a proposal in the intent review, and the one moved to is no longer owed.

### How the host gets through

It cannot repair this item inside the flow, so its orchestrator records the four criteria in the intent's notes. From now on its orchestrators hand every first item review the criteria as a numbered list in the dispatch text.

## 3. A criterion that can only be proven after the merge blocks the merge

Met 2026-11-12 on the app repo, at the ship of an intent that installs a timer on each machine.

### What happened

- Two success criteria of the brief each have a half that only exists after the landing. The timer runs the new script from the default branch's checkout, so "the timer reads active on each machine" and "a dry pass after the timer's first real pass removes nothing" can be read only once the code is on that branch. The brief says so itself, under its steps for after the landing.
- The intent reviewer mapped both halves as `proof: external` with an evidence path, which is what its definition offers for a proof a person or another machine gives.
- `mergeOwed` (`S/run-intent-owed.cjs:212-228`) lists every external criterion whose evidence file is missing as `evidence owed`, and `green` (`S/run-gate.cjs:332-346`) then exits 3. The ship stops on a proof that only the ship makes possible.
- `criteriaOf` (`S/run-intent-review-file.cjs:28-40`) knows three proofs: `test`, `code` and `external`. None says "after the merge".

### Why it matters

Any intent that ends in a step run from the default branch meets this: an installed service, a scheduled job, a deploy, a migration read back on the live copy. The honest map of such a criterion has no spelling, so the host either leaves the half out of the review or writes a file that is not evidence yet.

### What the flow should do

- A fourth proof, such as `after_ship`, with `where` holding the command and `evidence` the path. `mergeOwed` does not wait for it. The ship prints one line per entry as its last output, `owed after ship: <command> -> <path>`, and the state entry of the shipped intent keeps the list until each path exists.
- The planner marks it at plan time: a success criterion whose instrument runs after the landing says so in the brief, and plan-lint refuses an `after_ship` proof for a criterion the brief does not mark. That keeps the kind from becoming a way around an evidence file that could have been made before the merge.
- A read command for what is still owed, so a later session finds it: the intents list prints the shipped intents with an open `after_ship` path.
- Tests: a review with one `after_ship` entry and no file is green and the ship prints the owed line. The same entry spelled `external` is refused as today. An `after_ship` entry for a criterion the brief does not mark is refused.

### How the host gets through

Its intent reviewer judged the two halves again and took them out of the merge's criteria. The review still names both evidence paths as owed after the landing, and the session that ran the intent writes them on the default branch once the install has run. That cost one more review round, and the owed half now lives in prose that no command reads.

## 4. Every fold of the base voids the intent review, and the reviewer is handed the whole base delta

Met 2026-11-12 on the app repo. Reported as "the shared host config counts as intent code"; the cause is wider than that.

### What happened

- One intent recorded three clean intent reviews after its fix review. Each was owed for one reason: `the code changed since the review read it`, after a fold of the base.
- The last of those ranges held 121 commits and 162 files, 97 of them outside the ledger directory. The intent had changed one of the 97. The reviewer was dispatched with the whole range and took about 15 minutes, each time before a gate.
- The review binds the whole tree by content (`reviewCurrent`, `S/run-intent-owed.cjs:126-129`; `scopeHash` with no scope, `S/run-proofs.cjs:24-27`). The ledger directory is left out, so a host config under it voids nothing. Any other folded file does.
- This is the documented rule: "without it any folded change voids the review" (`config.example.yaml`, the comment of `review.outside`).

### Why it costs more than it protects

- On a host where several intents and direct builds land in an hour, the base moves between every review and its gate. Each gate attempt then owes a review round, and a review can be voided again while it is being written.
- The reviewer reads work that was reviewed and gated in its own intent. What it could add is how that work meets this intent, and it is handed 162 files to find it in.
- The protection is one-sided as it stands: the intent that lands first is never read against the one that lands second. The gate's commands on the folded tree are what prove the two together, for both.

### What a host can do today

`review.outside: ["**"]`. Measured on 0.1.84 with `outsideHash` on a throwaway repository: a fold that changes or adds files the intent never touched keeps the hash, a fold that changes a file the intent changed gives a new one, and so does the intent's own change. The key's comment calls it a glob of a knowledge base, so a host that reads only the comment does not find this.

### What the flow should do

- Say in the comment of `review.outside` and in the docs that `["**"]` binds the review to the files the intent changed, and hold it with a test of those three cases. Weigh making it the default.
- When a fold did touch one of those files, the dispatch of the delta review names them, and the reviewer reads the base's change to those files and what calls them, not the whole base delta.
- Tests: with the key, a fold of a file the intent never touched leaves `review` current and the gate does not owe it. A fold that changes a file the intent changed owes the review and the dispatch names that file.

### How the host gets through

It sets `review.outside: ["**"]`.

## 5. The frontier refuses a plan in which a later item needs a file an earlier item creates

Met 2026-11-12 on the app repo, at the first `run.cjs frontier` of an intent.

### What happened

- The second item of the intent lists under `context.required` a module that the first item creates, and it names that item under `depends_on`.
- `contractErrors` (`S/run-frontier.cjs:146-169`) checks that every `context.required` path and every `reads` path of every item exists on disk, before any dispatch and whatever the item waits on. The frontier answered INVALID for the whole intent, so the first item could not start either.
- The planner had no way to hear it earlier: plan-lint does not make this check, and its definition tells it to cite what the builder must read.

### What the flow should do

- Skip the existence check for a path that an item this one depends on, directly or through others, lists under `ownership.editable`, for as long as that item is not completed. Once it is completed the check holds again, so a file it never created is still caught before the second item starts.
- Run the same check in plan-lint, with the same exception, so a path nobody creates is refused at plan time.
- Tests: a plan whose second item requires a file its first item owns and does not yet hold gives a frontier of the first item. The same plan without the `depends_on` is refused. After the first item completes without creating the file, the frontier refuses the second.

### How the host gets through

It takes the path out of the second item's `context.required` in a spec-only commit and puts it back in another one once the first item is integrated.

## 6. A mutate session opens once per distinct test command, so a review whose mutants each name their own test saves little

Read 2026-11-12 in the 0.1.85 source on this branch, before the host set the key. It is a gap in 0.1.85, written here because this is the one open file.

### What the code does

- `sessionGroups` (`S/run-mutate-session.cjs:63-76`) keys its groups on the test command, and `runGroup` (`:152`) opens and closes one session of the wrapper per group. A batch of eight mutants with eight test commands pays eight opens: eight syncs of the tree and eight waits in the test machine's queue.
- The `run` command already takes its test per call, as INFERNO_TEST, and `verification.session` already runs the different checks of one integrate in one session (`S/run-check-session.cjs`). Nothing in the wrapper's contract ties a session to one test.
- The Rust entries that share a build stay outside every session: `execute` (`S/run-mutate-batch.cjs:112`) runs the control and each switched entry through the plain wrapper, so a batch of N of them pays N + 1 syncs and waits.

### What it costs, measured

The first host's nine intents in flight hold 31 review files with mutants, 342 mutants in all.

| Count | Value |
| --- | --- |
| Mutants no Rust build shares | 251 |
| Distinct test commands, summed per review | 185 |
| Opens with a session per test command | 185, so 66 of 251 saved (26%) |
| Opens with a session per batch | 31, so 220 of 251 saved (88%) |
| Mutants of a shared Rust build, outside every session | 91 |

A reviewer writes a test per mutant, usually one test name each, so two mutants seldom share a command.

### What the flow should do

- Open one session per batch, at the first entry `mutate.session.match` reaches, and close it once after the last. Per mutant the steps stay as they are: write, reseal, send, run with that entry's own test as INFERNO_TEST, put back, send back.
- Keep what a group stop means today, per batch: a send back that failed stops the session's remaining entries with no verdict, and a signal stops the batch.
- Run the control and the switched runs of a shared Rust build in that same session when their command is reached, so a batch of Rust entries syncs once and waits once.
- Tests: a batch of three mutants with three test commands opens one session and closes one. A batch whose second send back fails leaves the third with no verdict and still closes. A batch with two switched Rust entries and one other entry opens one session.

### How the host gets through

It sets `mutate.session` as it is, for the entries that do share a command, and leaves `mutate.run` unset. Its reviewers already write the wrapper themselves in 317 of the 342 entries, so the key would move little today, and with one open per test command it would send every light test through its own sync and wait. The host sets `mutate.run` once a batch is one session.

## 7. A check the host's wrapper refused to run reads as a failed check, and the builder is sent after a machine fault

Read 2026-11-12 in the 0.1.85 source on this branch by the session that owns the first host's wrapper, before the first integrate ran through a session. It holds for a plain wrapped check too, and a session adds new ways to meet it.

### What the code does

- `runCommand` (`S/run-proofs.cjs:156-170`) reads a check only as exit 0 or not. A wrapper that ran nothing, because its machine did not answer or the session's slot was gone, exits non-zero, so the check is `fail`.
- When a session's open fails, `checkSession` (`S/run-check-session.cjs:76-82`) gives every check of the step that exit without running one.
- `run.cjs integrate` (`S/run-integrate.cjs:290-297`) then prints FAIL per check and "send every failure above to the builder in one correction", and exits 2. The gate reads the same result as a red.
- The first host's wrapper marks this case: exit 75 and a line that starts `remote-run: REFUSED [machine]` and ends "no verdict". It gives that for a lost connection, a restarted machine and a session whose holder ended (idle for 900 seconds, or 6 hours old). `mutate` already reads a session that did not open as no verdict; the checks have no such reading.

### What the flow should do

- Give a host one optional key, `verification.refused`: a regex of the line its wrapper prints when it ran nothing. A check, or a session open, that exits non-zero with that line in its log is no verdict.
- In a session, open a fresh session once and run the checks that got no verdict again. A check outside a session runs once more.
- After a second refusal, integrate and the gate end with their own exit code and one line that names the machine fault and says to run the step again. They print no FAIL for those checks and no line about a builder, and they mint no proof.
- Tests: a session whose first open is refused and whose second opens gives a green integrate with two opens in its log. Two refused opens give the no-verdict exit, not exit 2, and no check reads failed. A check that exits non-zero without the line is a fail as today.

### How the host gets through

An orchestrator that sees every check of an integrate or a gate fail with a REFUSED line under it runs the step again and sends nothing to its builder. The host's own direct landing gets the retry in its driver.

## 8. A dispatch-log over several completed items joins their histories, and verify-item then refuses a peer that ran beside one of them

Met 2026-11-12 on the app repo, at the fix of an intent review that touched six completed items. The code is the same in 0.1.85.

### What happened

- The orchestrator logged one dispatch for the fix with `--items` over the six items. `recordDispatch` (`S/run-dispatch.cjs:155-166`) put each item's last dispatch under `previous`, so the new record has six.
- `lineage` (`S/run-dispatch.cjs:112-127`) follows every `previous`, so the fix's history is the six items' histories joined. `effective` (`:130-138`) claims every file any of them changed, and `layout` (`S/run-peers.cjs:125-136`) takes every attempt of all six as the item's own.
- An accepted dispatch of a seventh item, outside the batch, had changed one test file. Of the six, one item owns and changed that file, and the seventh item's dispatch did not run beside it. It did run beside an attempt of another of the six, which neither owns nor touched the file.
- Joined, the file is the batch's own and the seventh item's dispatch ran beside the batch, so `checkPeerChange` (`S/run-peers.cjs:107-118`) refused with DISPATCH_PROOF "dispatch ownership overlaps". Each of the six had verified clean on its own before the batch.

### What the flow should do

- Keep, per member of a joined history, which `previous` branch it came through. A peer's change to a file overlaps only when the peer ran beside an attempt of a branch that claims or owns that file. The batch's own attempt counts for every item it covers.
- Tests: items A and B each hold an accepted dispatch, and a peer ran beside A's attempt and changed a file only B owns, after B's attempt ended. One dispatch-log over A and B, then `verify-item --items A,B`, passes. The same setup with the peer beside B's attempt is refused as today.

### How the host gets through

It runs `verify-item --items ... --since <the commit the batch started from>`, so the windows before the batch are not read again. Each item's own verify covered them when the item completed.

## 9. A gate mark names a bare command, and a config that wraps its commands for a test machine no longer holds it

Met 2026-11-12 on the app repo, at the final gate of an intent with fourteen marked criteria. The code is the same in 0.1.85.

### What happened

- The plan marks a criterion with the command that proves it, as the base config lists it: `(gate: npm run test:definitions)`. The plan lint holds that name against `verification.finalize` of the base config, where it stands verbatim.
- The gate runs with a config the host generates per intent tree. In it every finalize command carries the host's wrapper in front, `<wrapper> <tree> npm run test:definitions`, so the check runs on a test machine. The tree's path is in the command, so no plan can name it ahead.
- `verdictOf` (`S/run-gate-marks.cjs:51-52`) compares the mark with the finalize commands and with the results by exact text. Under the generated config no command equals the bare name, so each of the thirteen command marks printed "no command of verification.finalize and no lane of this config". The same gate had printed PASS for that command a few lines up. The one lane mark read right.
- The plan lint has the same compare (`S/run-plan-lint.cjs:267` over `gateNames`, `S/run-criterion-marks.cjs:37-41`). Read with the generated config, `gateNames` does not hold the bare name, so a `frontier` or `plan-lint` call that passes that config refuses an open item whose mark the base config accepts.
- Nothing reads the verdict after it is printed, and the criterion still owes no mutant. What is lost is the one line that says the marked criterion was proven by this gate, and the line that takes its place says the plan is wrong.

### What the flow should do

- One function in `S/run-criterion-marks.cjs` answers which finalize command a name stands for: the command equal to it, or the command whose rest after `verification.session.match` equals it. That key is already how a host says what its wrapper's prefix is (`reach` in `S/run-host-session.cjs:43-46`). `gateNames` and both compares of `verdictOf` go through it.
- With no `verification.session` only the verbatim form counts, as today.
- Tests: under a config whose finalize commands are wrapped and whose match reaches them, a criterion marked with the bare command prints the verdict the gate gave the wrapped command, and the plan lint accepts the mark. A mark that names the wrapped command verbatim reads as today. A name neither form holds is refused by the lint and prints today's line at the gate. Without the session key a bare name under wrapped commands is refused as today.

### How the host gets through

It reads the verdict of a marked command from the gate's own PASS or FAIL line for that command, and takes the MARKED line of a command mark for nothing. It runs `frontier` and `plan-lint` without the generated config.

## 10. The archive before the ship makes every gate mark read as late, and the ship then owes the intent review

Met 2026-11-13 on the app repo, at the ship of the first intent that carries gate marks. The code is the same in 0.1.85.

### What happened

- The orchestrator followed its own finalize order (`agents/orchestrator/agent.md`, steps 5 and 6): `close-intent`, `archive-intent --sweep`, one commit, then `ship`. The archive commit moved the intent's directory under `archive/`, 47 files in one commit.
- `ship` proves the folded tree with `green`, which counts the criteria that still owe a mutant. `itemProofs` (`S/run-mutant-coverage.cjs:70-76`) reads the spec where it now lies, in the archive, and hands that path to `lateMarks`.
- `planned` (`S/run-criterion-marks.cjs:51-56`) asks for the commit that last changed the criterion's text with `git log -1 -S<text> -- <spec>`. At the archived path the only commit that holds the text is the archive commit itself. It is no ancestor of the item's first review, and it changed more than the spec, so the mark counts for nothing.
- Measured on that archive commit with the flow's own readers: 14 marks, all 14 late. Before the archive none was. Twelve criteria across five items owed a mutant again, and `ship` ended with exit 3 and the intent review owed, on a tree whose gate and intent review were both green one commit earlier.
- A commit that moves the directory back does not help: it adds the text at the live path, so it is the last commit that changed it there, and it too changed more than the spec.

### What the flow should do

- `planned` reads the history of the criterion's text at the spec's live path, also when the spec is read from the archive, and counts only a commit that added or changed the file there (`--diff-filter=AM`). The archive's move is then no change of the text. The "nothing but the spec" compare names the live path too. Read so, all 14 marks of the measured commit count again.
- Tests: an intent with a marked criterion that was planned before its first review is closed and archived in one commit. The coverage lists no late mark and `green` holds. A mark added after the first review, in a commit beside other work, reads late before the archive and after it.

### How the host gets through

It closes the intent and commits without the archive, ships, and runs `archive-intent --sweep` on the base branch after the merge, in one commit of state files.

A tree that already holds the archive commit, with folds and review records on top, keeps it. Where a late mark is then owed, the orchestrator makes one commit that changes that spec alone and rewrites the marked line, the mark's name in backticks. That commit is the last one that changed the text and it changed nothing but the spec, so the mark counts again. Measured on a second intent of the host: one late mark before the commit, none after, and the same code tree hash, so no gate proof is lost. On that intent the reviewer had already been sent after the late mark and had proposed a mutant for a criterion the plan had marked as one no mutant can reach.

## 11. Committing the evidence of an external criterion voids the intent review that waits for it

Met 2026-11-13 on the app repo, on an intent with one `proof: external` criterion and `review.outside: ["**"]` set. The code is the same in 0.1.85.

### What happened

- The reviewer's text (`agents/reviewer/agent.md`, intent mode) says an external criterion names its evidence path under `.specs-inferno/intents/<intent>/evidence/`, "so adding it later leaves the reviewed tree as it is".
- The intent review was recorded clean. The gate then folded the base in, so the review no longer held by its `tree` hash and held by `tree_outside` alone. `green` asked for nothing but the evidence.
- The orchestrator committed the evidence file, one file under the intent's `evidence/` directory. `green` then read "intent review owed: the code changed since the review read it".
- The cause is the list of names in `outsideHash` (`S/run-intent-owed.cjs:101-123`). `own` holds every path the branch changed against the base, the flow's own files under `.specs-inferno` among them, and `kb` (`:120`) names each of them that matches the globs. With `["**"]` that is all of them. The hash beside the list leaves `.specs-inferno` out, as every other hash does (`scopeHash`, `S/run-proofs.cjs:26`), but a new path under it is a new name in the list.
- Measured on a copy of that tree: before the evidence commit the outside binding holds and nothing is owed, after it the binding fails. With the paths under `.specs-inferno` left out of the list, the value is the same at both commits.
- The same list changes with every other new path under `.specs-inferno` after a fold: a deferred finding's file, and the archive's move of the whole directory.

### What the flow should do

- `outsideHash` leaves the paths under `.specs-inferno` out of `own`, so they reach neither the list nor the `skip` test. That is what `scopeHash` already does for content.
- Tests: with `review.outside` set, a review recorded, the base folded in and then one file committed under the intent's `evidence/` directory, the review reads current and `green` owes nothing. The same sequence with a file of the intent's code changed owes the review as today.

### How the host gets through

It sends the intent review the flow asks for. The range is the evidence commit alone, so the round is short, and it is one reviewer dispatch that reads nothing new.
