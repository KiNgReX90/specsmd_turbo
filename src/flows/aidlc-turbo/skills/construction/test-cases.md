# Skill: Test Cases

---

## Role

Write the manual test case a human tester follows for one finished story, and, when the project supports it and a step runs on a screen, the Playwright twin that runs the same steps against the running application. The `specsmd-aidlc-turbo-test-writer` agent follows this file; the `finish` skill dispatches one per story, all in parallel, once every story is built, the whole intent is reviewed and every finding is fixed. The code you read is final for this run. When a fix changes it after you, `finish` dispatches every writer again: you rewrite the test case in full and run the twin again.

**No checkpoint.** The writer produces files and returns a result. The construction agent collects those results at finish.

---

## Goal

A tester who has never seen the code can open the test case and execute it without asking anyone a question, because every label, route, button and message in it was copied from the real implementation. It holds every check the tester needs: each criterion a tester can check, and every place the change could break.

---

## When it runs

All three must hold:

1. `config.tester.enabled` is `true`
2. the story's `tester_verifiable` is `true`: render derives it, true when at least one criterion is not `none`
3. the story's `status` is `done`

Otherwise write nothing, and create no folder.

The test case covers every criterion that is not `none` (step 1).

---

## Input

- **Required**: the absolute path of the project root. Every path below is relative to it, never to a home directory
- **Required**: the story path and the brief path
- **Required**: `.specs-aidlc-turbo/repo/config.yaml` for `tester.enabled`. `tester.enabled` false means you write nothing and create no folder
- **Required**: the `codebase` block of `.specs-aidlc-turbo/repo/repo.yaml` for `has_ui`, `playwright`, `playwright_test_dir`
- **Required**: the implementation files the story's `### Build notes` and its `changed_files` list
- **Required**: the paths of the other stories of the intent, for the regression trace
- **Required**: `url`, where the running application answers, or `none`. The application is started for you: never start it yourself
- **Optional**: `seed`, the live tester's scratch script for this story, a starting point for the twin

---

## Process

### 1. Read the story and the code behind it

Read the story (both halves) and the brief's `## Intent` and `## Requirements`.

**Where a tester checks each criterion.** The story's frontmatter `observed_via` holds one value per criterion, in their order, and each criterion line ends with the same value as a label in the record's language (`md.via` of its string table): in English `*(tester: screen)*` is `ui`, `API` is `api`, `database` is `db`, `log` is `log`, and `none` is `none`, followed by its reason. The test case covers every criterion that is not `none`: each gets its steps, on the channel it names, and its expected result. A `none` criterion gets no step: it is code level, or the test case of the story it names (`covered by S{SSS}`) covers it. The story's `surface` says where the code lives, never where the tester checks.

**A story without `observed_via`** in its frontmatter (specs rendered before the field): judge each criterion on its text. One whose when or then part names a screen, a menu, a tab, a button, a field or an API call is `ui` or `api`, whatever the surface; one that names a table or a record is `db`; one that names a log is `log`. When several apply, the first in the order `ui`, `api`, `db`, `log` wins. One that names none of these is `none` only when it is code level (a unit test, an internal class, a refactor, a build that passes); otherwise give it the channel a tester would use, in the same order.

Then open the files that `### Build notes` and `changed_files` name, and take from them, verbatim:

- the screen, menu or route the tester starts from
- the exact label of every field, button, tab and column the steps touch
- the exact text of every message, error and confirmation the steps expect
- for an `api` criterion: the method, path, request shape and status codes
- for a `db` criterion: the table, the record and the field or status a tester checks
- for a `log` criterion: the log and the exact line the behaviour writes there

Never invent a label. When the code builds a label from a resource bundle or a translation key, grep for the key and read the line that holds its value. When a label genuinely cannot be resolved, write the step with the key in brackets and say so in the `Notes for the agent`.

This reading runs on a budget, the same one an inception explorer gets: at most 12 tool calls, grep before read, line ranges only and never a whole file over 200 lines, no directory walks, never a file read twice, never a subagent of your own. It bounds only this reading of the story's own code for labels, routes and messages: the regression trace of step 1b has no call limit. Stop as soon as you have every label, route and message the steps need. The budget bounds the reading, not the writing: the test case and the twin are still written in full, and the twin still runs.

### 1b. Find what the story could break

A change can break behaviour that was already there, also far from the screens the story names. Trace every place it reaches, without a maximum. On a real run a cap of five regression steps parked the rest in the `Notes for the agent`, which Jira never gets, so no tester saw them.

Trace three things:

- **Every changed name.** For every changed backend function, service method, endpoint, query, table, view, PL/SQL package, job and message in the story's `### Build notes` and its `changed_files`: grep its name for every caller and follow each caller up to a place a tester can check: a screen (menu path, tab, button), an API endpoint, a table or view a tester queries, a log, or a job a tester starts or watches (through its admin screen, its log or its table). A shared helper is followed to every place it reaches.
- **The screens this story changes.** The existing behaviour on them that no story of this intent asked to change: the fields, buttons and messages that were there before and must still work.
- **The rest of this intent, and earlier intents.** The other stories of this intent that touch the same screen, route or `db_tables`, and the test cases of earlier intents (`.specs-aidlc-turbo/docs/*/*/tests/US-*.md`) that name the same screen or route: grep for the route or the screen title with `--include='US-*.md'`, never walk the folder.

**Every place found that no story of this intent tests gets a regression step for the tester. No maximum.** Ten places means ten or more steps. Many callers that end on the same screen are one place. A place another story of this intent already tests (a criterion of that story that is not `none` checks it there) gets no step: the result names that story in `covered_by`. **Nothing is parked in the `Notes for the agent` instead of a step.** A regression step copies its labels from the code as well, found by grep in the code of the place it checks. Nothing found: the section reads `Nothing.` in the record's language (`testCase.nothing`).

**Reading rules for the trace**: grep only, scoped to a path or a file type, never a directory walk, never a whole file, never a file read twice. **No call limit**: the trace ends when every changed name has been followed to its places, or to a dead end (no caller, or only test code). The 12-call budget of step 1 bounds only the reading of the story's own code for labels, routes and messages.

Keep every place you found, the changed name it was reached from, and the steps that check it or the story that covers it: step 5 returns them under `regression`.

### 2. Compose the test case

Write the test case in the record's language, `intent.language` in `record.yaml` (`en` when it is missing), the language the product team reads its stories in. Its headings and fixed labels come from `testCase` of that language's string table:

```bash
node .specsmd/aidlc-turbo/scripts/lib/lang.cjs {code} --show testCase
```

Use the template `.specsmd/aidlc-turbo/templates/construction/test-case-template.md`. It names the sections in English: Preparation, Steps, Expected result, Regression check and Notes for the agent; a record in another language takes the headings of its table.

Path:

```text
.specs-aidlc-turbo/docs/{inception}/{intent-slug}/tests/US-{SSS} - {story title}.md
```

That is `{intent_dir}/tests/`, for example `.specs-aidlc-turbo/docs/user-auth/user-auth/tests/US-003 - Login with expired password.md`. The folder lives in the intent folder, so it is committed with the specs. Create it only here, in this step, and only because a tester is configured.

Write the test case in full on every run, also when one already exists: never patch an older one, so its notes are always current.

Frontmatter:

```yaml
---
test_id: US-003
intent: user-auth
story: 003-login-expired-password
type: ui
db_tables: [users, login_attempts]
twin: tests/aidlc-twins/user-auth-login-expired-password.spec.ts
twin_result: passed
content_hash: 4f9a1c0b77de
generated: 2026-09-22T14:20:00Z
---
```

- `type`: where the Steps run, never the surface: `ui` when a step runs on a screen, `api` when the steps call an API and none runs on a screen, `db` when they only check the database, `log` when they only read a log. A mix without a screen takes the first in the order `api`, `db`, `log`.
- `db_tables`: copied from the story, unchanged.
- `twin`: the twin path, or `null` when no twin is written.
- `twin_result`: the result of the twin run of step 3, the same value you return. Write it after the run, and again on every run after it. The Jira sync reads it: a test case whose twin is `unreachable` never goes to Jira.
- `generated`: the real current time, read from the machine with `date -u +%Y-%m-%dT%H:%M:%SZ`. Never a timestamp typed from memory.
- `content_hash`: the first 12 hex characters of the sha256 of the body, which is everything after the closing `---` of the frontmatter. Write the file with `content_hash: pending`, then compute it and replace the value:

  ```bash
  node -e 'const fs=require("fs"),c=require("crypto");const t=fs.readFileSync(process.argv[1],"utf8");const b=t.replace(/^---\n[\s\S]+?\n---\n/,"");console.log(c.createHash("sha256").update(b).digest("hex").slice(0,12))' "{test_case_path}"
  ```

  The hash covers the body only, so later frontmatter edits do not invalidate it.

Sections:

1. **Preparation**: what must be true before step 1. Test data, the account and its rights, the starting screen or endpoint, anything to reset first. A case that changes data uses its own records, taken from the story's `test_data`, with keys unique to the story, and resets only those. Test cases may then run side by side. Only when two cases really have to touch the same records, say so here and in the `Notes for the agent`, naming the other case: those two run one after another, nothing else does.
2. **Steps**: numbered steps, one action per step, in the tester's own words, with the exact labels. "Click **Log in**", not "submit the form". No step that assumes knowledge of the code. Every criterion that is not `none` gets its steps on its own channel: a `db` criterion a step that names the table, the record and the field to check, a `log` criterion a step that names the log and the line to find.
3. **Expected result**: what the tester must see, per relevant step and at the end. Exact message text. For a step in the database, which table gets which row; for a log, the exact line.
4. **Regression check**: every regression step of step 1b, numbered through the section, one action per step, same style as the Steps, each with what the tester must still see, grouped by the place it checks: the steps of one place stand together, and each starts with that place in bold. No maximum. When the trace found nothing, the section reads `Nothing.` (`testCase.nothing`)
5. **Notes for the agent**: the twin path, or why there is none; what the twin does not cover, each step that stays manual with why; what is still open, such as an unresolved label or a precondition that needs a fixture. Never a regression place instead of a step, and never a "Not run" note about an application that did not run: `twin_result` in the frontmatter says how the twin ran.

### 3. The Playwright twin

Write a twin when all three hold:

1. `codebase.has_ui` is `true`
2. `codebase.playwright` is `true`
3. at least one step of the Steps or the Regression check runs on a screen

The story's `surface` plays no part: it says where the code lives, not where the tester looks. On a real run a data story and a job story whose test cases ran entirely through screens got no twin "because the surface is data". A result that lands in the database is no reason for no twin either. Otherwise: `twin: null`, `twin_result: not_run`, and `no_twin` with the reason, for example "no step runs on a screen" or "the project has no Playwright".

Path:

```text
{codebase.playwright_test_dir}/aidlc-twins/{intent-slug}-{story-slug}.spec.ts
```

Use `.spec.js` when the project has no TypeScript. Render it from `.specsmd/aidlc-turbo/templates/construction/twin-template.md`. A `seed` shows how the live tester reached the screens: reuse its navigation and selectors where they fit the Steps, never its assertions blindly. **Only the test writer writes in `aidlc-twins/`**, and only its own twin: never another story's.

The twin automates every step it can: the browser steps with Playwright, and setup and checks in the database or a log through the means the project's existing twins or tests already use (a database client, an API call, reading the log file). Grep them for it; never add a dependency. Every step it cannot automate is named under `Not covered by the twin` in the test case, with why.

One `test` for the Steps, mirroring them one to one, in the same order, plus one `test` for the Regression check when the twin can run any of its steps. The test titles and comments are in the record's language, as the test case is (`testCase.step`, `testCase.regressionStep`, `testCase.regressionTitle`). Each step carries a comment with its number: `// Step 3: ...`, `// Regression 2: ...`. Never a suite of variants. Assert what the `Expected result` states, and in the regression test what each step says the tester must still see. Use the project's own selector convention: prefer a role or a test id, fall back to the visible label text from step 1. Assert structure, state and text, never appearance.

Then run it once against `url`, through the base-URL setting or environment variable the project's Playwright config already reads (never edit that config):

```bash
npx --no playwright test {twin_path}
```

`url: none`, or a Playwright `webServer` that would start the application instead of reusing the running one: do not run it, `twin_result: not_run`.

- Every test in it passes: `twin_result: passed`.
- It fails because no application is reachable (a connection refused, a base URL that does not answer, a timeout on the first navigation): `twin_result: unreachable`, never `not_run`, with what you saw in `notes`. Change nothing else: the application fell over, `finish` restarts it and dispatches you again to run the twin. A twin that never ran against the application is not proven, so it never counts as done.
- It fails on an assertion: `twin_result: failed`. Report it in `notes`. The construction agent decides at finish whether that is a twin defect or a real one.

### 3b. The twin line in the story

Keep exactly one twin line in your story's `### Build notes`, replaced on every run, never appended: change the existing `- **Twin**:` line in place, or add it as the last line of the section when there is none. It takes one of two forms:

```markdown
- **Twin**: tests/aidlc-twins/user-auth-login-expired-password.spec.ts, passed (2026-10-05T10:12:00Z)
- **Twin**: none, no step runs on a screen
```

The first is `{twin path}, {twin_result} ({time of the run})`, the time read from the machine with `date -u +%Y-%m-%dT%H:%M:%SZ`. The second is `none, {no_twin}`. On every run also remove any older note about the twin or its run from the Build notes, for example a line like "Not run: no application is running (D-37)": on a real run such notes outlived the decision they named. Leave the builder's lines as they are. This line is all you write in the story.

### 4. Processes and ports

You are running on a developer's machine, next to editors, servers and other agents that have nothing to do with this run, and the application you test against belongs to the `finish` skill. **You start no process that outlives your twin run, and you stop none.**

- **Never start the application**, not even when `url` does not answer: that is `twin_result: unreachable`, and `finish` restarts it.
- **Never** run `pkill`, `killall`, `kill -9 $(pgrep ...)`, `fuser -k`, or anything else that selects processes by name, by pattern or by port. On the first real run of this flow a writer ran `pkill -f "node src/index.js"` to free a port. On a real machine that kills a colleague's server, another agent's build, or the session you are running in.

### 5. Return the result

```yaml
test_case: ".specs-aidlc-turbo/docs/user-auth/user-auth/tests/US-003 - Login with expired password.md"
twin: "tests/aidlc-twins/user-auth-login-expired-password.spec.ts"
twin_result: passed
no_twin: ""
regression:
  - place: "Account > Change password"
    via: ui
    reached_from: "PasswordService.change"
    steps: [1, 2]
  - place: "Sessions tab"
    via: ui
    reached_from: "SessionRepository.findActive"
    covered_by: "005"
notes: ""
```

`twin` is `null` when none was written. `twin_result` is `passed`, `failed`, `unreachable` (the application did not answer, never `not_run`) or `not_run` (no twin was written, `url: none`, or a `webServer` that would start the application).

`no_twin` is empty when a twin was written, and otherwise gives the reason, for example "no step runs on a screen" or "the project has no Playwright". A story with a criterion on `ui` (or, without `observed_via`, a screen in its criteria text) whose result has `twin: null` must give `no_twin`.

`regression` lists every place the trace of step 1b found: `place` as the tester knows it, `via` (`ui`, `api`, `db` or `log`: where the tester checks it), `reached_from` (the changed name the trace followed to it), and either `steps` (its step numbers in the `Regression check`) or `covered_by` (the quoted 3-digit id of the story of this intent that tests it), never neither. An empty list when the trace found nothing.

---

## Never

- Never guess a label, a route or a message. Read it out of the code, or flag it.
- Never write a step that names a class, a method or a source file. The reader is a tester.
- Never cap the regression steps. Every place the trace finds that no story of this intent tests gets its step, however many there are.
- Never put a regression place in the `Notes for the agent` instead of a step.
- Never decide the twin by the surface. The steps decide it: a step on a screen, in a project with a UI and Playwright, means a twin.
- Never decide on a failing twin yourself. Report it: `finish` decides whether the twin or the code is wrong.
- Never touch the implementation, the brief, another story or another story's twin. In your own story you write only the twin line of step 3b.
- Never write a test case for a story with `tester_verifiable: false`.
- Never start or stop the application, and never select a process by name, pattern or port. No `pkill`, no `killall`, no `fuser -k`.

---

## Output

The test case file, optionally the twin file, the twin line in the story's `### Build notes`, and the result YAML of step 5.

---

## Transitions

Back to `.specsmd/aidlc-turbo/skills/construction/finish.md`, which collects the results.
