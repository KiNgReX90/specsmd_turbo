# Handoff: `gate --wait` recomputes the proof key of every lane that has ended red on each 500 ms pass while the gate or another lane still runs, so the wait itself takes about half a core for as long as it lasts

Row 0ax. Met on the first host on 2026-11-21 by its test-manager on Delta, on the build at `a8873ebb`, and measured again on Alpha with the code the tip `e58e40bd` holds byte for byte. Row 0ak is a builder that waits by its own loop; this row is the runner's own wait.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of the tip.

## What is wrong

1. **The wait polls at 500 ms.** `waitAll` (`S/run-lanes.cjs:235-276`) reads the gate and every lane, then `jobs.sleepSync(500)` (`:275`) and goes round again until all have ended or the deadline comes. The queue wait beside it polls at `QUEUE_POLL_MS`, 5 s (`S/run-gate.cjs:241`, `:333`).
2. **A lane that has ended is judged again on every pass.** `describeLane` (`S/run-lanes.cjs:211-226`) computes the lane's proof key for an instrument red (`laneProof`, `:220`, for `readAccepted`), and `productRed` (`:199-208`) does the same for a product red (`:201`, then `readAccepted` and `proven`). Each key is `commandProof` (`S/run-proofs.cjs:150-158`): `revokeFlakeProofs`, then `scopeHash` (`:27-60`), which runs `git ls-tree -rz HEAD`, `git diff --name-only HEAD` and `git ls-files --others`, matches every row against the scope and hashes every dirty file in scope. The lane's result does not change once it is written, so every pass after the first repeats the same work.
3. **So the cost lands in the common case.** A lane that ended instrument red, accepted or not, or a held product red keeps the wait going (`unbounded` and `hold` are no exit, `:251-265`), and the gate and the other lane usually run for many minutes more. A running lane's pass is cheap by comparison, but `redLine` (`:157-170`) reads that lane's whole log on every pass.

## Evidence

- test-manager on Delta (Debian), 2026-11-21, its FLOW line verbatim: "`run.cjs gate --wait` costs 45% of a core for the whole wait (449 ticks in 10 s, pid 2983280 on Delta). waitAll (run-lanes.cjs:235-276) wakes every 500 ms and on each pass recomputes every lane's proof key: git ls-tree -rz HEAD, git ls-files --others and git diff HEAD, all sampled from its children. Fix: poll at QUEUE_POLL_MS (5 s) and compute each lane's key once per wait."
- The state that holds it, read on Delta read only at 2026-11-21 08:30Z (pid 2983280 had ended): the intent `the-product-page-wears-chapter-arcs`, `lane-windows-job.result.json` `instrument-red`, exit 11, written 07:13:21Z. A running lane computes no key (`laneState`, `S/run-lanes.cjs:173-187`), so the passes that cost are those after a lane ended red.
- One lane key, measured on Alpha (8 cores, load 1.6) at 2026-11-21 about 08:35Z with the host's installed scripts (`a8873ebb`, the same as the tip's `src/`) in a clean detached checkout of the host's `main` (14,312 tracked files) and the host's own `verification.windows` and `verification.smoke` scopes: 1,025 ms and 1,055 ms of wall time, 672 ms and 699 ms of the node process's own CPU, per `commandProof`, mean of five. At a 500 ms sleep, one such key per pass is about 0.67 s of CPU in every 1.5 s, which is about 45% of a core before the git children, the same as Delta's sample.

## How to fix

1. **A lane's verdict is computed once per wait.** In `waitAll`, keep each ended lane's `describeLane` result by its lane and run id, and compute it again only when its result file names another run. `laneProof`, `readAccepted` and `proven` then run once per ended lane per call of `gate --wait`.
2. **The wait polls at the queue's pace.** `waitAll` sleeps `QUEUE_POLL_MS` (moved to one owner that `run-gate.cjs` and `run-lanes.cjs` both read), capped by the deadline as `slotWait` does (`S/run-gate.cjs:333`). A lane's red line then ends the wait within 5 s, which is fine for a lane that walks for minutes.
3. **A running lane's red line is read from where the last pass stopped.** `redLine` keeps the byte offset of the run log per wait and reads only what was appended, with the line split across the boundary kept.

Tests, beside `S/run-lanes.test.cjs`, counting calls the way `run-attribution-fixture.cjs` does with `NODE_V8_COVERAGE`:

- With a fake gate job alive for 12 s and a lane result `instrument-red`, one `gate --wait --minutes 1` calls `commandProof` once, not once per pass, and prints the same lines as today.
- The same wait makes at most four passes in 12 s.
- A lane whose log gains its red line while the wait runs ends the wait with exit 2 within one poll, and a red line split across two passes is still found.

## Which part is the flow and which the host

All of it is the flow's. Nothing here is for the builder of the row on the host's side.

## Until it is built

On the host: when `gate --wait` reports a lane that has ended `INSTRUMENT RED`, `ACCEPTED` or held while the gate or another lane still runs, do not sit in `gate --wait`. Wait in the background for the pids it printed as still running, with `for p in <pids>; do tail --pid=$p -f /dev/null; done`, which costs nothing, and then call `gate --wait` once.
