# Brief Template

The intent brief: one file per intent at `.specs-aidlc-turbo/docs/{inception}/{intent-slug}/brief.md`.

`render-specs.cjs` renders it from the intent's `record.yaml` (`record-template.yaml`). It is the only
design document in the flow: a decision lives here or in a story, nowhere else.

To change the brief, change the record and render again. `spec-lint.cjs` flags a brief that differs
from its record. Later steps write only the frontmatter state fields (`status`, `approved`,
`completed`, `mode`, `branch`, and at finish `merge_request` or `pushed_to_base`)
and `## Lessons`; a render keeps those.

Every section appears in this order. A section with nothing in it reads `None.`, never an empty
heading, and nothing reads `TBD` or `TODO`.

---

## Frontmatter

```yaml
---
id: user-auth
title: User authentication
inception: user-auth
status: draft
lane: full
created: 2026-09-22
approved: null
completed: null
mode: null
branch: null
docs_input: []
---
```

| Field | Meaning |
| ----- | ------- |
| `id` | `{intent-slug}`, matches the folder name |
| `title` | Title of the intent, one line, in the record's language (`intent.language`); the overview page shows it |
| `inception` | The inception folder the intent sits in |
| `status` | `draft`, `approved`, `building` or `done` |
| `lane` | `full`, or `quick` for at most 2 stories, none hard, no conflicting sources |
| `created` | Date the record was started (`YYYY-MM-DD`) |
| `approved` | Date of the human approval, `null` until then |
| `completed` | Date construction finished, `null` until then |
| `mode` | Snapshot of `config.mode` taken at approval (`production` or `sandbox`), `null` until then |
| `branch` | The intent branch, made at the approval in both modes, for example `shop/intent-user-auth/intent`. `null` until then. Every later step reads the branch from here, never from the folder name |
| `merge_request` | The intent branch's open merge request, written by `push-branch.cjs` at finish. Absent until then, and absent in sandbox with `sandbox_finish: push` |
| `pushed_to_base` | Only in sandbox with `sandbox_finish: push`: the base branch the finished intent went onto, written by `push-branch.cjs` at finish. Absent until then. The commit it pushed is in the script's output only |
| `docs_input` | The folders and files intake read |

---

## Body

```markdown
# {title}

## Intent

{One paragraph in the record's language: what is built, why, for whom. No implementation detail.}

## Requirements

- **FR-1**: {One testable sentence.} Sources: S-001
- **FR-2**: {One testable sentence.} Sources: user
- **NFR-1**: {One testable sentence, with the number in it.} Sources: S-002, code (src/auth/session.ts)

## Design decisions

- **D-1**: {The decision.} Reason: {why}. Dropped: {the alternative that was rejected}.
- **D-2**: {A decision whose record source is `assumption`.} Reason: {why}. Dropped: {the alternative}. Assumption: no code backs it.

## Domain model

{The entities the stories touch, their relationships and their invariants. Only what is touched.}

| Entity | Key fields | Invariant |
| ------ | ---------- | --------- |
| {name} | {fields} | {what always holds} |

## Technical design

- **Modules and layers touched**: {names}
- **APIs or endpoints**: {method, path, request, response}
- **Data changes and migrations**: {tables, columns, migration approach}
- **Error handling**: {which errors surface where, and how}
- **Where new code goes**: {paths}
- **Integration points**: {external systems and existing subsystems}

### Code Scaffold

{summary of the drawing}

#### {lane name, for example Server}

- **{module}** (module, {status}) `{path}`: {what}
  - Follows: `{file}:{lines}`, {note}
  - Registered in: `{file}:{lines}`
  - **{part}** ({kind}, {status}) `{path}:{lines}`: {what}
    - Extends: {class}
    - Implements: {interface}
    - Follows: `{file}:{lines}`, {note}
    - Deviates: {deviates}
    - Right ({new or existing}): {short}. {what} In `{file}:{lines}`. Decision: {D-n}.
    - Source: {S-nnn}
    - Open choice: {open} {open_detail}
    - Confidence: {green, orange or red}. {the reasons}
- **{part without a module}** ({kind}, {status}) `{path}:{lines}`: {what}
  - Confidence: {green, orange or red}. {the reasons}

#### Links

- **{part}** -> **{part}** (builds on): {label} `{code}`, proof `{file}:{lines}` ({note}), adds: {adds}

## Codebase reading list

| File | Lines | Why |
| ---- | ----- | --- |
| src/auth/login.ts | 18-96 | The current login path the new flow extends |

## Standards deltas

{Rules that add to or override `.specs-aidlc-turbo/repo/standards/` for this intent, with the reason. Else: None.}

## Verification

- `{exact build command}`
- `{exact test command}`

## Lessons

{Empty at inception: None. Construction adds one line per project quirk a finding taught, for every later story.}

## Story map

| Story | Title | Depends on | Requirements | Tester verifiable | DB tables |
| ----- | ----- | ---------- | ------------ | ----------------- | --------- |
| 001 | {title} | - | FR-1 | yes | users |
| 002 | {title} | 001 | FR-2, NFR-1 | no | - |
```

`Sources` are register ids (`S-nnn`) from `docs/{inception}/register.yaml`, or `user`, or
`code (path)`.

`### Code Scaffold` closes `## Technical design` only when the record has
`technical_design.drawing`: one `####` per lane (its name and the confidence reasons in the
record's language) with its modules and their parts, parts without a module after them, then the
links. It is the starting point of the code, not a source of truth. A
part shows only the notes it has; `(builds on)` marks a `builds_on` link. A link ends in its proof in
the code and what the change to the callee adds, each only when it has it. The confidence follows from the evidence by the rules in
`scripts/lib/design-model.cjs`.

---

## Status values

| Status | Meaning |
| ------ | ------- |
| `draft` | Rendered, not yet approved |
| `approved` | The human approved it at the inception review |
| `building` | Construction has dispatched its first story |
| `done` | Construction finished and the intent review passed |
