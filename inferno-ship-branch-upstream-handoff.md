# Handoff: ship's branch delete refuses a merged run branch that is one commit past its upstream, so ship ends on exit 2 after a good merge and prints a delete that fails the same way

Row 0ao. Found on the first host on 2026-11-20 by an observer that read the shipped intent `candidate-1-the-ground` from its records, checked against the orchestrator's transcript and the code, and reproduced on `a8873ebb` and the tip `d4a64f2f` with the script at the end.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `a8873ebb`, whose `src/` the tip holds byte for byte.

## What is wrong

1. **The delete asks the upstream, not the base.** `removeWorktree` (`S/run-ship.cjs:177-195`) deletes the run branch with `git branch -d` (`:186`). For a branch with an upstream, git asks whether the upstream holds the branch, and refuses when it does not, even when the base it was just merged into does: "not deleting branch ... that is not yet merged to refs/remotes/origin/..., even though it is merged to HEAD".
2. **A pushed run branch is one commit past its upstream at ship.** A host that pushes the run branch before the close and archive commit has exactly that branch at ship. The first host pushes it when the intent review is clean, and the flow's own `merge-request` mode pushes it too (`agents/orchestrator/agent.md:116`). The close and archive commit comes after (`agents/orchestrator/agent.md:115`).
3. **Ship stops before the host's cleanup and prints a step that cannot pass.** Ship has merged and verified the base, then exits 2 before `ship_cleanup` runs, and its `left to do:` line is the same `git branch -d`, which fails the same way. The orchestrator text says "Exit 2 after the merge prints what is left to do: do it" (`agents/orchestrator/agent.md:116`).

## Evidence

The first host's Delta (Debian), intent `candidate-1-the-ground`, orchestrator transcript `779d3570-db74-4eb4-8504-9da390a586e2.jsonl`. Times UTC.

- 2026-11-19 12:21:29Z, at READY: `git push -u origin "$b"` of the run branch, as the host's session brief asks.
- 20:06Z, `3cc293886`, the close and archive commit on the branch.
- 20:07:09Z, ship's output: `merged inferno-intent/candidate-1-the-ground-20261117T151840Z into main as e9c89cb26`, `main verified against origin/main`, `git branch -d inferno-intent/candidate-1-the-ground-20261117T151840Z failed in /home/ruben/dev/Skoft_CRA: warning: not deleting branch 'inferno-intent/candidate-1-the-ground-20261117T151840Z' that is not yet merged to`, then `left to do: git -C /home/ruben/dev/Skoft_CRA branch -d inferno-intent/candidate-1-the-ground-20261117T151840Z; INFERNO_BRANCH=... node scripts/ship-cleanup.mjs (in /home/ruben/dev/Skoft_CRA)`, exit 2.
- 20:07:35Z, by hand: `git branch --unset-upstream <branch> && git branch -d <branch>`, "Deleted branch inferno-intent/candidate-1-the-ground-20261117T151840Z (was 3cc293886)". 20:07:39Z, the host's cleanup by hand.
- Cost: one failed ship and two hand commands, 3 min, on every ship of a pushed run branch. A session that stops on the exit 2 leaves the host's cleanup undone.

## How to fix

1. **Delete against the base.** In `removeWorktree`, before the delete, `git -C <primary> branch --unset-upstream <branch>` when the branch has one, so `git branch -d` asks the primary's HEAD, the base ship has just merged into and verified. The delete keeps git's own merged check, so a branch the base does not hold still stops ship with exit 2 and stays.
2. **The left-to-do line names the call that passes.** When the delete still fails, `left` prints the two commands of point 1, never the bare `git branch -d`.

Tests, beside `S/run-ship.test.cjs` with its fixture. The script's case 1 is red on `a8873ebb` and the tip and its control green; after the fix both are green, and:

- A run branch the base does not hold is kept, and ship exits 2 with the left-to-do line of point 2.
- The host's `ship_cleanup` runs after the delete of a branch that had an upstream (`S/run-ship-cleanup.test.cjs`).

## Which part is the flow and which the host

The defect is the flow's: its delete step and the step it prints. The push at READY is the host's practice and stays. A host part beside it, not for the builder of the row: on 2026-11-19 at 20:05Z ship first refused with `NOT_COMPLETE`, since the lead's go named only ship; the host's go line names close and archive first, steps 5 and 6 of `agents/orchestrator/agent.md:115-116`.

## Until it is built

On the host: when ship ends on exit 2 after `main verified against origin/main` with `not yet merged to refs/remotes/...`, run `git -C <primary> branch --unset-upstream <branch> && git -C <primary> branch -d <branch>`, then the `ship_cleanup` line ship printed.

## The script

Run with `S=<scripts folder of the flow> node --test --test-reporter=tap <file>`. Five seconds on Alpha. It uses the flow's own run fixture, with its bare origin.

```js
'use strict';

// A host pushes its run branch when the intent review is clean (READY), and the close and archive
// commit comes after that push. Ship merges and verifies the base, then `git branch -d` refuses
// the branch: it is merged into the base but one commit past its upstream. Ship ends on exit 2
// before the host's cleanup, and the left-to-do line it prints is the same delete, which fails the
// same way. Run with S=<the scripts folder of the flow to test> node --test --test-reporter=tap <file>.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { closed, git, repo, run } = require(path.join(process.env.S, 'run-fixture.cjs'));

const shown = (result) => result.out + result.err;

/** The intent closed and gated, its branch pushed with an upstream one commit before its tip, or not at all. */
function readyPushed({ push }) {
  const fixture = repo();
  const { tree, branch } = closed(fixture);
  if (push) {
    git(tree, ['push', '-q', 'origin', `HEAD~1:refs/heads/${branch}`]);
    git(tree, ['fetch', '-q', 'origin']);
    git(tree, ['branch', `--set-upstream-to=origin/${branch}`]);
  }
  const gate = run(fixture, ['gate', '--tree', tree]);
  assert.equal(gate.code, 0, shown(gate));
  return { fixture, tree, branch };
}

test('ship deletes a merged run branch whose upstream lags its tip, and exits 0', () => {
  const { fixture, tree, branch } = readyPushed({ push: true });

  const result = run(fixture, ['ship', 'alpha', '--tree', tree]);

  assert.equal(result.code, 0, shown(result));
  assert.equal(git(fixture.root, ['branch', '--list', branch]).trim(), '');
});

test('control: a run branch that was never pushed ships with exit 0', () => {
  const { fixture, tree, branch } = readyPushed({ push: false });

  const result = run(fixture, ['ship', 'alpha', '--tree', tree]);

  assert.equal(result.code, 0, shown(result));
  assert.equal(git(fixture.root, ['branch', '--list', branch]).trim(), '');
});
```

On Alpha, 2026-11-20 20:1xZ, on `a8873ebb` and on the tip `d4a64f2f`: case 1 prints `main verified against origin/main`, then `git branch -d inferno-intent/alpha-<stamp> failed ...: warning: not deleting branch ... that is not yet merged to` and `left to do: git -C <root> branch -d inferno-intent/alpha-<stamp>`, and the control passes.
