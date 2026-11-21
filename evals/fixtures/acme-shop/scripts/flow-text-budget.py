#!/usr/bin/env python3
"""Holds the standing text of each INFERNO role in the Acme Shop repository to a word ceiling.

A role's standing text is everything it reads before its first task: its installed flow files
and the charter files of its host (CLAUDE.md for a Claude Code role, the whole AGENTS.md,
managed block included, for a Codex role). Words are split on white space. When a role has
variants (the builder tiers), the largest variant counts.

    flow-text-budget.py --repo <root> [--quiet]

Exits 0 when every role is at or under its ceiling, 1 when one is over, 2 when a file of a
role is missing. --quiet prints only the roles that are over.
"""

import argparse
import sys
from pathlib import Path

CLAUDE = "CLAUDE.md"
AGENTS = "AGENTS.md"
CODEX_SKILLS = ".agents/skills"

# The shop's own charter words: all of CLAUDE.md; the shop's part of AGENTS.md plus the managed
# block at its flow-side ceiling (171) and the block's three-word end marker.
CLAUDE_CHARTER = 762
CODEX_CHARTER = 412 + 171 + 3

# A file the flow-side test does not bound gets its words as shipped plus ten percent, about the
# room that test leaves the orchestrator's agent.md over its text today.
ORCHESTRATOR_COMMAND = 264  # .claude/commands/specsmd-inferno.md, 240 words
CODEX_BUILDER = 1779  # largest builder toml, builder SKILL.md and procedure.md, 1617 words

# Each role: its ceiling, the charter files it reads, and its variants, each a list of flow files.
# A ceiling is what the shop allows: its charter words plus the flow-side ceiling of the same
# files in src/__tests__/unit/inferno/text-budget.test.ts. These numbers move with that test.
ROLES = {
    "claude orchestrator": (CLAUDE_CHARTER + ORCHESTRATOR_COMMAND + 3385, [CLAUDE], [[
        ".claude/commands/specsmd-inferno.md",
        ".specsmd/inferno/agents/orchestrator/agent.md",
    ]]),
    "claude planner": (CLAUDE_CHARTER + 3125, [CLAUDE], [[".claude/agents/specsmd-inferno-planner.md"]]),
    "claude builder": (CLAUDE_CHARTER + 2353, [CLAUDE], [
        [".claude/agents/specsmd-inferno-builder.md"],
        [".claude/agents/specsmd-inferno-builder-cheap.md"],
        [".claude/agents/specsmd-inferno-builder-escalate.md"],
    ]),
    "codex orchestrator": (CODEX_CHARTER + 3406, [AGENTS], [[
        f"{CODEX_SKILLS}/specsmd-inferno/SKILL.md",
        f"{CODEX_SKILLS}/specsmd-inferno/references/procedure.md",
    ]]),
    "codex planner": (CODEX_CHARTER + 2906, [AGENTS], [[
        ".codex/agents/specsmd_inferno_planner.toml",
        f"{CODEX_SKILLS}/specsmd-inferno-planner/SKILL.md",
        f"{CODEX_SKILLS}/specsmd-inferno-planner/references/procedure.md",
    ]]),
    "codex builder": (CODEX_CHARTER + CODEX_BUILDER, [AGENTS], [
        [f".codex/agents/specsmd_inferno_{tier}.toml",
         f"{CODEX_SKILLS}/specsmd-inferno-builder/SKILL.md",
         f"{CODEX_SKILLS}/specsmd-inferno-builder/references/procedure.md"]
        for tier in ("builder_strong", "builder_cheap", "builder_escalate")
    ]),
}


class Missing(Exception):
    pass


def words(repo, rel):
    path = repo / rel
    if not path.is_file():
        raise Missing(rel)
    return len(path.read_text(encoding="utf-8").split())


def measure(repo, charters, variants):
    charter = sum(words(repo, rel) for rel in charters)
    return charter + max(sum(words(repo, rel) for rel in files) for files in variants)


def main(argv):
    parser = argparse.ArgumentParser(description="INFERNO role word ceilings for Acme Shop")
    parser.add_argument("--repo", default=".", help="the repository root")
    parser.add_argument("--quiet", action="store_true", help="print only the roles over their ceiling")
    args = parser.parse_args(argv)
    repo = Path(args.repo).resolve()

    over = 0
    for role, (ceiling, charters, variants) in ROLES.items():
        try:
            size = measure(repo, charters, variants)
        except Missing as missing:
            print(f"{role}: {missing} is missing under {repo}", file=sys.stderr)
            return 2
        if size > ceiling:
            over += 1
            print(f"OVER {role}: {size} words, ceiling {ceiling}")
        elif not args.quiet:
            print(f"OK   {role}: {size} words, ceiling {ceiling}")
    return 1 if over else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
