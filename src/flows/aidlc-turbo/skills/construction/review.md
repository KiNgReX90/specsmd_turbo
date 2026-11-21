# Skill: Review

---

## Role

The one checklist every reviewer follows. A built story gets its reviewers at the same time, each `specsmd-aidlc-turbo-reviewer` with `scope: story` and its own `lens`: `story` (does the code do what the story asks), `quality` (is it well written and safe) and `docs` (does it keep the project's own rules: the standards and the Project Documentation, one docs reviewer per batch of them, and a normal project has one batch). The same goes for the delta re-review of a fix. The construction agent makes their verdicts one. `specsmd-aidlc-turbo-intent-reviewer` uses it with `scope: intent`, once at finish, for the whole intent. On hosts without subagents the construction agent runs it inline, one lens after the other.

A reviewer has **fresh context**: it did not build the code and holds none of the builder's assumptions. That is the whole point. It is read-only and returns a verdict; the construction agent decides what happens next.

---

## Input

- **Always**: the absolute project root (every other path is relative to it, never to a home directory), `scope` (`story` or `intent`), `mode` (`full` or `delta`), the brief path
- **`scope: story`**: `lens` (`story`, `quality` or `docs`), the code root (the story's worktree, or the project root at finish), the story path, the proof `{intent_dir}/proof/{SSS}.json`. Optional: `scaffold_approved`, what the human approved during the build that the story's Code Scaffold does not name
- **`lens: docs`**: `docs`, your batch: the standards and pages of the Project Documentation to judge against; its number `batch`; and `index`, the root page of the Project Documentation, or none
- **`scope: intent`**: the proof `{intent_dir}/proof/intent.json`, one verdict line per story, `shared_files` (every file more than one story changed, with those stories) and the diff command, which leaves out `.specs-aidlc-turbo/`. `coverage_only: true` for a quick-lane intent
- **`mode: delta`**: your previous verdict, verbatim, and the path of the fix diff

---

## Process

### 1. Read the spec

- `lens: story`: the story, both halves: the product-team half is the contract, the agent half how it was meant to be met. From the brief the `D-n` decisions the story names.
- `lens: quality`: the story's product-team half, only to know what the code is for, and the brief's `## Lessons`.
- `lens: docs`: `index` first, for where every rule lives, then every file of your batch, whole: a page that sets rules (conventions, standards, a checklist) rule by rule, a page that describes (the architecture, the domain model, the terms) for the layers, flows, invariants and words it fixes. From the brief `## Design decisions`, `## Standards deltas` and `## Lessons`: a decision or a delta may set a rule aside, and a lesson weighs as a rule.
- `scope: intent`: the brief's `## Requirements`, `## Design decisions`, `## Technical design` and `## Story map`, which is the requirement coverage table: which stories claim which requirement. A story's `### Acceptance criteria` only when a requirement needs it.

Never read `.specs-aidlc-turbo/docs/{inception}/pages/` or `register.yaml`. The story and the brief are the spec. The Project Documentation (`.specs-aidlc-turbo/project/pages/`) and the standards are read by the `docs` lens, through its batch.

### 2. Read the change and the proof

- `scope: story`: `git -C {code root} diff HEAD -- . ':!.specs-aidlc-turbo'`. New files show too: `story-verify.cjs` ran `git add -N` first.
- `scope: intent`: the diff command you were given.
- `mode: delta`: the fix diff only, see step 4.

Read the code around the change as far as you need to judge it. You may read anything, you change nothing.

Then, for `lens: story` and `scope: intent`, the proof (the other lenses leave it to the story lens): it must say `passed: true`, with every command of the brief's `## Verification` in it at exit 0. A failed proof, or one missing a command, is a `blocker`. **Never rerun the suite**: the proof is the test evidence, written by a script, not by the builder. To check one doubt you may run one narrow test (one file or one test name, quiet flags, output through `tail`).

### 3. Walk the checklist

Walk only your own lens: the other lenses look at the same change at the same time. A `blocker` you see outside it you still report.

`lens: story`, does the code do what the story asks:

1. **Acceptance criteria**: every one implemented, and covered by a real test. Not covered: a test that asserts only the fixture it just built, a skipped or `todo` test, a test with no assertion, a test whose name promises more than its body checks, an expected value computed the way the code computes it, a test that mocks the unit it tests or code of this or an earlier story.
2. **Edge cases**: every row of `### Edge cases and errors` handled, with the behaviour the table names.
3. **Decisions**: the `D-n` decisions the story names are honoured.
4. **Scope**: nothing built that the story did not ask for. Extra abstraction, an unused parameter, a second feature: all findings.
5. **Own test data**: every database test creates the records the story's `test_data` names, with keys unique to the story, and cleans up only its own rows. A test that leans on a shared fixed record, or deletes rows it did not make, is `major`: it breaks when stories run side by side.
6. **Integration tests**: every `Integration with S{id}` line of the test plan has its test, run against that earlier story's real code. A missing one, or one that mocks or stubs that code, is `major`.
7. **Code Scaffold**: when the story has one, every part it says the story builds is built, at its path and after the example it names unless it says why it deviates, and what it says the story uses is used, not rebuilt. The build notes end with **Built**, **What changed**, **Outside the Code Scaffold**, **Different from the Code Scaffold** and **Not built** (What changed may be missing from notes written before it). Anything built that it does not name and the build notes do not report under Outside is `major`. A part it names for this story built another way (another place, another example) and not reported under Different is `major`; one not built and not reported under Not built is `major` too. A new right, a new table or a new module it does not name, that no `scaffold_approved` covers, is `major` even when reported. A reported deviation is judged as item 4 judges scope. A story without one (none was drawn) skips this item: its absence is no finding.
8. **Changed tests**: every existing test the proof's `tests_changed` lists as `modified` or `deleted` needs a reason in the story: a criterion or an edge-case row that changes the behaviour it checks. Without one it is `major`: a test bent to fit the code.
9. **The story itself**: a criterion, an edge-case row or a `D-n` it names that the brief, another criterion or the code it builds on contradicts, so no code can meet both: a finding with `mismatch: true`, both sides quoted and named, never a defect of the builder.

Then, in `mode: full`, propose **mutants**, one per acceptance criterion that a test covers: each one small change to a production line this story added or changed, a line that criterion says must matter. Flip a comparison, a condition or a constant, or drop a call, so that the code still compiles. `from` is the text exactly as it stands on that line, `to` what replaces it. `test` runs only this story's tests that cover that line, with the runner the brief's `## Verification` uses, and passes on the code as it is: the script runs it once unchanged first, and a `test` that fails there or runs no test makes the mutant invalid. It may start with `cd {dir} &&` and a folder inside the code root, as a verification command may; beyond that, no shell operator (`&&`, `|`, `;`, `>`). `criterion` starts with the criterion's number in the story's list, 1 for the first, then what the line guards, in the story's own words. Never two mutants on one criterion, never a test file. A criterion no real test covers gets no mutant: its number goes in `untested`, besides its finding under item 1. Return `mutants: []` when no criterion has a test. Never run a mutant yourself: you are read-only, and the other lenses read the same worktree. A script runs them after the reviews; a mutant whose test stays green, and a criterion with a test and no killed mutant, are `major` findings.

`lens: quality`, is it well written and safe, whatever the project's own rules say:

1. **Correctness**: no fault the tests do not reach: an empty or missing value not handled, an off-by-one, a wrong comparison, a resource left open, a transaction that commits half, two threads on one state.
2. **Error handling**: as designed. A swallowed exception, an empty catch, an error path that returns success: findings.
3. **Security**: input validated at the boundary, rights checked where data is read or changed, no secret or token in the source, no query built by string concatenation, no unescaped user text rendered on a UI path, no secret or personal data in a log.
4. **Fits the code around it**: names, layering and error shape as its neighbours do it, and what the codebase already offers is used, not written again: with a language server, `workspaceSymbol` and `findReferences` find it.
5. **Readable**: names that say what a thing is, small units, no duplication, no needless complexity.
6. **Cost**: no query inside a loop, no whole table loaded for one row, no work repeated per row that can be done once.
7. **Leftovers**: no dead code, no commented-out block, no debug print, no stray console output, no `TODO` the story did not authorise.
8. **Analysis and lint**, in `mode: full`, when the Code tooling names analysis or lint tools: run `node .specsmd/aidlc-turbo/scripts/tooling.cjs run --project {project root} --code-root {code root}` once (it may leave build output in the code root: that is no edit of yours). Every line under `touched` is on a line this story added: a finding, graded by its risk, never by the tool's own level, unless it is plainly wrong for this code. `elsewhere_in_changed_files` and `other_lines` are older code: never a finding. Put one line per tool in `tooling`: its status and how many findings you took over.

The tests are the story lens's: you judge the production code.

`lens: docs`, does it keep the project's own rules, those in your batch:

1. **Every rule that applies**: walk your batch rule by rule; every rule about something this change touches is kept. A rule about something it does not touch: say nothing.
2. **A page's own checklist**: a page that carries a review checklist is walked item by item, for what the change touches.
3. **What the pages describe**: the code sits in the layer and module the architecture names, keeps the invariants of the domain model, and uses only the words the terms allow in names.
4. **Set aside on purpose**: a `D-n` decision or a `## Standards deltas` line that sets a rule aside makes it no finding.

Every `lens: docs` finding names its rule in `rule`: the file and the heading it stands under, so the builder reads just that. A rule the story's product-team half demands to break (a criterion asks for what the rule forbids, and nothing in the brief sets the rule aside) is still a finding, marked `story_demands: true`: the human decides it, not the builder. A rule broken by the agent half (a name or a place the Code Scaffold planned) is an ordinary finding: the rule wins, and the builder reports the change under Different.

A statement of a page that the code this change touches or reads shows is not true (a table, a column, a class, a layer or a flow the page describes otherwise) is a finding with `mismatch: true`, with its `rule`, the statement quoted and the code that shows otherwise: `minor` unless the change rests on it. A rule the existing code around the change does not keep is no mismatch: the rule is for new code.

`scope: intent`, the whole only, not every story again. With `coverage_only: true` (a quick-lane intent, whose stories were each reviewed already) walk item 1 only:

1. **Per requirement**: the stories the story map names deliver it, and the code really does it. A requirement nobody delivers is a `major` finding on the story nearest to it, and goes in `uncovered`.
2. **Integration**: the stories work together: call sites, shared types, migration order, one story's change still reachable after the next.
3. **Shared files**: every file in `shared_files`, read in its final form: each story's change is still there and they agree.
4. **The specs themselves**: requirements, decisions or stories that cannot all hold, so no code can meet them all: a finding with `mismatch: true` on the story nearest to it.

### 4. Delta mode

You get your previous verdict and the fix diff, nothing to review again from scratch.

- Per previous finding: resolved, or still open (repeat it verbatim, same id).
- A new finding only where the fix diff changed something: a `blocker` or `major` the fix broke. Never a new `minor` on a line the fix did not change.
- Never re-review the rest of the change.
- `lens: story` and `scope: intent`: a fix that changes a test's assertion where the finding did not say the test was wrong is `major`. A fix that switches a test off (`skip`, `only`, `todo`, `xit`, `@Disabled`, `@Ignore`) is a `blocker`. This holds at finish too, where `story-verify.cjs` does not look for it.
- No mutants in delta mode, but one: a `C` finding (a criterion with a test whose mutant was invalid, or that had none) handed to you with the script's reason gets one new mutant for that criterion, with the id your assignment gives; the script decides it. An `M` finding is judged by the script that reran its mutant, not by you: leave it out of your verdict, unless your assignment hands it to you with the script's `INVALID` reason or the builder's dispute. Then judge from the fix diff whether a test now turns red on that change. A `C` finding whose one new mutant is spent you judge the same way, from the code.

### 5. Grade every finding

| Severity | Meaning |
| -------- | ------- |
| `blocker` | It does not do what it promises, or the build or tests are broken |
| `major` | A criterion or edge case is not really covered, a fault the tests do not reach, a security basic is missing, work that grows with the data where it need not, a decision, a standard or a rule of the Project Documentation is broken, a wrong name that outlives the build (a table, a column, an API field) |
| `minor` | A name inside the code, a missing comment where the standards ask for one, a small duplication |

**`fail` on any `blocker` or `major`.** Minor findings alone are a `pass` with the findings listed; the builder fixes them without a second review.

**Judge the code, nothing else.** The test cases in `{intent_dir}/tests/` and the Playwright twins are not in your scope. They exist only when `tester.enabled` is true, and they are written at finish, after your review. A file you do not find there is not a finding. Say nothing about it.

### 6. Return the verdict

```yaml
scope: story
lens: story
id: "003"
mode: full
verdict: fail
findings:
  - id: F1
    severity: major
    file: src/auth/login.ts:42
    issue: "Expired-password path returns 200 instead of 401"
    fix: "Return 401 and the EXPIRED code per FR-2"
resolved: []
proof: "2/2 commands passed"
mutants:
  - id: M1
    file: src/auth/login.ts
    line: 38
    from: "daysLeft < 0"
    to: "daysLeft <= 0"
    test: "npx vitest run src/auth/__tests__/login.test.ts"
    criterion: "1: a password that expires today still logs in"
untested: []
```

- `lens`: yours; `scope: intent` has none. `proof` only from `lens: story` and `scope: intent`.
- `mutants` and `untested` only from `lens: story`. In `mode: full` one mutant per criterion with a test, ids `M1`, `M2`, ... in criterion order, and in `untested` the numbers of the criteria no real test covers, for example `untested: [3]`. In `mode: delta` only the new mutant a `C` finding asks for. `[]` when none.
- Finding ids run `F1`, `F2`, ... for `lens: story` and `scope: intent`, `Q1`, `Q2`, ... for `lens: quality`, and `D{batch}-1`, `D{batch}-2`, ... for `lens: docs`; a delta verdict keeps the old ids and numbers new findings on from the highest.
- `lens: docs`: every finding also has `rule`, for example `rule: "conventions/database-standards.md, Column names"`, and `story_demands: true` when step 3 says so.
- `mismatch: true` on a finding that shows the story, the brief or a page is wrong, not the code, from any lens or scope: its `issue` quotes both sides and names where each stands, and its `fix` proposes which side gives way. The construction agent asks the human; the builder never gets it as a fix.
- `resolved`: in delta mode, the ids of previous findings now fixed. Else `[]`.
- `tooling`: only from `lens: quality` when it ran the analysis and lint tools, for example `tooling: ["pmd: findings, Q2 and Q3", "semgrep: skipped, not on this machine"]`.
- No findings is `findings: []`.
- `scope: intent`: `id` is the intent slug, every finding names its `story`, and `uncovered` lists the requirement ids no story delivers (`uncovered: []` when none).

---

## Never

- Never fix what you find, and never write a file: not code, not a story, not the brief, not a report. Your findings live only in the verdict.
- Never commit, stage or push.
- Never rerun the whole suite.
- Never run a mutant: the story lens proposes them, a script runs them.
- Never report on the test cases or the twins.
- Never return a diff, a log or a file body.

---

## Transitions

- `scope: story` back to `.specsmd/aidlc-turbo/skills/construction/dispatch.md`, which makes the verdicts of the lenses one, then lands, fixes or escalates
- `scope: intent` back to `.specsmd/aidlc-turbo/skills/construction/finish.md`
