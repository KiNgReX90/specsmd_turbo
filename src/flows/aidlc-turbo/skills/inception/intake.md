# Skill: Intake

---

## Role

The first and longest skill of inception. It turns a rough intent into a complete decision record:
grounded in the project's documentation, grounded in the real codebase, and interrogated with the
user until nothing is left open.

Everything construction needs is decided here. A builder never gets to ask a question, so intake is
where the questions get asked.

---

## Goal

`record.yaml` holds every fact the brief and the stories need. Zero `TBD`, zero open questions, zero
"we will decide that later".

---

## Input

- The free text intent from the command line, or from the user in conversation
- Optional `--docs path,path`
- `.specs-aidlc-turbo/repo/config.yaml` (mode, tester settings, `sync.docs`)
- `.specs-aidlc-turbo/repo/repo.yaml` (codebase scan) and `.specs-aidlc-turbo/project/project.yaml`
- The standards under `.specs-aidlc-turbo/repo/standards/` that `context-config.yaml` lists under
  `agents.inception`

---

## Process

### 0. Leftovers of earlier work

Only for a new inception, and before anything else: before the codebase scan and before the pull.
Resuming a draft intent skips this step: its own folder is open work, never a leftover, and the
user answered this when it started.

1. Ask the script what earlier work left behind:

   ```bash
   node .specsmd/aidlc-turbo/scripts/leftovers.cjs --json
   ```

   `leftovers` are old AI-DLC work at the project root and every Turbo inception whose intents are
   all `done`. `open` is Turbo work that is not finished: an intent that is still `draft`,
   `approved` or `building`, an inception without an intent yet, or a `done` intent of the branch
   the user is on. Every item has its `id`, and `lines` says each one in one line.
2. Nothing named: say nothing and go on with step 1.
3. Open work: name each one in one line with its `continue` command, for example "Order status
   is still open, go on with it through `/specsmd-aidlc-turbo-construction order-status`". It is never
   offered for removal, and this inception goes on next to it.
4. Leftovers: name each one in plain words, in the session language, one line each, and ask one
   question with the host's multiple-choice prompt (on Claude Code: AskUserQuestion): "There are
   leftovers of earlier work in this repository. Shall I clean them up before the inception
   starts?", with **Clean them up** first and **Leave them**. When one of them is in git, say in
   the question that cleaning up makes a local commit on the current branch. A user who names only
   some of them gets only those removed.
   - **Clean them up**: run `node .specsmd/aidlc-turbo/scripts/leftovers.cjs --remove --json`, with
     the ids the user named after `--remove` when it is not all of them, and show what it removed.
     With a `commit`, tell the user it is a local commit on the current branch, never pushed. With
     `on_base` the current branch is the base branch, and the intent branch is cut from it after the
     approval: the commit goes along and reaches the base branch with the intent. Without `on_base`
     the commit stays on this branch until the user pushes or merges it. Without a commit (no git,
     or none of it was in git) the files are only gone from disk.
     Exit 1 names what it refused or where it stopped: show that and ask again.
   - **Leave them**: go on, and do not ask again in this inception.

### 1. Load the project

1. When `.specs-aidlc-turbo/repo/repo.yaml` is missing or has no `codebase.scanned_at`, run the scan
   and read the file again:

   ```bash
   node .specsmd/aidlc-turbo/scripts/codebase-scan.cjs --write
   ```

2. Read the standards. Missing standards are a warning, not a stop.

### 2. Capture the intent and create the record

1. Write the intent down in the user's own words. Do not translate it into product language yet.
2. Propose the slug: lowercase, hyphenated, at most 5 words, never `pages`, `digests`, `standards`,
   `tests`, `proof`, `stories` or `register-candidates`. The slug is the whole id: intents are never numbered.
3. Check the slug is free across all inceptions (`ls .specs-aidlc-turbo/docs/*/`). When it is
   already taken, append `-2`, `-3` and so on until it is free.
4. The inception slug is the intent slug. Only when `.specs-aidlc-turbo/docs/` already holds
   inceptions, offer them as later options: an intent that belongs under the Confluence
   documentation page of an earlier one joins that inception, and gets its own page under it,
   named by `sync.page_names.intent` (default `{name} - Documentation`) with the intent slug as the
   name (step 3). Its stories never go under another intent's page.
5. Confirm the slug, the inception and the one-line intent statement with the user in one question.
6. Create `.specs-aidlc-turbo/docs/{inception}/{intent-slug}/record.yaml` from
   `.specsmd/aidlc-turbo/templates/inception/record-template.yaml` and fill `intent`. From here on,
   every answer and every decision goes into the record the moment it is made.
7. Set `intent.language` to the language the user speaks in this session, as a BCP-47 code (`en`,
   `de`, `fr`, ...). There is no setting for it. Everything a person reads is written in it: the
   titles, `purpose`, the plain texts (`plain`), the stories' `product` half, `short`, the texts of
   the Code Scaffold and the C4 model, `overview`, `deliberately_not` and the `what` and `chosen` of
   a mismatch, and every question and summary you give. Requirements,
   decisions and the `agent` half stay English. Then make sure that language has a string table,
   which gives the specs their headings and the pages their fixed texts:

   ```bash
   node .specsmd/aidlc-turbo/scripts/lib/lang.cjs {code}
   ```

   `built-in` or `project`: go on. `missing` (exit 1): before the first render, translate
   `.specsmd/aidlc-turbo/templates/lang/en.json` into the file it names,
   `.specs-aidlc-turbo/repo/lang/{code}.json`. Keep every key and the structure as they are and
   translate every text, `language` into the name of the language in that language. Keep
   `{placeholders}`, code spans, command names, `Code Scaffold`, `Flow` and `Review` as they are,
   and keep a text of one word one word: it sits on a button or a chip. A key you leave out reads
   English. The file lives with the project, so the next intent in that language reuses it.

**Resuming** a draft intent: read its record and continue with the first step whose output is not on
disk yet. Never ask again what the record already answers.

**A migrated draft** (a `brief.md` and stories, no `record.yaml`, moved by `migrate-layout.cjs`):
`render.md` and the approval work from the record only, so write it first. Create `record.yaml`
from the template and fill it from what is on disk: the intent and requirements from the brief, its
design decisions as `decisions`, its reading list and verification, and one `stories` entry per
story file with that story's frontmatter and both halves. Keep every text as written, and set
`intent.language` to the language its product-team half is written in; a field the old files do
not have is written now. Then resume as above: every gap the gate of step 8 finds
is a question, and from the next render on the record is the source of the brief and the stories.

### 3. Docs, through the source register

1. **Confluence**: when `sync.docs` is `confluence`, pull. Only when
   `docs/{inception}/sync.yaml` has no `confluence:` block yet, first ask for the link to the
   intent's documentation page (named by `sync.page_names.intent`, default `{name} - Documentation`)
   with the host's multiple-choice prompt; the user pastes it as their
   own answer, and the one option is **This intent has no Confluence page yet**, which is the link
   `none`. Then dispatch the sync agent (`specsmd-aidlc-turbo-sync`) with `.specsmd/aidlc-turbo/skills/sync/confluence.md`, the
   intent slug, the inception slug, mode `pull` and the link. Handle its result as the agent file
   says: ask a `needs_input` question and dispatch again with the answer, help with `no_tools`, and
   delete every file in `stale`. The pages land in `.specs-aidlc-turbo/docs/{inception}/pages/` and
   `.specs-aidlc-turbo/project/pages/`. Any other value than `confluence` or `none`: say it is not
   supported yet, and go on without.
   Right after the pull, every intent its own page: follow
   `.specsmd/aidlc-turbo/skills/sync/intent-pages.md`. An inception of one intent passes at once;
   when this intent joined an earlier inception, the step gives every intent of it a page of its own.
2. **Extra sources, always asked**: `--docs` given: copy exactly those files into
   `.specs-aidlc-turbo/docs/{inception}/pages/local/`. Then, every run, also after a Confluence pull
   and also with `--docs`, ask one question with the host's multiple-choice prompt: in one line, say
   what you have so far (the Confluence pages, the `--docs` files, or nothing), then ask whether the
   user wants to give more before you start. The first option is **Start with this**. When `docs/`
   or `project-docs/` exists in the repo and is not copied yet, offer each as an option of its own.
   The user gives anything else as their own answer: paths to folders or files, a link, or plain
   text. Copy every file the user picks into `pages/local/`: only what sits there is registered and
   read. Pasted text goes there as a `.md` file named after its subject. A link: fetch the page and
   save it as a `.md` file; a link you cannot open, say so in one line and drop it. A path that does
   not exist: say so in one line and drop it. After copying, ask the same question again, so the
   user can add more or start. The register reads Markdown only: copy a `.md` file as it is, convert
   a text format you can read (`.txt`, `.html`, `.adoc`, `.rst`) to a `.md` file of the same name,
   and name every file you could not convert to the user in one line, as not read. On a resumed
   draft that already has a `register.yaml`, do not ask again.
3. Ask the register which pages need reading:

   ```bash
   node .specsmd/aidlc-turbo/scripts/source-register.cjs {inception} --status --json
   ```

   Nothing named: dispatch nothing. Unchanged pages are never read again.
4. Otherwise dispatch **one** docs-reader (`specsmd-aidlc-turbo-docs-reader`) with those pages and the inception slug. It writes the
   candidates to `.specs-aidlc-turbo/docs/{inception}/register-candidates/{page-id}.yaml` and the
   project digests to `.specs-aidlc-turbo/project/digests/`. It does not count toward the three
   explorers of step 4.
5. Only when the docs-reader wrote files to `register-candidates/` (it may write only project
   digests, or find nothing): merge them in one call, then delete that folder:

   ```bash
   node .specsmd/aidlc-turbo/scripts/source-register.cjs {inception} --merge .specs-aidlc-turbo/docs/{inception}/register-candidates/
   ```

6. Read `register.yaml` (skip `stale` items) and the project digests. They replace the pages for the
   rest of intake: formulate every question from them plus the user's answers. Open a page only to
   verify one load-bearing specific (an exact schema, contract or limit) at the moment you need it.

### 4. Codebase grounding: locate first, then at most three explorers

The cheapest grounding is the one you do yourself. An explorer that starts from "explore the payments
area" reads the module; a grep for the names the user actually said lands on the file. So you grep
first, and you only send an explorer into what is still dark afterwards.

Before anything is decided, the locating pass and every explorer also ask, for each backend change,
where a user sees or starts it: that answer decides how a tester checks it. On a real run a job that
a user starts on an admin screen, with its result on a tab, was planned as something no tester could
check, because nobody had asked.

Every explorer also asks what already exists that the work hangs on: the right or role that guards
comparable screens, their place in the menu, the closest existing screen, the table, service or job
that does similar work. Reuse comes before create. On a real run the agent proposed two new rights
for an order status screen, while the application already had a view right on the menu next to it
and a role for admin screens: it had asked how a right is checked, not which existing right fits.

And every explorer asks where the new code lands: the module, how it is laid out, where a module is
registered in the build, and the existing part a new one copies. `plan.md` draws the Code
Scaffold from these answers, so a part nobody located is a part the drawing would invent.

#### 4a. The locating pass, in this session

1. Take the nouns out of the intent statement and out of the register: the names the user quoted,
   table names, task or job labels, class, screen and route names. Those exact strings are the search.
2. Grep for them. **At most six grep calls**, and scope every one: a path prefix, or an include
   filter for the file types that `codebase.languages` in `repo.yaml` names. Never an unscoped scan
   of the whole tree.
3. Read nothing whole. Open at most a few line ranges, and only to see what a hit actually is.
4. Never list or walk the directory tree. The greps tell you where things live.
5. Write down what the hits say: which files and lines, which module, which layer, which table.
6. **Where does a user see or start it?** For every piece of backend the intent changes (a job, a
   PL/SQL package, a service, a query, a table), grep for the screen, menu entry, tab, button, route
   or API that starts it or shows its result. Search for the names the first hits gave (the job
   name, the table, the service method, the status value) in the UI layer's files: the path of the
   screen code, or the file types of the stack `codebase.ui_stack` names; without a UI, the routes
   and endpoints. **At most three more grep calls** for this question, scoped like the others.
7. Write the answer down with the hits, per backend change, like an explorer's `seen_at` entry: what
   changes, where a user sees or starts it (the screen, menu path, tab, button, route or API), its
   `via` (`ui` or `api`) and the code, with file and lines. A change these greps did not place is
   still dark.
8. **What does it hang on?** Note what the hits already show of the existing structures the work
   needs: the right on a comparable screen, its menu entry, a sibling service. Spend no grep on it:
   finding the fit is the explorers' question.

#### 4b. Decide how much is still dark

- **The hits already name the files the work touches** (a small change, one module), where a user
  sees or starts each backend change in it, and what each new structure hangs on: dispatch no
  explorer at all. Build the reading list from the hits and move on. This is the normal case for a
  small intent, and it costs nothing.
- **Something is still dark**: name those areas, **at most three**, and write down the questions each
  one has to answer. Areas never overlap: a file belongs to exactly one area.

A backend change whose answer to where a user sees or starts it is still open makes its area dark,
even when the hits name its files. So does a new screen, menu entry, right or role, table, endpoint
or job whose existing hook point the hits do not show, and a new module or part whose module and
example they do not show. When all three areas are taken, those answers go to the questions of step
5, never to a fourth explorer.

Intake may spend three explorers in total. Fewer is better and none is best. A fourth is not an
option: when three areas cannot hold the work, the intent is too big and belongs in two intents.

#### 4c. Dispatch the explorers

One explorer (`specsmd-aidlc-turbo-explorer`) per area, all in the same turn; on hosts without subagents, explore the areas yourself
in this session, one at a time, under the explorer's budget. Every prompt carries:

1. Its area in one sentence, plus the files and line ranges the locating pass already found for it,
   and where a user sees or starts its changes, when the locating pass found that too.
2. **The exact questions it must answer.** The first three are always, word for word: "Where does
   a user see or start what this area changes? Name the screen, menu path, tab, button, route or
   API, with file and lines, or say that none exists.", "What existing structure does this area's
   work hang on? For every right or role, menu place, screen, table, service or job it needs, name
   the existing one that fits, or the closest example, with file and lines, or say that none fits."
   and "Where does this area's new code land? For every part it adds or changes, name the module it
   goes in, how that module is laid out and where it is registered in the build, and for a new part
   the existing one to copy, with file and lines, or say that none fits." Then the area's own: not
   "explore the sync area", but "which class writes to `ORDER_STATUS_EVENTS`, and on which lines", "which
   existing service does the same thing for another table, and what shape does it have", "what does
   the error path return". Ask what exists, not only how it works: "which existing right guards the
   screens next to this one", not "how does a right get checked".
3. **The areas it must not cover**, named one by one: the other explorers' areas.

The budget and the result shape are in the explorer's agent file.

#### 4d. Merge the rows

Merge the explorer rows into the rows of the locating pass, one row per file and range, line ranges
unless the file is under 80 lines, and write them into the record's reading list (the brief's
Codebase reading list). Keep only the slices a builder actually needs: `plan.md` hands each story
its own rows as `agent.context`.

The `seen_at` answers go with the rows, from the locating pass and from the explorers alike: each
one is the row of its `code`, and that row's `why` says what changes, where a user sees or starts it
and its `via`, for example "The expiry job GiftCardExpiryJob: started and its log read at
Admin > Scheduled jobs, tab Logs (ui)". Keep these rows even when no builder
needs them: `plan.md` sets each criterion's `observed_via` from them.

The explorers' `hangs_on` answers go with the rows the same way: the row of its `code`, its `why`
naming the need and the existing structure that fits, for example "Fits the right for the order
status screen: the view right on orders, which already guards the menu entry Orders". The
options of step 5 are built on these rows.

The `lands_in` answers go with the rows the same way: one row for the layout of each module, one for
every build file that registers it, and one for every example, its `why` naming the new part it is
for, for example "Example for the new OrderStatusController: ReturnsController of the returns module".
`plan.md` draws the Code Scaffold from these rows.

### 5. Questions

Ask one closed question at a time, with the host's multiple-choice prompt where one exists (on Claude
Code: AskUserQuestion), otherwise a numbered list, and always a concrete proposal as the first
option. Work through the territories in this order:

1. Scope and boundaries: what is in, what is explicitly out, what stays untouched.
2. Happy path and edge cases: the main flow, then the boundaries, the empty and the at-limit states.
3. Data shape and storage: the entities, their fields, where they live, their lifecycle, migrations.
4. Integrations and existing code: which subsystems and external systems this talks to, in which
   direction, and which existing pattern it follows.
5. Non-functional requirements: performance numbers, security (authentication, authorization, data
   sensitivity), reliability and failure behaviour.
6. UI behaviour: screens, labels, states and messages, and where a user sees or starts each backend
   change. When the project has no UI and the intent adds none, ask only that last part.

Rules:

- Name what you ask about: quote the statement and name its page, or name the screen, the table, the
  class. Never a register id or any other id in a question or an option.
- **Check before you propose.** An option that names or creates a code structure (a right or role,
  a menu place, a screen, a table or column, a service, a job, a pattern) rests on the code: the
  `hangs_on` rows of step 4. A proposal that comes up later and that step 4 did not cover is checked
  before you ask it: one explorer (`specsmd-aidlc-turbo-explorer`) as a proposal check, with per
  pending proposal the need, the question "which existing {structure} fits {need}" and what step 4
  found, at most three such checks in all, not counted toward the three explorers of step 4. In the
  question, say what was found and where, in plain words (the screen, the menu path, the class), and
  put an existing structure that fits before an option that creates a new one. An option no code
  backs, because the check found nothing or none was left, says so in its label ("assumption", in
  the session language), and a decision that picks it has source `assumption`.
- Write each answer into the record at once: a `decisions` entry, numbered `D-n`, with the
  question, the answer, why, the alternative dropped and the source (`user`, a register id,
  `code (path:line)` or `assumption`), and the requirement it yields. Every requirement names in
  `sources` what it rests on: the register ids, or `user` or `code (path)` when it rests on no page.
  Without a register (no Confluence, no local docs) that is always `user` or `code (path)`.
- Keep drilling while the answer is vague. A hand-wavy answer is a reason to ask a sharper question,
  not to move on.
- Every question ends in a requirement or a decision. When the user does not know, propose the
  answer, name the trade-off and the alternative you would drop, and ask for a yes or a no. "I do not
  know" is never the end state, and it is never written into a spec.
- Ask every `question` item of the register and every open question of the digests, in the
  territory it belongs to. Close every
  gap from step 4 here.
- **A mismatch is always asked.** A page that says what the code, another page or the user's own
  answers contradict, a page that states a fact the code shows is not true, and an answer of the user
  that the code contradicts, is a mismatch. Never settle one yourself: not by a rule of which source
  wins, not by stating it back, not by following the code or the page in silence. Ask it as one closed
  question in the territory it belongs to: quote both sides and name where each stands (the page
  title, the screen, the class), the proposed option first. For example "The page Log in says: 'an
  account locks after three attempts'. The code locks after five, in LockoutPolicy. Which is right?",
  with **Five, as the code: the page is corrected** and **Three, as the page: the code is changed**.
  The answer is a decision with source `user` and a `mismatch`: `what`, what did not match in one
  plain sentence in the record's language with both sides named; `chosen`, the choice in plain
  words in the record's language; and
  `page`, the page file relative to `.specs-aidlc-turbo/` as the `path` of its row in `sync.yaml`,
  when a page was one side. When the choice says a page gives way, add `page_fixes`: per page with a
  row in `sync.yaml`, its statement word for word as `from` and the new text as `to`, in the page's
  language, as `skills/sync/confluence.md` **Page corrections** says. The resolve of step 7 writes
  them, the approval lists them, and the Jira sync lists the mismatch on the epic. A statement that
  agrees with the code and with every other answer is no mismatch: use it as it is.
- Every `seen_at` an explorer left unanswered (an `unanswered: where does a user see or start ...`
  in its `gaps`), and every backend change whose answer to where a user sees or starts it stayed
  dark after step 4, is a closed question in the UI-behaviour territory, with the places the code
  points at as options. For example "Does a user see the result of the job Expire gift cards
  anywhere on a screen?", with **Yes, on the Gift cards tab**, **Yes, in Scheduled jobs, tab Logs**
  and **No, only in the database**. The answer goes into the record as a decision:
  `plan.md` sets the criterion's `observed_via` from it.
- A part or an arrow of the Code Scaffold that `plan.md` could not place or prove comes back here
  from its place check, as a closed question in the territory of integrations and existing code.
  An arrow that cannot be proven and is a real choice (another part could offer what is called, or
  the change is not plainly this intent's) is asked, with the places the check found as options:
  for example "The order list fetches the orders by status. Where does that come from?", with **A
  new method in OrderRepository**, **The existing search method of OrderService** and
  **No, the order list does not need this**. The answer goes into the record as a decision, and
  `plan.md` draws the arrow from it: the callee `changed` with `adds` on the link, or a link to
  the part that offers it, with its `proof`. An arrow is never drawn on a guess.
- A register item the intent deliberately does not deliver goes into `deliberately_not` with the
  reason, confirmed with the user, and what is left out in a few words in the record's language
  (`short`, at most 60 characters). The user sees that list again at the approval.
- Skip what the register and the digests already answer, when the code and the user's answers agree
  with it. State those answers back in one line at the end of the territory so the user can correct
  them. A register answer that the code, another page or an answer contradicts is never stated back:
  it is a mismatch, asked as above.
- Stop when two consecutive territories add nothing new, or when the user says that is enough.

### 6. Verification commands

Settle them yourself; never ask the user for them. `story-verify.cjs` runs them after every story, so
they must build and test the code this intent changes, and they may not stay empty.

1. `codebase.commands` in `repo.yaml` is a first guess only: the scan reads just the root build file.
2. Read the build files of the modules the reading list names (the module's `pom.xml`,
   `package.json`, `build.gradle`, `Makefile`), the CI config (`.gitlab-ci.yml`,
   `.github/workflows/`), the standards and the project digests. Scope every command to those
   modules, for example `mvn -q -pl shop-billing/core -am test`.
3. Cover every proof the intent needs. When part of the change is proven only by tests the build
   skips by default (database or integration tests behind a failsafe `skipITs`, a profile, a tag),
   add the command that runs them.
4. **Start only what the tests use.** A command that needs a running service (a database, a broker)
   checks first whether it runs and starts it only when it does not: `{check} || {start}`, never
   `{start} || {check}`. It starts that service alone, never the whole application for tests that
   use only its database: a start that waits until the application answers costs every run that
   wait, and these commands run after every story, after every fix and at finish.
5. Check that every command exists before you write it: the module path, the profile, the plugin,
   the script. When the files cannot settle whether a command runs here, run it once.
6. Write them into `verification` in order. The intake summary names them; the user is not asked.

### 7. Answers back into the pages

Only when pages were pulled from Confluence and a question from them was answered or a mismatch on
one of them decided: dispatch the sync agent with `.specsmd/aidlc-turbo/skills/sync/confluence.md`,
the intent slug, the inception slug and mode `resolve`. It writes every answer from the record into the page it came from. Nothing is pushed
before the approval. A register id in its `open` list is a question that is still unanswered: back to
step 5 for it, then resolve again.

### 8. Nothing-open gate

Check the record before handing over to `plan`:

- No requirement, decision or reading-list row contains `TBD`, `to be decided`, `open question`,
  `we will see`, or a question mark.
- Every requirement is one testable sentence. Every decision has its reason and the alternative
  that was dropped.
- Every reading-list row has a file, a line range and a why.
- Every backend change the intent makes has an answer to where a user sees or starts it: a
  reading-list row from step 4 or a decision from step 5.
- Every decision that names or creates a code structure has its source in the code
  (`code (path:line)`) or says `assumption`.
- Every decision that answers a mismatch has its `mismatch` with `what` and `chosen`, and
  `page_fixes` when its choice says a page with a row in `sync.yaml` gives way.
- `verification` holds real commands.
- Every `question` item of the register and every digest open question is answered, and the
  resolve found nothing left open in the pages.

A failing check sends you back to the questions for that one item. Never move on with a hole in the
record: a hole becomes a blocked builder or, worse, an invented answer.

---

## Output

A short confirmation to the user, then continue automatically:

```text
Intent user-auth: User authentication

- Requirements: 7 functional, 2 non-functional
- Decisions: 5 (1 on an assumption, 1 on a mismatch), deliberately not: 2
- Reading list: 11 files
- Register: 38 statements from 6 pages (4 unchanged pages not read again)
- Confluence: 5 open questions answered and written back
- Verification: mvn -q -DskipTests package / mvn -q test

Nothing is open. Planning the stories now.
```

---

## Transitions

- Record complete and the gate passed -> `plan.md`, automatically, without a checkpoint
- User stops early -> the record is on disk: `/specsmd-aidlc-turbo-inception` resumes it
