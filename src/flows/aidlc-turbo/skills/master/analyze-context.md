# Skill: Analyze Context

---

## Role

Diagnostic skill. Works out which phase the project is in by reading the files on disk, and names the next action.

**No checkpoint** - this is information, not a decision.

---

## Goal

Say where the project stands and what to do next, with the evidence that led there.

---

## Input

- **Required**: the artifact root `.specs-aidlc-turbo/`
- **Optional**: `.specsmd/aidlc-turbo/scripts/intent-status.cjs` for the active intent

---

## Process

### 1. Read the six things that decide the phase

| Check | Path |
|-------|------|
| Old layout | `node .specsmd/aidlc-turbo/scripts/migrate-layout.cjs` (a dry run) prints more than `already has the new layout. Nothing to move.` |
| Config | `.specs-aidlc-turbo/repo/config.yaml` |
| Standards | `.specs-aidlc-turbo/repo/standards/` (at least `tech-stack.md`) |
| Project facts | `.specs-aidlc-turbo/project/project.yaml` |
| Git | `git rev-parse --show-toplevel` prints the project root, and `git rev-parse --verify --quiet HEAD` finds a commit |
| Intents | `.specs-aidlc-turbo/docs/*/*/record.yaml` and `docs/*/*/brief.md` (the brief's frontmatter only) |

Read the brief frontmatter of every intent: `id`, `title`, `inception`, `status`, `branch`. An intent with a record and no brief yet is a `draft`.

For every `done` intent with a `branch`, in both modes, check whether its intent branch is merged into the base branch yet, and whether each of its test cases is proven, both as `.specsmd/aidlc-turbo/skills/construction/finish.md` says under `## Finish again`. One that is not merged yet can be finished again, which the user knows as **Finish again**. A `done` intent without a `branch` was built by the old sandbox mode without git: it is finished for good.

### 2. Determine the phase

Take the first rule that matches, top to bottom:

| Evidence | Phase | Next action |
|----------|-------|-------------|
| The old layout | **migrate** | `node .specsmd/aidlc-turbo/scripts/migrate-layout.cjs`, then `--write` once the user agrees |
| No `repo/config.yaml` | **configure** | Run the config flow, then re-analyze |
| No `repo/standards/` or no `project/project.yaml` | **initialise** | Run `project-init` |
| No git repository, or one without a commit | **git** | Run `.specsmd/aidlc-turbo/skills/master/git-check.md`, then re-analyze. Inception and construction need git in both modes |
| Every brief is `done`, and one that is not merged yet has a test case that is not proven, or is not pushed yet (the brief has no `merge_request` and no `pushed_to_base`) | **finish again** | `/specsmd-aidlc-turbo-construction {intent-slug}`, which offers **Finish again** |
| No intents, or every brief is `done` | **start an intent** | `/specsmd-aidlc-turbo-inception` |
| A record or brief with status `draft` | **resume inception** | `/specsmd-aidlc-turbo-inception` |
| A brief with status `approved` or `building` | **construction** | `/specsmd-aidlc-turbo-construction {intent-slug}` |

When more than one intent is unfinished, the active one is the `building` intent; if none is building, it is the `approved` one with the oldest `created` date; if none is approved, it is the `draft` one with the oldest `created` date. Name the others in the evidence so the user can pick another.

Name every `done` intent that is not merged yet in the evidence too, with **Finish again**, whatever the phase, so the user can pick it.

### 3. Read the active intent

When an intent is `approved` or `building`, run:

```bash
node .specsmd/aidlc-turbo/scripts/intent-status.cjs {intent-slug}
```

It prints every story with its id, title, status and dependencies, plus the frontier (the todo stories whose dependencies are all done) and the blocked stories. Use its numbers, do not count the story files yourself. Exit code 1 means the intent does not exist: check the slug you passed.

For a `draft` intent, run `node .specsmd/aidlc-turbo/scripts/spec-lint.cjs {intent-slug}` when a brief exists and report its findings; with only a record, say inception stopped during intake.

---

## Output

```markdown
## Project state

- **Phase**: {migrate | configure | initialise | git | finish again | start an intent | resume inception | construction}
- **Active intent**: {intent-slug} ({title}) or "none"
- **Branch**: {branch from the brief} or "none yet"

### Evidence

- Config: {mode production/sandbox, with sandbox_finish in sandbox, tester on/off} or "missing"
- Standards: {which files exist} or "missing"
- Intents: {count} ({inception}/{intent-slug}: status, ...)
- Not merged yet: {intent-slug}, **Finish again** ({n} test cases not proven), or "none"

### Stories

| Story | Title | Status | Depends on |
|-------|-------|--------|------------|
| 001 | ... | done | - |
| 002 | ... | building | 001 |

- **Ready to build now**: 003, 004
- **Blocked**: none

### Next step

{one concrete command}
```

Leave out the story table when there is no active intent. Keep the whole report short; the user wants the next command, not an inventory.

---

## Transitions

- -> **Route Request** (`.specsmd/aidlc-turbo/skills/master/route-request.md`) to hand over the command
- -> **Answer Question** (`.specsmd/aidlc-turbo/skills/master/answer-question.md`) when the user asks about a detail instead
