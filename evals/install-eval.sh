#!/usr/bin/env bash
# Install eval: install the INFERNO flow into a fresh sandbox for Claude Code +
# Codex with the scripted install, then assert the inferno-flow surfaces exist
# and every bundled flow script suite passes from the installed location.
#
#   evals/install-eval.sh <path-to-specsmd-tarball>   the packed release
#   evals/install-eval.sh --source <path-to-src>      a source checkout, no registry needed
#
# The sandbox goes under $TMPDIR (default /tmp) and is kept for inspection.
set -uo pipefail

usage() { printf 'usage: install-eval.sh <path-to-specsmd-tarball> | --source <path-to-src>\n' >&2; exit 2; }
if [ "${1:-}" = "--source" ]; then
  [ -n "${2:-}" ] || usage
  SOURCE="$(realpath "$2")"
  [ -f "$SOURCE/bin/cli.js" ] || { printf 'no bin/cli.js under %s\n' "$SOURCE" >&2; exit 2; }
  INSTALL=(node "$SOURCE/bin/cli.js" install)
else
  [ -n "${1:-}" ] || usage
  TARBALL="$(realpath "$1")"
  INSTALL=(npx -y --package="$TARBALL" specsmd install)
fi
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/specsmd-install-eval.XXXXXX")"
FAIL=0

note() { printf '%s\n' "$*"; }
req()  { if [ -e "$SANDBOX/$1" ]; then note "OK   $1"; else note "MISS $1"; FAIL=1; fi; }
absent() { if [ -e "$SANDBOX/$1" ]; then note "UNEXPECTED $1"; FAIL=1; else note "OK   (absent) $1"; fi; }

note "sandbox: $SANDBOX"
cd "$SANDBOX"
git init -q

# The scripted install picks the flow and the tools by name, so a new flow in the
# installer's list never moves it onto another one. The budget lookup is pointed
# at an empty data folder: this eval checks the release, not this machine's budget
# script (evals/budget-eval.sh runs a consumer's).
SPECSMD_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 XDG_DATA_HOME="$SANDBOX/.eval-data" INFERNO_FLOW_BUDGET= \
  "${INSTALL[@]}" --flow inferno --tools claude,codex > install.log 2>&1
INSTALL_EXIT=$?
note "--- installer tail ---"; tail -n 12 install.log; note "----------------------"
if [ "$INSTALL_EXIT" -eq 0 ]; then
  note "OK   scripted install exited 0"
else
  note "FAIL scripted install exited $INSTALL_EXIT"; FAIL=1
fi

# Flow tree
req .specsmd/inferno/agents/orchestrator/agent.md
req .specsmd/inferno/agents/orchestrator/config.example.yaml
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/SKILL.md
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/team-scheduler.cjs
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.test.cjs
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/templates/intent-selection.md.hbs
for role in builder builder-cheap builder-escalate planner oracle reviewer reviewer-quality scanner; do
  req ".specsmd/inferno/agents/$role/agent.md"
done
req .specsmd/inferno/agents/builder/skills/workitem-execute/SKILL.md
req .specsmd/inferno/agents/planner/templates/brief.md.hbs
req .specsmd/inferno/agents/planner/templates/work-item.md.hbs
req .specsmd/inferno/README.md
req .specsmd/inferno/README.codex.md
req .specsmd/inferno/check-lock.cjs
req .specsmd/inferno/flow.lock

# Claude Code: every role has its command and its agent wrapper.
for n in inferno inferno-planner inferno-builder inferno-builder-cheap inferno-builder-escalate \
         inferno-config inferno-oracle inferno-reviewer inferno-reviewer-quality inferno-scanner; do
  req ".claude/commands/specsmd-$n.md"
  req ".claude/agents/specsmd-$n.md"
done
# The files under claude/commands/ are Claude command-only: they install as a
# command and never as an agent.
for n in inferno-intents inferno-standards; do
  req ".claude/commands/specsmd-$n.md"
  absent ".claude/agents/specsmd-$n.md"
done

# Codex installs its native project skills and custom agents, not converted
# Claude command bodies under .codex/skills.
for n in inferno inferno-planner inferno-builder inferno-config; do
  req ".agents/skills/specsmd-$n/SKILL.md"
  req ".agents/skills/specsmd-$n/references/procedure.md"
  req ".agents/skills/specsmd-$n/agents/openai.yaml"
done
# These skills are one screen each, so the whole body is the SKILL.md and they
# ship no procedure reference.
for n in inferno-intents inferno-reviewer inferno-reviewer-quality inferno-scanner inferno-standards; do
  req ".agents/skills/specsmd-$n/SKILL.md"
  req ".agents/skills/specsmd-$n/agents/openai.yaml"
  absent ".agents/skills/specsmd-$n/references"
done
# The orchestrator is the session's main thread, so it has no custom agent file.
for n in planner builder_strong builder_cheap builder_escalate config oracle reviewer reviewer_quality scanner; do
  req ".codex/agents/specsmd_inferno_$n.toml"
done
absent .codex/agents/specsmd_inferno_orchestrator.toml
req .codex/rules/claude-build.rules
req AGENTS.md
absent .codex/skills/specsmd-inferno

# Exact host model matrices, as the flow's own pin tests hold them
# (src/__tests__/unit/inferno/inferno-flow.test.ts, codex-installer.test.ts).
# The orchestrator is the main thread and inherits the session's model and
# effort, so its command pins neither.
for key in model effort; do
  if grep -q "^$key:" .claude/agents/specsmd-inferno.md; then
    note "FAIL Claude orchestrator pins $key"; FAIL=1
  else
    note "OK   Claude orchestrator pins no $key"
  fi
done
claude_pin() {
  local file=".claude/agents/specsmd-$1.md"
  if grep -q "^model: $2\$" "$file" && grep -q "^effort: $3\$" "$file"; then
    note "OK   Claude $1 on $2 at $3"
  else
    note "FAIL Claude $1 is not on $2 at $3: $(grep -E '^(model|effort):' "$file" | tr '\n' ' ')"; FAIL=1
  fi
}
codex_pin() {
  local file=".codex/agents/specsmd_inferno_$1.toml"
  if grep -q "^model = \"$2\"\$" "$file" && grep -q "^model_reasoning_effort = \"$3\"\$" "$file"; then
    note "OK   Codex $1 on $2 at $3"
  else
    note "FAIL Codex $1 is not on $2 at $3: $(grep -E '^(model|model_reasoning_effort) =' "$file" | tr '\n' ' ')"; FAIL=1
  fi
}
claude_pin inferno-planner claude-opus-5-5 xhigh
claude_pin inferno-builder claude-opus-5-5 high
claude_pin inferno-builder-cheap claude-sonnet-5-5 high
claude_pin inferno-builder-escalate claude-opus-5-5 xhigh
claude_pin inferno-config claude-sonnet-5-5 high
# The oracle decides what a builder or the orchestrator would otherwise postpone,
# so it is pinned to the frontier tier and never tiered down.
claude_pin inferno-oracle claude-opus-5-5 xhigh
claude_pin inferno-reviewer claude-opus-5-5 xhigh
claude_pin inferno-reviewer-quality claude-opus-5-5 high
claude_pin inferno-scanner claude-opus-5-5 high
codex_pin planner gpt-5.6-sol xhigh
codex_pin builder_strong gpt-6.1-sol xhigh
codex_pin builder_escalate gpt-6.1-sol xhigh
codex_pin builder_cheap gpt-5.6-terra high
codex_pin config gpt-5.6-terra high
# The Codex oracle answers the same judgment calls as the Claude one, so it sits
# on that fleet's frontier tier instead of the builder tier.
codex_pin oracle gpt-6-astra xhigh
codex_pin reviewer gpt-6.1-sol xhigh
codex_pin reviewer_quality gpt-6.1-sol high
codex_pin scanner gpt-6.1-sol high
if grep -rqs '^sandbox_mode[[:space:]]*=' "$SANDBOX/.codex/agents"; then
  note "FAIL Codex agents pin sandbox_mode"; FAIL=1
else
  note "OK   Codex agents inherit parent sandbox"
fi
if grep -rEqs 'gpt[- ]?5([. ]?)5' "$SANDBOX/.specsmd" "$SANDBOX/.claude" "$SANDBOX/.agents" "$SANDBOX/.codex"; then
  note "FAIL obsolete GPT-5.5 setting installed"; FAIL=1
else
  note "OK   no obsolete GPT-5.5 setting"
fi
# The installed builder agent must be the full system prompt with subagent frontmatter
grep -q '^name: specsmd-inferno-builder' "$SANDBOX/.claude/agents/specsmd-inferno-builder.md" \
  && note "OK   builder agent frontmatter (name)" \
  || { note "FAIL builder agent frontmatter (name)"; FAIL=1; }
grep -q 'INFERNO Builder' "$SANDBOX/.claude/agents/specsmd-inferno-builder.md" \
  && note "OK   builder agent carries full body" \
  || { note "FAIL builder agent body missing"; FAIL=1; }
# manifest records the flow
grep -q 'flow: inferno' "$SANDBOX/.specsmd/manifest.yaml" \
  && note "OK   manifest flow: inferno" \
  || { note "FAIL manifest missing flow: inferno"; FAIL=1; }
# Nothing should reference the retired sync script, FIRE-team surfaces, or .specs-fire
if grep -rqs 'sync-claude-agent' "$SANDBOX/.specsmd" "$SANDBOX/.claude"; then
  note "FAIL retired sync-claude-agent still referenced"; FAIL=1
else
  note "OK   no sync-claude-agent references"
fi
if grep -rqs '\.specs-fire' "$SANDBOX/.specsmd"; then
  note "FAIL .specs-fire namespace leaked into installed flow"; FAIL=1
else
  note "OK   no .specs-fire references"
fi
absent .claude/commands/specsmd-fire-team.md
absent .claude/commands/specsmd-fire-team-planner.md
absent .specsmd/fire

# Discover every installed suite, including newly added safety regressions.
shopt -s globstar nullglob
suites=("$SANDBOX"/.specsmd/inferno/agents/**/*.test.cjs)
if [ "${#suites[@]}" -eq 0 ]; then
  note "FAIL no installed flow script suites"; FAIL=1
fi
for suite in "${suites[@]}"; do
  relative="${suite#"$SANDBOX"/}"
  ( cd "$SANDBOX" && node "$relative" ) \
    && note "OK   $relative" || { note "FAIL $relative"; FAIL=1; }
done

if [ "$FAIL" -eq 0 ]; then
  note "INSTALL EVAL: PASS (sandbox kept at $SANDBOX)"
else
  note "INSTALL EVAL: FAIL (inspect $SANDBOX, install.log)"
fi
exit "$FAIL"
