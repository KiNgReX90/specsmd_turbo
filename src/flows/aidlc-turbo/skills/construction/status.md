# Skill: Status

---

## Role

Read-only view of where an intent stands and what happens next. Nothing is dispatched, nothing is written.

**No checkpoint.**

---

## Goal

Answer "where are we" in one table, and "what now" in one line.

---

## Input

- **Required**: the intent slug. Without one, list every intent under `.specs-aidlc-turbo/docs/{inception}/{intent}/` with its brief status and its done-out-of-total count, and ask which one.

---

## Process

1. Run the status script:

   ```bash
   node .specsmd/aidlc-turbo/scripts/intent-status.cjs {intent}
   ```

   Add `--json` when you need the fields rather than the table.

2. Render its output as the table below. The script owns the facts: the brief status, every story with its status and dependencies, the frontier, and the blocked stories. Do not recompute them by hand. The branch name comes from the brief frontmatter, never from the folder name.

3. Derive the next action from the brief status and the frontier:

   | State | Next action |
   | ----- | ----------- |
   | Brief `draft` | Inception is unfinished, run `/specsmd-aidlc-turbo-inception` |
   | Brief `approved`, nothing built | Run `/specsmd-aidlc-turbo-construction {intent}` |
   | Frontier not empty | Build the first story on the frontier |
   | A story `blocked` | Answer its open question: `/specsmd-aidlc-turbo-construction {intent}` shows it |
   | Every story `done`, brief `building` | Run the `finish` skill |
   | Brief `done` | Start the next intent |

---

## Output

```markdown
## Intent user-auth

**Brief**: building   **Stories**: 2/3 done   **Branch**: shop/intent-user-auth/intent

| Story | Title | Status | Depends on | Complexity | Tester |
| ----- | ----- | ------ | ---------- | ---------- | ------ |
| 001 | Login happy path | done | - | medium | yes |
| 002 | Login with expired password | done | 001 | low | yes |
| 003 | Lockout counter | todo | 002 | medium | no |

**Frontier**: 003
**Blocked**: none

**Next**: build story 003, `/specsmd-aidlc-turbo-construction user-auth`
```

---

## Never

- Never change a status from this skill. It reads, it does not write.
- Never report a story done that the script did not report done.

---

## Transitions

- Build to `.specsmd/aidlc-turbo/skills/construction/dispatch.md`
- Close to `.specsmd/aidlc-turbo/skills/construction/finish.md`
- Menu to `.specsmd/aidlc-turbo/skills/construction/navigator.md`
