# Skill: Code Tooling

---

## Role

Setup skill. Sets up, together with the user, the code tooling the Turbo agents work with: a
language server per language (on Claude Code a plugin, which the agents reach through the LSP tool:
find references, call hierarchy, implementations), analysis tools and linters that catch errors
before a reviewer has to. The explorers and the cross-checker see far sooner what code already
exists, and the builders, reviewers and debugger catch more, sooner.

Turbo keeps no list of tools. Which tooling fits differs per project, so you propose from what
this project has: its languages, its build tools and the linters it already uses.

The choice lives in `.specs-aidlc-turbo/repo/tooling.yaml`, committed with the repo, also when the
user chooses none: then it is never asked again. A teammate who pulls the branch gets the same
choice, but maybe not the tools themselves: every Turbo start checks this machine.

---

## When

The phase commands run `node .specsmd/aidlc-turbo/scripts/tooling.cjs check` at their start:

- `missing`: no choice yet. **Set up**, below. Right after the first setup this is the same
  conversation.
- `incomplete`: chosen, but this machine lacks a program or a plugin. **Install**, below.
- `invalid`: the file is broken. Say so in one line with the error, and offer **Set up** again.
- `ok` or `declined`: nothing to do. Say nothing about it.

`/specsmd-aidlc-turbo-config` sends the user here to change the choice: **Change**, below.

Once per session: after this skill ran, a later command in the same session does not run it again.

---

## Set up

### 1. Gather the facts

```bash
node .specsmd/aidlc-turbo/scripts/tooling.cjs facts
```

It prints JSON: `extensions` (file extensions and their counts, the biggest first), `build_files`,
`tool_configs` (files that configure a linter or an analyser), `tool_mentions` (lines in the build
and CI files that name one), `language_servers` (the Claude Code plugins with a language server for
an extension this project has, with `plugin_state` and `on_path` for this machine) and `git`.

Read the facts, not the code. When `.specs-aidlc-turbo/repo/repo.yaml` has a `codebase:` block, it
tells you the stack and the build and test commands too.

### 2. Propose

Weigh the languages by their counts: a language with real weight in this repo gets tooling, a
handful of stray files does not. Then, per language:

1. **Language server**: the plugin from `language_servers` for its extensions. There is none for a
   language (no plugin knows its extensions): it gets no language server, and you say so in one
   line, so the user knows the agents grep there. Such a language needs an analysis or lint tool all
   the more: it is the only check the agents get there besides the tests. Weigh it by its own count,
   database code (SQL, PL/SQL, triggers) as much as any other.
2. **What the project already has comes first**: a linter or analyser the project configures (a
   config file in `tool_configs`, a build plugin or a CI job in `tool_mentions`) holds the rules
   the team agreed on and needs no new install. Its run command comes from where it is configured:
   the build plugin's goal, the package script, the CI job's line. A tool that needs a server or a
   licence to run (a SonarQube scan, say) does not run on a developer machine: name it, never
   propose it.
3. **Then the gaps**, from your own knowledge of the language and its build tool: at most two per
   language, only tools that catch errors (bugs, security holes, the language's known pitfalls),
   never a formatter, and only tools that run locally without a server or an account. Prefer what
   the build tool already runs (a build plugin needs no separate install) over a separate program.

For every tool you propose, settle:

- `run`: the command from the code root. When the tool takes a list of files, use `{files}`
  (space separated, quoted) or `{files_comma}` so it judges only the change. Quiet flags, and the
  tool's one-line-per-finding output, `file:line: message` (semgrep `--emacs`, PMD `-f text`,
  checkstyle's plain format): that is how `tooling.cjs run` finds the findings on the change. A tool
  that prints the file once with its findings below it (eslint's default) works too.
- `files`: the globs of the files it judges (`**/*.java`).
- `needs`: the programs it needs on the PATH (`mvn`, `semgrep`), for a language server the program
  its plugin starts (`programs` in the facts).
- `install`: optional, one line on how to get it, when that is not obvious.

Never propose a tool listed under `declined` in an existing `tooling.yaml`: the user turned it down.

### 3. Ask

One multiple-choice prompt (on Claude Code: AskUserQuestion), `multiSelect: true`, at most one
question per kind that has a proposal: **Language servers**, **Analysis**, **Linters**. Header: the
kind. Options: the proposed tools, at most four per question, the strongest first; each label the
tool's name, each description what it gives in one line plus `already in the project` or
`new, to install`. Before the prompt, say in one or two sentences what the tooling is for: the
agents find existing code faster and catch errors sooner. Ask in the user's language.

The user may pick none in every question. Then ask once, plainly: no code tooling at all for this
repo? A yes is the answer `declined`: it is never asked again.

### 4. Write

```bash
node .specsmd/aidlc-turbo/scripts/tooling.cjs write '<json>'
```

The JSON: `status` (`configured`, or `declined` when nothing was chosen), `tools` (every chosen
tool: `name`, `kind` (`language-server`, `analysis` or `lint`), `purpose`, `languages`, and the
fields of step 2; a language server also `plugin` and `extensions` from the facts; `source`
`project` or `added`) and `declined` (the name of every proposal the user did not pick). It prints
`"written": false` with `errors` when the choice is malformed: fix it and write again. Never write
the file by hand.

### 5. Install and prove

Run `check` again. `incomplete`: go to **Install** for what it names.

Then prove every analysis and lint command once: run its `run` by hand on one existing file it
judges (fill in `{files}` yourself), from the project root, quiet. A command that fails on its own
terms (an unknown flag, a missing rule set, no `file:line` in its output) is wrong: fix it and
write the choice again, before step 6. Findings in that file are fine: it is old code. A tool still
missing from this machine is proved on the first machine that has it: say so.

Prove every language server too, and what it does to the repo: note `git status --porcelain`, make
one LSP call on a file it answers for (a big repo takes a minute to load: a timeout means wait and
call again), then compare `git status`. A server that changed or added files in the repo (an IDE's
project files, say, in a repo that keeps its own in git) touches what the team and its IDE use. Put
back exactly what it changed (`git restore` on the changed files, remove only the files it added),
then ask the user, with the number of files and an example path: keep it anyway (the agents still
use it; Turbo never commits those files, and the user's `git status` shows them while a session
runs), or leave it out for this repo. Left out: it goes under `declined` with that reason.

### 6. Tell

Briefly: what the tooling is now, that the file goes into git with the repo so the team shares it,
and that `/specsmd-aidlc-turbo-config` changes it. The next inception commit takes the file along.
When no inception follows in this session (this ran at construction or review-fix), say that the
file is not in git yet and that the next inception commits it, or the user commits it now.

---

## Install

For every entry under `missing` in the `check` output:

- `programs`: a program is not on the PATH. Work out how to install it on this machine: the
  operating system, the package manager the user has (brew, apt, dnf, sdkman, npm, pip, winget,
  scoop), the entry's `install` hint. A build plugin needs no install: its program is the build
  tool.
- `plugin` with `plugin_state`: `not installed` installs with
  `claude plugin install {plugin} --scope user`; `switched off` switches on with
  `claude plugin enable {plugin}`.

Ask once, with the multiple-choice prompt, listing what is missing and the commands: **Install
now** (recommended) or **Skip for this session**. On Install, run the commands one by one. A command
that needs a password (`sudo`) or a window: hand it to the user to run, on Claude Code as
`! {command}`. Then run `check` again and say in one line what is ready.

A plugin that was installed or switched on works from the next session: Claude Code starts its
language server at session start. Say so once, at the end, and go on: without it the agents grep.

Never change `tooling.yaml` here. The choice is the team's: a user who wants a tool gone for
everyone changes it through `/specsmd-aidlc-turbo-config`. A skip is for this session only: the
next start checks again.

---

## Change

From `/specsmd-aidlc-turbo-config`: show the current choice from `tooling.yaml` in a few lines,
then run **Set up** with that choice as the starting point: what is chosen stays chosen unless the
user drops it, and a `declined` tool may be proposed again only when the user asks for it.

---

## Never

- Never write `tooling.yaml` by hand, and never change it outside **Set up** and **Change**.
- Never install anything without the user's yes.
- Never propose a tool you cannot name a run command for, or one that needs a server or a licence.
- Never stop the command that sent you here: after this skill, it continues.
