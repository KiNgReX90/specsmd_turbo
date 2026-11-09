---
id: ri-integrate-refuses-only-the-dirt-it-reads-or-commits
title: "Integrate refuses only the uncommitted files it would read or commit, so a reviewed item lands beside a busy sibling"
intent: integrate-checks-what-a-base-commit-changed-and-lands-beside-busy-siblings-verify-item-waits-only-on-overlap-and-a-run-branch-keeps-its-config
kind: behavior
complexity: high
mode: autopilot
status: pending
depends_on: [ri-integrate-on-the-base-diffs-from-since-or-origin, ri-the-ledger-commit-stages-only-what-completion-wrote]
created: 2026-11-09
---

# Work Item: Integrate refuses only the uncommitted files it would read or commit, so a reviewed item lands beside a busy sibling

## Description

Fixes the defect tooling item 8 names. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`. `integrate` (`S/run-integrate.cjs:121-131`) calls `gate.refuseDirty(tree)` (:123), and `refuseDirty` (`S/run-gate.cjs:29-38`) refuses any dirty path, so an item whose review is clean cannot land while a sibling builder or reviewer has one uncommitted file anywhere in the tree (measured: a pending review file outside every scope gives `ERROR [DIRTY] refusing to verify a dirty tree: .specs-inferno/intents/.`; Skoft_CRA wave 2 lost about 1 to 1.5 hours to it on 2026-11-09).

A check reads the tree it runs in, uncommitted sibling bytes included, and `remote-run.sh` mirrors uncommitted edits too. So integrate still refuses exactly the uncommitted files it would read or commit, and tolerates the rest:

- a file an item being landed owns (`ownership.editable` of each id, `lib.ownedBy`);
- when the call lands an item, `.specs-inferno/state.yaml` and the landing items' `work-items/<item>.md`, the files the completion writes and the ledger commit stages (`ri-the-ledger-commit-stages-only-what-completion-wrote`); a fold-and-check call with no `--item` writes neither;
- a file inside the scope of a check this landing runs: a `verification.integrate` command with a `finalize_scopes` entry that the landing's committed changes reach covers its globs (`lib.matchesAny`), and a command without an entry, like the `integrate_e2e` command, covers every path outside `.specs-inferno/`, as `proofs.scopeHash(tree)` hashes it (`S/run-proofs.cjs:24-59`).

1. **`S/run-dirt.cjs`, new.** `dirtyFiles(tree)`: the union of `git diff --name-only --no-renames -z HEAD` and `git ls-files --others --exclude-standard -z`, one entry per file, the reading `S/run-proofs.cjs:34-37` already uses. `lib.dirtyPaths` reads `git status --porcelain`, which collapses an untracked directory to `dir/`, and `ownedBy("src/new/", ["src/new/a.ts"])` is false, so a path-level filter on it misses files. Also the refusal helper integrate calls, so `S/run-integrate.cjs` stays a flow.
2. **`S/run-integrate.cjs`.** Replace :123. Before the fold: `recoverInterrupted(tree, { keepLive })` with `keepLive(file)` true when the file is outside the items' ownership, the ledger files and the scope of every configured integrate command (a live mutant that a check could read still holds the landing), then refuse the dirty files the items own and the ledger files. After the fold and the selection `ri-integrate-on-the-base-diffs-from-since-or-origin` puts at :158-159, and before the doubles check (:165) or any command: refuse the dirty files inside a running check's scope. The selection reads committed paths only (`git diff --name-only --no-renames <anchor> HEAD`), so a tolerated sibling file never selects a check. Each refusal keeps today's code `DIRTY`, names up to five files with `and <n> more`, keeps the restore lines through `afterRecovery`, and says the files belong to the landing or to a check it runs.
3. **The moved check.** `started` (:149) and the comparison at :209-212 hash the union of the running checks' scopes (`proofs.scopeHash(tree, union)`), or the whole tree when an unscoped check runs, so a sibling writing outside them no longer reds the landing as moved, and one writing inside them still does.
4. **`S/run-gate.cjs` `foldBase` (:58-77).** When `git merge` fails and `diff --diff-filter=U` is empty, refuse `DIRTY` naming the dirty files the incoming commits touch (`git diff --name-only HEAD <ref>` against `dirtyFiles`), instead of the `FOLD_CONFLICT` with an empty list it prints today. `gateNow`, `gateDetach` and `green` keep `refuseDirty` whole: the gate proves the branch ship merges.
5. **`S/run-review.cjs:268`.** The item review's own filter reads `dirtyFiles(tree).filter(mine)`, so an owned new file inside a new directory is refused like any other.

The first red test: "a reviewed item integrates beside a sibling's uncommitted file outside the running scopes", which exits 2 with `DIRTY` at `2205834`.

## Acceptance Criteria

- [ ] New `S/run-integrate-beside.test.cjs` on the fixtures of `S/review-fixture.cjs` (`repo`, `run`, `reviewed`, `heldMutate`; its `repo` has no origin, and its `a-two` owns `docs/b.md` and `src/b.ts`), with `a-two` freed of its `depends_on` as `S/run-integrate-review.test.cjs:14` does, an integrate list of `echo scoped` and `finalize_scopes` `"echo scoped": ["src/**"]` unless a case says otherwise; `a-one` owns `src/a.ts`, commits it and is reviewed clean. The fixture runs on `main` with no origin, where `ri-integrate-on-the-base-diffs-from-since-or-origin` runs every scoped check, so every integrate call here passes `--since` the commit before the landing:
  - "a reviewed item integrates beside a sibling's uncommitted file outside the running scopes": an untracked `docs/sibling.md` and a modified tracked `docs/b.md`; `integrate --item a-one` exits 0, prints `PASS \d+s echo scoped`, completes `a-one`, and both docs files are still uncommitted afterwards.
  - "a sibling file inside a running check's scope is refused": an untracked `src/b2.ts`; exit 2, `DIRTY` naming `src/b2.ts`, the ledger holds no `integrated_sha`.
  - "an uncommitted file the item owns is refused": `src/a.ts` edited after its commit; exit 2 naming `src/a.ts`.
  - "an unscoped check reads every path outside .specs-inferno": integrate list `echo always` with no scope entry and an untracked `docs/sibling.md`; exit 2 naming it, while an untracked `.specs-inferno/intents/alpha/reviews/a-two.yaml` alone is tolerated.
  - "a file outside a skipped check's scope is tolerated": a second command `echo docs` scoped to `docs/**`, a landing that touches only `src/`, and an untracked `docs/sibling.md`; exit 0 with `SKIP echo docs`.
  - "a live mutate on a sibling file outside every integrate scope does not hold the landing": `heldMutate` on `docs/b.md`; exit 0.
  - "a fold the sibling's file blocks names that file": on the `repo()` of `S/run-fixture.cjs`, which has a bare origin, `origin/main` moves `docs/b.md` while it is dirty in the tree; `integrate --tree <root>` exits 2 with `DIRTY` naming `docs/b.md`, never `conflict folding` with an empty list.
  - "the item review refuses an owned new file inside a new directory": `a-one` owns `src/new/a.ts`, an untracked `src/new/a.ts` and a pending review; `review --item a-one` exits 2 with `DIRTY` naming `src/new/a.ts`.
- [ ] `S/run-integrate.test.cjs:60-70` "integrate refuses a dirty tree and folds only when the config lists nothing" becomes "integrate refuses a dirty path an unscoped check reads, and folds only when the config lists nothing": the dirty `src/a.ts` is refused under the `INTEGRATE` config of :12, and the fold-only half keeps `CONFIG`.
- [ ] `node --test S/run-integrate-beside.test.cjs S/run-integrate.test.cjs S/run-integrate-review.test.cjs S/run-integrate-ledger.test.cjs S/run-integrate-base.test.cjs S/run-review-recover.test.cjs S/run-review.test.cjs S/run-gate-cli.test.cjs S/run-gate.test.cjs` reports 0 fail, run through `remote-run.sh` as `dispatch.constraints` say.
- [ ] `wc -l` of `S/run-integrate.cjs`, `S/run-dirt.cjs`, `S/run-gate.cjs` and `S/run-review.cjs` each prints 500 or less.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs
      reason: integrate at 121-131 calls refuseDirty at 123, checkAndLand at 133-223 hashes at 149 and 209-212
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs
      reason: refuseDirty at 29-38 stays for the gate, foldBase at 58-77 reports an empty conflict list over a dirty file
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-proofs.cjs
      reason: scopeHash at 24-59 is what a check's scope covers, the per-file dirty reading at 34-37
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-mutate-journal.cjs
      reason: recoverInterrupted at 140-174 and its keepLive option
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-review.cjs
      reason: the item review's dirty filter at 259-273
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-review.cjs
      reason: only this item's work has to be committed, keepLive and dirtyPaths.filter(mine) at 262-273
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/review-fixture.cjs
      reason: repo, run, reviewed at 202-208 and heldMutate at 275
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.test.cjs
      reason: the dirty-tree case at 60-70 changes, the rest stay green
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-review-recover.test.cjs
      reason: integrate restores a dead mutant first and says so at 52-90
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate-cli.test.cjs
      reason: the gate still refuses a dirty tree at 24 and 133
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-dirt.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-review.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.test.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate-beside.test.cjs
probes:
    - run: "grep -n -F 'const restored = gate.refuseDirty(tree);' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs | cut -d: -f1"
      shows: "123"
    - run: "grep -n -F 'const started = proofs.scopeHash(tree);' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs | cut -d: -f1"
      shows: "149"
    - run: "grep -n -F 'const dirty = lib.dirtyPaths(tree).filter(mine);' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-review.cjs | cut -d: -f1"
      shows: "268"
    - run: "wc -l < src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs"
      shows: "424"
diagnosis:
  claim: "integrate calls refuseDirty, which refuses any dirty path, so a sibling file outside every scope stops the landing"
  probe: "grep -n -F 'const dirty = lib.dirtyPaths(tree);' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs"
  shows: "31:  const dirty = lib.dirtyPaths(tree);"
finalize_check: "wc -l src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-dirt.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-review.cjs | awk '$2 !~ /^total$/ && $1 > 500 { bad = 1 } END { exit bad }'"

## Technical Notes

- Decision: refuse on the scopes of the checks this landing runs, not of every configured check. A skipped check reads nothing, and the statement's bar is the dirt integrate's scopes hash.
- Decision: a live mutant is judged against every configured integrate scope, because `recoverInterrupted` runs before the fold, when the running set is not yet known; a mutant inside one holds the landing as it does today.
- Decision: the gate keeps its whole-tree refusal. It runs after every item has landed, and it proves the tree ship merges.
- Honest limit: on a host whose integrate commands scope most of the code (Skoft_CRA's five do), a sibling inside `src/` still holds a landing that runs `npm test`, because that check would read its bytes. What this frees is every sibling file outside those scopes and every `.specs-inferno/` file other than the ledger's.
- `lib.dirtyPaths` stays in `S/run-lib.cjs` untouched (497 lines, at its ceiling); the per-file reading lives in the new module, and `run-intent-review.cjs:146`, `run-mutate.cjs:47` and `run-ship.cjs:75` keep `dirtyPaths`, because each refuses any dirt, collapsed or not.
- Ownership serialization on `S/run-integrate.cjs` after both dependencies.

## Dependencies

- ri-integrate-on-the-base-diffs-from-since-or-origin
- ri-the-ledger-commit-stages-only-what-completion-wrote
