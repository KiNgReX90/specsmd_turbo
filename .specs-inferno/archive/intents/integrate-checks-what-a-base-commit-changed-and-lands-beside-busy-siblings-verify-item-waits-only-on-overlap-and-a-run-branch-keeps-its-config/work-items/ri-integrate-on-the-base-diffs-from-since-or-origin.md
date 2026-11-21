---
id: ri-integrate-on-the-base-diffs-from-since-or-origin
title: "Integrate on the base branch diffs from --since or origin, so a commit there selects its scoped checks"
intent: integrate-checks-what-a-base-commit-changed-and-lands-beside-busy-siblings-verify-item-waits-only-on-overlap-and-a-run-branch-keeps-its-config
kind: behavior
complexity: medium
mode: autopilot
status: completed
completed_at: 2026-11-11T10:02:48Z
depends_on: []
created: 2026-11-09
---

# Work Item: Integrate on the base branch diffs from --since or origin, so a commit there selects its scoped checks

## Description

Fixes the defect tooling item 7 names. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`. On a tree whose branch is the base (the primary checkout on `main`, where the planner launcher's direct-build step runs `run.cjs integrate`), `checkAndLand` anchors three checks on `merge-base HEAD <base>`, which is HEAD there:

- `S/run-integrate.cjs:159` `changed = gate.changedPaths(tree, gate.mergeBase(tree, base))`, so every command with a `finalize_scopes` entry prints `SKIP <command> (no path in scope changed)` right after a commit that touched its scope (measured: `evidence/runner-defects.sh` in the intent dir prints `SKIP true (no path in scope changed)` for a commit on `main` that changed `src/a.txt`).
- `S/run-integrate.cjs:168` the tester-case range `${gate.mergeBase(tree, base)}..HEAD` is empty.
- `S/run-integrate.cjs:165` passes `base` to `checkDoubles`, and `S/check-doubles.cjs:108-115` `baseline` throws `BAD_CONFIG` whenever the branch is the base (measured: `ERROR [BAD_CONFIG] doubles: the base branch resolves to main, the branch being checked`).

The rule integrate gets is the one the lanes-only start already has (`lanesSince`, `S/run-lanes-only.cjs:35-52`, commit `97e34e7`): `--since` first, else `origin/<base>`.

1. **`S/run-since.cjs`, new.** Move `sinceCommit` verbatim from `S/run-lanes-only.cjs:28-33` here and export it; `run-lanes-only.cjs` requires it from here. Add `landingSince(tree, base, since)`, returning `{ ref, all, out }`:
   - `since` given: `{ ref: sinceCommit(tree, since), all: false }` on any branch (`BAD_REF` on a ref that names no commit, as today).
   - branch is not `base`: `null`, and the caller keeps `gate.mergeBase(tree, base)` exactly as today.
   - branch is `base`, `origin/<base>^{commit}` resolves and differs from HEAD: `{ ref: <that sha>, all: false }`, the commits origin lacks.
   - branch is `base` otherwise (origin missing, or at HEAD): `{ ref: <origin sha or null>, all: true, out: ['on <base> with no unpushed commit and no --since: every scoped check runs'] }`.
   The module requires `run-lib.cjs` only: `run-gate.cjs` already loads `run-lanes-only.cjs`, so requiring `run-gate.cjs` here would close a cycle.
2. **`S/run-integrate.cjs` `checkAndLand`.** Compute the anchor once, after `foldBase` (:146), from `options.since`: `const landing = landingSince(tree, base, options.since)`, with `anchor = landing ? landing.ref : gate.mergeBase(tree, base)`. At :159 `changed` is `null` when `landing.all`, else `gate.changedPaths(tree, anchor)`; the loop at :175-182 skips a scoped command only when `changed` is non-null and no changed path matches its scope. Lead the output with `landing.out` (after the fold lines). At :168 the case range is `${anchor || gate.mergeBase(tree, base)}..HEAD`. At :165 pass `since: landing ? landing.ref : undefined` beside `base` to `checkDoubles`.
3. **`S/check-doubles.cjs` `baseline(tree, base, since)`.** When the branch is `base` and `since` is a sha, count against `since`; when it is the base and there is none, keep today's refusal and add `or pass --since <the commit before your edit>` to its message. `checkDoubles` (:131-158) passes `options.since` through, so `run.cjs doubles --since <ref>` on the base works too. Off the base nothing changes.
4. **`S/run.cjs` USAGE.** The three integrate lines (:63-65) each carry `[--since <ref>]`, and the `--since` option text (:91-93) adds: `integrate: diff the landing from this ref (on the base branch the default is origin/<base>; with neither, every scoped check runs)`.

The first red test: "a commit on the base selects its scoped checks", which prints `SKIP echo scoped (no path in scope changed)` at `2205834`.

## Acceptance Criteria

- [ ] New `S/run-integrate-base.test.cjs` on the `repo()` fixture of `S/run-fixture.cjs` (a bare origin, `main` pushed), driving integrate on `fixture.root` on `main` with an integrate list of `echo always` and `echo scoped`, and `finalize_scopes` `"echo scoped": ["src/**"]`:
  - "a commit on the base selects its scoped checks": commit `src/a.ts` unpushed, integrate prints `PASS \d+s echo scoped` and exits 0.
  - "a docs commit on the base still skips the src check": commit `docs/b.md` only, integrate prints `SKIP echo scoped (no path in scope changed)`.
  - "after a push --since names the landing, and without it every scoped check runs": commit `src/a.ts` and push; `integrate --since HEAD~1` prints `PASS \d+s echo scoped`; `integrate` alone prints the line `on main with no unpushed commit and no --since: every scoped check runs` and does not print `SKIP echo scoped`.
  - "--since naming no commit is refused": `integrate --since nosuchref` exits 2 with `BAD_REF`.
  - "doubles on the base counts HEAD against the landing": with `doubles: { pattern: 'FAKE', paths: ['src/**'] }`, a commit adding `src/fake.ts` holding `FAKE` exits 2 with `FAIL doubles 0 -> 1`, and a commit adding none prints `PASS doubles`.
- [ ] `node --test S/run-integrate-base.test.cjs S/run-integrate.test.cjs S/run-integrate-review.test.cjs S/run-review-recover.test.cjs S/check-doubles.test.cjs S/run-slot-cli.test.cjs S/run-printed-calls.test.cjs` reports 0 fail, run through `remote-run.sh` as `dispatch.constraints` say.
- [ ] `wc -l` of `S/run-integrate.cjs`, `S/run-since.cjs`, `S/run-lanes-only.cjs`, `S/check-doubles.cjs` and `S/run.cjs` each prints 500 or less.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs
      reason: checkAndLand at 133-223, the fold at 146, the doubles call at 165, the case range at 168, the scope selection at 158-182
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-only.cjs
      reason: sinceCommit at 28-33 moves out, lanesSince at 35-52 is the rule integrate inherits
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/check-doubles.cjs
      reason: baseline at 102-125 refuses the base branch, checkDoubles at 127-158 passes the options through
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs
      reason: the integrate USAGE lines at 63-65 and the --since option text at 91-93
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs
      reason: changedPaths at 41-45 and mergeBase at 47-49 stay as they are, read only
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-only.cjs
      reason: lanesSince is the base-branch since rule, its refusal text the shape of a ref refusal
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-fixture.cjs
      reason: repo() builds the host repo with a pushed origin, run() drives the CLI as a process
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.test.cjs
      reason: integrate on an intent worktree keeps its merge-base selection
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate-review.test.cjs
      reason: integrate on main with an unpushed commit, the review gate before the fold
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-review-recover.test.cjs
      reason: integrate on main with origin at HEAD exits 0, 2 and 3 as today at 52-90
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/check-doubles.test.cjs
      reason: the doubles ratchet off the base branch at 143-222
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-slot-cli.test.cjs
      reason: the lanes-only since cases at 85-160 after sinceCommit moves
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-since.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-only.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/check-doubles.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate-base.test.cjs
probes:
    - run: "grep -n -F 'gate.changedPaths(tree, gate.mergeBase(tree, base))' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs | cut -d: -f1"
      shows: "159"
    - run: "grep -n -F 'if (base === lib.currentBranch(tree)) {' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/check-doubles.cjs | cut -d: -f1"
      shows: "109"
    - run: "grep -n -F 'function sinceCommit(tree, since) {' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-only.cjs | cut -d: -f1"
      shows: "29"
    - run: "wc -l < src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs"
      shows: "225"
diagnosis:
  claim: "integrate selects its scoped checks from merge-base HEAD <base>, which is HEAD on the base branch, so a commit there skips every scoped check"
  probe: "grep -n -F 'gate.changedPaths(tree, gate.mergeBase(tree, base))' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs"
  shows: "159:  const changed = gate.changedPaths(tree, gate.mergeBase(tree, base));"
finalize_check: "wc -l src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-since.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes-only.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/check-doubles.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs | awk '$2 !~ /^total$/ && $1 > 500 { bad = 1 } END { exit bad }'"

## Technical Notes

- Inherited decision: the gate-speed intent added `--since` to the lanes-only start because on the base branch the merge base is HEAD (archived `gs-a-direct-build-takes-the-slot-and-starts-only-the-lanes`, Technical Notes), and `97e34e7` made `origin/<base>` its default. Integrate takes the same order.
- Integrate differs from `lanesSince` only where nothing gives a diff: a lanes-only start refuses, integrate runs every scoped check and says so. Integrate always folds and runs its unscoped checks, and a scoped check that runs when it need not costs time while one that skips costs the proof.
- The anchor is read after the fold: `foldBase` fetches and merges `origin/<base>`, so `origin/<base>` is then an ancestor of HEAD and the diff is exactly the unpushed commits. An explicit `--since` before a fold that brought origin commits in over-selects, which is safe.
- The e2e selection keeps its own base-branch anchor (`S/run-e2e-impact.cjs:155-163`, HEAD~1); no host configures `verification.integrate_e2e`.
- The lanes-only usage line and the `--holder` option block stay as they are: Skoft_CRA's `scripts/integrate-direct.mjs:113-130` reads them from the installed usage. A continuation line added under `--since` keeps its 20-space indent, the column that block parser reads.
- Scoped `S/run.cjs` edits only: this item adds no flag to `FLAGS` (`--since` takes a value and `parseArgs` already reads it), and `ri-a-run-branch-keeps-the-config-it-was-given` edits `main` in the same file, which the orchestrator serializes.

## Dependencies

(none)
