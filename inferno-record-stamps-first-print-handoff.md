# Handoff: an item review's record stamps the end of the first range printed since the last record, even when every lens's `read` line names a later print and the record has already held that line to the later print, so a record after a correction owes a delta over a correction both lenses read

Row 0bh. Met on the first host on 2026-11-23 by the Delta session of the release-line intent `dossierforge-keeps-a-verified-copy-of-the-record-on-its-own` (its outbox line #24), on the build at `a8873ebb`. The tip `86b10a92` holds the same `src/`. Reproduced on the tip with the script at the end.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of the tip.

## What is wrong

1. **The stamp takes the first print.** Each `review --item` that prints a dispatch notes its range per lens (`S/run-review.cjs:117`, `noteDispatched` at `S/run-review-quality.cjs:157-162`). The record stamps the end of the first range noted since the last record (`stampOf`, `S/run-review-read.cjs:78-81`, `ranges[0]`). The files hash is taken there too. The header gives the reason (`:10-13`): "nobody can tell which print the reviewer read, so the older end costs at most one delta too many".
2. **But the record can tell.** Each lens file may name the range it read under `read`, and the record holds that line to a range its own lens printed since the last record before it stamps (`heldRanges` and `holdRead`, `:54-71`, called at `S/run-review.cjs:236`). `stampOf` never reads the match. So when a correction lands between two prints and both lenses name the later print, the record still stamps the earlier end. `afterRecord` (`:90-102`) then finds the corrected files changed since the stamp and owes a delta over the correction both lenses read.
3. **A first review printed again does not ask for the line.** `readLine` (`:44-47`, from `reviewerLines`, `S/run-review.cjs:55-58`) asks for `read` only when the dispatch names a `previous` file. A first review printed twice therefore gets no line, so the record cannot tell which print its lenses read, even after point 2 is fixed.
4. **What the extra delta costs.** The flow's answer to the owed delta is a fresh dispatch of each lens (`S/run-review.cjs:50-51`). That means two cold reviews, the contract lens with its mutants, of a correction both lenses have already judged.

## Evidence

The first host's Delta (Debian), tree `~/dev/Skoft_CRA-inferno-dossierforge-keeps-a-verified-copy-of-the-record-on-its-own`, branch `inferno-intent/dossierforge-keeps-a-verified-copy-of-the-record-on-its-own-20261120T205133Z`, `flow.lock` at `a8873ebb` (0.1.85), item `akb-settings-data-shows-the-automatic-backup-switch`. Read on Delta 2026-11-23 about 12:40Z, read only. Times UTC (Delta's clock runs EST).

- 10:47:38Z `f1638def8`, the item's start. The item's builder was dispatched at 10:49:03Z (dispatch log).
- 11:16:48Z `11dcb14b7`, the item's build. The item's lens note `review-lenses/<intent>/akb-settings-data-shows-the-automatic-backup-switch.json` was created at 11:16:49Z (its folder's mtime), when the first print of the review noted the range ending at `11dcb14b7`.
- Three corrections by the item's builder, with no review recorded before them: `ee34de837` 12:04:07Z, `07e8bfc94` 12:19:47Z and `e2aa35230` 12:28:32Z, dispatched at 11:56:57Z, 12:13:22Z and 12:24:05Z.
- 12:33:07Z `dda86dcbe`, the item's first record. Both review files are new in this commit and both carry `read: f1638def8..e2aa35230`. The `commit:` line and the ledger's `review_commit` read `11dcb14b7`, with the hash of the files at `11dcb14b7`. The record printed "clean, recorded at 11dcb14b7" and owed the review again.
- 12:34:17Z `782631274`, the second record: both files `read: 11dcb14b7..dda86dcbe`, stamp `dda86dcbe`. The lens note now reads `{"lenses":["contract","quality"],"ranges":[]}`.
- `git log 11dcb14b7..dda86dcbe` holds three commits on the item's paths. They are the three corrections, all inside `f1638def8..e2aa35230`, which both lenses read. The only other commit is `dda86dcbe`, which touches only the two review files and `.specs-inferno/state.yaml`.
- The session's FLOW line, verbatim: "#24 FLOW an item review recorded after a correction (0au: no record before it) is stamped at the end of the FIRST range printed since the last record, not the range its read line names, so it owes a delta over changes both lenses already read | evidence: run-review-read.cjs stampOf takes ranges[0]; akb-settings-data recorded 'clean, recorded at 11dcb14b7' with read f1638def8..e2aa35230, commit dda86dcbe | workaround: the same warm reviewers restate read 11dcb14b7..dda86dcbe and I record again".
- The script below passes on the tip on Alpha at 2026-11-23 12:42Z, in two cases. First, a first review printed again after a correction: the second print asks for no `read` line. Both files name the second print (`ad8f7d2..0f2019d`), and the record stamps `95fd983`, the end of the first print. Its next call owes `95fd983..0a93eed`, which holds the correction. Second, a delta printed before and after a correction: both prints ask for the line, and both files name the second print. The record stamps the end of the first print and owes the delta again.

## How to fix

1. **Stamp the print each lens names.** `heldRanges` (`S/run-review-read.cjs:66-71`) returns, for each signed lens, the end of the range its file names. A lens whose file names none returns the end of its first noted range. `stampOf` (`:78-81`) stamps the oldest of those ends, the `git merge-base` of them and HEAD, and takes the hash there as now. With no range noted, it stamps HEAD as before. A lens that names the first print keeps today's stamp, so a correction it did not read stays owed.
2. **Ask for the line whenever a dispatch is printed again.** `readLine` (`:44-47`) also asks for `read` when its lens already has a range noted since the last record (`notedRanges`, read before `owed` notes the new print at `S/run-review.cjs:117`). This covers a first review too. The first print of a first review still gets no line.
3. **Fix the words.** The header (`:10-13`) and the CHANGELOG entry ("A dispatch printed twice stamps the oldest end printed since the last record") now say that the oldest end is stamped only for a lens whose file names no print.

Tests, beside `S/run-review-read.test.cjs` and `S/run-review-read-holds.test.cjs`:

- The script's two cases turn. In each, `review_commit` is the end of the second print, both files carry `commit:` at that end, and the record exits 0 on the integrate call.
- One lens names the first print and the other names the second: the record stamps the first end, and the next call owes the delta in each lens, as today.
- A first review printed again after a correction asks each lens for `read` naming the new range. Its first print still asks for none (`S/run-review-read-holds.test.cjs:44` stays).
- `S/run-review-read.test.cjs:144` ("a dispatch printed again with a newer end stamps the oldest end printed since the last record") stays green, since its files name no print.

## Which part is the flow and which the host

The whole fix is the flow's. On the host's side, the session sent the first review's findings to the builder three times before any record, reading row 0au's workaround more widely than it is written. That is what put two prints before one record. It is not for the builder of this row: the flow meets the same stamp after row 0au's own workaround, or whenever a session runs `review --item` again before it records.

## Until it is built

On the host: record each verdict the lenses return before its findings go to a builder, and run no `review --item` between a fix record and the correction of its findings. One print then stands between two records, and the stamp is the print the lenses read. A record that still owes the delta over changes both lenses read is answered by the same warm reviewers. They write `read: <stamp>..<head>` as the next `review --item` prints it, with their verdicts unchanged, and the session records again; the record runs the mutants again on the tree as it stands. This holds only when every commit on the item's paths in that range lies inside the range both lenses named. Any other commit is read first.

## The script

Copy it to `S/` as `repro-stamp-named-print.test.cjs` and run `node --test repro-stamp-named-print.test.cjs` there. Today it passes. Once the fix holds, it fails at its stamp assert, and the tests above replace it.

```js
'use strict';

// Reproduction for the handoff: an item review dispatch printed twice before its record, with a
// correction committed between the two prints, is recorded at the end of the first print even when
// both lenses name the second print under `read`, which the record holds to that print. The record
// then owes a delta over the correction both lenses already read.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { git, write } = require('./review-fixture.cjs');
const { CLEAN, QCLEAN, QUALITY, REVIEW, block, contractFix, host, ledger, shown } = require('./run-review-quality-fixture.cjs');

const LENSES = ['specsmd-inferno-reviewer', 'specsmd-inferno-reviewer-quality'];
const head = (tree) => git(tree, ['rev-parse', 'HEAD']);
const rangeOf = (out, agent) => /^ {2}range (\S+) paths /m.exec(block(out, agent).join('\n'))[1];
const readAsked = (out, agent) => block(out, agent).some((line) => line.startsWith('  read '));
const commit = (tree, body, message) => {
  write(tree, 'src/a.ts', body);
  git(tree, ['commit', '-qm', message, '--', 'src/a.ts']);
  return head(tree);
};
const withRead = (tree, rel, range) => write(tree, rel, `${fs.readFileSync(path.join(tree, rel), 'utf8')}read: ${range}\n`);

test('a first review printed again after a correction, both lenses naming the second print, is stamped at the first print', () => {
  const h = host();
  const first = h.review();
  assert.equal(first.code, 3, shown(first));
  const firstEnd = head(h.tree);
  const corrected = commit(h.tree, 'export const a = 6;\n', 'the correction');
  const second = h.review();
  assert.equal(second.code, 3, shown(second));
  const range = rangeOf(second.out, LENSES[0]);
  console.log('first print', rangeOf(first.out, LENSES[0]), 'second print', range, 'read asked in the second:', readAsked(second.out, LENSES[0]));
  write(h.tree, REVIEW, CLEAN);
  write(h.tree, QUALITY, QCLEAN);
  withRead(h.tree, REVIEW, range);
  withRead(h.tree, QUALITY, range);

  const recorded = h.review();

  console.log('record:', recorded.code, recorded.out.trim().split('\n').slice(-2).join(' | '));
  assert.ok(corrected.startsWith(range.split('..')[1]), 'both lenses read through the correction');
  assert.equal(recorded.code, 3, shown(recorded));
  assert.match(ledger(h.tree), new RegExp(`review_commit: ${firstEnd}\\n`), 'stamped at the first print');
  assert.match(recorded.out, /the item changed after its reviewer read it at/);
  const owed = h.review();
  console.log('next delta:', rangeOf(owed.out, LENSES[0]), 'holds the correction:', git(h.tree, ['rev-list', `${firstEnd}..HEAD`]).split('\n').includes(corrected));
});

test('a delta printed before and after a correction, both lenses naming the second print as asked, is stamped at the first print', () => {
  const h = host();
  assert.equal(h.review().code, 3);
  write(h.tree, REVIEW, contractFix('major'));
  write(h.tree, QUALITY, QCLEAN);
  assert.equal(h.review().code, 2, 'the fix is recorded');
  const peer = commit(h.tree, 'export const a = 4;\n', 'a change to a listed file before any builder took the finding');
  const before = h.review();
  assert.equal(before.code, 3, shown(before));
  const corrected = commit(h.tree, 'export const a = 6;\n', 'the correction');
  const after = h.review();
  assert.equal(after.code, 3, shown(after));
  const range = rangeOf(after.out, LENSES[0]);
  console.log('first print', rangeOf(before.out, LENSES[0]), 'second print', range, 'read asked:', readAsked(after.out, LENSES[0]), readAsked(after.out, LENSES[1]));
  write(h.tree, REVIEW, `${CLEAN}read: ${range}\n`);
  withRead(h.tree, QUALITY, range);

  const recorded = h.review();

  console.log('record:', recorded.code, recorded.out.trim().split('\n').slice(-2).join(' | '));
  assert.ok(corrected.startsWith(range.split('..')[1]), 'both lenses read through the correction');
  assert.equal(recorded.code, 3, shown(recorded));
  assert.match(ledger(h.tree), new RegExp(`review_commit: ${peer}\\n`), 'stamped at the first print');
  assert.match(recorded.out, /the item changed after its reviewer read it at/);
});
```
