# Handoff: a grant, and verify-item after it, read a sibling's change as beside the item although that sibling was accepted and integrated before the item's dispatch that takes the path began, and a fresh dispatch never clears it

Row 0aw. Met on the first host on 2026-11-21 by the Omega session of `the-flow-logs-its-day-and-an-evening-reader-finds-what-went-wrong`, on the build at `a8873ebb`, read in its dispatch records, its tree's history and the code there. `run-grant.cjs`, `run-peers.cjs`, `run-attribute.cjs` and `run-dispatch.cjs` in that tree are byte for byte those of the tip `1d8c73ea`. Reproduced on the tip with the script at the end. Row 13 built the grant's check, and row 0z built the sibling's commit for paths an item already claims; this row is the case neither reaches, a path the item takes only after the sibling integrated. Rows 0ah and 0av are a change between two dispatches and one left out of an accept, not this.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of the tip.

## What is wrong

1. **The item's history starts at its first attempt, for every path.** `effective` (`S/run-dispatch.cjs:134-150`) takes the lineage's first baseline as the root, and a correction's `dispatch-log` chains `previous` (`:156-163`), so the root never moves. `layout` (`S/run-peers.cjs:210-236`) marks a peer run `beside` against all of the item's attempts (`ranBeside`, `:79-82`), and `besideAt` (`:290-301`) refuses any peer whose change at the path lies in a stretch it ran beside one of them.
2. **So a path the item did not own then still counts.** A sibling that changed the path while it ran beside the item's first attempt, was accepted, and was integrated under its own `Item:` trailer stays beside the item at that path for good. The grant's check (`checkBeside`, `S/run-grant.cjs:107-123`) refuses it, and once the item owns the path by its spec, verify-item refuses the same change as an overlap (`checkPeerChange`, `S/run-peers.cjs:189-202`). Its one excuse (`after`, `S/run-attribute.cjs:112-113`) covers only a sibling run that started after the item's accept, at a path the item already claims.
3. **The refusal's second way on cannot work.** It says "or let the change wait until <sibling> is integrated and dispatch <item> again" (`S/run-grant.cjs:121-122`). The sibling is integrated, and a fresh dispatch keeps the first root, so the refusal stands. The only way left is the chain call, which re-opens an item already completed.

## Evidence

The first host's Omega (Linux), intent `the-flow-logs-its-day-and-an-evening-reader-finds-what-went-wrong`, tree `~/dev/Skoft_CRA-inferno-the-flow-logs-its-day-and-an-evening-reader-finds-what-went-wrong`, records under `~/.cache/specsmd-inferno/Skoft_CRA/dispatch/b25f0654a07a.../`, sequence at 33. Read on Omega 2026-11-21 about 01:55Z, read only. Times UTC; `@n` is a snapshot's sequence number.

- The step-log item `flg-a-run-line-carries-the-red-and-lock-lines-its-step-logs-hold`: dispatches `18d737b3` (@8 to @10), `846c30e7` (@11 to @16), `5e98820f` (@18 to @19) and `f544f8a7` (@29 to @30, logged 01:48:44Z), each the `previous` of the next. None owned `scripts/flowlog/README.md`.
- The hook item `flg-the-hook-records-runner-calls-mail-agent-calls-and-agent-controls`, which owns the README by its spec: `0a271e57` (@9 to @13) and `ba37d553` (@15 to @17) changed it, `e7821a22` (@20 to @21) did not. Both runs that changed it ran beside the step-log item's first two attempts.
- The hook item's README changes are committed as `82232e539` (2026-11-20 23:16:02Z) and `ce91401eb` (23:43:10Z), each with `Item: flg-the-hook-records-runner-calls-mail-agent-calls-and-agent-controls`, and both are ancestors of `6ccbb7e0d`, the head of `f544f8a7`'s baseline. The ledger has the hook item `status: completed`, `completed_at: 2026-11-21T01:47:51Z`.
- `run.cjs grant f544f8a7 --path scripts/flowlog/README.md` was refused between 01:48:44Z and 01:49:01Z. The session's FLOW line, verbatim: "FLOW grant of scripts/flowlog/README.md to flg-a-run-line-... refuses DISPATCH_PROOF \"dispatch e7821a22 for flg-the-hook-records-runner-calls-... changed it beside this item\" although that hook item is already integrated (completed at 6bda713e6) | evidence: run.cjs grant f544f8a7 --path scripts/flowlog/README.md, 2026-11-21 ~02:00Z | workaround: dispatch-log --items step-log,hook as one chain (9486ae98) and the step-log builder writes the README rows under it".
- The refusal names `e7821a22`, the hook lineage's current record, though the changes were its earlier attempts' (`besideAt` returns `run.peer`, the lineage's record).
- The chain `9486ae98` (@31 to @32, logged 01:49:01Z) re-opened the completed hook item beside the step-log item. Its builder's README rows are `90f13bbd1` (01:50:24Z).
- The script below, run on the tip on Alpha at 2026-11-21 01:53Z, passes both of its tests, three claims: the grant on a correction is refused with that text after the sibling's `Item:` commit, a second fresh dispatch is refused the same way, and with the path in the item's spec instead, verify-item refuses `dispatch ownership overlaps at shared.cjs`.

## How to fix

1. **A path's history with the item starts at the first attempt that owned it.** In `layout` (`S/run-peers.cjs:210-236`) and `besideAt`, a peer run is beside the item at a path only against the item's attempts that owned that path: for a grant, from the attempt its grant entry names (`granted[].dispatch`) on; for a spec path, from the first attempt whose `assignment.ownership.editable` holds it. A run that ended before that attempt began is not beside the item at that path.
2. **Only when the sibling's change is integrated.** Excuse such a run only when the owning attempt's baseline holds the sibling's change. That means a commit in the history of the baseline's `head_sha`, after the item's root, changes the path and names the run's item in its `Item:` trailer, as `run-sibling.cjs` reads trailers. An accepted change that is not yet committed stays beside, as today, so an item's commit never carries a sibling's bytes.
3. **One rule for both readers.** The grant's check and verify-item's overlap read the same per-path attempts, so a grant that passes is never refused at verify-item for that path, and the refusal's "dispatch <item> again" holds once the sibling is integrated.
4. **The refusal names the record that changed the path.** It names the attempt whose window changed it (`run.member`), not the lineage's current record.

Tests, beside `S/run-grant.test.cjs`:

- The script's first test turns: a grant on a correction dispatched after the sibling's `Item:` commit is accepted, and verify-item of the item after its builder changes the path passes with `outside` empty.
- The script's second test turns the same way: the item owns the path by its spec from the correction on, and verify-item passes.
- A sibling accepted but not committed before the correction began still refuses the grant, as today, and the refusal names the attempt that changed the path.
- The existing case `a grant of a path an accepted dispatch changed inside the item's window is refused` stays refused.

## Which part is the flow and which the host

All of it is the flow's. Nothing here is for the builder of the row on the host's side.

## Until it is built

On the host: when a grant, or verify-item, refuses a path as changed beside the item by a sibling that is already integrated, do not wait and dispatch again, since that never clears it. Build the two items as one chain with the `dispatch-log --items <item>,<sibling>` call the refusal prints, and let the item's builder write the path under that chain.

## The script

Copy it to `S/` as `repro-grant-integrated.test.cjs` and run `node --test repro-grant-integrated.test.cjs` there. Today both of its tests pass; once the fix holds, both fail at their refusal asserts, and the tests above replace them.

```js
'use strict';

// Reproduction for the handoff: a grant is refused as "changed it beside this item" after the
// sibling that changed the path is integrated, and a fresh dispatch of the item does not clear it.

const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture } = require('./run-attribution-fixture.cjs');

test('a grant of a path an integrated sibling changed beside the item is refused, before and after a fresh dispatch', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs', 'shared.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('shared.cjs', 'changed by b\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(two, ['b.cjs', 'shared.cjs']);
  f.git('add', 'b.cjs', 'shared.cjs');
  f.git('commit', '-qm', 'b lands\n\nItem: b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['a.cjs']);
  f.git('add', 'a.cjs');
  f.git('commit', '-qm', 'a lands\n\nItem: a');
  assert.equal(f.git('status', '--porcelain'), '');
  const fix = f.start('--item', 'a');
  const refused = f.call('grant', fix, '--path', 'shared.cjs', '--tree', f.root);
  console.log('grant on the correction:', refused.code, refused.out.trim());
  assert.notEqual(refused.code, 0);
  assert.match(refused.out, /changed it beside this item/);
  assert.match(refused.out, /let the change wait until b is integrated and dispatch a again/);
  const again = f.start('--item', 'a');
  const still = f.call('grant', again, '--path', 'shared.cjs', '--tree', f.root);
  console.log('grant on a second fresh dispatch:', still.code);
  assert.notEqual(still.code, 0);
  assert.match(still.out, /changed it beside this item/);
});

test('verify-item reads the same integrated change as an overlap once the item owns the path by its spec', (t) => {
  const { spec } = require('./run-attribution-fixture.cjs');
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs', 'shared.cjs'] });
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write('shared.cjs', 'changed by b\n');
  f.accepted(two, ['shared.cjs']);
  f.git('add', 'shared.cjs');
  f.git('commit', '-qm', 'b lands\n\nItem: b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(one, ['a.cjs']);
  f.git('add', 'a.cjs');
  f.git('commit', '-qm', 'a lands\n\nItem: a');
  f.write('.specs-inferno/intents/alpha/work-items/a.md', spec('a', ['a.cjs', 'shared.cjs']));
  f.git('add', '-A');
  f.git('commit', '-qm', 'the planner widens a');
  const fix = f.start('--item', 'a');
  f.write('shared.cjs', 'changed by b\nthen by a\n');
  f.accepted(fix, ['shared.cjs']);
  const result = f.verify('a');
  console.log('verify-item a:', result.code, result.out.trim().slice(0, 400));
  assert.notEqual(result.code, 0);
  assert.match(result.out, /overlaps at shared\.cjs/);
});
```
