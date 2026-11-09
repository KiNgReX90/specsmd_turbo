# AI-DLC Turbo

The slim AI-DLC flow. One inception pass decides everything, then construction builds every story. You approve twice: the plan, and the finished intent before anything is pushed.

---

## What it is

AI-DLC Turbo produces per intent **a record** of everything intake learned, and from it, by script, **one brief** and **a set of stories**. No units, no bolts, no separate design documents, no decision ledger, no logs. A decision lives in the brief, or in the story it governs.

Three rules shape the whole flow:

1. **Everything is decided in inception.** Requirements, design decisions, the domain model, the technical design with its Code Scaffold, the exact slices of code a builder has to read, and the commands that prove the work. If intake surfaces a question, it is answered with you, not parked as a TBD.
2. **Two human approvals, none halfway.** At the end of inception, and for the finished intent before anything is pushed. In between, construction runs to the end. A builder that hits an unclear point decides it from the brief, the standards or the code, and writes the decision into the story. Only a story that misses three times, or a mismatch (the story, the brief, the documentation or the code that do not agree), comes back to you, and only that story waits. A mismatch is always put to you as a question: your answer becomes a decision in the record, and with Confluence and Jira on, a page that turned out wrong is corrected on Confluence and the answer reaches Jira once you approve the finished intent.
3. **Quality is not traded for speed.** Every builder works test-first. A script runs the verification commands and keeps the proof. Every story is reviewed by agents with fresh eyes, side by side: against the story, on quality and safety, and against the project's own rules. The whole intent gets one more review at the end, a live test on the running application and, where a user puts something in, a break test. Mechanical work (rendering specs, checking them, running tests, committing) is done by scripts, so it costs no model tokens.

---

## Install

```bash
npx specsmd@latest install
```

Pick **AI-DLC Turbo** when the installer asks for a flow. It asks a handful of project questions and writes `.specs-aidlc-turbo/repo/config.yaml`. An existing config is never overwritten. An install over the old layout moves it first (see [Upgrading](#upgrading)).

---

## The commands

| Command | What it does |
|---------|--------------|
| `/specsmd-aidlc-turbo` | Master. Reads the state and sends you to the right command. Start here. |
| `/specsmd-aidlc-turbo-inception` | Intake, planning, spec writing, and the approval of the plan. |
| `/specsmd-aidlc-turbo-construction` | Builds every story of an approved intent, with review and commits, and asks your approval before the push. |
| `/specsmd-aidlc-turbo-review-fix` | Processes the review comments on the merge requests of a finished intent, story by story. GitLab only. |
| `/specsmd-aidlc-turbo-config` | Shows the project settings and changes the ones you name. |

The phase agents dispatch the other roles as subagents. Every role pins its model and effort, so nothing runs on the session model by accident:

| Agent (`specsmd-aidlc-turbo-…`) | Model | Effort | Job |
|---------------------------------|-------|--------|-----|
| `builder` | Opus | high | Builds medium and hard stories, and every fix |
| `builder-low` | Sonnet | high | Builds low stories |
| `reviewer` | Opus | high | Story review through one lens (the story, quality and safety, the project's own rules), side by side, and the delta re-review of a fix |
| `intent-reviewer` | Opus | xhigh | The intent review at the end, the whole only |
| `debugger` | Opus | high | After a second miss: the root cause with evidence, then a plan or a stop. Never edits |
| `cross-checker` | Opus | xhigh | Inception: the stories against each other and the code |
| `docs-verifier` | Opus | xhigh | Inception: the meaning of the stories against the source register |
| `docs-reader` | Sonnet | medium | Reads new or changed pages into the source register and the digests |
| `explorer` | Opus | high | Read-only code explorer, at most three per intake, plus at most three proposal checks during the questions and a place check while plan draws the Code Scaffold |
| `test-writer` | Sonnet | high | Test case plus Playwright twin, at finish |
| `live-tester` | Sonnet | high | Live test at finish |
| `breaker` | Opus | high | Attacks the running app at finish, on the stories marked for it |
| `sync` | Sonnet | medium | Confluence pull, resolve and push, every intent its own page, and the Jira writes |

A Sonnet role that fails is dispatched once more on Opus.

---

## File layout

```text
.specs-aidlc-turbo/
├── repo/                           the whole repo, stays across intents
│   ├── config.yaml                 mode, branching, sandbox parts, tester, mutants, sync
│   ├── repo.yaml                   the codebase scan and the last live-test facts
│   ├── tooling.yaml                the code tooling chosen for this repo, or none
│   └── standards/                  tech-stack.md, coding-standards.md, data-stack.md, ...
├── project/                        the project around the repo
│   ├── project.yaml                project type, Confluence and Jira links
│   ├── pages/                      the shared "Project Documentation" from Confluence
│   └── digests/                    what the docs reader made of those pages
└── docs/
    └── user-auth/                  one inception
        ├── pages/                  its "{name} - Documentation" pages from Confluence
        │   └── audit-log/          with several intents: an intent's own "audit-log - Documentation" page and its stories
        ├── register.yaml           every statement in those pages, numbered S-001, ...
        ├── sync.yaml               which Confluence pages and Jira issues belong to it
        └── user-auth/              one intent
            ├── record.yaml         everything intake learned; the specs are rendered from it
            ├── brief.md            the one planning document
            ├── stories/
            │   ├── 001-register-account.md
            │   └── 002-login.md
            ├── proof/              test results per story, written by script
            ├── tests/              only when tester.enabled is true
            │   └── US-002 - Login.md
            ├── overview.html       the one page, before and after the build
            ├── code-scaffold.html  the Code Scaffold page, saved after the approval
            └── code-scaffold-built.html  the Code Scaffold as built, saved at finish
```

An inception with one intent uses the same slug for both folders. With Confluence on, every intent has its own page: with one intent that is the `{name} - Documentation` page itself, with several each intent gets its own `{intent} - Documentation` page under it, with its own `{intent} - Stories` page, and story pages of two intents never share a parent. Builders and reviewers never read the pages or the register: the story is their single source. Playwright twins go to `{playwright_test_dir}/aidlc-twins/`. With no tester the `tests/` folder is never created.

The flow's own resources live in `.specsmd/aidlc-turbo/`: agents, skills, templates and scripts.

---

## Config

`.specs-aidlc-turbo/repo/config.yaml`, written by the installer, edited with `/specsmd-aidlc-turbo-config`. Every key is optional.

```yaml
mode: production            # production | sandbox
branching:
  project_key: ""           # short lowercase branch prefix, empty = none
  base_branch: main         # branch every intent starts from and goes back into
  story_branches: true      # production only: a branch per story, pushed at the end once you approve; false for small work
  sandbox_finish: push      # sandbox only: push = straight onto the base branch, merge_request = one merge request
tester:
  enabled: false            # a human tester exists: write test cases, in the record's language
sandbox:                    # sandbox only; production always makes both
  code_scaffold: true       # the Code Scaffold, saved as code-scaffold.html
  scaffold_after_build: true  # the Code Scaffold updated as built, saved as code-scaffold-built.html
construction:
  mutants: 3                # lines a script breaks per story to prove its tests can fail; 0 = off
sync:
  docs: none                # confluence | none, optional
  issues: none              # jira | none, optional
  # jira_project_url: ""    # with jira: link to the Jira project board, empty = asked at the first sync; project/project.yaml wins
```

- **Both modes use git**: one branch per intent (`{project_key}/intent-{slug}/intent`), made at the approval, every story built in its own worktree, side by side when they do not depend on each other, with the same reviews, mutants, live test and break test, and the same approval of the finished intent before anything leaves the machine.
- **production** has a branch per story or, for small pieces of work, one commit per story on the intent branch, and, once you approve the intent on its overview page, a push at the end that opens the merge request (GitLab) or pull request (GitHub) into the base branch. It never merges.
- **sandbox** is production without story branches: every story is one commit on the intent branch. At the end it does what `sandbox_finish` says. `push`, the default, puts the finished intent straight onto the base branch and pushes it, without a merge request; a repository without a remote keeps it on the local base branch. `merge_request` pushes the intent branch with one merge request into the base branch. The setup asks no Confluence or Jira questions in sandbox.
- **The sandbox parts**: in sandbox, `sandbox.code_scaffold` and `sandbox.scaffold_after_build` switch off the Code Scaffold and its update after the build. Both are on by default, and the installer asks them right after the mode when you pick sandbox. A part that is off is not drawn, rendered, saved or published, and nothing reports it as missing. Production always makes both.
- **The Code Scaffold page** is saved next to the specs as `code-scaffold.html` once the approval round is done, and as `code-scaffold-built.html` at finish once it is updated as built. Both are the overview page opening on its Code Scaffold tab, both are committed with the specs, and both are published to one claude.ai artifact link when Claude Code has the Artifact tool, then opened in the browser. The first one is never overwritten.
- **A folder without git** is asked once, at the start of an inception or of construction, whether it may become a git repository with one first commit. Without git the flow stops.
- **story_branches: true**, the default in production, gives every story its own branch (`{project_key}/intent-{slug}/story-{SSS}-{story-slug}`), pushed with its own merge request at the end, once you approve the intent. Nothing is pushed during the build. A story without dependencies starts from the intent branch and its merge request goes there. A story that depends on another one stacks on that story's branch. At the end a local branch with every story on it is verified and reviewed, and the intent branch gets the specs, the review and the test cases.
- **The live test** runs at the end of every intent, in both modes, and has no setting: a fresh agent works out how the application starts, starts it on the intent's code, tries every acceptance criterion a user can see and reports what it saw. What fails is fixed before the intent closes.
- **The break test** follows it, for the stories inception marked `break_test`: the ones where a user puts something in or changes something. A fresh agent that never sees the code attacks the running application with wrong input, the wrong order and the wrong rights, at most ten attacks per story, and every real defect it finds is fixed and checked again before the intent review. The quick lane skips it.
- **Confluence and Jira are optional and off by default** (`none`). The production setup offers them; there is no default site: the Jira board link, or the Confluence page you paste, names it.
- **sync.docs: confluence** makes the inception ask for the intent's `{name} - Documentation` page. It pulls that tree into `docs/{inception}/pages/` and the shared `Project Documentation` into `project/pages/`, puts every open question in those pages to you during the interrogation, writes the answers into the pages, and pushes the changed pages back right after you approve. The approved overview is attached to the intent's own page as `overview-{intent-slug}.html`, and that page lists every attached page in its `Interactive overview` section at the top. An intent of an inception with several intents gets its own `{intent} - Documentation` page with its own `{intent} - Stories` page; the agent creates those and moves the story pages under them after one question that names every page, and never deletes one. A script checks it: while an intent has no page of its own, the inception is not approved and nothing is pushed. The inception cannot be approved while one question is still open.
- **sync.page_names** sets the names the sync looks for and gives, each a template with `{name}` or `{slug}`: `intent` (default `{name} - Documentation`), `stories` (`{name} - Stories`), `project` (`Project Documentation`), `overview_section` (`Interactive overview`) and `overview_file` (`overview-{slug}.html`). A name you leave out keeps its default; `node .specsmd/aidlc-turbo/scripts/lib/page-names.cjs` prints the names in use.
- **sync.issues: jira** creates the epic and one issue per story right after the approval, and once the whole intent is built and you approved it closes the story issues and adds the test cases. `jira_project_url` is the link to the project board; the agent reads the site and the project key from it.
- Only Confluence and Jira are supported today. Name another tool and the flow says it is not supported yet.

---

## Code tooling

Every Turbo command starts by checking the code tooling of the repo: a language server per language the repo really uses (on Claude Code a plugin, reached through the LSP tool), and the analysis tools and linters the project already has. The first time, the agent proposes a choice from what the repo holds and sets it up with you; the choice lives in `repo/tooling.yaml`, committed with the repo, also when you choose none, so it is never asked again. A teammate who pulls the repo gets the same choice, and every start checks that this machine has the tools; what is missing is offered to install. The explorers and the cross-checker find existing code sooner with it, and the builders, reviewers and debugger catch more, sooner. `/specsmd-aidlc-turbo-config` changes the choice.

---

## What happens in inception

1. **Intake.** A new inception first names the leftovers of earlier work, old AI-DLC folders and finished Turbo inceptions, and cleans them up in one local commit when you say so; open Turbo work is named with how to continue it and never removed. The agent starts the intent's `record.yaml` and writes every answer and decision into it at once. With Confluence on it asks for the intent's page and the sync agent pulls it. The docs reader reads only pages that are new or changed and numbers every statement in the source register. The agent greps the code itself and sends an explorer only into an area it still cannot place, at most three. Both first look, for every backend change, for where a user sees or starts it (a screen, menu, tab, button, route or API), and that sets per acceptance criterion where the tester checks it. The explorers also find what already exists that the work hangs on: the right, the menu place, the closest screen, the table or service. And where the new code lands: the module, where it is registered in the build, and the existing part a new one copies.
2. **Interrogation.** One closed question at a time, with a proposed answer. A proposal that names code (a right, a menu place, a table) is first checked against what already exists; one that no code backs is marked as an assumption, and the cross-checker checks it again before the approval. Every conflict between the docs and the code, and every open question in the pages, is put in front of you. An answer to a Confluence question is also written into the page it came from.
3. **Planning.** The work is cut into stories: vertical slices, each with the files it touches and the sources it covers. At most two small stories go through the quick lane. Then the agent draws the **Code Scaffold**: the modules, classes, files and tables the stories build, change or use, per layer, with what calls what and per story what it builds. Each part carries its evidence (its place in the code, or the example a new part copies), and its colour follows from that by fixed rules: green, orange for doubt or a part known only from documentation, red for a choice still open. Every arrow into existing code carries its proof too, or what the change adds. The scaffold is the approved starting point of the code, roughly how it is built, not a source of truth: the page after the build shows it as approved, with where the build deviated from it. Next to it the agent writes the C4 model (who uses the application, the systems around it, its containers and the components that hold the scaffold's parts) and the intent and every story in plain words. Nothing in them is invented: what the record lacks, the overview names in one `Missing:` line each, and the agent writes it before you see the page.
4. **Specs by script.** `render-specs.cjs` writes the brief and the stories from the record. `spec-lint.cjs` checks their form, and that every statement in the register is covered by a story or left out on purpose with a reason. Then the cross-checker and the docs verifier read them in parallel; what they find is fixed in the record and rendered again.
5. **Approval.** An overview page in the record's language opens in the browser, as a claude.ai artifact when Claude Code has the Artifact tool. It is one page with a tab per view: **Functional** (the intent in plain words, its life cycle with the stories on the steps, the vertical slices of every story through the layers of the system, the integration tests between the stories, what was left out on purpose, per story the user story, its acceptance criteria and the code it touches), **Code Scaffold** (the code the stories build, each flow played step by step from its start) and, when the record has a C4 model, **C4 model** (who uses the application, the systems around it, its containers and their components). **Details**, on when it opens, shows the plain texts; **?**, off when it opens, shows the page's own explanations and how to read each tab. A tech lead or architect corrects the drawing there: **The Code Scaffold is wrong** sends it back to planning and it is drawn again before anything is built, and its open choices are asked in the approval question itself. On yes, with Confluence on, the approved overview is attached to the intent's own documentation page as `overview-{intent-slug}.html`, linked at the top of that page, and the changed pages go back; with Jira on, the epic and the stories are created and the approved overview is attached to the epic with the artifact as a web link. The intent branch is created and the specs committed.
6. **A clean start.** The agent prints one line: `/clear`, then `/specsmd-aidlc-turbo-construction {intent}`. Everything construction needs is on disk.

The brief holds: the intent (in the record's language), requirements (`FR-n`, `NFR-n`) with their sources, design decisions (`D-n`), the domain model, the technical design with the Code Scaffold, a codebase reading list with line ranges, standards deltas, the verification commands, the story map, and `## Lessons`. A story has a half for the product team in the record's language and an English half for the agent, with its own Code Scaffold: what it builds and what it uses.

---

## What happens in construction

The construction agent reads only `intent-status.cjs --json`. An intent approved with another version of Turbo than the one that runs is named first, and you choose whether to go on. Stories that do not depend on each other are built at the same time, each in its own git worktree, in both modes. Per story:

1. `story-start.cjs` claims the story, creates its worktree and names the builder and the standards to pass.
2. The builder works test-first, builds what the story's Code Scaffold names and reports anything extra or built differently, with the reason, and returns. A new right, table or module the scaffold does not name is put to you first; only that story waits. `story-verify.cjs` runs the verification commands and writes the proof.
3. The reviewers read the diff side by side: one against the story, its proof and its Code Scaffold, one on quality and safety, and one against the project's own rules (the standards and the Project Documentation). A script then breaks a few lines the story changed, to prove its tests can fail. Their verdicts become one; a criterion of the story that breaks a rule of the project goes to you. A pass goes to `story-land.cjs`, which commits it and carries it onto the intent branch. Minor findings are fixed without a second review.
4. **The ladder.** A real miss goes to the builder in fix mode, and the reviewers check only the fix. A second miss sends the debugger for the root cause. A third miss blocks the story for you. Only that story waits: the others keep building.
5. **A mismatch** (the story, the brief, a page or the code that cannot all hold) is never settled by the agents. It is asked as a closed question with both sides quoted, and your answer becomes a decision in the brief and the record. Only a story whose code changes with the answer waits.

When every story is done: the verification commands run once more, the live test runs, the breaker attacks the marked stories, the intent reviewer checks every requirement and the files several stories share (with the same ladder), and the test cases are written against the running app. The overview page is rendered again: the Code Scaffold tab is now **Code**, the drawing as approved, never updated, played step by step, with the marks of where the build deviated from it and why, and **Review** joins it: every changed file with its change, which leads to the merge request once that is open.

Then you approve the finished intent on that page. Nothing has left the machine yet. You can approve the push; ask to change something first, which is planned as at the inception (record, specs, Code Scaffold, the page again) and built only on your explicit go; ask questions about the code, answered from the code itself; or keep it local. Only after the approval everything is pushed: production and sandbox with `merge_request` open every merge request or pull request, sandbox with `push` puts the intent onto the base branch and names the commit. With Confluence on, the page corrections your answers to mismatches decided go out; with Jira on, the story issues are closed with a comment that links their merge request, or names the base branch and the commit. Every merge request gets its description, in three sections (Summary, Evidence, Merge danger); a later push keeps it and adjusts only the sections a change makes wrong. The summary is the first place you see the merge requests, and its last line says whether you can merge.

A `done` intent that is not merged yet can be finished again (**Finish again**): every test case is proven again, a twin that did not run is run, an intent kept local is pushed after a new approval.

---

## Review comments after finish

The merge requests are reviewed after finish, so the comments arrive on stories that are done. `/specsmd-aidlc-turbo-review-fix` handles them without finishing the whole intent again. It reads the comments from GitLab, with a `GITLAB_TOKEN`. On the intent branch it takes every open comment of the intent's merge requests, on a story branch only that story's. It judges each comment against the code and the story, and you decide per comment: fix it, answer it, or leave it for later. Every story with a fix gets the builder in fix mode in its own worktree on its own branch, the verification and a delta review, and the fix is carried into the story branches that build on it. Once you approve, the branches are pushed and every decided comment gets its answer; resolving it stays with the reviewer.

A fix is small when it changes only the story's own files and no test. Otherwise the test cases of that story, and of every story that shares a changed file, are no longer proven (`twin_result: outdated`), and **Finish again** proves them again before the merge.

---

## The tester option

Set `tester.enabled: true` when a person tests this software. Leave it `false` and nothing test-related is written at all, not even the folder.

For every story with an acceptance criterion a tester can check on a screen, through an API, in the database or in a log (each criterion says where, whatever the story's `surface`; `tester_verifiable` follows from that), construction writes a test case at the very end, once every story is built, the intent is reviewed and every finding is fixed, in the record's language under the intent's `tests/` folder, grounded in the real UI or API code, so the labels, routes and messages in the steps are the ones actually on the screen. It has a preparation section, a numbered step plan with one action per step, the expected result, a regression check with a step for every place the change reaches that a tester can check (screens, API, database, logs, jobs), with no maximum, and a short note for the agent. The overview page is then refreshed with the test cases in it.

When the project has a UI and ships Playwright and a step of the test case runs on a screen, the same test case also gets a **twin**: a Playwright spec that walks the same steps. The twin runs against the running app. When the app fell over, it is restarted once and the twin runs again; when it still does not answer, the flow stops and asks you, and a test case whose twin never ran is never sent to Jira.

---

## The scripts

Node builtins only, so they run in a project without `node_modules`. Every script takes `--root` (default `.specs-aidlc-turbo`).

| Script | Use |
|--------|-----|
| `leftovers.cjs` | At the start of a new inception: names the leftovers of earlier work and the open Turbo work, and `--remove` cleans up the leftovers in one local commit. |
| `tooling.cjs` | The code tooling of the repo: `check` at every start, `facts` for the setup, `brief` for every subagent, `run` for the analysis tools on a change. |
| `codebase-scan.cjs` | Detects the stack, the test runners and the build and test commands. `--write` fills `repo/repo.yaml`. |
| `source-register.cjs` | Which pages need reading, and merges the docs reader's statements into `register.yaml`. |
| `render-specs.cjs` | Renders the brief and the stories from `record.yaml`. |
| `spec-lint.cjs` | The gate before approval: form and coverage of the specs. |
| `intent-overview.cjs` | Renders the overview page, one page before and after the build, with the drawing and tabs from `templates/design/` and, when the record has a C4 model, the C4 model tab from `templates/overview-v5/`, and names in one `Missing:` line each what the record lacks of the C4 model and the plain texts. `--scaffold` writes the Code Scaffold page instead. |
| `overview-links.cjs` | After the push: puts the merge requests on the approved overview, without rendering it again. |
| `open-browser.cjs` | Opens the overview's artifact link, or its file, in the default browser. |
| `confluence-attach.cjs` | Checks that the credentials reach a page, attaches the approved overview to the intent's own page as `overview-{intent-slug}.html` (`--intent`), and keeps the `Interactive overview` section at the top of that page: a link per attached page. |
| `intent-pages.cjs` | Checks that every intent has its own Confluence page and stories page, and names the pages to create and the story pages to move. The approval and the push wait while it fails. |
| `jira-attach.cjs` | Attaches the approved overview to the intent's Jira epic, replacing an older copy, and adds the artifact as a web link on it. |
| `intent-status.cjs` | Every story with its status, what can be built now, what is blocked, and the shared files. `--version` prints the version of Turbo that runs. |
| `story-start.cjs`, `story-verify.cjs`, `story-land.cjs` | Claim a story, prove it, land it. |
| `story-mutate.cjs` | Breaks the lines the story lens names, one at a time, to prove the story's tests can fail. |
| `push-branch.cjs` | Pushes a story branch or the intent branch and opens its merge request, titled with the Jira key, or with `--all`, after the approval, every branch; a later push to a branch whose merge request is open leaves its title and description alone. In sandbox with `push` it puts the intent branch onto the base branch. |
| `mr-describe.cjs` | Reads a GitLab merge request's description and state, and writes the description whole or one section at a time, for the mr-description skill. |
| `review-fix.cjs` | For the review fix: which intent and story the branch belongs to, the open review threads, a worktree per fix, the fix landed on its story branch, and a reply in a thread. |
| `story-complete.cjs` | Marks one story done, only with a test summary. |
| `migrate-layout.cjs` | Moves the old layout into the new one. |

The overview's libraries sit in `scripts/lib/`: `overview-page.cjs` fills the page, `design-assets.cjs` serves the drawing, the tabs and the switches, `v5-model.cjs` reads the intent into the model of the C4 model tab, `v5-page.cjs` puts that model into its kit, `v5-missing.cjs` names what the record lacks, and `c4-lint.cjs` is the part of `spec-lint.cjs` that checks the C4 model and the plain texts.

---

## Languages

The flow files are in English, and so are the requirements, the decisions and the agent's half of every story. What people read (the titles, the plain texts, the product team's half of a story, the overview page, the test cases) is written in the record's language: the language you speak in the inception session, stored as `intent.language`. The fixed texts of the specs and the pages come from a string table, read through `scripts/lib/lang.cjs`. Turbo ships one table, English (`templates/lang/en.json`). For any other language the inception agent first translates that table into `.specs-aidlc-turbo/repo/lang/{code}.json`; the project keeps it, so the next intent in that language reuses it. A key the project's table lacks reads English. There is no language setting.

---

## Upgrading

Older installs kept `config.yaml`, `project.yaml`, `standards/`, `intents/` and `tests/` at the top of `.specs-aidlc-turbo/`. The scripts stop on that layout. `node .specsmd/aidlc-turbo/scripts/migrate-layout.cjs` shows what it would move; `--write` moves it. It never overwrites and can run twice. The installer runs it for you on an upgrade.

---

## Customising

- `.specsmd/aidlc-turbo/memory-bank.yaml` - where artifacts live
- `.specsmd/aidlc-turbo/agents/*.md` - agent personas and skill indexes
- `.specsmd/aidlc-turbo/skills/**` - the procedures the agents follow
- `.specsmd/aidlc-turbo/templates/**` - the record, brief, story, test-case and twin templates, the overview page (`templates/overview/`, its drawing, tabs and switches in `templates/design/`, the C4 model tab in `templates/overview-v5/`), the English string table (`templates/lang/en.json`), and the standards catalog

---

## Getting help

Run `/specsmd-aidlc-turbo` and ask. The master agent reads the artifacts and answers from them.
