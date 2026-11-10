# Skill: List Intents

---

## Role

Informational skill. Shows every intent with its status and its story counts, and names the next
action for each one. No checkpoint, nothing is written.

---

## Goal

One table the user can read in a glance, plus the single most useful next command.

---

## Input

- Every intent folder `.specs-aidlc-turbo/docs/{inception}/{intent-slug}/`, with its `record.yaml`
  and `brief.md`
- `.specsmd/aidlc-turbo/memory-bank.yaml` for the schema paths

---

## Process

1. List the intent folders: every folder `.specs-aidlc-turbo/docs/{inception}/{intent-slug}/` that
   holds a `record.yaml` or a `brief.md`, the same rule the scripts use. A brief without a record is
   a **migrated** intent (moved by `migrate-layout.cjs`): mark it so in the table. None at all: say
   so and offer to start one.
2. For each folder, read the `brief.md` frontmatter: `id`, `title`, `status`, `mode`, `branch`,
   `approved`, `completed`.
3. Count the story files under `stories/` and group them by their `status`.
4. When a status script is available and the intent is approved or building, use it for the frontier
   instead of counting by hand:

   ```bash
   node .specsmd/aidlc-turbo/scripts/intent-status.cjs user-auth
   ```

5. Render the table, newest id last, and derive the next action per status:

   | Brief status | Next action |
   | ------------ | ----------- |
   | no `brief.md` yet | Intake is under way, its record is on disk: `/specsmd-aidlc-turbo-inception` |
   | `draft` | Finish inception: `/specsmd-aidlc-turbo-inception` |
   | `draft`, migrated (no record) | Finish inception: `/specsmd-aidlc-turbo-inception`, which first writes a record from the brief and the stories |
   | `approved` | Start building: `/specsmd-aidlc-turbo-construction {id}` |
   | `building` | Continue building: `/specsmd-aidlc-turbo-construction {id}` |
   | `done` | Nothing. Start a new intent when there is more to do. |

6. When the inception's `sync.yaml` has a `pending:` key under `jira.intents.{id}`, `pending_jira`
   under `overview.{id}`, or a Confluence page row with `changed: true` after the approval, add: finish the sync with
   `/specsmd-aidlc-turbo-inception --skill sync {id}`. When
   `node .specsmd/aidlc-turbo/scripts/intent-pages.cjs check --inception {inception}` fails (exit 1),
   add for that inception: its intents share one Confluence page, and the same command gives each
   intent its own.
7. Suggest one next action: the oldest intent that is not `done`.

---

## Output

```text
Intents

| Id | Title | Status | Stories | Branch |
|----|-------|--------|---------|--------|
| user-auth | User authentication | done | 6 done | shop/intent-user-auth/intent |
| audit-log | Audit log | building | 2 done, 1 review, 3 todo | shop/intent-audit-log/intent |
| exports | CSV exports | draft | 0 | - |

Next: continue audit-log with /specsmd-aidlc-turbo-construction audit-log
```

---

## Transitions

- User picks a `draft` intent -> `intake.md` to finish it
- User picks an `approved` or `building` intent -> `/specsmd-aidlc-turbo-construction {id}`
- User wants a new intent -> `intake.md`
