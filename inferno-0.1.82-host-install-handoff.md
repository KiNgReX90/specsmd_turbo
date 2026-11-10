# INFERNO 0.1.82 does not install on Skoft_CRA

Found 2026-11-10 while preparing the 0.1.81 to 0.1.82 reinstall of Skoft_CRA from
`inferno-improvement` at b41af916. Nothing was fixed in the flow.

## 1. The flow text is over the host's per-role word ceilings (blocks the install)

What is wrong. 0.1.82 grows the standing text of five roles past the ceilings of the
host budget script (`budget.script` in `.specs-inferno/config.yaml`,
`~/.local/share/skoft-agent-hooks/flow-text-budget.py`). The installer refuses and rolls
back. The same script refuses the commit in the host pre-commit hook, refuses
`run.cjs claim`, and fails the host test `scripts/flow-text-budget.test.mjs`, which every
gate runs under `npm run test:definitions`. 0.1.81 fits on the same host files. All growth
is in flow-owned files: CLAUDE.md, the host part of AGENTS.md and `dispatch.constraints`
did not change.

Evidence. `specsmd install --flow inferno --tools claude,codex` in the host exits 1:

| role | 0.1.81 | 0.1.82 | ceiling | grown file (0.1.81 to 0.1.82 words) |
|---|---|---|---|---|
| claude builder | 3991 | 4075 | 4000 | `.claude/agents/specsmd-inferno-builder-escalate.md`, now the largest variant, 2428 (builder was 2344) |
| claude orchestrator | 4899 | 5064 | 5000 | `.specsmd/inferno/agents/orchestrator/agent.md` 3285 to 3449 |
| claude planner | 4486 | 4539 | 4500 | `.claude/agents/specsmd-inferno-planner.md` 3111 to 3164 |
| codex orchestrator | 4627 | 5035 | 5000 | `.agents/skills/specsmd-inferno/references/procedure.md` 2762 to 3151 |
| codex planner | 4402 | 4705 | 4500 | planner `SKILL.md` 413 to 521, `references/procedure.md` 2343 to 2519 |
| codex builder | 3258 | 3411 | 4000 | ok |

The AGENTS.md managed block also grew from 171 to 190 words and counts toward every Codex role.

How to fix. Displace words in the flow text, never raise the ceiling: every builder
variant at or under 2353 words, orchestrator `agent.md` at or under 3385, the Claude planner
at or under 3125, the Codex orchestrator skill plus procedure at or under 3406, the Codex
planner toml plus skill plus procedure at or under 2906 (all with today's host charters). The likely sources are the new
per-item rules (quality lens, mutant proposals, ladder, grant, oracle route) restated in
prose where a script refusal or the printed next line already carries them. Add an eval
that installs into a copy of a consumer's charter files and runs its budget script, so the
next release meets this before a consumer does.

## 2. Seven more host tests that pin the flow go red

What is wrong. With the 0.1.82 install applied, the host's `npm run test:definitions`
(run on Delta, log `proof/remote-host-tests.clean.log` of the compatibility run) fails 8 of 7054 tests: the
budget test above and seven that pin the installed flow. Every intent gate runs this suite,
so the install cannot land until each is reconciled, either by putting the pinned rule back
in the flow text or by updating the host test in the same commit:

- `scripts/specs-inferno-builder.test.mjs:32` the builder's Token discipline lost "plan the round before you issue it".
- `scripts/specs-inferno-planner.test.mjs:116` the planner no longer says the orchestrator reruns probes with `run.cjs probes`.
- `scripts/specs-inferno-launcher.test.mjs:39` and `scripts/specs-inferno-codex.test.mjs:187` the planner launcher command no longer names `specsmd-inferno-oracle`.
- `scripts/specs-inferno-codex.test.mjs:328` nine Codex custom agents, the host expects eight (new `specsmd_inferno_reviewer_quality`).
- `scripts/specs-inferno-codex.test.mjs:385` two new Codex skills (`specsmd-inferno-reviewer-quality`, `specsmd-inferno-standards`) the host list does not hold.
- `scripts/integrate-on-base.test.mjs:142` integrate on main with no unpushed commit now runs every scoped check instead of skipping it, the intended 0.1.82 change; the host test still expects the skip.

The first three are rules the host asked the flow to carry, so the flow side is the likely fix
there; the last three are host updates that belong in the install commit.

## 3. The flow's YAML reader turns a commented list item into a map

What is wrong. `run-lib.cjs parseYaml` (0.1.81 and 0.1.82) reads
`- path  # note: text` as `{"path  # note": "text"}`. YAML reads it as `"path"`. An
`ownership.editable` entry with such a comment then throws `ERROR [OWNERSHIP] Ownership
requires a path`, which names neither the item nor the entry.

Evidence. Skoft_CRA intent `the-confirmed-launch-findings-are-fixed-before-the-freeze`,
`work-items/w2-a-private-repository-is-never-sent-to-osv.md` line 156:
`- src-tauri/src/storage/migrations_component_version_purl_tests.rs  # firewall grant: lead ...`.
0.1.82 `run.cjs frontier` on that tree exits 2 with that error (0.1.81 stops earlier on a
stale probe). `ownedBy` throws the same in both versions, so `verify-item` and `integrate`
of that item refuse too. Reproduce:
`node -e "console.log(JSON.stringify(require('<scripts>/run-lib.cjs').parseYaml('e:\n  - a.rs  # g: x\n')))"`.

How to fix. In the plain-scalar list item branch, cut a comment that starts at whitespace
plus `#` outside quotes before looking for `key: value`, as YAML does. Make the ownership
refusal name the item, the file and the raw entry.

## 4. The install eval installs the ideation flow, not INFERNO

What is wrong. `evals/install-eval.sh` presses Down four times to reach INFERNO, but the
installer now lists six flows (fire, aidlc, aidlc-turbo, simple, ideation, inferno), so it
lands on ideation and every INFERNO check reads MISS.

Evidence. On Delta at b41af916 the sandbox's `.specsmd/manifest.yaml` reads
`flow: ideation`, `EVAL_EXIT=1`, and Beta shows the same MISS list (log
`proof/remote-eval-delta.log` of the compatibility run).
The scripted install (`specsmd install --flow inferno --tools claude,codex`) of the same
source installs 278 files and writes the lock.

How to fix. Drive the eval with the scripted install, or derive the keystroke count from
the position of `inferno` in `src/lib/constants.js` FLOWS.
