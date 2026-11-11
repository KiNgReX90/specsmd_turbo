#!/usr/bin/env bash
# Budget eval: install the INFERNO flow into a copy of a consumer's repository and
# hold it to that consumer's own flow text budget, charter files included.
#
#   evals/budget-eval.sh <path-to-specsmd-tarball> --consumer <dir>
#   evals/budget-eval.sh --source <path-to-src> --consumer <dir>
#
# The consumer folder holds what the host keeps beside the flow: its charter files
# (CLAUDE.md, AGENTS.md), its .specs-inferno/config.yaml with `budget.script`, and
# that script. The eval copies it into a sandbox under $TMPDIR (default /tmp), runs
# the scripted install for Claude Code and Codex there, which runs the budget
# script and refuses when a role is over its ceiling, then runs the script once
# more for the full per-role readout. It fails when the install refuses, when the
# script does, or when the consumer names no budget script.
#
# evals/fixtures/acme-shop is an invented consumer whose ceilings are its own charter
# words plus the flow-side ceilings of src/__tests__/unit/inferno/text-budget.test.ts.
set -uo pipefail

usage() { printf 'usage: budget-eval.sh [--source <path-to-src> | <path-to-specsmd-tarball>] --consumer <dir>\n' >&2; exit 2; }
SOURCE= TARBALL= CONSUMER=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) [ -n "${2:-}" ] || usage; SOURCE="$(realpath "$2")"; shift 2 ;;
    --consumer) [ -n "${2:-}" ] || usage; CONSUMER="$(realpath "$2")"; shift 2 ;;
    -*) usage ;;
    *) TARBALL="$(realpath "$1")"; shift ;;
  esac
done
[ -n "$CONSUMER" ] || usage
[ -n "$SOURCE" ] || [ -n "$TARBALL" ] || usage
[ -z "$SOURCE" ] || [ -z "$TARBALL" ] || usage
[ -f "$CONSUMER/.specs-inferno/config.yaml" ] || { printf 'no .specs-inferno/config.yaml under %s\n' "$CONSUMER" >&2; exit 2; }
if [ -n "$SOURCE" ]; then
  [ -f "$SOURCE/bin/cli.js" ] || { printf 'no bin/cli.js under %s\n' "$SOURCE" >&2; exit 2; }
  INSTALL=(node "$SOURCE/bin/cli.js" install)
else
  INSTALL=(npx -y --package="$TARBALL" specsmd install)
fi

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/specsmd-budget-eval.XXXXXX")"
FAIL=0
note() { printf '%s\n' "$*"; }

note "sandbox: $SANDBOX"
note "consumer: $CONSUMER"
cp -a "$CONSUMER/." "$SANDBOX/"
cd "$SANDBOX"
git init -q

# Only the consumer's own config may name the budget script: the fallback lookup
# is pointed at an empty data folder, so a script of this machine never stands in.
SPECSMD_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 XDG_DATA_HOME="$SANDBOX/.eval-data" INFERNO_FLOW_BUDGET= \
  "${INSTALL[@]}" --flow inferno --tools claude,codex > install.log 2>&1
INSTALL_EXIT=$?
note "--- installer tail ---"; tail -n 12 install.log; note "----------------------"

if grep -q 'SKIP budget' install.log; then
  note "FAIL the consumer's .specs-inferno/config.yaml names no budget.script, so nothing was counted"; FAIL=1
elif [ "$INSTALL_EXIT" -ne 0 ]; then
  note "FAIL the install refused (exit $INSTALL_EXIT):"; FAIL=1
  # The installer boxes the refusal; print its lines plain so a long list of roles is whole.
  sed -n 's/^[│|][[:space:]]*\(.*[^[:space:]]\)[[:space:]]*[│|]$/     \1/p' install.log
else
  note "OK   the install ran the consumer's budget script and kept the flow"
  # The same lookup the installer and a claim use, from the installed flow.
  SCRIPTS=.specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts
  BUDGET="$(node -e '
    const fs = require("fs");
    const path = require("path");
    const dir = path.resolve(process.argv[1]);
    const { parseYaml } = require(path.join(dir, "run-yaml.cjs"));
    const { resolveBudget } = require(path.join(dir, "run-budget.cjs"));
    const found = resolveBudget(parseYaml(fs.readFileSync(".specs-inferno/config.yaml", "utf8")), process.cwd());
    if (!found.script) { console.error(found.missing || found.skip); process.exit(1); }
    console.log(found.script);
  ' "$SCRIPTS")"
  if [ -z "$BUDGET" ]; then
    note "FAIL the installed flow resolves no budget script from the consumer's config"; FAIL=1
  else
    note "--- $BUDGET ---"
    python3 "$BUDGET" --repo "$SANDBOX"
    BUDGET_EXIT=$?
    if [ "$BUDGET_EXIT" -eq 0 ]; then
      note "OK   every role is at or under the consumer's ceiling"
    else
      note "FAIL the consumer's budget script exited $BUDGET_EXIT"; FAIL=1
    fi
  fi
fi

if [ "$FAIL" -eq 0 ]; then
  note "BUDGET EVAL: PASS (sandbox kept at $SANDBOX)"
else
  note "BUDGET EVAL: FAIL (inspect $SANDBOX, install.log)"
fi
exit "$FAIL"
