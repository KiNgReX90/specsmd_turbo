'use strict';

/**
 * The dispatch an intent review's record binds (run-intent-review.cjs), kept from the first print
 * since the last record: the item review's reading of run-review-read.cjs, one level up.
 *
 * The record binds the tree its reviewer was dispatched on: it stamps that dispatch's commit and
 * refuses a tree that moved since, so a commit that lands between the dispatch and the record is
 * never recorded as read. A dispatch printed again before the record replaced that tree with the
 * newer one, and the record of a reviewer that answered the first print then bound a commit nobody
 * read. The note now keeps the commit and tree of the first print since the last record, with every
 * range printed since: a newer print may be the one the reviewer read, or not, so the first one
 * binds, which costs at most one dispatch too many and never hides a commit. A refusal of a moved
 * tree drops the note, so the fresh dispatch it asks for binds the tree as it stands. The record
 * binds the tree outside the ledger: a commit that changes only `.specs-inferno/` outside its
 * standards (the state file, the review files, the briefs and specs) moves nothing it binds.
 *
 * A delta's dispatch carries the `read` line of run-review-read.cjs, so a reviewer whose earlier
 * verdict still holds writes its file anew, and the record holds the line to the ranges printed.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const slot = require('./run-slot.cjs');
const { previousReview } = require('./run-review-delta.cjs');
const { fullRange } = require('./run-review-quality.cjs');
const { holdRead } = require('./run-review-read.cjs');

const dispatchPath = slot.reviewDispatchPath;

/** The commit the intent review on record read, or null: a note taken after it is a print since that record. */
function recordedAt(tree, rel) {
  const doc = previousReview(tree, rel);
  return doc ? doc.commit.trim() : null;
}

/**
 * Note the intent review dispatch that prints `range`, `held` the note on record: the first print
 * since the last record keeps its commit and tree, and every range printed since is kept beside it.
 * Written on every print, so the merge slot reads the dispatch as open (run-slot.cjs).
 */
function noteIntentDispatch(tree, context, range, held) {
  const after = recordedAt(tree, context.rel);
  const open = held && held.after === after ? held : null;
  const at = open || { head: lib.git(tree, ['rev-parse', 'HEAD']), hash: proofs.scopeHash(tree) };
  const ranges = [...(open ? open.ranges : []), { range: fullRange(tree, range), printed: range }];
  fs.mkdirSync(path.dirname(dispatchPath(tree)), { recursive: true });
  fs.writeFileSync(dispatchPath(tree), `${JSON.stringify({ intent: context.intent, head: at.head, hash: at.hash, after, ranges })}\n`);
}

/** Drop the note after a refusal of a moved tree, so the fresh dispatch binds the tree as it stands. */
const dropIntentDispatch = (tree) => fs.rmSync(dispatchPath(tree), { force: true });

/** Hold the `read` line of the intent review being recorded to the ranges `held` noted; a note the released flow wrote holds none. */
const holdIntentRead = (tree, rel, held) => holdRead(tree, rel, Array.isArray(held.ranges) ? held.ranges : []);

module.exports = { dropIntentDispatch, holdIntentRead, noteIntentDispatch };
