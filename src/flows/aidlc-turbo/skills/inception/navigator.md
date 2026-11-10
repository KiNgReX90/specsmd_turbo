# Skill: Inception Navigator

---

## Role

Entry point of the inception agent. Reads the state from disk and offers the sensible next step. A
routing skill: no checkpoint, nothing is written.

---

## Goal

The user lands on the right skill in one choice.

---

## Input

- `.specs-aidlc-turbo/repo/config.yaml`
- Every intent folder `.specs-aidlc-turbo/docs/{inception}/{intent-slug}/`: its `record.yaml` and the
  `brief.md` frontmatter
- Optional: an intent id or free text the user already gave

---

## Process

1. When the command already carries a free text intent, skip the menu and go straight to
   `intake.md`. A user who knows what they want should not read a menu.
2. When `.specs-aidlc-turbo/repo/config.yaml` is missing, say so and point at
   `/specsmd-aidlc-turbo-config`, then stop.
3. Read every intent folder and classify:
   - a record without a brief, or a brief with `status: draft`, is an unfinished inception
   - a brief with `status: approved` or `building` belongs to construction
   - the rest is history
4. Present the menu with the host's multiple-choice prompt where one exists (on Claude Code:
   AskUserQuestion), otherwise a numbered list. Option 1 is always the suggested step:

   | State | Option 1 |
   | ----- | -------- |
   | No intents | Start a new intent |
   | A draft intent exists | Finish that intent |
   | Only approved or building intents | Start a new intent, and mention construction is waiting |

5. Route the choice to the skill and run it with the intent in hand.

---

## Output

```text
AI-DLC Turbo inception

1 - Start a new intent
2 - Finish exports (draft)
3 - List intents
4 - Back to the main menu

audit-log is mid-build: /specsmd-aidlc-turbo-construction audit-log
```

---

## Transitions

- Start an intent -> `intake.md`
- Finish an intent -> `intake.md`, which resumes from its record
- List intents -> `intent-list.md`
- Main menu -> `/specsmd-aidlc-turbo`
