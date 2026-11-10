# Skill: Live Test

---

## Role

Start the application on the finished intent's code and try it out the way a user would, against what the intent promised. The `specsmd-aidlc-turbo-live-tester` agent follows this file; the `finish` skill dispatches it after the full verification and before the intent review. With `mode: start` it only starts the application, for the test writers.

**The application stays running when you return.** Finish uses it for the test cases and stops it at the end, by the `pid` you return.

**No checkpoint.** You return a result and write nothing into the project. The construction agent decides what happens next.

---

## Goal

Evidence from the running application that every observable requirement of the intent works, or a precise account of what does not: what you did, what you expected, and what you saw.

---

## Input

- **Required**: the absolute project root. Every path below is relative to it, never to a home directory
- **Required**: `mode`: `test` (start and check) or `start` (start only)
- **`mode: test`**: the brief path and every story path of the intent
- **Required**: the `codebase` block and, when an earlier live test left one, the `live_test` block of `.specs-aidlc-turbo/repo/repo.yaml`
- **Optional**: `app`, the application the flow already runs (`pid`, `url`, `start_command`): restart it on the current code
- **Optional**: a start command or URL the user gave after an earlier `not_run`

The code on disk is the integrated intent: the intent branch, or the local integration branch when story branches are on. Test that, nothing else.

---

## Process

### 1. Decide what to check

`mode: start`: skip this step.

Read the brief's `## Requirements`, and every story's `### Acceptance criteria` with its frontmatter `observed_via`, one value per criterion in order. What you check follows the criteria, never the story's `surface`: that says only where the code lives.

- `ui` and `api`: one check per criterion, whatever the story's surface.
- `db` and `log`: one check per criterion when the project gives you a way, the database client its tests or twins already use, or the log file the application writes. No way: list it `not_observable`, with the reason.
- `none`: `not_observable`, covered by the verification.

A story without `observed_via` in its frontmatter was specified before the field existed. Judge each of its criteria on its text: one whose when or then part names a screen, a menu, a tab, a button, a field or an API call is `ui` or `api`, whatever the surface; one that names a table or a record is `db`; one that names a log is `log`; anything else is `none`.

There are no test cases yet: they are written after you, against the code you helped fix.

### 2. Start the application

How the application starts and where it answers is always yours to work out. Nobody configures it.

1. **`app` given**: the flow started it. Stop exactly its `pid` and its children, wait until its port is free, and start it again with its `start_command`.
2. **Start command**: a command the user gave takes precedence. Otherwise the `start_command` of the `live_test` block, when there is one. Otherwise work it out from `repo.yaml`, the README and the build files.
3. **URL**: a URL the user gave takes precedence. Otherwise read the port from the configuration the start command uses, or from the startup output. The `url` of the `live_test` block is only a hint: the startup output wins.
4. Start it in the background and **record the process id**. Wait until the URL answers, at most three minutes.
5. It does not start, or never answers: stop the process you started and return `verdict: not_run` with the last startup lines in `notes`.

The user gave a URL and no start command: they run the application themselves. Start nothing and return `pid: null`.

The port is busy before you start: that is not your process. Start on another port, or return `not_run` with the note `port busy`. Never free a port by killing what holds it.

`mode: start`: return now with `verdict: started`.

### 3. Run the checks

- **UI**: Playwright, when the project ships it. Write one short scratch script per story under `{tmp}/aidlc-turbo-live/{intent-slug}/`, `{tmp}` being the system temp directory. **Keep those scripts**: the test writers use them as seeds for the twins. No Playwright: mark the UI checks `not_run` and say why.
- **API**: call the endpoint with `curl` or the project's own client, with the exact payload the criterion describes, and compare status and body.
- **Database and log**: a `db` check is a query through the database client the project's tests or twins already use, on the database the application you started uses, and it changes nothing but records you made for the check. A `log` check reads the lines the application wrote to its log file, or its output, after your action.

Per check record `pass`, `fail` or `not_run`, with the evidence: the request and response, the page and what it showed, or the query or the log lines and what they held. A failing check names the story it belongs to.

A check that fails because the story itself is wrong, not the application (the application does what the brief or another story says, and this criterion says otherwise): add `mismatch` to that check, one line with both sides quoted and the stories by their titles. Never decide which side is right: the construction agent asks the human.

Only test the application you started, or the URL the user gave. Never another environment, never production.

### 4. No report file

Write nothing to disk in the project. Everything you found goes into the result, with its evidence, and the construction agent has every failure fixed in the code. Remove the screenshots you made; keep only the seed scripts.

### 5. Return the result

```yaml
verdict: fail
pid: 48211
start_command: "mvn -q spring-boot:run"
url: "http://localhost:8080"
seeds:
  "001": "/tmp/aidlc-turbo-live/user-auth/S001.spec.ts"
checks:
  - story: "001"
    check: "Login with valid credentials opens the dashboard"
    result: pass
    evidence: "302 to /dashboard, heading Dashboard"
  - story: "002"
    check: "Expired password shows the change form"
    result: fail
    did: "POST /login with user expired@example.test"
    expected: "the change-password form"
    saw: "500, NullPointerException in the log at PasswordPolicy.java:41"
  - story: "003"
    check: "Lockout counter"
    result: not_observable
    reason: "db: the project's tests and twins use no database client"
notes: ""
```

`verdict` is `pass` when no check failed, `fail` when at least one did, `not_run` when the application never answered, and `started` in `mode: start`. A `not_observable` check carries its `reason`. `pid`, `start_command` and `url` are what really runs now; `checks` and `seeds` are empty in `mode: start`.

---

## Never

- Never change the implementation, a story or the brief. You report, the builder fixes.
- Never test against anything but the application you started or the URL the user gave.
- Never stop a process except the one you started for a start that failed, and the `app` you were told to restart. Never select one by name, pattern or port: no `pkill`, no `killall`, no `fuser -k`.
- Never write a report or any other file into the project, and never commit.

---

## Output

The result YAML of step 5, and nothing else.

---

## Transitions

- Back to `.specsmd/aidlc-turbo/skills/construction/finish.md`
