---
id: integrate-checks-what-a-base-commit-changed-and-lands-beside-busy-siblings-verify-item-waits-only-on-overlap-and-a-run-branch-keeps-its-config
title: "Integrate checks what a base commit changed and lands beside busy siblings, verify-item waits only on overlap, and a run branch keeps its config"
status: pending
created: 2026-11-09
---

# Intent: Integrate checks what a base commit changed and lands beside busy siblings, verify-item waits only on overlap, and a run branch keeps its config

## Goal

Fix in the flow source the five orchestrator-runner defects that items 7 to 11 of `/home/ruben/dev/Skoft_CRA/docs/clean-code/tooling.md` (lines 16-21) name, so one later reinstall brings them to every host:

1. `run.cjs integrate` on the base branch selects the scoped checks of the commit it lands, from `--since` or `origin/<base>`, and never skips them silently.
2. The ledger commit integrate makes stages only what the completion wrote.
3. Integrate refuses only the uncommitted files it would read or commit, so a reviewed item lands while a sibling builder or reviewer works in the same tree.
4. `verify-item` waits only for an open dispatch whose frozen ownership overlaps the item's.
5. A run branch keeps the `--config` it was given, and its later steps read it from there unless a new `--config` is passed.

## Users

The orchestrator session that runs an intent in a worktree with several builders and reviewers in flight, and the session that lands a direct build on the base branch of its primary checkout. Both are agents; the human who waits on them pays for every hour a clean item sits behind an unrelated sibling.

## Problem

Measured on 2026-11-09 at `2205834` (`evidence/runner-defects.sh` in this intent reproduces every line below on a throwaway repo):

- A commit on `main` that changed `src/a.txt`, `origin/main` one commit behind: `run.cjs integrate --tree .` prints `SKIP true (no path in scope changed)` and exits 0. With `doubles:` configured the same call exits 2 with `ERROR [BAD_CONFIG] doubles: the base branch resolves to main, the branch being checked, so HEAD would be counted against itself.` The planner launcher's direct-build step 3 (`src/flows/inferno/claude/commands/inferno-planner.md:68`) runs exactly this call.
- An untracked pending review file at `.specs-inferno/intents/x/reviews/y.yaml`, outside every scope: integrate exits 2 with `ERROR [DIRTY] refusing to verify a dirty tree: .specs-inferno/intents/.` (Skoft_CRA wave 2: about 1 to 1.5 hours lost by 09:00 on 2026-11-09).
- `verify-item` refuses every item while any dispatch started since its baseline is open, ownership disjoint or not; three suites assert it today (`run-attribution.test.cjs:101`, `run-attribution-peers.test.cjs:111` and `:318`). Skoft_CRA wave 2 held three accepted corrections 1 to 2 hours behind an unrelated builder.
- `commitLedger` stages `.specs-inferno/intents/<id>` whole and commits the whole index, so a review file another reviewer is writing is committed without its record lines and its `review` step then refuses it.
- `run.cjs integrate --config .specs-inferno/config.remote.yaml` prints `PASS 0s echo from-run-config`; the same call without `--config` prints `GREEN 0s echo from-repo-config`. Nothing keeps a run config between calls, so a call that forgets it runs the repo's checks on the host (Skoft_CRA wave 2, 17:32: a local vitest on reserved Alpha, earlyoom killed a 999 MiB process).

## Success Criteria

- The fixture of `ri-integrate-on-the-base-diffs-from-since-or-origin`: a commit on `main` touching `src/**` makes `node --test S/run-integrate-base.test.cjs` report its case "a commit on the base selects its scoped checks" passing with `PASS \d+s echo scoped` in integrate's output, where the source at `2205834` prints `SKIP echo scoped (no path in scope changed)`.
- `node --test S/run-integrate-ledger.test.cjs` reports 0 fail: a review file written while integrate runs is absent from the ledger commit (`git show --name-only` lists `.specs-inferno/state.yaml` and the item's work-item file only) and its `review --item ... --reviewer` call then records it.
- `node --test S/run-integrate-beside.test.cjs` reports 0 fail: a reviewed item integrates with exit 0 beside an uncommitted sibling file outside the scopes of the checks it runs, and the same call exits 2 naming a dirty path inside a running check's scope or inside the item's ownership.
- `node --test S/run-attribution-open.test.cjs` reports 0 fail: `verify-item` exits 0 beside an open dispatch with disjoint frozen ownership and exits 2 with `is still open` beside an overlapping one.
- `node --test S/run-config-record.test.cjs` reports 0 fail: an integrate and a gate without `--config` on an intent run branch run the commands of the config that branch recorded.
- The gate: `cd src && npm run validate:all` on Delta (the one `verification.finalize` command of `.specs-inferno/config.yaml`) exits 0, which runs every `.test.cjs` suite under `src/flows/inferno/agents/` through `src/__tests__/unit/inferno/inferno-flow.test.ts:403-428`, the printed-calls guard and the dash guard.
- `wc -l` of every script this intent edits or adds prints 500 or less.

`S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts` throughout.

## Constraints

- Plain node with the Node stdlib only: these scripts run inside consumer projects that have no `node_modules` (`src/__tests__/unit/inferno/inferno-flow.test.ts:430-440` enforces it for the writer and the scheduler).
- Tests live beside the scripts as `S/<name>.test.cjs` on `node:test`; `inferno-flow.test.ts` discovers every one and fails a suite that leaves an entry in its own TMPDIR, so a fixture uses `tempDir` from `S/test-temp.cjs` with `t.after` cleanup, as `S/run-fixture.cjs` and `S/run-attribution-fixture.cjs` do.
- Every source file stays at 500 lines or less, the reviewer's bar (`src/flows/inferno/agents/reviewer/agent.md:24`). `S/run-lib.cjs` sits at 497 and no item edits it.
- No em or en dash in any file under `src/flows/inferno/` (`inferno-flow.test.ts:366-381`). Every call a script prints is built in `S/run-call.cjs` (`src/__tests__/unit/inferno/printed-calls.test.ts`), so a refusal names a flag such as `--since <the commit before your edit>`, never a hand-built runner call.
- Agent tests never run on Alpha. A builder runs only the `node --test` files its item names, through `remote-run.sh` as `dispatch.constraints` in `.specs-inferno/config.yaml` say; the full suite is the gate's, on Delta.
- The flow stays project-agnostic: nothing reads `reserve.py`, a host reservation or any host store. The host-reservation refusal half of tooling item 11 is already built outside the flow (`~/.local/share/skoft-agent-hooks/reservation-guard.py`).
- Edits stay inside `S/`. No agent, command, skill or README text changes: `git grep -n -i -e dirty -e "still open" -e unpushed -- 'src/flows/inferno/**/*.md'` prints four lines (`agents/orchestrator/agent.md:38` and `:44`, `agents/reviewer/agent.md:20`, `commands/inferno-reviewer.md:22`), none about a changed behaviour, so nothing collides with the model-id rename in agent and skill files.
- No change to Skoft_CRA and no reinstall into any host; that is a later step on the lead's go.

## Notes

**Key files (grounded 2026-11-09 at `2205834`).** Skoft_CRA's installed copy is flow.lock 0.1.81 at source_commit `7c4d721`; `main` is 73 commits past it and carries the completed gate-speed intent. Where a line moved since that copy it says so.

- `S/run-integrate.cjs:52-62` `commitLedger` adds `state.yaml` and `.specs-inferno/intents/<id>` and runs `git commit -q -m` over the whole index. Same lines as in 0.1.81.
- `S/run-integrate.cjs:121-131` `integrate` calls `gate.refuseDirty(tree)` at :123 before anything else.
- `S/run-integrate.cjs:149` `started = proofs.scopeHash(tree)` hashes every path outside `.specs-inferno/`, dirty bytes included, and :209-212 reds the landing when it moved.
- `S/run-integrate.cjs:159` `changed = gate.changedPaths(tree, gate.mergeBase(tree, base))`, and :168 the tester-case range `${gate.mergeBase(tree, base)}..HEAD`; on the base branch both anchors are HEAD. Same line as in 0.1.81.
- `S/run-integrate.cjs:165` the doubles check gets `base`, and `S/check-doubles.cjs:108-115` `baseline` throws `BAD_CONFIG` whenever the branch is the base.
- `S/run-gate.cjs:29-38` `refuseDirty` refuses any dirty path; :41-45 `changedPaths` (at :38 in 0.1.81, moved three lines) diffs the working tree, so it counts uncommitted and untracked files as changed; :47-49 `mergeBase`; :58-77 `foldBase`, whose merge failure reports `diff --diff-filter=U`, an empty list when git refused over a dirty file.
- `S/run-lanes-only.cjs:29-52` `sinceCommit` and `lanesSince`: since `97e34e7` a lanes-only start on the base branch diffs from `--since` or `origin/<base>`. Integrate never got the rule.
- `S/run-review.cjs:259-273` the item review's own dirty check, `dirtyPaths(tree).filter(mine)` with `recoverInterrupted(tree, { keepLive })`: the pattern integrate's narrowed refusal follows. `S/run-review.cjs:259` a review file is pending while `git status` lists it, and :209-231 `record` appends `tree:`, `commit:`, `reviewer:` and commits with a pathspec.
- `S/run-lib.cjs:73-88` `statusPaths` and `dirtyPaths` read `git status --porcelain`, which collapses an untracked directory to `dir/`; `ownedBy("src/new/", ["src/new/a.ts"])` is false (`S/run-owned.cjs:129-138`), measured by the evidence script.
- `S/state-transition.cjs:109-160` `completeItem` writes `state.yaml` and, through `syncWorkItemMarkdown` (:62-86, called at :150), the item's `work-items/<item>.md`, returning that path as `markdown`.
- `S/run-attribute.cjs:26-31` `openDispatches` and :195-200 its refusal; :98 the default peers are accepted records only. Same lines as in 0.1.81.
- `S/run-peers.cjs:37` an attempt nobody accepted claims nothing, and :86 `validateDispatch(tree, peer)` refuses a peer that is not accepted.
- `S/run-dispatch.cjs:140-170` `recordDispatch` freezes `assignment.ownership.editable` and refuses a change to it (:149-150); :216-238 `loadDispatch` and `currentRecords`.
- `S/run-owned.cjs:124-126` `overlaps(left, right, tree)`, the one predicate dispatch, batching and verification share.
- `S/run-lib.cjs:177-207` `readConfig` (at :176 in 0.1.81) reads `selected`, else the tree's `.specs-inferno/config.yaml`; `S/run-call.cjs:29-37` `caller` keeps one process's flags; `S/run.cjs:196-220` `main` calls `caller(options)` at :198.
- `S/run-jobs.cjs:19-28` `jobPaths` keeps per-branch records in `cacheDir/<branch>/`, the gate job's `config` among them; `S/run-gate.cjs:365-380` `gateWait` refuses a wait whose config differs from the started gate's.
- `S/run-worktrees.cjs:40-43` `intentOf(branch)` names the intent of an `inferno-intent/<id>-<stamp>` branch and null for any other.

**Test layout and the installed copy.** `src/package.json` `validate:all` is `npm run test && npm run lint:md && npm run check:webview-bundle`; `npm run test` is vitest over `src/__tests__/**/*.test.ts`, and `inferno-flow.test.ts:403-428` runs each `.test.cjs` under the flow's `agents/` as its own node process. No item updates an installed copy: `git ls-files .specsmd .claude .codex | grep -c -i inferno` prints `0` in this repo, and the one drift test that reads `.specsmd/inferno/...` (`src/__tests__/unit/installer/claude-layout.test.ts:47`) reads an install it makes in a sandbox (`openSandbox`, :19).

**Reframes the ground truth forced.**

- Item 10's premise that `completeItem` writes only `state.yaml` is false: it also rewrites the item's work-item file (`state-transition.cjs:150`). The ledger commit stages `state.yaml` plus exactly the `markdown` paths the completions returned, committed through a pathspec as `record` does, never a directory and never the whole index.
- Item 8 frees an item exactly as far as correctness allows. A check reads the tree it runs in, uncommitted sibling bytes included, and `remote-run.sh` mirrors uncommitted edits too, so a dirty path inside the scope of a check this landing runs is still refused. What the narrowing frees: every sibling file outside those scopes, and every file under `.specs-inferno/` other than `state.yaml` and the landing items' own work-item files, a reviewer's pending review above all. On Skoft_CRA, whose five integrate commands all carry a `finalize_scopes` entry, a sibling inside `src/` still holds a landing that runs `npm test`; a sibling in `docs/`, `research/` or `integration/` does not.
- Item 7 on a base branch whose `origin/<base>` is at HEAD, or that has no origin, and no `--since`: integrate runs every scoped check and prints one line saying why, instead of refusing as `lanesSince` does. A lanes-only start has nothing to do without a diff; an integrate always folds and runs its unscoped checks, `run-review-recover.test.cjs:53-60` runs it that way on `main`, and a scoped check that runs when it need not costs time where one that skips costs the proof.
- Item 9 refuses on overlap, and also waits when a disjoint open dispatch is running and a change no dispatch claims is found. That change may be the open builder's own escape, which only its `accept-dispatch` can attribute, so naming it outside the reviewed item would send that builder a false correction.

**Decisions.**

- Item 7 inherits the recorded lanes-only rule (`.specs-inferno/archive/intents/a-gate-folds-only-.../work-items/gs-a-direct-build-takes-the-slot-and-starts-only-the-lanes.md`, Technical Notes, and commit `97e34e7`): `--since` first, else `origin/<base>`. `sinceCommit` moves to a new `S/run-since.cjs` that requires no module that requires `run-gate.cjs`, because `run-gate.cjs` already loads `run-lanes-only.cjs`. The e2e selection keeps its own base-branch anchor (`S/run-e2e-impact.cjs:155-163`, HEAD~1): no host configures `verification.integrate_e2e` (`S/run-integrate.cjs:12-15`), deliberately left.
- The full gate keeps its whole-tree dirty refusal: it proves the branch ship merges, and it runs in an intent worktree after every item has landed.
- Item 11's record lives at `cacheDir/<branch>/run-config.json`, beside the gate job, keyed by the run branch, so `claim` (which knows the run before the worktree exists), `worktree`, `integrate` and `gate` address one record without copying it. It is written and read only for an `inferno-intent/<id>-<stamp>` branch: several sessions share a primary checkout on the base branch, and a record there would hand one session's config to another. The host guard covers the primary checkout.
- The steps that read the record when no `--config` is passed are those that run or prove configured commands: `worktree` (bootstrap), `integrate`, `gate` in every mode, `green` and `ship` (which read the proofs the gate keyed on its config), and the lane accepts. A step that only reads models, roles or wiring keeps today's default. The record keeps the path as given, so a relative path resolves against each step's own tree.
- No flow-side refusal is added for item 11. On a run branch the record now answers a forgotten `--config`; on the primary checkout only the host knows its machine is reserved, and its guard refuses there. A flow refusal would need a host fact the flow must not read.
- Chain. `ri-integrate-refuses-only-the-dirt-it-reads-or-commits` follows `ri-integrate-on-the-base-diffs-from-since-or-origin`, whose anchor decides which checks run and so which scopes are read, and `ri-the-ledger-commit-stages-only-what-completion-wrote`, without which a tolerated sibling file under the intent directory would ride into the ledger commit. `ri-verify-item-waits-only-on-an-overlapping-open-dispatch` and `ri-a-run-branch-keeps-the-config-it-was-given` own disjoint files and start at once; the last shares only `S/run.cjs` with the first, which the orchestrator serializes.

**Rejected shapes.**

- One item per defect file (`run-integrate.cjs`, `run-attribute.cjs`, `run-lib.cjs`): three integrate defects with different mechanisms in one item would fill one builder's context, and item 11 does not belong in `run-lib.cjs`, which is at its ceiling.
- Dissolving item 8 by running integrate's checks on a clean checkout of HEAD: a fresh tree has no `node_modules` or target dir, and `remote-run.sh` mirrors the dirty tree anyway, so the cost lands on every landing and the remote path keeps the sibling's bytes.
- Making every tree step read the run config record: the six cases in three suites that mix configs on one intent branch (`run-gate`, `run-ship`, `run-proofs`) would grow to every review, scan and frontier suite, for steps that run no configured command.

**Verification route.** Builders run their named `node --test` files through `remote-run.sh` (`dispatch.constraints`). The gate is the `verification.finalize` command of `.specs-inferno/config.yaml`, `validate:all` on Delta. Each item's `finalize_check` is a line-count check only, because `verify-item` runs it on Alpha.
