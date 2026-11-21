# Handoff: a gate mark with the full stop of its sentence after it reads as no mark, and the plan lint lets it pass, so the intent review owes that criterion a mutant and says no reason

Row 0al. Found on the first host on 2026-11-20, at the intent review of `the-article-14-drafts-cite-ask-and-print-what-the-law-owes`, on the build at `a8873ebb`, the tip. Measured there with the flow's own functions on the intent's specs and review, counted over every plan of the host, and reproduced on `a8873ebb` and the tip `84c5eabd` with the script at the end.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `a8873ebb`, whose `src/` the tip holds byte for byte.

## What is wrong

1. **The reader takes a mark only when `)` ends the line.** `MARK` is `/(?:^|\s)\(gate:\s*(.*?)\s*\)$/` (`S/run-criterion-marks.cjs:48`). A criterion is a sentence, and the planner ends it with a full stop: `` `npm run lint:copy` exits 0 (gate: npm run check). `` gives `gateMark` null. Every reader goes through it: the coverage (`S/run-mutant-coverage.cjs:129`, `:200`), the plan lint (`S/run-plan-lint.cjs:281`) and the gate's `MARKED` lines (`S/run-gate-marks.cjs:38`).
2. **The plan lint passes such a line in silence.** With `gateMark` null, the lint asks only for a code span (`S/run-plan-lint.cjs:281-284`), and a criterion that names its command in backticks has one. So the mark's name is never held to the config either. The flow already guards the other mark this way: the after-ship mark has `NEAR`, "any spelling of the mark, so plan-lint can refuse one the scripts would not read" (`S/run-after-ship.cjs:27-28`, read at `S/run-plan-lint.cjs:126` and `:278`). The gate mark has no such check.
3. **The intent review then owes the criterion with no reason.** `mutantGaps` (`S/run-mutant-coverage.cjs:190-209`) names a late, unheld or unproven mark in the owed line, and a mark it cannot read gets the bare line. The orchestrator and the reviewer see a criterion that ends in `(gate: <name>).` reported as owing a mutant, with nothing that says the mark was not read. The criterion is one no mutant can reach, as its mark says, so the reviewer has nothing to propose. The gate prints no `MARKED` line for it either.
4. **The planner text asks for the right thing, and the planner does not keep to it.** `agents/planner/agent.md:156` says the criterion "ends its line with `(gate: <name>)`". On the first host, 73 of the 327 criteria that hold a gate mark end on `).`.

## Evidence

The first host's Delta (Debian), intent `the-article-14-drafts-cite-ask-and-print-what-the-law-owes`, tree `~/dev/Skoft_CRA-inferno-the-article-14-drafts-cite-ask-and-print-what-the-law-owes`, its `flow.lock` at `a8873ebb`. Its plan was written on 2026-11-17 (`068356f2b`). Times UTC.

- Four criteria end on `).`: `a14-the-distributor-and-the-public-notice-duties-are-asked` 4, `a14-the-drafts-name-the-users-duty-and-the-sharing-request` 6 and `a14-the-legacy-record-names-the-modified-part` 3, each `` `npm run lint:copy` exits 0 (gate: npm run check). ``, and `a14-the-portal-profile-reads-enisas-glossary-1-6` 4, which ends `(gate: cargo test --manifest-path src-tauri/Cargo.toml).`. Both names are commands of the host's `verification.finalize`: `gateHeld` is true for each, measured on Delta 16:27Z with the tree's own config.
- 15:50:12Z, `30ea34ddb`: the scan. 15:55:13Z: the intent reviewer (subagent `ad68a07379a908f53`) ran `itemProofs` and `mutantGaps` over the tree and got all four in its owed lines, each with `late [] unheld [] unproven []` and no reason.
- 16:24:05Z, `1ce15f56b`: the intent review, verdict fix for other findings. For the three lint criteria the reviewer proposed check mutants (`npm run lint:copy`, `check: true`, a full stop made `!`), all caught. For item 7's criterion 4 it had none.
- 16:24:31Z, `267f50fe9`, a commit of that spec alone: the full stop after item 7's mark dropped, words and order unchanged.

Measured on Delta 2026-11-20 16:27Z, read only, with the tree's `gateMark`, `itemProofs` and `mutantGaps` over the record of `1ce15f56b`:

| The tree at | Item 7, criterion 4 | The three lint criteria | Owed with the record's entries |
| --- | --- | --- | --- |
| `30ea34ddb` | no mark read | no mark read | (the reviewer's run above) all four |
| `267f50fe9` | mark read, `cargo test --manifest-path src-tauri/Cargo.toml`, held, not late | no mark read, held by the caught check mutants | none |

Counted on Alpha 2026-11-20 16:28Z over the first host's origin/main at `6561c3642`, with `acceptanceCriteria` and `gateMark` of `a8873ebb` over all 1450 work items, live and archived: 327 criteria hold `(gate:`, 253 are read, 74 are not, in 18 intents. 73 of the 74 end on `).`, and one carries the mark mid-line (`` (gate: windows), and `cargo test ...` passes on Linux. ``). In the host's 14 planned intents, 9 of those criteria name what the config does not hold (`smoke`, `windows`, `npm run test`) or stay unread with the full stop dropped: the plan lint never saw them, since it read no mark.

The script's output on Alpha, 2026-11-20 16:30:56Z, on `a8873ebb` and again on the tip `84c5eabd`: case 1, a criterion `... (gate: echo gate ran).`, the intent review is refused with `verdict clean while a-one owes a caught mutant or a checked pin for criteria 2 "the size cap holds on every file under `src/` (gate: echo gate ran)."` where the test wants it recorded; case 2, a mark with words after it, the plan lint prints `clean alpha: 2 open items, 1 criteria` where the test wants a finding; the two controls pass, the second of them the host's way through (below).

- A second host intent, the Omega session `licence-forbids` (its outbox line 106), 2026-11-21, on `a8873ebb`, verbatim: "FLOW a gate mark ending in \"(gate: ...).\" is void: run-criterion-marks.cjs:48 MARK matches only a mark at line end, and the planner writes the period | evidence: intent review record refused mining 4,5,7,8 and wiki 5 with the marks present | workaround: spec-only commits faa933189 and 19be36018 drop the trailing period, record clean". Five criteria in two items, so the planner writes the full stop as a habit, and point 1 of the fix (read the mark before a closing full stop) is what removes it; the planner text needs no rule of its own.

## How to fix

1. **The reader takes the full stop of the sentence.** In `MARK` (`S/run-criterion-marks.cjs:48`) allow one full stop after the closing parenthesis: `/(?:^|\s)\(gate:\s*(.*?)\s*\)\.?$/`. The criterion's text is unchanged, so the late rule (`planned`, `:129-135`) reads it as before, and every plan already written with the full stop reads as its planner meant it. The planner text needs no word more, and no host has to touch a plan.
2. **The plan lint refuses any other `(gate:` it cannot read.** Beside `NEAR` of the after-ship mark, a `GATE_NEAR` in `S/run-criterion-marks.cjs` (`/\(\s*gate\b\s*:?/i`), and in `itemFindings` (`S/run-plan-lint.cjs:281-284`) a criterion that matches it while `gateMark` is null is the finding `acceptance criterion <n> holds a gate mark that does not end its line: end the line with (gate: <name>)`. The mid-line mark above is that case. Once read, a mark's name is held to the config as today, so the 9 unheld names surface at plan time, not at the intent review.
3. **The owed line names it for a criterion past the lint.** A completed or in-flight item is never linted again, so in `mutantGaps` (`S/run-mutant-coverage.cjs:201-202`) a criterion that matches `GATE_NEAR` with no mark read gets the reason ` (its line holds a gate mark that does not end it: end the line on the mark in a commit of its spec alone)`, beside `LATE`, `UNHELD` and `UNPROVEN`.

Tests, beside `S/run-criterion-marks.test.cjs` and the plan lint's. The script's cases 1 and 2 are red on `a8873ebb`, and its two controls green; after the fix all four are green, and:

- `gateMark` reads `npm run check` from a line ending `(gate: npm run check).`, and null from one ending `(gate: npm run check)..` or `(gate: npm run check) and more`.
- The gate prints a `MARKED` line for a mark with the full stop after it (`S/run-gate-marks.test.cjs`).
- The intent review's owed line for a completed item whose criterion holds a mark mid-line carries the reason of point 3.
- A full stop after a mark that names nothing the config holds is the plan lint's unheld finding, as without it.

## Which part is the flow and which the host

The defect is the flow's: its reader, its lint and its owed line. The host's part is its plans as data, not for the builder of the row. With point 1 installed the 63 other unread marks of the host's planned intents read as meant. The 9 that name `smoke`, `windows` or `npm run test`, or sit mid-line, then meet the plan lint at their intent's first `frontier`, and the host corrects them to `verification.smoke`, `verification.windows` and `npm test`.

## Until it is built

On the host: a criterion that carries a gate mark ends its line on the mark's `)`, with no full stop after it. Where the full stop stands in an intent already running, a commit of that spec alone drops it before the next intent review is recorded, words and order unchanged, as `267f50fe9` did. Measured: the mark then reads and counts, after the item's review as well. A criterion the mark cannot serve keeps a caught mutant or a checked pin instead.

## The script

Run with `S=<scripts folder of the flow> node --test --test-reporter=tap <file>`. Four seconds on Alpha. It uses the flow's own gate mark fixture.

```js
'use strict';

// A planner writes an acceptance criterion as a sentence and ends it with a full stop after its
// gate mark, "(gate: npm run check).", as 73 of 327 marked criteria in the first host's plans do.
// The reader takes a mark only when ")" ends the line, the plan lint passes the line because it
// holds another code span, and the intent review owes the criterion a mutant with no reason given.
// Run with S=<the scripts folder of the flow to test> node --test --test-reporter=tap <file>.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { git, write } = require(path.join(process.env.S, 'review-fixture.cjs'));
const { SPEC, aOne, intentReview, itemReviewed, lint, planned, shown } = require(path.join(process.env.S, 'run-criterion-marks-fixture.cjs'));

const MARKED = 'the size cap holds on every file under `src/` (gate: echo gate ran)';

test('a gate mark followed by the full stop of its sentence is read, and the intent review owes it nothing', () => {
  const { fixture, tree } = planned(`${MARKED}.`);
  itemReviewed(fixture, tree);

  const result = intentReview(fixture, tree);

  assert.equal(result.code, 0, shown(result));
});

test('a gate mark the reader does not take is a plan lint finding, never a silent pass', () => {
  const { fixture, tree } = planned(`${MARKED}, on every platform`);

  const result = lint(fixture, tree);

  assert.equal(result.code, 2, shown(result));
  assert.match(result.out, /^FINDING a-one: acceptance criterion 2 .*gate/m);
});

test('control: a gate mark that ends its line is read, and the plan lint is clean', () => {
  const { fixture, tree } = planned(MARKED);
  const clean = lint(fixture, tree);
  assert.equal(clean.code, 0, shown(clean));
  itemReviewed(fixture, tree);

  const result = intentReview(fixture, tree);

  assert.equal(result.code, 0, shown(result));
});

test("control, the host's workaround: the full stop dropped after the item's review in a commit of the spec alone counts", () => {
  const { fixture, tree } = planned(`${MARKED}.`);
  itemReviewed(fixture, tree);
  write(tree, SPEC, aOne(MARKED));
  git(tree, ['commit', '-qm', 'criterion 2 ends on its gate mark', '--', SPEC]);

  const result = intentReview(fixture, tree);

  assert.equal(result.code, 0, shown(result));
});
```
