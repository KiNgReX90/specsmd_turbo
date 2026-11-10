# Skill: Dispatch

---

## Role

The build loop of AI-DLC Turbo. You schedule stories, build every ready story at the same time, have every result verified and reviewed, and land each story. You write no production code. You do no claim, test run, staging, commit or cherry-pick by hand: `story-start.cjs`, `story-verify.cjs` and `story-land.cjs` do those.

**No checkpoint.** The human stops are listed below, and only the story concerned waits.

---

## Input

- **Required**: the absolute project root, the directory this session was started in. Every path below is relative to it
- **Required**: the intent slug
- **Required**: `.specs-aidlc-turbo/repo/config.yaml` (mode, branching, `construction.mutants`). No file means the defaults: `mode: production`, no branch prefix, base branch `main`, story branches on, no cap on the mutants

Everything else comes from `intent-status.cjs --json`. Never read a story body, the brief body, the standards or the Project Documentation: the scripts and the subagents read those.

Scripts live in `.specsmd/aidlc-turbo/scripts/`. `{intent_dir}` is `.specs-aidlc-turbo/docs/{inception}/{intent}/`, with `inception` from the status JSON.

---

## Process

### 1. Startup

1. Run `node .specsmd/aidlc-turbo/scripts/intent-status.cjs {intent} --json` and keep the JSON: per story `file`, `status`, `depends_on`, `complexity`, `touches`, `changed_files`, `misses`, `tester_verifiable`, `branch`, `stack_on`, `merge_in`; plus `frontier`, `blocked`, `brief` (its frontmatter: `status`, `branch`, `lane`), `verification`, `shared_files` and `project_docs`. The brief must be `approved` or `building`. A script that reports the old layout: show its message and stop.
2. **The intent branch**, in both modes: the working tree must be clean outside `.specs-aidlc-turbo/`, and the current branch must be the intent branch named in `brief.branch`: switch to it, never recompose the name from the folder. A brief that is `building` with no branch was started by the old sandbox mode, before it used git: its work sits uncommitted in the tree, so the clean check fails. Say that once, in plain words in the session language, and ask the user to commit or stash that work first; then treat it as `approved`. A brief that is `approved` with no branch: create `{project_key}/intent-{intent-slug}/intent` from `branching.base_branch` and write it into the brief frontmatter (drop the `{project_key}/` part when the key is empty, append `-2`, `-3` to the slug part when the name exists). Sandbox mode is production mode without story branches: `branching.story_branches` is ignored there, and only the end of `finish` differs.
   The project tree stays on the intent branch for the whole loop: `story-land.cjs` commits every landed story file there (`docs({intent-slug}): S{SSS} done`), and with story branches off it cherry-picks onto it, which needs a clean index. Never stage anything in the project tree yourself. The brief stays uncommitted until `finish`.
3. **Story branches** (`branching.story_branches: true`, production mode only): the current branch may be one of this intent's story branches when an earlier session stopped halfway: switch to the intent branch. Nothing is pushed during the build: every branch stays local until the user approves the intent at the end of `finish`.
4. **Resume**: a story left `building` or `review` by an earlier session: `story-start.cjs {intent} {SSS} --resume`, which reuses its worktree and branch, then verify and review it. The builder's last `changed_files` died with that session: take them from `git -C {worktree} status --porcelain -uall`, minus `.specs-aidlc-turbo/`, the same set `story-land.cjs` checks. Its miss count is the story's `misses` in the status JSON. A `blocked` story stays blocked: name it and what it waits for.

### 2. Side by side

Stories that do not depend on each other are always built at the same time. This is not optional.

- **Every story on the frontier starts at once**, each in its own worktree, in both modes. On Claude Code: one Agent call per story, all in the same message, in the background. Handle each result as it arrives: a story's next step starts as soon as its own subagent returns.
- **The frontier moves on its own**: every `story-land.cjs` prints the new frontier. Start every story in it that is not already running, while the others keep going.
- **One database is fine**: builders share the project's database, and every story's tests use only their own records (its `test_data`). Never serialise stories for their database tests; only a `depends_on` does that.
- **Serial**: `story-start.cjs`, `story-land.cjs` and every edit of a story, the brief or the record touch the project tree: never two at the same time. `story-verify.cjs` runs in a worktree and may run beside the others.

### 3. Per story

1. **Start**: `node .specsmd/aidlc-turbo/scripts/story-start.cjs {intent} {SSS}`. It claims the story (the first start also sets the brief to `building`), creates its worktree and branch by the naming rules (story branches: on the story's own branch, from its `stack_on` start point with its `merge_in` branches merged in), and prints `{ story, slug, file, worktree, branch, base, builder, brief, standards, project_docs, verification, touches }`. `project_docs` holds the project's rules for code: `index`, the root page of the Project Documentation (or none), and `batches`, the standards and the pages in reading batches, one for a normal project. `builder` follows the story's complexity: `low` gets `specsmd-aidlc-turbo-builder-low`, `medium`, `hard` or none gets `specsmd-aidlc-turbo-builder`. Exit 1: show the error. A merge conflict between dependency branches is a human stop.
2. **Build**: dispatch the `builder` it named (on Claude Code: the Agent tool with that subagent type) with `mode: build`, the absolute project root, `worktree` as the code root, and `story`, `file`, `brief`, `standards`, `project_docs`, `verification` and `touches` from the JSON. Nothing else: no file bodies, no restated policy. Hosts without subagents: follow `.specsmd/aidlc-turbo/skills/construction/build-story.md` inline.
3. **Builder result**:
   - `done`: verify. A `Mismatch:` line in its `notes` (one the story does not rest on): ask it as **Mismatch** in step 4 says, while the story goes on.
   - `blocked` with `notes` starting `Mismatch:`: the story rests on a mismatch, a human stop for this story, asked as **Mismatch** in step 4 says.
   - `blocked` because a requirement is missing: a human stop for this story.
   - `blocked` with `notes` starting `Code Scaffold:`: the story needs a new right, a new table or a new module that its Code Scaffold does not name. Nothing of it is built until the human says yes. Set `status: blocked` in the story frontmatter and ask with the host's multiple-choice prompt (on Claude Code: AskUserQuestion), in plain words in the session language: what the builder needs and why, for example "Login with expired password needs a new table the Code Scaffold does not name: a token cache, because the session would otherwise be fetched twice. May it be added?", with **Yes, build it** first and **No, the story stays blocked**. The other stories build on meanwhile. Yes: `story-start.cjs {intent} {SSS} --resume`, then dispatch the builder again as in step 2, plus `scaffold_approved: "{what the human approved, in one line}"`, and pass that field to every review of this story. No: the story stays blocked, its worktree and branch stay. Another answer (an existing right that fits, a change to the story) is a decision, handled as **Blocked** in step 4 says.
   - `builder-low` returned `failed`, an invalid result, or `blocked` for its own lack of skill: dispatch `specsmd-aidlc-turbo-builder` in fix mode with the finding `builder-low stopped: {notes}. Finish the story; read its ### Context to read.` That is not a miss.
   - `specsmd-aidlc-turbo-builder` returned an invalid result: dispatch it once more, then it is a human stop.
4. **Verify**: `node .specsmd/aidlc-turbo/scripts/story-verify.cjs {intent} {SSS} --code-root {worktree}`. It writes `{intent_dir}/proof/{SSS}.json` and prints `PASS|FAIL {story} {n}/{m} commands`. `FAIL` is a miss without a review (step 4), with the failed commands and the proof path as the finding. A `FAIL` followed by `switched off` lines is the same miss: those lines and the proof path are the finding.
5. **Review**: every reviewer of the story at once, each a `specsmd-aidlc-turbo-reviewer` with `scope: story`, `mode: full` and its own `lens` (on Claude Code: one Agent call per reviewer, all in the same message, in the background): `lens: story`, `lens: quality`, and one `lens: docs` per batch of `project_docs.batches`, with that batch as `docs`, its number as `batch` (from 1) and `project_docs.index` as `index`. No batches: no docs reviewer. Each gets the absolute project root, the code root, the story path (`file`), the `brief` path and the proof path, plus `scaffold_approved` when the builder had one. Hosts without subagents: follow `review.md` inline, one lens after the other.
6. **Verdict**: wait for every reviewer of the story, then make their verdicts one:
   - **Mutants first**, unless `construction.mutants` in the config is 0. Write all of the story lens's `mutants`, as a JSON array, to `{tmp}/{intent}-S{SSS}-mutants.json` in the system temp directory `{tmp}`, and run `node .specsmd/aidlc-turbo/scripts/story-mutate.cjs {intent} {SSS} --code-root {worktree} --mutants {that file} --untested {its untested, comma-joined}` in the background (on Claude Code: `run_in_background`, never a short timeout): every mutant costs a test run. The script reads the cap itself: a number in `construction.mutants` keeps the mutants of the first that many criteria with a test, no number (the default) runs one per criterion. It breaks one line at a time, runs that mutant's test and puts the line back, then prints one `CRITERION` line per acceptance criterion. Every `SURVIVED` line becomes a finding with the mutant's id: `severity: major`, `file: {file}:{line}`, issue "`{test}` stays green when `{file}:{line}` `{from}` becomes `{to}`: {criterion} is not really covered", fix "make the test turn red on that change; leave the production line as it is". It joins the findings of the one verdict. `INVALID` is no finding. A `CRITERION {n} invalid` or `CRITERION {n} missing` line is a criterion with a test and no killed mutant: a finding `C{n}`, `severity: major`, issue "no mutant shows that the test of criterion {n} can fail: {the reason in brackets, or none proposed}". A `C` finding is the story lens's, never the builder's: it goes to the story lens's delta review as **Mutants again** in step 4 says. `killed`, `untested` and `capped` are no finding, and a `survived` criterion has its `SURVIVED` finding already. Exit 1 with `diff changed`: run `story-verify.cjs` again (the changed diff is no miss, a `FAIL` is), and after its `PASS` run `story-mutate.cjs` once more; a second `diff changed` means its tests write files: go on without the mutants. `interrupted`: run it once more, it first puts back what a cut-off run left. `restore failed`, or an `Error:`: show its output; the story is a human stop, its worktree may hold a broken line. Run it also when the story lens proposed none, so every criterion gets its line; after a delta verdict skip this, its new mutants run as **Mutants again** says. Delete the mutants file once the story lands. Never run a mutant yourself.
   - `fail` when any of them is `fail`, else `pass`.
   - The findings of all of them, each with its own id. The same fault found by two lenses goes to the builder once, at the higher severity, with both ids.
   - Two findings that pull apart: a rule of the project wins over the quality lens's taste and over what the Code Scaffold planned.
   - A finding with `story_demands: true` (the story's own criterion asks for what a rule of the project forbids) is not the builder's fault and no miss: the story becomes a human stop, handled as **Blocked** in step 4 says, with the clash as a closed question (**Keep the rule**, the story's criterion gives way, first; **The story wins**, a new `D-n` sets the rule aside for this story). The other findings go along with the answer's fix. It is a mismatch, and its answer is recorded as **Mismatch** in step 4 says.
   - A finding with `mismatch: true` (it shows that the story, the brief or a page is wrong, not the code) is no fault of the builder and no miss either: ask it as **Mismatch** in step 4 says. When the code changes with the answer, the story waits for it; otherwise it lands with its other findings.

   Then the ladder of step 4 decides.
7. **Land**: `node .specsmd/aidlc-turbo/scripts/story-land.cjs {intent} {SSS} --changed-files {the builder's last changed_files, comma-joined}`, plus `--fix` when the story fixes a defect. It checks the proof still matches the diff, stages, commits, carries the commit onto the intent branch (cherry-pick, or a commit on the story branch, which stays local), sets the story `done` through the `story-complete.cjs` gate, commits the story file, removes the worktree, and prints `{ story, commit, frontier, worktree_removed }`, with `branch` when story branches are on. Exit 1 prints `{ story, error, staged, expected }` and keeps the worktree and branch:
   - the staged files differ from `changed_files`: dispatch the builder in fix mode with both lists as one finding (undo what the story did not need, or name it in `changed_files`), then verify and land again. Not a miss; a second mismatch is a human stop.
   - a path with an `aidlc-twins` segment, which belongs to the test writer at finish: dispatch the builder in fix mode with the refusal as the finding, like a mismatch (move the spec next to the project's own specs, and drop the `aidlc-twins/` path from `changed_files`), then verify and land again. Not a miss; a second refusal is a human stop.
   - the cherry-pick conflicts, because a story built beside it changed the same lines: a human stop. Show the conflicting files.
   - any other error: a human stop for this story.
8. **Next**: start every story in the printed `frontier` that is not running yet.
9. **Test cases**: none here. `finish` writes them once every story is built, the intent is reviewed and every finding is fixed, so they describe the code the tester will really get.

### 4. The ladder

A **miss** is a review verdict `fail` (the one verdict of step 3.6: a `blocker` or `major` from any lens) or a `FAIL` from `story-verify.cjs`. A verdict whose only `blocker` or `major` findings are `C` findings is no miss: only the story lens's delta review runs, at once and without a fix diff, as **Mutants again** says. Each story counts its own, and keeps the count on disk: after every miss write `misses: {n}` into the story frontmatter, so a later session goes on up the ladder instead of starting at miss 0.

| Result | Next |
| ------ | ---- |
| `pass`, no findings | Land |
| `pass` with minors only | Builder fix mode with the minors, verify, land. No second review, never a miss |
| Miss 1 | Builder fix mode, verify, delta review |
| Miss 2 | `specsmd-aidlc-turbo-debugger`. `plan`: builder fix mode with the plan, verify, delta review. `stop`: the story is blocked |
| Miss 3 | The story is blocked |

- **Fix mode** always goes to `specsmd-aidlc-turbo-builder`, also for a low story. Input: `mode: fix`, the absolute project root, the code root, the story path, the builder's last `changed_files`, and the `findings` verbatim (review findings, or the failed commands with the proof path) or the debugger's `plan`. It fixes, runs the narrow tests and returns; `story-verify.cjs` follows.
- **The fix diff**: before every fix dispatch, snapshot the code root, and after it, write what the fix changed to the system temp directory `{tmp}`. The snapshot lives in a throwaway index, `{idx}` = `{tmp}/{intent}-S{SSS}-fix-{n}.idx` (an absolute path), so the real index is never touched and nothing gets staged:

  ```bash
  GIT_INDEX_FILE={idx} git -C {code root} read-tree HEAD
  GIT_INDEX_FILE={idx} git -C {code root} add -A -- . ':!.specs-aidlc-turbo'
  GIT_INDEX_FILE={idx} git -C {code root} write-tree
  ```

  The last line prints `{snapshot}`. After the fix, the same index:

  ```bash
  GIT_INDEX_FILE={idx} git -C {code root} add -A -- . ':!.specs-aidlc-turbo'
  GIT_INDEX_FILE={idx} git -C {code root} diff --cached {snapshot} -- . ':!.specs-aidlc-turbo' > {tmp}/{intent}-S{SSS}-fix-{n}.diff
  ```

  Delete the `.diff` files and the index once the story lands.
- **Delta review**: every reviewer of the last round again, side by side, each with `mode: delta`, its own previous verdict verbatim, the fix diff path, and the fields of step 3.5; their verdicts are made one as in step 3.6. Each checks its findings resolved and nothing new broken in the fix hunks, through its own lens. A story with no review yet (its misses were red verifications) gets the full reviews instead.
- **Mutants again**: after a fix for open `M` findings, once `story-verify.cjs` says `PASS`, run `story-mutate.cjs` as in step 3.6 with `--only {the open M ids}`, before the delta review. `KILLED` resolves that finding, `SURVIVED` keeps it open, verbatim. `INVALID`, and an `M` finding the builder disputed, go to the story lens's delta review with the script's reason or the builder's evidence. A `C` finding goes there too, with the script's reason and the next free `M` id: the story lens proposes one new mutant for that criterion. Add it to the mutants file and, after that delta review, run `story-mutate.cjs` with `--only {its id}` before the verdicts are made one. Its `CRITERION` line decides: `killed` resolves the `C` finding, `survived` turns it into the new mutant's `M` finding. A criterion gets one new proposal: a line that still reads `invalid` or `missing` sends the `C` finding to the story lens's next delta review with its one new mutant spent, and the lens judges it from the code.
- **Debugger**: dispatch it with the absolute project root, the code root, the story and brief paths, the findings of both misses verbatim, both fix diff paths, the proof path and the builder's `notes` of both rounds. Hosts without subagents: follow the method in the `specsmd-aidlc-turbo-debugger` agent file yourself.
- **Blocked**: set `status: blocked` in the story frontmatter. Its worktree and branch stay. Take it to the human with the open findings, or the debugger's question as a closed question in plain words with its proposed option first (the host's multiple-choice prompt; on Claude Code: AskUserQuestion). Stories that do not depend on it keep building. The answer is a fix, which goes to builder fix mode as the plan, then verify and delta review; or a decision, which goes into the brief as a new `D-n` or into the story, then fix or land as it says. Continue with `story-start.cjs {intent} {SSS} --resume`, which sets it `building` again on the same worktree. A miss after the human's answer goes back to the human.
- **Mismatch**: a builder's `Mismatch:`, a finding with `mismatch: true` or `story_demands: true`, a debugger's `stop` with `mismatch: true`, or at finish a live check, an attack or a twin that fails because the story itself is wrong. The story, the brief, a page of the Project Documentation, a standard or the code say things that cannot both hold, or a page states a fact the code shows is not true. It is always the human's: never settle it by which source comes first, and never bend the code or the story to one side in silence. Ask it with the host's multiple-choice prompt (on Claude Code: AskUserQuestion), at most four questions in one prompt, in plain words in the session language: quote both sides and name where each stands (the page title, the story title, the screen, the class), never an id, the proposed option first. For example "Login with expired password says an account locks after three attempts. The page Login and the code (LockoutPolicy) say five. Which is right?", with **Five: the story is changed** and **Three: the code is rebuilt**. Keep asking while the answer is vague. A story whose code changes with the answer waits as **Blocked** says; the others keep building. Record the answer before anything else:
  1. A new `D-n` in the brief, the next free number, in the line the inception renders: `- **D-n**: {the decision}. Reason: {why}. Dropped: {the side that gave way}.`
  2. The same decision in `record.yaml` under `decisions`: `id`, `question`, `answer`, `why`, `dropped`, `source: user` and `mismatch`, with `what` (what did not match, one plain sentence in the record's language, both sides named), `chosen` (the choice, in plain words in the record's language), `page` (the page file relative to `.specs-aidlc-turbo/`, the `path` of its row in `sync.yaml`) when a page was one side, and `story` (its id) when the answer changes the story's product-team half (`## For the product team`).
  3. When it does: change that section of the story, reading only that section, and write the same words into that story's `product` in `record.yaml`, which the overview reads.
  4. When the choice says a page gives way: `page_fixes` in that `mismatch`, as `skills/sync/confluence.md` **Page corrections** says. One for the page that was one side, its statement word for word as `from` (grep the page file for the quote, read nothing else of it) and the new text as `to`; and, when item 3 changed the story, one for its story page when the intent has one that states what changed (the row under the intent's `stories/` titled `Story {SSS} - {title}`). Only pages with a row in `sync.yaml`. No question per page: the approval at finish lists them all.

  Then fix or land as the answer says. Nothing leaves the machine now: after the approval at finish, the pages in `page_fixes` are corrected on Confluence and the Jira sync sends every mismatch the build decided, a changed story's new text with a comment on its issue, and a page that was wrong as a comment on the epic.
- **Lessons**: when a finding teaches something every later story needs (a project quirk: a runner flag, a fixture to reset, a file to regenerate), add one line to the brief's `## Lessons`, `- {the rule} (S{SSS})`. Builders started later read it with the brief. Never a detail of one story.

**A story is never committed with an open finding.**

### 5. When the frontier is empty

- **No stories left**: run the `finish` skill. It verifies, reviews the whole intent, fixes, and only then writes the test cases.
- **Stories still running**: wait for them.
- **Nothing running, stories left**: they all wait on a blocked story. Report which story waits on which, and stop.

---

## The only human stops

1. A builder returns `blocked` on a mismatch or a missing requirement, or on the Code Scaffold (a new right, table or module it does not name).
2. A review finds that the story itself asks for what a rule of the project forbids (`story_demands: true`).
3. A story is blocked by the ladder: miss 3, or the debugger's `stop`.
4. `story-land.cjs` stops on a cherry-pick conflict, a second changed-files mismatch, or another error.
5. Story branches only: `story-start.cjs` stops on a merge conflict between dependency branches.
6. `story-mutate.cjs` stops with `restore failed` or an `Error:`.
7. Nothing is running and stories remain.
8. A mismatch from a builder, a review or the debugger, see **Mismatch** in step 4: always asked, and only a story whose code changes with the answer waits.

Only that story waits: the others keep building. Everything else you decide from the brief, the standards or the code.

---

## Output

After every story, one line:

```text
S003 Login with expired password: built (3 files), review pass (round 2), landed 9f2a1c4
```

With story branches the line also names the branch and its target, followed by the merge request's `url`, or its `note` when none opened.

When the loop pauses or ends:

```markdown
## Intent {intent-slug}

| Story | Title | Status | Review | Commit |
| ----- | ----- | ------ | ------ | ------ |
| 001 | Login happy path | done | pass | 4b1d0a2 |
| 002 | Login with expired password | done | pass (round 2) | 9f2a1c4 |
| 003 | Lockout counter | blocked | miss 3 | - |

**Next**: {the next story, the human decision needed, or "run finish"}
```

---

## Never

- Never run two builders in the same tree, and never build one story at a time while the frontier holds more.
- Never claim, stage, commit or cherry-pick by hand, and never mark a story done without `story-land.cjs`.
- Never let a builder commit.
- Never skip a story's reviews, not even for a one-line story, and never one of its lenses. Only a minor-only fix lands without a second review.
- Never run a mutant yourself, never edit a test or a production line to check one: `story-mutate.cjs` does that.
- Never read a story body, the brief body, the standards or the Project Documentation yourself. You write only statuses, `misses`, `D-n` decisions and `## Lessons` lines. A mismatch's answer also goes into `record.yaml` and, when it changes the story, into the story's product-team half, as step 4 says.
- Never settle a mismatch yourself.
- Never add a story inception did not write. New scope goes back to inception as a new intent.

---

## Transitions

- Every story `done` to `.specsmd/aidlc-turbo/skills/construction/finish.md`
- Status question to `.specsmd/aidlc-turbo/skills/construction/status.md`
- Menu to `.specsmd/aidlc-turbo/skills/construction/navigator.md`
