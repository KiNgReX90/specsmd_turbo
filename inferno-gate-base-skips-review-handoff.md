# Handoff: `gate --base` folds the head it names but judges the intent review against `delivery.base_branch`, so a gate stacked on the intent ahead re-owes a review that head never touched, over that head's whole diff

Row 0bc. Found on the first host on 2026-11-21, when its lead asked whether finished intents can ship as a merge train: the next intent folds the gated head of the one ahead instead of main, gates beside it on another machine, and ships on that gate once the one ahead merged. Read in the code of the build at `a8873ebb`; the tip `3d84aa25` holds the same code (`git diff a8873ebb 3d84aa25 -- src` is empty). Reproduced on the tip with the script at the end.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of the tip.

## What is wrong

1. **`--base` stops at the fold.** `gate` folds the base it is given (`S/run-gate.cjs:164`, `:272`, `foldBase` at `:80-105`) and reads the cases (`:170`, `:278`) and the lanes (`:287`) against it. Its intent review check takes no base (`gateRefusal`, called at `:172` and `:281`): the intent's own files are read against `resolveBase(config)` (`outsideHashes`, `S/run-intent-owed.cjs:112`), and so is the fold its refusal names (`:215`). `green` takes `--base` for the smoke lane only (`S/run-gate.cjs:401-402`), never for the review (`:400`).
2. **So under `review.outside: ["**"]` the head ahead becomes the intent's own work.** `ownFiles` diffs `<config base>...HEAD` (`S/run-intent-fold.cjs:31-37`, `:48-65`). Every file the head ahead changed counts as the follower's, the binding the review recorded no longer matches (`S/run-intent-owed.cjs:146-157`), and the gate exits 3 with the review owed (`:207-221`). `foldRanges` finds no fold of the configured base in that merge (`S/run-fold.cjs:35-58`), so the refusal says `the reviewer reads the base delta from there` (`S/run-intent-owed.cjs:216`). The delta review then reads the whole diff of the intent ahead, and the review it records binds that diff too.
3. **The one route that works today ends with row 0ar.** A gate config whose `delivery.base_branch` names the head ahead makes every reader agree, since `resolveBase` reads the config first (`S/run-intents.cjs:43-46`). Row 0ar's point 1 puts an intent's own `base_branch` first. Every intent of the first host names one (35 live, 299 archived), all but one `main`, so once 0ar is built that route reads `main` again.

## Evidence

- The script below, run on the tip on Alpha at 2026-11-21 14:57Z, passes both cases. In the first, `gate --base ahead` folds the head ahead and exits 3 with `intent review owed: the code changed since the review` and `the reviewer reads the base delta from there`, though that head touched no file of the intent. The same folded tree reads the recorded binding when the head is the config's base.
- The script's second case runs the host form to its end. A gate config that names the head ahead gates with exit 0. The head merges into main with `--no-ff`, and the follower's fold of main changes no file. `green` with the plain config put back at the same path exits 0, so the follower ships on the gate it ran beside the one ahead.
- A probe on Alpha at 2026-11-21 14:54Z with the first host's installed scripts (`a8873ebb`) in a scratch repository, the head ahead closed with a ledger-only commit before its merge: after the follower's fold of main, the whole-tree hash, a finalize proof key and a lane proof key equal the ones its stacked gate minted. The binding read against `main` equals the recorded one again. So the ship needs nothing once the head ahead is on the base.
- The first host's config on its main `2123ed657`: `review.outside: ["**"]` (`.specs-inferno/config.yaml:31`), `delivery.base_branch: main` (`:681`).

## How to fix

1. **The gate's base reaches the review.** `gateRefusal`, `intentReviewState`, `reviewCurrent`, `outsideHashes` and `foldBound` take the base the caller folded, and fall back to `resolveBase(config)` only without one. `gateNow` and `gateDetach` pass the `base` they folded (`S/run-gate.cjs:172`, `:281`), and `green --base` passes it to `mergeOwed` (`:400`).
2. **The review records against the same base.** `run.cjs review --tree <t> --base <ref>` records `tree_outside` and prints its fold lines (`foldLines`, `S/run-intent-fold.cjs:94-105`) against `<ref>`. A stacked tree whose head ahead changed one of its files then gets a delta that reads only that file's change.
3. **Ship stays as it is.** Once the head ahead is on the base, the binding read against the base is the recorded one (the probe above), and `green` finds every proof the stacked gate minted, since no proof is keyed on a commit (`S/run-proofs.cjs:150-157`).
4. **With row 0ar.** An explicit `--base` outranks both the intent's `base_branch` and `delivery.base_branch` for the readers of point 1. The merge target stays the intent's base.

Tests, beside `S/run-review-outside.test.cjs`:

- The script's first case turns: `gate --base ahead` exits 0 and prints no `intent review owed`.
- A head ahead that changed one of the intent's own files still owes the review, and the refusal names only that file (`changed what the review binds: <file>`).
- `gate` with no `--base` reads as today.
- After the head ahead merges into main and the tree folds main, `green` with no `--base` exits 0 on the proofs `gate --base` minted.

## Which part is the flow and which the host

The flow's part is points 1 to 4. The host's part, not for the builder of the row: the merge-train procedure (who stacks on whom, the ref at the head ahead, the Windows walk, the order of ships), its guard (the first host refuses a second `gate --detach` only against holds on the same machine), and its lanes, whose commands carry `--base main` (`.specs-inferno/config.yaml:628`, `:633`) and so walk the journeys of the head ahead again.

## Until it is built

On the host: the follower keeps a local branch `train/<id ahead>` at the gated head ahead, folds it, and gates with a gate config whose `delivery.base_branch` is that branch, at the same path as its plain gate config. Once the head ahead is on main, it puts the plain config back at that path and ships as usual. This works until row 0ar's point 1 is built, so build 0bc with it or before it.

## The script

Copy it to `S/` as `repro-gate-base-review.test.cjs` and run `node --test repro-gate-base-review.test.cjs` there. Today both cases pass. Once the fix holds, the first fails at its exit 3 assert, and the tests above replace it.

```js
'use strict';

// Reproduction for the handoff: `gate --base <ref>` folds the head of the intent ahead, but the
// intent review it checks after that fold reads the intent's own files against
// delivery.base_branch, so a head that touched none of them still re-owes the review, and the
// delta it prints reads that head's whole diff. The host form that works today names the head as
// the gate config's base, then puts the plain config back at the same path once the head is on
// main: the follower's tree after the fold of main is the tree its gate proved, so green holds.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { CONFIG, INTENT_TREE, git, intentReviewed, repo, run, worktree, write } = require('./review-fixture.cjs');
const lib = require('./run-lib.cjs');
const { outsideHash } = require('./run-intent-owed.cjs');

const GATED = CONFIG.replace('delivery:', '  finalize:\n    - echo gated\ndelivery:');
const OUTSIDE = GATED.replace('  model: model-review\n', '  model: model-review\n  outside: ["**"]\n');

/** The intent ahead: its own branch off main, with one commit to a file the follower never touches. */
function ahead(fixture) {
  const tree = path.join(path.dirname(fixture.root), 'ahead');
  git(fixture.root, ['worktree', 'add', '-q', '-b', 'ahead', tree]);
  write(tree, 'docs/b.md', 'the intent ahead\n');
  git(tree, ['commit', '-qam', 'the intent ahead']);
}

/** The follower: its own work on src/a.ts and a clean intent review recorded under review.outside. */
function follower(fixture) {
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, 'src/a.ts', 'export const a = 3;\n');
  git(tree, ['commit', '-qam', 'the work']);
  intentReviewed(tree, 'alpha', 'verdict: clean\n', lib.readConfig(tree));
  return tree;
}

test('gate --base on the head of the intent ahead re-owes a review that head never touched', () => {
  const fixture = repo({ config: OUTSIDE });
  ahead(fixture);
  const tree = follower(fixture);
  const recorded = outsideHash(tree, lib.readConfig(tree));

  const stacked = run(fixture, ['gate', '--tree', tree, '--base', 'ahead']);
  assert.equal(stacked.code, 3, stacked.out + stacked.err);
  assert.match(stacked.out, /folded ahead into/);
  assert.match(stacked.out, /intent review owed: the code changed since the review/);
  assert.match(stacked.out, /the reviewer reads the base delta from there/);

  // The same folded tree: read against main the head's file is the follower's own, read against the head it is not.
  const config = lib.readConfig(tree);
  assert.notEqual(outsideHash(tree, config), recorded);
  assert.equal(outsideHash(tree, { ...config, delivery: { base_branch: 'ahead' } }), recorded);
});

test('the host form today: the head as the gate config base, then the plain config at that path once the head merged, is green with no second gate', () => {
  const fixture = repo({ config: OUTSIDE });
  ahead(fixture);
  const tree = follower(fixture);
  const plain = fs.readFileSync(path.join(tree, '.specs-inferno/config.yaml'), 'utf8');
  const file = path.join(path.dirname(fixture.root), 'gate-config.yaml');
  fs.writeFileSync(file, plain.replace('base_branch: main', 'base_branch: ahead'));

  const gated = run(fixture, ['gate', '--tree', tree, '--config', file]);
  assert.equal(gated.code, 0, gated.out + gated.err);
  assert.match(gated.out, /folded ahead into/);
  const proved = git(tree, ['rev-parse', 'HEAD']);

  // The intent ahead ships into main, then the follower's ship folds main.
  git(fixture.root, ['merge', '-q', '--no-ff', '--no-edit', 'ahead']);
  git(tree, ['merge', '-q', '--no-edit', 'main']);
  assert.equal(git(tree, ['diff', '--name-only', proved, 'HEAD']), '', 'the fold of main changes no file');

  fs.writeFileSync(file, plain);
  const green = run(fixture, ['green', '--tree', tree, '--config', file]);
  assert.equal(green.code, 0, green.out + green.err);
});
```
