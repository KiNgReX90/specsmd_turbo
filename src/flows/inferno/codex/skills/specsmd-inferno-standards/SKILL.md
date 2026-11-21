---
name: specsmd-inferno-standards
description: Draft the project's INFERNO rule files under .specs-inferno/standards/ from AGENTS.md, CLAUDE.md and the files they point at, and list them in .specs-inferno/config.codex.yaml once the owner approves. Use for the one-time standards setup of a host, or to update it after the instruction files changed.
---

# specsmd Inferno Standards

Run this setup in the parent conversation. Spawn no agent: the owner's approval is part of it.

The project's rules live in `.specs-inferno/standards/`, one file per topic, and the host config lists each file with the path globs it applies to. The planner reads the folder at start, `run.cjs dispatch-log` prints a `standards` line for every file that applies to a builder's `ownership.editable`, and a review lens judges a change against the files that apply to the paths it changed. A host without the folder runs as before.

## Required workflow

1. Read, in one batch: `AGENTS.md` and `CLAUDE.md` at the root and in every folder that has one, every file they point at for rules, `.specs-inferno/config.codex.yaml`, and `.specs-inferno/standards/` when it exists. A rerun keeps every rule already there, adds what is new and names each rule whose source line is gone.
2. Draft the rules. A rule is a standing instruction about the code, tests or text a builder writes: a size limit, a naming or layout convention, where a test lives, error handling, a forbidden character, a suppression, a secret, reader-facing copy, an architecture boundary. How a session talks to its user, git and release steps, and machine setup are no rules of the work.
   - One file per topic, such as `code.md`, `tests.md`, `copy.md` or `architecture.md`, and one rule per `##` heading, so a finding can name the file and the heading.
   - Under each heading: the rule in one or two sentences, `Source: <file>:<line>` for every line it came from, and `Check: <command>` when the project has a command that checks it. Never invent a command, and never a rule without a source line.
   - A rule two sources state differently is drafted once, with both sources, and the difference is a question in step 3.
3. Draft the block, one entry per file with the globs its rules apply to, as narrow as the rules allow, because a builder receives only the files whose globs reach its paths. Use `["**"]` only for a rule on every file.

   ```yaml
   standards:
     - file: code.md
       paths: ["src/**"]
     - file: copy.md
       paths: ["src/copy/**", "docs/**"]
   ```

4. Show every file with its headings, rules, sources and checks, then the block, then each open question. Ask one question: approve, or adjust. Write nothing before the yes.
5. On the yes, write the files under `.specs-inferno/standards/` and the `standards:` block in `.specs-inferno/config.codex.yaml`, replacing any earlier block and keeping every other key and comment. Add one line to `AGENTS.md`, outside the specsmd managed block: `The project's rules live in .specs-inferno/standards/.` Never edit `CLAUDE.md` or `.specs-inferno/config.yaml`, which belong to another host. Remove rules you moved from `AGENTS.md` only when the owner said so in step 4.
6. Check what you wrote: `node -e "const s = require(require('path').resolve('.specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run-standards.cjs')); const c = { config: '.specs-inferno/config.codex.yaml' }; s.standardsFor(process.cwd(), [], c); console.log(s.readStandards(process.cwd(), c).map((e) => e.file).join('\n'))"` prints every listed file, and refuses a file the block lists that does not exist.

Report the files written, the number of rules in each, the rules that have a check, and the questions the owner answered. Commit nothing and start nothing.
