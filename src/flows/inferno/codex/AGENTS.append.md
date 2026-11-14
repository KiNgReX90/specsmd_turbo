## Codex and INFERNO activation

- Use `$specsmd-inferno-planner` to capture, repair or decompose an intent;
  its parent skill owns questions and the configuration gate before delegation.
- Use `$specsmd-inferno-config` to create, review or update
  `.specs-inferno/config.codex.yaml`; confirmation stays in this conversation.
- Use `$specsmd-inferno` to select, execute or resume a planned intent;
  selection stays in this conversation before orchestrator delegation.
- Use `$specsmd-inferno-intents` to list intents without selecting, claiming or starting one.
- Use `$specsmd-inferno-standards` to draft the rule files under
  `.specs-inferno/standards/`; the owner approves them in this conversation.
- Treat legacy slash-command wording as intent to invoke the matching Codex
  skill, never as a reason to read or execute another host's command file.
- Only the orchestrator dispatches `specsmd_inferno_builder_strong`,
  `specsmd_inferno_builder_cheap` and `specsmd_inferno_builder_escalate`, each
  with a complete assignment, and no worker spawns nested agents.
- Every INFERNO worker is a `spawn_agent` subagent of this session with
  `fork_turns: "none"`, never a separate Codex process.
- Codex roles use `.specs-inferno/config.codex.yaml`; Claude-specific files and
  `.specs-inferno/config.yaml` remain a separate host surface.
