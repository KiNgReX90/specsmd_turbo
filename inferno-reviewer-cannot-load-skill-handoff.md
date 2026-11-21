# Handoff: the contract and quality reviewers have no Skill tool, so a review of what a skill governs never loads that skill, while the builder it judges does

Row 0ay. Met on the first host on 2026-11-21 by its session `skoft-cra-6e` on Alpha, on the build at `a8873ebb`; the tip `02533b18` ships the same agent texts.

## What is wrong

1. **The reviewers cannot invoke a skill.** `src/flows/inferno/commands/inferno-reviewer.md:4` and `inferno-reviewer-quality.md:4` give `tools: Read, Grep, Glob, Bash, Write`; the builders have `Skill` (`inferno-builder.md:4`). The installed copies on the host are the same (`.claude/agents/specsmd-inferno-reviewer.md` and `-quality.md`, read 2026-11-21).
2. **So the review is held to a lower bar than the build.** A host whose rule for reader-facing copy is a skill gets builders that load it and reviewers that judge their copy without it. The quality reviewer walks each `standards` file rule by rule (`inferno-reviewer-quality.md:44`), but a standard that says "apply skill X" reaches it only as a sentence, and the contract reviewer gets no standards at all.

## Evidence

- The session's FLOW line, verbatim: "FLOW reviewers cannot load a skill: specsmd-inferno-reviewer and specsmd-inferno-reviewer-quality have tools Read, Grep, Glob, Bash, Write and no Skill, so the cold review of reader-facing copy never applies writing-for-the-reader. Measured over Alpha's transcripts since 2026-09-10: 616 reviewer runs, 0 loaded the skill, 41 opened its file by path, while 183 builder runs loaded it. Host workaround being built on branch direct/copy-floor: a rule in .specs-inferno/standards/copy.md that sends the reviewer to the skill file by path. Flow fix: give the reviewers the Skill tool, or have the reviewer read the skill files a standard names."
- The `tools:` lines above, read on the tip and in the host's install on Alpha, 2026-11-21.

## How to fix

1. **Both reviewers get `Skill`.** Add it to the `tools:` line of `inferno-reviewer.md` and `inferno-reviewer-quality.md`, and to the Codex skill copies where a host there has the same tool.
2. **The review procedure says when to load one.** One rule in each: a `standards` file, the brief or the item spec that names a skill for the changed paths is loaded with the Skill tool before those paths are judged, and a finding against it names the skill and its rule. The contract reviewer's dispatch carries the same `standards` lines the quality reviewer's does when a standard names a skill.
3. **A skill loaded by a reviewer changes no write rule.** The reviewers still write only their review file.

Tests, beside `src/__tests__/unit/inferno/inferno-flow.test.ts`:

- Both installed reviewer agents list `Skill` in `tools:`.
- Each reviewer text holds the rule that loads a skill a standard names before judging the paths it covers.

## Which part is the flow and which the host

The tools and the procedure are the flow's. The host's standard that names the skill (`.specs-inferno/standards/copy.md` on `direct/copy-floor`) stays the host's, and it works today by path.

## Until it is built

On the host: a standard that a reviewer must apply names the skill file by its path (`~/.claude/skills/<name>/SKILL.md` or the project's), so the reviewer reads it with `Read`.
