# INFERNO: defects met in real work on a host, and still to build

One file for the defects a host session meets, newest last. Each section says what is wrong, the evidence and how to fix it. Nothing here is built on the host's account: the host works around it and writes the section.

Only what is still to build is in this file. A section leaves it once it is built, and `inferno-build-next.md` keeps its row with the commit. Sections 1 to 14 are built in 0.1.85 and gone from here, and the fourteen sections of the 0.1.83 file before them are built as 0.1.84. Their text is in this branch's history: sections 12 to 14 at `120be9b4`, sections 1 to 11 at `d5d82fa1`, and the 0.1.83 file at `912c9feb`. A section keeps its number, so the next one is 15.

One section is open: 15.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

## 15. An item that moves a file with `git mv` never gets a current proof, so its review is refused forever

**What is wrong.** `verify-item` writes the proof's paths from `changedPaths` (`S/run-gate.cjs:56-60`), which runs `git diff --name-only <since>` with git's default rename detection, so a moved file lists only its new path. `proofAtHead` (`S/run-item-proof.cjs:154-156`) lists what changed with `--no-renames`, so the old path shows up as a deletion that the item owns and the proof does not carry. Every `run.cjs review --item` then answers `verify-item owed ... was taken over an older state of its paths`, and `verify-item` writes the same proof again: a loop with no way out for any item whose spec asks for a `git mv`.

**Evidence.** Skoft_CRA, intent `the-lower-layers-stop-calling-up`, item `llu-process-facts-sit-below-the-store`, 2026-11-15, flow build f3be640a. The item moves `src-tauri/src/shell/child_env.rs` and `child_env_tests.rs` to `src-tauri/src/process/`. The proof's `diff.paths` held 29 paths; `git diff --name-only --no-renames <from> HEAD` held 31, the two extra being the two rename sources. Running `verify-item` with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=diff.renames GIT_CONFIG_VALUE_0=false` in its environment wrote a proof with all 31 paths, and `review` then printed the reviewer dispatch. That is the host's workaround.

**How to fix.** Make both readers list a move the same way: `changedPaths` passes `--no-renames` (a move then names both sides, which `itemFiles`, `sinceOutside` and the lane scopes all want: the old path's scope is what picked the journeys before the move). `hashOf` and `headDiffHash` already pass `--no-renames`, so the hash needs no change. Test: a scratch repo where the item `git mv`s an owned file, `verify-item`, then `review --item` prints the dispatch, not `verify-item owed`.

