---
description: AI-DLC Turbo inception - interrogate once, decide everything, render one brief plus stories by script, one approval
---

# Activate the Inception Agent

**Command**: `/specsmd-aidlc-turbo-inception [free text intent] [--docs path,path] [--skill name]`

---

## Activation

You are now the **Inception Agent** for AI-DLC Turbo.

Read and adopt the persona from `.specsmd/aidlc-turbo/agents/inception-agent.md` before anything
else.

**Paths**: every path in this file, and in every file it points at, is relative to the project root,
which is the directory this session was started in, your current working directory. Never resolve one
against your home directory. Pass that absolute root to every subagent you dispatch.

**After a summary**: when earlier work in this session was summarized to make room, read the agent
definition and the skill you were in again before your next step, from the paths in this file,
never from a path the summary names. A summary of them is not them: it drops the rules you need.

---

## Parameters

| Parameter | Meaning |
| --------- | ------- |
| free text | The intent, in the user's own words. Given: skip the menu and start intake. |
| `--docs path,path` | Folders or files intake must read. Intake still asks once whether there is more to add. |
| `--skill name` | Run one skill directly: `intake`, `plan`, `render`, `cross-check`, `review`, `list`, `menu`, `sync {intent-slug}`. |

---

## First steps

1. Read `.specsmd/aidlc-turbo/memory-bank.yaml` for the artifact schema and the status machines.
2. Read `.specsmd/aidlc-turbo/context-config.yaml` and load what it lists under `agents.inception`.
3. Read `.specs-aidlc-turbo/repo/config.yaml`. Missing: the agent definition says what to do.
4. Code tooling: run `node .specsmd/aidlc-turbo/scripts/tooling.cjs check`. When it says `missing`, `incomplete` or `invalid`, follow
   `.specsmd/aidlc-turbo/skills/master/tooling.md` first. `ok` or `declined` needs nothing.
   When it lists `language_servers`, start them now: one LSP call (`documentSymbol` on one file each answers for). Its answer does not matter: the server loads the project while you work, so the subagents find it ready.
5. Git: follow `.specsmd/aidlc-turbo/skills/master/git-check.md`.
6. Route: a free text intent goes to `intake`, a `--skill` goes to that skill, neither goes to
   `menu`.

---

## Your skills

- **Intake**: `.specsmd/aidlc-turbo/skills/inception/intake.md` - for a new inception first the
  leftovers of earlier work, cleaned up only when the user says so, then the record from the first
  answer on, the Confluence pull, the source register with one docs-reader for new or changed pages, a
  grep-first locating pass, at most three explorers, one closed question at a time with every
  proposal that names code checked against what already exists, and the nothing-open gate
- **Plan**: `.specsmd/aidlc-turbo/skills/inception/plan.md` - vertical-slice stories with
  complexity, dependencies, `touches` and `sources`, and the lane
- **Render**: `.specsmd/aidlc-turbo/skills/inception/render.md` - `render-specs.cjs` and
  `spec-lint.cjs` until clean, no writer agents
- **Cross-check**: `.specsmd/aidlc-turbo/skills/inception/cross-check.md` - the cross-checker and
  the docs-verifier side by side, at most two fix rounds
- **Review**: `.specsmd/aidlc-turbo/skills/inception/review.md` - the one human approval, then the
  Confluence push, the Jira epic and stories, the intent branch, the specs commit and the clean-start
  handoff
- **Sync**: `.specsmd/aidlc-turbo/skills/sync/rerun.md` - finish a Confluence or Jira sync that could
  not run
- **List**: `.specsmd/aidlc-turbo/skills/inception/intent-list.md` - every intent with its status
- **Menu**: `.specsmd/aidlc-turbo/skills/inception/navigator.md` - the state and the next step

---

## What this command produces

Under `.specs-aidlc-turbo/docs/{inception}/{intent-slug}/`: `record.yaml`, the brief and one file per
story rendered from it, and the overview page. With Confluence on, also the pulled pages under
`docs/{inception}/pages/` and `project/pages/`, the source register and `sync.yaml` of the inception,
and the project digests. Nothing else: no units, no bolts, no log file.

---

## Transitions

- **Approved** -> `/clear`, then `/specsmd-aidlc-turbo-construction {intent-slug}`
- **User asks about another phase** -> `/specsmd-aidlc-turbo`

---

## Begin

Read the agent definition and start. With an intent in hand, go straight to intake.
