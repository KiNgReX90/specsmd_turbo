# Handoff: verify-item reads a fold that git merged cleanly under the file's `merge=union` attribute as a change no fold explains, since `foldedAlone` merges with `git merge-file` and reads no attribute, while the review binding's `git merge-tree` reads the same fold as clean

Row 0bb. Met on the first host on 2026-11-21 by the Omega session `vuln-policy` (its outbox line 100), on the build at `a8873ebb`; the tip `0159628f` holds the same code. Reproduced on the tip with the script at the end.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of the tip.

## What is wrong

1. **Two owners of "the clean merge of both sides".** The review binding asks `git merge-tree --write-tree` (`autoMerge`, `S/run-review-hash.cjs:156-162`), which applies the file's merge attribute. Verify-item's `foldedAlone` re-merges with `git merge-file -p` (`mergeBytes`, `S/run-fold.cjs:131-145`, called at `:165`), which reads no attribute.
2. **So an append-only file that a host marks `merge=union` still fails the item's proof.** The fold merges cleanly, and the review stays current. But verify-item and integrate refuse `accepted dispatch bytes changed at <file>` (`S/run-attribute.cjs:101-108`), and the only way on is a fresh `dispatch-log` and `accept-dispatch` of bytes the item never wrote.
3. **A conflicted fold re-owes the review by design**, since a hand resolution is nobody's reviewed change (`S/run-review-hash.cjs:14-15`). A host that keeps an append-only ledger uses `merge=union` to avoid that conflict. Point 1 is what then stands in its way.

## Evidence

- The session's FLOW line, verbatim: "FLOW a fold conflict in the append-only research/legal/ledger.jsonl (main and the item both appended) voids the item's review and dispatch proof, so integrate owes a dispatch-log/accept-dispatch of the resolved bytes plus a full two-lens delta review and record for lines the item never wrote | evidence: /tmp/int2.log FOLD_CONFLICT research/legal/ledger.jsonl, then ITEM_REVIEW_OWED and DISPATCH_PROOF on vhp-third-party-components-are-checked-with-recorded-criteria at 5c666ab3c | workaround: kept both sides, carried the bytes through dispatch 2c816a2f, delta review on the warm reviewers; a merge=union attribute on the ledger and a fold-only exemption in the review binding would remove it."
- The host's `.gitattributes` on its `main` has `merge=union` for one append-only file (`grok/besluiten.md`, line 49) and none for `research/legal/ledger.jsonl`. The attribute is the host's to add; this row is what the flow does once it is there.
- Probe on Alpha, git 2.43.0, 2026-11-21: two sides that both append to a `merge=union` file give `git merge-tree --write-tree` exit 0, `git merge-file -p` exit 1 (conflict), and `git merge-file -p --union` the union.
- The script below, run on the tip on Alpha at 2026-11-21 14:11Z, passes. The fold is clean (`merge-tree` 0, the ledger holds both lines), and verify-item exits 2 with `accepted dispatch bytes changed at ledger.jsonl`.

## How to fix

1. **One owner for the clean merge.** `mergeBytes` (`S/run-fold.cjs:131-145`) merges as git does for that path. Read `git check-attr merge -- <file>`: `union` passes `--union` to `git merge-file`, and `binary`, unset or another driver keep today's reading (no clean merge, except where the range's start bytes equal ours, `:165`). Or both readers call one function that asks `git merge-tree` for the file.
2. **The review binding stays as it is.** It already reads the union fold as clean. No fold-only exemption is added for a hand resolution, which stays a re-owed review.

Tests, beside `S/run-attribution.test.cjs`:

- The script's case turns: verify-item of `a` after the union fold exits 0 and lists nothing outside.
- Without the attribute, the same two appends make the fold conflict, and after a hand resolution verify-item still refuses as today.
- A `merge=binary` file the base and the item both changed still refuses.

## Which part is the flow and which the host

The flow's part is points 1 and 2. The host adds `research/legal/ledger.jsonl merge=union` to its `.gitattributes`; with it the fold no longer conflicts and the review stays, and this row removes the dispatch refusal that remains.

## Until it is built

On the host, after the host's attribute lands: a fold that unions the ledger still owes the item a `dispatch-log` and an `accept-dispatch` of the ledger, which then carries the folded bytes, before verify-item. The review does not need to be done again.

## The script

Copy it to `S/` as `repro-union-fold.test.cjs` and run `node --test repro-union-fold.test.cjs` there. Today it passes; once the fix holds, it fails at its refusal assert, and the tests above replace it.

```js
'use strict';

// Reproduction for the handoff: a fold that git merges cleanly under the file's merge=union
// attribute reads at verify-item as a change no fold explains, since foldedAlone merges with
// git merge-file, which reads no attribute; the review binding's git merge-tree reads it clean.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { fixture } = require('./run-attribution-fixture.cjs');

test('a union fold of an append-only file the item claims refuses verify-item, though git merged it cleanly', (t) => {
  const f = fixture(t, { a: ['ledger.jsonl'] });
  f.moveBase('.gitattributes', 'ledger.jsonl merge=union\n');
  f.git('merge', '-q', '--no-edit', 'main');
  const one = f.start('--item', 'a');
  f.write('ledger.jsonl', 'module.exports = 1;\nthe item\n');
  f.accepted(one, ['ledger.jsonl']);
  f.git('add', 'ledger.jsonl');
  f.git('commit', '-qm', 'a lands\n\nItem: a');
  f.moveBase('ledger.jsonl', 'module.exports = 1;\nthe base\n');
  const tree = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', 'HEAD', 'main'], { cwd: f.root });
  console.log('merge-tree, as the review binding reads the fold:', tree.status);
  f.git('merge', '-q', '--no-edit', 'main');
  console.log('folded ledger:', JSON.stringify(f.git('show', 'HEAD:ledger.jsonl')));
  assert.equal(tree.status, 0);
  const result = f.verify('a');
  console.log('verify-item a:', result.code, result.out.trim().slice(0, 200));
  assert.notEqual(result.code, 0);
  assert.match(result.out, /accepted dispatch bytes changed at ledger\.jsonl/);
});
```
