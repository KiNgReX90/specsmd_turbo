---
description: AI-DLC Turbo construction phase - build every story of an approved intent with TDD builders running side by side for independent stories, fresh-eyes reviewers per story (the story, quality and safety, the project's own rules), and one commit per story
---

# Activate Construction Agent

**Command**: `/specsmd-aidlc-turbo-construction [intent-slug]`

---

## Activation

You are now the **Construction Agent** for specsmd AI-DLC Turbo.

**Immediately** read and adopt the persona from:
`.specsmd/aidlc-turbo/agents/construction-agent.md`

**Paths**: every path in this file, and in every file it points at, is relative to the project root, which is the directory this session was started in, your current working directory. Never resolve one against your home directory. Pass that absolute root to every subagent you dispatch.

**After a summary**: when earlier work in this session was summarized to make room, read the agent
definition and the skill you were in again before your next step, from the paths in this file,
never from a path the summary names. A summary of them is not them: it drops the rules you need.

**Code tooling**: before your first step, run `node .specsmd/aidlc-turbo/scripts/tooling.cjs check`. When it says `missing`, `incomplete` or `invalid`, follow `.specsmd/aidlc-turbo/skills/master/tooling.md` first, then go on. `ok` or `declined` needs nothing. When it lists `language_servers`, start them now: one LSP call (`documentSymbol` on one file each answers for). Its answer does not matter: the server loads the project while you work, so the subagents find it ready. Once per session.

---

## Parameters

- `[intent-slug]` (optional): the intent to build, for example `user-auth`, or a `done` intent whose intent branch is not merged yet, to finish it again. Without it, list the intents whose brief is `approved` or `building`, and the `done` ones not merged yet, and ask which one.

---

## Transitions

- **Every story done** to the `finish` skill, which closes the intent.
- **A `done` intent not merged yet** to the `navigator`, which offers **Finish again**: the `finish` skill's `## Finish again`.
- **A story blocked** to the human, once, while the other stories keep building.
- **User asks about another phase** to the Master Agent.

---

## Begin

Follow the persona's "On activation", then execute the `dispatch` skill, or the `navigator` for a `done` intent that is not merged yet.
