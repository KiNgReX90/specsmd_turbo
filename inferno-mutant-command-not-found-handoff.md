# Handoff: a mutant test whose command is missing on the wrapper's tree reads "no test summary", once per mutant

Built in `17490143` and `d3c0ee95`, as row 0s of `inferno-build-next.md`. This file can be removed from the branch; its text stays in history.

Found 2026-11-17 in Skoft_CRA, in the review of the item `spl-the-light-ground-is-the-spectrum-field` of the intent `the-public-sites-light-theme-is-spectrum-on-every-page`, run from Delta. Four mutants of four read no verdict, and the review said nothing about why that a reader could act on.

## What happened, and which part is the host's

The cause is the host's, and it is not for the builder of this row. Skoft_CRA's `site/` is an npm package of its own with its own lockfile. The host's test wrapper installs the root lockfile only, so the tree a mutant test runs in had no `site/node_modules`. A mutant test of a site item, `npm --prefix site run build && node --test site/test/ground.test.mjs`, ended in one second on `sh: 1: astro: not found`, exit 127. The host fixes that in its own repository, in the command `mutate.run` names or in the session's open.

The flow read the runs right: a run that never reached a test is no verdict. Two things in how it reads and reports them are the flow's.

## What is wrong in the flow

1. **The reason names no cause.** `run-mutate-verdict.cjs` gives a red run without a failing test summary the reason `no test summary reports a failure (exit 127)`. Exit 127 is the shell saying a command was not found, and exit 126 that it could not be executed. Neither is ever the test noticing a mistake, and the log's last line before the wrapper's own names the command. The review file carries only the generic reason, so the orchestrator has to open a log on another machine to learn that the tree lacks a binary.
2. **Every mutant pays to learn the same thing.** Entries that run in place (every language but Rust) have no control run. Each of the four mutants was written, sent, run and restored to reach the same `not found`, and three of them had the same test. Here a run took a second, but the first one took 27 s with its sync, and a test that fails after a long build would cost that build per mutant.

## Evidence

- Delta, `~/.cache/specsmd-inferno/Skoft_CRA/inferno-intent/the-public-sites-light-theme-is-spectrum-on-every-page-20261117T050320Z/mutate-batch-20261117T151521Z-454086-session-1.log`, `-3.log` and `-4.log`: `> astro build`, `sh: 1: astro: not found`, `remote-run: exit 127`. Walls of 28 s, 0 s and 1 s.
- The same batch, `-session-2.log`: the test was `cd site && npx astro build && npx playwright test ...`. Without `site/node_modules`, `npx` took an astro from its own cache, which ended on `Tsconfig not found astro/tsconfigs/strict`, exit 1. The same missing folder, read as `no test summary reports a failure (exit 1)`.
- The review on the run branch, commit `66937c80b`, file `.specs-inferno/intents/the-public-sites-light-theme-is-spectrum-on-every-page/reviews/spl-the-light-ground-is-the-spectrum-field.yaml`: four entries with `caught: none`, three with `why: "no test summary reports a failure (exit 127)"`.
- The host's workaround: mutant tests that start with `cd site && (test -x node_modules/.bin/astro || npm ci) &&`. With it, three of three mutants of the next item were caught.

## How to fix

1. In `run-mutate-verdict.cjs`, read exit 127 and exit 126 as a reason of their own, before the summary rules: `the test's command was not found (exit 127): <line>`, where `<line>` is the last line of the log that the host's wrapper did not print, cut to a fixed length. End the reason with what to do: the tree the test ran in lacks the command, and the host prepares that tree in the command `mutate.run` names or in `mutate.session.open`. The verdict stays none.
2. In `run-mutate-batch.cjs`, once an entry that runs in place reads that reason, every later entry with the same test is not written or run. It is recorded without `caught`, which `run-review-file.cjs` reads as a mutant that never ran and is owed to the intent review, and the batch's output names the reason once. Entries with another test still run, since their command may exist.

Do not add a control run for the entries that run in place. It would cost one full run of every distinct test in every batch to save the rare batch whose tree is not prepared.

Tests, in `run-mutate-verdict.test.cjs` and the batch's tests: a run that exits 127 after `sh: 1: astro: not found` reads no verdict with that line in the reason; a run that exits 1 with a failing summary still reads caught; a batch of three entries with one test whose first run exits 127 runs the test once, and the two entries after it are recorded without `caught` and without a run; an entry with another test in that batch still runs.
