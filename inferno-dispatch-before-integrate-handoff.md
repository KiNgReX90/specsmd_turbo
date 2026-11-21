# Handoff: dispatch-log takes an item that frontier holds waiting, so the next builder works in the one tree while the item before it still owes its review record and its integrate

Row 0am. Found on the first host on 2026-11-20 by an observer that read the shipped intent `candidate-1-the-ground` from its records, and checked against the orchestrator's transcript, the run branch and the code. The run used the build at `f3be640a` until 2026-11-19 and `a8873ebb` after; the code below is the same in both. Reproduced on `a8873ebb` and the tip `d4a64f2f` with the script at the end.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `a8873ebb`, whose `src/` the tip holds byte for byte.

## What is wrong

1. **frontier holds the rule, and nothing in a call keeps to it.** `frontier` gives out an item only when every item it depends on is integrated: `completedIds` takes the integrated items and `unblocked` asks each `depends_on` to be in it (`S/run-frontier.cjs:163-169`, the same at `f3be640a` `:187-193`); the rest print `waiting <item> on <dependency>`. `dispatch-log` (`S/run-intents.cjs:343-375`) refuses only an ownership overlap (`refuseOverlap`) and logs any item it is given, a waiting one too. The orchestrator text says the same as frontier (`agents/orchestrator/agent.md:40`, dispatch the ready frontier; `:60`, serialize items that share a compile tree; `:78`, run frontier after the integrate and dispatch what it unblocked), so the rule lives in prose at the moment it is tempting to break.
2. **frontier prints a built item as `ready`.** `ready` is drawn from `open` (`S/run-frontier.cjs:181-187`), which holds every unblocked item that is not integrated, a built and reviewed one too. The word an orchestrator dispatches on then stands beside an item that is already built, while the item that really comes next prints `waiting`.
3. **What an early dispatch costs.** The next builder's uncommitted edits sit in the one tree. The record of the item before it then runs no mutant (`S/run-review-mutants.cjs:37`, the proposals go to the intent review), or refuses outright when a dirty file is the item's own (`S/run-review.cjs:308-312`, `DIRTY`), and its integrate refuses dirt that a check reads (`S/run-integrate.cjs:254-259`). Every built item then waits for the next builder to commit.

## Evidence

The first host's Delta (Debian), intent `candidate-1-the-ground`, tree `~/dev/Skoft_CRA-inferno-candidate-1-the-ground`, orchestrator transcript `779d3570-db74-4eb4-8504-9da390a586e2.jsonl`. The plan at `c7cc66eaa` is one chain of 12 items, each depending on the one before it. Times UTC.

- 2026-11-17 15:19:01Z, the first `frontier`: `ready c1g-a-tray-check-with-unreadable-settings-sends-nothing ...` and eleven `waiting <item> on <the one before>` lines.
- 16:38:59Z, the orchestrator: "Tray item is in review; to save a cycle I'm building the small dead-code item alongside it on the cheap tier, since the two share no files." Its `frontier` at 16:39:05Z printed `ready c1g-a-tray-check-with-unreadable-settings-sends-nothing medium behavior strong claude-opus-5-5` for the item in review; the dead-code item's `waiting` line was filtered out of the call. `dispatch-log` of the dead-code item exited 0.
- 17:50:07Z, `dispatch-log --items c1g-every-command-runs-on-any-tauri-runtime,c1g-one-test-door-registers-every-command` logged dispatch `aefc55ca`, while the dead-code item they depend on was in review ("preparing the next builder ... to run alongside them", 17:48:49Z).
- 19:48:12Z, `dispatch-log --items c1g-the-licence-a-gated-command-asks-is-managed-state,...` logged dispatch `ae3d0843`, while the runtime and door items were in review and none of the intent was integrated.
- 16:48:15Z and 17:43:38Z, the tray item's record: "no mutant ran: the tree holds uncommitted work in src-tauri/src/commands/dossier.rs, src-tauri/src/commands/product_generation_tests.rs, src-tauri/src/commands/sbom.rs, so 5 proposals stay owed to the intent review".
- 23:03:05Z, the runtime item's record: `ERROR [DIRTY] refusing to review c1g-every-command-runs-on-any-tauri-runtime over uncommitted work in src-tauri/src/commands/license.rs`. It recorded on 2026-11-18 at 13:19Z (`0aa41720f`), after the licence batch committed (`2aff19c73`, 13:16Z).
- The session's status mail, outbox line 102: "0 of 12 items integrated (0%): 4 are built, committed and reviewed clean, and integrate waits for the licence, mode and read-only batch to commit so the tree is clean".
- No item integrated from the tray item's clean review (`51e65d241`, 2026-11-17 17:43Z) to the first integrate at 2026-11-18 13:34:38Z: 19 h 51 min. Most of it is not this defect's: the account's usage limit stopped every agent from about 21:00Z to 23:00Z, and the host's machine lock queue and a hold kept the licence builder's own checks waiting (its `cargo check` about 4 h in the queue for an 84 s run). Of the 14 h 31 min from 23:03Z, 10 h 00 min were the host's queue and hold, so at most 4 h 31 min was this defect's, plus 5 mutants moved to the intent review.

## How to fix

1. **dispatch-log refuses an item that waits.** In `dispatchLog` (`S/run-intents.cjs:343`), before `refuseOverlap`, for each requested item that has no dispatch or review yet (`startedItems`, `S/run-manifest-paths.cjs`): every item in its `depends_on` is integrated (`itemIntegrated`, `S/run-frontier.cjs:55`) or is in the same dispatch. Otherwise refuse with exit 2 and the code `WAITING`, before anything is written: `refusing to dispatch <item>: it waits on <dependency>, which is not integrated. Integrate <dependency>, then run frontier.` A correction of an item that holds a record and a join of chains already dispatched (row 0ae's clearing step) log as today, since neither puts a new builder ahead of an integrate.
2. **frontier prints a built item apart.** In the out lines (`S/run-frontier.cjs:233-235`), an item in `started` that is not integrated prints `built <item> owes <its review record | its integrate>`, never `ready`, and `--json` lists it under `built`. It stays in the serialize and candidate computations as today, so only its line changes, and `ready` means one thing: dispatch this.
3. **No text change.** `agents/orchestrator/agent.md:40`, `:60` and `:78` already say it.

Tests, beside `S/run-frontier.test.cjs` and the dispatch-log suite. The script's cases 1 and 2 are red on `a8873ebb` and the tip, and its two controls green; after the fix all four are green, and:

- An item whose dependency is integrated is logged.
- A `dispatch-log` over an item of each of two chains already dispatched, as row 0ae clears an overlap, is logged.
- `frontier --json` lists the built item under `built` and not under `ready`.

## Which part is the flow and which the host

The defect is the flow's: its dispatch step and its frontier's words. Why the orchestrator reached past the rule is the host's: its integrates waited hours in the machine lock queue, which the host handles on its side. Nothing here is for the builder of the row on the host's side.

## Until it is built

On the host: the orchestrator dispatches only an item that `frontier` prints `ready` and that has no dispatch or review yet, and a `ready` line for an item already built is no dispatch. A dependent item waits for its dependency's integrate, also when the integrate waits in the machine queue.

## The script

Run with `S=<scripts folder of the flow> node --test --test-reporter=tap <file>`. Three seconds on Alpha. It uses the flow's own frontier fixture.

```js
'use strict';

// A plan that is one serial chain: a-panel depends on a-tile. frontier holds a-panel waiting until
// a-tile integrates, yet dispatch-log logs a-panel while a-tile is only built and committed, so a
// second builder works in the one tree while a-tile's review record and integrate are owed. And
// frontier still prints the built a-tile as ready, the word an orchestrator dispatches on.
// Run with S=<the scripts folder of the flow to test> node --test --test-reporter=tap <file>.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { fixture, item, run } = require(path.join(process.env.S, 'run-frontier-fixture.cjs'));

const STATE = 'project:\n  name: demo\nintents:\n  - id: alpha\n    title: "Alpha"\n    status: in_progress\n' +
  '    base_branch: main\n    depends_on_intents: []\n    work_items:\n' +
  '      - id: a-tile\n        title: "A tile"\n        kind: behavior\n        complexity: low\n        status: pending\n        depends_on: []\n' +
  '      - id: a-panel\n        title: "A panel"\n        kind: behavior\n        complexity: low\n        status: pending\n        depends_on: [a-tile]\n';
const ITEMS = {
  'alpha/a-tile': item({ id: 'a-tile', intent: 'alpha', editable: ['src/board/tile.ts'] }),
  'alpha/a-panel': item({ id: 'a-panel', intent: 'alpha', editable: ['src/panel/panel.ts', 'src/panel/panel.test.ts'] })
    .replace('depends_on: []', 'depends_on: [a-tile]'),
};
const shown = (result) => result.out + result.err;
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const log = (tree, items) =>
  run(tree, ['dispatch-log', 'alpha', items.includes(',') ? '--items' : '--item', items, '--tier', 'strong',
    '--agent', 'specsmd-inferno-builder', '--tree', tree.root]);

/** a-tile dispatched and committed by its builder, not yet reviewed or integrated. */
function built() {
  const tree = fixture({ state: STATE, items: ITEMS });
  const first = log(tree, 'a-tile');
  assert.equal(first.code, 0, shown(first));
  fs.writeFileSync(path.join(tree.root, 'src/board/tile.ts'), 'export function renderTile(width) {\n  return width * 2;\n}\n');
  git(tree.root, ['commit', '-qam', 'a-tile: built']);
  return tree;
}

test('dispatch-log refuses an item whose dependency is built but not integrated', () => {
  const tree = built();
  const waiting = run(tree, ['frontier', 'alpha', '--tree', tree.root]);
  assert.match(waiting.out, /^waiting a-panel on a-tile/m, shown(waiting));

  const result = log(tree, 'a-panel');

  assert.equal(result.code, 2, shown(result));
  assert.match(shown(result), /a-tile/);
});

test('frontier prints a built item apart from the ready ones', () => {
  const tree = built();

  const result = run(tree, ['frontier', 'alpha', '--tree', tree.root]);

  assert.doesNotMatch(result.out, /^ready a-tile /m, shown(result));
});

test('control: a chain dispatched as one batch is logged', () => {
  const tree = fixture({ state: STATE, items: ITEMS });

  const result = log(tree, 'a-tile,a-panel');

  assert.equal(result.code, 0, shown(result));
});

test('control: a correction of the built item is logged again', () => {
  const tree = built();

  const result = log(tree, 'a-tile');

  assert.equal(result.code, 0, shown(result));
});
```

On Alpha, 2026-11-20 20:1xZ, on `a8873ebb` and on the tip `d4a64f2f`: case 1 fails with `logged a-panel -> .../dispatch/alpha.log` and `dispatch <id>` where the test wants exit 2, case 2 with `ready a-tile low behavior cheap` beside `waiting a-panel on a-tile`, and both controls pass.
