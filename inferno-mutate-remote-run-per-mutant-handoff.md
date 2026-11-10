# Handoff: a batch of text mutants costs one remote run each

Met on 2026-11-10 while orchestrating the Skoft_CRA intent `the-terms-and-the-site-keep-a-buyers-claim-off-skoft`. Worked around there, not built here. Paths are under `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/` and `src/flows/inferno/agents/reviewer/agent.md`.

## What is wrong

`run.cjs mutate --batch` shares one build only for the Rust mutants (`run-mutate-batch.cjs`). Every other mutant runs its own `test` command, one after the other. On a host where agent tests may not run locally, that command is a `remote-run.sh auto <tree> ...` call, so each mutant pays a checksum sync of the whole tree and a wait in the remote machine's queue for a test that runs in under a second.

The reviewer definition (step 2, "The test catches the break") asks for one mutant per criterion with a test. For an item that is reader-facing copy held by verbatim pins, that is one mutant per sentence.

## Evidence

Item `r4t-the-terms-keep-fines-and-every-claim-off-skoft`, review of range `4e68c00d4..738abed22`. The reviewer's batch held 27 mutants, 25 of them one changed phrase in `site/src/pages/terms.astro`, each tested with `remote-run.sh auto <tree> bash -c "cd site && node --test test/terms.test.mjs"`. The batch started at 09:14 and was on mutant 21 at 11:12: 118 minutes, about 5.6 minutes per mutant, with the tree locked for the next builder the whole time. `node --test site/test/terms.test.mjs` itself runs 17 cases in well under a second. The pins are literal strings in a `says([...])` list, so each of the 25 answers was readable from the test file.

## Workaround used

The orchestrator's review dispatch for the next items of that intent tells the reviewer to confirm a verbatim pin by reading the pinned string against the page, and to mutate only a pin that is a pattern or carries logic, with at most five mutants per item.

## How to fix

Two parts, the first the larger saving.

- In `run-mutate-batch.cjs`, group the non-Rust mutants by their `test` command. For a group whose command starts with the host's remote wrapper, sync the clean tree once, then for each mutant send only the mutated file (or apply `find` and `replace` on the remote copy), run the test, and restore, all inside one remote session that holds the queue slot once. A fixture test: three mutants with one shared test command produce one sync and three verdicts.
- In the reviewer definition, step 2: when a criterion's test is a literal string pin of reader-facing copy, the reviewer verifies the pin by reading (the changed sentence stands verbatim in the test) and plants no mutant for it. Mutants stay for pins that are a pattern, a count or a computed value.
