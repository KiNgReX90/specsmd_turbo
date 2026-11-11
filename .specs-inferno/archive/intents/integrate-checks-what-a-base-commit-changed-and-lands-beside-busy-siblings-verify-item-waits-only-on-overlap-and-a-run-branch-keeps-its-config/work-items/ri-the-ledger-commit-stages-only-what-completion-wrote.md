---
id: ri-the-ledger-commit-stages-only-what-completion-wrote
title: "The ledger commit stages only the files the completion wrote, so a review file written beside an integrate stays its reviewer's"
intent: integrate-checks-what-a-base-commit-changed-and-lands-beside-busy-siblings-verify-item-waits-only-on-overlap-and-a-run-branch-keeps-its-config
kind: behavior
complexity: low
mode: autopilot
status: completed
completed_at: 2026-11-10T05:21:40Z
depends_on: []
created: 2026-11-09
---

# Work Item: The ledger commit stages only the files the completion wrote, so a review file written beside an integrate stays its reviewer's

## Description

Fixes the defect tooling item 10 names. `S` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts`. `commitLedger` (`S/run-integrate.cjs:52-62`) runs `git add` on `.specs-inferno/state.yaml` and on `.specs-inferno/intents/<id>` whole (:55), then `git commit -q -m <message>` over the whole index (:60). A pending item review sits at `.specs-inferno/intents/<id>/reviews/<item>.yaml` (`S/run-review-file.cjs:33-35`) and is pending only while `git status` lists it (`S/run-review.cjs:259`); `record` (:209-231) appends its `tree:`, `commit:` and `reviewer:` lines and commits it. When another item's reviewer writes that file while integrate runs, the ledger commit takes it in without those lines, and the review step then refuses its own file (Skoft_CRA wave 2, 2026-11-09 15:05).

The completion writes two kinds of file, not one: `completeItem` (`S/state-transition.cjs:109-160`) writes `state.yaml` and, through `syncWorkItemMarkdown` (:62-86, called at :150), the item's `work-items/<item>.md`, returning that repo-relative path as `markdown`.

1. `completeItems` (`S/run-integrate.cjs:70-84`) collects `result.markdown` from each `writer.completeItem` call that returned one.
2. `commitLedger(tree, paths, message)` takes that exact list plus `path.join(lib.SPECS_DIR, 'state.yaml')`, keeps the ones that exist, and commits them through a pathspec: `git add -- <paths>`, then `git commit -q -m <message> -- <paths>`, the form `record` uses at `S/run-review.cjs:223-225`. No directory is staged and nothing else in the index is committed.

The first red test: "a review file written while integrate runs stays out of the ledger commit", which finds the review file in `git show --name-only` of the ledger commit at `2205834`.

## Acceptance Criteria

- [ ] New `S/run-integrate-ledger.test.cjs` on the fixtures of `S/review-fixture.cjs` (`repo`, `run`, `reviewed`), with `SIBLINGS` as in `S/run-integrate-review.test.cjs:14` so `a-one` and `a-two` are both open:
  - "a review file written while integrate runs stays out of the ledger commit": `a-one` reviewed clean, and an integrate command that writes `.specs-inferno/intents/alpha/reviews/a-two.yaml` (`item: a-two`, `verdict: clean`, `files: [src/b.ts]`) while it runs. `integrate --item a-one` exits 0; `git show --name-only --format= HEAD` lists exactly `.specs-inferno/intents/alpha/work-items/a-one.md` and `.specs-inferno/state.yaml`; `git status --porcelain` still lists the review file.
  - "its review step then records it": in the same fixture, `review --item a-two --tree <root> --reviewer rev-2` exits 0 with `review a-two clean, recorded`, and the committed file ends with the `tree:`, `commit:` and `reviewer: rev-2` lines.
  - "a file staged beside an integrate is not swept into the ledger commit": an integrate command that writes and `git add`s `.specs-inferno/halt-notes/other.md` while it runs; afterwards that path is still staged (`git diff --cached --name-only` lists it) and absent from `git show --name-only --format= HEAD`. Both writes sit under `.specs-inferno/`, which `proofs.scopeHash` leaves out, so the landing is not refused as moved, and the tree is clean when integrate starts, so today's whole-tree dirty refusal does not mask the case.
- [ ] `node --test S/run-integrate-ledger.test.cjs S/run-integrate.test.cjs S/run-integrate-review.test.cjs S/run-review.test.cjs` reports 0 fail, run through `remote-run.sh` as `dispatch.constraints` say.
- [ ] `wc -l S/run-integrate.cjs` prints 500 or less.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs
      reason: commitLedger at 52-62 and completeItems at 70-84
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs
      reason: completeItem at 109-160 returns the work-item path it rewrote as markdown, written at 62-86
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-review.cjs
      reason: a review is pending while git status lists it at 259, record commits it at 209-231
  patterns:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-review.cjs
      reason: record stages and commits an exact path list through a pathspec at 223-225
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/review-fixture.cjs
      reason: repo, run and reviewed at 202-208 write and record a clean review
  tests:
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate-review.test.cjs
      reason: the batch completion cases at 31-58 still commit both items
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.test.cjs
      reason: completion with the proven sha at 77-101
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs
    - src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate-ledger.test.cjs
probes:
    - run: "grep -n -F 'intentIds.map((id) => path.join(lib.SPECS_DIR' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs | cut -d: -f1"
      shows: "55"
    - run: "grep -n -F 'const markdown = syncWorkItemMarkdown(' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs | cut -d: -f1"
      shows: "150"
diagnosis:
  claim: "commitLedger stages the intent directory whole, so a review file another reviewer writes during integrate is committed without its record lines"
  probe: "grep -n -F 'intentIds.map((id) => path.join(lib.SPECS_DIR' src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs"
  shows: "55:    ...intentIds.map((id) => path.join(lib.SPECS_DIR, 'intents', id)),"
finalize_check: "wc -l src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/run-integrate.cjs | awk '$1 > 500 { bad = 1 } END { exit bad }'"

## Technical Notes

- The premise that `completeItem` writes only `state.yaml` is false (`S/state-transition.cjs:150`), so the list is `state.yaml` plus every `markdown` path the completions returned.
- An integrate command that writes the review file stands in for a reviewer writing beside it: the file lands between the dirty check and the ledger commit, the window the defect needs, and `.specs-inferno/` is outside `proofs.scopeHash`, so the landing is not refused as moved.
- Ownership serialization on `S/run-integrate.cjs` with `ri-integrate-on-the-base-diffs-from-since-or-origin` and `ri-integrate-refuses-only-the-dirt-it-reads-or-commits`; this item touches only :52-84.

## Dependencies

(none)
