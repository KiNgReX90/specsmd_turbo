---
description: INFERNO Standards - draft the project's rule files under .specs-inferno/standards/ from CLAUDE.md, AGENTS.md and the files they point at, for the owner to approve
---

# INFERNO Standards

**Command**: `/specsmd-inferno-standards`

Arguments: `$ARGUMENTS`. A topic or a path named here narrows a rerun to it.

The project's rules live in `.specs-inferno/standards/`, one file per topic, and `.specs-inferno/config.yaml` lists each file with the path globs it applies to. The planner reads the folder at start, `run.cjs dispatch-log` prints a `standards` line for every file that applies to a builder's `ownership.editable`, and a review lens judges a change against the files that apply to the paths it changed. A host without the folder runs as before. You draft the folder once, the owner approves it, and from then on it is what the flow reads.

## 1. Read, one batch

Read `CLAUDE.md` and `AGENTS.md` at the root and in every folder that has one, every file they point at for rules, `.specs-inferno/config.yaml`, and `.specs-inferno/standards/` when it exists. A rerun updates that folder: it keeps every rule already there, adds what is new and names each rule whose source line is gone.

## 2. Draft

A rule is a standing instruction about the code, tests or text a builder writes: a size limit, a naming or layout convention, where a test lives, error handling, a forbidden character, a suppression, a secret, reader-facing copy, an architecture boundary. How a session talks to its user, git and release steps, and machine setup are no rules of the work and stay where they are.

- One file per topic, such as `code.md`, `tests.md`, `copy.md` or `architecture.md`. One rule per `##` heading, so a finding can name the file and the heading and the builder reads just that.
- Under each heading: the rule in one or two sentences, then `Source: <file>:<line>` for every line it came from, then `Check: <command>` when the project has a command that checks it. Never invent a command, and never a rule without a source line.
- A rule two sources state differently is drafted once, with both sources, and the difference is a question in step 3.

Then the block, one entry per file with the globs its rules apply to, as narrow as the rules allow, because a builder receives only the files whose globs reach its paths:

```yaml
standards:
  - file: code.md
    paths: ["src/**"]
  - file: copy.md
    paths: ["src/copy/**", "docs/**"]
```

Use `["**"]` only for a rule on every file.

## 3. Show it and ask once

Show every file with its headings, rules, sources and checks, then the block, then each question the sources left open. Ask one question: approve, or adjust. Write nothing before the yes.

## 4. Write

- The files under `.specs-inferno/standards/`.
- The `standards:` block in `.specs-inferno/config.yaml`, replacing any earlier block and keeping every other key and comment. When the file is absent, write the block alone.
- One line in `CLAUDE.md`, and in `AGENTS.md` when it exists, outside any block an installer manages: `The project's rules live in .specs-inferno/standards/.` Remove the rules you moved from those files only when the owner said so in step 3.

Then check what you wrote: `node -e "const s = require(require('path').resolve('.specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run-standards.cjs')); s.standardsFor(process.cwd(), []); console.log(s.readStandards(process.cwd()).map((e) => e.file).join('\n'))"` prints every listed file, and refuses a file the block lists that does not exist.

## Report

The files written, the number of rules in each, the rules that have a check, and the open questions the owner answered. Then stop: commit nothing and start nothing.
