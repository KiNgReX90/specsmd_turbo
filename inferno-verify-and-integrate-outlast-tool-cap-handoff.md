# Handoff: `verify-item` and `integrate` have no detach-and-wait form while `gate` and `review` do, so a call whose checks or real-app prove run past two hours outlasts the agent's tool call cap

Row 0bo. Met on the first host on 2026-11-24 and 2026-11-25 on Delta, in two sessions, on the build installed there, `a8873ebb`. The tip holds the same `src/`.

## What is wrong

`S/` below is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

1. **Two long steps only block.** `verify-item` runs the item's own check and, on a host that sets `real_app.prove`, the real-app prove of the journeys the item changed (`proveItem`, the run at `S/run-real-app-prove.cjs:64`). `integrate --item` folds the base and runs every integrate command. Each returns only when its last command ends (usage `S/run.cjs:59-60` and `:71-73`).
2. **`gate` and `review` have the form.** `gate --detach` starts the gate as its own process, and `gate --wait` blocks at most `--minutes` (default 9) and exits 4 while it runs (`S/run.cjs:78`, `:83`, `:127`). `review --detach` and `review --wait` do the same for a record (`:67-68`, `S/run-review-job.cjs`). Only `S/run-gate*.cjs`, `S/run-review-job.cjs` and `S/run-snapshot.cjs` read `options.detach` or `options.wait`.
3. **The orchestrator calls run.cjs through a tool with a call cap.** A Claude Code Bash call ends at its timeout, two hours on the first host (7200000 ms). The tool then moves the call to the background and stops it after two more hours. A headless session can lose a background command when its turn ends, so the first host refuses `run_in_background` with a hook. A step that runs past the cap either loses its answer or has to be waited on by hand.
4. **The steps now run that long.** On the first host a real-app prove walks the item's journey files and their can-fail mutants on the real binary. Since the host's lane gives the machine lock to waiting runs between walks (`5ab96a3a5`), one prove of one journey file took 5926 s and another 7075 s.

## Evidence

All on Delta, read from the sessions' transcripts in `~/.claude/projects/-home-ruben-dev-Skoft-CRA/`:

- **Checklist session, transcript `2b3bbac2`.** `verify-item cca-the-checklist-opts-into-signal-arc` started 2026-11-24T15:44:34Z in the foreground with timeout 7200000. At 17:44:34Z the tool answered: "Command did not complete within its 7200s timeout and was moved to the background (ID: bpoo67qqe). ... If it is still running after 2h in the background, it will be stopped". The session ran the same call again at 18:00:23Z (5929 s, `PASS 5926s real_app.prove`) and at 21:07:45Z (7079 s, `PASS 7075s real_app.prove`), which returned 121 s under the cap.
- **Vuln-policy session, transcript `8a800496`.** `integrate --item` started 2026-11-24T18:01:05Z. At 7201 s the tool moved it to the background (ID `b4c0y17ys`). Its log closed at 20:04:47Z with "1 of 21 integrate command(s) failed".
- **Checklist item 2.** `verify-item cca-the-checklist-stands-in-products-frame` started 2026-11-25T01:46:12Z in the foreground. The host's hook had refused `run_in_background` with "In this headless session a background command is stopped when the turn ends on some claude versions (an integrate died this way on 2026-11-23)". At 03:39:11Z the call was still running (pid 3038305, 6778 s).
- **A session's own guard.** Transcript `ac78d274`, a third intent, wraps its `integrate --item` in `timeout 7100` (2026-11-25T02:20:56Z). That guard kills a longer integrate and loses the run.

## How to fix

1. **`verify-item --detach` and `integrate --detach`.** Each starts the step as its own process in the tree, as `review --detach` starts a record (`S/run-review-job.cjs`). It writes the step's lines, payload and exit code where `--wait` reads them, and it refuses a second start while one runs in the tree (exit 2). `verify-item --wait` and `integrate --wait [--minutes <n>]` block at most n minutes (default 9, as `gate --wait`). They exit 4 while the step runs, and otherwise print its lines and exit with its code.
2. **The procedure names the pair.** Wherever the orchestrator text runs `verify-item` or `integrate`, it runs `--detach` and then `--wait` until the exit is not 4.
3. **The tests.** Beside the tests of `verify-item` and `integrate`: give the host a check that sleeps past a `--wait` of a fraction of a minute. Then `--detach` returns at once, `--wait` exits 4 while the check runs and afterwards exits with the step's own code and prints its lines, and a second `--detach` while one runs exits 2.

## Until it is built

A `verify-item` or `integrate` that the tool moves to the background is waited on by its log's closing line and never stopped. No session wraps either in a `timeout` shorter than the step. How long the prove takes on the first host (machine lock waits and yields, the walks of earlier items' mutants) is the host's concern, not this row's builder's.
