# Skill: Finish

---

## Role

Close one intent. Every story is `done`, so this is the last gate before the work leaves the machine: the full verification, the live test, the break test, one fresh-eyes review of the whole intent, every finding fixed in the code, then the test cases against the running application, the brief closed, the overview page, the user's approval, and only then the push with the merge requests and Jira with their links, and the application stopped. Nothing leaves the machine before that approval. A finding is fixed, not filed: no review, live-test or break-test document is left behind.

**No checkpoint**, except the approval of step 8, the human stops of the ladder and the ones named below.

---

## Goal

Hand back a finished intent with evidence: the verification passed, the live test, the break test and the intent review left nothing open, the user approved it, and its branches are pushed with their merge requests or pull requests open, or, in sandbox mode with `push`, the intent is on the base branch. Kept local on the user's word: committed, and nothing pushed.

---

## Input

- **Required**: the intent slug, and `intent-status.cjs {intent} --json` with every story `done`
- **Required**: `.specs-aidlc-turbo/repo/config.yaml` (mode, branching, tester, sync) with its `sandbox` block in sandbox mode, and the `codebase` block of `.specs-aidlc-turbo/repo/repo.yaml`

Refuse to run while any story is not `done`: say which ones are open and go back to `dispatch`. `{intent_dir}` is `.specs-aidlc-turbo/docs/{inception}/{intent}/`, with `inception` from the status JSON; every story's path is its `file` in that JSON.

Sandbox mode runs every step below as production mode without story branches. Only step 9 differs: `branching.sandbox_finish` says whether the intent goes straight onto the base branch (`push`, the default) or gets one merge request (`merge_request`). **Story branches** below means `branching.story_branches: true` in production mode; sandbox mode never has them.

---

## Process

### 0. Integration branch (story branches only)

Skip this step unless story branches are on. With story branches, no single branch holds every story yet: they sit on their own branches until a human merges them. Verification and the intent review need them together, so build a local branch that has them all:

1. Swap the last part of the intent branch, `intent`, for `verify`, and create it from the intent branch: `git switch -c shop/intent-user-auth/verify shop/intent-user-auth/intent`. When it exists from an earlier run, delete it first with `git branch -D`. It is yours, local only, never pushed.
2. Merge every story's `branch` into it, in build order, with `git merge --no-ff`. A branch already contained in an earlier one merges as a no-op, which is fine.
3. A conflict is a human stop: `git merge --abort`, and tell the user which two stories touch the same lines. Their merge requests will conflict the same way.

Steps 1 to 6 run on this branch. The landed story files are already on it, since `story-land.cjs` committed them on the intent branch, and the uncommitted brief rides along.

### 1. Full verification

```bash
node .specsmd/aidlc-turbo/scripts/story-verify.cjs {intent} intent --code-root {project root}
```

It runs every command of the brief's `## Verification`, in order, on the integrated tree, and writes `{intent_dir}/proof/intent.json`. `FAIL` is a `blocker` finding for the fix loop of step 5, on the story the failing test belongs to. Never push a red tree.

### 2. Live test

**The live test always runs**, in sandbox mode as in production: an intent is finished only once it was tried on the running application. An old `live_test.enabled` in the config is ignored. Dispatch `specsmd-aidlc-turbo-live-tester` in the foreground with `mode: test`, the absolute project root, the brief path and the path of every story. It follows `.specsmd/aidlc-turbo/skills/construction/live-test.md`, and the application it starts **stays running for the rest of finish**. Record the `pid` it returns: that is the process step 11 stops, and no other.

- `verdict: pass`: go on to step 3.
- `verdict: fail`: run the live-test fix round below, then go on to step 3.
- `verdict: not_run`: the application did not start or no browser was available. Never close with that open. Show the user the reason and the last startup lines, and ask once how the application starts or where it answers. Pass the answer to the live tester and run it again. When the user decides this intent cannot be tested live, record that as a `D-n` in the brief, and only then go on.

Once the application answered, write the `start_command` and `url` the live tester really used into a top-level `live_test:` block of `.specs-aidlc-turbo/repo/repo.yaml`, changing nothing else, so the next intent tries that first. Never into `config.yaml`: how the application runs is the agent's to work out, not a setting.

**The live-test fix round.** Every failed check is a `blocker` finding for its story and goes through the fix loop of step 5. The story lens's delta review gets the failed checks as its previous verdict. When every failed story is fixed, run the full verification again, then the live tester again with `app` (its `pid`, `url` and `start_command`): it restarts the application on the fixed code and reruns every check. A check that fails again is that story's next miss.

### 3. Break test

Skip this step for a quick-lane intent (`brief.lane: quick`), and when no story has `break_test: true` in the status JSON: inception marked a story for it only when a user puts something in or changes something through it. Skip it too when the user decided in step 2 that the intent cannot be tested live, and say so in the summary.

Dispatch `specsmd-aidlc-turbo-breaker` in the foreground with `mode: attack`, the absolute project root, the `url` of the application that runs since step 2, the brief path, the path of every story with `break_test: true`, and the live tester's seed scripts for those stories. It follows `.specsmd/aidlc-turbo/skills/construction/break-test.md`: at most 10 attacks per story, from the outside, never reading the code.

- `verdict: pass`: go on to step 4.
- `verdict: fail`: run the break-test fix round below, then go on to step 4.
- `verdict: not_run`: the `url` did not answer. Have the live tester restart the application (`mode: start` with `app`) and dispatch the breaker once more. Still `not_run`: the same human stop as a live test that did not run.

**The break-test fix round.** Every failed attack is a finding with its `severity` for its story, through the fix loop of step 5. The story lens's delta review gets the failed attacks as its previous verdict. When every failed story is fixed, run the full verification again, have the live tester restart the application (`mode: start` with `app`), then dispatch the breaker again with `mode: recheck` and only the attacks that failed. An attack that fails again is that story's next miss, so the ladder ends it: the debugger at the second miss, the human at the third.

The breaker's `notes` are not findings. Show them in the summary and fix nothing for them.

### 4. Intent review

Dispatch `specsmd-aidlc-turbo-intent-reviewer` with `scope: intent`, `mode: full`, the absolute project root, the brief path (its `## Story map` is the requirement coverage table), `{intent_dir}/proof/intent.json`, one verdict line per story (`S002 pass, round 2, 1 major fixed`; `landed earlier` for a story from an earlier session), `shared_files` from `intent-status.cjs`, and the diff command:

```bash
git diff {base_branch}...HEAD -- . ':!.specs-aidlc-turbo'
```

A quick-lane intent (`brief.lane: quick`) adds `coverage_only: true`: its stories were reviewed one by one, so only the requirement coverage of the whole is left to check, now that both stories are in the tree.

Hosts without subagents: follow `review.md` inline with `scope: intent`. It returns findings, each with its `story`, and writes no file.

### 5. Fix loop

Every finding of finish goes through the ladder of `dispatch` step 4, story by story: a red verification, a failed live check, a failed attack, an intent-review finding, a code defect behind a failed twin. What differs at finish:

- The code root is the project tree, and fixes run one at a time. A finding that spans stories, or belongs to none, goes to the story nearest to it: say so in the prompt.
- A finding that shows the story, the brief or a page is wrong, not the code (an intent-review or delta finding with `mismatch: true`, a live check or an attack with `mismatch`, a failed twin whose story is wrong) is no miss and goes to no builder as it is: ask it as `dispatch` step 4 **Mismatch** says, record the answer there, then fix the code or land the changed story as the answer says.
- After a fix, the full verification of step 1 replaces `story-verify.cjs`.
- The delta review goes back to the reviewers that own the finding: the intent reviewer for its own findings, the story's reviewers (`specsmd-aidlc-turbo-reviewer`, every lens as in `dispatch` step 3.5) for a red verification, a failed live check, a failed attack or a twin defect, with the failure as the story lens's previous verdict. The `quality` and `docs` lenses also check every fix of an intent-review finding. A lens with nothing to recheck gets `verdict: pass` with no findings as its previous verdict, so it judges only the fix hunks. The `docs` lenses take `project_docs` from `intent-status.cjs --json`.
- A fix that passes is committed on its story, and only the fix: the story's earlier files are committed already. The set is the builder's `fix_files`. **Fix commits never carry a twin**: the twins of step 6 ride only in the commits of step 9, on the intent branch. First `git status --porcelain -uall -- . ':!.specs-aidlc-turbo'` in the code root, leaving out the twins (`{codebase.playwright_test_dir}/aidlc-twins/`), must list exactly `fix_files`, and no path in `fix_files` may lie under `aidlc-twins/`: when either fails, the same rule as a `story-land.cjs` mismatch. Commit those paths only, so nothing else that sits in the index goes along. Never `git add -A`.

  ```bash
  git add -- {fix files}
  git commit -m "fix({intent-slug}): {what was wrong} (S{SSS})" -- {fix files}
  ```

- With story branches, a fix lands on the story's own branch, never on the integration branch, and the project tree stays on the integration branch: its uncommitted story files, brief and proof differ from the story branch and would make a `git switch` refuse. Give the fix its own worktree instead, `git worktree add {tmp}/{intent}-fix-S{SSS} {story branch}`: that worktree is the fix's code root, while the story path stays the file in the project tree. Commit the fix there as above (`git -C {fix worktree} ...`). Then carry it forward in that same worktree: for every story branch that stacks on it or merges it in, on down the line in build order, `git -C {fix worktree} switch {that branch}` and `git -C {fix worktree} merge --no-ff {fixed branch}`. Nothing is pushed here: step 9 pushes every branch once the user approved. Remove the worktree with `git worktree remove {fix worktree}`. Rebuild the integration branch as in step 0 before you verify again: switch the project tree to the intent branch first, and the uncommitted files under `.specs-aidlc-turbo/` come along, since no story branch changes them. In step 6, or after **Change first** in step 8, first `git restore` every twin that the integration branch tracks and the writer changed, or the switch can refuse: every writer runs again after the fix anyway.
- A code fix after the application started: the live tester restarts it (`mode: start` with `app`) before anything uses it again.

**The intent never closes with an open finding**, and findings are never written to a file.

### 6. Test cases

**Read `tester.enabled` before anything else in this step.** It is false, or absent: skip the whole step, create no folder, dispatch nothing, and note in the summary that no test cases were requested.

Test cases are written last, on purpose. Only now is every story built, the live test and the break test passed, the intent reviewed and every finding fixed, so the screens, labels, messages and routes in the code are the ones the tester will really see.

1. **The application**: the writers never start it. It runs since step 2. No application runs, because the user decided in step 2 that the intent cannot be tested live: the writers get `url: none`, write the twins and leave them `not_run`.
2. **Dispatch** one `specsmd-aidlc-turbo-test-writer` per story with `tester_verifiable: true`, all in the same turn, at most 8 at a time, with story branches on the integration branch. Each gets the absolute project root, the story path, the brief path, the paths of the other stories of the intent (for the regression trace), the `url`, and the live tester's seed script for that story when there is one. Its prompt carries this reading budget, verbatim:

   ```text
   Budget: at most 12 tool calls for reading the story's own code, for its labels, routes and messages.
   Grep before you read, and scope every grep to a path or a file type.
   Read line ranges only. Never read a whole file over 200 lines.
   Never list or walk a directory tree.
   Never read a file you have already read.
   Never spawn a subagent of your own.
   Stop reading the story's own code as soon as you have every label, route and message the steps need.
   The regression trace has no call limit: grep only, scoped to a path or a file type, never a directory walk, never a whole file, never a file read twice.
   It ends when every changed name is followed to a place a tester can check, or to a dead end.
   ```

   The 12 calls bound the reading of the story's own code, never the regression trace and never the writing. The outputs are disjoint, one test case and at most one twin per story, so the writers never collide. Hosts without subagents: follow `.specsmd/aidlc-turbo/skills/construction/test-cases.md` inline, one story at a time.
3. **Collect**: per story the test case path, the twin path, `twin_result`, `no_twin` and `regression`.
4. **Mirror**: every story with `tester_verifiable: true` has exactly one file under `{intent_dir}/tests/`. Dispatch a writer again when its file is missing, or when its result:
   - has `twin: null` and an empty `no_twin`: a story without a twin always says why, above all one with a `ui` criterion, or, for a story without `observed_via`, a screen in its criteria text;
   - has a `regression` place with neither `steps` nor `covered_by`;
   - has a `covered_by` that names a story without a test case.
5. **Twins**: a `not_run` twin is normal only when no twin was written, or there is no application on purpose (`url: none`). An `unreachable` twin means the application fell over during finish: have the live tester restart it once (`mode: start` with `app`), record the new `pid` as in step 2, and dispatch the writers of those stories again with the new `url`, to run their twins. Still `unreachable`: a human stop. Show the reason and the last startup lines, and ask one question: **I started the application, try again** (run those twins again) or **Finish without these test cases in Jira**. The second leaves their `twin_result: unreachable`, records which test cases are not proven as a `D-n` in the brief, and names them in the summary: the Jira sync skips them. A test case whose twin never reached the application never goes to Jira. A `failed` twin is never left open. Decide which it is:
   - a defect in the twin: that writer fixes it and runs it again, at most twice. Still failing: a human stop, answered by a fix or a `D-n` in the brief.
   - a real defect in the code: a `blocker` finding for that story, through the fix loop of step 5. Then every writer runs again, as item 6 says.
   - the story itself is wrong: the code does what the brief, another story or the Project Documentation says, and the criterion says otherwise. A mismatch, asked as the fix loop of step 5 says; then that writer runs again on the answer.
6. **After any code fix in this step**, a failed twin that was a code defect or anything else that changed code after the test cases were written: once the live tester has restarted the application on the fixed code, dispatch **every** writer again, not only the one whose twin failed. A fix in shared code can change what another story's screens show. Each updates its test case when a label or a message changed and runs its twin again. Collect, mirror and judge their results again, as in items 3 to 5.
7. Delete the live tester's seed scripts.

### 7. Close the brief

Set `brief.status: done` and `completed` to the real current date, read from the machine with `date -u +%Y-%m-%d`, never from memory. The brief rides in the commit of step 9.

Add `built` to the brief's frontmatter: one or two plain sentences in the record's language on what the intent built, taken from the **Built** lines of every story's build notes, with what came in under **Outside the Code Scaffold**. First what a user notices, no file names. Write it on one line in double quotes. The overview page leads with it after the build, so it says what was built, never the plan.

### 8. Overview and approval

```bash
node .specsmd/aidlc-turbo/scripts/intent-overview.cjs {intent} --phase construction --no-open
```

It rewrites `{intent_dir}/overview.html` from the record, the stories and the test cases. Never write or edit that page by hand. It is the page the user approved at the inception, now built: **Functional**, **Code** (the Code Scaffold as approved, its flows played step by step from each start, with where the build deviated) and **Review** when the build changed files (every changed file with its change, and per part what the build notes say was built and where it deviated), plus **C4 model** when the record has one. The summary under the title leads with the brief's `built`; **Details** shows the plain texts of the intent and the stories, **?** the page's own explanations and how to read each tab. An intent built without a drawing opens on Review, any other on Code.

The user sees it as the artifact, as at the approval of the inception: publish and open it as `.specsmd/aidlc-turbo/skills/inception/review.md` step 2 says, when this session has an Artifact tool. Read `overview.html` in full, publish it with the Artifact tool to the link in `docs/{inception}/sync.yaml` under `overview.{intent-slug}.artifact`, so the intent keeps one link (a session that has not published it yet reads it first with `action: read`; no link yet: publish a new one with icon `map` and write its link there), with as description one sentence in the record's language such as `Overview of the built intent Log in with a code, for approval.`, then open that link in the browser with `node .specsmd/aidlc-turbo/scripts/open-browser.cjs {artifact link}`, always, also when the host shows the artifact itself. No Artifact tool, or the publish fails or is refused: run the script again without `--no-open`, so the file opens in the browser, and name in one line why there is no artifact. When the browser cannot be opened either, the script still writes the file: name the path in the summary.

When the intent has a Code Scaffold, the page shows it as approved, never updated to match the code, with where the build deviated from it and why, taken from every story's build notes. The script then prints one line in the record's language, in English `Code Scaffold: built as planned` or `Code Scaffold: {n} different from the design, {m} added`, with `, {k} not built or used` after it when parts of it were not built or not used: keep it verbatim for the summary. No such line: leave it out.

In sandbox mode with `sandbox.scaffold_after_build: false` (or `sandbox.code_scaffold: false`), the Code Scaffold gets no update after the build: the page shows the drawing as approved, or no drawing at all, and the script prints no such line. That is no gap: nothing reports it, and the next paragraph is skipped.

**The Code Scaffold as built.** When the intent has a Code Scaffold and its update after the build is on (always in production), save it next to the specs:

```bash
node .specsmd/aidlc-turbo/scripts/intent-overview.cjs {intent} --phase construction --scaffold --no-open
```

It writes `{intent_dir}/code-scaffold-built.html`, the page after the build opening on the Code Scaffold, the technical view. It never writes `code-scaffold.html`: the scaffold the inception saved stays as it was approved. Without a Code Scaffold, or with the update off, it writes nothing and says so. Publish it to the same artifact link as the inception's scaffold page, so that link gets a new version: read `code-scaffold-built.html` in full, publish it to the link in `sync.yaml` under `overview.{intent-slug}.scaffold` (a session that has not published it yet reads it first with `action: read`; no link yet: publish a new one with icon `code` and write its link there), with as description one sentence in the user's language that says it is the Code Scaffold as built, then open that link in the browser with `open-browser.cjs`. No Artifact tool, or the publish fails or is refused: run the script again without `--no-open`, so the file opens in the browser, and name in one line why there is no artifact.

**The approval**, in both modes. Nothing has left the machine yet: no branch is pushed, no merge request is open, the base branch is untouched, Jira and Confluence are untouched. Ask once, with the host's multiple-choice prompt (on Claude Code: AskUserQuestion), otherwise a numbered list, with the options named in the session language (the names below are the English ones). Name the artifact link (or the page's path), and the application's `url` while it runs, so the user can try it first.

**The page corrections** go in the same prompt, never a question per page: every `page_fixes` entry of a decision in `record.yaml` whose id is not in `confluence.fixed` of `sync.yaml` yet, grouped per page, as `skills/sync/confluence.md` **Page corrections** says, a large one with its new text. When a mismatch of this build changed a story's text add one line that the overview on the intent's own page (`sync.page_names.overview_file`, default `overview-{intent-slug}.html`) gets the new text. Only when `sync.docs` is `confluence` and Confluence is not `skipped`; otherwise name the corrections in one line as not sent.

- **Approve, push to remote**, the suggestion: step 9 pushes every branch and opens the merge requests (in sandbox mode with `push`: puts the intent onto the base branch), step 10 corrects the pages and updates Jira.
- **Approve, without the page corrections**, only when there is a page correction: the same as the first, but step 10 corrects no page, and the Jira sync says each page was not corrected. The overview on the intent's own page still gets the new story text. The corrections stay in the record: **Finish again** offers them again.
- **Change first**: ask what has to change, unless the answer says it already. Build nothing yet. Weigh each change as `.specsmd/aidlc-turbo/skills/inception/review.md` step 4 says: taken without a discussion when it holds, said once with your proposal when it does not, discussed further only when the user asks. A change no story of the intent covers is new work: say it belongs in a new intent, and ask again. A change to a page correction is no finding: change its `page_fixes` entry in the record and ask again. **Plan it first, as at the inception**, before any code changes: route every agreed change through the table of `.specsmd/aidlc-turbo/skills/inception/review.md` step 4, with the lint and `.specsmd/aidlc-turbo/skills/inception/cross-check.md`, so the record, the brief, the stories and the Code Scaffold hold the new plan. A decision the user took is a new `D-n` with `source: user`. The Code Scaffold shows what will be built: draw the change into it as `.specsmd/aidlc-turbo/skills/inception/plan.md` step 4c says, never the state of the build. A story the change touches stays `done`: the fix loop below builds it. Then render the page again. It stays the page of the build, with Review of what was built, and only its drawings show the plan with the change, without the marks of the build over them:

  ```bash
  node .specsmd/aidlc-turbo/scripts/intent-overview.cjs {intent} --phase construction --plan --no-open
  ```

  Publish it to the same link and open it in the browser with `open-browser.cjs`. Name what was planned, one line each, and ask with the multiple-choice prompt: **Build the changes**, **Change something else** (weigh and note it the same way, render again with `--plan`, then this question again) or **Never mind** (take the noted changes out of the record, render again without `--plan`, then the approval of this step again). **Only on Build the changes**, or words that plainly say build: each change is a `blocker` finding for the story it concerns, through the fix loop of step 5. A change the user asks for is not a miss: only a failed delta review of its fix counts on the ladder. Then, when `tester.enabled` is true, item 6 of step 6, then this step again: the new page and the same question.
- **Questions about the code**: the user asks what they want to know about the code that was built. Answer each question from the code itself (the diff against the base branch, and the files it names) and the specs, with the file and lines, never from memory, until the user is done. Then ask this question again. A question is answered, never acted on: only when the user then asks for a change does it go as **Change first**.

A remark the user types instead of picking an option goes as **Change first**: it is never a go to build, nor to push.

Any other answer that declines the push, such as `don't push` or `keep it local`, keeps it local: step 9 commits but pushes nothing, step 10 does not run. The summary says nothing left the machine, and that **Finish again** asks again.

### 9. Ship

Production mode, and sandbox mode with `branching.sandbox_finish: merge_request`. Items 1 to 3 commit locally; item 4 and on run only when the user approved in step 8. Kept local: stop after item 3.

1. Stage what is left: the brief, the story files that changed since they landed (a fix note, a twin note, a mismatch answer), `record.yaml` when a mismatch answer changed it, the overview page, `code-scaffold-built.html` when step 8 wrote it, `{intent_dir}/proof/`, the `sync.yaml` and `.specs-aidlc-turbo/repo/repo.yaml` (the `live_test` block of step 2) when they changed, and, when `tester.enabled` is true, `{intent_dir}/tests/` and every `twin` path the test cases name that is in the tree, not only the new ones. Name the paths, never `git add -A`.
2. Commit: `docs({intent-slug}): close the intent`. Skip the commit when nothing is left to stage.
3. **Twins on the intent branch**, when `tester.enabled` is true. Check every `twin` path a test case names: `git cat-file -e {intent branch}:{twin}`. One that is missing: when a story branch of this intent has it (`git cat-file -e {story branch}:{twin}`, the branch of its own story first), write that exact blob into the tree, `git show {story branch}:{twin} > {twin}`, so a later merge of the story branch does not conflict, and stage it. Commit what you staged: `docs({intent-slug}): carry the twins`. A twin that no branch holds: a human stop. Name the test case and the path it names.
4. Push every branch and open the merge requests: `node .specsmd/aidlc-turbo/scripts/push-branch.cjs {intent} --all`. It pushes the intent branch from the brief and opens its merge request into `branching.base_branch` (the remote's default branch when that is empty), then, with story branches, every story branch in build order with its merge request into the story it builds on, else into the intent branch: on GitLab in the same push, on GitHub with `gh`. It prints `{ branch, push, merge_request: { into, url, note }, stories }`; each entry of `stories` has `story`, `branch`, `push` and `merge_request`, or `skipped` for a story branch the intent branch holds already. It refuses while a test case names a twin the intent branch does not hold: nothing is pushed at all, and its `missing_twins` lists each `twin` with `on`, the story branches that hold it. Carry those as in 3 and run it again.
5. Keep every `url` with its target for the summary, and **show no merge request to the user yet**. A user who sees one merges it, while step 10 and the descriptions still have to land: a merge before that leaves the pages, Jira, the links on the overview and the description out, and a pipeline may pack and remove the specs at the merge. No `url`: show the `note` and every line of `push.lines` verbatim, and name it in the summary; never construct a link yourself. A failed push (exit 1) is a human stop.
6. The flow never merges. Merging is the user's call.

With story branches, step 9 runs on the intent branch, which carries only the specs. **Before the switch**, bring every twin a story branch tracks up to the version that ran. A story built before builders stopped writing twins tracks its twin on its own branch, and so does the integration branch: the switch refuses to drop that twin while the writer's change to it is in the tree. Take every `twin` path that the integration branch tracks and the writer changed (`git diff --quiet HEAD -- {twin}` fails). When a story branch holds it (`git cat-file -e {story branch}:{twin}`, the branch of its own story first) and is not merged into the intent branch yet (`git merge-base --is-ancestor {story branch} {intent branch}` fails), give the twin its own worktree on that branch, as for a fix in step 5: `git worktree add {tmp}/{intent}-twin-S{SSS} {story branch}`. Copy the twin from the project tree into it, commit only that file there (`test({intent-slug}): the twin that ran`), and remove the worktree. Then, when the intent branch does not hold the twin, `git restore {twin}` in the project tree, so the switch goes through: item 3 carries that same blob onto the intent branch. The twin that ran ships, and the story's merge request does not conflict on it. A twin the intent branch holds already stays as the writer left it: the change comes along and is committed as in 1 and 2.

Now switch to the intent branch; the test cases, the twins, the brief, the overview and the proof files are uncommitted and come along. Commit them there as in 1 and 2, then check the twins there as in 3. After the approval, push as in 4 and keep every merge request with its target for the summary as in 5: `--all` takes every story branch along, with the fixes and the twin commits finish made on it. Then delete the integration branch with `git branch -D`. It was never pushed.

Sandbox mode with `push`, the default (`branching.sandbox_finish` missing or `push`), puts the intent straight onto the base branch, without a merge request. That is the one place the flow puts work on the base branch itself: the user chose it.

1. Items 1 to 3 above: stage, commit, the twins on the intent branch. Kept local in step 8: stop here.
2. Only after the approval: `node .specsmd/aidlc-turbo/scripts/push-branch.cjs {intent}`. It checks the twins as in 4, then pushes the intent branch onto the base branch (`branching.base_branch`, else the remote's default branch), a plain push, never `--force`, and moves the local base branch along when it can. It prints `{ branch, into, push: { ok, lines, local_only }, merge_request: null, pushed_to_base: true, commit, note }` and writes only `pushed_to_base` into the brief: the commit is in its output, never in the brief. Keep `commit` for step 10 and the summary.
3. `base_moved: true` (exit 1): the base branch has commits the intent branch lacks, and nothing was pushed. Merge them in: `git merge --no-ff origin/{base}`, or the local `{base}` when there is no remote. A conflict is a human stop: `git merge --abort`, and name the conflicting files. Otherwise run step 1, the full verification, again; a red tree goes through the fix loop of step 5. Commit the new proof, `{intent_dir}/proof/`, as `docs({intent-slug}): verify on the moved base`. Then run `push-branch.cjs {intent}` once more. A second `base_moved` is a human stop.
4. Show `commit` and `into`, and a `note` verbatim: the local base branch was left where it was. With `push.local_only: true` say plainly that this repository has no remote: the work is only on the local base branch, and nothing was pushed. A refused push (exit 1 with `push`) is a human stop: show every line of `push.lines`. An exit 1 with only `error`, without `base_moved` or `push` (the fetch failed, no base branch, no intent branch, or without a remote the local base could not move), is a human stop: show the `error`.

### 10. Jira

**The pages first**, only after the approval and the push of step 9, and before the Jira sync, so its comments can say what became of each page:

1. **Page corrections**: when the user picked **Approve, push to remote**, `sync.docs` is `confluence`, Confluence is not `skipped`, and a decision in `record.yaml` has `page_fixes` while its id is not in `confluence.fixed`: dispatch `specsmd-aidlc-turbo-sync` with `.specsmd/aidlc-turbo/skills/sync/confluence.md`, the intent slug, the inception slug and mode `resolve` with `fixes_only: true`, then mode `push`. Handle their results as `.specsmd/aidlc-turbo/agents/inception-agent.md` says under Subagents (`needs_input`, `no_tools`, `stale`). After a push that returns `documentation_pushed: true` or `intent_pages_pushed`, put the `Interactive overview` section back as `skills/inception/review.md` step 5 item 4 does. Name every `not_fixed` and `not_synced` in the summary: `/specsmd-aidlc-turbo-inception --skill sync {intent-slug}` sends a push that did not go through.
2. **The overview**: when a decision has a `mismatch` with a `story`, the overview step 8 rendered shows what was corrected. Upload it to the intent's own page as `skills/inception/review.md` step 5 item 5 does, under the same name: `node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs upload --intent {intent-slug} --file {intent_dir}/overview.html`, without `--name`, so the script names it as `sync.page_names.overview_file` says (default `overview-{intent-slug}.html`). A failed upload is not a stop: add the slug to `pending_upload` under `confluence:` and name its `detail`.

Then Jira, only after the approval and the push of step 9, so the merge requests are open and their links are in the frontmatter (`merge_request` in every story file with story branches, and in the brief). In sandbox mode with `push` there is no merge request: the brief holds `pushed_to_base` instead. When `sync.issues` is `jira`, dispatch `specsmd-aidlc-turbo-sync` with the skill file `.specsmd/aidlc-turbo/skills/sync/jira.md`, the intent slug, the inception slug and the mode `after-build`, plus in sandbox mode with `push` the `commit` that `push-branch.cjs` printed: every story issue gets a comment with what was built and the link to its merge request (with `pushed_to_base`: the base branch and the commit) and is closed, the epic gets a comment with the link to the intent's merge request or the same base branch and commit, the test cases are added, and every mismatch the build decided reaches Jira: a story whose text changed gets its new text and a comment, a page that was wrong a comment on the epic that says whether the page was corrected. It updates `.specs-aidlc-turbo/docs/{inception}/sync.yaml` and returns that skill's result block; show its one line. It cannot ask the user: `needs_input` means you ask `ask.question` with `ask.options` and dispatch the same step again with `answer`. `no_tools` or Jira cannot be reached: dispatch again with `answer: later`, so it is recorded as pending, name it in the summary, and the intent still closes.

In both modes, with or without Jira: the push wrote the merge requests, or `pushed_to_base`, into the brief and, with story branches, into the story files, and the sync changed `sync.yaml`. Put the merge requests on the overview the user approved: `node .specsmd/aidlc-turbo/scripts/overview-links.cjs {intent}`. It writes them into the page's data in `overview.html` without rendering it again, so its Review tab leads from every file to its change in the merge request, and the changes stay as they were approved; never run `intent-overview.cjs` here, on the intent branch with story branches the changes would be gone. In sandbox mode with `push` there is no merge request, and the page stays as it is. When step 8 published the overview as an artifact, publish the file again to that same link, without opening it. Stage those when they changed, the overview among them, with the page files the pages step changed, naming the paths, commit `docs({intent-slug}): record the merge request and the Jira sync`, and push again with `push-branch.cjs {intent}`. A merge request is already open; this push only adds the commit to it. In sandbox mode with `push`, it fast-forwards the base branch again; its `commit` is the one the summary shows, and a `base_moved` or an `error` there goes as in step 9.

Then the descriptions: follow `.specsmd/aidlc-turbo/skills/construction/mr-description.md` for the intent's merge request and for every story merge request in the frontmatter. It writes a description that is still the one line the push sent; in one whose branch moved since it was written it adjusts only the sections the change makes wrong, and leaves the rest as it was. Keep its one line per merge request for the summary.

### 11. Stop the application

In every mode, **stop the application**: exactly the `pid` recorded in step 2 or 6, and its children, then check that its port is free. Never `pkill`, `killall`, `fuser -k` or anything that picks processes by name, pattern or port. When finish stops for the human and the run ends there, stop it first as well.

### 12. Summary

Print the table below. It is the only thing the user reads after a long run, and the only place the review, the live test and the break test are reported, so keep it to facts.

It is also the first place the user sees a merge request, and its last line tells them whether they can merge. Print it only after step 10 and the descriptions are done, and end it with exactly one of these:

- Everything of step 10 went through: the pages corrected or none to correct, the Jira sync done or not used, the merge requests on the overview, every description written, updated or unchanged. End with `**All done, you can merge.**`; with story branches add the order: `First the story merge requests from top to bottom, then the intent branch.` A description that kept its one line because there is no `GITLAB_TOKEN` is named above it, and does not hold the merge back.
- Something of step 10 is still open: a page `not_fixed` or `not_synced`, a `pending_upload`, a Jira sync recorded as pending, a description that failed. End with `**Do not merge yet**: {what is open, in a few words}. {the rerun that sends it}, then merge.`
- Sandbox mode with `push`: there is nothing to merge. End with `**All done.** The intent is on {base}.`, anything still open named above it.
- Kept local: no such line. The branch section says it was not pushed.

These closing lines are said in the session language; the ones above are the English ones.

---

## Finish again

The user knows it as **Finish again**, named in the session language. It finishes a `done` intent once more, before a human merges it, so that every test case is proven: a twin that did not run or did not pass, a twin the intent branch lacks, a live test that could not be proven.

### When it applies

In both modes, for a `done` intent whose intent branch (the brief's `branch`) is not on the base branch yet: not merged, or in sandbox mode with `push` not pushed onto it. The base branch is `branching.base_branch`, or the remote's default branch when that is empty. Tell it with:

```bash
git fetch origin {base branch}
git merge-base --is-ancestor {intent branch} origin/{base branch}
```

No remote: leave out the fetch and check against the local `{base branch}`. Exit 1: not on the base branch yet, the intent can be finished again. Exit 0: it is there, the intent is finished for good. A `done` brief without a `branch` was built by the old sandbox mode, before it used git: it is finished for good.

A test case is **not proven** when it names a `twin` whose `twin_result` is not `passed`, or a `twin` the intent branch does not hold (`git cat-file -e {intent branch}:{twin}` fails). An intent is **not pushed yet** when the brief has no `merge_request` and no `pushed_to_base`: it was kept local in step 8, or its merge request did not open. The construction navigator and the master agent offer **Finish again** for every intent it applies to, and make it the suggestion when one of its test cases is not proven or it is not pushed yet.

### What it runs

The working tree must be clean outside `.specs-aidlc-turbo/`, as for the build loop. Switch the project tree to the intent branch and bring it up to date with `git pull --ff-only` when it has an upstream: a story merge request may have been merged into it since. An intent kept local has none, and neither has the intent branch in sandbox mode with `push`: skip the pull there. Then run the steps of the process above, in this order:

1. Step 0 with story branches, then step 1, the full verification.
2. Step 2, the live test, with its fix round.
3. Steps 3 and 4 only for code a fix changes, through the delta reviews of the fix loop of step 5: no new break test and no new review of the whole intent.
4. Step 6, with every test case rewritten and every twin run.
5. The brief: every `D-n` an earlier finish wrote about a test case or a live test that could not be proven, and that this run settled, gets the note `Superseded on {YYYY-MM-DD}: {what this run proved}.` appended to its line after one space, with the date read from the machine (`date -u +%Y-%m-%d`). Such a line is never deleted and never renumbered. For example:

   ```markdown
   - **D-7**: The test case of Lockout counter goes to Jira without a proven twin: the application did not answer. Superseded on 2026-10-05: its twin passed against the running application.
   ```

   Step 7 does not run: the brief stays `done`.
6. Step 8, the overview, the Code Scaffold as built when it is on, and the approval.
7. Step 9, with the commit `docs({intent-slug}): finish again` in place of the close commit, and after the approval the push: a branch whose merge request is open only gets the new commits, and an intent kept local the first time gets its merge requests now. In sandbox mode with `push`, step 9 puts the intent onto the base branch as there. The twins are brought up to the version that ran on the story branches not merged yet, then checked and carried as there. A story branch merged into the intent branch since needs no twin commit: the intent branch tracks its twin, and the change rides in the finish again commit.
8. Step 10, the pages first as there, then the Jira sync dispatched as there with mode `after-build` and `tests_only: true` (when the brief has no `merge_request` and no `pushed_to_base`, the intent was not pushed yet and never had its `after-build`: dispatch it without `tests_only`): the sync updates every test-case sub-task and creates the missing ones, sends a mismatch this run decided, and makes no other story comment, no transition and no other epic comment, since the first finish made those. Then the descriptions, as at the end of step 10: in the merge requests whose branch moved they adjust only what the change touches.
9. Step 11, stop the application.
10. Step 12, the summary, which also names every decision this run superseded, by what it says.

---

## Output

```markdown
## Intent complete: user-auth

| Story | Title | Review | Commit |
| ----- | ----- | ------ | ------ |
| 001 | Login happy path | pass | 4b1d0a2 |
| 002 | Login with expired password | pass (round 2) | 9f2a1c4 |
| 003 | Lockout counter | pass | c70e881 |

### Verification

| Command | Result |
| ------- | ------ |
| `mvn -q -DskipTests package` | ok |
| `mvn -q test` | 214 passed |

### Intent review

**Verdict**: pass after one fix. 1 major fixed in 002 (expired password returned 200), 1 minor fixed in 001.

### Live test

**Verdict**: pass after one fix. 6 checks passed, 1 not observable. The change-password form in 002 answered 500 on the first run and was fixed.

Leave this section out when the live test did not run.

### Break test

**Verdict**: pass after one fix. 14 attacks on 002 and 003, 1 failed: submitting the change-password form twice saved the password twice, fixed in 002. Noted, not fixed: the lockout message does not say how long the lock lasts.

Leave this section out when the break test did not run, or say in one line why it was skipped when a story had `break_test: true`.

### Mismatches

- Login with expired password said three attempts, the page Login and the code five. Chosen: five, the story was changed.
- The page Architecture names the table GIFT_CARD_LEDGER, the code GIFT_CARD_LEDGERS. Chosen: the code is right. Page corrected on Confluence.

One line per mismatch the build decided, in the session language: its `what`, `Chosen: {chosen}`, and for a page what became of it: `Page corrected on Confluence.`, `Page not corrected, at your request.`, or `Correction ready, not on Confluence yet.` with the sync rerun that sends it. Leave this section out when there was none.

### Test cases

| Story | Test case | Twin | Twin run | Regression |
| ----- | --------- | ---- | -------- | ---------- |
| 002 | US-002 - Login with expired password | yes | passed | 4 |
| 003 | US-003 - Lockout counter | no | not run | 0 |

### Overview

{artifact link}, opened in the browser. Without an artifact: `.specs-aidlc-turbo/docs/user-auth/user-auth/overview.html`.

Code Scaffold: 1 different from the design, 2 added

Code Scaffold as built: {artifact link}, opened in the browser. Without an artifact: `.specs-aidlc-turbo/docs/user-auth/user-auth/code-scaffold-built.html`.

The `Code Scaffold: ...` line is the one step 8 printed, verbatim, under the overview path. Leave it out when step 8 printed none, and leave out the `Code Scaffold as built` line when step 8 saved no such page.

### Branch

`shop/intent-user-auth/intent` pushed to origin. Merge request into `main`: {merge_request.url}

**All done, you can merge.**
```

With story branches, the branch section lists every story branch with its target, then the intent branch:

```markdown
### Branches

| Story | Branch | Merge request into | Merge request |
| ----- | ------ | ------------------ | ------------- |
| 001 | `shop/intent-user-auth/story-001-login-happy-path` | `shop/intent-user-auth/intent` | {url} |
| 002 | `shop/intent-user-auth/story-002-login-expired-password` | `shop/intent-user-auth/story-001-login-happy-path` | {url} |
| 003 | `shop/intent-user-auth/story-003-lockout-counter` | `shop/intent-user-auth/intent` | {url} |

`shop/intent-user-auth/intent` pushed to origin. Merge request into `main`: {url}, to merge once the stories are merged into it.

**All done, you can merge.** First the story merge requests from top to bottom, then the intent branch.
```

Sandbox mode with `merge_request`: the same summary. Sandbox mode with `push`: the branch section says where the intent went:

```markdown
### Branch

`{intent branch}` pushed onto `{base}` at `{sha}`.
```

Without a remote it says: `{intent branch}` is only on the local `{base}` branch: this repository has no remote.

Kept local: the branch section says `Not pushed: kept local on the user's word. **Finish again** asks again.`, with the branches by name and no merge requests.

---

## Never

- Never write test cases before the intent review and every fix are done. They describe the finished code, nothing earlier.
- Never create `{intent_dir}/tests/` when `tester.enabled` is false. No tester means no folder.
- Never push, open a merge request, correct a page or write to Jira before the user approved the intent in step 8.
- Never build or fix a change the user asked for before it is noted, shown on the overview again and the user said **Build the changes** in step 8.
- Never push a tree whose verification did not pass.
- Never merge a merge request, and never write a link that `push-branch.cjs` did not print.
- Never show a merge request before the summary of step 12, and never end it with `All done, you can merge` while something of step 10 is open. Only `push-branch.cjs` puts an intent on the base branch, in sandbox mode with `push`, and never with `--force`.
- Never close the brief while a story is not `done`.
- Never close with anything open: no unfixed finding, no failed twin, no twin that could not reach the application, no failed attack, no live test that did not run, unless the user decided it and the decision is in the brief.
- Never settle a mismatch yourself, and never fix the code or the story to one side of it before the user chose.
- Never send a test case to Jira whose twin could not reach the application.
- Never skip the live test, and never run the breaker on a quick-lane intent.
- Never stage with `git add -A`.
- Never write or publish over `code-scaffold.html`: after the build only `code-scaffold-built.html` is written, and the artifact gets a new version.
- Never leave a review, live-test or break-test document behind, and never commit one. Findings are fixed in the code and reported in the summary.
- Never push the integration branch, and never commit a fix on it.
- Never commit a twin on a story branch or in a fix commit, except the commit of step 9 that brings a twin a story branch already tracks up to the version that ran.
- Never push an intent branch without every twin its test cases name.
- Never stop a process finish did not start, and never leave the one it started running.

---

## Transitions

- Done to `.specsmd/aidlc-turbo/skills/construction/navigator.md`, or to `/specsmd-aidlc-turbo-inception` for the next intent
- A human stop of the ladder, then back to the step that raised the finding
- **Finish again**, from the navigator or the master agent, for a `done` intent that is not merged yet: to `## Finish again` above
