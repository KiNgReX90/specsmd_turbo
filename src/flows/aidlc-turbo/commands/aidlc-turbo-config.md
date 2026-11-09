---
description: AI-DLC Turbo config - create or update .specs-aidlc-turbo/repo/config.yaml (production or sandbox, the sandbox parts, branching, human tester, Confluence and Jira sync)
---

# AI-DLC Turbo Config

**Command**: `/specsmd-aidlc-turbo-config`

**Paths**: every path in this file is relative to the project root, which is the directory this session was started in, your current working directory. Never resolve one against your home directory.

---

## Purpose

Create or edit `.specs-aidlc-turbo/repo/config.yaml`, the per-project settings the inception and construction agents read. The installer writes this file once with the defaults; this command is the guided way to review or change it later. Every key is optional, so a missing key behaves like its default.

---

## Procedure

This is **display-and-confirm**, not an interrogation. Show the settings in plain language, let the user accept everything in one go, and change only what they name. Never ask about models, effort, or anything else that is not in the file.

1. The old layout: run `node .specsmd/aidlc-turbo/scripts/migrate-layout.cjs` (a dry run: it moves nothing, and it knows every old name). When it prints anything other than `already has the new layout. Nothing to move.`, show that to the user, and after the user agrees run it again with `--write`. Then read `.specsmd/aidlc-turbo/templates/config.example.yaml`. If `.specs-aidlc-turbo/repo/config.yaml` exists, read it too and display the user's current values instead of the defaults.

2. **Show the effective settings**, then ask one question: *"Use these, or adjust?"*

   - **Production or sandbox** -> both use git: an intent branch per intent, every story built in its own worktree, the same reviews, mutants, live test and break test. *production*: once you approve the finished intent, the work is pushed with the link that opens the merge request or pull request. The flow never merges. *sandbox*: production without story branches, and at the end the intent goes straight onto the base branch or into one merge request, as the next setting says. *(default: production)*
   - **At the end of a sandbox intent** (`branching.sandbox_finish`) -> *push*: the finished intent goes straight onto the base branch and is pushed, without a merge request. Without a remote it stays on the local base branch. *merge_request*: the intent branch is pushed with one merge request into the base branch, like production without story branches. *(sandbox only, default: push)*
   - **The parts of a sandbox intent** (the `sandbox` block) -> two switches, each on by default. *code_scaffold*: the Code Scaffold, the drawing of the code the stories build, checked at the approval and saved as `code-scaffold.html`. *scaffold_after_build*: the Code Scaffold updated as built at the end of the intent, saved as `code-scaffold-built.html`; it needs the Code Scaffold. A part that is off is not drawn, rendered, saved or published, and nothing reports it as missing. Production always makes both. *(sandbox only, default: on, on)*
   - **Branch prefix** -> a short project key in front of the branch name, for example `shop` gives `shop/intent-user-auth/intent`. Empty means no prefix. *(both modes, default: empty)*
   - **Base branch** -> the branch every intent starts from and goes back into. Propose the repository's current branch or its default branch. The user may type the name or paste the branch's link (GitLab `.../-/tree/{branch}`, GitHub `.../tree/{branch}`): write the branch name the link ends in. *(both modes, default: `main`)*
   - **A branch per story** -> *yes*: every story gets its own branch with its own merge request, pushed at the end once you approve the intent. A story without dependencies starts from the intent branch and merges into it. A story that depends on another one starts from that story's branch and merges into it. *no*, meant for small pieces of work: every story is committed on the intent branch, which is pushed once at the end. *(production only, default: yes)*
   - **Human tester** -> yes means construction writes a test case for every story a person can verify. No means none is written. *(default: no)*
   - **Mutants per story** -> after a story's reviews a script breaks up to this many lines the story changed, one at a time, and checks that a test turns red each time. 0 turns it off. *(default: 3)*
   - **Documentation sync** -> *Confluence*: the inception asks for the intent's documentation page (default name `{name} - Documentation`), pulls it into `.specs-aidlc-turbo/docs/{inception}/pages/` and the shared project page (default name `Project Documentation`) into `.specs-aidlc-turbo/project/pages/`, resolves every open question in them with the user, and pushes the changed pages back at the approval. Every intent gets its own page: when the inception holds several intents, each gets its own `{intent} - Documentation` page under it with its own `{intent} - Stories` page, after one question that names every page. *Nothing*: intake reads local files only. *(production only, optional, default: Nothing)*
   - **Issue sync** -> *Jira*: after the approval the epic and one issue per story are created; once the whole intent is built the story issues are closed and the test cases added. *Nothing*: no issues. *(production only, optional, default: Nothing)*
   - **Jira project** -> the link to the project board, for example `https://example.atlassian.net/jira/software/projects/SHOP/boards/1`. The agent reads the site and the project key from it; there is no default site. Empty means it is asked at the first sync. A link in `.specs-aidlc-turbo/project/project.yaml` wins over this one. *(only with Jira, default: empty)*
   - **Confluence page names** (`sync.page_names`) -> the names the sync looks for and gives: `intent` (default `{name} - Documentation`), `stories` (default `{name} - Stories`), `project` (default `Project Documentation`), `overview_section` (default `Interactive overview`) and `overview_file` (default `overview-{slug}.html`). `{name}` is the inception's or the intent's name, `{slug}` the intent's folder name. Show them only with Confluence, and never ask them: change one only when the user names it. *(only with Confluence, default: the names above)*

   The live test is no setting: it always runs at the end of an intent, in both modes. How the application starts and where it answers is never asked either: the agent works that out every time.

   Test cases have no folder setting and no language setting: they are written in the record's language, the one the inception was held in. They live in `.specs-aidlc-turbo/docs/{inception}/{intent-slug}/tests/`, next to the intent's brief, and are committed with the rest of the specs.

3. **The tester question is mandatory whenever the mode becomes production.** This overrules the display-and-confirm style above. When this run changes `mode` to `production` - from `sandbox`, or from no config file at all - ask the human-tester question out loud in this same run, with the multiple-choice prompt, even if the user just accepted every setting in one go. Never carry a `tester` value over from the old file or from the defaults in that case, and never leave it at `false` without asking.

   The mode is not changing to production: leave the tester alone unless the user names it.

   **The finish question follows the sandbox mode.** When this run changes `mode` to `sandbox`, ask right after it, with the multiple-choice prompt, what happens at the end of an intent, in the user's language: **Push to the base branch** (recommended, listed first) or **One merge request into the base branch**. Write `push` or `merge_request` as `branching.sandbox_finish`. Also ask it when the user wants to change it.

   **The sandbox parts follow the sandbox mode too.** When this run changes `mode` to `sandbox`, or the file has no `sandbox` block yet in sandbox mode, ask the two in one multiple-choice prompt, in the user's language, each with **Yes** (recommended, listed first) and **No**: the Code Scaffold, and the Code Scaffold updated after the build. Leave the second out when the Code Scaffold is no, and write it `false`. Write the answers as `sandbox.code_scaffold` and `sandbox.scaffold_after_build`. Also ask the one the user wants to change.

4. **The sync questions are asked in production mode only**, with the multiple-choice prompt (on Claude Code: AskUserQuestion), whenever the file has no `sync` block yet, and whenever the user wants to change a sync setting. In sandbox mode they are never asked: both stay `none`. One question for the documentation, one for the issues, both in one prompt:

   - Documentation: **Nothing** (the default, listed first), **Confluence**
   - Issues: **Nothing** (the default, listed first), **Jira**

   The prompt's own free-text answer is how someone names another tool. Any other tool than Confluence or Jira: tell the user, in their language, that it is not supported yet, and write `none` for that setting. With Jira, ask the link to the project board next, as free text; Enter keeps it empty. A link that names no project (no `/projects/{KEY}/`, `/browse/{KEY}` or `projectKey=`): say so and ask again.

5. If the user accepts, write the file as shown. If they want to adjust, change only what they name and keep everything else. The branch prefix and the base branch belong to both modes. Never ask the story-branches question or the sync questions in sandbox mode, nor the finish question or the sandbox parts in production.

6. Write `.specs-aidlc-turbo/repo/config.yaml`. Keep any key that is already in the file and that you did not touch, including keys you do not recognise. Keep the comments from the template.

   The tester block follows the answer, in both directions:

   - **Tester off**: the block is `enabled: false` and nothing else.
   - **Tester on**: the block is `enabled: true` and nothing else.

   Either way, drop a `language` key from an older file (test cases follow the record's language) and a `tests_dir` key (that setting is gone).

   Drop a `live_test` block from an older file: the live test always runs, and the agent works out how the application starts.

   The branching block always has `sandbox_finish`, `push` or `merge_request`, never another value.

   The `sandbox` block is written in sandbox mode only, with `code_scaffold` and `scaffold_after_build`, each `true` or `false`, and `scaffold_after_build` is `false` whenever `code_scaffold` is. Drop a `functional_design` key from an older file: that part is gone. In production mode leave a `sandbox` block of an older file as it is: production ignores it.

   The sync block always has `docs` and `issues`, each `confluence`/`jira` or `none`, never another value; in sandbox mode both are `none`. `jira_project_url` is only written when `issues` is `jira`. A `page_names` block is kept as it is; write one only when the user names a page name to change, with only the names that differ from the defaults.

   Never create a test folder here. Apart from the move in step 1, this command writes this one file, and `tooling.yaml` only through the tooling skill of step 8.

7. Show the final file and say which command to run next: `/specsmd-aidlc-turbo` to route, or `/specsmd-aidlc-turbo-inception` to start an intent.

8. **Code tooling** is not in this file: the language servers, analysis and lint tools live in `.specs-aidlc-turbo/repo/tooling.yaml`. Add one line about them to the settings of step 2: the tool names, `none` when it says `declined`, `not set up` when the file is missing. When the user wants to change them, follow **Change** in `.specsmd/aidlc-turbo/skills/master/tooling.md`, which writes that file through its script.

---

## Notes

- Changing `story_branches` takes effect for the next story that starts. Stories already built keep the branch they were committed on.
- Changing `mode` later does not rewrite history. An approved intent keeps the `mode` snapshot in its brief and keeps its branch.
- Changing `sandbox_finish` takes effect at the next finish of a sandbox intent.
- Changing a sandbox part takes effect at the next step that makes it: the Code Scaffold at the next plan, the update after the build at the next finish. Pages already saved stay as they are.
- Turning the tester off later does not delete test cases that were already written. It does mean no new ones are written and no test folder is created.
- Test cases are written in the record's language. An old `language` key is ignored.
- Present the choices with the host's multiple-choice prompt where one exists (on Claude Code: AskUserQuestion), otherwise a short numbered list.

---

## Routing targets

- **Master**: `/specsmd-aidlc-turbo`
- **Inception**: `/specsmd-aidlc-turbo-inception`

---

## Begin

Read the template and the current config, then show the settings.
