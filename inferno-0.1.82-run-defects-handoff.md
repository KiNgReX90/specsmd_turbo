# INFERNO 0.1.82: defects met in real work on its first host

Met from 2026-11-10 on, on Skoft_CRA, after the 0.1.81 to 0.1.82 reinstall. Each one was worked around there, and none is built here. New ones are added at the end. `S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

## 1. An item that owns a file under `.specs-inferno/` can never be reviewed

What is wrong. `itemFiles` in `S/run-item-proof.cjs` (:269-275) leaves every path under `.specs-inferno/` out of the proof's `paths`. `proofAtHead` in the same file (:110-119) then lists what changed since the baseline and is owned by the item, without that filter, and answers `stale` when one of those is missing from `paths`. So an item whose `ownership.editable` names a file under `.specs-inferno/`, a host config for instance, and changes it, has a proof that is stale the moment it is written. `review --item` answers "verify-item owed" after every green `verify-item`, with no way out.

Evidence. Intent `the-installers-carry-their-notices-and-the-release-checks-its-own-duties`, item `r4r-every-installer-carries-its-licence-and-third-party-notices`, whose editable list named `.specs-inferno/config.yaml` and `.specs-inferno/config.codex.yaml`, because the item adds a finalize scope. Worked around in the host's commit `f65d6e1ac` by taking the two config files out of the item's ownership.

How to fix. Hold both sides to one rule. Either `proofAtHead` drops the paths under `.specs-inferno/` from `changed` before it compares, or `itemFiles` keeps the ones the item owns. The first matches what the recorder already says, that the ledger is never part of the code a review binds. Then say in the planner text which of the two a plan may do: an item may own a host config, or a config change is the orchestrator's own commit. A test: an item that owns `.specs-inferno/config.yaml` and one source file changes both, `verify-item` passes, and `review --item` dispatches a reviewer.

## 2. Output over 64 KiB is cut when `run.cjs` writes to a pipe

What is wrong. `S/run.cjs` writes its result with `process.stdout.write` (:254-256) and then ends with `process.exit` (:263-277). On a pipe Node writes without waiting, so whatever has not left the buffer when the process exits is lost. An orchestrator that pipes the output, to `tail`, to `cut` or to a JSON reader, loses the end of a long answer, and the end is where the next step is printed.

Evidence. `review --item` for the item of section 1 printed a range of about 500 paths, 75,089 bytes in all. Piped, it lost the `write` line of the quality dispatch and the closing `then` line, and with `--json` the JSON had no end. Redirected to a file, all of it arrived.

How to fix. Set `process.exitCode` and let the process end by itself, or exit from the callback of the last `stdout.write`. A test: a result larger than 64 KiB, read through a pipe, arrives whole and its last line is the `then` line. Beside it: a dispatch that prints 500 paths is more than a reviewer's brief should carry in text, so print the count and write the list to a file the dispatch points at.
