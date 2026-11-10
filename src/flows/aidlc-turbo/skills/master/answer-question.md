# Skill: Answer Question

---

## Role

Lookup skill. Answers questions about this project from the files the flow writes.

**No checkpoint** - this is information, not a decision.

---

## Goal

Answer the question from the artifacts, with the source named. Never from memory, never invented.

---

## Input

- **Required**: the user's question
- **Required**: the artifact root `.specs-aidlc-turbo/`

---

## Process

### 1. Work out what is being asked

Paths are under `.specs-aidlc-turbo/`; `{intent}` is `docs/{inception}/{intent-slug}`.

| Question is about | Look in |
|-------------------|---------|
| Settings (mode, branch, tester, sync) | `repo/config.yaml` |
| Stack, build command, test command | `repo/repo.yaml` |
| Project type, Confluence and Jira links | `project/project.yaml` |
| Tech stack, coding rules, architecture | `repo/standards/` |
| What an intent is for, requirements, decisions, domain model, technical design | `{intent}/brief.md` |
| Why a decision was taken, which answer the user gave | `{intent}/record.yaml` |
| What a story does, its acceptance criteria, its edge cases | `{intent}/stories/{SSS}-*.md` |
| Where a requirement comes from in the documentation | its `sources` ids in `docs/{inception}/register.yaml` |
| What was actually built, which files changed | the **Built** line and the rest of the story's `### Build notes` |
| What changed in one file or part, and why | the **What changed** line of the story's `### Build notes`, and the details of that part on the overview page after the build |
| Where the build deviated from the Code Scaffold, and why | the **Outside the Code Scaffold**, **Different from the Code Scaffold** and **Not built** lines of the story's `### Build notes`, and the overview page after the build |
| Test results of a story | `{intent}/proof/{SSS}.json` |
| Progress, what is next, what is blocked | `node .specsmd/aidlc-turbo/scripts/intent-status.cjs {intent-slug}` |
| Review findings | Nowhere on disk. They are fixed in the code, and the finish summary reports them once |
| Test cases for a tester | `{intent}/tests/`, present only when `tester.enabled` is true, written at finish |
| The overview page | `{intent}/overview.html`, rerender with `node .specsmd/aidlc-turbo/scripts/intent-overview.cjs {intent-slug}` |

### 2. Search

1. Pick the file from the table. Read the frontmatter first, then the section you need.
2. Widen only when that misses: `grep -rn "{keyword}" .specs-aidlc-turbo/`.
3. Requirement ids are `FR-n` and `NFR-n`, decision ids are `D-n`, source ids are `S-nnn`, story ids are three digits. Grep on the id, it is the fastest route.

### 3. Answer

Lead with the answer. Then the source path. Then detail, only if it changes what the user does. Name a requirement, a decision or a statement by what it says, never by its id.

**Not found**: say so plainly, list what you looked in, and offer the thing that would fix it (start an intent, run `project-init`, run the config flow).

---

## Output

```markdown
## {The answer, one or two sentences}

**Source**: `.specs-aidlc-turbo/docs/user-auth/user-auth/brief.md`, the design decision that a refused login answers 403

{Detail, only when it matters}
```

Not found:

```markdown
I could not find anything about "{topic}".

**Looked in**: `docs/user-auth/user-auth/brief.md`, `docs/user-auth/user-auth/record.yaml`, `docs/user-auth/user-auth/stories/`

That decision was probably never written down. `/specsmd-aidlc-turbo-inception` can add it to the record while the intent is a draft.
```

---

## Transitions

- -> **Route Request** (`.specsmd/aidlc-turbo/skills/master/route-request.md`) when the user wants to act on the answer
- -> **Analyze Context** (`.specsmd/aidlc-turbo/skills/master/analyze-context.md`) when the question is really "where do we stand?"
- -> **Explain Flow** (`.specsmd/aidlc-turbo/skills/master/explain-flow.md`) when the question is about the flow rather than about this project
