#!/usr/bin/env bash
# Reproduces the measured ground truth of this intent's brief on a throwaway repo.
# usage: bash runner-defects.sh <empty scratch dir> [<scripts dir>]
# The scripts dir defaults to the flow source of the checkout this file sits in.
set -u
SCRATCH=${1:?usage: runner-defects.sh <empty scratch dir> [<scripts dir>]}
HERE=$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)
S=${2:-$HERE/src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts}
export XDG_CACHE_HOME=$SCRATCH/cache
cd "$SCRATCH" || exit 2
git init -q --bare -b main origin.git
git init -q -b main work
cd work || exit 2
git config user.email p@example.com
git config user.name p
mkdir -p src docs .specs-inferno
echo a > src/a.txt
echo d > docs/d.md
printf 'verification:\n  integrate:\n    - "echo from-repo-config"\n    - "true"\n  finalize_scopes:\n    "true":\n      - "src/**"\ndelivery:\n  base_branch: main\n' > .specs-inferno/config.yaml
printf 'verification:\n  integrate:\n    - "echo from-run-config"\ndelivery:\n  base_branch: main\n' > .specs-inferno/config.remote.yaml
printf 'intents:\n' > .specs-inferno/state.yaml
git add -A && git commit -qm init
git remote add origin ../origin.git
git push -q origin main

echo "== (a) a commit on main that changed src/, origin one behind"
echo b > src/a.txt && git commit -qam change
node "$S/run.cjs" integrate --tree . ; echo "exit $?"

echo "== (a) the same with doubles configured"
printf 'doubles:\n  pattern: "FAKE"\n  paths: ["src/**"]\n' >> .specs-inferno/config.yaml
git commit -qam doubles
node "$S/run.cjs" integrate --tree . ; echo "exit $?"
git reset -q --hard HEAD~1

echo "== (b) a pending review file another reviewer is writing, outside every scope"
mkdir -p .specs-inferno/intents/x/reviews && echo "item: y" > .specs-inferno/intents/x/reviews/y.yaml
node "$S/run.cjs" integrate --tree . ; echo "exit $?"
rm .specs-inferno/intents/x/reviews/y.yaml

echo "== (b) ownedBy on the collapsed untracked directory git status prints"
node -e 'const o=require(process.argv[1]);console.log(o.ownedBy("src/new/",["src/new/a.ts"]), o.ownedBy("src/new/a.ts",["src/new/a.ts"]))' "$S/run-owned.cjs"

echo "== (e) a call with --config, then the same call without it"
node "$S/run.cjs" integrate --tree . --config .specs-inferno/config.remote.yaml | head -1
node "$S/run.cjs" integrate --tree . | head -1
