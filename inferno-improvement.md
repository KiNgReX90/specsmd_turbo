# INFERNO improvement plan: the item review loop converges

Written 2026-11-10 as a handoff. Nothing in this plan is built. Whoever picks it up runs it as section 3 describes. The branch starts at `21e9510b` on `main`.

The plan has one goal. An item's review loop ends when the item meets its contract, and no longer when a reviewer stops looking. Every item keeps its cold review. No package removes a review that judges a blocker or a major finding.

## 1. What was measured

The source is one intent of 28 items on the app repo, built by this flow at version 0.1.81. 18 of its items had at least one recorded review. The numbers are read from the git history of `.specs-inferno/intents/<intent>/reviews/*.yaml` between base `2181a171c` and intent branch commit `a9af3d0ca`. Two consecutive recordings with the same content count once.

| Measure | Value |
| --- | --- |
| Items with a review | 18 |
| Review rounds | 70, so 3.9 per item |
| Rounds per item, sorted | 8, 8, 6, 6, 6, 5, 4, 4, 3, 3, 3, then seven items at 2 |
| Fix rounds | 45 |
| Fix rounds with a blocker or major finding that is not a surviving mutant | 17 |
| Fix rounds that are serious only because a mutant survived | 18 |
| Fix rounds with minor findings only and no survivor | 10 |
| Findings in the first round | 45 |
| Findings in round 2 and later | 75: 3 blocker, 27 major, 45 minor |
| Acceptance criteria of the 18 items | 97 |
| Mutants run | 1201 in 60 rounds, so 12.4 per acceptance criterion |
| Mutants in a first round | 159, of which 157 name a numbered criterion |
| Mutants in round 2 and later | 1042, of which 615 name a criterion in free text |
| Surviving mutants | 76: 31 on a numbered criterion, 45 on a free-text one |
| Largest single round | 94 mutants over 88 criterion texts, on an item with 10 acceptance criteria |
| Commits that grant an item more ownership | 35 |
| Files an item's review lists, first round to last | 12 to 73, 16 to 64, 4 to 51, 7 to 29 |

Token use, from the transcripts of one orchestrator session that covered part of that intent:

| Thread | Cache-read tokens | Notes |
| --- | --- | --- |
| Reviewers | 513M | 19 threads, about 6 dispatches into each |
| Builders | 467M | 20 threads |
| Orchestrator main thread | 390M | 1456 rounds |
| Context per round, reviewer | median 174k, p90 330k, max 467k | a resumed thread never shrinks |
| Context per round, builder | median 191k, p90 382k, max 467k | |

### Why the loop does not converge

1. **The first review is disciplined and the delta reviews are not.** A first review breaks the line each acceptance criterion rests on: 159 mutants for 97 criteria. From round 2 on, the reviewer applies the six checks "to whatever the fix touched", names new criteria in free text and breaks those too. 87% of all mutants run in round 2 or later.
2. **A clean verdict depends on how many mutants the reviewer chooses to run.** About 6% of mutants survive. At that rate a round of 12 mutants is clean about half the time, and a round of 50 about one time in twenty-five. Every survivor is a serious finding, its fix adds a test, and the next round samples the new code again.
3. **The contract grows inside the loop.** Review findings, oracle decisions and ownership grants add behaviour the spec never stated. Each addition is reviewed and mutated like the original work. One item went from 7 listed files to 29 over 8 rounds and is still open.
4. **A resumed reviewer carries everything it ever read.** `run-review.cjs:113` prints `resume` for every delta review, by design (`run-review-warm.test.cjs`). The thread reaches 467k tokens of context, and every round re-sends it.

A reading the numbers do not support: "minor findings keep most loops alive". Only 10 of the 45 fix rounds are minor-only. In one item the round after a minor-only review held a blocker that a second cold reviewer had found. Package P2 is sized and guarded for that.

## 2. Settled before the work starts

- **Reviewers stay.** Every item keeps its cold first review. Every blocker, every major finding and every survivor on an acceptance criterion is re-reviewed until clean. The intent review still reads the whole diff.
- **The flow source is the only place to change.** A host gets the change by a reinstall. Nobody patches an installed copy, because that forks it from `.specsmd/inferno/flow.lock`.
- **A recorded review stays readable.** Every new rule applies to a review file that is being recorded. A file recorded under 0.1.81 parses after the upgrade exactly as before.
- **Both hosts move together.** A change to `agents/reviewer/agent.md` or `agents/orchestrator/agent.md` is ported to the Codex twins under `src/flows/inferno/codex/` in the same package, and measured there before it is trusted (`inferno-future-improvements.md`, item 4).
- **Agent text stays inside its budget.** The pre-commit hook runs the machine's flow-text budget where it is installed. A package that adds a sentence to an agent text removes one of equal weight when the role is near its ceiling.

## 3. Who runs it

**One orchestrator.** One session on Fable 5.2 (`claude-fable-5-2`) at effort xhigh. It owns the order, the worktree, every brief, the check of every returned package, the merges and the release. It reads this file once and the source files each package names. It builds nothing itself.

**Implementers.** Opus 5.5 (`claude-opus-5-5`) at effort high, one package per agent, spawned as plain agents the owner can see and stop one by one. On a host that defines a flow implementer agent, dispatch that agent with the model and the effort set explicitly in the dispatch.

Every brief carries all of this:

- These two lines, verbatim: "You are a principal engineer: decide with confidence what the evidence lets you decide." and "Be proud of the work you deliver: finish it to the bar you would sign."
- The package section of this file, the worktree path and the branch.
- The files the package owns. The implementer edits no other file.
- The tests to write first and the command that runs them. Red first, for the reason the package exists, then green.
- The house bar: 500 lines at most per source file, no em dash or en dash, no secret, no new suppression.
- The result contract: status, changed files, the test command with its result, and at most three sentences. A judgment call with two defensible answers comes back as a question with what was measured. It is never guessed and never parked.

**How a package is accepted.** The orchestrator did not write the code, so its check is cold. It reads the diff against the package's acceptance lines, runs the package's tests itself, and runs the neighbouring test files the package names. A defect goes back to the same implementer while its context is warm.

**Where it runs.** One linked worktree off `main`, one branch for the whole plan. Packages that share a file run in series in that worktree. Read-only packages run beside them. The script tests are `node --test <file>` from `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Run them where the host's machine rules allow a test run.

**Before the merge.** `cd src && npm run validate:all`, then `npm pack`, `evals/install-eval.sh <tarball>` and the e2e smoke harness under `evals/e2e/`, as `CLAUDE.md` describes. Then the version bump and one `CHANGELOG.md` entry.

## 4. Packages

| Id | Package | Kind | Depends on | Shares files with |
| --- | --- | --- | --- | --- |
| P0 | The review-loop readout | new files | none | none |
| P1 | A mutant names an acceptance criterion | script, agent text | P0 | P2 |
| P2 | A minor-only review settles after its correction | script, agent text | P0, P1 | P1, P3 |
| P3 | Fresh against resumed delta reviews | experiment, then script | P0 | P2 |
| P4 | An item's contract does not grow silently | measurement, then design | P0 | none yet |

In the paths below, `S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

### P0. The review-loop readout

**Why.** Every number in section 1 came from throwaway scripts. Without one command, nobody can show that P1 to P3 worked, and the next long loop is again found by hand.

**Change.** A read-only tool, `evals/review-loop/stats.cjs --tree <intent worktree> --base <ref> [--head <ref>]`. It walks the history of each item review file and prints one line per item (rounds, and per round the verdict, the findings by severity, `repeat`, mutants caught and survived, listed files) and one total block with every row of the first table in section 1. A second tool, `evals/review-loop/tokens.cjs --session <transcript dir>`, prints tokens, rounds and context per round by agent type for a Claude Code session with subagent transcripts.

**Files owned.** `evals/review-loop/**` only.

**Tests first.** A fixture repo built the way `S/review-fixture.cjs` builds one: three items, one with a minor-only round, one with a survivor-only round, one with a repeated recording. The test asserts every total.

**Accepted when.** The tool prints the section 1 values on the measured intent at `a9af3d0ca`. A difference is explained in the result, and this file is corrected in the same commit when the tool is right.

### P1. A mutant names an acceptance criterion

**Why.** 18 of 45 fix rounds exist only because a mutant survived. 615 mutants were run on criteria the reviewer named itself. The reviewer text already asks for one break per criterion. Nothing holds a review to it.

**Change.**

1. `S/run-review-file.cjs`, item mode, for a file being recorded: every `mutants[].criterion` is the number of an acceptance criterion of the item spec. Reuse `acceptanceCriteria` from `S/run-mutant-coverage.cjs`. A review file holds at most one mutant per criterion. The refusal names the entry and says what to do instead: break the criterion the behaviour belongs to, or write a finding that a behaviour has no criterion.
2. `agents/reviewer/agent.md`, check 2 and "Delta review", and the Codex reviewer twin: a mutant names its criterion by number. A delta review breaks a criterion again only when its earlier mutant survived, when it had none, or when the range changed the test or the line it rests on. A behaviour with no criterion gets its test read and run, never a mutant.
3. `S/run-review.cjs` `verdictResult`: unchanged. A survivor on a numbered criterion stays a serious finding.

**Files owned.** `S/run-review-file.cjs`, `S/run-mutant-coverage.cjs` for the export, a new `S/run-review-mutants.test.cjs`, `agents/reviewer/agent.md`, `codex/agents/specsmd_inferno_reviewer.toml`, `codex/skills/specsmd-inferno-reviewer/**`.

**Tests first.** A pending review with a free-text mutant criterion is refused. A pending review with two mutants on criterion 2 is refused. A recorded 0.1.81 review with free-text mutants still parses. Criterion 0 and a number past the last criterion are refused. The intent review's `<item>:<n>` form is untouched (`S/run-intent-review.test.cjs` stays green).

**Accepted when.** The tests above are green, with `S/run-review.test.cjs`, `S/run-review-ladder.test.cjs` and `S/run-mutate-batch.test.cjs`.

**What it costs.** 45 of the 76 survivors sat on free-text criteria. Those weak tests would no longer be found by an item review. P4 is the answer to that: behaviour worth a mutant becomes a criterion.

**Expectation.** Up to 18 of 45 fix rounds go, and mutant runs fall by about four fifths. It depends on reviewers moving real breaks onto numbered criteria. P0 measures it on the next intent.

### P2. A minor-only review settles after its correction

**Why.** 10 of 45 fix rounds hold minor findings only. Today each still costs a full delta review, which samples again. `nextActor` already knows the weight (`S/run-review.cjs:69`, `:135`). It only decides who fixes, never whether a review is owed.

**Gate before building.** With P0, replay the 10 minor-only rounds of the measured intent. Build P2 only when at least 8 corrections stayed inside the files their review listed, and no blocker or major finding of a later round sits on a line such a correction wrote. Otherwise drop P2 and say so in this file. Read the counter-case of section 1 first, from its commits. A blocker that sat in the original build would still have reached that second reviewer under P2. A blocker that sat in the correction counts against the gate.

**Change.**

1. A third review state on the ledger, `settled`. `S/run-review.cjs` `step`: when the item's last review is `fix` with weight `minor`, and every path changed since `review_commit` is a file that review lists, the step records `settled` at HEAD through the single writer and prints the integrate call. A correction that touches any other file owes a delta review, as today.
2. `S/state-review.cjs`: the transition that writes `settled` with the hash and the commit, and `refuseUnreviewed` accepts it. `owedReviews` in `S/run-review.cjs` and the two readers in `S/run-frontier.cjs` (`:52`, `:216`) accept it when the hash still matches.
3. `S/run-intent-review.cjs` and `S/run-intent-owed.cjs`: the intent review dispatch lists every settled item with its range and its review file. `S/run-intent-review-file.cjs`: the intent review answers each one under a new `settled` key, `fixed` or `open`, the way it answers scan lines. `open` is a finding with its owner. A clean intent review with an unanswered settled item is refused.
4. `agents/orchestrator/agent.md` integrate step 2, `agents/reviewer/agent.md` intent mode, and the Codex twins.

**Files owned.** `S/run-review.cjs`, `S/state-review.cjs`, `S/state-transition.cjs` and `S/state-cli.cjs` for the new transition, `S/run-frontier.cjs`, `S/run-intent-review.cjs`, `S/run-intent-owed.cjs`, `S/run-intent-review-file.cjs`, a new `S/run-review-settle.test.cjs`, the two agent texts and their twins. Grep every reader of the ledger's `review` field before the first edit, and add any reader this list misses. `S/run-review.test.cjs` stands at 483 lines, so new cases go in the new file.

**Tests first.** A minor-only fix, then a correction inside the listed files: `review --item` records `settled` and prints integrate, with no reviewer dispatch. The same with a new file: a delta review is owed. A fix with one survivor never settles. A `repeat` finding still goes to the oracle. Integrate lands a settled item and refuses it once a listed file changed again. The intent dispatch lists the settled item, and a clean intent review that leaves it unanswered is refused.

**The risk, in numbers.** 20 recorded rounds follow an item's first minor-only round, and 9 of them hold a serious finding. The file guard and the intent review's `settled` answers are what stand between those and the gate. If an intent review ever answers `open` with a blocker on a settled correction, P2 is reverted and the case is added to its tests.

**Expectation.** Up to 10 of 45 fix rounds go. Together with P1 the best case is 2.3 rounds per item, against 3.9.

### P3. Fresh against resumed delta reviews

**Why.** A resumed reviewer is cheaper to brief and costlier to run. The estimate from the transcripts is that fresh delta reviews would have used about a third of the 527M reviewer tokens. That estimate assumes a fresh reviewer stays inside the range, and nobody has shown it. A fresh reviewer that re-reads the whole item would add rounds, which is worse than what it saves.

**Experiment first, read-only.** Take five recorded delta rounds from a host intent, each with its range, its earlier review file and the transcript of the resumed reviewer. Dispatch a fresh reviewer on a detached worktree at the same commit with the exact lines `run.cjs review` printed. Compare tokens with `evals/review-loop/tokens.cjs`, and compare the findings.

**Adopt when.** Tokens per delta review fall by at least 40%, and in at least four of the five the fresh reviewer raises no finding outside the range that the recorded review did not hold.

**Change, only when adopted.** `reviewerLines` in `S/run-review.cjs` prints a fresh dispatch for every review. The record keeps naming the reviewer. `S/run-review-warm.test.cjs` is rewritten to hold the new rule. The "Delta review" paragraph of the reviewer text says the earlier review file is the only memory. Decide the intent review separately, on its own five rounds.

**Files owned.** `S/run-review.cjs` (`reviewerLines` only, after P2 has landed), `S/run-review-warm.test.cjs`, `S/run-printed-calls.test.cjs` where it holds the resume line, the reviewer text and its twin.

### P4. An item's contract does not grow silently

**Why.** 35 ownership grants, and items whose file list grew four to twelve times, say that work the spec never stated is done inside the review loop of an item that cannot close. P1 stops mutating that work. It does not decide where the work belongs.

**Measurement first, read-only.** For the 75 findings of round 2 and later, classify each: on an acceptance criterion, on the bar (ownership, 500 lines, dashes, copy), or beyond the contract. For the 35 grants, record what asked for each: a criterion, a review finding or an oracle decision.

**Build when.** At least 30% of those findings are beyond the contract.

**The design to start from.** A requirement that appears in the loop is written down before it is built. When it fits the item's ownership, it is appended to the spec as a numbered criterion, so P1 gives it a mutant. When it needs a file outside `ownership.editable`, it becomes a new item in the same intent that depends on this one, and the original item closes on its own criteria. A grant is then only ever the answer to an existing criterion. The orchestrator settles the mechanics after the measurement. A call it cannot ground goes up the oracle ladder in `agents/orchestrator/agent.md`.

## 5. Order

1. **First, in parallel.** P0 builds. The P4 classification and the P2 replay start on the throwaway method and are re-run on P0 once it lands. The P3 experiment needs only a host intent and five reviewer dispatches.
2. **Then P1.** It is the largest lever and touches one script file.
3. **Then P2**, if its gate passed. It shares the reviewer text with P1 and `S/run-review.cjs` with P3, so it runs alone.
4. **Then the P3 change**, if adopted.
5. **Then the release**: validate, pack, install eval, e2e smoke, version, changelog, merge.
6. **P4** is built as its own follow-up when its measurement says so.

Expectation for the whole plan without P4: about one working day of agent and machine time. It depends on where the script tests may run and on the P2 and P3 gates.

## 6. Rollout to a host

- One reinstall commit from the released tarball. A session that was running before the reinstall keeps its old agent definitions, so every orchestrator session restarts first (`inferno-future-improvements.md`, item 5).
- An item whose review was recorded before the reinstall keeps that review. The next review of that item follows the new rules.
- A host that adds its own second cold review per item holds it to the same rules: a mutant names a numbered criterion, and only a blocker, a major finding or such a survivor reopens the item.
- A host with one large intent that others wait on can split it by hand today: the open items of one concern move to a successor intent, and the rest ships. The app repo has done this once.

## 7. How we know it worked

Run P0 on the first intent of ten or more items built after the reinstall.

| Measure | Before | Target |
| --- | --- | --- |
| Review rounds per item | 3.9 | 2.5 or lower |
| Highest round count of one item | 8 | 4 or lower |
| Mutants per acceptance criterion | 12.4 | 3 or lower |
| Fix rounds that are serious only through a survivor | 18 of 45 | under one in five |
| Intent review findings of blocker or major weight | measure on the same intent | no rise per item |
| Gate reds per intent | measure on the same intent | no rise |

The last two rows are the quality check. If either rises, the package that caused it is reverted before the next intent starts.

## 8. Not in this plan

- **The plan-time scan rule** (one whole-plan scan with one repair, then a slice scan per item at its dispatch) and three smaller runner fixes are already queued as direct builds in this repo. The intent that is in flight here owns `run-integrate.cjs`, `run-attribute.cjs`, `run-peers.cjs`, `run.cjs` and a new `run-config-record.cjs`. This plan touches none of those files. Let that work land first.
- **The orchestrator's own thread.** 390M tokens at about 267k of context per round is the third largest cost. It is measured here and has no design yet.
- **A split step in the runner.** Splitting a running intent by hand works. A `run.cjs` step for it is worth a plan once a second host needs it.

## Appendix: how the numbers were read

- A round is one recorded version of an item review file. `tree`, `commit` and `reviewer` lines are ignored when two versions are compared.
- A fix round is minor-only when every finding is `minor` and no mutant reads `caught: no`. That is `weightOf` in `S/run-review-file.cjs`.
- A fix round is serious only through a survivor when it has no blocker or major finding whose evidence is something other than a surviving mutant.
- A mutant names a numbered criterion when its `criterion` starts with a number. Everything else is free text.
- Tokens are summed once per API message id. Context per round is input plus cache-read plus cache-creation tokens of that message.
