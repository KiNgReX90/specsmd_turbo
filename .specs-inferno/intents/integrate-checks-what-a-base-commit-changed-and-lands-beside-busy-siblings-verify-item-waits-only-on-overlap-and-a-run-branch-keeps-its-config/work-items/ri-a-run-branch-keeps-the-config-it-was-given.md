---
id: ri-a-run-branch-keeps-the-config-it-was-given
title: "A run branch keeps the config it was given, and its later integrate and gate read it from there"
intent: integrate-checks-what-a-base-commit-changed-and-lands-beside-busy-siblings-verify-item-waits-only-on-overlap-and-a-run-branch-keeps-its-config
kind: behavior
complexity: high
mode: autopilot
status: pending
depends_on: []
created: 2026-11-09
---

# Work Item: A run branch keeps the config it was given, and its later integrate and gate read it from there

## Description

Fixes the record half of the defect tooling item 11 names. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`. `readConfig` (`S/run-lib.cjs:177-207`) reads the `--config` a call names, else the tree's `.specs-inferno/config.yaml` (:179), and `caller` (`S/run-call.cjs:29-37`) keeps the flags of one process only. Nothing carries a run config from one call to the next (measured: `integrate --config .specs-inferno/config.remote.yaml` prints `PASS 0s echo from-run-config`, the next `integrate` without it prints `GREEN 0s echo from-repo-config`), so a call that forgets it runs the repo's checks on the host (Skoft_CRA wave 2, 17:32, a local vitest on reserved Alpha).

The record:

1. **`S/run-config-record.cjs`, new.** Requires `run-lib.cjs`, `run-worktrees.cjs` (for `intentOf` at :40-43 and `worktreeFor` at :33-37) and `state-store.cjs` (`atomicWrite` at :66).
   - `recordFile(tree, branch)`: `path.join(lib.cacheDir(tree), branch, 'run-config.json')`, beside the gate job (`S/run-jobs.cjs:19-28`). `cacheDir` is keyed by the primary checkout, so claim on the primary and every step in the worktree address the same file.
   - `remember(tree, branch, config, step)`: only when `intentOf(branch)` names an intent; writes `{ version: 1, branch, config, step, recorded_at }` with `config` exactly as the call gave it, so a relative path resolves against each step's own tree as `readConfig` resolves it.
   - `recall(tree, branch)`: the recorded `config`, or null with no record or on a branch `intentOf` does not name. A record whose file `path.resolve(tree, config)` no longer exists refuses `BAD_CONFIG`: `the run config <config> recorded for <branch> is gone: pass --config <file>`, never a fall back to the repo config.
2. **`S/run.cjs` `main` (:196-220).** Before `caller(options)` (:198): for `worktree`, `integrate`, `gate`, `green`, `ship` and each lane in `LANES` (`smoke`, `windows`), when the call names no `--config`, set `options.config` to `recall(tree, branch)`. The branch is `lib.currentBranch(options.tree || lib.repoRoot(options.cwd))`; for `worktree <intent-id>` it is the intent's open worktree branch (`worktreeFor`), else its `claimed_by` in the primary's ledger. Because this runs before `caller`, every call the step prints carries the recalled `--config` too. After the handler returns without throwing, for `claim`, `worktree`, `integrate` and `gate` called with `--config` on their own command line, `remember` it under `result.payload.run` (claim), `result.payload.branch` (worktree) or the tree's current branch (integrate, gate). A call that throws records nothing, so a mistyped path or a refused `gate --wait` never replaces the record.
3. **`S/run.cjs` USAGE (:89).** The `--config` text adds: `on an intent run branch, worktree, integrate, gate, green, ship and the lane accepts default to the config claim, worktree, integrate or gate last recorded for that branch`.

The first red test: "integrate without --config runs the config a gate recorded on the run branch", which runs the repo config's command at `2205834`.

## Acceptance Criteria

- [ ] New `S/run-config-record.test.cjs`, on the fixture of `S/run-gate.test.cjs:39-63` (a tree on the intent branch `inferno-intent/demo-00000000T000000Z`, `proof.cjs` appending each command's name to `.runs`) or on `repo()` and `opened()` of `S/run-fixture.cjs`, with a second config whose commands differ from the repo config's:
  - "integrate without --config runs the config a gate recorded on the run branch".
  - "gate without --config runs the config an integrate recorded".
  - "a claim's --config reaches the worktree bootstrap and the integrate in it": `claim alpha --config <R>`, then `worktree alpha` and `integrate --tree <worktree>` with no `--config` run `R`'s bootstrap and integrate commands.
  - "a new --config replaces the record": after `--config <R>`, a call with `--config .specs-inferno/config.yaml`, then a bare call runs the repo config.
  - "a recorded config that is gone is refused, never replaced by the repo config": `--config` an absolute path outside the tree, the file removed, a bare integrate exits 2 with `BAD_CONFIG` naming that path and `--config`, and no repo config command ran.
  - "the base branch records nothing": `integrate --tree <root> --config <R>` on `main`, then a bare `integrate --tree <root>` runs the repo config.
  - "a bare gate --wait waits on the gate the recorded config started": `gate --detach --config <R>`, then `gate --wait` with no `--config` exits 0.
  - "green without --config checks the proofs of the recorded config": after `gate --config <R>`, a bare `green` exits 0.
  - "a call that names the recorded config prints its calls with it": a bare integrate refused for an owed review prints a review call carrying `--config <R>`.
- [ ] The cases that read the repo config with a bare call after a `--config` call on the same intent branch name it instead, their expectations unchanged: `S/run-gate.test.cjs:191-203` (the bare `green` and bare `gate` take `--config` `DEFAULT`), `:225-235` (the bare `green`), `:280-290` (the `other` wait takes `--config` `DEFAULT` and is still refused naming the config), `S/run-ship.test.cjs:140` (the bare `green` takes `--config .specs-inferno/config.yaml`), and `S/run-proofs.test.cjs:246`, `:254` and `:315` (each bare `green` takes `--config` `CONFIG`). The scan that found them: every test block holding both a `--config` step call and a bare `integrate`, `gate`, `green`, `ship` or lane call; the only other hit, `S/run-printed-calls.test.cjs:85`, names `gate --wait` in an assertion string, not a call.
- [ ] `node --test S/run-config-record.test.cjs S/run-gate.test.cjs S/run-gate-cli.test.cjs S/run-ship.test.cjs S/run-proofs.test.cjs S/run.test.cjs S/run-printed-calls.test.cjs S/run-lanes.test.cjs S/run-codex-wait.test.cjs` reports 0 fail, run through `remote-run.sh` as `dispatch.constraints` say.
- [ ] `wc -l` of `S/run.cjs` and `S/run-config-record.cjs` each prints 500 or less.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs
      reason: main at 196-220 calls caller at 198, COMMANDS at 134-164, the --config usage at 89
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lib.cjs
      reason: readConfig at 177-207 falls back to the tree config at 179, cacheDir at 386-389, read only
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-call.cjs
      reason: caller at 29-37 keeps one process's flags and every printed call reads them, read only
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-intents.cjs
      reason: claim at 227-257 returns the run branch, worktree at 288-323 the tree branch, read only
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs
      reason: gateDetach records the job config at 317-319, gateWait refuses a different one at 365-380, read only
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-jobs.cjs
      reason: jobPaths at 19-28 keeps a per-branch record in cacheDir
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-worktrees.cjs
      reason: intentOf at 40-43 and worktreeFor at 33-37, the bootstrap record at 66-136 is a per-tree record with a version
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.test.cjs
      reason: the fixture at 39-63 and the mixed-config cases at 191-203, 225-235 and 280-290
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-ship.test.cjs
      reason: ship checks the proofs of its selected config at 131-145
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-proofs.test.cjs
      reason: the per-config proof cases at 236-258 and 305-316
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-printed-calls.test.cjs
      reason: every printed call carries the caller's config
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-config-record.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-config-record.test.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.test.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-ship.test.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-proofs.test.cjs
probes:
    - run: "grep -n -F 'called.config = options.config || null;' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-call.cjs | cut -d: -f1"
      shows: "34"
    - run: "grep -n -F '  caller(options);' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs | cut -d: -f1"
      shows: "198"
    - run: "wc -l < src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs"
      shows: "253"
diagnosis:
  claim: "readConfig reads the named config or the tree's own, and nothing keeps a run config between calls, so a call that forgets it runs the repo's checks"
  probe: "grep -n -F 'const file = path.resolve(root, selected || defaultFile);' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lib.cjs"
  shows: "179:  const file = path.resolve(root, selected || defaultFile);"
finalize_check: "wc -l src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-config-record.cjs | awk '$2 !~ /^total$/ && $1 > 500 { bad = 1 } END { exit bad }'"

## Technical Notes

- Decision: the record is keyed by the run branch in `cacheDir/<branch>/`, not by the worktree's git dir, because `claim` runs on the primary before the worktree exists and must reach it without a copy step.
- Decision: only an `inferno-intent/<id>-<stamp>` branch records or recalls. Several sessions share a primary checkout on the base branch, and a record there would hand one session's config to the next. The host's own guard covers the primary checkout.
- Decision: the readers are the steps that run or prove configured commands, `worktree` (bootstrap), `integrate`, `gate` in every mode, `green` and `ship` (the proofs a gate keyed on its config) and the lane accepts. A step that reads only models, roles or wiring keeps today's default, which keeps the suites that mix configs for review and scan as they are.
- Decision: no flow-side refusal. On a run branch the record now answers a forgotten `--config`, and only the host knows its machine is reserved; the flow reads no host store (`reserve.py` stays the host guard's).
- `S/run-lib.cjs` (497 lines) and `S/run-intents.cjs` are read, never edited: the recall sits in `main` before `caller`, so every `readConfig(tree, options.config)` site and every printed call already receive it.
- Persisted format: the record carries `version: 1`; a record of another version is treated as no record.
- Ownership serialization on `S/run.cjs` with `ri-integrate-on-the-base-diffs-from-since-or-origin`, which edits only the USAGE text there.

## Dependencies

(none)
