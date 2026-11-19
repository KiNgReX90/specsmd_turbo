# Handoff: a change made between two dispatches enters the next baseline unseen, and from then on a late correction of any older item can never be verified

Row 0ah. Found on the first host on 2026-11-19, at the intent review of `every-inventory-is-filed-through-one-store-register`, on the build at `a8873ebb`, the tip. Reproduced on `a8873ebb` and on `f3be640a` with the script at the end: both behave the same, so it is no transition case of an install.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `a8873ebb`.

It is the shape of section 8 of the 0.1.83 handoff (built in `7bdf52ff`, text in history at `912c9feb`): a correction of a completed item after later items ran. Section 8 covered a later dispatch's change. This is a change no dispatch made.

## What is wrong

1. **`dispatch-log` takes the tree as it finds it.** The new record's `beforeSnapshot` is the tree now (`S/run-dispatch.cjs:188`). A product file changed after the last snapshot and before this `dispatch-log` (here the orchestrator's own `git mv`, which the next item's spec asked for and the host lets no builder run) becomes part of that baseline. `dispatch-log` says nothing: it refuses only an overlap with an open dispatch (`S/run-intents.cjs:355`, `S/run-dispatch-overlap.cjs:41-54`).
2. **No record can ever claim it.** The item whose baseline holds the change cannot report it: `accept-dispatch` takes a path only when it changed since this dispatch or since the lineage's first baseline (`S/run-dispatch.cjs:229-235`), and that baseline already holds it, so it is refused as "accepted paths have no dispatch patch". Only a lineage older than the change could carry it, and that lineage's items do not own it.
3. **Every older lineage reads it as nobody's.** `unexplainedChanges` walks an item's timeline from its first baseline (`S/run-peers.cjs:255-282`). No run spans the stretch between the last accept and the next baseline (`runAt`, `S/run-peers.cjs:243-247`), so the change is flagged, and a path the item does not own goes to `outside` (`S/run-attribute.cjs:117-120`), which fails the proof (`S/run-item-proof.cjs:376`).
4. **It shows only when nothing can clear it.** In the planned order no `verify-item` reads that stretch: the item that comes next has it in its baseline, and the items before were verified before it happened. It surfaces at a late correction of an earlier item, typically sent by the intent review. Then no call clears it: no record can claim it (point 2), `--since <ref>` reads the specs and not the correction's grants (section 1h says so), `--peers` takes current records only, and a join of the chains carries nothing, since no lineage of the items that own the paths can claim them. Its change is not the corrected item's either: it lies after one of its attempts was accepted and before the next began, when no builder of it ran.

## Evidence

The first host's Delta (Debian), intent `every-inventory-is-filed-through-one-store-register`, ten items, all integrated, tree `/home/ruben/dev/Skoft_CRA-inferno-every-inventory-is-filed-through-one-store-register`, its `flow.lock` at `a8873ebb`. Dispatch records in `~/.cache/specsmd-inferno/Skoft_CRA/dispatch/f9a15ed4.../`, sequence at 46. Times UTC, from the dispatch log and the session's transcript.

The orchestrator moved files with `git mv` right before three `dispatch-log` calls, in one shell call each:

| When | Move | The dispatch it ran before |
| --- | --- | --- |
| 2026-11-17 19:18:04Z | `storage/sbom/scan/database_setup.rs` and three test files to `vuln/scanner_database*.rs` | `31b75293`, item 4 `reg-the-scanner-database-setup-lives-in-the-watch`, seq 11 |
| 2026-11-18 14:27:15Z | `commands/agent_discard_record_tests.rs` to `storage/sbom/pending_discard_record_tests.rs` | `675dd023`, item 5 `reg-confirm-and-discard-live-in-the-store`, seq 18 |
| 2026-11-18 23:44:08Z | `storage/sbom/import/recovery.rs` to `storage/sbom/retained_imports.rs` | `1f4b1b25`, item 7 `reg-an-import-files-through-the-register`, seq 25 |

What the records hold, read with `node -e` (all paths under `src-tauri/src/`):

- Seq 17 is item 4's `dad59025` accepted at `374dab890`: `agent_discard_record_tests.rs` has bytes `7e2940a8`, `pending_discard_record_tests.rs` is absent. Seq 18 is item 5's `675dd023` before, at `9a736a15b`: the first is absent and the second holds `7e2940a8`, while the commit `9a736a15b` still holds the first. The move was staged, not committed. No record's window spans 17 to 18, and no record of item 5 claims either path.
- Seq 24 is item 6's `731a4357` accepted: `recovery.rs` holds `0c91a8c5`. Seq 25 is item 7's `1f4b1b25` before, at `f263df482`: `recovery.rs` is absent and `retained_imports.rs` holds `0c91a8c5`. No window spans 24 to 25. Item 7's `b4ee1aca` and `c7bdb11e` claim `retained_imports.rs`, for its later edits only.
- The intent review sent item 4 a two-line fix of `docs/first-update.md:100-101`. Dispatch `f98f1072`, 2026-11-19 13:29:53Z, seq 44 before at `eba4c97f4`, seq 45 accepted with `filesModified: [docs/first-update.md]`, the path granted to it. Committed as `b30c6bd9d` at 16:21:32Z.

`verify-item reg-the-scanner-database-setup-lives-in-the-watch`, 16:21:40Z to 16:22:15Z, exit 2:

```
PASS 0s bash .../remote-run.sh auto '<tree>' bash -c 'test ! -e src-tauri/src/storage/sbom/scan/database_setup.rs'
outside reg-the-scanner-database-setup-lives-in-the-watch ownership.editable: src-tauri/src/commands/agent_discard_record_tests.rs, src-tauri/src/storage/sbom/import/recovery.rs, src-tauri/src/storage/sbom/pending_discard_record_tests.rs, src-tauri/src/storage/sbom/retained_imports.rs
```

Item 2's correction (`22d851d5`, seq 43 to 46, first baseline seq 3) listed those four too, with item 4's own move of seq 10 to 11 beside them. Item 2 went through with `--since b30c6bd9d`, since its one path is in its spec. Item 4's cannot: its one path is a grant, so `--since` lists it as outside. The item review that follows needs a passing proof: reviewer rule 1 makes `passed: false` a blocker, and with no proof an item that owns a journey under `real_app.paths` is refused (`S/run-real-app-prove.cjs:92-96`).

The script's output on Alpha, 2026-11-19 16:4xZ, the same on `a8873ebb` and `f3be640a`: case 1 `dispatch-log` exits 0 over a staged move no dispatch made, where the test wants 2; case 2 the late correction of `a` exits 2 with `"outside":["b-new.cjs","b-old.cjs"]`, after `accept-dispatch` of `b` refused the moved paths; case 3, the control, the same move made right after `b`'s `dispatch-log` and reported by it, passes.

## How to fix

1. **`dispatch-log` refuses a change no dispatch made.** Beside `refuseOverlap`, before anything is written (`S/run-intents.cjs:353-355`): take the tree's last snapshot, the highest `seq` among its records, and the tree now. A path whose bytes differ between them, outside the ledger, outside the fold ranges of the base since that snapshot, and under no open record's frozen ownership, is the stretch `unexplainedChanges` would later flag. Exit 2, before the record, naming the paths and the way: put them back, run `dispatch-log`, then make the change, and list its paths, both ends of a move, in that dispatch's `accept-dispatch`. A correction is no exception, and a tree with no record yet has nothing to compare.
2. **A late correction no longer answers for a change made between its attempts.** In `unexplainedChanges`, a change between two neighbouring snapshots that no run claims, lying after one of the item's attempts was accepted and before its next attempt began, is not added to the item's stretch for a path the item neither owns nor claims. `verify-item` prints such paths on a line of their own (`changed between dispatches, no dispatch claims: <paths>`) and keeps them out of `outside`, so the proof passes on what the item's own attempts did. This is the reading `ranBeside` gives a peer's run (`S/run-peers.cjs:79-82`). A change during one of the item's attempts or after its last one is read as today, and a path the item owns stays under `unreported` as today. Point 1 keeps new trees free of such changes; point 2 lets a tree from before the build finish.

Tests, beside `S/run-attribution.test.cjs`, with the fixture of `S/run-attribution-fixture.cjs`. The script's cases 1 and 2 are red on `a8873ebb`, and case 3 is green:

- Case 1: a staged `git mv` between `a`'s accept and `b`'s `dispatch-log` makes `dispatch-log` exit 2 naming both paths, and writes no record and no log line.
- Case 2: with `b`'s record written past the door, as the fixture's `startOverlapping` does, the late correction of `a` exits 0 with `outside: []` and prints both paths on the new line.
- Case 3, the control: the move made after `b`'s `dispatch-log` and reported in its accept still verifies `a`'s correction.
- A path `a` owns, changed between `a`'s attempts by no dispatch, is still under `unreported`, and a change after `a`'s last attempt with no attempt after it still reads as `outside`.

No agent text changes: the refusal carries the way on.

## Which part is the flow and which the host

The trigger is the host's: its `dispatch.constraints` forbid a builder any git mutation (`.specs-inferno/config.yaml:657` on the host's main `cbdbf6799`), and the intent's brief asks every whole-file move to go by `git mv` so a lint reads it as a rename (`brief.md:60` of that intent). So the orchestrator staged the moves itself, before the `dispatch-log`. The flow's part is that it took them in without a word and then left no way to prove any older item again. Nothing here is for the builder of the row on the host's side.

## Until it is built

On the host: a move the builder may not stage is staged by the orchestrator after `dispatch-log` and before the builder starts, and both paths of the move go into that dispatch's `accept-dispatch`. Nothing else changes in the tree between an accept and the next `dispatch-log` but the ledger and the fold. A late correction whose `verify-item` lists as outside only paths that changed between two dispatches, at a stretch no record's window spans, is settled on its commit without a fresh proof: the intent review run again reads it in its delta.

## The script

Run with `S=<scripts folder of the flow> node --test --test-reporter=tap <file>`. About 6 seconds on Alpha.

```js
'use strict';

// A change made between two dispatches, as the store intent met it: item a lands, the
// orchestrator moves b-old.cjs to b-new.cjs with git mv before b's dispatch-log, b lands, and a
// late correction of a is verified. Run with S=<the scripts folder of the flow to test>.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { fixture } = require(path.join(process.env.S, 'run-attribution-fixture.cjs'));

function setUp(t) {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs', 'b-old.cjs', 'b-new.cjs'] });
  f.git('rm', '-q', 'b-new.cjs');
  f.git('commit', '-qm', 'b-new.cjs is the target of a move');
  const first = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(first, ['a.cjs']);
  assert.equal(f.verify('a').code, 0);
  f.land('a.cjs');
  return f;
}

function lateCorrectionOfA(f) {
  const again = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 3;\n');
  f.accepted(again, ['a.cjs']);
  f.land('a.cjs');
  return f.verify('a');
}

test('dispatch-log refuses a change no dispatch made since the last snapshot', (t) => {
  const f = setUp(t);
  f.git('mv', 'b-old.cjs', 'b-new.cjs');
  const logged = f.call('dispatch-log', 'alpha', '--item', 'b', '--tier', 'strong', '--agent', 'builder', '--tree', f.root);
  assert.equal(logged.code, 2, logged.out);
  assert.match(logged.out, /b-old\.cjs/);
});

test('a late correction verifies when the only unclaimed change lies between two of its attempts', (t) => {
  const f = setUp(t);
  f.git('mv', 'b-old.cjs', 'b-new.cjs');
  const second = f.start('--item', 'b');
  f.write('b.cjs', 'module.exports = 2;\n');
  const moved = f.accept(second, ['b.cjs', 'b-old.cjs', 'b-new.cjs']);
  assert.notEqual(moved.code, 0, 'the move made before the dispatch-log cannot be reported');
  f.accepted(second, ['b.cjs']);
  assert.equal(f.verify('b').code, 0);
  f.land('b.cjs', 'b-new.cjs');
  const result = lateCorrectionOfA(f);
  assert.deepEqual(result.data && result.data.outside, [], result.out);
  assert.equal(result.code, 0, result.out);
});

test('control: the same move made after b\'s dispatch-log lets the late correction verify', (t) => {
  const f = setUp(t);
  const second = f.start('--item', 'b');
  f.git('mv', 'b-old.cjs', 'b-new.cjs');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(second, ['b.cjs', 'b-old.cjs', 'b-new.cjs']);
  assert.equal(f.verify('b').code, 0);
  f.land('b.cjs', 'b-new.cjs');
  const result = lateCorrectionOfA(f);
  assert.equal(result.code, 0, result.out);
});
```
