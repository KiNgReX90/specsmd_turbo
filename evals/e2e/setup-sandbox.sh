#!/usr/bin/env bash
# Builds the E2E sandbox: a bare origin and a work clone with the INFERNO flow
# installed for Claude Code and the toy-math intent seeded. Prints the work clone.
#
#   evals/e2e/setup-sandbox.sh <path-to-specsmd-tarball>   the packed release
#   evals/e2e/setup-sandbox.sh --source <path-to-src>      a source checkout, no registry needed
#
# The sandbox goes under $TMPDIR (default /tmp); the install log sits beside the clone.
set -euo pipefail

usage() { printf 'usage: setup-sandbox.sh <path-to-specsmd-tarball> | --source <path-to-src>\n' >&2; exit 2; }
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
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="$(mktemp -d "${TMPDIR:-/tmp}/specsmd-e2e.XXXXXX")"
ORIGIN="$BASE/origin.git"; WORK="$BASE/work"

git init -q --bare -b main "$ORIGIN"
git init -q -b main "$WORK"
cd "$WORK"
git remote add origin "$ORIGIN"
# An invented identity, so no person's name lands in a sandbox commit.
git config user.name "Acme Eval"
git config user.email "eval@example.invalid"
cat > package.json <<'EOF'
{
  "name": "toy-math",
  "version": "1.0.0",
  "private": true,
  "scripts": { "test": "node --test tests/*.test.js" }
}
EOF
git add -A && git commit -qm "chore: scaffold toy project"

# The scripted install picks the flow and the tool by name. The budget lookup is pointed at an
# empty data folder, as in install-eval.sh: the smoke checks the release, not this machine.
SPECSMD_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 XDG_DATA_HOME="$BASE/.eval-data" INFERNO_FLOW_BUDGET= \
  "${INSTALL[@]}" --flow inferno --tools claude > "$BASE/install.log" 2>&1 \
  || { echo "install failed; see $BASE/install.log" >&2; exit 1; }
test -f .claude/commands/specsmd-inferno.md || { echo "install wrote no orchestrator command; see $BASE/install.log" >&2; exit 1; }

# Seed the intent, its three work items, the ledger and the config.
SPECS=.specs-inferno; INTENT="$SPECS/intents/toy-math"
mkdir -p "$INTENT/work-items"
cp "$HERE/fixtures/state.yaml" "$SPECS/state.yaml"
cp "$HERE/fixtures/config.yaml" "$SPECS/config.yaml"
cp "$HERE/fixtures/brief.md" "$INTENT/brief.md"
for item in add-add add-mul add-calc; do cp "$HERE/fixtures/$item.md" "$INTENT/work-items/$item.md"; done
git add -A && git commit -qm "chore: install INFERNO flow and seed toy-math intent"
git push -q -u origin main
echo "$WORK"
