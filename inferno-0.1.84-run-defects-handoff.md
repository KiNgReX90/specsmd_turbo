# INFERNO 0.1.84: defects met in real work on the first host

One file for the defects a host session meets on 0.1.84, newest last. Each section says what is wrong, the evidence and how to fix it. Nothing here is built on the host's account: the host works around it and writes the section.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

The fourteen sections of the 0.1.83 file are built as 0.1.84 and installed on the first host on 2026-11-12, where the shipped suite is green. That file is gone, and its text is in this branch's history at `912c9feb`.

## 1. `mutate.run` wraps a hand-wrapped test a second time unless it is spelled exactly like the key

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
