# Handoff: a gate mark on a criterion whose instrument is a count is taken as its proof though no gate runs the count, and the check mutant that can prove it is refused on a comment line

Row 0an. Found on the first host on 2026-11-20 by an observer that read the shipped intent `candidate-1-the-ground` from its records, and checked against its specs, its reviews, its commits and the code. Measured with the flow's own `acceptanceCriteria` and `gateMark` over the plan and the archive, and reproduced on `a8873ebb` and the tip `d4a64f2f` with the script at the end. Row 0al is the reader of the mark's spelling; this row is what a mark that reads may prove.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `a8873ebb`, whose `src/` the tip holds byte for byte.

## What is wrong

1. **A mark is held to its name, never to what it proves.** The plan lint asks of a mark only that the config holds its name (`S/run-plan-lint.cjs:281-283`), and the coverage takes a held mark that is not late as the criterion's proof (`S/run-mutant-coverage.cjs:18-24`, `mutantGaps` `:190-209`). A criterion "`git grep -n X -- src | wc -l` shows 0 (gate: cargo test ...)" so reads as proven by a gate that never runs the grep. Nothing counts again after the builder, and the gate prints the criterion's `MARKED` line beside a green verdict. The flow's own texts give a count to a check mutant: "A mutant whose test is a plain check: a grep count, a probe line, a diff count" (`S/run-mutate-check.cjs:4`), "A pattern, a count or a computed value keeps its mutant" (`agents/reviewer/agent.md:20`), and the mark is for what no mutant reaches, a lane, a lint, the size cap (`S/run-criterion-marks.cjs:4-6`).
2. **A check mutant is refused on a comment line.** `refuseComments` (`S/run-review-file.cjs:368-382`) refuses every mutant on a line that opens with a comment marker, one with `check: true` too: "so no test can tell". A check reads the file's text, so it tells a changed comment. A count of citations that sit in comments then has no proof the flow takes but a mark whose gate never runs it.
3. **The planner text leaves a build out.** `agents/planner/agent.md:156` names "another lane, a lint, a size cap" as what ends on a mark. A criterion whose only instrument is a build that must pass is one no mutant can turn red too, since a broken build reads no verdict (`S/run-mutate-check.cjs:14`). The planner marked none of them, and each came later, one commit of a spec alone at a time.

## Evidence

The first host's Delta (Debian), intent `candidate-1-the-ground`, orchestrator transcript `779d3570-db74-4eb4-8504-9da390a586e2.jsonl`. Times UTC.

- Measured on Alpha 2026-11-20 with `acceptanceCriteria` and `gateMark` of `a8873ebb`: the plan at `c7cc66eaa` holds 60 criteria and 2 `(gate:`, of which none reads (both end on `).`, row 0al's case: `c1g-every-command-runs-on-any-tauri-runtime:4` and `c1g-the-licence-a-gated-command-asks-is-managed-state:7`, which the intent review then proved with caught check mutants). The archive at origin/main `97efa2c5a` holds 26 marks that read.
- The 26 came during the run in eleven commits of a spec alone, the route of `agents/orchestrator/agent.md:75`: `74ccf53cb`, `75dd5cb11`, `437b55a11`, `b4e7952b8` (2026-11-17 23:03Z to 23:24Z), `03bc7e49b`, `c377a8c05`, `14d259217`, `fe4526510`, `1d6c0cb59`, `fbc9d8e8c` and `8ef9109e5`.
- 12 of the 26 sit on a criterion whose only instrument is a count, under a gate that never runs it: 9 under `(gate: cargo test --manifest-path src-tauri/Cargo.toml)`, 2 under `(gate: npm run test:e2e)` and 1 under `(gate: npm run check)`. For example `c1g-one-test-door-registers-every-command:6`, `` `git grep -n "native_transport" -- src-tauri e2e src | wc -l` shows 0. (gate: npm run test:e2e) ``, and `c1g-each-preamble-shape-answers-its-golden:4`, `` `ls src-tauri/tests/fixtures/ipc | wc -l` shows 6. (gate: cargo test --manifest-path src-tauri/Cargo.toml) ``. The other 14 are builds that must pass and suites that must pass unchanged, which their gate does run.
- 2026-11-17 23:02:54Z, the runtime item's reviewer: "criteria 2 and 5 are check-only and need gating too". Criterion 2 is the count `` `git grep -n -E 'app: (tauri::)?AppHandle[,)]' -- src-tauri/src/commands | wc -l` shows 0 ``, and it got its mark in `437b55a11`.
- 2026-11-19 11:41:21Z, the intent review's record refused its file: "mutants entry 9 breaks src/lib/product/profile-context.ts:15, a line that opens with the comment marker //, so no test can tell; propose a mutant on a line that runs". The criterion, `c1g-the-scope-module-lives-in-the-domain:7`, counts three comment citations ("all three are comment citations of src-tauri/src/scope.rs, so no mutant on a line that runs can move the count"). The review's fix (`97d0595bb`, 12:16Z) was `(gate: npm run check)`, which never runs the grep, set in `8ef9109e5`.
- The same intent review proved four count criteria of that item (1, 5, 8 and 9) with caught check mutants whose test turns the count into an exit code, for example `test "$(grep -c 'crate::reader_errors' src-tauri/src/scope.rs)" -eq 8` with `check: true` (the archived `review.yaml`). The route the texts name works for a count on a line that runs.
- Cost: 11 commits of a spec alone, one intent review fix round with one refused review file, about 24 min of the orchestrator's time by the commit times, and 12 criteria whose count nothing ran again after the builder. Counted on Alpha 2026-11-20 over origin/main `97efa2c5a`: the archive holds 57 marks on a criterion with a count in 7 intents, 30 of them with no other instrument; the intents not yet archived hold 1.

## How to fix

1. **A count is no gate's to prove.** In `S/run-criterion-marks.cjs`, a `COUNT` test on a criterion's code spans: a span that pipes to `wc -l` or counts with `grep -c`, `git grep -c` or `--count`. In `itemFindings` (`S/run-plan-lint.cjs:281-283`), a criterion whose mark reads and whose spans hold a count is the finding `acceptance criterion <n> counts with <span>, which (gate: <name>) never runs: leave the mark off, and its review proves the count with a check mutant whose test is test "$(<span>)" -eq <n>`. In `mutantGaps` (`S/run-mutant-coverage.cjs:190-209`) such a mark proves nothing, a completed item's included, and the owed line gives the same reason beside `LATE`, `UNHELD` and `UNPROVEN`. A criterion that holds a count and a test the gate runs ("... shows 0, and `cargo test ...` passes") owes the count's check mutant too, since the gate runs only the test.
2. **A check mutant may break a comment line.** In `refuseComments` (`S/run-review-file.cjs:368-382`), an entry with `check: true` passes. A mutant whose test is a test runner stays refused there.
3. **The planner names a build.** In `agents/planner/agent.md:156`, "(another lane, a lint, a size cap)" becomes "(a build, another lane, a lint, a size cap)". Two words; the reviewer text needs none, since it already gives a count its mutant.

Tests, beside `S/run-criterion-marks.test.cjs`, the plan lint's and the review file's. The script's cases 1 to 3 are red on `a8873ebb` and the tip, and its two controls green; after the fix all five are green, and:

- A mark on a criterion that holds a count and a test span is a plan lint finding.
- A completed item's count criterion marked in a commit of its spec alone is owed a check mutant at the intent review, with the reason of point 1.
- A mutant on a comment line whose test is a test runner is still refused.

## Which part is the flow and which the host

The defect is the flow's: what its lint and its coverage take as a mark's proof, and what its record refuses. The host's part is its plans as data, not for the builder of the row: at the install, the one criterion of an intent not yet archived with a mark on a count meets the plan lint at its intent's first `frontier`, and the host drops that mark.

## Until it is built

On the host: a criterion whose instrument is a count gets no gate mark. Its reviewer proves it with a check mutant on a line the count reads that runs, `test "$(<count>)" -eq <n>` with `check: true`. A count that reads only comment lines keeps its mark as today, and its review names it in a finding as unproven.

## The script

Run with `S=<scripts folder of the flow> node --test --test-reporter=tap <file>`. Five seconds on Alpha. It uses the flow's own gate mark fixture.

```js
'use strict';

// A criterion whose instrument is a count, "`git grep -n X -- src | wc -l` shows 1", carries a gate
// mark whose gate never runs that count. The plan lint passes it and the intent review takes the
// mark as its proof, so nothing after the builder ever counts again. The proof the flow has for a
// count is a check mutant, and that is refused on a comment line, the very line a count of
// citations reads. Run with S=<the scripts folder of the flow to test> node --test --test-reporter=tap <file>.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { git, write } = require(path.join(process.env.S, 'review-fixture.cjs'));
const { FIRST_AND_THIRD, MARKED, intentReview, itemReviewed, lint, planned, shown } =
  require(path.join(process.env.S, 'run-criterion-marks-fixture.cjs'));

const COUNT = "`git grep -n 'docs/b.md' -- src | wc -l` shows 1";
const CHECK = `test "$(git grep -n 'docs/b.md' -- src | wc -l)" -eq 1`;

/** The plan with criterion 2 as given, and src/a.ts citing docs/b.md on a comment line or a code line. */
function cited(second, citation) {
  const { fixture, tree } = planned(second);
  write(tree, 'src/a.ts', `export const a = 1;\nexport const a2 = 2;\n${citation}\n`);
  git(tree, ['commit', '-qam', 'a-one cites the notes']);
  return { fixture, tree };
}

const checkMutant = (line, find, replace) => `  - criterion: a-one:2\n    file: src/a.ts\n    line: ${line}\n` +
  `    find: "${find}"\n    replace: "${replace}"\n    test: ${JSON.stringify(CHECK)}\n    check: true\n`;

test('a gate mark on a count is a plan lint finding: no gate runs the count', () => {
  const { fixture, tree } = planned(`${COUNT} (gate: echo gate ran)`);

  const result = lint(fixture, tree);

  assert.equal(result.code, 2, shown(result));
  assert.match(result.out, /^FINDING a-one: acceptance criterion 2 .*count/m);
});

test('a gate mark on a count proves nothing at the intent review', () => {
  const { fixture, tree } = cited(`${COUNT} (gate: echo gate ran)`, "export const notes = 'docs/b.md';");
  itemReviewed(fixture, tree);

  const result = intentReview(fixture, tree, FIRST_AND_THIRD);

  assert.notEqual(result.code, 0, shown(result));
  assert.match(shown(result), /criteria 2\b/);
});

test('a check mutant may break a comment line, since a check reads the text', () => {
  const { fixture, tree } = cited(COUNT, '// the notes live in docs/b.md');
  itemReviewed(fixture, tree);

  const result = intentReview(fixture, tree, `${FIRST_AND_THIRD}${checkMutant(3, 'docs/b.md', 'docs/c.md')}`);

  assert.equal(result.code, 0, shown(result));
});

test('control: a count proven by a caught check mutant on a code line is recorded', () => {
  const { fixture, tree } = cited(COUNT, "export const notes = 'docs/b.md';");
  itemReviewed(fixture, tree);

  const result = intentReview(fixture, tree, `${FIRST_AND_THIRD}${checkMutant(3, 'docs/b.md', 'docs/c.md')}`);

  assert.equal(result.code, 0, shown(result));
});

test('control: a gate mark on a criterion the gate runs stays clean in the plan lint', () => {
  const { fixture, tree } = planned(MARKED);

  const result = lint(fixture, tree);

  assert.equal(result.code, 0, shown(result));
});
```

On Alpha, 2026-11-20 20:1xZ, on `a8873ebb` and on the tip `d4a64f2f`: case 1 prints `clean alpha: 2 open items, 1 criteria` where the test wants a finding, case 2 records `intent review clean` with no entry for criterion 2, case 3 is refused with `mutants entry 3 breaks src/a.ts:3, a line that opens with the comment marker //`, and both controls pass.
