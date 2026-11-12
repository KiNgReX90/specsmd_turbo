# Codex INFERNO configuration procedure

Configure only `.specs-inferno/config.codex.yaml`. The parent conversation owns display and confirmation; the delegated `specsmd_inferno_config` custom agent applies the approved change.

## Schema

All keys are optional except that a created file should include the Codex role matrix. The orchestrator has no role entry: it is the session's main thread and runs on the session's own model and effort.

```yaml
host: codex

autonomy:
  level: review

roles:
  planner:
    agent: specsmd_inferno_planner
    model: <pin>
    reasoning_effort: <pin>
  builder_strong:
    agent: specsmd_inferno_builder_strong
    model: <pin>
    reasoning_effort: <pin>
  builder_escalate:
    agent: specsmd_inferno_builder_escalate
    model: <pin>
    reasoning_effort: <pin>
  config:
    agent: specsmd_inferno_config
    model: <pin>
    reasoning_effort: <pin>
  builder_cheap:
    agent: specsmd_inferno_builder_cheap
    model: <pin>
    reasoning_effort: <pin>
  oracle:
    agent: specsmd_inferno_oracle
    model: <pin>
    reasoning_effort: <pin>
  reviewer_quality:
    agent: specsmd_inferno_reviewer_quality
    model: <pin>
    reasoning_effort: <pin>

verification:
  finalize:
    - <ordered shell command>
  finalize_scopes:
    "<one finalize command>": ["<path glob>"]
  lint:
    - <lint or analysis command>

worktree:
  bootstrap:
    - <command run once in a fresh intent worktree>

dispatch:
  constraints:
    - "<line pasted verbatim into every builder and tester dispatch>"

delivery:
  mode: auto-close
  base_branch: <confirmed branch>

halt:
  flag_file: <optional path>
  wait_script: <optional path>

knowledge:
  index: <optional path>

real_app:
  paths: ["<glob of a helper or case text that drives the real app>"]
  prove: <optional command>
```

Allowed values:

- `host`: `codex`. `run.cjs` reads this file as the Codex host's by its name when the key is absent, and a role the file omits falls back to its Codex agent.
- `autonomy.level`: `review` or `full`. Accepted for compatibility; the planner never pauses either way.
- `delivery.mode`: `auto-close` or `merge-request`.
- `verification.finalize`: ordered non-empty command strings when present.
- `verification.finalize_scopes`: a map from one of those commands to the path globs that make it worth running. An unlisted command always runs.
- `verification.lint`: ordered lint and analysis commands the quality reviewer runs once per item review, in the worktree. It takes over only what they report on lines the item added.
- `worktree.bootstrap`: ordered commands run inside a fresh intent worktree before the first dispatch.
- `dispatch.constraints`: machine rules pasted verbatim into every builder and tester dispatch.
- `delivery.base_branch`: a real branch confirmed by the user.
- halt paths and knowledge index: project-relative paths when present.
- `real_app.paths`: globs of the helpers and case texts that drive the real app binary, which builders update and the reviewer checks. This file inherits the key from `.specs-inferno/config.yaml` when it sets none.
- `real_app.prove`: one command that runs the journeys an item changed on the real app binary. `verify-item` runs it with `INFERNO_JOURNEYS`, a file listing those paths, records the run in the item's proof and fails on a red, and the item's review waits for that run. It needs `real_app.paths` and is inherited with it.
- `mutate.session`: for tests that run through a wrapper on another machine, the regex that marks such a test command and the wrapper's `open`, `send`, `run` and `close` commands, so the runner's mutants that share a test command share one session of it. `mutate.run`: the wrapper every mutant test runs through, with `{tree}` and `{test}` as its two parts, so a reviewer writes the bare test. `mutate.checks`: the host's checks, each a regex of its command and of the line it prints on a finding, so a red check that printed that line reads caught. `config.example.yaml` documents each. This file inherits the whole `mutate` block from `.specs-inferno/config.yaml` when it sets none.

Role and agent names above are fixed. An existing `<pin>` stays unless the user changes it; a created one copies `model` and `model_reasoning_effort` from `.codex/agents/<agent>.toml`. There is no writer role: the planner writes its own work items, so a `roles.writer` block from an older config is dropped.

## Parent-thread review

1. Read applicable `AGENTS.md` instructions and the current Codex config if it exists.
2. If absent, discover likely production build and full-test commands from project manifests and discover the repository default branch. Treat discoveries as proposals, not confirmed choices.
3. Display effective settings in plain language:
   - the roles and their pins;
   - ordered final verification commands, and any path scopes that let one be skipped;
   - worktree bootstrap commands and the machine rules pasted into every dispatch;
   - delivery mode and proposed base branch;
   - optional halt and knowledge integrations.
4. Ask one compact confirmation question. If the user requests changes, show the revised effective values and confirm them. Keep this interaction in the parent conversation.
5. After confirmation, spawn `specsmd_inferno_config` with an exact approved value map, repository root, target path, and this procedure path. Do not delegate an unresolved choice.

## Delegated write

1. Read the target file when it exists.
2. Validate the approved values against the schema and verify any configured path or command source that can be checked without running a heavy build.
3. Preserve unknown top-level and nested keys, comments, and existing settings the user did not change.
4. Use a focused `apply_patch`; do not rewrite the entire file when a local edit is sufficient.
5. Write no file other than `.specs-inferno/config.codex.yaml`.
6. Parse the result using the project's available YAML parser or configuration consumer. Also confirm with `rg` that the file declares `host: codex`, that every role names its exact `agent` and its pins as approved, and that no `writer` role remains.
7. Return:

```yaml
status: configured
path: .specs-inferno/config.codex.yaml
validated: true
notes:
```

On invalid input or parse failure, return `status: failed`, `validated: false`, and a bounded error in `notes`. Do not leave a knowingly invalid partial configuration.

## First-run gate

The planner invokes this skill before planning when the Codex config is absent. The orchestrator invokes it before execution when absent. After configuration succeeds, return control to the original parent flow; configuration itself never captures, plans, or builds an intent.
