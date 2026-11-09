# Skill: Route Request

---

## Role

Routing skill. Turns the detected phase plus what the user asked for into one command.

**No checkpoint** - routing is navigation, not a decision.

---

## Goal

Hand the user exactly one command to run, with its argument filled in, and say what it will do.

---

## Input

- **Required**: the state from `analyze-context.md`
- **Required**: what the user wants

---

## Process

### 1. Match the state to a command

| State or request | Command |
|------------------|---------|
| The old layout | `node .specsmd/aidlc-turbo/scripts/migrate-layout.cjs`: show its dry run, then run it with `--write` once the user agrees |
| No config yet | Run the `/specsmd-aidlc-turbo-config` flow inline (show the defaults, ask "Use these, or adjust?", write the file) |
| No `repo/standards/` or no `project/project.yaml` | `project-init` skill |
| A new feature, a bug fix, any new piece of work | `/specsmd-aidlc-turbo-inception` |
| Record or brief `draft` (inception was interrupted) | `/specsmd-aidlc-turbo-inception` |
| Brief `approved` or `building` | `/specsmd-aidlc-turbo-construction {intent-slug}` |
| A `done` intent that is not merged yet (**Finish again**), or the user asks to finish one again | `/specsmd-aidlc-turbo-construction {intent-slug}` |
| Review comments on the merge requests of a `done` intent that is not merged yet (**Handle the review comments**) | `/specsmd-aidlc-turbo-review-fix {intent-slug}` |
| Change mode, branching or the tester setting | `/specsmd-aidlc-turbo-config` |
| "How does this flow work?" | `explain-flow` skill |
| "What does story 004 do?", "which decision covers X?" | `answer-question` skill |

The user's own words win over the detected phase. When someone with an approved intent asks for something unrelated, start a new intent instead of pushing them into construction.

### 2. Special cases

- **Request does not match the phase**: say so in one line, then follow the request. "Intent user-auth is halfway through construction. You are asking about something new, so I will start a new intent."
- **User is unsure**: name the logical next step and ask whether to take it.
- **Several intents are open**: list them with their status and let the user pick, using the host's multiple-choice prompt where one exists (on Claude Code: AskUserQuestion).
- **Work is finished**: every brief is `done`. Offer a new intent, and **Finish again** for every intent that is not merged yet. One that is not pushed yet (the brief has no `merge_request` and no `pushed_to_base`) or has a test case that is not proven comes first, and the offer names what is open, by its story title.

### 3. Hand over

Give the exact command with its argument, one line on what the target does, and what the first thing is that will happen. Nothing else. For **Finish again** that line says that construction runs the live test and every twin again, rewrites the test cases, asks for the approval again, and then pushes: to the merge requests that are already open, with new ones for an intent not pushed yet, or in sandbox with `sandbox_finish: push` onto the base branch.

---

## Output

```markdown
## Next step

**Run**: `/specsmd-aidlc-turbo-construction user-auth`

Run it in a clean session: `/clear` first, everything construction needs is on disk. Construction builds the stories of user-auth side by side: a builder writes each story with tests, a script runs them, fresh reviewers check the diff (against the story, on quality and safety, against the project's own rules), and each story lands as its own commit. Only a story that misses three times waits for you; the rest keep building.

Want something else instead? Say so and I will route you there.
```

---

## Transitions

- The user runs the command and the target agent takes over.
- -> **Answer Question** when the user first wants to know something.
- -> **Explain Flow** when the user does not know what the target does.
