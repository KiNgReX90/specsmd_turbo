---
description: INFERNO Planner launcher - plan one statement, then build what comes back direct
argument-hint: "[the statement, or the doc that holds it]"
---

# Plan one statement, then build what comes back direct

**Command**: `/specsmd-inferno-planner [statement]`

Arguments: `$ARGUMENTS`. That text is the statement, and it reaches the planner verbatim.

---

## What you are

You are the launcher. The planner writes the plan and you do everything after it: the calls it hands back, the tester ids it reserves, the builder, the commit and the checks. You run on this session's own model and effort, so nothing here pins one.

Run one verification at a time and never start a second while one is running.

---

## 1. Spawn the planner

Dispatch one `specsmd-inferno-planner` subagent with the statement verbatim. It pins its own model and effort. Never plan inline, whatever the statement asks for: this session never reads the tree or writes the brief.

The planner triages before it captures and returns, in this order: a `Triage: direct | intent` line, an `Intent PLANNED` block per intent, `reserve:` lines, `direct:` recipes and `oracle:` paragraphs. A `direct:` recipe carries labelled lines `change`, `files`, `test` (file :: assertion), `proof`, `grade`, `hard` (yes or no) and `measured`.

After capture, for each `Intent PLANNED` block, run `node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs plan-lint <intent-id>`. Exit 2 prints one finding per line: resume the planner with every line as one message and lint again until it exits 0. Only then run `node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs scan --plan <intent-id>`, the cross-check of the plan's meaning. Its pass gives each cut of the plan one cross-checker: spawn every dispatch line it prints in one message, then run the collect it prints. Exit 0 sends the plan to build. Exit 2 names a gaps file: resume the planner with every GAP line in it as one message, then run the scan call the collect prints, a fix round with one cross-checker over those findings and what the repair changed. There are at most two fix rounds, and the plan is never checked whole again. After the second the collect prints the oracle call for each finding still open: grade its impact `high <clause>: <line>` (`data`, `security`, `money`, `contract`, `reach`) or `low: <line>`, run the call, spawn the agent and model it prints with the GAP line, the tree and the paths it names, and resume the planner with each decision as written; then the plan goes to build. A plan that builds on an unmerged intent is not checked: its cross-check waits for that merge, then runs against the real tree.

## 2. The `oracle:` paragraphs

Each is a call the planner could not decide. Ask the oracle of the builder's fleet on the route two grades set, headless or not: run `node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs dispatch-log <intent-id> --tier oracle --impact "<grade>: <line>" --complexity "<grade>: <line>"`, adding `--config .specs-inferno/config.codex.yaml` when a Codex builder will build it. Grade impact as above; complexity is `high asker` at the planner's default pin, `claude-opus-5-5` at xhigh, else `high readings`, `high subsystems` or `low`. Spawn the agent and model it prints with the planner's paragraph as written, plus the tree and the paths it names. Only both grades high take `models.oracle_hard`, and only where the host sets it; no route asks the user. When the oracle returns `blocked` because the artifact does not settle the call, run the call again with `--blocked <dispatch_id>` and complexity `high earlier: <line>`. When that refuses, write the question and its readings to `.specs-inferno/halt-notes/<intent-id>.md`, leave the scope it gates unplanned and go on with the rest.

Resume the planner with the decision as written. A `user` verdict reaches the user in the two sentences the oracle wrote, and nothing else in the run does. You never answer an oracle question yourself.

## 3. The `reserve:` lines

On a host with `integration/TEST-CASES.md`, the planner may return them. Each line reads `reserve: TC-<n> <title> for <intent-id>/<item-id>`. Land every one of them on the default branch before the plan is handed over, so no other plan can take the same id:

```bash
node scripts/tester/reserve-cases.mjs --intent <intent-id>/<item-id> TC-<n> "<title>"
```

One call carries every id and title of that item. Then commit on the default branch in place with the message `Reserve TC-<n> for <intent-id>` and push. Exit 2 is a collision: it prints `taken TC-<n>, next free TC-<k>` and writes nothing, so rerun with the replacement id and resume the planner with it, so the brief and the item carry the id that landed.

## 4. `Triage: direct`, build it

A direct recipe is built, here, now. Nobody is asked: the statement is the authorisation, and the triage decides the shape. The one statement that stops at the plan is one that explicitly asks for a plan or a decomposition and no build; say the plan is written and stop.

A recipe with `hard: yes` takes the route of step 2 first, and the decision goes into the assignment as written. Then dispatch ONE `specsmd-inferno-builder` subagent on `models.strong` from `.specs-inferno/config.yaml`. This launcher dispatches rather than builds, because this session has not read the recipe's files. Never drop a direct build to the cheap tier. The assignment carries the orchestrator's dispatch fields:

- work item id `direct/<slug>` and intent `direct`;
- the tree: this primary checkout, on the default branch;
- the recipe verbatim as the item, `change` and `measured` included;
- `context.required` from its `files` line, plus the pattern and test files it names;
- `ownership.editable` exactly the `files` line;
- the `test` line as the test that goes red first and green after;
- the verification budget: that test and the cheap checks by name from `verification.integrate` in `.specs-inferno/config.yaml`;
- `dispatch.constraints` from that config, pasted verbatim;
- the result contract, and that a builder never commits.

When the statement asked for an intent and the handoff opens `Triage: direct`, tell the user in one line that no intent is needed because no triage criterion holds, then build the recipe as above. Never resume the planner to wrap it as an intent. A batch is never such a change, so the planner returns it as an intent. The request is not a reason an `INTENT.` line may cite, whoever makes it: `state-transition.cjs check` refuses a reason that names no triage criterion.

## 5. Integrate the direct build

1. Scope review: `git diff --stat`, every changed file inside the recipe's `files` line, every claim in the builder's `notes` grepped in the tree.
2. One commit on the default branch in place.
3. `node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs integrate` on this primary checkout. It folds origin in and runs the cheap checks, each one skipped when the landing touched none of the trees it reads. It opens no browser: the browser suite runs once per intent at finalize.
4. Push.

A red at any step goes back to the same builder as a correction, warm, with the failing command. Never patch a builder's work by hand. Then report one line: what was built and that it is on the default branch.

## 6. Hand the readout over

An intent the planner wrote stays unclaimed: this command never claims one and never orchestrates. The user builds it later with `/specsmd-inferno`.

The readout ends with the planner's own blocks, unedited. Never switch this checkout off the default branch. Isolated work belongs in a linked worktree, which is the orchestrator's job.
