# Handoff: run.cjs keeps no journal of its own calls, and its detached jobs record their start and end only in the branch folder ship's cleanup removes, so what a run did can only be rebuilt from transcripts, where a runner's exit is mostly invisible

Row 0ap. Asked on the first host on 2026-11-20 by an oracle (Fable 5.2, effort xhigh) that designed a temporary capture of the flow on the host's three machines, after an observer of the shipped intent `candidate-1-the-ground` found the run's own logs gone and took every duration from the orchestrator's transcript. The oracle measured it on the host; the code below is read at `a8873ebb`, whose `src/` the tip `d4a64f2f` holds byte for byte. The host builds a stand-in meanwhile (below), which leaves when this is installed.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

## What is wrong

1. **A call leaves no record of itself.** `main`, `finish` and `fail` (`S/run.cjs:231-283`) print the answer and exit (`S/run-exit.cjs:17-19`). Nothing writes the step, its argv, the tree, the branch and head, the exit, the time it took, the error code or the next call it printed. The only files a step appends to are the dispatch log (`S/run-intents.cjs:369`) and a check session's log (`S/run-check-session.cjs:88`). A check's seconds are measured (`call`, `S/run-host-session.cjs:51-53`) and reach only the printed line.
2. **The detached jobs keep their times in the branch folder.** The gate's and each lane's job, result and log files (`jobPaths`, `S/run-jobs.cjs:19-28`, `started` at `:84`) and the review record's job (`S/run-review-job.cjs`) sit in `stateDir`, which is `<cacheDir>/<branch>` (`S/run-state-dir.cjs:43`, `:56`, `:62`). That is the folder ship asks the host to remove (`S/run-ship.cjs:189-190`, "set verification.ship_cleanup to remove it"). After ship nothing says when a gate, a lane or a record started, ended, or how it exited.
3. **A transcript cannot stand in for it.** The model's shell sees the pipeline, not the runner: a call piped to `head` or `tail`, run in a loop, spelled through shell variables or sent to the background reports the shell's status, not the step's.

## Evidence

Measured on the first host on 2026-11-20 by the oracle, by script over the orchestrator transcript of `candidate-1-the-ground` (`779d3570-db74-4eb4-8504-9da390a586e2.jsonl`, 52 h on Delta):

- 190 Bash calls named the runner. 1 came back flagged as failed, 14 printed `ERROR [` under a result not flagged, 145 spelled their arguments through shell variables, 43 held more than one call, 57 ran in the background and 13 could not be parsed. In the day's other stream, 26 of 43 runner calls were spelled through `$R`.
- A scratch preload under `NODE_OPTIONS` on the real `run.cjs`: `node $R probes | head -1`, a loop over `help` and `nosuchstep`, and `plan-lint` with `$I` journalled exits 1, 0, 1 and 2 with their resolved argv, while the shell pipeline's status was 0.
- The run's folder went at ship. Transcript 2026-11-19 20:07:41Z: `local removed /home/ruben/.cache/specsmd-inferno/Skoft_CRA/inferno-intent/candidate-1-the-ground-20261117T151840Z` (the host's `scripts/ship-cleanup.mjs:233`). The observer of 2026-11-20 found that source empty.
- Cost: one observer read of one intent from its transcripts took 4.79M input tokens on 2026-11-20; the oracle's design targets 150k an evening once a journal exists. Until this row is installed, the host carries a node preload on three machines that journals each runner call from outside (`scripts/flowlog/`, built as a host intent), and a step of the flow that changes its argv or its output shape can break it unseen.

## How to fix

1. **A journal outside every branch folder.** `<cacheDir>/journal/<UTC day>.jsonl` (`lib.cacheDir`, `S/run-lib.cjs:370-373`), which a host's cleanup of `<cacheDir>/<branch>` leaves standing. One JSON line per call, appended whole, from `finish` and `fail` in `S/run.cjs` and from the promise path of a batch mutate: `t` (UTC, ms), `step`, `argv` (each cut to 200 characters, a `--changed-paths` list as its count), `tree`, `branch`, `head`, `exit`, `ms`, `code` (the `ERROR [CODE]`), `err` (its first 300 characters) and `next` (the call the step printed as `then`), and per check its command, start, end, `seconds` from `call` and its log path. A host may set `verification.waited`, a regex for its wrapper's wait line; up to three matching lines of each check's log ride that check's entry, since the log goes at ship.
2. **The detached jobs write their own lines.** The gate job, each lane job and the review record's job write `started` (pid, job, tree, branch, head) and `ended` (exit, ms, result path) to the same journal.
3. **It never costs a step.** A write that fails is dropped in silence. A day file stops at 8 MB with one `capped` line, files older than 14 days go at the first write of a day, and `SPECSMD_INFERNO_JOURNAL=off` writes nothing. The flow's own fixtures set `XDG_CACHE_HOME` to a temp folder, so its tests journal there.

Tests, beside `S/run.test.cjs` and `S/run-gate-cli.test.cjs`, with a journal suite of their own:

- `run.cjs nosuchstep`, `run.cjs help` and a refused `plan-lint` each write one line with exits 1, 0 and 2 and the refusal's code, also when the caller pipes the output to `head -1`.
- A `gate --detach` writes `started` and, when the job ends, `ended` with its exit, and both lines stand after the branch folder is removed.
- A journal folder that cannot be written changes no step's output or exit.
- `SPECSMD_INFERNO_JOURNAL=off` writes nothing.

## Which part is the flow and which the host

The journal is the flow's: its steps and its jobs know what they did, and only a fragile preload can learn it from outside. The host's part, not for the builder of the row: at the install the host removes its preload (`scripts/flowlog/`) and points its digest at `<cacheDir>/journal/`, and sets `verification.waited` for `remote-run.sh`'s wait line if it wants the waits.

## Until it is built

On the host: the temporary preload journals each runner call, and the host's ship cleanup stays as it is. Nothing changes for a session.
