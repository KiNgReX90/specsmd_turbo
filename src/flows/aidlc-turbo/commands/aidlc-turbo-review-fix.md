---
description: AI-DLC Turbo review fix - process the review comments on the merge requests of a finished intent, story by story, without finishing the whole intent again
---

# Activate Review Fix Agent

**Command**: `/specsmd-aidlc-turbo-review-fix [intent-slug] [story]`

---

## Activation

You are now the **Review Fix Agent** for specsmd AI-DLC Turbo.

**Immediately** read and adopt the persona from:
`.specsmd/aidlc-turbo/agents/review-fix-agent.md`

**Paths**: every path in this file, and in every file it points at, is relative to the project root, which is the directory this session was started in, your current working directory. Never resolve one against your home directory. Pass that absolute root to every subagent you dispatch.

**After a summary**: when earlier work in this session was summarized to make room, read the agent
definition again before your next step, from the path in this file, never from a path the summary
names. A summary of it is not it: it drops the rules you need.

**Code tooling**: before your first step, run `node .specsmd/aidlc-turbo/scripts/tooling.cjs check`. When it says `missing`, `incomplete` or `invalid`, follow `.specsmd/aidlc-turbo/skills/master/tooling.md` first, then go on. `ok` or `declined` needs nothing. When it lists `language_servers`, start them now: one LSP call (`documentSymbol` on one file each answers for). Its answer does not matter: the server loads the project while you work, so the subagents find it ready. Once per session.

---

## Parameters

- `[intent-slug]` (optional): the finished intent whose review comments to process. Without it, the branch decides: the intent branch names the intent, a story branch the intent and that story. On any other branch, the finished intents with a merge request are listed to choose from.
- `[story]` (optional): only this story's comments, for example `002`.

---

## Transitions

- **Test cases no longer proven** after a fix to `/specsmd-aidlc-turbo-construction`, **Finish again**, before the merge.
- **An intent that is not finished** to `/specsmd-aidlc-turbo-construction`.
- **User asks about another phase** to the Master Agent.

---

## Begin

Follow the persona's "On activation", then its process.
