# Handoff: plan-lint accepts a `(gate: verification.<lane>)` mark on a criterion whose cases live only in journeys that lane never walks, so the criterion is owed to a walk that never comes

Row 0br. Read on the first host on 2026-11-25 in three planned intents on its main, on the build at `a8873ebb`. The tip holds the same `src/`.

## What is wrong

`S/` below is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

1. **A lane mark is checked for its name only.** Plan-lint passes a mark when the gate holds its name (`itemFindings`, `S/run-plan-lint.cjs:281-283`; `gateHeld`, `S/run-criterion-marks.cjs:73-75`): a finalize command, a lane the config sets as `verification.<lane>`, or an integrate check. Once the mark reads, the criterion is owed to that gate and not to the item. Row 0an reads the same mark for a count.
2. **Nothing asks the lane what it walks.** Which journeys a lane picks is the host's knowledge, and no host key lets plan-lint ask it whether the lane walks the cases a criterion names.
3. **On the first host such a mark passes with no walk.** Its lane never picks some journeys (`NEVER_PICKED`, `scripts/integration-journeys.mjs:233-248`). It classes a case of such a journey `NOT WALKED`, and it counts that class green (`GREEN`, `scripts/integration-lane-verdicts.mjs:51`).

## Evidence

Read on Alpha on 2026-11-25 at about 04:00Z, from the host's `origin/main`:

- TC-200, TC-203 and TC-204 live only in `integration/corpus-fleet.test.mjs`. TC-178 lives only in `integration/corpus-scan.test.mjs`. Both journeys are in `NEVER_PICKED`.
- Five open criteria mark them `(gate: verification.smoke)`: TC-200 in `my-products-and-the-product-switcher-wear-signal-arc/work-items/mps-the-head-carries-the-total-and-a-quiet-check-with-its-caption.md:34`, TC-203 in `documents-wears-signal-arc/work-items/dsa-compare-reads-one-column-and-names-the-pair-it-compares.md:37`, TC-204 in `the-inventory-wears-signal-arc/work-items/inv-a-component-is-one-row-of-two-lines-that-opens-it.md:29` and `inv-edit-component-and-add-by-hand-are-one-form.md:30`, and TC-178 in `inv-each-chapter-opens-on-its-title-with-its-own-heads.md:29`.
- An oracle of the first host also named TC-141, in `integration/earlier-profile.test.mjs`, which is never picked. TC-141 is also named in `integration/data.test.mjs`, so the lane may walk that one.

## How to fix

1. **A lane answers which cases it walks.** Add a host key, `verification.<lane>.walks`, that names a command. The command takes case ids, exits 0 when the lane's plan walks every one, and otherwise prints the ids it does not walk. Plan-lint runs it over the case ids that each `(gate: verification.<lane>)` criterion names, read by the host's `cases` pattern. Each unwalked case becomes a finding: `acceptance criterion <n> marks (gate: verification.<lane>), which never walks <case>: prove it in the item, or name the gate that walks it`. With no key, plan-lint reads the mark as today.
2. **The test.** Beside `S/run-plan-lint.test.cjs`, with a `walks` command that refuses one case id: a criterion marked for that lane and naming that case is a finding, and a criterion naming only walked cases is clean.

## Which part is the flow and which the host

The key and the lint are the flow's part. The first host's part belongs to its test-manager: the `walks` command over `NEVER_PICKED`, and whether `NOT WALKED` may count green for a case that a criterion marked for the lane.

## Until it is built

The planner never marks `(gate: verification.smoke)` on a criterion whose cases live only in a `NEVER_PICKED` journey. Such a case is proven in its item instead, or by one walk of its journey on the intent's final tree before ship, one file at a time, and a red there goes to the item's builder.
