# Skill: Explain Flow

---

## Role

Educational skill. Explains how AI-DLC Turbo works and where the user is in it.

**No checkpoint** - this is an explanation, not a decision.

---

## Goal

Answer "how does this work?" in plain language, in the language the user speaks, tied to the user's own project where possible.

---

## Input

- **Required**: the user's question
- **Optional**: the state from `analyze-context.md`

---

## Process

### 1. The short version

```markdown
## AI-DLC Turbo in one paragraph

You describe what you want. The flow asks everything it needs to know in one
pass, reads your docs and the relevant code, and writes a brief plus a set of
stories. You approve that once. From there it builds every story by itself:
each story gets its own builder that works test-first, a script runs the tests,
and reviewers with fresh eyes check the diff before the story lands: against
the story, on quality and safety, and against the project's own rules.
```

### 2. The stages

```markdown
### Configure and initialise (once per project)

`/specsmd-aidlc-turbo-config` sets the two things that matter: the mode, and
whether there is a human tester who should get test cases. Both modes use git.
Production mode gives a branch per story, or for small pieces of work one commit
per story on the intent branch, all pushed at the end once you approve the
intent. Sandbox mode is production without story branches: at the
end the intent goes straight onto the base branch, or into one merge request.
A folder without git is asked once whether it may become a repository.

`project-init` scans the codebase, then walks you through the project standards
(tech stack, coding standards, and optionally data, architecture, UX and API
conventions). Those standards are the rules every builder follows.

### Inception (one pass, one approval)

`/specsmd-aidlc-turbo-inception`

1. **Intake**. A new inception first names the leftovers of earlier work (old
   AI-DLC folders, finished Turbo inceptions) and cleans them up in one local
   commit when you say so.
   Everything you answer goes straight into the intent's record on
   disk, so nothing lives only in the chat. A docs reader reads only the pages
   that are new or changed and numbers every statement in them in a source
   register. The agent greps the codebase itself and sends an explorer only into
   an area it still cannot place, at most three of them. For every backend
   change both first look for where a user sees or starts it (a screen, menu,
   tab, button, route or API): that sets per acceptance criterion where the
   tester checks it. The explorers also look for what already exists that the
   work hangs on, such as a right, a menu place or a similar screen, and
   where the new code lands.
2. **Interrogation**. One closed question at a time, with a proposed answer.
   A proposal that names code is checked against what already exists first, and
   one that no code backs says it is an assumption.
   Every question ends in a requirement or a decision that you confirm. Nothing
   may stay open: an open question would just become a wrong guess during the
   build.
3. **Planning**. The agent cuts the work into stories and decides their order
   itself, without asking. A story is one builder session, a vertical slice of
   behaviour, and names the files it will touch and the sources it covers.
   Then it draws the Code Scaffold: the code the stories build, change or
   use, each part and each arrow with its evidence in the code and a colour
   for how sure it is (red: a choice still open). It is the starting point of
   the code, roughly how it is built, not a source of truth.
4. **Specs by script**. A script renders the brief and the stories from the
   record, and a second script checks their form and that every statement in
   the docs is covered by a story or left out on purpose, with a reason. Then a
   cross-checker reads the stories against each other and the code, and a docs
   verifier checks the meaning against the original pages. What they find is
   fixed in the record before you see anything.
5. **Approval**. An overview page in your language opens in your browser, as a Claude
   artifact when your Claude Code has artifacts. Its Functional tab tells the intent
   in plain words, its life cycle with the stories on the steps, the vertical
   slices, the integration tests between the stories, what was left out on
   purpose, and per story the user story, its acceptance criteria and why; the
   Code Scaffold draws the code the stories build, each flow played step by step
   from its start; when the record has one, the C4 model zooms from the system
   to its components.
   Details shows the plain texts and starts on; ? shows the page's explanations
   and how to read a tab and starts off. When the drawing is wrong you pick **The Code
   Scaffold is wrong** and say what must change: the agent changes the plan
   and draws it again before anything is built. An open choice in the drawing
   is asked in the approval question. This is the approval of the plan; the only other one comes at the very end,
   before anything is pushed. On yes, when the project syncs with Confluence,
   the approved overview is attached as `overview-{intent-slug}.html` to the
   intent's own documentation page and linked at its top.
   Every intent has its own page: an inception of one intent uses its
   `{name} - Documentation` page, and when an inception holds several intents
   each gets `{intent} - Documentation` under it, with its own
   `{intent} - Stories` page (the names follow `sync.page_names`).
   The agent makes and moves those pages itself, after one question that names
   every page. With Jira the approved overview goes onto the epic, with the artifact as a link. The
   intent branch is created here and the specs are committed. Then the flow
   tells you to start construction in a clean session: `/clear`, then the
   construction command. Everything it needs is on disk.

### Construction (only a story that misses three times waits)

`/specsmd-aidlc-turbo-construction your-intent`

Stories that do not depend on each other are built at the same time, each in
its own worktree; a story starts as soon as its dependencies are landed, in
both modes. Per story:

1. A builder reads the story and the standards it is handed. Opus builds
   medium and hard stories, Sonnet the low ones. It works test-first, builds
   what the story's Code Scaffold names, and reports anything extra or built
   differently, with the reason. A new right, table or module the scaffold
   does not name is put to you first.
2. A script runs the verification commands and writes the proof, so the
   evidence never comes from the builder itself.
3. Reviewers with a fresh context read the diff side by side: one against the
   story, the proof and the Code Scaffold, one on quality and safety, one against the project's
   own rules (the standards and the shared project documentation). A script then
   breaks a few lines the story changed, to prove its tests can fail. A pass
   lands the story as its own commit. Small findings are fixed without a
   second review.
4. A real miss goes up a ladder: the builder fixes it and the reviewers check
   only the fix. A second miss sends a debugger to find the root cause with
   evidence. A third miss stops that story for you, and only that story: the
   rest keep building.

At the end a live test runs against the real app, in both modes. A breaker
then attacks the stories where a user puts something in or changes something,
with wrong input, the wrong order and the wrong rights, and what it breaks is
fixed. Then the whole intent gets one more review, per requirement and across
the stories, with the same ladder. When a human tester is configured a test
case is written per story in your language, plus a Playwright twin when the project
ships Playwright. Each twin must run against the app before its test case is
handed over; when the app fell over it is restarted once, and if it still does not
answer you are asked. The overview page opens again, now with the test cases,
the Code tab with the Code Scaffold as you approved it, never updated, played
step by step: on it you see where the build deviated from it and why, and a
Review tab with every changed file and its diff.
You approve the intent first, and only then everything is pushed and the merge
requests are opened for you; sandbox
with the default finish puts the intent straight onto the base branch instead.
The flow never merges a merge request for you.
```

### 3. What it does not do

```markdown
- No units, no bolts, no separate design documents, no decision ledger, no logs.
  One brief and its stories. Review findings are fixed, not filed.
- No open questions. Anything unclear is settled with you during inception.
- No stop during construction, except for a story that misses three times, and
  a mismatch: a story, the brief, the documentation or the code that do not
  agree. A mismatch is always put to you: your answer goes to Jira when the
  project syncs with it, and a page that turned out wrong is corrected once you
  approve. Only that story
  waits.
- It never merges a merge request and never deploys anything. Only sandbox
  with the default finish puts the work on the base branch itself, because you
  chose that.
```

### 4. Common questions

- **"Why so few approvals?"** Because a stop costs you a context switch. Everything a builder needs is decided in inception, so there is nothing left to approve halfway; the second approval comes only at the end, before anything leaves your machine.
- **"What if a builder hits an unclear point?"** It decides, when the brief, the standards or the code answer it, and writes the decision into the story's build notes. It only comes back to you on a mismatch (the story, the brief, the documentation or the code say things that cannot all hold, or a page is not true of the code), or when it needs a new right, table or module the Code Scaffold does not name. A mismatch is never settled by which source comes first: you choose, your choice goes to Jira when the project syncs with it, and a page that turned out wrong is corrected on Confluence once you approve the finished intent.
- **"Which model does what?"** Opus builds, reviews, debugs, explores the code, checks the specs and tries to break the app; Sonnet reads the docs, builds the low stories, writes the test cases, runs the live test and syncs with Confluence and Jira. Every role pins its model, so nothing runs on whatever the session happens to use.
- **"What is in a story?"** Two halves in one file. The top half is in your language, for the product team: the user story, why it exists, the acceptance criteria, what is out of scope. The bottom half is for the agent: what to read, the design, the Code Scaffold, the edge cases, the test plan.
- **"How is this different from full AI-DLC?"** Same discipline, far fewer documents and one approval instead of a checkpoint per stage.
- **"Can I still review the code?"** Yes. Production mode gives you a merge request per story, or for small pieces of work one commit per story and a merge request at the end. Sandbox gives you one commit per story, and one merge request at the end when you chose that finish.
- **"What is the difference between production and sandbox?"** Sandbox is production without story branches. At the end it puts the intent straight onto the base branch, or opens one merge request, as the config says. Everything else is the same.

---

## Output

```markdown
## {Topic}

{The explanation, as short as the question allows}

### Where you are

{Phase and active intent, when known}

### Next step

{One command}
```

---

## Transitions

- -> **Route Request** (`.specsmd/aidlc-turbo/skills/master/route-request.md`) when the user wants to get going
- -> **Answer Question** (`.specsmd/aidlc-turbo/skills/master/answer-question.md`) for a question about this project rather than about the flow
