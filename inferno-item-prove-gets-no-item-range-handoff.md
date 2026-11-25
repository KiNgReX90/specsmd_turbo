# Handoff: verify-item hands `real_app.prove` the tree and the item's journey files but not where the item's work starts, so a host lane that narrows by a range can only take the branch's, and each item's prove walks the earlier items' cases and mutants again

Row 0bq. Read on the first host on 2026-11-25 from a running prove on Delta, on the build at `a8873ebb`. The tip holds the same `src/`.

## What is wrong

`S/` below is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

1. **The prove gets two names.** `proveItem` runs the host's `real_app.prove` with `INFERNO_TREE` and `INFERNO_JOURNEYS` alone (`S/run-real-app-prove.cjs:64`). `INFERNO_JOURNEYS` lists the journey files the item's diff touched, as whole files.
2. **The item's own range is not among them.** verify-item knows where the item's work starts: the baseline of its dispatch, which `verifyDispatch` returns as `since` (`S/run-attribute.cjs:86-133`), or the `--since` it was given. A host command that walks only the cases and mutants changed in a range cannot ask for that range, so it takes the branch's.
3. **So the cost grows with the item's place in the intent.** The prove of item n walks every case block, red-first test and can-fail mutant that the items before it changed in the same journey file, and each of those was already proven at its own item.

## Evidence

- The first host's prove: `DF_GATE_LANE=smoke node scripts/real-app-lane.mjs --base main --changed`, the `real_app.prove` of its `.specs-inferno/config.yaml`. `--changed` reads the range from main.
- Delta, intent `the-checklist-wears-chapter-arcs`, item 2 `cca-the-checklist-stands-in-products-frame`. Its prove log is `~/.cache/specsmd-inferno/Skoft_CRA/inferno-intent/the-checklist-wears-chapter-arcs-20261124T113918Z/real-app-cca-the-checklist-stands-in-products-frame-20261125T014615Z.log`, started 2026-11-25T01:46:15Z. Its journeys file lists `integration/TEST-CASES.md` and `integration/checklist.test.mjs`. By about 03:42Z it had walked `integration/checklist.test.mjs` whole four times (four `TC-071` lines in 1790 lines). The later walks show reds on TC-064, TC-067, TC-069 and TC-237, as a mutant walk does, and the log shows two machine-lock yields between walks.
- The branch holds item 1's can-fail patches (`integration/can-fail/TC-064.patch`, `TC-065`, `TC-066`, `TC-067` and `TC-069`), which a range from main reaches at every later item of the intent. An oracle of the first host counted them as item 1's five mutants walked again for item 2. It put the repeated proving over the group of signal-arc intents at about 9 to 14 hours.

## How to fix

1. **Hand the item's range.** `proveItem` also sets `INFERNO_SINCE`: the commit the item's verify-item proves from, which is its dispatch baseline, or `--since`. It sits beside `INFERNO_TREE` and `INFERNO_JOURNEYS`. The header comment and the key's documentation say that a prove may narrow its cases, red-first tests and mutants to what changed since that commit. The gate's lanes keep walking whole.
2. **The test.** Beside `S/run-real-app-prove.test.cjs`: a `real_app.prove` that writes its environment to a file sees `INFERNO_SINCE` equal to the item's dispatch baseline, and equal to `<ref>` under `verify-item --since <ref>`.

## Which part is the flow and which the host

The variable is the flow's part. Narrowing the walk to it is the host's: its lane (`scripts/real-app-lane.mjs --changed`, planned in `scripts/integration-lane-plan.mjs`) reads the range, and the first host's test-manager owns that change. None of the host's part is for this row's builder.

## Until it is built

The prove cannot learn the item's baseline today. On the first host, each item prove walks the branch's range, and the host plans that cost per item.
