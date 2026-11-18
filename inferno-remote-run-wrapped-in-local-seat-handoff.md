# Handoff: the runner takes a local build seat for work it sends to another machine

Built in `e659ab4a`, as row 0o of `inferno-build-next.md`. This file can be removed from the branch; its text stays in history.

Found 2026-11-17 in Skoft_CRA, during the `run.cjs review --reviewer` mutant batches of `the-definitions-layer-owns-its-models-and-calls-nothing-above-it`. The session ran on Delta. Two batches died with no verdict. The second one hung for the full 3600 s cap.

## What is wrong

`runShell` (`run-lib.cjs:354-374`) wraps every command that `isHeavy` matches in `claude-build`. `isHeavy` (`run-lib.cjs:336-339`) reads only the words. With a host whose `verification.session.run` is `remote-run.sh session run` (Skoft_CRA), a mutant or control run is `unset INFERNO_MUTANT; export INFERNO_TREE=...; ... remote-run.sh session run`, and the `cargo test` it names is data that remote-run carries to the target machine. So the runner takes the local heavy seat for work that runs elsewhere and queues on the target's own lock.

When remote-run picks the machine the session runs on, the remote `cargo test` queues for the heavy seat behind its own caller. The `CLAUDE_BUILD_WRAPPED` nested-call marker does not travel through remote-run, so the inner call cannot see it is nested. It is a self-deadlock that ends only at claude-build's 3600 s run cap.

On Alpha this was masked since 2026-11-06, because Alpha's `claude-build` puts commands that go through `remote-run.sh` in a no-seat `remote` arm. Delta's copy lacked that arm until 2026-11-17 06:15 UTC. Omega and Beta (WSL) lack it today (`grep -c ARM=remote ~/.local/bin/claude-build` gives 0 on both). So the defect recurs on any host whose wrapper is older than Alpha's.

## Evidence

All on Delta. `/tmp/claude-build.log` mixes zones: the outer wrapper logs in EST and the inner call in CET.

- Batch `mutate-batch-20261117T054628Z-1451438`: its own control wrapper pid 1452375 (`bash -c unset INFERNO_MUTANT; ...`) took `heavy` at 05:46:40Z. The control's inner `cargo test ... rule_updates::trust_tests`, pid 1452455, logged `heavy still queued ... holder: pid 1452375` every 300 s. At 06:46:40Z the cap killed the holder (`heavy KILLED after 3600s run cap`). The control log ends `the command has not started` and `remote-run: ... wall 3600s`. Log: `~/.cache/specsmd-inferno/Skoft_CRA/inferno-intent/the-definitions-layer-owns-its-models-and-calls-nothing-above-it-20261116T174943Z/mutate-batch-20261117T054628Z-1451438-control-1-1.log`.
- The batch before it, `mutate-batch-20261117T053631Z-1441150`, made the same nesting. Wrapper 1447876 held heavy while its inner pid 1447956 queued. It was stopped by hand after 398 s (`remote-run: exit 143 after 398s`).
- After Delta's wrapper got the remote arm, the same control runs log `remote started, run cap 39600s` with the inner `cargo test` acquiring heavy after 0s (07:48 CET onward, batch `20261117T064715Z-1469281`).
- The relay that brought this in read it as "a killed foreground run leaves an orphan holding the seat, and the rerun queues behind it". The log does not support that. In both batches the holder is the batch's own wrapper (same second as its `host-session-open`). Batch 1's inner waiter got the seat for a moment as its stopped parent released it. It was gone within 21 s, because batch 2's wrapper then took the seat after 0 s.

## How to fix

In `runShell`, never wrap a command that hands its work to remote-run: when the command contains `remote-run.sh` (or a host's `rr.sh` snapshot of it), run it with plain `bash`, the same as `wrap: false`. The target machine queues the real work on its own lock. A local build chained in front of the remote call (`npm run build && bash .../remote-run.sh ...`) is the one case that still needs the seat. So either split on the first `remote-run.sh` and test only the words before it, as Alpha's `claude-build` does, or keep the runner's remote commands free of a local prefix.

Pin it with a fixture: a fake `claude-build` on PATH that records its calls. A mutant command that routes through `remote-run.sh` must never reach it, and a plain local `cargo test` must still be wrapped.

## Built

Built on this branch in `e659ab4a`, by what the host's config says and not by the wrapper's name. A test the host's wrapper carries takes no seat on this machine's build wrapper: a mutant's test in a `mutate.session`, one placed through `mutate.run` (in a batch and alone), and an item's check placed through `verification.run`. The commands of a `verification.session` already ran that way. `runShell` still queues by its words every command that runs here.

Left as it is: an integrate or gate command that a host writes out with its wrapper, without a `verification.session` whose match reaches it, still takes a local seat. No config key says such a command is carried.
