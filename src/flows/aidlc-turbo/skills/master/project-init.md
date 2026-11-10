# Skill: Project Init

---

## Role

Setup skill. Scans the codebase, then facilitates the project standards through a guided conversation.

**No checkpoint** - initialization is a setup process. Each standard is confirmed on its own while you write it.

---

## Goal

Give every agent in this flow the context it needs: what this repo is built with (`repo/repo.yaml`), what kind of project it is (`project/project.yaml`) and how code in it should look (`repo/standards/`).

---

## Input

- **Required**: `.specsmd/aidlc-turbo/templates/standards/catalog.yaml` - which standards exist, what they decide, and in which order
- **Required**: `.specsmd/aidlc-turbo/scripts/codebase-scan.cjs` - the stack detector
- **Optional**: a project type hint from the user ("full-stack web app", "backend API")
- **Optional**: the link to the shared project page on Confluence (`sync.page_names.project`, default `Project Documentation`), pasted at the offer, or
  `project_docs_url` already in `.specs-aidlc-turbo/project/project.yaml`
- **Optional**: standards that already exist under `.specs-aidlc-turbo/repo/standards/`

---

## Process

### 0. Scan the codebase

Run:

```bash
node .specsmd/aidlc-turbo/scripts/codebase-scan.cjs --write
```

This writes the `codebase:` block into `.specs-aidlc-turbo/repo/repo.yaml` (creating the file when it does not exist) and prints it. Show the detected stack to the user as the starting point, not as the answer:

```markdown
## What I found in this codebase

- **Languages**: java, TypeScript
- **UI**: jsp, thymeleaf
- **Backend**: java, spring
- **Tests**: junit, vitest
- **Playwright**: no
- **Build**: `mvn -q -DskipTests package`
- **Test**: `mvn -q test`
```

Settle the build and test commands yourself before you show them; never ask the user for them. The scan reads only the root build file, so check its guess against the build files of the modules and the CI config (`.gitlab-ci.yml`, `.github/workflows/`), and write the corrected values into `repo/repo.yaml` under `codebase.commands`, keeping the rest of the `codebase:` block. Show the block as information, not as a question: the user corrects it when something is wrong. Every inception still settles the verification commands for the modules its intent touches.

On an empty or brand-new project the scan finds little. That is fine: leave the commands empty, the first inception settles them.

### 0b. Read the shared project documentation

Only when there is a link (the user pasted it, or `project_docs_url` is set) and `sync.docs` in
`.specs-aidlc-turbo/repo/config.yaml` is `confluence`. Dispatch the
sync agent (`specsmd-aidlc-turbo-sync`) with `.specsmd/aidlc-turbo/skills/sync/confluence.md`, the
absolute project root, mode `project` and the link. It checks that the page is the shared project
page (`sync.page_names.project`), writes its link into `project/project.yaml` as `project_docs_url`, so the first
inception never asks for it, and pulls the tree into `.specs-aidlc-turbo/project/pages/`.

- `needs_input`: ask its question with the multiple-choice prompt and dispatch it again with the
  `answer`. The user may also skip it; then go on without the pages.
- `no_tools`: say the Atlassian tools are not connected, go on without the pages, and name that the
  first inception pulls them once they are.

Read the pulled pages that decide anything the standards cover: the stack, the architecture, the
conventions, the data, the screens, the APIs. Every standard below then starts from what the pages
already decide: propose it, name the page, and ask only what the pages leave open. Where a page and
the scan disagree, show both and let the user choose.

### 1. Load the standards catalog

Read `.specsmd/aidlc-turbo/templates/standards/catalog.yaml`:

- which standards exist and how important each one is
- the decisions inside each standard
- the dependencies between standards
- the project type presets

### 2. Determine the project type

Ask, using the host's multiple-choice prompt where one exists (on Claude Code: AskUserQuestion), otherwise a numbered list:

```markdown
## Project setup

What kind of project is this?

1. **Full-stack web app** - frontend plus backend plus database
2. **Backend API** - API service, no frontend
3. **Frontend app** - SPA or server-rendered frontend
4. **CLI tool** - command-line application
5. **Library** - reusable package or module
6. **Other** - tell me more
```

Propose the option the scan points at, do not ask blind.

The project type decides which standards are required, which are recommended, and which are skipped.

**Write it straight away** into `.specs-aidlc-turbo/project/project.yaml`, keeping every key already there (step 0b or the Confluence sync may have written `project_docs_url`, the config `jira_project_url`):

```yaml
project_type: full-stack-web
initialized_at: 2026-09-22T10:00:00Z
```

The scan's `codebase:` block stays in `repo/repo.yaml`. Inception reads both files.

### 3. Check for existing standards

Read `.specs-aidlc-turbo/repo/standards/`. If files are already there, ask whether to review and update them or start fresh. Never overwrite a standard without asking.

### 4. Facilitate each standard

For every required and recommended standard:

1. Load the facilitation guide named in the catalog (`templates/standards/{standard}.guide.md`).
2. Follow that guide's discovery questions. Do not invent your own. A question the pulled project pages already answer is proposed with that answer and its page, not asked blind.
3. Adapt to the user: brief with an expert, explanatory with a newcomer.
4. Summarize the choices and get approval before saving.
5. Write the file to the catalog's `output_path`, in the guide's output format.

### 5. Order

Follow the dependency order from the catalog:

1. **tech-stack** - no dependencies
2. **coding-standards** - depends on tech-stack
3. **data-stack** - depends on tech-stack (recommended when the project has a database)
4. **system-architecture** - depends on tech-stack (optional)
5. **ux-guide** - depends on tech-stack (optional)
6. **api-conventions** - depends on tech-stack (optional)

Never write a standard before its dependencies exist.

### 6. Optional standards

```markdown
## Optional: {standard name}

For a {project type} this one is recommended, not required:
- **{standard}**: {description from the catalog}

Define it now, or skip it for later?
```

---

## Facilitation principles

### Adapt to the user

- Names specific tech confidently -> treat as experienced, keep it short.
- Asks "what do you recommend?" -> recommend, with one line of reasoning.
- Says "I don't know" -> explain the trade-off, propose a default.
- Has strong opinions -> respect them, check they are coherent.

### One topic per question

Never stack questions. If the user answers one of two, acknowledge that one and re-ask only the other.

```markdown
## Database

1. **PostgreSQL** - robust, scalable, widely supported
2. **MySQL** - popular, good for web apps
3. **SQLite** - simple, file-based, fine for small apps
4. **MongoDB** - document store, flexible schema
5. **Other** - tell me
```

Bad, never do this: "What database are you using? And where will you deploy? What is your auth strategy?"

### Capture the reason

The "why" matters as much as the "what". A standard that says only "PostgreSQL" does not help a builder choose between two patterns; "PostgreSQL, because the reporting queries need window functions" does.

### Practical defaults

When the user is unsure, propose what the scan found and what is common for that stack, and say why.

---

## Output

```markdown
## Project initialized

### Detected

- **Project type**: {type}
- **Project documentation**: {n} pages read, or "not linked"
- **Stack**: {languages}, {backend stack}, {ui stack}
- **Build**: `{build command}` / **Test**: `{test command}`

### Standards

- **Tech stack**: `.specs-aidlc-turbo/repo/standards/tech-stack.md`
- **Coding standards**: `.specs-aidlc-turbo/repo/standards/coding-standards.md`
- **Data stack**: `.specs-aidlc-turbo/repo/standards/data-stack.md`
- **System architecture**: skipped
- **UX guide**: skipped
- **API conventions**: skipped

### Next step

Start your first intent:

/specsmd-aidlc-turbo-inception
```

---

## Error handling

- **Catalog missing**: "I cannot find `.specsmd/aidlc-turbo/templates/standards/catalog.yaml`. Reinstall the flow or restore that file."
- **Guide missing**: skip that standard, say so, and tell the user where to write it by hand.
- **Scan fails**: continue without it. Work out the stack and the build and test commands from the build files yourself, and write them into `repo/repo.yaml`.
- **Dependency not met**: write the dependency first, then come back.

---

## Transitions

- -> **Inception** (`/specsmd-aidlc-turbo-inception`) to create the first intent
- -> **Analyze Context** (`.specsmd/aidlc-turbo/skills/master/analyze-context.md`) to see where the project stands
- -> **Project Init** again, later, to add an optional standard
