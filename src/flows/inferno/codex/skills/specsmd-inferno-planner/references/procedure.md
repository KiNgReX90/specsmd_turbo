# Codex INFERNO planning procedure

The planner captures or repairs intent artifacts, decides their work-item records, renders every file itself, updates state once, prints a handoff and stops.

## Paths and canonical resources

- State: `.specs-inferno/state.yaml`
- Codex configuration: `.specs-inferno/config.codex.yaml`
- Intent brief: `.specs-inferno/intents/<intent-id>/brief.md`
- Work item: `.specs-inferno/intents/<intent-id>/work-items/<item-id>.md`
- Brief template: `.specsmd/inferno/agents/planner/templates/brief.md.hbs`
- Work-item template: `.specsmd/inferno/agents/planner/templates/work-item.md.hbs`
- Canonical planner body: `.specsmd/inferno/agents/planner/agent.md`

Read the rule files under `.specs-inferno/standards/`, else the applicable `AGENTS.md` instructions. A builder's dispatch names the rule files that apply to its paths, so plan by them without restating them; without that folder, encode the standing rules of `AGENTS.md` into the items. Read canonical resources as references but never edit them.

## Activation and user input

1. If `.specs-inferno/config.codex.yaml` is absent, return a compact `needs_config` result so the parent can complete `$specsmd-inferno-config`; never create a silent default file.
2. Read config, state when present, project instructions and the repository metadata needed to ground real paths.
3. Determine whether to capture a new intent, decompose a pending one, or repair missing or invalid planning artifacts.
4. Settle essential product facts from the project's specs and the live code, never by asking. A call they leave open is returned as one `oracle` block (the question, the readings, what was measured, the paths) for the parent to settle, and no artifact is written for the scope that call gates. Never return a `questions` list and never pause for a person.

## Triage: intent or direct build

Run this triage on every request before capture. The wording of a request is never a criterion, and neither is the user's explicit order to make an intent.

The test is the builder's context, not whether one builder could in theory finish the work. Five to ten findings fill one builder's context.

A request is a direct build when it is one small change, or two closely tied ones, in files a builder reads in full, that one builder finishes and one session proves with its context still compact: a red check, one defect, one regression, one missing value.

Anything larger is an intent when any of these holds:

- **(a)** a batch: findings from a hand test, a review or a board of decisions, several cards, or changes across more than one screen, module or concern. Split it into work items of one or two changes each;
- **(c)** a dependency chain where a later change cannot be tested before an earlier one lands;
- **(d)** disjoint ownership worth parallelising on disjoint compile trees;
- **(e)** a change that must not reach the default branch until the full gate proves it whole, such as a persisted-format migration or a definition version bump several documents read.

Everything else is a direct build: write no brief, no work item and no state entry for one. Every intent's state entry comment carries `INTENT. (<letter>) <what makes it more than one compact change>`, and `state-transition.cjs check` refuses a reason that names no criterion letter or only restates size.

When the request asked for an intent and no criterion holds, the line reads `Triage: direct, the request asked for an intent`, and the direct recipe follows. Return each direct build as a recipe the strong builder executes in its first round, one labelled line each:

```text
direct: <slug>
  change: <the mechanism at file:line and the change, in a sentence>
  files: <the editable ownership list, comma separated>
  test: <test file> :: <the assertion that goes red first>
  proof: <the command that proves done, plus the cheap checks by name>
  grade: low | medium | high
  hard: yes | no
  measured: <what was measured and the command>
```

`grade` follows the work-item grading rules. `hard: yes` when the change has more than one defensible shape, or a cause the measurement did not settle. Measure before writing a recipe and never hand over a slug the builder must search for.

## Capture and cross-intent reconciliation

1. Establish the goal, users, problem, constraints, non-goals and preferences. Number each success criterion `SC-<n>`, never renumbered, with its instrument and the value it must show; the brief's Item Map names the items delivering each.
2. Compare the proposal with every non-completed intent cheap-first, titles and state entry comments before a brief, and classify the relationship: **independent** when scopes and ownership proceed separately, **integrate** to fold it into an existing pending intent, **depend** to create it separately with the prerequisite id in `depends_on_intents`, **conflict** to read both briefs and the specs and return an `oracle` block when they do not settle it.
3. Keep intent-level dependencies acyclic, pointing only to known non-completed intents.
4. Couple work that changes one surface; a batch of unrelated findings is one intent of small items, never one large item.
5. Resolve every choice the specs settle and record the assumption.
6. Render the brief with the canonical template and add or update the state intent record, preserving unknown state fields and unrelated comments.

## Repository grounding

Before decomposition, use `rg`, `rg --files`, manifests, tests and focused source reads to verify every path and pattern. Never place a guessed path in a work item. A write the plan routes through an existing function is planned at its nearest command wrapper: grep the function's callers in the round that opens it, because the side effects the store alone skips (a sync, a recomputed index, an event) live in the wrapper.

## Work-item decomposition

Every item uses `execution: autopilot` and includes:

```yaml
context:
  required:
    - path: src/app/foo.ts
      reason: Primary implementation target
  patterns:
    - path: src/app/bar.ts
      reason: Existing pattern to follow
  tests:
    - path: src/app/foo.spec.ts
      reason: Relevant test coverage
ownership:
  editable:
    - src/app/foo.ts
    - src/app/foo.spec.ts
probes:               # optional
  - run: "git grep -c 'border-radius' src/lib/board/tile.css"
    shows: "4"
reads:                # optional
  - path: src/app/foo.ts
    source: the backend command, store row or event behind the value
    when: every moment the surface reads it again
    stale: what the user sees on screen if it never reads again
writes: [save_item]   # optional, functions written through
provides:             # optional, kind command, table or event
  - kind: command
    name: save_item
consumes:             # optional, seam required for command and event
  - kind: command
    name: save_item
    seam: e2e/save.spec.ts
diagnosis:            # required on corrective items
  claim: "the shelf foot adds 104 px under the board at 960"
  probe: "npx playwright test e2e/dashboard.spec.ts -g 'the board fits'"
  shows: "1 failed"
```

Also decide id, title, kind, complexity, acceptance criteria, `depends_on`, the narrow verification command, an optional `finalize_check`, and a `design_contract` naming the exact source when visual or contract values must be matched.

### Four sections beside the manifest

`delivers:` names the `SC-<n>` the item delivers. Edge Cases: a row per case. Out of Scope: what it does not build. Test Plan: the tests it adds, an integration test per `depends_on` item on that item's real code, and every existing test asserting a value it changes, in its `ownership.editable`: a breaking test belongs to the item that breaks it. Reuse: per command, table, screen, setting or module it creates, the existing one that fits, or the `file:line` showing none does. An empty section reads `None.` The Description says what changes and why, never what the code does today.

### Contract rules

- `reads:` is optional. An item whose surface draws a value the backend owns carries one entry per value. The `stale` sentence names what the user sees when the surface never reads again, because that is what the builder's first failing test asserts.
- `probes:` is optional. Every number the plan depends on becomes a probe on the item that depends on it. `run` is one read-only shell line, never a suite and never a write; `shows` is the exact trimmed stdout seen. Both are double-quoted. A probe is never an acceptance criterion: the orchestrator reruns it with `run.cjs probes <item-id> --tree <dir> --config .specs-inferno/config.codex.yaml` before the dispatch and hands the drift to the builder.
- `diagnosis:` is required on a ui or behavior item that exists because something is wrong on the screen today. `claim` is the cause in one sentence, `probe` the bare command that shows it, `shows` the line it printed. A pixel or position claim comes from browser geometry, never from adding up declarations.
- An item may own a host config under `.specs-inferno/`; its change stays outside the item's proof and what its review binds.
- Dependencies are known and acyclic.
- Prefer disjoint ownership when it reflects the code, and never falsify it to create parallelism.

### Size both ways

Split an item that spans more than two concerns, needs substantially more than six context files, or is unlikely to finish in one bounded stretch. Merge adjacent low or medium items in a strictly serial same-tree chain when splitting adds cold starts without enabling parallelism. High-complexity items remain standalone.

An item boundary preserves every existing invariant, so the tests, allowlists, goldens and docs an invariant needs travel with the source change.

### Blast radius is measured

Before you return a plan or a repair, run the blast-radius grep: one `git grep -n` per exact identifier over the whole tree, for every identifier, op, enum value, struct field, question id, component, catalogue, count, file contract, document and behaviour the plan adds, changes or removes. Every consumer it finds in code, tests, fixtures, seeds, e2e, integration, dev bridges, generated mirrors or scripts, a production caller of a function you thread included, goes into an item's ownership, context, acceptance criteria and probes. A test among them, in `planner.test_trees` of the config or anywhere when that is unset, sits in the item's `context.tests` with the value it must show and its own acceptance criterion; `run.cjs frontier` prints what you missed as `candidate` lines.

A GAP is a class. A cross-check GAP names one instance: sweep its whole class with the same grep, fix every instance, and only then return the repair. Test plumbing is never chased: the builder and the gate own it.

### Verification-item convention

Do not add a trailing test-only item: each builder verifies its own slice and finalization runs the authoritative suite once. Put a cheap mechanical post-merge invariant on the owning item as a one-line `finalize_check`, scoped only, never a suite the finalize list already runs.

Acceptance criteria and per-item verification commands name the one spec or test file the item adds or changes, never a full suite. A criterion no mutant can turn red (another lane, a lint, a size cap) ends its line with `(gate: <name>)`, the name a `verification.finalize` command verbatim or `verification.<lane>`, and stays under Acceptance Criteria. An item applying one mechanism to several surfaces owns every surface and declares one test per surface and one per journey. A browser test is for functionality a person drives in the browser; copy, labels, formatting and anything asserted on one component's rendered output are unit tests that render the component. Appearance, and anything only the built binary shows, is a case in the integration case list with a test beside it, written in the run: under `real_app.paths` and asked green when the host sets `real_app.prove`, else proved by hand afterwards; no criterion then asks it to be green.

Create a `kind: test` item only when verification itself requires real reasoning, such as a computed cross-surface invariant. It depends on the relevant implementation items, stays capped, and does not rerun the final gate.

### Tester case reservation

On a host with `integration/TEST-CASES.md`, the brief names the tester case ids the intent touches: an existing id for a changed journey, and for a new one the next free id there, which the planner never writes. Return each new id as its own handoff line, exactly `reserve: TC-<n> <title> for <intent-id>/<item-id>`, so the parent lands the reservation at planning time; a collision returns the replacement id for the brief and the work item. The work item that changes the journey owns the case text and its test.

### High-complexity decisions

A high-complexity item carries its decisions under Technical Notes, one line each for the decision, the choice and the reason. No separate design file.

## Rendering the artifacts

1. Build a complete decision record for each work item, every required and optional template field included.
2. Render each record from the canonical work-item template into `.specs-inferno/intents/<intent-id>/work-items/<item-id>.md`.
3. Only after all files validate, update `.specs-inferno/state.yaml` once with the work-item list and intent metadata.

## Validation

Before handoff:

1. Parse state, and run `state-transition.cjs check --intent <intent-id> --config .specs-inferno/config.codex.yaml` and `run.cjs frontier <intent-id> --config .specs-inferno/config.codex.yaml` until both exit 0; `frontier` names a missing manifest field or path.
2. Confirm that item and intent dependencies are acyclic, every verification command is narrow, and design contracts cite an exact source.
3. Confirm the blast-radius grep ran for this plan or repair and every item carries what it found.
4. Repair every finding `run.cjs plan-lint <intent-id>` prints before returning.
5. Run the canonical decomposition contract test when its prerequisites are available:

   ```sh
   node --test .specsmd/inferno/agents/planner/scripts/team-work-item-contract.test.cjs
   ```

## Handoff and stop

Print:

- the triage verdict first, `Triage: direct` or `Triage: intent, because <the letter and one clause>`;
- intent title and id, the ordered work items with complexity and dependency summary, and which can start in parallel;
- the `reserve: TC-<n> <title> for <intent-id>/<item-id>` lines, one per reserved case id;
- the direct recipes, the `oracle` blocks, and the significant look change the intent carries, when there are any.

Print the summary and stop, in every mode. Never offer a choice of routes and never start builders. End by saying the plan is ready and can be built with `$specsmd-inferno`.
