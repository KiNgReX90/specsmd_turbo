---
id: gs-a-kb-sync-keeps-the-intent-review-current
title: "A kb sync folded from the base keeps the intent review current, an own kb edit does not"
intent: a-gate-folds-only-when-it-is-next-to-ship-a-superseded-lane-is-proven-stopped-a-running-lanes-red-is-seen-at-once-and-no-retry-or-missing-record-passes-as-proof
kind: behavior
complexity: high
mode: autopilot
status: pending
depends_on: []
created: 2026-11-06
---

# Work Item: A kb sync folded from the base keeps the intent review current, an own kb edit does not

## Description

Plan item 2g with amendment 4, plus the config reader both gate keys share. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`.

1. **The config gates.** New module `S/run-config-gates.cjs`, shaped like `S/run-lane-config.cjs`:
   - `validateGates(config, file)` refuses with `BAD_CONFIG` a `verification.merge_slot` that is not a boolean and a `review.outside` that is not a non-empty list of non-empty glob strings, each message naming the shape (`"outside: [\"wiki/**\"]"` under `review:`).
   - `inheritGates(config, defaults)` gives a `--config` file each of `verification.merge_slot` and `review.outside` it does not set, from the project config, as `inheritLanes` does (`S/run-lane-config.cjs:36-45`).
   - `mergeSlot(config)` returns true only for `verification.merge_slot === true`; `reviewOutside(config)` returns the globs or `[]`.
   - `S/run-lib.cjs` `readConfig` calls `inheritGates` beside `lanes.inheritLanes` (:197) and `validateGates` beside `validateVerification` (:200). `merge_slot` has no reader until `gs-the-merge-slot-queues-tickets-across-worktrees`.
2. **The hash that leaves the base's kb out.** `S/run-proofs.cjs` `scopeHash` (:23-58) takes `options.skip(file)`: a file it returns true for is left out of `included` (:25-26). `S/run-intent-owed.cjs` gains:
   - `outsideHash(tree, config)`: null when `reviewOutside(config)` is empty; else `proofs.scopeHash(tree, null, { skip })`, where `skip(file)` is true for a file matching a `review.outside` glob (`lib.matchesAny`) that is in neither `git diff --name-only <base>...HEAD` nor `git diff --name-only origin/<base>...HEAD` (the second only when `origin/<base>` resolves) and is not dirty. `base` is `resolveBase(config, null, tree)` from `S/run-intents.cjs:39`; require it inside the function if a load cycle appears.
   - `reviewCurrent(tree, config, review)`: true when `review.tree === proofs.scopeHash(tree)`, or when `review.tree_outside` is a string equal to `outsideHash(tree, config)`.
   - `intentReviewState` (:105) uses `reviewCurrent`; export both.
3. **The review records it.** `S/run-intent-review.cjs` `record` (:121) appends `tree_outside: <hash>` after `tree:` when `outsideHash` is not null; `reviewIntent` (:164) decides `current` with `owed.reviewCurrent`. `S/run-intent-review-file.cjs:64-65` accepts `tree_outside` as a recorded key of an intent review only; an item review (`S/run-review-file.cjs:135-136`) still refuses it.
4. **The fixture.** `S/review-fixture.cjs` `intentReviewed` (:218-231) takes an optional config and appends `tree_outside: <outsideHash(tree, config)>` when its `review.outside` is set; without one it writes what it writes today.

The first red test: "a base commit that only changes wiki/ keeps a clean review current", which fails today because any folded content voids the review at `S/run-intent-owed.cjs:105`.

## Acceptance Criteria

- [ ] New `S/run-review-outside.test.cjs`, built on `S/review-fixture.cjs` like `S/run-gate-review.test.cjs`, with a config whose `review.outside` is `["wiki/**", "grok/**"]`, passes these cases:
  - "a base commit that only changes wiki/ keeps a clean review current": record the review, commit `wiki/page.md` on main, `run.cjs gate --tree <tree>` exits 0 and prints no `intent review owed` line.
  - "the same base commit voids the review when review.outside is unset": the gate exits 3 with `intent review owed: the code changed since the review`.
  - "the intent's own wiki edit after the review voids it": a branch commit to `wiki/page.md` makes `green` exit 3 with `review` in `owed`.
  - "a base commit outside the kb voids the review even with review.outside set": a folded `docs/moved.md` gives exit 3.
  - "a review recorded without tree_outside keeps today's rule": a review file with `tree`, `commit` and `reviewer` only, then a wiki-only fold, gives exit 3.
  - "run.cjs review records tree_outside": the record call through `run.cjs review --tree <tree> --reviewer <id>` leaves a `tree_outside:` line in `review.yaml`.
  - "review.outside must be a list of globs and merge_slot a boolean, and a --config file inherits both": `review: { outside: "wiki/**" }` and `verification: { merge_slot: "yes" }` each refuse with `BAD_CONFIG`; a `--config` file setting neither reads both from the project config.
- [ ] `node --test S/run-review-outside.test.cjs S/run-gate-review.test.cjs S/run-intent-review.test.cjs` reports 0 fail.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-intent-owed.cjs
      reason: intentReviewState at 87-111 voids the review at 105
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-intent-review.cjs
      reason: record at 115-126 and the currency check at 164
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-proofs.cjs
      reason: scopeHash at 23-58
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lib.cjs
      reason: readConfig at 176-204 inherits and validates
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-intent-review-file.cjs
      reason: the recorded keys at 64-65
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/review-fixture.cjs
      reason: intentReviewed at 218-231 writes the recorded review
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lane-config.cjs
      reason: validateLanes and inheritLanes are the shape of the new module
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate.cjs
      reason: foldBase at 55-74 merges the base and origin base, the two refs the hash reads
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate-review.test.cjs
      reason: the fixture pattern of the new suite run-review-outside.test.cjs, and it stays green
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-intent-review.test.cjs
      reason: the record path stays green
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-config-gates.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-lib.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-proofs.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-intent-owed.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-intent-review.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-intent-review-file.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/review-fixture.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-review-outside.test.cjs
probes:
    - run: "grep -cF 'review.tree !== proofs.scopeHash(tree)' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-intent-owed.cjs"
      shows: "1"
    - run: "grep -c '^const RECORDED_KEYS' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-review-file.cjs"
      shows: "1"
    - run: "ls src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-config-gates.cjs 2>/dev/null | wc -l"
      shows: "0"
finalize_check: "node --test src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-review-outside.test.cjs src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-gate-review.test.cjs"

## Technical Notes

- Amendment 4: a kb path is exempt only while the branch's version equals the base's; an intent's own wiki or grok edit still voids its review.
- Both refs, because the gate's fold merges `<base>` and `origin/<base>` (`S/run-gate.cjs:58-72`) and a kb sync reaches origin before the local base. A path that differs from either merge base counts as the intent's own and stays in the hash, so a doubtful case voids the review rather than keeps it.
- `run-proofs.cjs` is also edited by `gs-no-flake-rerun-passes-as-proof` (in `commandProof`); the two edits touch different functions and the frontier serializes them.
- The config module carries `merge_slot` too, so the slot items read one validated key and a `--config` scratch file of a running session inherits it.
- Proven stays proven: a review recorded today has no `tree_outside` and is judged exactly as before; with `review.outside` unset no hash and no refusal changes. Only the review's currency moves; every finalize proof is still keyed by its own scope.

## Dependencies

(none)
