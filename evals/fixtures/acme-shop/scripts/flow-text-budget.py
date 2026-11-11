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

# Each role: its ceiling, the charter files it reads, and its variants, each a list of flow files.
# A ceiling sits forty to fifty words above the role's text as the flow ships it, so a release
# that grows one role by a hundred words is refused here before a host meets it.
ROLES = {
    "claude orchestrator": (4030, [CLAUDE], [[
        ".claude/commands/specsmd-inferno.md",
        ".specsmd/inferno/agents/orchestrator/agent.md",
    ]]),
    "claude planner": (3870, [CLAUDE], [[".claude/agents/specsmd-inferno-planner.md"]]),
    "claude builder": (3080, [CLAUDE], [
        [".claude/agents/specsmd-inferno-builder.md"],
        [".claude/agents/specsmd-inferno-builder-cheap.md"],
        [".claude/agents/specsmd-inferno-builder-escalate.md"],
    ]),
    "codex orchestrator": (3880, [AGENTS], [[
        f"{CODEX_SKILLS}/specsmd-inferno/SKILL.md",
        f"{CODEX_SKILLS}/specsmd-inferno/references/procedure.md",
    ]]),
    "codex planner": (3470, [AGENTS], [[
        ".codex/agents/specsmd_inferno_planner.toml",
        f"{CODEX_SKILLS}/specsmd-inferno-planner/SKILL.md",
        f"{CODEX_SKILLS}/specsmd-inferno-planner/references/procedure.md",
    ]]),
    "codex builder": (2250, [AGENTS], [
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
