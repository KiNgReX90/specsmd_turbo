# INFERNO improvement plan: Turbo's build loop, INFERNO's autonomy

Written 2026-11-10 as a handoff. Nothing in this plan is built. Whoever picks it up runs it as section 4 describes.

The goal: INFERNO becomes the faster sibling of AI-DLC Turbo, with the same quality of output. It takes over the parts of Turbo's build loop that are both stricter and cheaper than its own, and the parts of Turbo's planning that make a spec complete before a builder starts. It keeps what it does better: no human stop, and a caught mutant for every acceptance criterion. Turbo takes two fixes from INFERNO in return.

Every item keeps its cold review. No package removes a review that judges a blocker or a major finding.

## 1. What was measured on INFERNO

The source is one intent of 28 items on the app repo, built by INFERNO 0.1.81. 18 of its items had at least one recorded review. The numbers are read from the git history of `.specs-inferno/intents/<intent>/reviews/*.yaml` between base `2181a171c` and intent branch commit `a9af3d0ca`. Two consecutive recordings with the same content count once.

| Measure | Value |
| --- | --- |
| Review rounds | 70 over 18 items, so 3.9 per item |
| Rounds per item, sorted | 8, 8, 6, 6, 6, 5, 4, 4, 3, 3, 3, then seven items at 2 |
| Fix rounds | 45 |
| Fix rounds with a blocker or major finding that is not a surviving mutant | 17 |
| Fix rounds that are serious only because a mutant survived | 18 |
| Fix rounds with minor findings only and no survivor | 10 |
| Findings in round 2 and later | 75: 3 blocker, 27 major, 45 minor |
| Acceptance criteria of the 18 items | 97 |
| Mutants run | 1201 in 60 rounds, so 12.4 per acceptance criterion |
| Mutants in a first round | 159, of which 157 name a numbered criterion |
| Mutants in round 2 and later | 1042, of which 615 name a criterion in free text |
| Surviving mutants | 76: 31 on a numbered criterion, 45 on a free-text one |
| Largest single round | 94 mutants, on an item with 10 acceptance criteria |
| Commits that grant an item more ownership | 35 |
| Files an item's review lists, first round to last | 12 to 73, 16 to 64, 4 to 51, 7 to 29 |
| Reviewer threads in one orchestrator session | 513M cache-read tokens, context per round median 174k, max 467k |
| Builder threads in the same session | 467M cache-read tokens, context per round median 191k, max 467k |
| Oracle dispatches in the same session | 10 |

Why the loop does not end: a first review breaks one line per criterion, and every later round samples again. About 6% of mutants survive, so a round of 50 mutants is clean about one time in twenty-five. Each survivor adds a test, and the next round breaks the new code. Meanwhile the reviewer is resumed warm (`run-review.cjs:113`) and carries everything it ever read.

The planning side, as the host's campaign log reports it and not measured again here. One intent ran six whole-plan scan rounds in about six hours, and its open gaps rose from 25 to 44. A second ran five rounds in four hours with 21, 8, 11, 8 and 30 gaps, and 19 of the last 30 sat in text that earlier repairs had written. The scanner is told to be exhaustive with no cap on lines (`agents/scanner/agent.md`), so every repair gives the next round more to read.

One case to remember: in one item the round after a minor-only review held a blocker that a second cold reviewer had found. A single review that finds only minors does not prove there is nothing serious.

## 2. The two flows side by side

Turbo paths are under `src/flows/aidlc-turbo/`, INFERNO paths under `src/flows/inferno/`.

| | AI-DLC Turbo | INFERNO today | This plan |
| --- | --- | --- | --- |
| Who runs a mutant | A script, `scripts/story-mutate.cjs` | The reviewer, through `run.cjs mutate` | The runner (P1) |
| When mutants are proposed | First review only, at most 3 per story | Every round, as many as the reviewer likes | First review only, one per criterion (P1) |
| After a fix | Only the survivors run again | New mutants on whatever the fix touched | Only the survivors (P1) |
| What decides killed | Any exit that is not 0 (`story-mutate.cjs:255`) | A test that ran and failed (`run-mutate-verdict.cjs`) | Turbo takes INFERNO's rule (T1) |
| Mutant coverage | A sample of 3 | Every acceptance criterion with a test | Turbo takes INFERNO's rule (T2) |
| Delta review | A fresh reviewer, its previous verdict and the fix diff only. New findings only blocker or major on a changed line | The same reviewer resumed, six checks on whatever the fix touched | Turbo's rule (P2) |
| End of the loop | Miss 3 blocks the story | None | Miss 4 blocks the item (P3) |
| Minors only | Fix, verify, land. No second review | A full delta review | Turbo's rule, with a file guard (P3) |
| Test evidence | A script writes a proof. The reviewer never reruns the suite | The reviewer runs each criterion's test | A proof (P4) |
| Switched-off and bent tests | The proof lists them. Each needs a reason | Left to the reviewer's eye | In the proof (P4) |
| New scope | Never built in the story. A new intent | Grows inside the item through grants | A new item (P5) |
| Is the code itself sound | A reviewer of its own, `lens: quality` | No check asks it | A quality lens (P6) |
| A hard judgment call | The human | The oracle, then a higher tier on the user's yes | Routed by impact and complexity (P7) |
| The running application | Live test and break test at finish | Host lanes in the gate only | Shape recorded (P8) |
| Where the project's rules live | In the flow's own folder, `.specs-aidlc-turbo/repo/standards/` and the project pages. Builders get them and a reviewer judges against them | In the host's `CLAUDE.md` and what it points at. A few are hardcoded in the reviewer text | In `.specs-inferno/standards/` (P9) |
| The spec a builder gets | Criteria as given, when, then with where a tester checks each, an edge-case table, an out-of-scope list, a test plan | Prose, a criteria list and a manifest | Turbo's sections beside INFERNO's manifest (P10) |
| The gate on a plan's form | A script, `scripts/spec-lint.cjs` | `run.cjs frontier` checks the manifest only | A plan lint (P11) |
| The check on a plan's meaning | One cross-check: six named kinds of problem, a tool-call budget, at most two fix rounds | Scanners told to be exhaustive, round after round | One bounded cross-check (P12) |
| Isolation | A worktree per story | One worktree per intent | Unchanged, see section 9 |
| Human stops | Approval, mismatches, miss 3 | None | Unchanged |

## 3. Settled before the work starts

- **Reviewers stay.** Every item keeps its cold first review, and every serious finding is re-read until it is gone.
- **INFERNO stays autonomous.** Where Turbo asks the human, INFERNO asks the oracle.
- **The flow source is the only place to change.** A host gets the change by a reinstall. Nobody patches an installed copy, because that forks it from `.specsmd/inferno/flow.lock`.
- **A recorded review stays readable.** Every new rule applies to a review file that is being recorded. A file recorded under 0.1.81 parses after the upgrade as before.
- **Both hosts move together.** A change to an INFERNO agent text is ported to its Codex twin under `src/flows/inferno/codex/` in the same package.
- **Agent text stays inside its budget.** A package that adds a sentence to an agent text removes one of equal weight when the role is near its ceiling.
- **Turbo changes with it.** T1 and T2 are decided by the owner of both flows, like every INFERNO package here. They ship in the same release.

## 4. Who runs it

**One orchestrator.** One session on Fable 5.2 (`claude-fable-5-2`) at effort xhigh. It owns the order, the worktree, every brief, the check of every returned package, the merges and the release. It builds nothing itself.

**Implementers.** Opus 5.5 (`claude-opus-5-5`) at effort high, one package per agent, spawned as plain agents the owner can see and stop one by one. On a host that defines a flow implementer agent, dispatch that agent with the model and the effort set explicitly.

Every brief carries all of this:

- These two lines, verbatim: "You are a principal engineer: decide with confidence what the evidence lets you decide." and "Be proud of the work you deliver: finish it to the bar you would sign."
- The package section of this file, the worktree path and the branch.
- The files the package owns. The implementer edits no other file.
- The tests to write first and the command that runs them. Red first, for the reason the package exists, then green.
- The house bar: 500 lines at most per source file, no em dash or en dash, no secret, no new suppression.
- The result contract: status, changed files, the test command with its result, and at most three sentences. A judgment call with two defensible answers comes back as a question with what was measured.

**How a package is accepted.** The orchestrator did not write the code, so its check is cold. It reads the diff against the package's acceptance lines and runs the package's tests itself. A defect goes back to the same implementer while its context is warm.

**Where it runs.** One linked worktree off `main`, one branch for the whole plan. Packages that share a file run in series. The INFERNO script tests are `node --test <file>` from `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`, written `S/` below. The Turbo tests are vitest files under `src/__tests__/unit/aidlc-turbo/`. Run them where the host's machine rules allow a test run.

**Before the merge.** `cd src && npm run validate:all`, then `npm pack`, `evals/install-eval.sh <tarball>` and the e2e smoke harness under `evals/e2e/`. Then the version bump and one `CHANGELOG.md` entry.

## 5. Packages

| Id | Package | Flow | Cost | Depends on |
| --- | --- | --- | --- | --- |
| P0 | The review-loop readout | evals | saves | none |
| P1 | The runner runs the mutants, once | INFERNO | saves | P0 |
| P2 | A delta review reads the fix and nothing else | INFERNO | saves | P1 |
| P3 | The ladder has an end | INFERNO | saves | P2 |
| P4 | The proof comes from a script | INFERNO | saves | P3 |
| P5 | New scope is a new item | INFERNO | saves, measure first | P0 |
| P6 | A quality lens beside the contract review | INFERNO | one more reviewer per item | P4, P9 |
| P7 | The oracle is routed by impact and complexity | INFERNO | fewer top-tier calls | P3 |
| P8 | Live test and break test | INFERNO | real time, per host | P7, on the owner's go |
| P9 | The project's rules live in the INFERNO folder | INFERNO | one setup per host, shorter agent texts | P4 |
| P10 | The spec says more before the build starts | INFERNO | about even | P9 |
| P11 | A script checks the plan's form | INFERNO | saves | P10 |
| P12 | One bounded cross-check replaces the scan rounds | INFERNO | saves | P11 |
| T1 | A mutant is killed only when a test failed | Turbo | none | none |
| T2 | Every acceptance criterion gets a mutant | Turbo | test runs | T1 |

### P0. The review-loop readout

**Why.** Every number in section 1 came from throwaway scripts. Without one command nobody can show that a package worked.

**Change.** A read-only tool, `evals/review-loop/stats.cjs --tree <intent worktree> --base <ref> [--head <ref>]`. It walks the history of each item review file and prints one line per item and one total block with every row of section 1 that comes from review files, plus oracle dispatches by route from the dispatch log. A second tool, `evals/review-loop/tokens.cjs --session <transcript dir>`, prints tokens, rounds and context per round by agent type.

**Files owned.** `evals/review-loop/**`.

**Accepted when.** A fixture built the way `S/review-fixture.cjs` builds one proves every total, and the tool prints the section 1 values on the measured intent at `a9af3d0ca`. Where the tool is right and this file is wrong, this file is corrected in the same commit.

### P1. The runner runs the mutants, once

**Model.** Turbo `scripts/story-mutate.cjs`, `skills/construction/review.md` step 3 and `skills/construction/dispatch.md` step 3.6 with "Mutants again".

**Why.** 18 of 45 fix rounds exist only because a mutant survived, and 87% of all mutants ran after the first round.

**Change.**

1. In a first review the reviewer proposes one mutant per acceptance criterion that has a test: `{criterion, file, line, find, replace, test}`, with `criterion` the criterion's number. It never runs one.
2. The record step of `run.cjs review --item` runs the proposals through the existing batch, which builds the Rust ones once and restores every file, and writes `caught` itself. On a tree a sibling builder has dirtied it records the review without verdicts, and the proposals stay owed to the intent review, which the runner then runs from the same entries.
3. A survivor becomes a `major` finding the runner writes: the test stays green when that line changes, so the criterion is not really covered. The fix is a test that turns red, never a change to the production line.
4. A delta review holds no new mutant. After a fix the runner reruns only the survivors before the delta reviewer is dispatched, and `caught: yes` resolves that finding.
5. `S/run-review-file.cjs` holds a file being recorded to it: a numbered criterion, one entry per criterion, none new in a delta.
6. `S/run-mutate-verdict.cjs` keeps deciding what counts as caught, with the queued rule that a mutant is caught only when a test summary shows a failure.

**Files owned.** `S/run-review.cjs` (record), `S/run-review-file.cjs`, `S/run-mutate-batch.cjs`, `S/run-mutant-coverage.cjs`, a new `S/run-review-mutants.test.cjs`, `agents/reviewer/agent.md` and its Codex twin.

**Tests first.** A proposal with a free-text criterion is refused. Two proposals on one criterion are refused. A delta file with a new mutant is refused. The record step fills `caught` and writes the survivor finding. A rerun touches only the survivors. A recorded 0.1.81 review still parses.

**What it costs.** 45 of the 76 survivors sat on criteria the reviewer named itself. An item review no longer finds those. P5 is the answer: behaviour worth a mutant becomes a criterion.

### P2. A delta review reads the fix and nothing else

**Model.** Turbo `skills/construction/review.md` step 4 and `dispatch.md` "Delta review".

**Why.** 45 of the 75 findings of round 2 and later are minor, and a resumed reviewer reaches 467k tokens of context.

**Change.**

1. `reviewerLines` in `S/run-review.cjs` prints a fresh dispatch for every review. A delta dispatch names the previous review file and the range `review_commit..HEAD`, which is the fix, because INFERNO commits every correction.
2. The reviewer's "Delta review" paragraph becomes Turbo's rules. Each earlier finding is resolved or still open, repeated verbatim. A new finding exists only where the range changed a line, and only as a blocker or a major. Never a new minor. Never a second look at the rest of the change. A fix that changes a test's assertion where no finding said the test was wrong is `major`. A fix that switches a test off is a `blocker`.
3. `S/run-review-file.cjs` holds a delta file to it: a finding the previous review did not hold is a blocker or a major and names a file of the range.
4. The intent review's delta follows the same rule in `S/run-intent-review.cjs`.

**Files owned.** `S/run-review.cjs` (`reviewerLines`, `owed`), `S/run-intent-review.cjs`, `S/run-review-file.cjs`, `S/run-review-warm.test.cjs` (rewritten to hold the new rule), `S/run-printed-calls.test.cjs`, the reviewer text and its twin.

**Note.** Resuming the reviewer was a deliberate choice. This package reverses it on Turbo's evidence and on the context numbers. P0's token tool checks it on the next intent: reviewer tokens per review round fall by at least a third, or the orchestrator reads what the fresh reviewers re-read and tightens the dispatch.

### P3. The ladder has an end

**Model.** Turbo `dispatch.md` step 4. A miss is a fix review that weighs serious, as `weightOf` in `S/run-review-file.cjs` decides.

| Result | Next |
| --- | --- |
| Clean | Integrate |
| Fix, minors only | The warm builder corrects, `verify-item`, the item settles and integrates. No second review |
| Miss 1 | The warm builder, then a delta review. A cheap-tier item goes to a fresh strong builder, as today |
| Miss 2 | A fresh escalate builder, briefed as Turbo briefs its debugger: reproduce, name the root cause with evidence, say why both fixes missed, then fix. Then a delta review |
| Miss 3 | The oracle, routed by P7. The escalate builder implements its decision. Then a delta review |
| Miss 4 | The item is blocked and goes to the user in two sentences with a recommendation. Every item that does not depend on it keeps building |
| A finding with `repeat: true` | The oracle at once, as today |

**Change.**

1. The ledger counts misses per item and never resets the count when the tier changes. `nextActor` in `S/run-review.cjs` reads that count.
2. A third review state, `settled`. When the last review is `fix` with weight `minor`, and every path changed since `review_commit` is a file that review lists, `run.cjs review --item` records `settled` at HEAD and prints the integrate call. A correction that touches any other file owes a delta review.
3. Every reader of the ledger's `review` field accepts `settled` when the hash matches: `owedReviews`, `refuseUnreviewed` in `S/state-review.cjs`, `S/run-frontier.cjs:52` and `:216`. Grep for the others first.
4. The intent review dispatch lists each settled item with its range, so the one reviewer that reads the whole diff knows which corrections nobody re-read.
5. `agents/builder-escalate/agent.md` takes the debugger's method from Turbo `commands/aidlc-turbo-debugger.md`. INFERNO keeps one agent for the cause and the fix, so no new role.

**Files owned.** `S/run-review.cjs`, `S/state-review.cjs`, `S/state-transition.cjs`, `S/state-cli.cjs`, `S/run-frontier.cjs`, `S/run-intent-review.cjs`, `S/run-intent-owed.cjs`, `S/run-review-ladder.test.cjs`, a new `S/run-review-settle.test.cjs`, the orchestrator and escalate builder texts and their twins.

**The risk, in numbers.** 20 recorded rounds follow an item's first minor-only round, and 9 of them hold a serious finding. The file guard and the intent review's list are what stand between those and the gate. If an intent review finds a blocker on a settled correction, the settle rule is reverted and the case joins its tests.

**Expectation.** An item gets at most 4 reviews before it is blocked, against 8 and counting today. With P1 and P2 the best case is 2.3 rounds per item, against 3.9.

### P4. The proof comes from a script

**Model.** Turbo `scripts/story-verify.cjs`, `scripts/lib/test-files.cjs` and the story lens in `review.md`, items 1 and 8.

**Change.**

1. `run.cjs verify-item` writes a proof for the item beside the proofs `S/run-proofs.cjs` already keeps: every command with its exit, its seconds, its counts and its last 40 lines, the hash of the item's diff, and `tests_changed` with the test files the item modified or deleted and every line it adds that switches a test off. A switched-off test fails `verify-item`.
2. The review dispatch names the proof. The reviewer reads it and never reruns the item's checks. On one doubt it may run one narrow test.
3. An existing test the proof lists as modified or deleted needs a criterion that changes the behaviour it checked. Without one it is `major`: a test bent to fit the code.
4. The reviewer text takes Turbo's list of what is not coverage: a test that asserts only the fixture it built, a skipped or `todo` test, a test with no assertion, a name that promises more than the body checks, an expected value computed the way the code computes it, a mock of the unit under test or of an earlier item's code.

**Files owned.** `verifyItem` moves out of `S/run-gate.cjs` (424 lines) into a new `S/run-item-proof.cjs`, a new `S/run-test-files.cjs` ported from Turbo, `S/run-review.cjs` (the dispatch line), tests for both, the reviewer text and its twin.

**Why it is cheap.** The reviewer stops spending rounds on running tests, and a script finds switched-off tests at no token cost.

### P5. New scope is a new item

**Model.** Turbo's story lens, item 4 "Scope", and `dispatch.md`: "Never add a story inception did not write."

**Measure first, read-only.** With P0, classify the 75 findings of round 2 and later: on an acceptance criterion, on the bar, or beyond the contract. For the 35 grants, record what asked for each.

**Build when.** At least 30% of those findings are beyond the contract.

**The design to start from.** A requirement that appears in the loop is written down before it is built. When it needs a file outside `ownership.editable`, the planner writes a new item in the same intent that depends on this one, and the original item closes on its own criteria. Nothing is parked, because the new item builds in the same run. A grant is then only ever the answer to an existing criterion. The reviewer gains Turbo's scope check: anything built that the item did not ask for is a finding.

### P6. A quality lens beside the contract review

**Model.** Turbo `review.md`, `lens: quality`, and `commands/aidlc-turbo-reviewer.md`.

**Why.** INFERNO's reviewer checks that criteria are proven, that tests catch a break, the test doubles, the wiring, the re-read and the bar. No check asks whether the code is correct and safe beyond what its tests reach. On the measured intent the host added a second cold review per security item for exactly that, and it found a blocker.

**Change.**

1. A second agent, `specsmd-inferno-reviewer-quality`, with its Codex twin: Opus 5.5 at effort high, read-only. Its checklist is Turbo's: correctness the tests do not reach, error handling, security at the boundary, fit with the code around it, readability, cost, leftovers. It also judges the change against the rule files of P9 that apply to the changed paths, and names the rule in each such finding. When the host config names lint or analysis commands, it runs them once and takes over only findings on lines the item added.
2. For a first review `run.cjs review --item` prints both dispatches, to be sent in one message. Each lens writes its own file. The record step makes one verdict: `fix` when either says so, and the same fault found twice goes to the builder once at the higher severity.
3. In a delta each lens re-reads its own findings under P2.
4. An item of `kind: test`, docs-only or config-only gets no quality lens, because it has no production code to judge.

**Files owned.** The two new agent files, `S/run-review.cjs` (`ROLES`, `owed`, `record`), `S/run-review-file.cjs`, the installer's role list under `src/lib/`, `agents/orchestrator/config.example.yaml`, tests.

**What it costs.** One more Opus dispatch per review round, in parallel, so no added wall time. P0's token tool measures the cost on the first intent. A host that already runs its own second review per item can drop that one.

### P7. The oracle is routed by impact and complexity

**Why.** Judgment calls reach the oracle regularly: 10 dispatches in one session of the measured intent. Today every one goes to Opus 5.5 at xhigh, and the tier above needs the user's yes and never runs headless. The owner's decision of 2026-11-10: the route follows the call. Most calls go to Opus 5.5 at xhigh. Only a call that is truly hard goes to Fable 5.2 at xhigh.

**Change.**

1. Every ask carries two grades, each with the one rubric line that justifies it.
   - `impact: high` when a wrong answer would lose or corrupt user data, weaken a security or privacy control, change money, licensing or a legal statement, change a public contract (a schema, a file format, an API, a CLI), or bind more than one item or intent. Otherwise `low`.
   - `complexity: high` when three or more readings stay defensible after measuring, when the call spans more than one subsystem, when an earlier decision on the same call was `blocked`, rejected by a review or repeated, or when the asker already runs on Opus 5.5 at xhigh. Otherwise `low`.
2. The route: both high goes to the hard oracle, Fable 5.2 at xhigh. Everything else goes to Opus 5.5 at xhigh. An Opus oracle that returns `blocked` because the artifact does not settle the call goes to the hard oracle once.
3. Nobody asks the user for the route, and a headless run routes the same way. `verdict: user` stays the only path to the user.
4. The models are config: `models.oracle` and `models.oracle_hard` in `.specs-inferno/config.yaml`, with these defaults. The Codex twin maps the hard route to its host's top tier.
5. `run.cjs dispatch-log` records the route and both grades, so P0 prints oracle dispatches by route.
6. Miss 3 of P3 is `complexity: high` by definition. Its impact comes from the rubric.

**Files owned.** "The oracle" section of `agents/orchestrator/agent.md`, `agents/oracle/agent.md` (the two input fields), `S/run-review.cjs` (`hostActor` and `nextLine` for the oracle), `S/run-dispatch.cjs` (the log fields), `agents/orchestrator/config.example.yaml`, the Codex twins, tests.

**Guard against inflated grades.** The rubric lines are checkable against the files the ask names. The target is that fewer than one oracle ask in five takes the hard route. Above that, the orchestrator reads the logged grades and tightens the rubric.

### P8. Live test and break test

**Model.** Turbo `skills/construction/finish.md` steps 2 and 3, `live-test.md`, `break-test.md` and the breaker agent.

**The shape, not yet a package.** A host names how its application starts, where it listens and how it stops, under `verification.live`. The planner marks an item `break_test: true` when its behaviour faces a user or untrusted input. Before the intent review a live tester tries the intent out on the running application. A breaker then attacks the marked items from the outside, without reading the source. Every real defect is a finding owned by an item and goes through the ladder of P3.

**Why it waits.** It costs real wall time and tokens per intent, and a host must supply the start command. A desktop host supplies its own headless display. Build it on the owner's go, after P1 to P7 are measured.

### P9. The project's rules live in the INFERNO folder

**Model.** Turbo keeps the stack, the coding rules and the architecture under `.specs-aidlc-turbo/repo/standards/`, set up once by `skills/master/project-init.md`. Builders receive those paths, and the `docs` lens of `skills/construction/review.md` judges every story against them and names the rule it found broken.

**Why.** INFERNO's planner reads the host's `CLAUDE.md` and the files it points at and is told to encode the rules into the items. Its reviewer carries a few host rules in its own text: a 500 line ceiling, no dashes, no suppression, reader-facing copy. So a rule reaches a builder only when the planner remembered it, and the canonical flow text holds rules that belong to one host.

**Change.**

1. A host keeps its rules in `.specs-inferno/standards/`, one file per topic, one rule per heading, each with the command that checks it where one exists. `.specs-inferno/config.yaml` lists every file under `standards:` with the path globs it applies to.
2. A setup step, `/specsmd-inferno-standards`, drafts those files once from the host's `CLAUDE.md`, `AGENTS.md` and the files they point at. Every rule carries the line it came from. The owner reads the draft and approves it. From then on the folder is what the flow reads, and the host's instruction files point at it.
3. The planner reads the folder at start. A builder's dispatch names the files that apply to its `ownership.editable`. The quality lens of P6 judges the change against the files that apply to the changed paths.
4. A finding on a rule names the file and the heading, so the builder reads just that. A rule the item's own criterion asks to break is no fault of the builder: it goes to the oracle.
5. The reviewer's check 6 keeps ownership and secrets, and loses every rule that is one host's own. Those move into that host's standards at its reinstall.

**Files owned.** `agents/planner/agent.md` ("Read at start"), `agents/reviewer/agent.md` (check 6), the quality reviewer of P6, `agents/orchestrator/agent.md` (the dispatch list), `agents/orchestrator/config.example.yaml`, a new `claude/commands/inferno-standards.md` with its Codex twin, `S/run-dispatch.cjs` (the paths that apply), tests.

**What it costs.** One setup per host. After it the agent texts are shorter, and no extra reviewer is needed, because the quality lens reads only the rule files that apply.

### P10. The spec says more before the build starts

**Model.** Turbo `templates/inception/story-template.md` and `skills/inception/plan.md` steps 2b, 3 and 4.

**Why.** On the measured intent the reviews added criteria, the oracle added behaviour and 35 grants widened items. All three are signs that the spec was not complete when the builder started.

**Change.** `agents/planner/templates/work-item.md.hbs` and the planner's "Decompose" section gain the four things a Turbo story has and an INFERNO item lacks. The manifest stays as it is.

1. **Edge cases.** A table of case and expected behaviour. Every row gets a test, and the contract reviewer checks each row as it checks a criterion.
2. **Out of scope.** What this item does not build, one line each. The reviewer's scope check of P5 reads it.
3. **Test plan.** The test files the item adds, the integration test against each earlier item it builds on, run against that item's real code, and every existing test that asserts a value this item changes. That last list comes from Turbo's rule that a breaking test belongs to the item that breaks it.
4. **Reuse before create.** For every structure the item creates (a command, a table, a screen, a setting, a module), the spec names the existing one that fits, or says with file and line that none does.

The prose that explains what the code does today is cut in return (`inferno-future-improvements.md`, item 1). The brief numbers its success criteria and carries an item map: which items deliver which criterion.

**Files owned.** `agents/planner/agent.md`, `agents/planner/templates/work-item.md.hbs`, `agents/planner/templates/brief.md.hbs`, `agents/planner/scripts/team-work-item-contract.test.cjs`, the Codex planner twin, `agents/reviewer/agent.md` (edge-case rows), the builder texts where they name the sections of an item.

**What it costs.** The planner writes four short sections and less prose. The planner's standing text has a word ceiling, so every added sentence replaces one.

### P11. A script checks the plan's form

**Model.** Turbo `scripts/spec-lint.cjs`, the hard gate before its approval.

**Change.** `run.cjs plan-lint <intent>` prints one finding per line and exits 2 on any. `run.cjs frontier` runs it before it prints a ready set.

- Every success criterion of the brief is delivered by at least one item, and every item names at least one.
- Every acceptance criterion names its test and the value it must show.
- Every item has its edge cases, its out-of-scope list and its test plan, and none holds a `TBD` or a `TODO`.
- Every test the test plan names as breaking is in that item's `ownership.editable`.
- Two items with no `depends_on` path between them that share an editable file are printed, so the planner orders them on purpose.

**Files owned.** A new `S/run-plan-lint.cjs` with its test, `S/run.cjs` (one subcommand line, after the intent in flight has landed), `S/run-frontier.cjs` (the call), the planner text (one line).

**What it costs.** No tokens. It finds by script what a scanner otherwise finds by reading.

### P12. One bounded cross-check replaces the scan rounds

**Model.** Turbo `skills/inception/cross-check.md` and `commands/aidlc-turbo-cross-checker.md`.

**Why.** The plan-time scan does not converge. Turbo's check is smaller than INFERNO's, not larger: one reader, a fixed list of what to look for, a budget, and an end.

**Change.**

1. After the plan lint is clean, one cross-checker reads the brief and every item in one batch. A plan too large for one reader is cut along its dependency chains, one cross-checker per chain, all in one message.
2. It looks for Turbo's kinds of problem: `conflict` (two items that cannot both hold), `gap` (a case, a step or a file nobody owns, a producer without a consumer), `misreading` (an item that implements the brief differently), `deviation` (an item against a rule of P9 or outside the intent's scope) and `wrong_assumption` (a symbol, path or behaviour that is not in the code, or something built new that already exists).
3. It checks claims against the code inside a budget of tool calls, grep before read, line ranges only. Every finding carries the code that shows it.
4. At most two fix rounds. The second round checks each earlier finding and only the parts the repair changed. What is still open after that goes to the oracle, routed by P7. The plan is never scanned whole a third time.
5. The slice scan per item just before its dispatch, which the queued direct build adds, stays. It reads the tree the item's predecessors left.

**Files owned.** `agents/scanner/agent.md` (the plan-time half becomes the cross-check), `claude/commands/inferno-planner.md` and its Codex twin, `S/run-scan.cjs` (`--plan`), `S/run-scan.test.cjs`.

**Order with the queued work.** The direct build that limits the plan-time scan to one round with one repair lands first. P12 then changes what that one round looks for and how it ends.

### T1. A mutant is killed only when a test failed

**Where.** `src/flows/aidlc-turbo/scripts/story-mutate.cjs:255` reads `r.exit === 0 ? 'survived' : 'killed'`.

**Why.** A mutant that does not compile, and one that runs into the timeout (exit 124), both exit with a failure. Turbo scores each as killed, although no test noticed anything. The baseline run only proves that the test passes without the mutant.

**Change.** A mutant is `killed` only when the run shows a failed test: a failed count of at least 1 for the runners whose counts `story-verify.cjs` already parses. A timeout and a build or parse failure are `invalid` with the reason. For output without counts, the exit code decides only after the build-failure markers are ruled out: port the ones in INFERNO's `S/run-mutate-verdict.cjs` and add the ones of Turbo's stacks (javac and maven, tsc, go, dotnet, pytest collection).

**Files owned.** `scripts/story-mutate.cjs`, a new `scripts/lib/mutant-verdict.cjs`, `src/__tests__/unit/aidlc-turbo/aidlc-turbo-story-mutate*.test.ts`.

**Tests first.** A mutant that breaks the build is `invalid: did not build`. A mutant whose test times out is `invalid: timed out`. A mutant whose test fails an assertion is `killed`. A mutant whose test stays green is `survived`.

### T2. Every acceptance criterion gets a mutant

**Where.** `skills/construction/review.md` step 3 ("at most 3"), `dispatch.md` step 3.6, `templates/config.example.yaml` (`construction.mutants: 3`), and `build-story.md:52`, which tells the builder not to run its test before the code exists.

**Why.** Three mutants are a sample. With red-first gone, the test of every criterion outside the sample has never been seen to fail by anyone.

**Change.** The story lens proposes one mutant per acceptance criterion that a test covers. `construction.mutants` becomes a cap, and its default is no cap. The proof records the result per criterion. A criterion with a test and no killed mutant is a `major` finding. A criterion whose mutant was `invalid` gets one new proposal in the delta, through the path `dispatch.md` already has for an `INVALID` mutant.

**Not chosen.** Bringing red-first back. It costs a test run per criterion inside the builder, and it proves only that the test fails without the code, not that it guards the line.

**What it costs.** Test runs, so machine time. Hardly any tokens.

## 6. Order

1. **In parallel from the start.** P0. T1 and then T2, which touch only Turbo files. The P5 classification, read-only.
2. **The review chain, in series, because its packages share `S/run-review.cjs`, `S/run-review-file.cjs` and the reviewer text.** P1, P2, P3, P4, P9, P6, P7.
3. **The planning chain, in series, because its packages share the planner text.** P10, P11, P12. It starts once P9 has changed the planner's "Read at start", and then runs beside the review chain.
4. **The release.** Validate, pack, install eval, e2e smoke, version, changelog, merge.
5. **P5** as its own follow-up when its measurement says so. **P8** on the owner's go.

Expectation for steps 1 to 4: about three working days of agent and machine time. It depends on where the tests may run.

## 7. Rollout to a host

- One reinstall commit from the released tarball. A session that was running before the reinstall keeps its old agent definitions, so every orchestrator session restarts first.
- An item whose review was recorded before the reinstall keeps that review. Its next review follows the new rules.
- A host runs `/specsmd-inferno-standards` once and approves the draft before its first intent on the new flow. Without the folder the flow runs as today, with no rule files to judge against.
- An intent planned before the reinstall builds from its old items. The plan lint and the cross-check apply to plans written after it.
- A host that runs its own second review per item decides whether the quality lens replaces it.
- A host sets `models.oracle_hard` only when its account has that tier. Without it every ask takes the normal route.

## 8. How we know it worked

Run P0 on the first intent of ten or more items built after the reinstall.

| Measure | Before | Target |
| --- | --- | --- |
| Review rounds per item | 3.9 | 2.5 or lower |
| Highest round count of one item | 8 | 4 at most, by construction |
| Mutants per acceptance criterion | 12.4 | 1.5 or lower |
| Fix rounds that are serious only through a survivor | 18 of 45 | under one in five |
| Reviewer tokens per item, both lenses together | measure on the old flow first | at least a third lower |
| Oracle asks on the hard route | none, it needed the user | under one in five |
| Whole-plan check rounds per intent | 5 and 6 | 3 at most: one pass and two fix rounds |
| Ownership grants per intent | 35 | under 10 |
| Findings of the quality lens per item | none, it did not exist | reported, with their severity |
| Intent review findings of blocker or major weight | measure on the same intent | no rise per item |
| Gate reds per intent | measure on the same intent | no rise |

The last two rows are the quality check. If either rises, the package that caused it is reverted before the next intent starts.

## 9. Not in this plan

- **A worktree per item.** Turbo has it, and it removes a whole class of waits between siblings. On a host with a compile tree per worktree it costs gigabytes and cold builds. The intent in flight in this repo fixes those waits inside the shared worktree instead.
- **Fresh fix builders.** Turbo dispatches every fix fresh. INFERNO resumes the warm builder, whose thread reaches 467k tokens. Measure it with P0 after P2 before changing it.
- **The plan-time scan rule** and three smaller runner fixes, which are already queued as direct builds here. The intent in flight owns `run-integrate.cjs`, `run-attribute.cjs`, `run-peers.cjs`, `run.cjs` and a new `run-config-record.cjs`. This plan touches none of those. Let that work land first.
- **The orchestrator's own thread.** 390M tokens at about 267k of context per round is the third largest cost. It has no design yet.
- **The rest of Turbo's inception.** The questions to the user and the one human approval, the record that a script renders into specs, the drawn Code Scaffold, the overview page and the Confluence and Jira sync. They serve a team that signs off a plan. INFERNO plans without a person.

## Appendix: how the numbers were read

- A round is one recorded version of an item review file. `tree`, `commit` and `reviewer` lines are ignored when two versions are compared.
- A fix round is minor-only when every finding is `minor` and no mutant reads `caught: no`. That is `weightOf` in `S/run-review-file.cjs`.
- A fix round is serious only through a survivor when it has no blocker or major finding whose evidence is something other than a surviving mutant.
- A mutant names a numbered criterion when its `criterion` starts with a number. Everything else is free text.
- Tokens are summed once per API message id. Context per round is input plus cache-read plus cache-creation tokens of that message.
