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
