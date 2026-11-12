# INFERNO, future improvements

Written 2026-09-18, after planning one intent statement on the app repo with the old and the new planner text, on Opus 5 (Claude) and gpt-5.6-sol (Codex). Each item says what to change, why, and the measurement that proves it worked.

## Where we are

| Run | Model rounds | Shell calls | Output tokens | Wall | Plan |
| --- | --- | --- | --- | --- | --- |
| Opus 5, old text | 148 | 179 | 146k | 36.0 min | 10 items, missed the company sync at confirm |
| Opus 5, old text, rerun | 152 | 182 | 147k | 33.5 min | 12 items, clean |
| Opus 5, new text | 109 | 143 | 124k | 27.4 min | 10 items, missed the company sync at confirm |
| Sol, old text | 53 | 229 | 36k | 13.1 min | 7 items, clean |
| Sol, new text | 92 | 359 | 54k | 20.3 min | 8 items, one wrong count, one compaction |

The new text shipped for Claude in canonical, the app repo and the docs repo: read a subsystem per round, grep the callers of a reused write, and no comment block in the work-item manifest. Codex took only the callers sentence.

## 1. Thinner work items

The planner keeps writing what a builder cannot get alone: the files to read, the pattern to copy, the tests the change reaches, the editable ownership, the ordering, the settled decisions and the proof command. It stops writing prose that explains what the code does. A builder opens every file its item names before it edits, so that prose is read twice today.

Unmeasured risk: builders may search longer. Proof: plan one intent both ways, build both, and compare builder rounds, output tokens, wall time and red integrate steps per item. Adopt it only when the builder cost rises less than the planner cost falls.

## 2. A script catches the missed wrapper, not a sentence

The company sync at confirm was missed in two of three Opus runs, whatever the planner text said. The planner body is also at its word ceiling (4488 of 4500 in the app repo), so the next rule has to be a check. Give a work item an optional `writes:` list of the functions its change writes through, like `reads:`. `run.cjs frontier` greps each one's callers and prints every caller file the item does not cite as a `candidate` line, the way it prints missed tests.

Proof: in the app repo, the committed plan of `an-agent-drafts-answers-and-the-maker-confirms-them-once` cites `save_round` in its store item. The check stays quiet on that plan, and prints the file that holds `save_round` once that citation is removed.

## 3. A repeatable planner A/B eval

The table above was built by hand from session transcripts. Put it in `evals/`: one command plans a fixed statement at a fixed repo commit on both hosts, two runs per arm, and prints rounds, shell calls, output tokens, wall time, item count and the frontier result. Two runs per arm is the minimum, because the same Opus text gave 10 items once and 12 the next time.

Counting notes. Claude usage sits on each API message, and one message spans several transcript lines, so count each message id once. Codex batches several shell commands into one call, so count the subcommands as well as the calls.

## 4. Measure a prose change on each host before porting it

"Read a subsystem per round" cut Opus 5 by about a fifth and made Sol about half again more expensive, because Codex already batches its reads. A change to one host's planner text is measured on the other host before it is ported. The canonical keeps `agents/planner/agent.md` and the Codex `procedure.md` as separate texts for this reason.

## 5. A flow update does not reach a running Claude session

Claude Code reads `.claude/agents/*.md` when a session starts. A subagent spawned later in that session still gets the old definition. Evals and the first run after an install need a fresh session, and the installer should print one line saying so.

## 6. Bring the docs repo back onto the canonical scripts

Canonical and the app repo share one module split of the orchestrator scripts, ported on 2026-09-14: `run-integrate`, `run-probes`, `run-proofs`, `run-owner`, `run-e2e-impact`, `run-error`, `state-block` and `state-lists`. the docs repo split the same scripts its own way on 2026-09-10 and 11: `run-dispatch`, `run-processes`, `run-proof` and `state-store`, each with its own tests. Until they converge, every flow change is ported twice by hand.

Port what the the docs repo modules do that canonical lacks, reinstall the docs repo from canonical, and run its flow suites. Its Codex install needs the same pass: the planner Codex loads there is an untracked `.codex/agents/specsmd-inferno-planner.toml`, beside an older tracked copy under `.codex/skills/`.

## 7. The config step proposes the tools that fit the host's stack, per role

AI-DLC Turbo analyses a host's tooling at the start (`src/flows/aidlc-turbo/skills/master/tooling.md`). INFERNO's config step asks for model tiers, delivery and verification and never asks which tools the roles should have. On the app repo that left four kinds of file with no check at all, measured on 2026-11-11: 83 shell scripts, 7 workflows, 177 Python files and 1584 `.mjs` files, among them the lane and the tester that cost the host most of its red gates that week. Every role searched with grep and then read whole files.

The config step reads the stack (file kinds by count, the manifests, what is already installed) and proposes, for the owner to accept per line:

- **Search for the reading roles** (planner, scanner, the reviewers): a structural search for the host's languages, and the host's own reference tool where it has one. One line in `dispatch.constraints`.
- **A lint per kind of file, chosen by scope.** Each accepted lint becomes a scoped check in `verification.integrate`, so an item that touches such a file meets the check and no agent has to remember it. Findings a file already has become a count that may fall and never rise.
- **What it deliberately does not propose**, with the measured reason, so the owner sees the trade: on the app repo a language server per agent was refused because the main machine had 3 GB of memory free.
- **One list of tools and versions** the host installs from on every machine it runs on, and a line when a machine lacks one.

The app repo's accepted set is the worked example: ast-grep for search and for its own rules, shellcheck, actionlint, ruff, `tsc --checkJs` over its scripts, and cargo-nextest after one measured run. Its owner accepted all of them on 2026-11-11.

## 8. Integrate's checks take one slot together, or run beside each other

`run.cjs integrate` runs the commands of `verification.integrate` one after the other (`run-integrate.cjs:264`). On a host that sends every check to another machine through a wrapper, each command syncs the tree again and waits in that machine's queue again.

Measured on the app repo on 2026-11-11, one item's integrate with eight orchestrators on two test machines: 990, 1021, 1218, 1416 and 1661 seconds for its five commands, 105 minutes in all. The same morning, with an empty queue, four of those commands ran in 319, 437, 746 and 126 seconds. So well over half of the 105 minutes was queue and sync, paid five times.

- **One slot for the whole integrate.** A host key beside `mutate.session`, with the same open, run and close, so the tree is synced once and the queue is waited in once, and the five commands run back to back. Each command keeps its own proof, keyed as today.
- **Or the commands run beside each other** when the host says they may, each on the machine its wrapper picks. Wall time is then the longest command. This helps only while machines are free, so the one slot is the first to build.
- **The gate's finalize commands** have the same shape and take the same key.
