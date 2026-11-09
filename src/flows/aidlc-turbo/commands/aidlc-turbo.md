---
description: AI-DLC Turbo master - reads the project state and routes to config, project-init, inception or construction
---

# AI-DLC Turbo

**Command**: `/specsmd-aidlc-turbo`

This is the entry point of the AI-DLC Turbo flow. It never builds anything itself, it points you at the command that does.

**Paths**: every path in this file, and in every file it points at, is relative to the project root, which is the directory this session was started in, your current working directory. Never resolve one against your home directory.

**After a summary**: when earlier work in this session was summarized to make room, read the agent
definition and the skill you were in again before your next step, from the paths in this file,
never from a path the summary names. A summary of them is not them: it drops the rules you need.

---

## Activation

Read and adopt the persona in `.specsmd/aidlc-turbo/agents/master-agent.md`, then follow the steps below.

---

## First steps

1. **Layout**. The old layout is moved first: run `node .specsmd/aidlc-turbo/scripts/migrate-layout.cjs` (a dry run: it moves nothing, and it knows every old name). When it prints anything other than `already has the new layout. Nothing to move.`, show that to the user, and after the user agrees run it again with `--write`.
2. **Config**. Read `.specs-aidlc-turbo/repo/config.yaml`. If it does not exist, run the `/specsmd-aidlc-turbo-config` flow inline (display the defaults, ask "Use these, or adjust?", write the file), then continue. Never stop the session for this.
3. **Code tooling**. Run `node .specsmd/aidlc-turbo/scripts/tooling.cjs check`. When it says `missing`, `incomplete` or `invalid`, follow the `tooling` skill (`.specsmd/aidlc-turbo/skills/master/tooling.md`): it proposes the language servers, analysis and lint tools that fit this codebase and sets them up with the user, or helps install what this machine lacks. `ok` or `declined` needs nothing. When it lists `language_servers`, start them now: one LSP call (`documentSymbol` on one file each answers for). Its answer does not matter: the server loads the project while you work, so the subagents find it ready.
4. **Project setup**. Read `.specs-aidlc-turbo/project/project.yaml` and list `.specs-aidlc-turbo/repo/standards/`. If either is missing, offer the `project-init` skill (`.specsmd/aidlc-turbo/skills/master/project-init.md`): set up the standards first (a short scan plus a few questions) or go straight to the first feature. When `sync.docs` is `confluence`, say in the same offer that the user can paste the link of their shared project page on Confluence (`sync.page_names.project`, default `Project Documentation`), so the standards start from it. A pasted link is the answer to set them up: pass it to project-init. The user may decline and continue without standards.
5. **State**. Run the `analyze-context` skill (`.specsmd/aidlc-turbo/skills/master/analyze-context.md`).
6. **Route**. Run the `route-request` skill (`.specsmd/aidlc-turbo/skills/master/route-request.md`) and hand the user one concrete command.

---

## Skills

- **Project Init**: `.specsmd/aidlc-turbo/skills/master/project-init.md` - codebase scan plus the standards conversation
- **Analyze Context**: `.specsmd/aidlc-turbo/skills/master/analyze-context.md` - phase detection, runs automatically
- **Code Tooling**: `.specsmd/aidlc-turbo/skills/master/tooling.md` - language servers, analysis and lint tools: proposed from the codebase, chosen with the user, installed on this machine
- **Git Check**: `.specsmd/aidlc-turbo/skills/master/git-check.md` - a git repository with a first commit, asked when the folder has none
- **Route Request**: `.specsmd/aidlc-turbo/skills/master/route-request.md` - the next command
- **Explain Flow**: `.specsmd/aidlc-turbo/skills/master/explain-flow.md` - how the flow works
- **Answer Question**: `.specsmd/aidlc-turbo/skills/master/answer-question.md` - questions about an intent, a story or the standards

---

## Routing targets

- **Old layout** -> `migrate-layout.cjs`, then route again
- **New feature or idea** -> `/specsmd-aidlc-turbo-inception`
- **Brief still `draft`** -> `/specsmd-aidlc-turbo-inception` (resume that intent)
- **Brief `approved` or `building`** -> `/specsmd-aidlc-turbo-construction {intent-slug}`
- **Brief `done`, intent branch not merged yet** -> `/specsmd-aidlc-turbo-construction {intent-slug}` (**Finish again**)
- **Review comments on a `done` intent not merged yet** -> `/specsmd-aidlc-turbo-review-fix {intent-slug}` (**Handle the review comments**)
- **Settings** -> `/specsmd-aidlc-turbo-config`
- **Questions** -> `explain-flow` or `answer-question`

---

## Begin

Read the agent file, then start at step 1.
