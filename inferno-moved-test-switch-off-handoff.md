# Handoff: verify-item reads a moved test file's existing switch-off as a new one

Found 2026-11-16 in Skoft_CRA, while a cold check reviewed the plan of `every-inventory-is-filed-through-one-store-register` before it was built.

## What is wrong

`run.cjs verify-item` fails an item whose diff adds a switch-off line (`#[ignore]`, `.skip`, `@Disabled` and the like) to a test file. It diffs with `--no-renames` (`run-item-proof.cjs:74-75`), so a test file the item moves (`git mv a_tests.rs b/a_tests.rs`, content unchanged) reads as `D` at the old path and `A` at the new one. Every line of the new path is "added", and an `#[ignore]` the file already carried on main is reported as `switched off: <new path>:<line>` (`run-item-proof.cjs:280-298`, `:432-435`, markers in `run-test-files.cjs:40-50`). The item fails, though it switched nothing off.

The fold-range exception (`baseLines`, `run-item-proof.cjs:290-291`) does not help: it only covers ranges a fold brought in.

## Evidence

- Skoft_CRA `reg-the-scanner-database-setup-lives-in-the-watch` moves `src-tauri/src/storage/sbom/scan/database_setup_tests.rs`, whose line 390 is `#[ignore]` on `browser_watch_setup_session` (run on purpose with `--ignored` by `e2e/watch-setup.spec.ts:19`). A correct build of that item cannot pass verify-item.
- The same class waits in the planned "Candidate 4, the moves" (`import/import_tests.rs:1408`, `scan/sidecar_tests.rs:183`).
- Workaround used in the plans: replace `#[ignore]` with an env-gated early return before the move. That changes a test's shape only to satisfy the tool.

## How to fix

In `readDiff`, detect renames for test files only (a second `--name-status -M` pass, or `--find-renames=100%` for exact moves), and for a test file that is the destination of a rename, read switch-off lines against the source path's content at `from`: a marker already present on the same test function at the source is not new. Pin it with a case where a moved file keeps its `#[ignore]` (passes) and one where the move adds an `#[ignore]` (fails).
