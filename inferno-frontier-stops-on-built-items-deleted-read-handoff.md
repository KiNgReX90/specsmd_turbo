# Handoff: the frontier stops on a built item whose own commit deleted a file its `context.required` names, so nothing is ready until that item is integrated

Met 2026-11-18 on Skoft_CRA, intent `candidate-1-the-ground`, on the build at `f3be640a`. The code is the same at the branch tip `f0f06aaf`: `S/run-manifest-paths.cjs` and `S/run-frontier.cjs` are byte-identical, and `S/run-plan-lint.cjs` differs only in texts and the `Tester proves:` check.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

## What is wrong

`pathErrors` (`S/run-manifest-paths.cjs:58-77`) holds an item to this: every path under `context.required` and `reads` exists on disk, unless an item it depends on owns the path and has not completed. Its header says when that is meant: "before the item is dispatched".

Both callers make the check for every item that is not completed or deferred, whether a builder already took it or not:

- `lintPlan` (`S/run-plan-lint.cjs:375` and `:392-393`), which `run.cjs frontier` runs first (`S/run-frontier.cjs:178-179`) and prints as `FINDING`;
- `contractErrors` (`S/run-frontier.cjs:153-164`, the call at `:161`, over the items of `loadItems`, `:81-84`), which prints `INVALID`.

An item stays `pending` in the ledger from its dispatch until its integrate completes it. In that window its tree is the tree after its own build. An item that moves a harness out of a file and deletes the file has to read that file first, so its plan names it under `context.required` and under `ownership.editable`, and that plan is right: the file exists at plan time and at dispatch. Once the builder commits the deletion, `fs.existsSync` (`:64`) is false, no dependency owns the path, and the check reports a plan finding against an item that was built to the letter of that plan.

`frontier` then exits 2 with that one line and offers nothing. Every other item of the intent that is ready waits, though none of them reads the file.

The frontier already knows both halves of this elsewhere:

- `S/run-frontier.cjs:188-191`: "A completed item is never re-validated ... its manifest names the tree of the day it landed, and re-reading it fails on a file the item itself deleted."
- `S/run-frontier.cjs:199-210`: a diagnosis probe is replayed only for an item nobody dispatched or reviewed (`startedItems`, `:133-150`), since "the stale probes of three built items stopped the whole frontier and hid the two truly ready" (2026-11-10).

The existence check has neither exception.

## Evidence

Delta (`ruben@100.82.4.124`), tree `~/dev/Skoft_CRA-inferno-candidate-1-the-ground`, read 2026-11-18 13:30Z to 13:40Z. All times UTC.

- The item's spec, `.specs-inferno/intents/candidate-1-the-ground/work-items/c1g-one-test-door-registers-every-command.md`, written by the plan commit `904fe84ab` of 2026-11-15. Its manifest names `src-tauri/src/commands/wizard/tests/native_transport.rs` as the first entry of `context.required` ("the harness, its seed, its stdio entry and its four journey cases") and again under `ownership.editable`. Its description moves the harness to `commands/door_tests.rs`, and its last criterion is `git grep -n "native_transport" -- src-tauri e2e src | wc -l` shows 0. The plan orders the deletion.
- The dispatch log (`~/.cache/specsmd-inferno/Skoft_CRA/dispatch/candidate-1-the-ground.log`): the item was dispatched at 2026-11-17 17:50:07Z, as one chain with `c1g-every-command-runs-on-any-tauri-runtime`, dispatch `aefc55ca`.
- The item's commit `1cfe77411` of 2026-11-17 19:34:20Z: `git show --name-status` reads `D src-tauri/src/commands/wizard/tests/native_transport.rs`, beside the three new files under `commands/door_tests`.
- The ledger at HEAD `0aa41720f` (2026-11-18 13:19:50Z), `.specs-inferno/state.yaml:485-490`: the item's `status: pending`. Its review file was written at 13:20:21Z.
- The session's `run.cjs frontier candidate-1-the-ground` exited 2 with:

```
FINDING c1g-one-test-door-registers-every-command: context.required path does not exist: src-tauri/src/commands/wizard/tests/native_transport.rs, and no item c1g-one-test-door-registers-every-command depends on owns it
```

That is the text of `S/run-manifest-paths.cjs:68-71` for a missing path with no owner among the item's dependencies: its one dependency, `c1g-every-command-runs-on-any-tauri-runtime`, names the file under `context.patterns` and owns no part of it. The prefix `FINDING` says it came through `lintPlan`, before `contractErrors` could say the same as `INVALID`.

The installed flow there: `flow.lock` reads `source_commit: f3be640a...`.

## How to fix

The existence check holds an item until a builder took it, and no longer.

1. `pathErrors` is made only for an item that has not started. Started is what `startedItems` already reads for the probe replay: a line in the dispatch log, a `review` field, or a review file. Move that function beside `pathErrors` in `S/run-manifest-paths.cjs`, so `lintPlan` and `contractErrors` ask the same question.
2. `run.cjs plan-lint` at plan time is unchanged: nothing has started, so every cited path is checked as today.
3. The dependency exception stays as it is for an item that has not started.

If the wider rule is not wanted, the narrow one closes this case as well: a started item's missing path is no error when its own `ownership.editable` covers it. It leaves one hole, a started item that reads a file a sibling was right to delete, and that stops the frontier the same way.

Tests, in `run-frontier-created.test.cjs` and `run-plan-lint.test.cjs`:

- an item whose `context.required` names a file it owns is dispatched (a line in the dispatch log), its commit deletes the file, and it is not completed: `frontier` exits 0 and still offers a second, independent item as ready, and `plan-lint` has no finding for it;
- the same for a path under `reads`;
- the same item with no dispatch line and no review, and the file missing: refused as today. The case at `run-frontier-created.test.cjs:61`, "an item whose own file does not exist yet is still refused", stays green;
- once that item is completed, nothing changes: it is not read at all, as today.

## Which part is the flow and which the host

All of it is the flow. The host's plan is right, and plan-lint passed it when it was written: an item must name the file it empties as required reading, and it must own the file to delete it. No planner rule should tell a plan to leave such a file out of `context.required`, since the builder would then move a harness it was never told to read.

## Until it is built

When `frontier` exits 2 with "path does not exist" for an item that is already built, and that item's own commit deleted the path (`git log --diff-filter=D --format=%h -- <path>` names it), integrate that item first: the integrate completes it and takes it out of the check. The next builders wait for that integrate. Change nothing in the plan.
