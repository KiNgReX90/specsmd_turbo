# Handoff: the mutate batch looks for a held signal after one `setImmediate`, which does not wait for a SIGTERM that another thread of the process handles late, so under load one more run starts and `run-mutate-check.test.cjs:101` reads red

Row 0be. Met on the first host on 2026-11-21 in a final gate on Delta, on the build at `a8873ebb`, which the tip `85f91669` matches in these files.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

## What is wrong

1. **The stop rests on one tick.** `baselines` (`S/run-mutate-check.cjs:54-65`) and each run of the batch (`S/run-mutate-batch.cjs:91-93`, called at `:114`, `:154`, `:186`, `:223`) ask `session.received()`. That yields one `setImmediate` and reads the flag the listener sets (`S/run-mutate-journal.cjs:283-285`). The listener runs only when the event loop reads the signal. A process-directed SIGTERM is handled by whichever thread of the process takes it, and on a loaded machine that thread may write libuv's signal pipe only after the tick has passed. So the next run starts.
2. **The test pins the contract and sees the race.** `a signal held during an unmutated run stops the batch before the next one` (`S/run-mutate-check.test.cjs:101`) sends `kill -TERM $PPID` from entry 1's check and expects only `a` in the log. On Delta under load it got `[a, 0]`: entry 2's unmutated run started.
3. **The cost in use is small, but the red is not.** Files are restored in the `finally` either way, so the extra run costs only time. But a red in `npm run test:inferno` inside a host's final gate costs a gate.

## Evidence

- The session's line, verbatim: "npm run test:inferno, 2144 pass 1 fail: run-mutate-check.test.cjs:101 "a signal held during an unmutated run stops the batch before the next one" got [a, 0] for [a] (the next entry ran before the SIGTERM stop; log .../gate-20261121T132637Z/5.log). The branch changes no .specsmd file (diff vs origin/main empty), so I re-gate with --cause."
- Delta (Debian, 4 cores), `~/.cache/specsmd-inferno/Skoft_CRA/inferno-intent/the-product-page-wears-chapter-arcs-20261117T050347Z/gate-20261121T132637Z/5.log`, read only on 2026-11-21: line 804 `✖ a signal held during an unmutated run stops the batch before the next one (231.174545ms)`, and at 2181-2186 the actual `['a', '0']`. The other signal tests beside it passed. Delta's load average read at the same time: 5.18 on 4 cores.

## How to fix

1. **Wait for the signal, not for a tick.** Before each run, `received()` yields until the loop has polled since the last run ended. That means two turns, `setImmediate` then a `setTimeout(0)`, so a poll phase with the signal pipe ready runs between them. And a run whose child ended on a signal (`run.signal`) still stops at once, as today.
2. **A signal that arrives as a run ends is not lost.** When the listener fires during a run that started before it was seen, that run's result reads `not run`, and the batch stops before the next, so the result never counts a run the signal should have stopped.
3. **The test holds the contract without the race.** Entry 1's check sends the signal and then waits for it to be taken (`kill -TERM $PPID; sleep 1`), so the signal is held during the run, as the test's name says. A second case sends it as the check exits and asserts point 2.

Tests, in `S/run-mutate-check.test.cjs`:

- The existing case with the wait passes 50 times in a row under `stress-ng --cpu <cores>` or the same load.
- A signal sent as the check exits leaves every later entry `not run`, whether or not the next run started.

## Which part is the flow and which the host

All of it is the flow's. Nothing here is for the builder of the row on the host's side.

## Until it is built

On the host: a gate red only on this test, on a branch that changes no `.specsmd/` file, is an intermittent of the flow. Gate again with `run.cjs gate --tree <tree> --detach --cause "<why>" --by <who>`: the finalize commands whose proofs hold are not run again, so only `test:inferno` runs.
