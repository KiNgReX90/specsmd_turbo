---
name: specsmd-inferno-planner
description: Capture, reconcile, and decompose INFERNO intents into dependency-safe work items. Use to create a new intent, repair an incomplete plan, or prepare .specs-inferno artifacts before execution.
---

# specsmd Inferno Planner

Create executable intent artifacts; never start their build.

## Required workflow

1. Read `references/procedure.md` completely before acting.
2. Read applicable `AGENTS.md` files and, when present, `.specs-inferno/state.yaml` and `.specs-inferno/config.codex.yaml`.
3. If first-run configuration is absent, complete the `$specsmd-inferno-config` display-and-confirm gate first.
4. Spawn the `specsmd_inferno_planner` custom agent with the user's planning goal, repository root, procedure path, constraints and existing authorization.
5. The planner makes every planning decision, renders every artifact itself, and alone updates state.
6. Lint each planned intent with `node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs plan-lint <intent-id> --config .specs-inferno/config.codex.yaml`; on exit 2 resume the planner with every line it printed, as one message, and lint again until it exits 0. Only then cross-check it with `node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs scan --plan <intent-id> --config .specs-inferno/config.codex.yaml`. Its pass gives each cut of the plan one cross-checker: spawn every dispatch line it prints, one message per group it names, then run the collect it prints. Exit 0 sends the plan to build. Exit 2 names a gaps file: resume the planner with every GAP line in it as one message, then run the scan call the collect prints, a fix round with one cross-checker over those findings and what the repair changed. There are at most two fix rounds, and the plan is never checked whole again. After the second the collect prints the oracle call for each finding still open: grade its impact `high <clause>: <line>` (`data`, `security`, `money`, `contract`, `reach`) or `low: <line>`, run the call, spawn the agent it prints with the GAP line, the tree and the paths it names, and resume the planner with each decision as written. A plan that builds on an unmerged intent is not checked: its cross-check waits for that merge, then runs against the real tree. Act on the triage verdict below, then return the planning summary and stop; `$specsmd-inferno` builds an intent.

Use the canonical templates by path and preserve their artifact contracts.

## The triage verdict

The planner reports `Triage: direct` or `Triage: intent, because <the letter and one clause>` on its first line, and never asks the user anything.

1. On `Triage: direct`, build it, without asking anybody. When the user asked for an intent, first say in one line that none is needed because no criterion holds; never wrap it as one. A batch is never such a change, so the planner returns it as an intent.
2. On a host with `integration/TEST-CASES.md`, land every reserved tester case id before any build starts, in one call: `node scripts/tester/reserve-cases.mjs --intent <intent-id> TC-<n> "<title>" [...]`. Exit 2 is a collision and prints the next free id; resume the planner with the replacement id.
3. Send a recipe marked `hard: yes`, and any `oracle` block, to the `specsmd_inferno_oracle` custom agent first; its decision goes into the builder's assignment as written.
4. Dispatch each direct recipe to the `specsmd_inferno_builder_strong` custom agent with the recipe's own lines. Neither the oracle nor the planner builds anything.
