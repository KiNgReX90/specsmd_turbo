#!/usr/bin/env bash
# Drives the INFERNO orchestrator headlessly over the seeded intent, through to the ship.
# COSTS REAL TOKENS. The work clone is the line setup-sandbox.sh printed.
#
#   evals/e2e/run-e2e.sh <sandbox-work-dir> [model]    model: the orchestrator's, else $E2E_MODEL, else sonnet
#
# The host starts as the planner A/B build starts the orchestrator (evals/planner-ab/hosts.cjs
# buildArgv): this machine's hooks, plugins and the user's own instructions file stay out, the
# tools a build calls are allowed with no prompt, and the slash command goes to stdin. The intent
# worktree opens beside the clone, so the sandbox folder is added as a working directory. The
# stream and stderr go beside the clone, never into it, so the primary checkout stays clean.
set -uo pipefail
WORK="$(realpath "${1:?usage: run-e2e.sh <sandbox-work-dir> [model]}")"
MODEL="${2:-${E2E_MODEL:-sonnet}}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="$(dirname "$WORK")"

mapfile -d '' ARGV < <(node -e 'process.stdout.write(require(process.argv[1]).buildArgv(process.argv[2]).map((arg) => `${arg}\0`).join(""))' \
  "$HERE/../planner-ab/hosts.cjs" "$MODEL")
[ "${#ARGV[@]}" -gt 0 ] || { echo "no host command from evals/planner-ab/hosts.cjs" >&2; exit 2; }

# The budget lookup points where setup-sandbox.sh pointed the install: no script, so the claim skips it.
cd "$WORK"
echo "/specsmd-inferno toy-math" | \
  SPECSMD_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 INFERNO_FLOW_BUDGET="$BASE/.eval-data/specsmd-inferno/flow-text-budget.py" \
  "${ARGV[@]}" --add-dir "$BASE" > "$BASE/e2e-transcript.jsonl" 2> "$BASE/e2e-stderr.log"
status=$?
echo "exit=$status model=$MODEL (transcript: $BASE/e2e-transcript.jsonl)"
exit "$status"
