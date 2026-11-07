---
id: gs-ship-runs-the-host-cleanup-once-the-worktree-is-gone
title: "Ship and teardown run the host's ship cleanup once the worktree is gone"
intent: a-gate-folds-only-when-it-is-next-to-ship-a-superseded-lane-is-proven-stopped-a-running-lanes-red-is-seen-at-once-and-no-retry-or-missing-record-passes-as-proof
kind: behavior
complexity: medium
mode: autopilot
status: completed
completed_at: 2026-11-06T20:09:32Z
depends_on: [gs-the-gate-folds-only-at-the-head-of-the-slot]
created: 2026-11-06
---

# Work Item: Ship and teardown run the host's ship cleanup once the worktree is gone

## Description

A shipped intent leaves its remnants on the host: lane evidence and remote trees on other machines, and the flow's own cache folder of the branch. The flow cannot know where a host keeps them, so it runs one optional host command, `verification.ship_cleanup`, as the last step of removing a shipped worktree. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`. Without the key every path is today's.

1. **The key.** In `S/run-config-gates.cjs`: `validateGates` (:21-37) refuses a `verification.ship_cleanup` that is set and is not a string with non-blank text, `BAD_CONFIG` with the line `verification.ship_cleanup in <file> must be one shell command: "ship_cleanup: \"<command>\"" under verification:.`, in the shape of the `merge_slot` refusal at :23-28. `inheritGates` (:40-48) adds `['verification', 'ship_cleanup']` to its pairs, so a `--config` file inherits it as it inherits `merge_slot`. A new export `shipCleanup(config)` returns the trimmed command, or `null` when the key is absent.
2. **Where it runs.** In `S/run-ship.cjs`, `removeWorktree` (:131-139) takes the command as a new last argument and runs it as its last step, after `stopOwnedProcesses` (:133), `worktree remove` (:135) and `branch -d` (:137), through a new function `shipCleanup(primary, tree, branch, command, out)` in the same file. `ship` passes `gates.shipCleanup(config)` from the config it read at :57. `teardown` (:147-187) reads `lib.readConfig(primary, options.config)` once, uses it for the base at :168 and passes its command, so `run.cjs teardown` after a ship that exited 2 runs the cleanup too. When the command is set, `removeWorktree` pushes `INFERNO_BRANCH=<branch> INFERNO_TREE=<tree> <command> (in <primary>)` onto `left` with its two git lines and shifts it once the cleanup ran, whatever its exit, so a throw before it names it as owed.
3. **How it runs.** `shipCleanup` sets `process.env.INFERNO_BRANCH` to the branch and `process.env.INFERNO_TREE` to the absolute tree path, as `acceptCheck` in `S/run-lanes.cjs` sets the lane's variables with `Object.assign(process.env, ...)`, because `lib.runShell` (`S/run-lib.cjs:354`) has no env option and the process is one-shot. It runs `lib.runShell(command, primary, log)` with the cwd the primary checkout and the log `path.join(lib.cacheDir(primary), 'ship-cleanup', `${branch.replace(/[^A-Za-z0-9._-]/g, '-')}-${lib.stamp()}.log`)`.
4. **What it prints, and the ship stands.** Exit 0 prints `ship cleanup: <last non-blank log line or (no output)>`. Any other exit prints `ship cleanup exited <code>: <last line>` and `log <path>`. A throw inside `shipCleanup` prints `ship cleanup failed: <message>`. None of the three is rethrown or changes the exit: `ship` still prints `shipped` and exits 0, `teardown` still prints `removed` and `deleted` and exits 0. Both payloads carry `cleanup: { code, log }`, or `null` without the key.

The first red test: "ship runs ship_cleanup once the worktree and branch are gone, with the branch and the tree in its environment", which fails today because ship runs no host command.

## Acceptance Criteria

- [ ] New `S/run-ship-cleanup.test.cjs` on `S/run-fixture.cjs` passes. Each case commits a host script and a config with `ship_cleanup: "bash <script>"` on the fixture's main before `closed(fixture)`, and the script writes what it saw to a file named by an env variable passed through `run(fixture, args, { env })`:
  - "ship runs ship_cleanup once the worktree and branch are gone, with the branch and the tree in its environment": ship exits 0 with `shipped`; the script saw `INFERNO_BRANCH` equal to the branch, `INFERNO_TREE` equal to the tree path, the tree missing on disk, `git branch --list <branch>` empty and its cwd equal to the fixture root; the output holds `ship cleanup: <the script's last line>`.
  - "a failing ship_cleanup prints its line and the ship stands": the script prints `refused here` and exits 1; ship exits 0 with `shipped`, the output holds `ship cleanup exited 1: refused here` and a `log ` line, `git rev-parse main` equals `origin/main`, and the tree is gone.
  - "the cleanup's log outlives the branch's cache folder": the script removes `$XDG_CACHE_HOME/specsmd-inferno/<fixture root basename>/<branch>` and then prints `cleaned`; the output holds `ship cleanup: cleaned`.
  - "teardown runs ship_cleanup after removing a merged worktree": in the shape of `S/run-ship.test.cjs:72`, teardown exits 0 and the script saw the branch, the tree and the tree missing.
  - "without ship_cleanup nothing runs": the fixture's own config, ship exits 0 and the output matches no `ship cleanup`.
  - "a --config file inherits ship_cleanup, and a blank or non-string value is refused": `gates.shipCleanup(lib.readConfig(root, '.specs-inferno/config.codex.yaml'))` returns the project config's command when the codex file sets none, and `ship_cleanup: ""` and `ship_cleanup: ["a"]` each throw `BAD_CONFIG`, as `S/run-review-outside.test.cjs:139-155` reads `mergeSlot`.
- [ ] `node --test S/run-ship-cleanup.test.cjs S/run-ship.test.cjs S/run-review-outside.test.cjs` reports 0 fail.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-ship.cjs
      reason: ship at 51-124, removeWorktree at 131-139 and teardown at 147-187
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-config-gates.cjs
      reason: validateGates at 21-37 and inheritGates at 40-48 take the new key
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lib.cjs
      reason: runShell at 354, cacheDir at 386 and readConfig at 177-206, read only
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
      reason: acceptCheck sets the env, runs a host command through runShell and reads its last log line
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-config-gates.cjs
      reason: the merge_slot refusal at 23-28 and mergeSlot at 51-54 are the shape of the new key
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-ship.test.cjs
      reason: the ship and teardown cases stay green, and the teardown case at 72 is the pattern
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-review-outside.test.cjs
      reason: the config cases at 139-155 stay green and are the pattern for the inherit case
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-ship.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-config-gates.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-ship-cleanup.test.cjs
probes:
    - run: "grep -c ship_cleanup src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-ship.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-config-gates.cjs | grep -c ':0$'"
      shows: "2"
    - run: "grep -c \"'worktree', 'remove', tree\" src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-ship.cjs"
      shows: "1"
    - run: "node -e 'try{require(\"./src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lib.cjs\").cacheDir(\"/nonexistent-inferno-tree\")}catch(e){console.log(e.code)}'"
      shows: "NO_REPO"
finalize_check: "node --test src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-ship-cleanup.test.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-ship.test.cjs"

## Technical Notes

- Order: after the process stop, the worktree removal and the branch delete. The host removes what the shipped branch left, so every process the run registered in the tree, gate and lane jobs included (`detach` in `S/run-jobs.cjs` registers them, `S/run-ship.cjs:133` stops them), has ended and nothing writes into the branch's cache folder again; the command needs only the branch name and the tree path as strings, and both are held in `removeWorktree`'s arguments. It also runs after `gs-the-gate-folds-only-at-the-head-of-the-slot` releases the ticket in `removeWorktree`, so a slow cleanup never holds the slot.
- The cwd is the primary checkout because the tree is gone, and `ship` refuses unless the primary is on the base branch (`S/run-ship.cjs:63-66`), which holds the host's script once it is on that branch.
- The log is in `<cacheDir(primary)>/ship-cleanup/`, not in the branch's folder `<cacheDir(tree)>/<branch>` that `jobPaths` in `S/run-jobs.cjs` uses: `cacheDir(tree)` asks git in the tree and throws `NO_REPO` once it is removed (the third probe), and a host cleanup removes exactly the branch's folder.
- A failing cleanup never undoes the ship: the merge is pushed and proven an ancestor of the base (:104-113) before it runs, and it only removes copies of work the base already holds.
- The flow stays project-agnostic: the key holds the host's command, and no host name, path or variable other than the flow's own `INFERNO_` names enters the source. A host that sets no key (Skoft_Files) runs as today. `config.example.yaml` documents the key through `gs-the-orchestrator-and-planner-texts-follow`, which owns that file.
- Proven stays proven: the cleanup runs after the green check, the merge, the push and the ancestor proof, and changes none of them.
- `S/run.cjs` is not touched: the key needs no flag, and `run.cjs` belongs to the slot, direct-build and supersede items.

## Dependencies

- gs-the-gate-folds-only-at-the-head-of-the-slot
