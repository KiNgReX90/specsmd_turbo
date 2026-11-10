# Skill: Git Check

---

## Role

Startup skill. AI-DLC Turbo needs git in both modes, so this runs where the flow first needs it: at
the start of an inception, at construction startup, and in the master's analysis before it routes to
either.

**One question, only when git is missing** - a repository with a commit passes without a word.

---

## Goal

The project root is a git repository with at least one commit, or the user chose to stop.

---

## Input

- `.specs-aidlc-turbo/repo/config.yaml` for `branching.base_branch` (default `main`)

---

## Process

### 1. Check

```bash
git rev-parse --show-toplevel
git rev-parse --verify --quiet HEAD
```

The first prints the project root and the second works: the check is done, go on without saying
anything. The first fails, or prints another folder (the project sits inside another repository, whose
branches the flow must never switch or push): this folder is no repository of its own. Only the second
fails: a repository with no commit yet. Either way, ask.

### 2. Ask

Ask with the host's multiple-choice prompt (on Claude Code: AskUserQuestion), in plain words,
in the language the user speaks in this session. Say in one or two short sentences what is missing
and why: AI-DLC Turbo always works with git, also in sandbox mode, and needs a first commit to build
from. Offer, in this order:

- **Make it a git repository** (recommended)
- **Stop**

**Stop**: say in one line that the flow needs git, and stop. Nothing is written.

### 3. Make the repository and its first commit

1. No repository of its own yet: `git init -b {base_branch}` in the project root. A repository with no commit yet: when
   `git branch --show-current` names another branch than the base branch, run
   `git switch -c {base_branch}` first, so the first commit lands on the base branch.
2. Show the user what the first commit will hold:

   ```bash
   git status --short
   ```

   A file with secrets in it (`.env`, a key file) or a dependency or build folder
   (`node_modules/`, `target/`, `dist/`) goes into a `.gitignore` first, and that `.gitignore` goes
   in the commit.
3. Commit everything:

   ```bash
   git add -A
   git commit -m "chore: start the repository"
   ```

   This first commit is the only place the flow runs `git add -A`. A commit that fails, for example
   because `user.name` or `user.email` is not set, is a stop: show its message.

A repository with no remote works too: the work then stays local, and the finish says so.

---

## Output

Nothing when git was there. Otherwise one line, for example:

```text
Made a git repository on main, first commit 3f2a9c1 (12 files).
```

---

## Transitions

- Back to the step that ran this check, which goes on where it was.
