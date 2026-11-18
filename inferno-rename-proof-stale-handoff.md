# Handoff: a proof over an item that renames a file is stale the moment it is written

Built in `1248629b`, as section 15 of `inferno-0.1.84-run-defects-handoff.md`, in section 1f of `inferno-build-next.md`. This file can be removed from the branch; its text stays in history.

Found 2026-11-16 in Skoft_CRA, while building `the-definitions-layer-owns-its-models-and-calls-nothing-above-it` (item `dlm-the-engine-tests-leave-the-requirement-tree`, a `git mv` of one test file).

## What is wrong

`run.cjs verify-item` writes the proof's `diff.paths` from `changedPaths` (`run-gate.cjs:56-60`), which runs `git diff --name-only <since>` with the user's rename detection, so a renamed file appears at its new path only. `proofAtHead` (`run-item-proof.cjs:136-162`) then lists the item's changes with `git diff --name-only --no-renames <from> HEAD` (`:154`), which names the old path as deleted as well. The old path is owned by the item, is missing from `diff.paths`, and `:156` returns `stale`. So `run.cjs review --item` answers "verify-item owed ... taken over an older state of its paths" forever, however often verify-item runs.

## Evidence

- Skoft_CRA intent branch at e5968d314: `git diff --name-only --no-renames 4084d7255 HEAD` names `src-tauri/src/wizard/definitions/remedy_tests.rs`; the proof's `diff.paths` does not.
- Every move item hits it: the same intent still has the requirement tree (12 files), the template tree (18) and the intake files to `git mv`, and candidate 4 of the route moves more.

## Workaround used

Run verify-item with rename detection off for its git children: `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=diff.renames GIT_CONFIG_VALUE_0=false node run.cjs verify-item ...`. The proof then lists both paths and the review dispatch goes out.

## How to fix

Pass `--no-renames` in `changedPaths` (both the gate's and the proof's readers then agree with `DIFF_FLAGS`), or make `proofAtHead` read its list with the same flags `changedPaths` uses. Pin it with a fixture item that `git mv`s one owned file: verify-item, then review, must print a dispatch, not "verify-item owed".
