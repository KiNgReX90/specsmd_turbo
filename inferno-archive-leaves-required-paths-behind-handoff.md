# Handoff: `archive-intent` moves a shipped intent's folder under `archive/intents/` and leaves every open item's `context.required` path into it pointing at the old place, so plan-lint and the frontier refuse those items

Row 0bp. Met on the first host on 2026-11-25 on its `main` (`6eb7cef7a`), on the build at `a8873ebb`. The tip holds the same `src/`.

## What is wrong

`S/` below is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

1. **The archive moves the folder and frees only the edges.** `archive-intent` (`state-transition.cjs archive-intent`, `S/state-cli.cjs:22`) moves `.specs-inferno/intents/<id>` to `.specs-inferno/archive/intents/<id>` (`moveIntentDirectory`, `S/state-archive.cjs:118-137`, `renameSync` at `:136`). It also removes the id from other intents' `depends_on_intents` (`freeDependencies`, `:69-70`). It reads no other intent's `context.required` or `reads` paths, and no brief.
2. **The path check knows only the live place.** `pathErrors` (`S/run-manifest-paths.cjs:67-73`) passes a path only when it exists in the tree as written. Plan-lint (`S/run-plan-lint.cjs:53`) asks it, and so does the frontier before a dispatch (`S/run-frontier.cjs:28`). So every open item that names a file of the archived intent fails plan-lint, and the frontier does not dispatch it.
3. **The flow already maps the move for one reader.** `evidenceExists` (`S/run-after-ship.cjs:60-67`) finds an after-ship evidence path inside the intent's own folder wherever the intent lives now, because "both hosts archive that dir before they merge". The manifest's paths get no such mapping.

## Evidence

- On the host's main, `fade6f6a3` (2026-11-21T20:18:45Z, "close and archive the intent") moved `maintain-leaves-a-permanent-licence-if-skoft-stops`, with its `oracle-2026-11-20.md`, under `.specs-inferno/archive/intents/`.
- On main `6eb7cef7a`, three open work items still name `.specs-inferno/intents/maintain-leaves-a-permanent-licence-if-skoft-stops/oracle-2026-11-20.md` under `context.required`: `mla-the-store-keeps-one-term-licence-beside-every-bought-one.md:75`, `mlc-the-claims-register-clears-the-maintain-row-once-the-worker-is-live.md:64` and `mlc-the-terms-say-what-maintain-leaves-and-what-ends-if-skoft-stops.md:81`. Two briefs name the same path in prose, at `:43` and `:47`.
- `run.cjs plan-lint`, run on Alpha at about 03:50Z on 2026-11-25 in a throwaway detached worktree of `6eb7cef7a`, exits 2 for `the-app-keeps-one-maintain-licence-and-says-when-its-term-ended` (one finding) and for `the-site-and-the-terms-say-what-maintain-leaves-behind` (two findings). Each finding reads "context.required path does not exist: .specs-inferno/intents/maintain-leaves-a-permanent-licence-if-skoft-stops/oracle-2026-11-20.md, and no item <item> depends on owns it".

## How to fix

1. **The path check finds an archived intent's file where it lives now.** Extract one helper from `evidenceExists` at this second use. It maps `.specs-inferno/intents/<id>/<rest>` to `.specs-inferno/archive/intents/<id>/<rest>` when only the second exists. `pathErrors` uses it, and the dispatch's context manifest names the archived path, so the builder reads the file that exists. With this, the archive changes no spec of an open intent, which may be claimed and running in another tree, and a later fold brings that tree no conflict.
2. **The archive says what it left.** `archive-intent` prints one line per open intent file that names a path into the moved folder, `still named by <file>:<line>`, so the planner can repoint it in its next spec commit. It never refuses, because a refusal would hold the ship.
3. **The tests.** Beside `S/run-plan-lint.test.cjs` and the archive's own test:
   - An open item whose `context.required` names a file of an intent that `archive-intent` then moves passes plan-lint and the frontier's path check, and its manifest names the archived path.
   - A path into the archived folder that the archive does not hold is still a finding.
   - The archive prints the `still named by` line.

## Until it is built

After an archive, a spec-only commit repoints every open intent's `context.required` and `reads` path into the archived folder to `.specs-inferno/archive/intents/<id>/`. The first host did that for these two intents on 2026-11-25.
