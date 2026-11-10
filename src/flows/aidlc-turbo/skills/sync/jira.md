# Skill: Jira sync

---

## Role

Puts the intent on the Jira board and keeps it there. Followed by the sync agent
(`specsmd-aidlc-turbo-sync`), in one of two modes:

| Mode | Dispatched by | What happens |
| ---- | ------------- | ------------ |
| `after-inception` | review, right after the Confluence push | One epic for the intent, with the mismatches the inception decided, and one issue per story |
| `after-build` | finish, after the push, so the merge requests are open | Every story issue closed with what was built and the link to its merge request, or the base branch and commit it was pushed onto, the test cases added, and every mismatch the build decided sent. With `tests_only: true`, when finish runs again: only the test cases and the mismatches of that run |

Runs only when `sync.issues` in `.specs-aidlc-turbo/repo/config.yaml` is `jira`. `none`, the
default when the key is missing, means it never runs. Any other value: say, in the user's
language, "`{value}` is not supported yet." and go on as
if it were `none`.

Everything this skill remembers goes into `.specs-aidlc-turbo/docs/{inception}/sync.yaml`, under
`jira:`, one block per intent. Never write the classic flow's `jira-sync.yaml`: it belongs to the
classic AI-DLC flow.

```yaml
jira:
  project: SHOP
  intents:
    user-auth:
      epic: SHOP-100
      stories:
        "001": SHOP-101
        "002": SHOP-102
      tests:
        issue: SHOP-110
        cases:
          "001": SHOP-111
      mismatches: [D-4]
```

Every run first reads this block. A key that is already there is updated, never created a second
time, so running the skill again is always safe. `mismatches` names every decision with a
`mismatch` that is in Jira already, so none is sent twice. An older `sync.yaml` with `epic` and
`stories` directly under `jira:` belongs to the intent with the inception's own slug: move it under
`intents: {slug}` as you write.

---

## Atlassian access

Use the Atlassian MCP tools, under whatever server name this session gives them:
`getAccessibleAtlassianResources` once for the cloud id, `getJiraProjectIssueTypesMetadata`,
`getIssueLinkTypes`, `createJiraIssue`, `editJiraIssue`, `getJiraIssue`, `createIssueLink`,
`addCommentToJiraIssue`, `getTransitionsForJiraIssue` and `transitionJiraIssue`. Every other
Atlassian tool is there too when a step needs one: `getJiraIssueTypeMetaWithFields` for the fields
an issue type requires, `searchJiraIssuesUsingJql`, `lookupJiraAccountId`. A create that fails on a
required field: read that issue type's fields, fill the field from what the step has and create
again; a value you cannot know is a `needs_input`.

No Atlassian tools at all: return `status: no_tools`. The caller tells the user to connect the
Atlassian MCP server (on Claude Code: `/mcp`) and asks **Connected, try again** or **Later**; later
is a dispatch with `answer: later`, which writes `pending: after-inception` or `pending:
after-build` under the intent's block, and for a `tests_only: true` dispatch `tests_only: true`
next to it, unless a `pending: after-build` without it is already there: that one still needs the
whole mode. The next `/specsmd-aidlc-turbo-inception --skill sync {intent-slug}` finishes it, and
both keys go once it is done.

---

## The project

The project is the link to the board, for example
`https://example.atlassian.net/jira/software/projects/SHOP/boards/1`: `jira_project_url` in
`.specs-aidlc-turbo/project/project.yaml`, or else `sync.jira_project_url` in the config. Read two
things from it: the site (`example.atlassian.net`), which picks the Atlassian site the tools work on,
and the project key (`SHOP`), from `/projects/{KEY}/`, `/browse/{KEY}` or a `projectKey=` query.

Neither holds a link that names a project: return `status: needs_input` asking for the link to the
Jira project board. The caller asks the user and dispatches again with the `answer`; write it into
`project/project.yaml` as `jira_project_url`, keeping every other key.

Read the project's issue types once. Use `Epic` for the intent, `Story` for a story, falling back to
`Task` when the project has no `Story`, and `Sub-task` for a test case. A project without an epic
type: create the story issues without a parent and say so in `note`.

---

## What you read

- The brief, `docs/{inception}/{intent}/brief.md`: title, `## Intent`, the requirements, the branch.
- The stories: the `stories` list of `record.yaml` gives each id and slug, the file is
  `stories/{id}-{slug}.md`. An intent without a record (a migrated one): the story map of the brief
  gives the ids, and the file of each is the one match of `stories/{id}-*.md` (or its `file` in
  `intent-status.cjs {intent} --json`).
- Per story only its product-team section and its frontmatter: the first `##` section, headed in
  the record's language (`## For the product team` in English). The agent half stays in the
  repository.
- The decisions of `record.yaml` that carry a `mismatch`: what did not match (`what`), the choice
  (`chosen`), the page it was about (`page`) and the story whose text it changed (`story`). A
  `page` is the `path` of a row of `confluence.pages` in `sync.yaml`: its link is the one
  `getConfluencePage` gives for that row's `page_id`. A page without a row has no link: name it by
  its file name. A decision with `page_fixes` also says what became of its pages: `Page
  corrected.` when its id is in `confluence.fixed` and none of those pages' rows has `changed: true`,
  `Correction ready, not on Confluence yet.` when its id is there and a row still has it, and
  `Page not corrected.` when its id is not there (the user kept the pages out, or Confluence is
  off).

The product-team text is in the record's language, and it goes to Jira exactly as written:
never translate it.

---

## After the inception

1. **Epic**. Summary: the intent title. Description: the brief's `## Intent` as written, the
   requirements one line each with their id, the link to the intent's own documentation page
   (`confluence.intents.{intent-slug}.url`), else to the inception's (`confluence.documentation.url`),
   from `sync.yaml` when there is one, and the intent branch from the brief. When a decision of the
   record has a `mismatch`, end with a section `What did not match`: one line per such decision, the
   page title with its link when it has a `page`, then its `what`, `Chosen: {chosen}` and,
   with `page_fixes`, what became of its pages. Labels: `aidlc-turbo` and `intent-{intent-slug}`.
2. **One issue per story**, under the epic. Summary: `US-{SSS} {story title}`. Description: the
   story's product-team section as written, the user story line (**As** … **I want** … **so that**
   …, in the record's language), the why of the story when there is one, the acceptance criteria and
   the out-of-scope list. Same labels, plus
   `complexity-{low|medium|hard}` from the story.
3. **Dependencies**: for every `depends_on`, link the two issues with the project's `Blocks` link
   type, the dependency blocking the story. No such link type: skip the links and say so in `note`.
4. Write every key into `sync.yaml` as it is created, not at the end, so a failure halfway loses
   nothing: the ids of the decisions in `What did not match` go into `mismatches` once the epic holds
   them.

```yaml
sync: { skill: jira, mode: after-inception, status: done, epic: SHOP-100, stories: 6, mismatches: 1, note: "" }
```

---

## After the build

1. **Every story issue**: add a comment with what was built, taken from the story frontmatter: the
   `commit`, the `branch` when story branches are on, `tests`, the one-line test summary, and the
   link to the merge request that carries the story: the story's `merge_request` when story
   branches are on, else the brief's `merge_request`. Write the link in full, as a link. A brief
   with `pushed_to_base` has no merge request (sandbox mode with `push`): name that base branch and
   the `commit` finish passed instead of a link, the base branch alone when no `commit` came
   along. Then move the issue to done: read its transitions and take the one that ends in a
   status of the `Done` category. None available: leave the status and say so in `note`.
2. **Test cases**, only when `tester.enabled` is true. The test case of a story is
   `docs/{inception}/{intent}/tests/US-{SSS} - {story title}.md`; a story without that file has none.
   - One issue under the epic, summary `Tests: {intent title}`, labels as above plus `tests`.
   - One sub-task under it per test case. Summary: the file name without `.md`. Description: the
     test case body, every section but the notes for the agent (the Preparation, the Steps, the
     Expected result and the Regression check, in the language they were written in), exactly as
     written.
   - A test case that changed since the last run (a fix, a rewrite) updates its sub-task. Never a
     second sub-task for the same story.
   - A test case whose frontmatter says `twin_result: unreachable` is skipped: its twin never ran
     against the application, so it is not proven. Create or update no sub-task for it, and name it
     in `note`.
3. **Mismatches**: every decision of the record with a `mismatch` whose id is not in `mismatches`
   yet was decided during the build.
   - With a `story`: update that story's issue description to the story's current product-team
     section, composed as after the inception, and add a comment `Changed during the build:
     {what} Chosen: {chosen}`.
   - With a `page`, or with neither a `page` nor a `story`: one comment on the epic for all of them,
     headed `What did not match during the build`, one line each: the page title with its link when
     it has a `page`, then its `what`, `Chosen: {chosen}` and, with `page_fixes`, what became of
     its pages. Finish corrects them before it dispatches this step.
   - Add every id to `mismatches` as soon as its issue or the epic comment holds it.
4. **Epic**: add a comment that construction is done, with the number of stories, the branch and
   the link to the intent's merge request: the brief's `merge_request`, or with `pushed_to_base`
   the base branch and the commit. Leave the epic open: the tester and the human close it.
5. A merge request that is not in the frontmatter, without `pushed_to_base` (none opened): leave
   its link out and say so in `note`. Never build a link yourself.
6. Update `sync.yaml` as you go, so the last commit of finish carries it.

```yaml
sync: { skill: jira, mode: after-build, status: done, closed: 6, test_cases: 5, mismatches: 1, note: "" }
```

**Finish again** (`tests_only: true`): finish ran once more on an intent it finished before, and
rewrote every test case. Only steps 2, 3 and 6 run: update every test-case sub-task that `sync.yaml`
names, create the missing ones (and the `Tests:` issue when there is none), and skip an
`unreachable` one as above; send a mismatch this run decided. No other story comment, no
transition, no other epic comment: the first finish made those. With `tester.enabled` false only
step 3 is left. A block that still says `pending: after-build` without `tests_only` never had its
first run: do the whole mode instead.

```yaml
sync: { skill: jira, mode: after-build, tests_only: true, status: done, test_cases: 5, note: "" }
```

---

## Never

- Never create an issue before the inception was approved.
- Never create a second issue for a story, a test case or the intent: `sync.yaml` says what exists.
- Never copy the agent half of a story into Jira.
- Never close the epic.
- Never write a mismatch to Jira outside these two moments, and never twice: `mismatches` in
  `sync.yaml` says what is there.
