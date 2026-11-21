# Handoff: the Claude installer puts every INFERNO role in `.claude/commands/` as well as `.claude/agents/`, so every session lists each role twice and nobody types the role commands

Row 0az. Met on the first host on 2026-11-21 by its session `skoft-cra-6e` on Alpha, on the build at `a8873ebb`; the tip `02533b18` installs the same.

## What is wrong

1. **The split exists for one flow only.** `ClaudeInstaller.js` sends a file whose frontmatter has `name:` to `.claude/agents/` only and every other file to `.claude/commands/` only, but just for `SPLIT_FLOWS = ['aidlc-turbo']` (`src/lib/installers/ClaudeInstaller.js:11`, `:42-45`, `:101`). INFERNO installs every file of `src/flows/inferno/commands/` as both (`:52-57`).
2. **So each role is a command too.** The eight files with `name:` (builder, builder-cheap, builder-escalate, oracle, planner, reviewer, reviewer-quality, scanner; the planner's command is already replaced by `claude/commands/inferno-planner.md`) land in `.claude/commands/` beside `.claude/agents/`. Every session's context lists each one twice, once as an agent type and once as a skill, with its full description. And `inferno.md` and `inferno-config.md`, which have no `name:`, land in `.claude/agents/` where no agent is read from them.

## Evidence

- The host's `.claude/commands/` on Alpha, 2026-11-21: `specsmd-inferno-builder.md`, `-builder-cheap.md`, `-builder-escalate.md`, `-oracle.md`, `-planner.md`, `-reviewer.md`, `-reviewer-quality.md`, `-scanner.md`, beside `specsmd-inferno.md`, `-config.md`, `-intents.md`, `-standards.md`.
- A session on the host lists `specsmd-inferno-builder`, `-builder-cheap`, `-builder-escalate`, `-oracle`, `-planner`, `-reviewer`, `-reviewer-quality` and `-scanner` both among its agent types and among its skills (this inferno-manager's own context, 2026-11-21).
- No text in `src/` and no skill on the host calls a role as a command (`git grep` over `src/` for `/specsmd-inferno-<role>` and `commands/specsmd-inferno-<role>`, and the same over `~/.claude/skills`: no hit).
- The session's FLOW line, verbatim: "FLOW every role is installed twice: each INFERNO role sits in .claude/agents/ and again in .claude/commands/ (builder, builder-cheap, builder-escalate, reviewer, reviewer-quality, scanner, oracle among them), so every session's context lists each role twice. Nobody types the role commands. Flow fix: install as commands only the ones a person invokes (specsmd-inferno, planner, config, intents, standards)."

## How to fix

1. **INFERNO is a split flow.** Add `inferno` to `SPLIT_FLOWS` (`src/lib/installers/ClaudeInstaller.js:11`). The roles then go to `.claude/agents/` only, and `inferno.md` and `inferno-config.md` to `.claude/commands/` only, with `intents`, `standards` and the planner launcher from `claude/commands/` as today.
2. **A reinstall removes what the old split left.** The install transaction (`src/lib/install/transaction.js`) removes `.claude/commands/specsmd-inferno-<role>.md` for each role with `name:`, and `.claude/agents/specsmd-inferno.md` and `-config.md`, when an earlier install wrote them.

Tests, beside the installer tests:

- An INFERNO install into an empty host writes each role to `.claude/agents/` and not to `.claude/commands/`, and `specsmd-inferno.md` and `-config.md` to `.claude/commands/` only.
- A reinstall over a host that holds the old doubled files leaves only those.

## Which part is the flow and which the host

All of it is the flow's. Nothing here is for the builder of the row on the host's side.

## Until it is built

Nothing for sessions: the doubled list costs context, not a wrong result. A host must not delete the role commands by hand, since the next install writes them again.
