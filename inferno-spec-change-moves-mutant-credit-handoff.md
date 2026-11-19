# Handoff: a commit of the spec alone that inserts or removes an acceptance criterion credits every recorded mutant after it to its neighbour, though each one repeats the words of its own

Row 0aj. Found on the first host on 2026-11-19, at the intent review of `the-free-check-reads-short-and-the-result-says-why`, on the build at `a8873ebb`, the tip. Measured there with the flow's own functions on the item's spec and review, and reproduced on `a8873ebb` with the script at the end.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `a8873ebb`.

It is the shape of section 2 of the 0.1.84 handoff (row 0b, built in `38a92dc1` and `1b6e50c7`, text in history at `d5d82fa1`): a mutant credited to the wrong criterion, and nothing can move it. Row 0b made each entry repeat its criterion's opening words under `says` and holds them to the criterion at its number when the review is recorded. Here the review was right when it was recorded, and the spec changed after it.

## What is wrong

1. **The words are read once.** A first item review's entries are held to the criterion at their number by their `says` when the review is recorded (`itemCriterion`, `S/run-review-file.cjs:388-393`, with `saysProblem`, `S/run-criterion-says.cjs:57-79`). A delta review writes no entries: its record carries the last review's over and checks only that each still places on the tree (`S/run-review-mutants.cjs:115-128`). Pins are carried the same way, checked for their files and text and never for their words (`carriedPins`, `:87-103`, `pinProblem` in `S/run-review-pins.cjs:38-53`).
2. **Every count reads the number.** `names` (`S/run-mutant-coverage.cjs:172-177`) takes an item entry's leading number, whatever its `says` holds, and every reader goes through it: the intent review's gaps (`mutantGaps`, `:190`), the refusal of a second proposal (`refuseSecond`, `S/run-review-mutants.cjs:181-195`) and the moves (`S/run-mutant-moves.cjs:60`). The header holds the assumption: an entry with `says` "was checked when it was recorded and is never moved" (`S/run-mutant-coverage.cjs:28-30`).
3. **So a commit of the spec alone that inserts or removes a criterion moves the credit.** Every entry after the change names its neighbour. A criterion added after the review reads held by a mutant that never breaks it, and the criterion it pushed down reads owed while its own mutant sits one number above it. An added criterion that opens with the words of a recorded one makes that entry's words open two criteria, and its number still credits one.
4. **Nothing in the intent review can repair it.** A move of an entry that carries `says` is refused (`S/run-mutant-moves.cjs:15-16`, `:62-64`), and a proposal for a number an item mutant holds is refused (`refuseSecond`). The one way on is to put the criteria back in their recorded order with another commit of the spec alone.

## Evidence

The first host's Delta (Debian), intent `the-free-check-reads-short-and-the-result-says-why`, item `frs-an-answered-question-folds-and-every-answer-can-change`, branch `inferno-intent/the-free-check-reads-short-and-the-result-says-why-20261119T072855Z` on the host's origin, its `flow.lock` at `a8873ebb`. Times UTC, from the commits.

- 20:57:46Z, `32d7e2bdf`: the item's first review, verdict fix, with ten caught mutants under criteria 1 to 10, each with its `says`, against eleven criteria.
- 20:58:22Z, `eabc33ac5`, a commit of the spec alone that "takes the review's findings": it inserts the criterion whose Playwright case is "a result reached by an arrow key moves nothing" as number 8, line 31 of the spec, so criteria 8 to 11 become 9 to 12.
- 21:52:33Z, `bff8f8ef3`: the delta review, clean, `read: 0258b3b18..84c965b01`, carries all ten entries under their old numbers.
- 22:34:38Z, `fc0c2c432`: the intent review, fix. Its reviewer read the entries with `saysProblem` by hand. Its finding: criterion 8 "reads held by the JavaScript-off mutant while the arrowed guard it rests on ... was never mutated", and "This review cannot repair it: run-mutant-moves.cjs refuses a move of an entry that carries says, and refuseSecond of run-review-mutants.cjs refuses a proposal for a number an item mutant holds."
- 22:34:50Z, `ba834a796`, a commit of the spec alone, moves the arrow key criterion to the end. The intent review was then recorded clean at `6c99ae4ac` (`56c746741`, 22:47:34Z), with its own caught mutants for criteria 9 and 12.

Measured on Alpha, 2026-11-19 22:5xZ, with `names` and `saysProblem` of `a8873ebb` over the ten entries of `bff8f8ef3`:

| The spec at | Entries `names` counts for the number they carry | Entries whose words open another criterion |
| --- | --- | --- |
| `eabc33ac5`'s parent, 11 criteria | 1 to 10 | none |
| `eabc33ac5`, 12 criteria | 1 to 10 | 8 opens 9, 9 opens 10, 10 opens 11, and 7 opens 7 and 8 alike |
| `ba834a796`, 12 criteria | 1 to 10 | none, and 7 opens 7 and 12 alike |

The script's output on Alpha, 2026-11-19 22:55Z, on `a8873ebb`: case 1, with a criterion inserted at 2, `mutantGaps` owes criterion 4 where the test wants 2; case 2, with a criterion removed and one appended, it owes nothing where the test wants the appended one; case 3, with an appended criterion that opens with the words of entry 1, it owes only the appended one where the test wants both; the two controls pass.

## How to fix

1. **An entry with `says` names the criterion its words open.** In `names` (`S/run-mutant-coverage.cjs:172-177`), an item entry that carries `says` names criterion `n` only when `saysProblem(item.id, item.criteria, n, says)` is null, whatever number it carries. Its words then name one criterion or none. When they open none, or several alike, the entry holds no criterion, and the criteria it could name are the intent review's again. The number counts only for an entry without `says`, a released flow's. An intent review entry `<item>:<n>` with `says` reads the same way. Every reader then counts by the words: the gaps, `refuseSecond` and the moves.
2. **The delta record writes the number the words open.** Where it carries the last review's entries (`S/run-review-mutants.cjs:115-128`) and pins (`carriedPins`), an entry whose words open one other criterion is written under that number, with the line `MUTANT <n> is criterion <m> now: the spec moved it`. One whose words open none or several stays as recorded, with the line `MUTANT <n> holds no criterion as the spec stands: <why>; the intent review owes criteria <list> a caught mutant or a checked pin`.
3. **Nothing else moves.** A move of an entry with `says` stays refused, since point 1 places it by its words. An entry whose words still open its own criterion alone keeps its number, as after a gate mark appended to its line in a commit of the spec alone. The strict reading costs a mutant now and then: an appended criterion that opens like a recorded one leaves both owed, as entry 7 would at `ba834a796`. The other reading, which keeps the carried number while its words still open that criterion, credits an inserted criterion that opens like the one it pushed down, so it is not the fix.

Tests, beside `S/run-mutant-coverage.test.cjs` and `S/run-review-mutants.test.cjs`. The script's cases 1 to 3 are red on `a8873ebb`, and its two controls green; after the fix all five are green, and:

- A delta record after a commit of the spec alone that inserted a criterion writes the entries after it under their new numbers, prints each line of point 2, and lets the intent review propose for the inserted criterion.
- A pin carried over the same change moves the same way.
- An entry without `says` still counts for its number.

## Which part is the flow and which the host

All of it is the flow. The orchestrator put the new criterion where it read best, which nothing in the flow forbids. Nothing here is for the builder of the row on the host's side.

## Until it is built

On the host: a criterion added to an item whose review recorded mutants goes at the end of its Acceptance Criteria, never between two, and none is removed or reordered. Where one was, a commit of the spec alone puts them back in the recorded order before the next item or intent review is recorded.

## The script

Run with `S=<scripts folder of the flow> node --test --test-reporter=tap <file>`. Under a second on Alpha.

```js
'use strict';

// An item review's mutants repeat their criterion's opening words under says, checked when the
// review was recorded. A commit of the spec alone then changes the list, as the free check intent's
// eabc33ac5 inserted a criterion mid-list, and the intent review counts what each criterion holds.
// Run with S=<the scripts folder of the flow to test> node --test --test-reporter=tap <file>.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { mutantGaps } = require(path.join(process.env.S, 'run-mutant-coverage.cjs'));

const ID = 'demo-item';
const A = '`a` passes: the first thing holds';
const B = '`b` passes: the second thing holds';
const C = '`c` passes: the third thing holds';
const D = '`d` passes: the fourth thing holds';
const X = '`x` passes: the inserted thing holds';

/** A caught item mutant recorded under criterion `n`, repeating the first four words of `text`. */
const entry = (n, text) => ({
  criterion: n, says: text.split(' ').slice(0, 4).join(' '), file: 'src/a.cjs', line: n, find: 'x', replace: 'y', test: 'node --test', caught: 'yes',
});
const recorded = [entry(1, A), entry(2, B), entry(3, C)];
const gaps = (criteria) => mutantGaps([{ id: ID, criteria, mutants: recorded, pins: [], tested: true }], []);
const owes = (...pairs) => [`${ID} owes a caught mutant or a checked pin for criteria ${pairs.map(([n, text]) => `${n} "${text}"`).join(', ')}`];

test('a criterion inserted mid-list is owed, and the mutants after it hold the criteria their words open', () => {
  assert.deepEqual(gaps([A, X, B, C]), owes([2, X]));
});

test('a criterion removed leaves the mutant whose words open no criterion holding none', () => {
  assert.deepEqual(gaps([A, C, D]), owes([3, D]));
});

test('a criterion added that opens with the words of a recorded mutant leaves both owed', () => {
  const again = `${A}, and again`;
  assert.deepEqual(gaps([A, B, C, again]), owes([1, A], [4, again]));
});

test('control: the list as the review recorded it owes nothing', () => {
  assert.deepEqual(gaps([A, B, C]), []);
});

test('control: words appended to a criterion keep its mutant', () => {
  assert.deepEqual(gaps([A, `${B}, with more words`, C]), []);
});
```
