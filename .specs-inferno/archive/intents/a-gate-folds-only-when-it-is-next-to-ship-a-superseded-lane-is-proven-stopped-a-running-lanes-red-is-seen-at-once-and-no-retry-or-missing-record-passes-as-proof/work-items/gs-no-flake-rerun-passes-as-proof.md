---
id: gs-no-flake-rerun-passes-as-proof
title: "No flake rerun passes as proof, and the proofs a flake minted are revoked"
intent: a-gate-folds-only-when-it-is-next-to-ship-a-superseded-lane-is-proven-stopped-a-running-lanes-red-is-seen-at-once-and-no-retry-or-missing-record-passes-as-proof
kind: behavior
complexity: medium
mode: autopilot
status: completed
completed_at: 2026-11-06T17:10:08Z
depends_on: []
created: 2026-11-06
---

# Work Item: No flake rerun passes as proof, and the proofs a flake minted are revoked

## Description

Plan item 2f. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`.

1. **The rerun goes.** In `S/run-gate.cjs` delete the rerun block of `gateNow` (:265-278: `rerunCommand`, the `unchanged()` reruns, `recordFlake`, `result.result = 'flake'`), `recordFlake` (:210-218), `failedCases` (:197-208), the `flake` branch of `describe` (:181-184) and its `rerunLog` lines (:188-191). A failed finalize command now returns red at :280-284 on its first failure. Keep the `unchanged` closure only if something else still reads it, else delete it too.
2. **A leftover key is read, not refused.** A running session's scratch config still carries `verification.flake_rerun` (plan A5a, `config-hc.yaml:120`), so refusing it would stop a live gate. `gateNow` and `gateDetach` print one line, `IGNORED verification.flake_rerun: a red command stays red`, when the selected config holds the key, and do nothing else with it.
3. **Revocation.** `S/run-proofs.cjs` gains `revokeFlakeProofs(tree)`, called first thing in `commandProof` (:61) once per process per cache dir (a module-level `Set` of cache dirs done). It walks `lib.cacheDir(tree)` recursively for `gate-job.result.json` files (branch names hold slashes, so `inferno-intent/<id>-<stamp>/gate-job.result.json`), and for each result whose `results` hold an entry with `result: 'flake'` that `green-commands/.flake-revoked.json` does not yet list, deletes every file directly in `<cacheDir>/green-commands/` whose JSON record has that entry's `command`, the result's `branch` and that entry's `seconds`. It then adds `{ result: <path>, log: <entry.log> }` to `.flake-revoked.json` with the tmp-and-rename write of :96-101, so a proof re-minted later with the same three values is never deleted. It never rewrites a result file: a new `gate --detach` reopens that path for writing (`S/run-jobs.cjs:71`). Skip unreadable JSON, as `readProof` does at :69-78.
4. **Texts.** Delete the sentence "The gate reruns a failed `flake_rerun` command once on the unchanged tree; a pass names its failed cases as flake and marks the gate green, while another failure stays red." from `src/flows/inferno/agents/orchestrator/agent.md:109` and from `src/flows/inferno/codex/skills/specsmd-inferno/references/procedure.md:133`. Keep "Never de-parallelize a suite or regate to mask flake." and its Codex twin.

The first red test: the replacement for `run-gate.test.cjs:136` below, which fails today because the gate prints `FLAKE` and exits 0.

## Acceptance Criteria

- [ ] `S/run-gate.test.cjs`: the case "gate accepts one green flake rerun, names every failed case and mints the command proof" (:136) becomes "gate stays red on a failed command with flake_rerun configured, and mints no proof": with `config([flaky], [], { [flaky]: ['src/**'] }, { [flaky]: 'node proof.cjs flaky-rerun-green' })` the gate exits 2, prints `FAIL` and `IGNORED verification.flake_rerun`, `ran(f)` deep-equals `['flaky']`, and `green` exits 3. The cases at :151 and :160 are folded into it or removed; `node --test S/run-gate.test.cjs` reports 0 fail.
- [ ] `S/run-proofs.test.cjs` new case "a proof a flake gate result names is revoked at the next lookup, and only that proof": a cache holding a `gate-job.result.json` (branch B, a flake entry with command C and seconds 904), a proof {C, B, 904} and a proof {C, B, 903}; after one `commandProof` the first file is gone, the second stays and `.flake-revoked.json` lists the result; a proof {C, B, 904} written afterwards survives the next process's lookup. `node --test S/run-proofs.test.cjs` reports 0 fail.
- [ ] `grep -c -E "recordFlake|failedCases|'flake'" S/run-gate.cjs` prints 0.
- [ ] `grep -c flake_rerun src/flows/inferno/agents/orchestrator/agent.md src/flows/inferno/codex/skills/specsmd-inferno/references/procedure.md` prints 0 for each.
- [ ] `npx vitest run __tests__/unit/inferno __tests__/unit/installer` in `src/` reports 0 failed: those suites read both edited texts.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs
      reason: the flake rerun at 181-191, 197-218 and 263-284
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-proofs.cjs
      reason: commandProof at 61-67, readProof at 69-78, the atomic write at 96-101
    - path: src/flows/inferno/agents/orchestrator/agent.md
      reason: the flake sentence in Finalize step 1 at 109
    - path: src/flows/inferno/codex/skills/specsmd-inferno/references/procedure.md
      reason: the flake sentence at 133
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lanes.cjs
      reason: writeRecord at 38-43 is the tmp and rename write to mirror
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-jobs.cjs
      reason: readJson at 29-36 reads a record and returns null on bad JSON
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.test.cjs
      reason: the flake cases at 136-168 and the config fixture at 28-37
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-proofs.test.cjs
      reason: the new revocation case
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-proofs.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.test.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-proofs.test.cjs
    - src/flows/inferno/agents/orchestrator/agent.md
    - src/flows/inferno/codex/skills/specsmd-inferno/references/procedure.md
probes:
    - run: "grep -c recordFlake src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs"
      shows: "2"
    - run: "grep -c flake_rerun src/flows/inferno/agents/orchestrator/agent.md"
      shows: "1"
    - run: "grep -c flake_rerun src/flows/inferno/codex/skills/specsmd-inferno/references/procedure.md"
      shows: "1"
finalize_check: "node --test src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.test.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-proofs.test.cjs"

## Technical Notes

- Reverses the oracle line of Skoft_CRA 96eec9d0a on the council's settled point 6: a flake rerun marked a red browser suite green and a real race shipped (Skoft_CRA `scripts/inferno-config.test.mjs:214`).
- Measured 2026-11-06: three Skoft_CRA gate results name flake and each matches exactly one proof by command, branch and seconds (prefixes 2bb053c1e3a2b599, 953df82a26e55bb0, f03edde23f5f31c2); Skoft_Files has no flake result and no `flake_rerun`, so nothing changes there.
- The flake proofs were minted for the remote-wrapped command string of a scratch config (`bash .../remote-run.sh delta <tree> npm run test:e2e`), so the match is on the record's own `command`, never on the project config's list.
- Proven stays proven: only a proof a flake result names is deleted; every other proof keeps its key and record, and a red command was red before this change too.

## Dependencies

(none)
