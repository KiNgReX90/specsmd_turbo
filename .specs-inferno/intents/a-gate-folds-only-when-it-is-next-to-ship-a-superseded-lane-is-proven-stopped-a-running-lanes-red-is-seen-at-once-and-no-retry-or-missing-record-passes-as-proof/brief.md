---
id: a-gate-folds-only-when-it-is-next-to-ship-a-superseded-lane-is-proven-stopped-a-running-lanes-red-is-seen-at-once-and-no-retry-or-missing-record-passes-as-proof
title: "A gate folds only when it is next to ship, a superseded lane is proven stopped, a running lane's red is seen at once, and no retry or missing record passes as proof"
status: pending
created: 2026-11-06
---

# Intent: A gate folds only when it is next to ship, a superseded lane is proven stopped, a running lane's red is seen at once, and no retry or missing record passes as proof

## Goal

Make the gate of parallel INFERNO intents faster without dropping, weakening or skipping one check. A gate folds the base and starts only at the head of a first come, first served merge slot shared by every worktree of the repository. A lane line that names a red ends the wait the moment it is written. A fix restarts a gate only after the running lanes are proven stopped. A rerun never mints a proof, and the proofs a past rerun minted are revoked. An instrument red is accepted only on the host's positive evidence. A knowledge-base sync folded from the base keeps the intent review current. Every new behaviour is switched on by a config key, so a host that sets none of them (Skoft_Files) runs exactly as today.

## Users

The orchestrator sessions, Claude and Codex, that run several intents at once on one host and share its remote test machines. The two hosts that install this flow: Skoft_CRA opts in at the reinstall, Skoft_Files stays unchanged until it sets a key.

## Problem

Every intent folds and starts its gate the moment it is ready, so while one intent sits between `gate --detach` and `ship`, the next folds a base that is about to move and walks its lanes twice (council plan item 2a: four first gates each paid their walk twice). A lane red is seen only when the whole walk ends (`laneState`, run-lanes.cjs:118-125). A fix cannot restart a gate while its lane still walks (`GATE_RUNNING`, run-gate.cjs:316-321), and nothing proves the old walk stopped. A passing `flake_rerun` mints an ordinary proof (`recordFlake`, run-gate.cjs:210-218 and :273): three Skoft_CRA gate results name flake today, and the council found a real race shipped that way. `run.cjs smoke --accept` accepts any instrument red against a harness fix (run-lanes.cjs:190-219), even a lane that walked nothing. Any knowledge-base commit folded at the gate voids the intent review (run-intent-owed.cjs:105), so most gates on Skoft_CRA pay one more review.

## Success Criteria

- `node --test *.test.cjs`, run in `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts` with a fresh `XDG_CACHE_HOME`, reports 0 fail, and its suites include the new `run-slot.test.cjs`, `run-slot-gate.test.cjs`, `run-slot-cli.test.cjs`, `run-supersede.test.cjs` and `run-review-outside.test.cjs`.
- `npx vitest run __tests__/unit/inferno`, run in `src/`, reports 0 failed.
- The nine suites measured on 2026-11-06 (run-lanes, run-lanes-wait, run-lanes-config, run-gate, run-gate-cli, run-gate-review, run-ship, run-proofs, run-intent-review: `node --test --test-reporter=tap ... | grep '^# pass'` printed `# pass 126`) pass with only the three flake cases of run-gate.test.cjs replaced, so a config with no new key behaves as today.
- `grep -c recordFlake src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs` prints 0 (2 today).
- `grep -c -E "merge_slot|outside:|accept_check|red_line|^ *stop:|^ *windows:|flake_rerun"` over `/home/ruben/dev/Skoft_Files/.specs-inferno/config.yaml` and `config.codex.yaml` prints 0 for each, today and after the build: no behaviour of Skoft_Files changes.
- After the reinstall recipe in Notes: in Skoft_CRA `node .specsmd/inferno/check-lock.cjs` exits 0, `python3 ~/.local/share/skoft-agent-hooks/flow-text-budget.py` prints `ok` on all six rows, and `node --test ".specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/*.test.cjs"` reports 0 fail.

## Constraints

- No check is dropped, weakened or skipped. Speed comes only from not repeating proven work, parallel work, earlier reds, no waits on nothing and a trustworthy instrument. Every item states why nothing proven before stops being proven (council statement 2).
- Flow scripts run from the primary checkout for every orchestrator the moment they are installed. Every change reads today's job, result, proof, accepted-record and review files unchanged, and a live gate or lane job in any linked worktree without a ticket counts as the head of the slot (plan 2a shim).
- New behaviour is config-gated: `verification.merge_slot`, `review.outside`, and per lane `verification.<lane>.accept_check`, `.stop` and `.red_line`. The smoke proof binds the Windows lane only where a Windows lane is configured. A `--config` file inherits each of these keys it does not set, as it inherits the lanes today (run-lib.cjs:186-198).
- The flow is project-agnostic (specsmd_new CLAUDE.md): no host name, host path or host env var enters the flow source. A host half is a shell command the host names in its config.
- Zero dependencies and no ledger write (run.cjs:12-14).
- Every `run.cjs` call a script prints is built in run-call.cjs (`src/__tests__/unit/inferno/printed-calls.test.ts` flags a literal).
- Agent and command text carries no date, counted duration or tally (`inferno-flow.test.ts:385`) and no em or en dash (`inferno-flow.test.ts:366`). Measured on Skoft_CRA on 2026-11-06 with `python3 ~/.local/share/skoft-agent-hooks/flow-text-budget.py`: claude orchestrator 4887/5000, claude planner 4474/4500, codex orchestrator 4615/5000.
- Amendments 1, 3 and 4 of `council/r3-amendments.md` are binding: an open intent review dispatch holds the head ticket up to two hours, accept asks a host check, and a knowledge-base path is exempt only while the branch's version equals the base's.
- Nothing under `/home/ruben/dev/Skoft_CRA` is edited by an item. The flow reaches Skoft_CRA only through the reinstall recipe in Notes, after this intent ships.

## Notes

**Sources.** `council/statement.md` (statement 2), `council/r3-plan-v2.md` item 2 a to h with its Objections lines, `council/r3-amendments.md` 1, 3 and 4, copied into this intent on 2026-11-06. Plan 2i's `scripts/integrate-direct.mjs`, `verdicts.json` and the host's `accept_check` and `stop` commands belong to the Skoft_CRA lane intent (statement 1); this intent gives the driver its flow side (`slot`, `gate --detach --lanes-only`).

**Key files (grounded 2026-11-06).** `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`. The installed copy in Skoft_CRA is byte-identical (`diff -r` of the scripts dir prints nothing; flow.lock `source_commit` 7c4d721 is specsmd_new HEAD).
- `S/run-gate.cjs` (415 lines): `gateNow` :233-298 runs the finalize list, the flake rerun at :263-278, `recordFlake` :210-218, `failedCases` :197-208; `gateDetach` :310-346 refuses a live job at :315-321, folds at :326, starts lanes at :332 and the gate job at :339; `gateWait` :362-375; `green` :389-403.
- `S/run-lanes.cjs` (237 lines): `laneProof` :34-36 keys a lane by command, config and scope; `startLanes` :72-93; `laneNow` :96-115 runs the lane command into a stamped log at :102-103 and writes its result only at the end; `laneState` :118-125; `describeLane` :133-147; `waitAll` :153-187 exits 2 on any red verdict at :166-169; `accept` :190-219; `smokeOwed` :222-235 is the only lane `green` owes.
- `S/run-lane-config.cjs`: `LANES` :15, `validLane` :17-22 checks command and scope only, `inheritLanes` :36-45, `configuredLanes` :48-52 carries name, command and scope.
- `S/run-jobs.cjs`: `jobPaths` :19-27 (job, result, log per tree branch), `alive` :39-52 (pid plus a `run.cjs` cmdline), `everyJob` :55-59, `detach` :69-85 (detached spawn, so the pid leads its process group).
- `S/run-proofs.cjs`: `scopeHash` :23-58, `commandProof` :61-67, `readProof` :69-78, atomic write :96-101.
- `S/run-intent-owed.cjs`: `intentReviewState` :87-111 voids the review on any content change at :105; `gateRefusal` :118-128; `mergeOwed` :148-164.
- `S/run-intent-review.cjs`: `dispatchPath` :33 (`intent-review-dispatch.json` in the branch cache dir), `dispatch` :54-87, `record` :115-126 appends `tree`, `commit`, `reviewer` at :121, `reviewIntent` :128-171 folds at :161 and recomputes currency at :164.
- `S/run-review-file.cjs:21` `RECORDED_KEYS`, shared with `S/run-intent-review-file.cjs:64-65`.
- `S/run-ship.cjs`: push and the ancestor proof :104-113, `removeWorktree` :131-139, `teardown` :147-187.
- `S/run-lib.cjs` (494 lines): `validateVerification` :107-143, `readConfig` :176-204 with the inherited sections at :188-197, `runShell` :351-372 (no env option), `cacheDir` :383-386 (per primary basename).
- `S/state-store.cjs`: `lockPath` :38-44 in the git common dir, `atomicWrite` :66, `acquire` :91-118, `withStateLock` :121-140.
- `S/run-worktrees.cjs:17-26` `worktreeEntries`; `S/run-call.cjs` builds every printed call (`gateStartCall` :65, `gateWaitCall` :68, `laneAcceptCall` :103).
- Texts: `src/flows/inferno/agents/orchestrator/agent.md:109-110` (Finalize gate and lanes, 3285 words), `src/flows/inferno/codex/skills/specsmd-inferno/references/procedure.md:133` (2762 words), `src/flows/inferno/agents/orchestrator/skills/orchestrate/SKILL.md:13`, `src/flows/inferno/agents/orchestrator/config.example.yaml:45-64`, planner `src/flows/inferno/agents/planner/agent.md:163` and its drift-tested copy `src/flows/inferno/commands/inferno-planner.md:163` (3111 words).

**Measured.**
- Three Skoft_CRA gate results name flake, each matching exactly one proof by command, branch and seconds (proof file prefixes 2bb053c1e3a2b599, 953df82a26e55bb0, f03edde23f5f31c2); `find ~/.cache/specsmd-inferno/Skoft_CRA -name gate-job.result.json -exec grep -l '"result":"flake"' {} + | wc -l` printed 3 over 104 result files, and 0 for Skoft_Files. Skoft_Files configures no Windows lane and no `flake_rerun`.
- Skoft_CRA's lane class lines start a line with the class (`scripts/integration-lane-fold.mjs:104-117`), and the classes a branch owes are `PRODUCT RED`, `NOT RED FIRST`, `BRANCH HARNESS RED` and `CARRIED FIXED` (`scripts/integration-classify.mjs:30`).
- The high-contrast intent shipped as Skoft_CRA bd1a6a318 (2026-11-06 13:10, on origin/main), so the reinstall waits only on this intent.

**Decisions.**
- The flow passes the gate's config to a lane as `INFERNO_GATE_CONFIG` (relative to the tree) and the accepted log to `accept_check` as `INFERNO_LANE_LOG`, not the plan's and the lane intent's `DF_*` names: the flow is installed in Skoft_Files too and carries no host name, and `INFERNO_FLOW_BUDGET` (run-budget.cjs:29) and `INFERNO_MUTANT` set the namespace.
- Two host halves the plan placed in the flow are host commands, because the flow cannot know Delta, Beta, flock or Skoft_CRA's classes: `verification.<lane>.stop` proves a superseded lane stopped (plan 2b), and `verification.<lane>.red_line` is the pattern of an owed class line (plan 2c). The plan's "refused when the fix touches neither BUILD_INPUTS nor HARNESS" becomes "refused when no path changed since the running job's head lies in a running lane's scope", the flow's own name for the same set.
- The slot lives in `<git common dir>/inferno-merge-slot.json` under its own lock, so every linked worktree of a repository shares one queue and nothing enters a tree.
- Supersede releases the old ticket and takes a new one at the back (plan 2a), and a red wait releases the ticket; a red tree whose lane still walks stays the head through the shim until supersede stops it or it ends, which keeps a second walk off the same remote machine.
- Flake revocation runs on the first proof lookup of each process, deletes only proofs a flake result names, and records each handled result in `green-commands/.flake-revoked.json`, never by rewriting a result file a new detach may hold open (run-jobs.cjs:71).
- `review.outside` compares against the merge base with `<base>` and with `origin/<base>`, because the gate folds both (run-gate.cjs:58-72) and a kb sync arrives through origin.
- Reverses the oracle line of Skoft_CRA 96eec9d0a (flake rerun) on the council's settled point 6. Keeps c612ee7's rule that the flow never retries a lane and 919fd0a's rule that an accepted red holds only for the run it accepted.

**Shapes considered.** One item per plan letter: rejected, 2a alone spans a store, the gate, ship, review and the direct driver, and 2d and 2e share one function. One item per module: rejected, the slot mechanism would be cut across five items. Dissolve into host code only: rejected, the flow files are locked in Skoft_CRA (`flow.lock`, `check-lock.cjs`) and the council placed these changes in specsmd_new. Chosen: one item per mechanism, the slot split into its store, its gate wiring and the direct driver's commands. The chain: flake removal, the kb review rule, the lane keys and the slot store start in parallel; the early red follows the lane keys; the gate wiring follows all four because it shares `run-gate.cjs`, `run-lanes.cjs` and `run-intent-review.cjs` with them; the driver commands, supersede and the texts follow in that order on `run.cjs` and `run-gate.cjs`.

**Interface with Skoft_CRA's lane intent.** Its brief (`/home/ruben/dev/Skoft_CRA/.specs-inferno/intents/the-real-app-lane-reports-each-red-as-it-walks-and-proves-every-journey-it-planned/brief.md`, Notes, "Flow interface") pinned the flow side; this intent provides it as follows.
- Taken as pinned: `run.cjs slot --take --holder <name> [--tree <dir>]` (0 at the head, 4 queued), `run.cjs slot --release --holder <name>`, `run.cjs gate --detach --lanes-only` waited with `gate --wait`, the three verbatim in the usage; `accept_check` run in the tree, exit 0 accepts, any other exit refuses with its last output line as the reason; the gate's config passed to the lane as a path relative to the tree.
- Changed, because the flow carries no host name: the variables are `INFERNO_LANE_LOG` and `INFERNO_GATE_CONFIG`, not `DF_LANE_LOG` and `DF_GATE_CONFIG`; the lane intent reads those names.
- Added: `--since <ref>` for `--lanes-only`, because on the base branch the merge base is HEAD and no lane would see the driver's commit; the driver passes its pre-edit sha.
- Added: supersede asks the host's `verification.<lane>.stop` command (`INFERNO_LANE`, `INFERNO_LANE_PID`, `INFERNO_LANE_LOG`, `INFERNO_GATE_CONFIG` set; exit 0 means proven stopped) instead of reading the lane intent's `lane-owners` records, which are host files under a host path. The lane intent pins no stop command; until one is on Skoft_CRA's main, supersede there refuses and the orchestrator waits, as today.
- `verdicts.json` is the host's: the flow never reads it, the host's `accept_check` does.
- Whichever of the two intents lands second sets `accept_check` and `stop` in Skoft_CRA's two configs.

**specsmd_new has no `.specs-inferno/config.yaml`.** `run.cjs gate` refuses `NO_GATE` without `verification.finalize`; `/specsmd-inferno-config` scaffolds it before the gate, with `cd src && npm run validate:all` as the finalize command (CLAUDE.md step 2).

**Reinstall recipe, run after this intent ships to specsmd_new main.**

```text
direct: reinstall-the-flow-the-gate-queues
  change: In specsmd_new run `cd src && npm pack` and `evals/install-eval.sh <tgz>`; in the Skoft_CRA primary on main run `script -qec "npx -y --package=<tgz> specsmd install" /dev/null` as d81f2307e did; in both .specs-inferno/config.yaml and config.codex.yaml set verification.merge_slot true, review.outside ["wiki/**", "grok/**"], and red_line "^(PRODUCT RED|NOT RED FIRST|BRANCH HARNESS RED|CARRIED FIXED) " on the smoke and windows lanes; set accept_check and stop only when statement 1's host commands are on main. Commit "Reinstall the flow: a gate folds only when it is next to ship" with "Installs specsmd_new <sha> onto <sha>." and the Verified line.
  files: .specsmd/**, .claude/**, .agents/**, .codex/agents/** as the installer writes them, .specs-inferno/config.yaml, .specs-inferno/config.codex.yaml, scripts/inferno-config.test.mjs
  test: scripts/inferno-config.test.mjs :: "both host configs queue the gate and exempt only the kb paths from the review": merge_slot is true and review.outside deep-equals ["wiki/**", "grok/**"] in both configs, red before the config edit
  proof: node .specsmd/inferno/check-lock.cjs exits 0; flow-text-budget.py prints ok on six rows; node --test ".specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/*.test.cjs" 0 fail; node --test scripts/inferno-config.test.mjs 0 fail
  grade: medium
  hard: no
  measured: budget 4887/5000 orchestrator and 4474/4500 planner (python3 ~/.local/share/skoft-agent-hooks/flow-text-budget.py); installed scripts byte-identical to 7c4d721 (diff -r); 3 flake-minted proofs in ~/.cache/specsmd-inferno/Skoft_CRA
```
