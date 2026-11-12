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
