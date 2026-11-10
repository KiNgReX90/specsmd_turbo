# Skill: Confluence sync

---

## Role

Keeps an inception's documentation on Confluence and its copy inside `.specs-aidlc-turbo/` in step.
Followed by the sync agent (`specsmd-aidlc-turbo-sync`), in one of five modes:

| Mode | Dispatched by | What happens |
| ---- | ------------- | ------------ |
| `pull` | intake, docs step | The inception's documentation page tree and the shared project page tree are copied into `.specs-aidlc-turbo/` |
| `resolve` | intake, after the questions; finish, after its approval, with `fixes_only: true` | Every answer the record holds to a question from those pages is written into the page it came from, and every page correction a mismatch brought |
| `push` | review, right after the approval; finish, right after its approval | Every page that changed goes back to Confluence |
| `project` | project-init, before any inception | Only the shared project page tree is copied into `.specs-aidlc-turbo/project/pages/` |
| `intent-pages` | `skills/sync/intent-pages.md`: after the pull, before the approval and the push, the sync rerun | Every missing intent page and its stories page is created, and each story page moves under the stories page of its own intent, as the user approved |

Runs only when `sync.docs` in `.specs-aidlc-turbo/repo/config.yaml` is `confluence`. `none`, the
default when the key is missing, means it never runs. Any other value: say, in the user's
language, "`{value}` is not supported yet." and go on as
if it were `none`.

Everything lives inside `.specs-aidlc-turbo/`. Never write the repo's own `docs/` or `project-docs/`:
those belong to the project, not to this flow.

---

## Page names

The names the sync looks for and gives come from `sync.page_names` in
`.specs-aidlc-turbo/repo/config.yaml`. Read it once at the start; a key it leaves out keeps its
default. `{name}` is the inception's or the intent's name, `{slug}` the intent's folder name.

| Key | Default | What it names |
| --- | ------- | ------------- |
| `intent` | `{name} - Documentation` | the documentation page: an inception's page, and an intent's own page |
| `stories` | `{name} - Stories` | the stories page, the page the story pages hang under |
| `project` | `Project Documentation` | the shared project page |
| `overview_section` | `Interactive overview` | the section at the top of a documentation page that links the overview files |
| `overview_file` | `overview-{slug}.html` | an intent's overview page, as attached to its documentation page |

Below, "the documentation page" is the inception's page whose title fits `intent`, "the project
page" the page whose title fits `project`, and "the overview section" the section titled
`overview_section`. Story pages are titled `Story {NNN} - {title}`, with ` - {name}` after it when
the page tree adds it.

---

## Where things live

| What | Path |
| ---- | ---- |
| The inception's pages | `.specs-aidlc-turbo/docs/{inception}/pages/` |
| An intent's own page, its stories page and its story pages | `.specs-aidlc-turbo/docs/{inception}/pages/{intent-slug}/` |
| The shared project pages | `.specs-aidlc-turbo/project/pages/` |
| What is linked to what | `.specs-aidlc-turbo/docs/{inception}/sync.yaml` |
| The intent overview (`overview_file`, default `overview-{intent-slug}.html`) | Attachments of the intent's own documentation page, linked in its overview section |
| The link to the project page | `project_docs_url` in `.specs-aidlc-turbo/project/project.yaml` |

**Every intent has its own page.** An inception of one intent has no `intents`: its documentation
page is the intent's page. An inception that holds more than one intent folder gives each intent a
child page of its own under the inception's page, titled by `intent` with the intent slug as
`{name}` (default `{intent-slug} - Documentation`), with its own stories page under it (default
`{intent-slug} - Stories`); when the slug is the inception page's own name, the name in both titles
is the slug with `(intent)` after a space. An intent's story pages hang under its own stories page,
and its overview goes on its own page. The inception's page keeps what the intents share: the
architecture, the decisions, the open questions. Story pages of two intents never share a parent.
`scripts/intent-pages.cjs` checks it, and mode `intent-pages` repairs it.

A page becomes `{page-name}.md`. The page name is its title with the inception's or the intent's
name taken out (`Architecture - Login` gives `architecture`, `Login - Stories` gives `stories`),
lowercase and hyphenated. A page with children becomes a folder of that name, and the page itself is
that folder's `index.md`. The top page of a tree is the tree's own `index.md`. An intent's own page
is the exception: it becomes the folder `{intent-slug}/`, the page itself that folder's `index.md`,
and below it the name taken out is the intent slug (with `(intent)` when it has one) or the
inception's name: `audit-log - Stories` gives `stories`.

`sync.yaml` holds one row per page. Paths are relative to `.specs-aidlc-turbo/`:

```yaml
confluence:
  documentation:
    url: "https://example.atlassian.net/wiki/spaces/SHOP/pages/123456/Login+-+Documentation"
    page_id: "123456"
    name: "Login"
  intents:
    user-auth: { url: "https://example.atlassian.net/wiki/spaces/SHOP/pages/123480/user-auth+-+Documentation", page_id: "123480", name: "user-auth" }
    audit-log: { url: "https://example.atlassian.net/wiki/spaces/SHOP/pages/123490/audit-log+-+Documentation", page_id: "123490", name: "audit-log" }
  project_documentation:
    url: "https://example.atlassian.net/wiki/spaces/SHOP/pages/100000/Project+Documentation"
    page_id: "100000"
  pages:
    - { path: docs/user-auth/pages/index.md, page_id: "123456", title: "Login - Documentation", version: 7 }
    - { path: docs/user-auth/pages/audit-log/index.md, page_id: "123490", title: "audit-log - Documentation", version: 1, intent: audit-log }
    - { path: docs/user-auth/pages/audit-log/stories/story-001-record-every-login.md, page_id: "123510", title: "Story 001 - Record every login - Login", version: 4, intent: audit-log }
    - { path: project/pages/architecture/index.md, page_id: "100010", title: "Architecture", version: 12, changed: true }
  fixed: [D-4]
```

`intents` names each intent's own page, only when the inception holds more than one intent, and
every row of a page under an intent page carries `intent: {intent-slug}`.

`version` is the Confluence version you pulled or last pushed. `changed: true` marks a page that
`resolve` wrote into and that `push` still has to send. `fixed` names every decision whose page
corrections `resolve` wrote. Read `sync.yaml` before every mode and write
it back whole, keeping every key you did not touch, the `jira:` block included.

---

## Atlassian access

Use the Atlassian MCP tools, under whatever server name this session gives them:
`getAccessibleAtlassianResources` once for the cloud id of the site in the link, then
`getConfluencePage` (body as markdown), `getConfluencePageDescendants` and `updateConfluencePage`.
Every other Atlassian tool is there too when a step needs one, for example `searchConfluenceUsingCql`
to find a page by its title.

No Atlassian tools at all: return `status: no_tools`. The caller tells the user to connect the
Atlassian MCP server (on Claude Code: `/mcp`) and asks **Connected, try again** or **Continue
without Confluence for this intent**; the second is a dispatch with `answer: skip`, which writes
`skipped: true` under `confluence:`, so the push knows there is nothing to push. Never pretend a pull
happened.

---

## Pull

Input: the link to the documentation page, or `none` when the intent has no page yet (write
`skipped: true` and return). No link given: use `confluence.documentation.url` from `sync.yaml`.

1. Read the page. Its title must fit `intent` (default `{name} - Documentation`); the part in the
   place of `{name}` is the name. Any other title, or a folder instead of a page: return
   `status: needs_input` with the question to paste the link of the documentation page, naming what
   you found and the title it should fit.
2. List every descendant, all levels, paging until the listing is complete. Read each body as
   markdown and write it to its path under `docs/{inception}/pages/`. Several reads in one turn are
   fine. The documentation page opens with the overview section, a link per file of the intent
   overview attached to it: write it into `index.md` like the rest of the page.
   **An intent's own page**: a child of the documentation page whose title fits `intent` with the
   intent slug as the name, or that slug with `(intent)` after a space, where
   `docs/{inception}/{intent-slug}/` holds a `record.yaml` or a `brief.md`. Its whole subtree goes
   under `docs/{inception}/pages/{intent-slug}/`: the page itself is that folder's `index.md`, its
   stories page `stories/index.md`, and every row of that subtree carries `intent: {intent-slug}`.
3. The project page: `project_docs_url` from `project/project.yaml` when set. Otherwise take the
   parent of the documentation page and list its children: the one child titled `project` (default
   `Project Documentation`), or starting with that title and ` -`, is it; write its link into
   `project/project.yaml` as `project_docs_url`, keeping every other key. No match, or more than
   one: go on without it and say so in `note`. Never create a page. Pull its tree into
   `project/pages/` the same way.
4. Confluence is where both trees really live, so the pull replaces the local copy of each tree it
   read. A file that an old row names and no page maps to any more goes into `stale`: you cannot
   delete, the caller does.
5. Write `sync.yaml`: `documentation`, `intents` (an entry per intent page you found, with its
   `url`, `page_id` and the slug as `name`; an entry whose page you did not find goes, named in
   `note`), `project_documentation`, and a row per page with path, page id, title and version, and
   `intent` under an intent page. A row with `changed: true` whose page did not move
   keeps its local file and its flag: never overwrite an answer that was not pushed yet.

```yaml
sync: { skill: confluence, mode: pull, status: done, inception_pages: 14, project_pages: 6, stale: [], note: "" }
```

---

## Project

Project-init reads the shared project pages before any inception exists, as input for the
standards. Input: the link to the project page. No link given: use `project_docs_url`
from `project/project.yaml`. Neither: return `status: needs_input` with the question to paste that
link.

1. Read the page. Its title must be the `project` name (default `Project Documentation`) or start
   with that name and ` -`. Any other title, or a folder instead of a page: return
   `status: needs_input` with the question to paste the link of the project page, naming what you
   found and the title it should have.
2. Write its link into `project/project.yaml` as `project_docs_url`, keeping every other key. No
   file yet: write one with that key alone. The first inception's pull then takes this page and
   never looks for it again.
3. Pull its tree into `project/pages/` as the pull does (step 2 of Pull), replacing the local copy.
   There is no inception yet, so there is no `sync.yaml` to write: the first inception's pull reads
   the tree again and records its rows.

```yaml
sync: { skill: confluence, mode: project, status: done, project_pages: 6, note: "" }
```

---

## Resolve

Every open question in the pulled pages was asked and answered in intake, and the answer is in
`docs/{inception}/{intent}/record.yaml` under `decisions` (`question`, `answer`, `source`). A
`source` is a register id (`S-004`, look it up in `docs/{inception}/register.yaml` for its page file
and line) or a page file with a line. An open question of a project page lives in its digest,
`project/digests/{page-id}.yaml` under `open_questions`; its answer cites that page file and line.

Write each answer into the page it came from, in the language of that page:

- A `TBD`, a "to be decided" or a question in the running text: replace it with the answer.
- An item on an open-questions page: take it off that page and write the answer into the page the
  question is about. When no page is about it, keep the item with the answer under it, marked as
  answered.
- **Page corrections**: every `page_fixes` entry on this page, of a decision with a `mismatch`
  whose id is not in `confluence.fixed` yet: replace its `from` with its `to`, as **Page
  corrections** below says.

With `fixes_only: true` (finish, after its approval) only the page corrections run: no answer is
written again and nothing goes into `open`.

Change only what an answer covers. No rewording, no restructuring, no new sections. Set
`changed: true` on the row of every page you wrote. Then check every register item of kind
`question` that is not `stale`, and every digest `open_questions` item:
one without an answer in the record goes into `open`.
Inception can never be approved while one is left.

```yaml
sync: { skill: confluence, mode: resolve, status: done, pages_written: 3, fixed: [D-4], not_fixed: [], open: [] }
```

---

## Page corrections

A mismatch whose choice says a page gave way carries `page_fixes` in the record: per page, `from`,
the statement word for word as the page has it, and `to`, what replaces it in the page's language.
The page that was one side of the mismatch is one; the intent's story page for a story whose text
the answer changed is another, when it states what changed. A page needs a row in `sync.yaml`: a
file without one (a standard, a local copy) is never corrected here.

**Written**: `resolve` replaces `from` with `to` in the page file, exactly that and nothing else,
sets `changed: true` on its row, and adds the decision's id to `confluence.fixed` once every fix of
it is written. A `from` that is not in the file (the page changed since the pull): leave that page,
and name the decision and the page in `not_fixed`. **Sent**: `push`, the same way as an answer.

**Asked**: never page by page. The approval that comes before the push, the inception's in
`skills/inception/review.md` and finish's in `skills/construction/finish.md` step 8, lists every
correction not in `confluence.fixed` yet, in the user's language, grouped per page: the page title
(with `(project page)` for a page under `project/pages/`), then one line per fix,
`"{from}" becomes "{to}"`. One yes covers them all.

**A correction is small when** its `from` is one sentence, one list item or one table row, its `to`
is again at most one, and it is not a rule on a project page that other intents follow (a
convention, a standard, an architecture rule: how all code or all work is done). Anything else is
large: a `from` of more than one sentence, item or row (a paragraph, a section), a `to` that adds a
sentence, or such a rule. A large one's line names in a few words what changes, marked
`large change`, with its whole new text, `to`, under it, in the same prompt.

---

## Push

Runs right after an approval: the inception's, before the specs commit, or finish's, before its
last commit, so the commit carries the updated `sync.yaml`. Nothing to do when `skipped: true` is
set or no row is marked `changed`.

For every row with `changed: true`:

1. Read the page's current version.
2. **Same version as the row**: update the page with the local file as markdown, with the next
   version number and the message `AI-DLC Turbo: answers from the inception of {intent-slug}`, or
   at finish `AI-DLC Turbo: corrections from the build of {intent-slug}`.
3. **Newer version**: someone edited the page since the pull. Read the new body, apply your changes
   on top of it (what `resolve` changed), write that to the local file, and update the page as in
   2. When your change and theirs touch the same sentence, return `status: needs_input` with both
   sentences; the caller asks the user which one stays and dispatches again with the `answer`.
4. Record the new version in the row and drop `changed`.

Never create a page, never delete one, never move one. A page that no longer exists: drop the row
and name it in `not_synced`. A failed update: retry once, then name the page in `not_synced` and keep
its row as it was, so a later `/specsmd-aidlc-turbo-inception --skill sync {intent-slug}` finishes it.

**The documentation page.** The intent overview is attached to it, and its overview section at the
top links every file. A script keeps that section; the upload is not yours. An update replaces the
whole body with the local markdown, which can mangle or drop the section. So after every push that
wrote the documentation page (the row with the page id of `confluence.documentation`), the section
is put back by script:

```bash
node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs links --page {page_id}
```

You have no shell: return `documentation_pushed: true`, and the caller runs it with the page id of
`confluence.documentation`. A failed run is not a stop, the same as a failed upload: the caller names
its `detail` in the output, and the next upload puts the section back.

An intent's own page carries the same section, for its own overview. A push that wrote one (a row
with the `page_id` of an entry under `confluence.intents`) returns its slug in
`intent_pages_pushed`, and the caller puts the section back with `links --intent {slug}`.

```yaml
sync: { skill: confluence, mode: push, status: done, pushed: 3, documentation_pushed: true, intent_pages_pushed: [], not_synced: [] }
```

---

## Intent pages

Gives every intent of the inception its own page, by the plan of `scripts/intent-pages.cjs`, once
the user said yes to it (`skills/sync/intent-pages.md`). Input: `plan`, the `plan` block that
script printed, as the user approved it. You carry it out and decide nothing: a page the plan does
not name is never created, moved or written. The plan's titles already follow the project's page
names.

1. Read `sync.yaml`. `skipped: true`: return `status: skipped`. Read the plan's `parent`, the
   inception's documentation page, for its space: its `spaceId` when the tool gives it, else the
   space key in its link, looked up with `getConfluenceSpaces`.
2. **Create** every `create` entry, in order. With `page: true`: create `title` under the parent
   with `createConfluencePage` (`spaceId`, `parentId` the parent's `page_id`, `body` as markdown),
   write its entry under `confluence.intents` (`url`, `page_id`, the slug as `name`) and its row at
   `path` with `intent`, and write `body` into that file. Then, with `page: false` too, create
   `stories_title` under the intent's page, its row at `stories_path` with `intent`, and
   `stories_body` into that file. A title that is taken: find the page by its title
   (`searchConfluenceUsingCql`). Under the page it should hang under, left by an earlier run that
   stopped: take it. Anywhere else: create nothing more for that intent, move none of its pages,
   and name it in `not_synced` with where you found that title.
3. **Move** every `move` entry. Read the page with its body in storage format, or as ADF when the
   tool gives no storage, and update it with `updateConfluencePage`: the same body back unchanged,
   in that same format, never as markdown (a markdown round trip can mangle a page), its own title,
   and `parentId` the `page_id` of the intent's stories page (the row at
   `docs/{inception}/pages/{intent}/stories/index.md`). Then write the file at `to` with the
   content of the file at `from`, put `from` into `stale`, and change the row: `path` to `to`,
   `intent`, and `version` to the new one, unless the page had a newer version than the row before
   you moved it (someone edited it since the pull): then the row keeps its version, so the next
   push or pull sees that edit. A row with `changed: true` keeps it. Each of its `children` moved
   with it: write its file at `to`, put `from` into `stale` and give its row the new path and
   `intent`, without a call. A page that no longer exists: drop its rows, put its files into
   `stale`, and name it in `not_synced`.
4. Write `sync.yaml` whole after every page, not at the end, so a failure halfway loses nothing.
   Every page the plan names is a row of this inception under `docs/{inception}/pages/`; one that
   is not is left alone and named in `not_synced`.

```yaml
sync: { skill: confluence, mode: intent-pages, status: done, created: 4, moved: 7, stale: [], not_synced: [] }
```

---

## Never

- Never write outside `.specs-aidlc-turbo/`.
- Never push before the user approved the inception.
- Never write a page correction at finish before the user approved the finished intent, and never
  one the user kept out: finish dispatches `resolve` with `fixes_only: true` only after that yes.
- Never ask about a page correction page by page: the approval lists them all.
- Never push a page that is not marked `changed`.
- Never change the overview section of a documentation page, not even in `resolve`:
  `confluence-attach.cjs` keeps it.
- Never overwrite a newer page without applying your change on top of it.
- Never create or move a page outside mode `intent-pages`, and there only the pages its plan
  names, after the user said yes.
- Never delete a page, and never touch a page outside the inception's tree.
- Never put the story pages of two intents under one page.
