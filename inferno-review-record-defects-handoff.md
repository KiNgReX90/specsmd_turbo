# Handoff: four defects met while orchestrating one intent's item reviews

Found 2026-11-16 in Skoft_CRA, orchestrating `the-advisory-rules-move-down-and-the-feed-memory-moves-up` (four move items, every one of them deletes or renames files). Each was worked around in the run; none blocked it.

## 1. The review dispatch lists deleted paths, and the record refuses them

### What is wrong

`run.cjs review` prints the item's `paths` with every file the range deleted, and its JSON `gone` stays `[]`. The reviewer copies `paths` into `files:` as told. The record then refuses: `BAD_REVIEW ... files lists src-tauri/src/vuln/checkability.rs, which is not in the tree; list only files the tree holds, never one the change deleted`. Both lenses hit it.

### Evidence

- `run.cjs review --item arf-the-checkability-rule-moves-under-the-store --json` on 37c3117e0..ef595edfc: `paths` holds `src-tauri/src/vuln/checkability.rs`, `src-tauri/src/vuln/checkability/public.rs`, `src-tauri/src/vuln/osv_registry_hosts.json` (all three moved with `mv`, git shows R100), `gone: []`.
- Each reviewer had to be sent back to delete three lines from `files:`.
- On a delta review the JSON does name the deletion in `gone` and still lists it in `paths`: `run.cjs review --item arf-the-osv-cache-and-nvd-answers-move-into-the-watch --json` over 004e7fefe..36b5afc1e printed `gone ["src-tauri/src/storage/sbom/repository_feed_memory.rs"]` with the same path in `paths`.

### How to fix

Split the range's paths by `git diff --name-status --no-renames`: deleted ones go to `gone`, never to `paths`, in both the contract and the quality dispatch. Pin it with a fixture whose item deletes a file.

## 2. A review recorded after a later commit hides the correction committed in between

### What is wrong

The record stamps `review_commit` with HEAD at record time, not with the commit the reviewer read. When a correction is committed before the record (here because the record could not run yet), the runner reads the finding as still open and owes no delta: `step` (`run-review.cjs:326-351`) computes `touched` from `review_commit`, which is already past the correction.

### Evidence

- The contract review read 37c3117e0..ef595edfc and found one major finding. The correction e7f786f06 and the next item's ddd43525a were committed before the record could run. It recorded `fix, recorded at ddd43525a`, then printed `send every finding to the warm builder ... then commit and run review again`, although the fix was already in.
- The quality lens was then owed over `ddd43525a..7fc632d1f`, a range that misses e7f786f06.
- Worked around by sending the delta review over ef595edfc..HEAD by hand.

### How to fix

Record the commit the review read (the end of its range, which the dispatch knows) as `review_commit`, and keep HEAD only as the record's own commit. Pin it with a case where a commit on the item's paths lands between the dispatch and the record.

## 3. verify-item's proof omits a committed rename's source, so it always reads stale

### What is wrong

`verify-item` builds the proof's paths from `changedPaths` (`run-gate.cjs:56-60`, `git diff --name-only <since>`), which detects renames, so a committed rename lists only its destination. `proofAtHead` (`run-item-proof.cjs:154`) lists changed paths with `--no-renames`, which names the deleted source too. Once the item's rename is committed, `changed.some((entry) => !paths.includes(entry))` is true on every verify, and the settle of a minor finding refuses forever: `settle owed ... but the item changed since its verify-item proof`.

It only shows on a verify run after the rename is committed. The first verify of an item runs over uncommitted work, where the source is a plain deletion and the destination untracked, so it passes.

### Evidence

- `arf-the-exploitation-catalogue-moves-into-the-watch`, after its minor correction ee2311e98: `git diff --name-status 31df31092 HEAD` shows `R066 src/lib/wire/types/storage-sbom-catalogue-refresh.ts -> vuln-feed-memory-catalogue.ts`. A fresh verify-item at HEAD wrote 25 paths without the source; `proofAtHead` reported `stale`, the only path outside the proof being that source.
- Worked around by running verify-item with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=diff.renames GIT_CONFIG_VALUE_0=false`; the settle then went through.

### How to fix

Add `--no-renames` to the diff in `changedPaths` (or in `itemFiles`, `run-item-proof.cjs:308`), so both sides read the same path set. Pin it with a proof taken after a committed rename that `proofAtHead` reads as current.

## 4. The review record's mutant batch runs in the foreground and outlives the tool cap

### What is wrong

`run.cjs review --item ... --reviewer ...` runs the mutant batch inside the call. On a cold test machine the control build alone ran past 547 s, and the foreground call was cut off at the 10-minute tool cap. The runner cleaned up (tree restored, session closed), but the batch was lost and had to run again. The orchestrator definition says nothing about running the record detached, while it does for the gate (`gate --detach` / `--wait`).

### Evidence

- Log `mutate-batch-20261116T183930Z-3282080-control-1-1.log`: compiling on beta, `stopped from Alpha, wall 547s`.
- Every later record in the run went through `run_in_background` and took 6 to 12 minutes.

### How to fix

Give the record the gate's shape (`--detach` starts the batch as its own process, `--wait` blocks under the cap), or have `agent.md` say that the record runs in the background when it owes mutants.

## 5. Reviewers do not know a check criterion can be proven by a node:test mutant

### What is wrong

Every item reviewer of this intent and its intent reviewer reported grep, `refs.py`, `cmp`/`diff -B` and firewall criteria as unreachable by any mutant, and left them for the orchestrator. The intent record then refused `clean` over 19 of them. The runner already accepts the way out: a mutant whose `test:` wraps the check in an inline `node --input-type=module -e 'import {test} from "node:test"; ...'`, which prints the `ℹ fail N` summary `run-mutate-verdict.cjs` reads. The intent `the-lower-layers-stop-calling-up` shipped that way the same morning (its `review.yaml:80-127`). Neither the reviewer definition nor `CHECK_HINT` (`run-mutate-verdict.cjs:61`, "end the criterion's line with (gate: <name>) instead, or have the host list the check ... under mutate.checks") names it, and a gate mark cannot name a grep at all (`gateHeld`, `run-criterion-marks.cjs:55-57`: only a finalize command or a lane).

### How to fix

Name the inline node:test wrapper in `CHECK_HINT` and in the reviewer definition's mutant section, with one example, so a check criterion gets its mutant at the item review instead of reaching the intent record unproven.
