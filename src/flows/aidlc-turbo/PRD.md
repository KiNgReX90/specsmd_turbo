# PRD: AI-DLC Turbo

**Status**: living document. **Audience**: flow maintainers, contributors, and anyone choosing between the specsmd flows.

---

## One paragraph

AI-DLC Turbo is the slim variant of AI-DLC. One inception pass decides everything a builder needs and keeps it in a record on disk; a script renders one brief and a set of stories from it. You approve that once. Construction then builds every story on its own, test-first, with the tests run by script, fresh-eyes reviews per story (the story, quality and safety, the project's own rules) and one more for the whole intent. After a story's reviews a script breaks a few lines the story changed, to prove its tests can fail. You approve the finished intent before anything is pushed. Only a story that misses three times, or a mismatch between its sources, waits for you. There are no units, no bolts, no separate design documents, no decision ledger and no logs. What is left is the part that actually steers a build: the decisions, the reading list, the acceptance criteria and the commands that prove the work.

---

## 1. Problem

Full AI-DLC produces a large stack of planning documents in which the same load-bearing fact is restated many times. That costs review time and tokens, and the copies drift apart. The naive fix, summarising and linking, has the opposite failure: a caveat that survives only as a bare pointer gets ignored during the build.

The v1 of AI-DLC Turbo cut the document count but kept the ceremony around it: units, bolts, a decisions-and-gates ledger, an inception log, a construction log, stage templates per bolt type. A single feature still meant a dozen files and a human checkpoint per stage.

---

## 2. Goals

- **G1.** Everything a builder needs is decided in one inception pass, and written once.
- **G2.** One record per intent, and the brief and stories rendered from it. The overview page is generated from them and never edited. Review findings, live-test failures and failed attacks are never written down: they are fixed in the code and reported once, in the finish summary.
- **G3.** Two human approvals: the plan at the end of inception, and the finished intent before anything is pushed. Construction stops for the human only after three misses on one story, on a mismatch between the story, the brief, the documentation and the code, or when a story needs a new right, table or module the Code Scaffold does not name, and only that story waits.
- **G4.** Code quality at least equal to full AI-DLC, from the domain model and technical design in the brief, a reading list of only the relevant slices, test-first building, fresh reviewers per story (the story, quality and safety, the project's own rules) and one per intent, verification commands that must pass, and the code tooling the project chose (language servers, analysis tools and linters).
- **G5.** Clearly fewer tokens per intent. Mechanical work (rendering the specs, checking form and coverage, running tests, committing) is done by scripts, and unchanged documentation pages are never read twice.
- **G6.** The flow syncs with the tools it names and nothing else. Git through plain git commands, with `gh` for the pull requests on GitHub. Confluence and Jira through the Atlassian tools of the host, chosen in `sync` in the config, both optional and off by default, with no default site: the intent's documentation is pulled at intake, its open questions are resolved there, and it is pushed back at the approval; every intent has its own documentation page with its own stories page, named by `sync.page_names` (default `{name} - Documentation` and `{name} - Stories`), so the story pages of two intents never share a parent; the epic and the stories are created after the approval and updated with the test cases after the build. Only the attachments go through the REST API, since the Atlassian tools cannot attach a file: the approved overview, as `overview-{intent-slug}.html` on the intent's own page, through `confluence-attach.cjs`, the same overview on the epic, with its artifact link, through `jira-attach.cjs`. The merge request descriptions and the review comments go through the GitLab API with the user's `GITLAB_TOKEN`. Any other tool is not supported yet, and the flow says so.

## 3. Non-goals

- **N1.** Not autonomous planning. The approval at the end of inception is not optional, and neither is the approval of the finished intent.
- **N2.** No flow without git. Sandbox mode is production without story branches: the same worktrees, side by side building, reviews, mutants, live test and break test. A folder without git is asked once whether it may become a repository with one first commit. In sandbox, two parts can be left out in the config (`sandbox.code_scaffold`, `sandbox.scaffold_after_build`): a part that is off is not made, and nothing reports it as missing. Production always makes both.
- **N3.** No merging and no deploying. The flow pushes and opens the merge requests once the user approved the intent; merging is yours. The one exception is sandbox with `sandbox_finish: push`: there the user chose that the finished intent goes straight onto the base branch.
- **N4.** No subagent on the session model. Every role pins its model and effort (section 6); only the inception, construction and review-fix agents are the user's own session.
- **N5.** No open questions as an output. Inception cannot be approved while a TBD is left anywhere.

---

## 4. Principles

1. **One brief plus stories.** Decisions live in the brief, or in the story they govern.
2. **Never an open question.** Every question intake surfaces is settled with the user before the specs are written.
3. **Two approvals, none halfway.** The plan at the end of inception, and the finished intent before anything is pushed. A builder decides from the brief, the standards or the code, and logs it. A miss climbs a ladder: a fix with a delta re-review, a debugger on the second miss, the human on the third. Only that story waits.
4. **A mismatch is always asked.** When the story, the brief, a page or the code cannot all hold, no agent picks a side by which source comes first. The human answers a closed question with both sides quoted; the answer is a decision in the brief and the record, and a page that gave way is corrected only after the approval of the finished intent.
5. **Quality may not drop.** Design once per intent, read only what matters, build test-first, review with fresh eyes, prove with commands.
6. **Scripts for mechanical work.** `render-specs.cjs` writes the specs from the record, `spec-lint.cjs` gates them, `story-verify.cjs` writes the proof the reviewer reads. A model decides, a script renders and counts.
7. **A pinned model per role.** Opus where judgement matters (building, reviewing, debugging, exploring the code, checking the specs, breaking the app), Sonnet where the work is bounded (reading docs, low stories, test cases, the live test, sync). A Sonnet role that fails runs once more on Opus.
8. **The product team reads its half of a story in the session language, the agent reads the English half.** Same file, never translated. The record stores the language as `intent.language`, and one string table per language gives the fixed texts (`en` ships with the flow; for any other language the inception agent translates it into `.specs-aidlc-turbo/repo/lang/`). There is no language setting.
9. **Named tools only.** Git, and Confluence and Jira when `sync` has them on. No other tracker or wiki. What the flow remembers about Confluence and Jira lives in the inception's own `sync.yaml`, never in the files of the classic AI-DLC flow.
10. **English in the flow files.** Generated test cases are in the record's language.

---

## 5. Artifacts

Per intent, under `.specs-aidlc-turbo/docs/{inception}/{intent-slug}/`:

| File | Written by | Holds |
|------|-----------|-------|
| `record.yaml` | the inception agent, after every answer | everything intake learned: requirements with their sources, decisions (with a mismatch's answer and the page corrections it decided), the story plan, what was left out on purpose and why, the data for the overview pictures (life cycle, layers, slices, integration tests), the Code Scaffold (`technical_design.drawing`, a `drawing` per story), the C4 model (`technical_design.c4`) and the plain texts (`intent.plain`, a `plain` per story) |
| `brief.md` | `render-specs.cjs` | intent (in the record's language), requirements (`FR-n`, `NFR-n`), design decisions (`D-n`), domain model, technical design with the Code Scaffold, codebase reading list with line ranges, standards deltas, verification commands, story map, lessons |
| `stories/{SSS}-{slug}.md` | `render-specs.cjs`, build notes appended by the builder | the product-team half in the record's language (user story, acceptance criteria, out of scope) and the English half (what to read, design, the Code Scaffold of what it builds and uses, implementation notes, edge cases, test plan, build notes with what was built, what changed per file, and what was built outside the Code Scaffold or differently from it), plus the files it touches and its sources |
| `proof/{SSS}.json` | `story-verify.cjs`, then `story-mutate.cjs` | per verification command: exit code, time, counts and a short tail; the existing tests the story changed, deleted or switched off; the mutants and whether a test killed each |
| `tests/` | the test writer, only with a tester | one test case per tester-verifiable story |
| `overview.html` | `intent-overview.cjs` | one generated page, the same file in the browser, the artifact, on Confluence and on the epic. Before the build the tabs Functional (the intent in plain words, the life cycle with the stories on its steps, the vertical slices, the integration tests, what is left out, per story the user story, the acceptance criteria and the code it touches) and Code Scaffold (the drawing with each part's confidence colour, walked step by step), plus C4 model when the record has one; after the build the same drawing as Code, never updated, with where the build deviated from it and why, and Review (the changed files with their change, linked to the merge request once it is open). Details (the plain texts) is on when it opens, ? (how to read it) off. A view, never edited by hand |
| `code-scaffold.html`, `code-scaffold-built.html` | `intent-overview.cjs --scaffold`, once the approval round is done and at finish | the overview page opening on its technical view, the Code Scaffold: as approved, and updated as built. Committed with the specs and published to one artifact link; the first is never overwritten. Not written for a part a sandbox switched off |

Per inception, under `docs/{inception}/`: `pages/` (the pulled Confluence pages, an intent's own page and its stories under `pages/{intent-slug}/` when the inception holds several intents), `register.yaml` (every statement in them, numbered) and `sync.yaml` (Confluence and Jira state). An inception with one intent uses the same slug for both, and its `{name} - Documentation` page is the intent's own page; with several intents each gets `{intent} - Documentation` under it (`confluence.intents` in `sync.yaml`).

Project-level: `repo/` (`config.yaml`, `repo.yaml` with the codebase scan, `tooling.yaml` with the chosen code tooling, `standards/`) and `project/` (`project.yaml`, the shared `pages/` and their `digests/`). The old layout is moved once by `migrate-layout.cjs`.

Status machines: a brief goes `draft` to `approved` to `building` to `done`. A story goes `todo` to `building` to `review` to `done`, or `blocked`.

---

## 6. Agents and subagents

| Surface | Kind | Model, effort | Role |
|---------|------|---------------|------|
| `/specsmd-aidlc-turbo` | phase command | session | Master. Detects the phase and routes. |
| `/specsmd-aidlc-turbo-inception` | phase command | session (Opus) | Intake into the record, planning, the specs by script, the approval. |
| `/specsmd-aidlc-turbo-construction` | phase command | session (Opus) | The dispatch loop, the ladder, the finish with the approval of the finished intent. Reads only `intent-status.cjs --json`. |
| `/specsmd-aidlc-turbo-review-fix` | phase command | session (Opus) | The review comments on the merge requests of a finished intent: judged, decided by the human, fixed and reviewed story by story, answered after an approval. GitLab only. |
| `/specsmd-aidlc-turbo-config` | phase command | session | Display-and-confirm of the project settings and the code tooling. |
| `builder` | subagent | Opus, high | Builds one `medium` or `hard` story, and every fix in fix mode. |
| `builder-low` | subagent | Sonnet, high | Builds one `low` story. |
| `reviewer` | subagent | Opus, high | Story review through one lens (the story, quality and safety, or the project's own rules), side by side with the others, and the delta re-review of a fix. |
| `intent-reviewer` | subagent | Opus, xhigh | The intent review: each requirement, cross-story integration and the shared files. |
| `debugger` | subagent | Opus, high | After a second miss: the root cause with evidence, then a plan or a stop. Never edits. |
| `cross-checker` | subagent | Opus, xhigh | Inception: the stories against each other and the code. |
| `docs-verifier` | subagent | Opus, xhigh | Inception: the meaning of the register items against the stories they map to. |
| `docs-reader` | subagent | Sonnet, medium | Reads new or changed pages into register candidates and digests. |
| `explorer` | subagent | Opus, high | Read-only code explorer, at most three per intake plus at most three proposal checks during the questions and a place check while plan draws the Code Scaffold, on a hard budget. |
| `test-writer` | subagent | Sonnet, high | One test case plus a Playwright twin, at finish, against the running app. |
| `live-tester` | subagent | Sonnet, high | The live test at finish, in both modes. |
| `breaker` | subagent | Opus, high | The break test at finish, in both modes: attacks the running app on the stories marked `break_test`, never reads the code. |
| `sync` | subagent | Sonnet, medium | Confluence pull, resolve and push, the intent pages (created and moved only as the approved plan names), the page corrections after the approval of the finished intent, and the Jira writes. Read, Write and the Atlassian tools only. |

Subagents are installed as `specsmd-aidlc-turbo-{role}`. Before any explorer runs, the inception agent greps for the intent's own nouns itself, and when that already names the files the work touches it dispatches none. That pass and every explorer first ask, for every backend change, where a user sees or starts it (a screen, menu, tab, button, route or API); the answer sets per acceptance criterion where the tester checks it. Every explorer also asks which existing structure the work hangs on (a right or role, a menu place, a screen, a table, a service), and a proposal that comes up later in the questions is checked the same way before it is asked; what no code backs is recorded as an `assumption` and checked again by the cross-checker. And every explorer asks where the new code lands (the module, where it is registered, the example a new part copies): plan draws the Code Scaffold from those answers.

---

## 7. Scripts

Node builtins only, so they run in a project with no node_modules. Every script takes `--root` (default `.specs-aidlc-turbo`), `--json` where it prints data, and exits 0 when fine, 1 on findings, 2 on a usage error.

| Script | Contract |
|--------|----------|
| `leftovers.cjs` | At the start of a new inception: names the leftovers of earlier work (old AI-DLC folders at the project root, Turbo inceptions whose intents are all done) and the open Turbo work, which it never removes. `--remove` deletes them, tracked ones in one local pathspec commit, never pushed. |
| `tooling.cjs` | The code tooling of the repo, kept in `repo/tooling.yaml`: `check` (missing, incomplete, invalid, ok or declined, never running a tool), `facts` (what the repo has: languages, build files, linter configs, the language server plugins its extensions can use), `brief` (what every subagent starts with) and `run` (the analysis and lint tools on a change, keeping only the findings on lines the change adds). |
| `codebase-scan.cjs` | Detects the stack, the test runners and the build and test commands. Prints the `codebase:` block; `--write` merges it into `repo/repo.yaml`. |
| `source-register.cjs` | `--status`: the pages that need reading. `--merge`: numbers the docs reader's statements into `register.yaml`. |
| `render-specs.cjs` | Renders the brief and the stories from `record.yaml`. `--check` fails when a file differs. |
| `spec-lint.cjs` | The hard gate before approval: form, coverage of every register item, the Code Scaffold, and the C4 model and the plain texts the record gives (`lib/c4-lint.cjs`). |
| `intent-overview.cjs` | Renders the overview page from the record, the brief, the stories and the test cases, with the C4 model tab from the kit of `templates/overview-v5/` when the record has a C4 model (`lib/v5-model.cjs` the model, `lib/v5-page.cjs` the page, embedded by `lib/overview-page.cjs`). Before the build it prints one `Missing:` line per piece of the C4 model or the plain texts the record lacks (`lib/v5-missing.cjs`) and never fills one in; after it the one line on where the build deviated from the Code Scaffold. `--plan` draws a change the user asked for at the approval of the finished intent, before it is built. `--scaffold` saves the same page opening on the Code Scaffold, as `code-scaffold.html` or, after the build, `code-scaffold-built.html`. Exit 0 also with data missing. |
| `overview-links.cjs` | After the push: writes the merge requests into the page data of the approved `overview.html`, without rendering it again. Exit 1 when the intent or its page data is not there. |
| `open-browser.cjs` | Opens the overview's artifact link, or its file, in the default browser, also when the host shows the artifact itself. Prints `Opened: {target}`, or why not with exit 1. |
| `confluence-attach.cjs` | `check` proves the credentials reach a page before anything is made, `upload` attaches the approved overview as `overview-{intent-slug}.html` to the intent's own page (`--intent {slug}` looks it up and refuses while the intent has none), and `upload` and `links` keep the `Interactive overview` section at the top of its body: a plain link per `.html` attachment, the rest of the body untouched. Prints one JSON object. |
| `intent-pages.cjs` | `check --inception {slug}`: every intent has its own page and stories page, and no story page sits under another intent. Prints one JSON object with the problems and the plan (pages to create, story pages to move, story pages it cannot place); `--map {page-id}={intent}` places one by hand. Exit 1 stops the approval and the push. |
| `jira-attach.cjs` | `upload` attaches the approved overview to the epic, then removes the older copy, and with `--link` adds the artifact as a web link that a second run updates. Prints one JSON object. |
| `intent-status.cjs` | Every story with status, dependencies, complexity and `touches`, the frontier, the blocked stories and the shared files. `--version` prints the version of Turbo that runs; the approval stamps it into the brief as `turbo_version`, and construction names a different one before it builds. |
| `story-start.cjs` | Claims a story, creates its worktree, names the builder and the standards to pass. |
| `story-verify.cjs` | Runs the verification commands in the worktree and writes the proof. |
| `story-mutate.cjs` | Breaks the lines the story lens names, one at a time, runs each one's test and puts the line back, so a test that cannot fail shows. |
| `story-land.cjs` | Commits the story, carries it onto the intent branch, marks it done, removes the worktree. |
| `push-branch.cjs` | Pushes a story branch or the intent branch and opens its merge request, or with `--all`, after the approval, every branch: GitLab push options, `gh` on GitHub. A branch whose merge request is open goes without push options, so its title and description stay. In sandbox with `sandbox_finish: push` it puts the intent branch onto the base branch instead, without a merge request. |
| `mr-describe.cjs` | Reads a GitLab merge request's description and state; writes the description whole, or patches one section or one top line and the state marker, keeping every other byte. |
| `review-fix.cjs` | The review fix: `where` (the intent and story of the branch), `threads` (the open review threads of the intent's merge requests), `open` (a worktree for one story's fix), `land` (the fix committed on its story branch and carried forward, the test cases it may have changed marked `outdated`) and `reply` (one answer in a thread). |
| `story-complete.cjs` | The hard gate on finishing a story: refuses without a test summary or from the wrong status. |
| `migrate-layout.cjs` | Moves the old layout into the new one. Dry run by default, `--write` moves, never overwrites. |

---

## 8. What was removed, and why

| Removed | Why |
|---------|-----|
| Units and unit briefs | An extra grouping layer between an intent and its stories that no builder read. The story map in the brief does the same job in one table. |
| Bolts, bolt types, bolt templates, bolt planning and replanning | Execution ceremony. A story is already one builder session, so the bolt added a second unit of work with its own status machine and its own files. |
| The decisions-and-gates ledger | Decisions moved into the brief, where the domain model and the technical design that depend on them already live. One file, no cross-references. |
| Open-question lists | Replaced by the rule that inception cannot be approved with an open question. An open question at build time is a wrong guess waiting to happen. |
| Inception log and construction log | Nobody read them. What the builder decided goes into the story's build notes, where the reviewer sees it. |
| System-context and impact-analysis documents | Their content is the technical design section of the brief, its C4 model and the codebase reading list. |
| ADRs and the decision index | Decisions are `D-n` entries in the brief. |
| The deployment stage and its skills | Out of scope for this flow. It stops at a pushed branch. |
| Writer agents | A script renders the specs from the record, deterministically and for no model tokens. |
| Per-stage human checkpoints | The approval at the end of inception, and one at the end of construction before anything is pushed. Everything a builder needs is decided in inception, so there is nothing left to approve halfway. |

---

## 9. Success metrics

- **Planning-doc volume** per intent: one brief plus one file per story, nothing else.
- **Open questions at approval**: zero, as a hard gate.
- **Human stops per intent**: the two approvals, plus a story that misses three times or a mismatch between the story, the brief, the documentation and the code.
- **Tokens per intent**, against the previous version.
- **Story review pass rate** on the first round, and the number of stories that need a second round.
- **Verification**: the brief's build and test commands pass at the end of every story and once more at the finish.

---

## 10. Risks

- **R1. A thin brief produces thin stories.** The whole flow rests on the inception pass. Mitigation: intake reads the documents and the code in parallel before it asks anything, the interrogation walks fixed territories, `spec-lint.cjs` checks that every requirement and every register item is covered, a cross-checker reads all stories together for conflicts and gaps, and a docs verifier checks their meaning against the source, all before the user sees them.
- **R2. A builder decides something the user would not have.** Mitigation: the decision is written into the story's build notes and the reviewer reads it against the brief; a mismatch with the brief, a page or the code is put to the human, never a judgement call.
- **R3. Stories built side by side can touch the same lines.** Mitigation: the dependency graph keeps related stories apart, `spec-lint.cjs` refuses two stories that can build at the same time and touch the same file, and a conflict when a story's commit is carried onto the intent branch is a human stop, never a silent merge.
- **R4. Ceremony creeping back.** Every addition has to answer one question: which builder reads it, and what would it do differently without it.
- **R5. Inception invents what already exists.** On a real run intake proposed two new rights while existing ones fit. Mitigation: the explorers ask what exists first, a proposal is checked before it is asked, and the Code Scaffold shows every part and every arrow with its evidence and a colour from fixed rules that the agent can only lower, so a tech lead corrects it at the approval, before anything is built. The builder follows it, reports where it deviates and puts a new right, table or module to the human first, and the reviewer checks the build against it.
- **R6. A change asked for at the approval of the finished intent is built without a plan.** Mitigation: the change is planned as at the inception (record, specs, Code Scaffold, the page again) and built only on the user's explicit go; a remark is never a go.
