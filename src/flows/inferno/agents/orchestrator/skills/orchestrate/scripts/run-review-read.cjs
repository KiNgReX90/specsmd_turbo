'use strict';

/**
 * What an item review read, and the commit its record stamps.
 *
 * The record stamps the commit its reviewer read, never HEAD at record time: a correction committed
 * between the dispatch and the record lies after the stamp, so the next review call owes the delta
 * that reads it, and the record says so in place of the verdict's next line. The commit read is the
 * end of the range the dispatch printed. The review step notes every range it prints, per lens, in
 * the lens note (noteDispatched in run-review-quality.cjs), and the record stamps the end of the
 * first one printed since the last record: a dispatch printed again has a newer end, and nobody can
 * tell which print the reviewer read, so the older end costs at most one delta too many and never
 * hides a correction. With no range noted, as for a dispatch the released flow printed or a cache
 * someone removed, the record stamps HEAD as it always did.
 *
 * The files hash is taken at that same commit, so whether the review holds is decided on the bytes
 * its reviewer read (itemReviewCurrent in run-review-hash.cjs, the step, the settle and the landing).
 * A commit HEAD's history no longer holds, as when history was rewritten between the dispatch and the
 * record, is stamped as the newest commit both histories hold, so the next delta reads every change
 * since, and the hash stays that of the bytes read, so the review holds only while HEAD holds them.
 *
 * The mutants still run at record time on the tree as it stands, and no result of theirs names a
 * commit: a caught one counts while its line stands on the tree as it is (run-mutant-coverage.cjs).
 *
 * A delta's dispatch asks each lens to name the range it read under `read`, so a reviewer whose
 * earlier verdict still holds writes its file anew, and git, which reads an untouched file as
 * unwritten, sees it. The record holds that line to the ranges its lens's dispatches printed since
 * the last record: an older range copied over or a typo is refused, naming both.
 */

const lib = require('./run-lib.cjs');
const { READ_KEY, bad, readDoc } = require('./run-review-file.cjs');
const { fullRange, notedRanges } = require('./run-review-quality.cjs');
const { changedSince } = require('./run-review-span.cjs');
const { filesHash, itemReviewCurrent } = require('./run-review-hash.cjs');
const { itemReviewCall } = require('./run-call.cjs');

const short = (tree, rev) => lib.git(tree, ['rev-parse', '--short', rev]);

/**
 * The line under a delta's dispatch of an item lens that asks its reviewer to name the range it
 * read, the range `body` prints. A first review, with no `previous`, and the intent review get none.
 */
function readLine(subject, previous, body) {
  const range = previous && subject.startsWith('item ') && body.map((line) => /^ {2}range (\S+)/.exec(line)).find(Boolean);
  return range ? [`  ${READ_KEY} ${range[1]}: write ${READ_KEY}: ${range[1]} into the file, also when the earlier verdict still holds`] : [];
}

/**
 * The ranges the dispatches of the item printed since its last record, once the `read` line of each
 * file the record signs (`files`, the contract file at `context.rel`) is held to those of its lens.
 * A file without the line, or a lens no dispatch on record printed a range for, reads as before.
 */
function heldRanges(tree, context, files) {
  const { intent, item, rel } = context;
  const ranges = notedRanges(tree, intent.id, item.id);
  for (const file of files) {
    const named = readDoc(tree, file)[READ_KEY];
    const printed = ranges.filter((one) => one.lens === (file === rel ? 'contract' : 'quality'));
    if (named === undefined || printed.length === 0) continue;
    if (typeof named === 'string' && printed.some((one) => one.range === fullRange(tree, named))) continue;
    const shown = [...new Set(printed.map((one) => one.printed))].join(' or ');
    throw bad(file, `${READ_KEY} names ${JSON.stringify(named)}, and the dispatch of this lens printed ${shown}: write the range it printed`);
  }
  return ranges;
}

/**
 * The commit the record stamps and the hash of `files` at the commit read: the end of the first
 * range noted since the last record, else HEAD. The stamp is the newest commit both that commit and
 * HEAD hold, which is the commit read itself unless history was rewritten since.
 */
function stampOf(tree, ranges, files) {
  const read = ranges.length > 0 ? ranges[0].range.split('..')[1] : lib.git(tree, ['rev-parse', 'HEAD']);
  return { commit: lib.git(tree, ['merge-base', read, 'HEAD']), hash: filesHash(tree, files, read) };
}

/**
 * The record's result, `result`, once the item changed after `commit`, the commit its reviewer read:
 * a fix review whose item's paths or listed files changed since, or a clean one that no longer holds.
 * The next review call owes the review of that change, so its line takes the place of the verdict's
 * next one, which would send the findings to a builder or land the item as if nothing had landed.
 * `context.item` is the item as the record left it.
 */
function afterRecord(tree, context, commit, review, result) {
  const { intent, item, config } = context;
  const fix = review.verdict === 'fix';
  const holds = fix ? changedSince(tree, context, commit, review.files).length === 0
    : itemReviewCurrent(tree, { intent, item, files: review.files, config });
  if (holds) return result;
  return {
    exit: 3,
    payload: { ...result.payload, ok: false, owed: 'review' },
    out: [...result.out.slice(0, -1), `then ${itemReviewCall(tree, item.id)}: the item changed after its reviewer read it at ` +
      `${short(tree, commit)}, and that change is read before ${fix ? 'a builder takes a finding' : 'the item lands'}`],
  };
}

module.exports = { afterRecord, heldRanges, readLine, stampOf };
