# AI-DLC Turbo quick start

From an empty project to a merge-ready branch in ten steps.

---

## Step 1: Install

```bash
npx specsmd@latest install
```

Choose your tools, then pick **AI-DLC Turbo** as the flow.

The installer asks a few project questions:

- **Is this project used for production work?** Both answers use git. Yes means the work goes on branches and, once you approve the finished intent, is pushed with its merge request (GitLab) or pull request (GitHub) opened. No gives you sandbox mode: production without story branches.
- **Which parts a sandbox intent makes**, only in sandbox, right after the mode: the Code Scaffold, and the Code Scaffold updated after the build. Yes is the suggested answer to both; the second is skipped when the Code Scaffold is no. Production always makes both.
- **What happens when an intent is done**, only in sandbox. Pushing it straight onto the base branch is the suggested answer; the other one pushes the intent branch with one merge request into the base branch.
- **Branch prefix** and **base branch**, in both modes. The base branch is where every intent starts and where it goes back to; type its name or paste its link.
- **A separate branch per story**, only in production. Yes is the suggested answer: each story gets its own branch and merge request, pushed at the end once you approve the intent, into the intent branch or into the story it depends on. No is meant for small pieces of work: every story is committed on the intent branch, pushed once at the end.
- **Is there a human tester who should receive test cases?** The test cases are written in the language of the inception and go to the intent's own `tests/` folder; there is nothing else to choose.
- **Documentation and issues**, only in production: optional, nothing by default, or Confluence and Jira. With Jira it asks for the link to the project board; Enter asks it later.

The live test is not asked: at the end of every intent the agent starts the app and tries the intent out, and works out itself how the app starts and where it answers.

The answers land in `.specs-aidlc-turbo/repo/config.yaml`, next to the empty `project/` and `docs/` folders. Nothing is overwritten if that file already exists, and you can change everything later with `/specsmd-aidlc-turbo-config`. A folder that is no git repository yet is asked once, at the first inception, whether it may become one with a first commit. Upgrading from the old layout? The installer moves it first, or run `node .specsmd/aidlc-turbo/scripts/migrate-layout.cjs --write` yourself.

---

## Step 2: Start the master

```text
/specsmd-aidlc-turbo
```

It reads the project state and tells you what is next. In a fresh project that is `project-init`.

The first time, every Turbo command also sets up the code tooling with you: it looks at the languages and build files of the repo and proposes a language server per language it really uses, and the analysis tools and linters the project already has. You pick; the choice is kept in `.specs-aidlc-turbo/repo/tooling.yaml`, also when you pick none, so it is never asked again. Every later start only checks that this machine has what was chosen.

---

## Step 3: Initialise the project

The master runs the codebase scan first and shows you what it found: languages, UI stack, backend stack, test runners, and the build and test commands. Correct anything that is wrong, especially those two commands, because they prove every story. They land in `.specs-aidlc-turbo/repo/repo.yaml`, the project type in `project/project.yaml`.

With Confluence on, it offers to read your `Project Documentation` page first: paste its link and the pages are pulled, the link is kept for every inception after it, and the standards start from what the pages already decide.

Then it walks you through the standards, one topic at a time:

- **Tech stack** - languages, framework, database, package manager
- **Coding standards** - formatting, linting, testing, naming
- **Data stack** - when the project has a database
- **Optional** - system architecture, UX guide, API conventions

They land in `.specs-aidlc-turbo/repo/standards/`. Every builder gets the ones its story needs.

---

## Step 4: Start an intent

```text
/specsmd-aidlc-turbo-inception
```

Describe what you want in your own words. One intent is one coherent piece of work, for example "customers can pay with a gift card" or "an order shows its delivery status".

The language you speak here is the language of the intent: the product team's half of every story, the overview page and the test cases are written in it, while the requirements, the decisions and the agent's half of every story stay in English. Turbo ships its fixed texts in English; for another language the agent first translates them into `.specs-aidlc-turbo/repo/lang/{code}.json`, which the next intent in that language reuses.

First the agent looks for leftovers of earlier work: an old AI-DLC memory bank, a finished Turbo inception. It asks once whether to clean them up, and yes removes them in one local commit on your current branch: on the base branch it goes along with the intent branch, on another branch you push it yourself. Unfinished Turbo work is never removed; the agent tells you how to continue it.

With Confluence on, it asks for the intent's `{name} - Documentation` page and pulls it, with the shared `Project Documentation`. When that page holds more than one intent, every intent gets its own `{intent} - Documentation` page under it, with its own `{intent} - Stories` page: the agent names every page it would create or move in one question, and does it only on yes. Otherwise point it at local documents:

```text
/specsmd-aidlc-turbo-inception --docs docs/checkout,docs/payments.md
```

Everything you answer from here on goes straight into the intent's `record.yaml`, so an interrupted inception loses nothing.

---

## Step 5: Answer the questions

A docs reader numbers every statement in the pages; unchanged pages are never read again. The agent reads the relevant code, then works through the topics one closed question at a time: scope, the happy path and the edge cases, data and storage, integrations, non-functional requirements, UI behaviour.

Three things to expect:

- It proposes an answer with a reason instead of asking an open question. Confirm it or change it. A proposal that names code (a right, a menu place, a table) is first checked against what already exists.
- It never asks you for the build and test commands: it works them out from the build files of the code the intent touches, and names them in its summary.
- It shows you every place where your documents and your code disagree, and every open question in the pages, and the two of you settle it there and then. Answers to Confluence questions go back into the page.

It stops asking when two topics in a row add nothing. Nothing is left open: an unanswered question would become a wrong guess during the build.

---

## Step 6: The story map

The agent cuts the work into stories and decides their order itself, then shows you the map, titles and order only. A story is one builder session: one slice of behaviour, verifiable on its own, with the files it will touch named up front. Then it draws the Code Scaffold: the modules, classes, files and tables the stories build, change or use, with what calls what, each part with its evidence in the code.

You are not asked about it. A different split or a different scaffold is a change at the approval, like any other.

---

## Step 7: Approve

A script renders the brief and the stories from the record, and a second script checks that every statement in your documents is covered or left out on purpose. A cross-checker reads the stories against each other and the code, a docs verifier against the documents, and everything they find is fixed first. Then an overview page in your language opens in your browser, one page with a tab per view: Functional (the intent in plain words, its life cycle with the stories on the steps, the vertical slices of every story through the system, the integration tests between the stories, what was left out on purpose, and per story its user story, its acceptance criteria and the code it touches), Code Scaffold (the code the stories build, drawn before anything is built, each flow played step by step), and, when the record has one, C4 model (who uses the application, the systems around it and what it is made of). The agent wrote the plain texts and the C4 model into the record from what it found, nothing invented. Details shows the plain texts and starts on; ? shows the page's own explanations and how to read a tab, and starts off.

The agent asks whether everything is right. Yes approves; anything else is a change: the agent fixes the record, renders again and asks again. **This is the approval of the plan; the only other one comes at the very end, before anything is pushed.** On yes the Code Scaffold page is saved next to the overview as `code-scaffold.html`, opening on the Code Scaffold tab, and published as a claude.ai artifact when Claude Code has the Artifact tool. A sandbox that switched the Code Scaffold off skips it. With Confluence on, the changed pages go back and the approved overview is attached to the intent's own documentation page as `overview-{intent-slug}.html` and linked at its top; with Jira on, the epic and stories are created.

The intent branch is created here and the specs are committed, in both modes:

```text
docs(gift-cards): inception brief and stories
```

The agent ends with one line: start construction in a clean session.

---

## Step 8: Build

```text
/clear
/specsmd-aidlc-turbo-construction gift-cards
```

Everything construction needs is on disk, so the clean session starts light. Without an argument it lists the intents you can build and lets you pick.

Stories that do not depend on each other are built at the same time, each in its own worktree; the rest follow as soon as their dependencies are done. Per story a builder writes the tests first and then the code, a script runs the verification commands and keeps the proof, reviewers with fresh eyes check the diff side by side (against the story, on quality and safety, against the project's own rules), a script then breaks a few lines the story changed, to prove its tests can fail, and the story gets its own commit:

```text
feat(gift-cards): pay an order with a gift card (S002)
```

You do not have to sit and watch. A miss is fixed and checked again; a second miss sends a debugger for the root cause; only a third miss, or a mismatch between the story, the brief, the documentation and the code, stops that one story and asks you one question. With Jira on, your answer to a mismatch goes to Jira at the end, and with Confluence on a page that turned out wrong is corrected on Confluence, both after your approval. The other stories keep building.

---

## Step 9: Check the result

When the last story is done:

- the verification commands run once more on the whole tree
- a fresh agent starts the app and tries every acceptance criterion a user can see; what fails is fixed per story and reviewed again
- a breaker then attacks the stories where a user puts something in or changes something, with wrong input, the wrong order and the wrong rights; every real defect is fixed and checked again
- only then the intent reviewer checks every requirement and the files several stories share, and every finding goes up the same ladder; no review file is kept
- with a tester configured, the test cases are written only now, against the finished code, each with a regression check on every place the change reaches that a tester can check, with no maximum
- the Code Scaffold updated as built is saved as `code-scaffold-built.html` next to `code-scaffold.html`, which stays as approved, and published to the same artifact link
- you approve the intent on the same overview page: the Code Scaffold tab is now Code, the drawing as approved and played step by step with where the build deviated, and Review joins it, every changed file with its change. You can approve the push, ask to change something first (it is planned and shown on the page again, and built only on your go), ask questions about the code, or keep it local
- only after your approval production mode pushes the branches and opens their merge requests or pull requests, each with a short description in three sections, and so does sandbox with one merge request
- sandbox with a push straight onto the base branch puts the intent there, after the same approval, and shows the commit; without a remote it stays on your local base branch

The summary is the first place you see the merge requests; its last line tells you whether you can merge. The flow never merges a merge request. That stays your call.

Review comments on the merge requests come later. `/specsmd-aidlc-turbo-review-fix` takes them story by story on GitLab: it judges each comment, you decide per comment to fix it, answer it or leave it, and the fixes are built, checked and pushed with the answers once you approve.

---

## Step 10: The next intent

```text
/specsmd-aidlc-turbo-inception
```

Every intent gets its own folder under `docs/`, named after its slug, and its own branch. Your standards, `repo.yaml`, `tooling.yaml` and `project.yaml` carry over; you only go through step 3 once.

---

## Handy in between

| You want to | Run |
|-------------|-----|
| Know where you are | `/specsmd-aidlc-turbo` |
| Change the mode, the branch prefix, the tester setting or the code tooling | `/specsmd-aidlc-turbo-config` |
| Know what a story does or why a decision was taken | `/specsmd-aidlc-turbo` and just ask |
| See which stories are still open | `node .specsmd/aidlc-turbo/scripts/intent-status.cjs gift-cards` |
| Prove every test case again, or push an intent you kept local | `/specsmd-aidlc-turbo-construction gift-cards`, **Finish again** |
| Handle the review comments on the merge requests | `/specsmd-aidlc-turbo-review-fix gift-cards` |

---

## If something goes wrong

- **The build stops with a mismatch.** The story, the brief, a page or the code say things that cannot all hold. Choose, and the agent records the decision before that story continues.
- **A story misses three times.** That story stops and shows you the findings and the debugger's analysis; the rest keep building.
- **Inception was interrupted.** Run `/specsmd-aidlc-turbo-inception` again. The record keeps every answer, and a draft is picked up where it left off.
- **The scan got your stack wrong.** Correct the values in `.specs-aidlc-turbo/repo/repo.yaml` by hand, or run `project-init` again.
- **A script says the layout is old.** Run `node .specsmd/aidlc-turbo/scripts/migrate-layout.cjs` to see what it moves, then again with `--write`.
