---
test_id: US-{SSS}
intent: {intent-slug}
story: {SSS}-{story-slug}
# type: where the Steps run, never the story's surface: ui, api, db or log
type: ui
db_tables: []
twin: null
twin_result: not_run
content_hash: pending
generated: {ISO-8601-timestamp}
---

# US-{SSS} - {story title}

> Template for one manual test case at `{intent_dir}/tests/US-{SSS} - {story title}.md`, written by the test writer at finish, once the whole intent is built and reviewed, and rewritten in full on every run.
> Test cases are written in the record's language (`intent.language`, `en` when it is missing). The
> headings and the labels below are the English ones: write those of the string table of that
> language, `testCase` in `templates/lang/{code}.json` or the project's own
> `.specs-aidlc-turbo/repo/lang/{code}.json` (`node .specsmd/aidlc-turbo/scripts/lib/lang.cjs {code} --show testCase`
> prints them). Keep the five headings, their order and the frontmatter as they are.
> Every label, route, button and message is copied from the implementation, never invented.
> The Regression check holds every regression step the test writer's trace found, numbered through the
> section and grouped by the place it checks, with no maximum, or `Nothing.` when it found nothing.
> Nothing is parked in the Notes for the agent instead of a step, and no "Not run" note about
> an application that did not run goes there either: `twin_result` says how the twin ran.

## Preparation

- **Environment**: {where the tester works, which application, which environment}
- **Account**: {the user and the rights the case needs}
- **Test data**: {the records that must exist, and their relevant field values}
- **Starting point**: {the screen, the menu path or the endpoint the tester starts from}
- **Clean up first**: {what to reset first, or "Nothing."}

## Steps

1. {One action. Exact label in bold, for example: Click **Log in**.}
2. {One action per step. No two actions in one step.}
3. {Name the field and the value: In **Password** enter `expired123`.}

## Expected result

| Step | Expected |
| ---- | -------- |
| 2 | {what the tester sees after step 2, exact message text} |
| 3 | {what the tester sees at the end} |

- **End**: {the state the system is in when the case passes}
- **Data**: {for a step in the database: which table gets which row, and which field changes}

## Regression check

1. **{The place it checks, for example Payment plans > End}**: {one action on behaviour that was already there}. {What the tester must still see.}
2. **{The same place}**: {the next action there}. {What the tester must still see.}
3. **{The next place: a screen, an endpoint, a table, a log or a job}**: {one action}. {What the tester must still see.}

## Notes for the agent

- **Twin**: {the twin path, or "No twin:" with the reason, for example "No twin: no step runs on a screen."}
- **Not covered by the twin**: {every step that stays manual, each with why, for example "Step 4: the bank processes the file outside the application.", or "Nothing."}
- **Open**: {a label that could not be resolved, a fixture that is still missing, or "Nothing."}
