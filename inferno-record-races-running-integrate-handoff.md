# Handoff: a review record started while an integrate or a gate runs on the same tree plants its mutants under that run's checks, since a running record keeps the other steps out but nothing keeps a record out of a running integrate or gate

Row 0at. Met on the first host on 2026-11-21 by the Beta session of `the-lane-machine-and-lint-scripts-prove-every-refusal`, on the build at `a8873ebb`, and read in the code there; the tip `d46c3ae5` holds the same `src/`. Row 0am is the other face of the one tree: a builder's uncommitted edits ahead of an integrate. This row is a record's mutants inside a running integrate.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `a8873ebb`.

## What is wrong

1. **The guard runs one way.** A record job keeps `verify-item`, `integrate` and `gate` out of its tree while it runs (`KEPT_OUT`, `S/run-review-job.cjs:43`; `refuseRacing` `:63-68`; `keepOut` `:71-73`, called before every step at `S/run.cjs:256`). Nothing refuses the record itself, foreground or `--detach`, while an integrate or a gate already runs there. The file's own reasoning, "a caller blocked on the record started nothing beside it" (`:16-17`), holds for one shell and not for a session that runs an integrate in the background and records reviews meanwhile.
2. **An integrate leaves no sign that it runs.** A detached gate and its lanes have job files (`S/run-jobs.cjs:19-28`); a foreground integrate or gate has none a record could read.
3. **A builder's edits do the same.** A builder dispatched or sent a correction while an integrate runs edits files that integrate's checks read, and nothing in `dispatch-log` asks whether one runs. Integrate refuses dirt a check reads only when it starts (`S/run-integrate.cjs:255-261`) and finds the change only at its end, as no verdict (`S/run-proofs.cjs:188`, "verification inputs changed").
4. **The mutants change the files the running checks read.** The batch writes each mutant into the tree in place and puts it back after (`S/run-mutate-batch.cjs`). A check that runs meanwhile reads the mutant: a red that is not the branch's work, or a check whose inputs changed under it.

## Evidence

- The Beta session's WASTE line, 2026-11-21, verbatim: "I recorded item reviews while an integrate ran on the same tree, and review mutants edit the tree in place, so integrate's test:definitions went red on a mutant (scanner-store.mjs existsSync dropped) and verify:site said its inputs changed | lost: 0.7 | fix: run.cjs review --detach should refuse while an integrate or gate holds the tree, and integrate should refuse while a mutate batch runs there; I now serialize them by hand".
- The Omega session of `the-flow-logs-its-day-and-an-evening-reader-finds-what-went-wrong`, 2026-11-21, verbatim: "WASTE a hook-item integrate ended \"verification inputs changed\" because a digest builder edited scripts/flowlog/ under it | lost: 0.2 h | fix: no correction inside an integrate check scope goes to a builder while an integrate runs on the tree (held from now on); same rule as 0at for records".
- The second half of the session's fix already holds: integrate, verify-item and the gate are refused while a record job runs (point 1). What it met is the first half.
- Cost: 0.7 h on Beta and 0.2 h on Omega, a red integrate whose red was a planted mutant and a site check that read changed inputs. Every session that pipelines a record beside a running integrate meets it.

## How to fix

1. **A running integrate and gate mark the tree.** Integrate and a foreground gate write a job file beside the gate's (`integrate-run.json`, `gate-run.json`: pid, started, command) for the length of their checks and remove it at the end; a dead pid reads as not running, as `jobs.alive` reads a job.
2. **A record refuses while one runs.** A `review` call that would run mutants (one that records: with `--reviewer`, or a job's own run) and a `mutate` call refuse with `TREE_BUSY` while an integrate's or a foreground gate's mark, a gate job or a lane job is alive in the tree, naming what runs and how to wait for it (the gate's `--wait`, or the integrate's pid and start). A `review --detach` refuses before it starts its job. The dispatch-only `review --item` call stays free, since it plants nothing.
3. **A builder waits too.** `dispatch-log`, for a new item or a correction, refuses with `TREE_BUSY` while an integrate's or a gate's mark is alive and the dispatch's ownership (its editable paths and grants) meets what that run's checks read (`checksRead` and `dirt.reads`, `S/run-integrate.cjs:258-259`), naming the wait. And integrate refuses to start while an open dispatch, one logged and not yet accepted, owns a path its checks read, since that builder may still write it.
4. **The guard is one table.** `KEPT_OUT` and the new refusal read one map of which step keeps out which, so both directions are tested together.

Tests, beside `S/run-review-job.test.cjs`:

- With a gate job running a slow finalize command, `review --item <id> --reviewer <id>` and `review ... --detach` exit with `TREE_BUSY` and plant nothing; after the gate ends both record.
- With an integrate running a slow check in a child process, the same.
- `review --item <id>` with no reviewer, the dispatch, prints as today beside a running integrate.
- With an integrate running whose checks read `scripts/a/`, `dispatch-log` of an item that owns `scripts/a/x.mjs` exits with `TREE_BUSY`, and of an item that owns only `docs/b.md` is logged.
- An integrate whose checks read a path an open dispatch owns refuses to start, naming that dispatch.

## Which part is the flow and which the host

All of it is the flow's. Nothing here is for the builder of the row on the host's side.

## Until it is built

On the host: never record a review (`review --reviewer`, `--detach` included), run `mutate`, or send a builder a dispatch or a correction whose files that run's checks read while an integrate or a gate runs on the same tree. Wait for its exit, then record or dispatch.
