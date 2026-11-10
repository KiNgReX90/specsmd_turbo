# Skill: Review

---

## Role

The one human approval in AI-DLC Turbo. Everything before it was preparation, everything after it
runs without a stop, so this is the moment the user actually decides.

---

## Goal

The user approves the specs, the brief is marked `approved`, and the intent branch exists with the
specs committed on it, in both modes. Construction can start from disk alone.

---

## Input

- `.specs-aidlc-turbo/docs/{inception}/{intent-slug}/`: `record.yaml`, `brief.md`, `stories/`
- `.specs-aidlc-turbo/repo/config.yaml` for `mode`, `branching`, `sync` and, in sandbox mode, the
  `sandbox` block (`code_scaffold`; a missing key is `true`)
- `.specs-aidlc-turbo/docs/{inception}/sync.yaml`, when intake pulled pages from Confluence

---

## Checkpoint

| Checkpoint | Purpose | Wait for |
| ---------- | ------- | -------- |
| Approval | The user approves the brief and the stories | The user's answer |

This is the only checkpoint of the inception. Construction has one, at its very end: the approval before anything is pushed.

---

## Process

### 1. Gate by script

The user approves the files, so the files must be what the record says and pass the lint:

```bash
node .specsmd/aidlc-turbo/scripts/render-specs.cjs {intent-slug} --check
node .specsmd/aidlc-turbo/scripts/spec-lint.cjs {intent-slug}
```

Either one exits 1: back to `render.md`.

Then every intent its own page, before the overview opens: follow
`.specsmd/aidlc-turbo/skills/sync/intent-pages.md`. An intent's story pages and its overview go on
its own page, and the approval is never asked while it fails.

### 2. Open the overview

```bash
node .specsmd/aidlc-turbo/scripts/intent-overview.cjs {intent-slug} --phase inception --no-open
```

It writes `overview.html` next to the brief, from the record, the brief and the stories: one page,
the same file in the browser, in the artifact, on Confluence and on the epic. Its tabs:

- **Functional**, always: the intent in plain words, its life cycle with the stories on its steps,
  the vertical slices of every story through the layers of the system, the integration tests as
  arrows from an earlier story to the later story that tests with it, what is deliberately left
  out, and per story, on a click, its user story, acceptance criteria and the code it touches.
- **Code Scaffold**, when the record has a drawing: the code the intent builds, each flow played step
  by step from its start, per story what it builds and uses, each part in the colour of how sure it is.
- **C4 model**, when the record has the C4 block: who uses the application, the systems around it,
  its containers and the components that hold the drawing's parts.

**Details**, on when the page opens, shows the plain texts of the intent and of every story; **?**,
off when the page opens, shows the page's own explanations and how to read each tab. Never write or
edit that page by hand.

When the script prints `Missing:` lines, the record lacks part of the C4 model or the plain texts:
write it as `plan.md` step 4d says, render and lint as in `render.md`, and run the command again,
until no `Missing` line is left.

Then publish the page as an artifact and open it, when this session has an Artifact tool (Claude
Code with claude.ai artifacts):

1. Read `overview.html` in full: the tool publishes no file the agent has not read.
2. Publish it with the Artifact tool: `file_path` the overview, icon `map`, and as description one
   sentence in the record's language with the intent's title, for example `Overview of the inception
   Log in with a code, for approval.`. When `docs/{inception}/sync.yaml` already has a link under
   `overview.{intent-slug}.artifact` (a change round, or an earlier session), publish to that `url`,
   so the link stays the same; a session that has not published it yet reads it first with
   `action: read`, as the tool asks. The first publish of the intent writes the link it returns
   there:

   ```yaml
   overview:
     user-auth:
       artifact: https://claude.ai/code/artifact/...
   ```

3. Open that link in the browser, always, also when the host shows the artifact itself:

   ```bash
   node .specsmd/aidlc-turbo/scripts/open-browser.cjs {artifact link}
   ```

   It prints `Opened: {link}`, or why not: then name the link, so the user opens it.

No Artifact tool, or the publish fails or is refused: run the script again without `--no-open`, so
the file opens in the browser, and name in one line why there is no artifact. When the browser
cannot be opened either, the script still writes the file: name the path.

In the terminal, say only that the page is open, with its artifact link or its path, and the counts: stories, build steps,
planned integration tests. Then list every `deliberately_not` item of the record, one line each: what is left
out, in plain words (the statement from the page, never its id), and why: the user approves what is left out as much as what is built. Then every decision
with source `assumption`, one line each: what it takes for granted that no code backs, in plain
words, so the user approves it knowingly. Then every decision with a `mismatch`, one line each: its
`what` and its `chosen`, since a yes sends them to the epic in Jira. Then the page
corrections those decisions bring, grouped per page, as `skills/sync/confluence.md` **Page
corrections** says, a large one with its new text: a yes pushes them. Do not repeat the rest of the
page.

When the browser could not be opened, show in the terminal, in this order: the brief's `## Intent`,
per story its title, user story and acceptance criteria, and the integration tests one line each (the
two stories by title, and the test), in the record's language like the page. Leave the agent half out: the
user approves the behaviour, not the implementation.

### 3. Ask whether everything is right

Ask, in the user's own language, whether everything on the overview page is right, on every tab it
shows, with the host's multiple-choice prompt where one exists (on Claude Code: AskUserQuestion).
Offer:

- **Yes, approve** (recommended, listed first)
- **Yes, and build it here now**: only for `lane: quick`
- **No, change a requirement or a decision**
- **No, change the story split**
- **The Code Scaffold is wrong**: word for word as the overview page names it, in the record's
  language (`design.legend.asks.option` of its string table): the page tells the user to pick it. Ask what must change when the answer does not say
  it. Only when the intent has a Code Scaffold: a sandbox with `sandbox.code_scaffold: false` has
  none, so this option and the open choices below are left out, and no question names it.

**The open choices of the Code Scaffold**, its red parts (`open`), are asked in the same
prompt, one question each after the approval question: the part's `open_detail` in plain words, a
concrete proposal first, then the alternatives the code and the decisions give (on Claude Code at
most four questions in one prompt; the rest follow in the next prompt, before anything is stamped).
Write every answer into the record as a decision with source `user`, take `open` and
`open_detail` off the part, put the choice into the stories that build it, and render and lint
as in `render.md`. With a yes, go on to step 5: the user approved with these choices. An answer that
is not one of the options, or that adds a part or moves work to another story, is a change: step 4.

Anything else the user types, a wording change for example, is a change and routes back through
step 4. Nothing is approved and nothing is committed until the user answers yes. A yes is the
option itself or words that plainly approve; a remark, a wish, a question or "looks good,
but ..." is no yes, and neither is an answer to a question you asked about a change.

When `sync` is on, say in the question what a yes also does: the changed Confluence pages go back,
the page corrections among them, and the epic and the stories are created in Jira, with the
overview attached to the epic. A yes is the permission for both.

Never ask this question while an open question is left, in the record, in a story or in a pulled
Confluence page. Such a question goes back to `intake.md` first. The open choices of the Code
Scaffold are the one exception: they are asked with it.

### 4. On change, route back

**First weigh it.** A change the user asks for is never taken blindly: check it against the record, the code, the standards and the pages. When it
holds, take it without a discussion. When it does not, or it breaks a decision, a standard, the
architecture or another story, say so once in plain words, why and what you propose instead, and
let the user choose, your proposal first. Discuss it further only when the user asks about it.
A question about the plan is answered, never taken as a change until the user says it is one.
Nothing is built while a change is open: what is agreed is fixed in the plan below, and the user
checks it on the page again.

| What is wrong | Where it is fixed |
| ------------- | ----------------- |
| A requirement, a decision, a fact, what is left out | `intake.md`, for that item only, then `render.md` |
| The story split, the order, a dependency | `plan.md`, then `render.md` |
| Wording, a section that reads badly | The record's text for it, then `render.md` |
| The Code Scaffold (**The Code Scaffold is wrong**): a part, a module, a link, what a story builds or uses | `plan.md` step 4c, with every story, `touches` or decision the correction moves (a decision through `intake.md` first), then `render.md` |

A change never skips the lint or `cross-check.md`. Then render the overview again as in step 2, so a
corrected Code Scaffold is drawn again before anything is built, name in the terminal what you
changed in the plan, one line each, so the user checks exactly that on the page, and ask again as
in step 3, until the user answers yes.

### 5. On approve, stamp and sync

**First**: check that the working tree is clean apart from `.specs-aidlc-turbo/`
(`git status --porcelain -- . ':!.specs-aidlc-turbo'`). When it is not, stop here and tell the user
what is uncommitted: nothing is stamped, nothing is pushed to Confluence or Jira, no branch is made.
Ask for the yes again once the tree is clean.

1. Set in the brief frontmatter `status: approved`, `approved` (the real current date, read from the
   machine with `date -u +%Y-%m-%d`, never typed from memory), `mode` (the value of
   `config.mode`) and `turbo_version`, the version `node .specsmd/aidlc-turbo/scripts/intent-status.cjs --version` prints
   (leave it out when it prints `unknown`): construction names it when another version builds.
2. Render the overview again with the command of step 2, so it shows the approved status.
3. **Publish it again**: when the overview is an artifact, read it in full and publish it again to
   the same link, without opening it: the tab that is open shows the approved page after a reload.

   Then save **the Code Scaffold page**, when the intent has a Code Scaffold (always in production;
   in sandbox mode unless `sandbox.code_scaffold` is `false`):

   ```bash
   node .specsmd/aidlc-turbo/scripts/intent-overview.cjs {intent-slug} --phase inception --scaffold --no-open
   ```

   It writes `code-scaffold.html` next to `overview.html`: the same page, opening on the Code
   Scaffold, the technical view. Without a Code Scaffold it writes nothing and says so: then there is
   nothing to publish and nothing to report. Publish it as an artifact the way step 2 publishes the
   overview: read `code-scaffold.html` in full, publish it with the Artifact tool, icon `code`, and as
   description one sentence in the user's language with the intent's title, write the link it
   returns into `sync.yaml` under `overview.{intent-slug}.scaffold` (next to `artifact`), and open it
   with the `open` action. A link already there: publish to it, after a read as the tool asks. No
   Artifact tool, or the publish fails or is refused: run the script again without `--no-open`, so
   the file opens in the browser, and name in one line why there is no artifact.
4. **Confluence**: when `sync.docs` is `confluence` and intake pulled pages, first run the check of
   step 1 once more:

   ```bash
   node .specsmd/aidlc-turbo/scripts/intent-pages.cjs check --inception {inception}
   ```

   `ok: false`: push nothing and upload nothing, add the intent slug to `pending_upload` under
   `confluence:`, and name it: `/specsmd-aidlc-turbo-inception --skill sync {intent-slug}` puts the
   pages right first. Otherwise dispatch the sync agent with
   `.specsmd/aidlc-turbo/skills/sync/confluence.md`, the intent slug, the inception slug and mode
   `push`. When it returns `documentation_pushed: true`, the push replaced the body of the
   inception's documentation page, so put its overview section (`sync.page_names.overview_section`,
   default `Interactive overview`) back, with the `page_id` of `confluence.documentation`:

   ```bash
   node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs links --page {page_id}
   ```

   For every slug in `intent_pages_pushed` the push replaced an intent's own page; put its section
   back the same way: `node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs links --intent {slug}`.
   A failed run (exit 1) is not a stop: name its `detail` in the output. The upload below puts the
   section back as well.
5. **The overview on Confluence**: once the push is back, unless Confluence is skipped
   (`skipped: true` under `confluence:`), attach the approved overview to the intent's own
   documentation page:

   ```bash
   node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs upload --intent {intent-slug} --file .specs-aidlc-turbo/docs/{inception}/{intent-slug}/overview.html
   ```

   Without `--name` the script names the file as `sync.page_names.overview_file` says (default
   `overview-{intent-slug}.html`), the name step 7 gives it on the epic too. It takes the page from
   `sync.yaml`: `confluence.intents.{intent-slug}`, or for an inception of one intent its
   `confluence.documentation`, and never the shared page of an inception with several intents.

   Every upload also keeps the overview section at the top of the page: a link per `.html`
   attachment, the rest of the page as it was. No page for the intent or a failed upload (exit 1,
   often no `ATLASSIAN_EMAIL` or `ATLASSIAN_API_TOKEN` set) is not a stop: add the intent slug to
   `pending_upload` under `confluence:` in `sync.yaml` and name why in the output, with the
   upload's `detail`.
6. **Jira**: when `sync.issues` is `jira`, dispatch the sync agent with
   `.specsmd/aidlc-turbo/skills/sync/jira.md`, the intent slug, the inception slug and mode
   `after-inception`.
7. **The overview on Jira**: once the Jira sync is back with the epic
   (`jira.intents.{intent-slug}.epic` in `sync.yaml`), attach the approved overview to it, with the
   artifact as a web link, under the name `sync.page_names.overview_file` gives it (default
   `overview-{intent-slug}.html`; `node .specsmd/aidlc-turbo/scripts/lib/page-names.cjs` prints the
   names):

   ```bash
   node .specsmd/aidlc-turbo/scripts/jira-attach.cjs upload --issue {epic} --file .specs-aidlc-turbo/docs/{inception}/{intent-slug}/overview.html --name overview-{intent-slug}.html --link {artifact link}
   ```

   Leave `--link` out when there is no artifact. Running it again replaces the file and updates the
   link, never doubles them. No epic, or a failed upload (exit 1, often no `ATLASSIAN_EMAIL` or
   `ATLASSIAN_API_TOKEN` set), is not a stop: set `pending_jira: true` under
   `overview.{intent-slug}` in `sync.yaml` and name why in the output, with the upload's `detail`.

Handle both sync results as the agent file says (`needs_input`, `no_tools`, `stale`). Both write what
they did into `docs/{inception}/sync.yaml`, which step 6 commits with the specs. A sync or an upload that
could not run is not a stop: it is recorded as pending, named in the output, and finished later with
`/specsmd-aidlc-turbo-inception --skill sync {intent-slug}`.

### 6. Branch and commit

Both modes do this.

1. Apart from `.specs-aidlc-turbo/`, the working tree is clean: step 5 checked it before anything
   was stamped or synced.
2. When a remote exists, fetch first, so the branch starts from the current base:

   ```bash
   git fetch origin
   ```

3. Create the intent branch from `branching.base_branch`. The name is
   `{project_key}/intent-{intent-slug}/intent`, without the `{project_key}/` part when the key is
   empty:

   ```bash
   git switch -c shop/intent-user-auth/intent main
   ```

   With a remote, start from `origin/{base}` instead when the local base is behind it
   (`git merge-base --is-ancestor {base} origin/{base}` works): a merge request merged on the remote
   since must be in the new intent. A local base with commits of its own stays the start point.

   When a branch with that name already exists locally or on the remote, append `-2`, `-3` and so on
   to the slug part (`intent-{intent-slug}-2`) and record the branch actually used in the brief.

4. Write the branch name into the brief frontmatter as `branch:`, the one place every later step reads
   it from. Then commit the inception with the project layer it grew:

   ```bash
   git add .specs-aidlc-turbo/docs/user-auth .specs-aidlc-turbo/project .specs-aidlc-turbo/repo/repo.yaml
   git commit -m "docs(user-auth): inception brief and stories"
   ```

   Add `.specs-aidlc-turbo/repo/tooling.yaml` to that `git add` when it exists and git does not have
   it yet or it changed: the code tooling choice is the team's and travels with the repo, so a
   teammate who pulls the branch gets the same tooling. The intent folder holds `code-scaffold.html`
   when step 5 saved it, so it goes in this commit like the overview.

   The flow never pushes here and never merges.

### 7. Hand off

Everything construction needs is on disk, so construction starts best in a clean session. End with
the approval summary and, as its last line, exactly:

```text
/clear then /specsmd-aidlc-turbo-construction {intent-slug}
```

Only with **Yes, and build it here now** (quick lane): say in one line that construction starts, then
continue in this same session as the construction agent: read
`.specsmd/aidlc-turbo/agents/construction-agent.md` and follow the first steps of
`/specsmd-aidlc-turbo-construction` for `{intent-slug}`.

---

## Output

```text
user-auth approved.

- 9 requirements, 5 decisions, 3 stories, 2 deliberately not
- Branch: shop/intent-user-auth/intent (specs committed)
- Confluence: 3 pages updated, the overview attached to the intent's own documentation page
- Jira: epic SHOP-100, 3 story issues, the overview attached with its artifact link
- Overview: https://claude.ai/code/artifact/... (.specs-aidlc-turbo/docs/user-auth/user-auth/overview.html)
- Code Scaffold: https://claude.ai/code/artifact/... (.specs-aidlc-turbo/docs/user-auth/user-auth/code-scaffold.html)

/clear then /specsmd-aidlc-turbo-construction user-auth
```

With an artifact, add one line: the artifact is private until the user shares it on claude.ai, so
colleagues open the file on the epic, or the link once it is shared.

Leave out the Code Scaffold line when the intent has none: a part that is off is not reported.

When an upload failed, its Confluence or Jira line says so with its `detail` and names
`/specsmd-aidlc-turbo-inception --skill sync {intent-slug}` to send it later.

---

## Transitions

- Approved -> `/clear`, then `/specsmd-aidlc-turbo-construction {intent-slug}`
- Yes, and build it here now (quick lane) -> construction for `{intent-slug}`, in the same session
- Changes requested -> back to `intake.md`, `plan.md` or `render.md`, then here again
