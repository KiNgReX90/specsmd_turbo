# Story Template

One story per file at `.specs-aidlc-turbo/docs/{inception}/{intent-slug}/stories/{SSS}-{story-slug}.md`.

A story is a vertical slice: one behaviour, end to end, verifiable on its own. It is one builder
session, roughly 8 files at most. Layers are not stories: the repository, the endpoint and the
screen that serve one behaviour are one story, not three.

The file has two halves. The product team reads the half above the rule, in the record's language
(`intent.language`: the language of the session the inception ran in); the builder and the reviewer
read the English half below it. Both halves are always present. The headings and the fixed words of
the product half come from the string table of that language (`md` in `templates/lang/{code}.json`,
or the project's own `.specs-aidlc-turbo/repo/lang/{code}.json`); the example below is in English.

`render-specs.cjs` renders every story from the intent's `record.yaml`. To change a story, change the
record and render again. `spec-lint.cjs` flags a story that differs from its record. Later steps
write only the frontmatter state fields (`status`, `completed`, `commit`, `branch`,
`changed_files`) and `### Build notes`; a render keeps those.

---

## Frontmatter

```yaml
---
id: "003"
title: Login with expired password
intent: user-auth
status: todo
depends_on: []
requirements: [FR-2, NFR-1]
sources: [S-003, S-007]
touches: [src/auth/login.ts, src/auth/login.test.ts]
tester_verifiable: true
observed_via: [ui, db, none]
break_test: true
surface: ui
db_tables: [users, login_attempts]
test_data: ["users: login s003-*", "login_attempts: of those users"]
complexity: medium
created: 2026-09-22
completed: null
commit: null
branch: null
---
```

| Field | Meaning |
| ----- | ------- |
| `id` | 3-digit story number as a quoted string, matches the filename prefix |
| `title` | Title in the record's language, one line, no trailing punctuation |
| `intent` | The intent id this story belongs to |
| `status` | `todo`, `building`, `review`, `done` or `blocked` |
| `depends_on` | Story ids that must be done first, for example `["001", "002"]`. Acyclic. |
| `requirements` | The brief requirement ids this story delivers, at least one |
| `sources` | The register ids (`S-nnn`) this story delivers |
| `touches` | The repo-relative files the story will change or create. Two stories that can build at the same time never share one |
| `tester_verifiable` | Derived by `render-specs.cjs`, never chosen: `true` when at least one criterion has `observed_via` other than `none`. Per the classification of `plan.md` step 3b a tester can verify screen behaviour, database state and record changes, log output and API responses, never code-level facts such as unit tests, internal functions or classes, coverage, refactors or a build that passes |
| `observed_via` | Where a tester checks each acceptance criterion, one value per criterion in order: `ui`, `api`, `db`, `log` or `none` (see Observed-via values). Absent on a story rendered before the field: construction then judges each criterion on its text |
| `break_test` | `true` when a user puts something in or changes something through the story, and at least one criterion is observed via `ui` or `api`. Finish lets the breaker attack it, in both modes. `false` when the record leaves it out |
| `surface` | Where the change lives in the code: `ui`, `api`, `job`, `data` or `none`. It never decides what a tester checks |
| `db_tables` | Tables the behaviour writes, empty list when none |
| `test_data` | The records this story's tests create or change, each with the key that keeps them its own (for example a `s003-` prefix). Empty list when the tests write nothing |
| `complexity` | `low`, `medium` or `hard`. It picks the builder: `low` gets the low builder, `medium` and `hard` the builder. A `hard` is split during planning unless it cannot be cut into slices that each verify on their own. |
| `created` | Date the story was first rendered (`YYYY-MM-DD`) |
| `completed` | Date the story reached `done`, `null` until then |
| `commit` | Commit sha of the story's commit, written when the story lands. `null` until then |
| `branch` | The story's own branch when story branches are on (production only), written by `story-complete.cjs`. `null` otherwise |
| `merge_request` | The story's open merge request, written by `push-branch.cjs` at finish, after the approval, when story branches are on. Absent until then |
| `changed_files` | The repo-relative files the story really changed, written at land by `story-land.cjs` (through `story-complete.cjs`). Absent until then. `intent-status.cjs` reads it for `shared_files` |

---

## Body

```markdown
# S{SSS}: {title}

## For the product team

**As** {role}, **I want** {goal}, **so that** {benefit}.

### Why this story

{Why this story exists, only when the record gives a why.}

### Acceptance criteria

- **Given** {starting situation} **when** {action} **then** {visible result} *(tester: screen)*
- **Given** {starting situation} **when** {action} **then** {result in the database} *(tester: database)*
- **Given** {starting situation} **when** {action} **then** {result} *(tester: none, {why_none})*

### Out of scope

- {What this story leaves out on purpose, or: None.}

---

## For the agent

### Context to read

| File | Lines | Why |
| ---- | ----- | --- |
| src/auth/login.ts | 18-96 | The path this story changes |

### Design

{Pointers to the brief decisions this story honours (D-n), the module or layer it lives in, the data
changes it makes, the API shape it exposes or consumes.}

### Code Scaffold

{summary of the story's drawing}

#### Builds

- **{part}** ({kind}, {status}) `{path}:{lines}`: {what this story builds there}
  - Extends: {class}
  - Implements: {interface}
  - Follows: `{file}:{lines}`, {note}
  - Deviates: {deviates}
  - Right ({new or existing}): {short}. {what} In `{file}:{lines}`. Decision: {D-n}.
- **{module}** (module, {status}) `{path}`: {what this story builds there}
  - Follows: `{file}`, {note}
  - Registered in: `{file}:{lines}`
- **{part}** ({kind}, changed, new in story {NNN}) `{path}`: {what this story builds there}
  - Extends, Implements and Right as above; the example, the deviation and the registration stay with story {NNN}

#### Uses

- **{part}** ({kind}, {status}) `{path}:{lines}`: {what}

#### Links

- **{part}** -> **{part}**: {label} `{code}`, proof `{file}:{lines}` ({note}), adds: {adds}

### Implementation notes

{Concrete steps and constraints. Names of the classes, functions and routes to create or change.}

### Edge cases and errors

| Case | Expected behaviour |
| ---- | ------------------ |
| {case} | {what the system does} |

### Test plan

- Unit: {what is unit tested}
- Integration or e2e: {what is covered end to end. A Playwright spec when the project ships Playwright and a criterion is observed via `ui`, next to the project's own specs, never under `aidlc-twins/`: that folder belongs to the test writer at finish.}
- Verification command: `{exact command}`
- Integration with S{SSS} {title of that story}: {the test, run against that earlier story's real code, never a mock of it}

### Build notes

{None. at inception. The builder fills it: decisions taken during the build, files changed, tests added, and last the five lines **Built**, **What changed** (per file, what changed and why), **Outside the Code Scaffold**, **Different from the Code Scaffold** and **Not built**.}
```

`### Code Scaffold` is there only when the record has a drawing: the story's own part of it,
what it builds (never an existing part), what it only uses, and the links between those. A part
shows only the notes it has; a link its proof in the code and what the change adds, when it has
them. The builder builds what it names at the path it names, after the example it follows unless
it says why it deviates.

The `Integration with` lines come last, one per entry of the story's `integration` in the record: a
test with an earlier story this one overlaps (a shared table, class or rule), which `depends_on`
lands first. The record's `short`, `slice` and `overview` never reach the story: the overview page
reads them from the record.

---

## Status values

| Status | Meaning |
| ------ | ------- |
| `todo` | Planned, not started |
| `building` | A builder is working on it |
| `review` | Built, waiting for the fresh-eyes reviewers |
| `done` | Reviewed and accepted |
| `blocked` | Conflicts with the brief, a requirement is missing, or three misses. The one place construction asks a human. |

---

## Acceptance criterion line

Each criterion is one bullet, never numbered, and ends in a tester note: `*(tester: {label})*` with
the label of its `observed_via` in the record's language, and for `none` the reason after a comma.

```markdown
- **Given** {given} **when** {when} **then** {then} *(tester: screen)*
- **Given** {given} **when** {when} **then** {then} *(tester: none, {why_none})*
- **Given** {given} **when** {when} **then** {then} *(tester: none, covered by S005 {title of 005})*
```

`none` needs exactly one of `why_none`, a sentence in the record's language that says why a tester cannot check it, or
`covered_by`, the id of another story of this intent whose test case covers it, a story with at least
one criterion that is not `none`. A `why_none` holds no parenthesis: the overview page reads the note
up to the first `)`.

---

## Observed-via values

Where a tester checks a criterion. When several apply, the first in the order `ui`, `api`, `db`,
`log` wins: a screen that shows a job's log is `ui`.

| Value | Label (en) | Meaning |
| ----- | ----- | ------- |
| `ui` | `screen` | Any part of the check runs on a screen: the user starts it there or sees the result there, also when the code lives in a job, a query or a migration |
| `api` | `API` | The tester calls an endpoint and reads the answer; no screen shows it |
| `db` | `database` | The tester checks a record, a field or a status in the database; no screen or API shows it |
| `log` | `log` | The tester reads it in a log that no screen shows |
| `none` | `none` | A tester cannot check it: code level, or another story's test case covers it |

---

## Surface values

Where the change lives in the code; it never decides what a tester checks.

| Surface | Meaning |
| ------- | ------- |
| `ui` | Screen code |
| `api` | An endpoint or a message handler |
| `job` | A scheduled or background job |
| `data` | A migration, a query, a stored procedure or a data change |
| `none` | A library change or a refactor |
