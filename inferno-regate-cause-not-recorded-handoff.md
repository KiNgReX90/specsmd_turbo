# Handoff: a gate run again after a red finalize command records nowhere why, and the red run's log goes at ship

Found 2026-11-17 in Skoft_CRA, at the ship of the intent `the-definitions-layer-owns-its-models-and-calls-nothing-above-it` (shipped as `c9f5f0114`). Its final gate was red once on `npm run test:definitions`, on the flow's own test of row 0q, and green on the next gate of the same tree.

## What is wrong

A red finalize command with a known cause that is not the branch's work has one way on today: run the gate again. That is by design. `run-gate.cjs:140` reads `verification.flake_rerun` and ignores it, and "a failed command is red on its first failure: no rerun mints a proof". The gap is what the second gate leaves behind.

- The second gate is a new run in a new `gate-<stamp>` folder. Nothing ties it to the red run before it, and no option takes the reason it was run. The cause lives only in what the gate agent reported.
- A lane has this record and a command has none. `run.cjs <lane> --accept-intermittent --test <name> --reason <why> --by <who>` (`run-lanes-intermittent.cjs`) binds the accept to the lane proof, ship writes it into the merge commit as `exception: <lane> intermittent <json>`, and the third accept of one test is refused until a commit on the base carries `Fixes-intermittent: <test>`. A finalize command that was red and then green on the same code leaves no line anywhere, so the same flake can turn gates red intent after intent and the base never shows it.
- The red run's log is the only evidence, and it lives in the branch cache folder (`<cache>/<branch>/gate-<stamp>/<n>.log`). Ship removes that folder: the flow runs the host's `verification.ship_cleanup` (`run-ship.cjs`, `removeWorktree`), and without that key it names the folder as left over and asks for the key. So the flow treats the whole folder as a remnant, red logs included.

## Evidence

- `run-gate.cjs:140` to `143`: `IGNORED verification.flake_rerun: a red command stays red`. `run-gate.cjs:178`: every gate writes to its own `gate-${lib.stamp()}` folder, and nothing reads an earlier one.
- `run-lanes-intermittent.cjs`, header: the accept, the `exception:` line in the ship commit and the cap of two are all per lane. No call takes a finalize command.
- Alpha, after the ship: `~/.cache/specsmd-inferno/Skoft_CRA/inferno-intent/` holds no folder of the intent any more. The red run's log, `gate-20261117T124204Z/4.log`, went with it. What row 0q's handoff quotes from that log was read before the ship and is now the only copy.
- `git log -1 c9f5f0114` on the host's base: no `exception:` line, because nothing produced one.

## How to fix

Give a rerun of a red command the record a lane accept has, and keep its evidence out of the folder ship removes.

1. The gate knows when it is a rerun. When it starts, it reads the result of the last gate of the same branch. If that gate was red on a command and the code tree hash is the same as now, this gate is a rerun of a red command on unchanged code, and it takes `--cause "<why>" --by <who>`. Without a cause it still runs, and says in one line that a green result will carry no cause. A gate after a fix (the hash moved) is no rerun and takes no cause.
2. A green rerun stores the cause in its result and its proof: the command, the red run's folder, the tests the red run named red where the log gives them, the cause and the signer.
3. Ship writes it into the merge commit as one line, `exception: <command> rerun <json>`, read back from the base like the lane lines. The same cap holds: a test the base already holds twice as the cause of a rerun refuses the next one until a commit carries `Fixes-intermittent: <test>`. That is what makes a flake a row to fix and never a habit.
4. Before the cleanup runs, ship moves the red run's log out of the branch folder to a place the cleanup does not own, for example `<cache>/rerun-evidence/<branch>-<stamp>/<n>.log`, and names that path in the exception line. Only the log of the red command is kept, never the whole gate folder. A host's `ship_cleanup` then needs no change, since it removes the branch folder and nothing else of the flow's cache.

Tests, in `run-gate.test.cjs` and `run-ship-exception.test.cjs`: a gate after a red one on the same hash takes the cause and a green result carries it; a gate after a red one on a moved hash carries none; ship writes the `exception:` line and the kept log stands after the cleanup removed the branch folder; the third rerun for one test is refused until the fix line is on the base.

## Which part is the flow and which the host

The missing record and the missing cap are the flow. The delete itself is the host's `scripts/ship-cleanup.mjs` doing what the flow asks of a cleanup, so the host changes nothing once the flow moves the one log it wants kept.

## Until it is built

The session that runs the gate again writes the cause and the failing lines of the red log into the flow handoff of the flake before it ships, as happened for row 0q.
