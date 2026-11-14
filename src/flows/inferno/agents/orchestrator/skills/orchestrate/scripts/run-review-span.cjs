'use strict';

/**
 * What a review round of one item reads: the item's files, and the paths of a correction round.
 *
 * An item's files are those its spec owns and those any dispatch of the item claimed, a path the
 * orchestrator granted it included (run-grant.cjs). A grant sits on the dispatch record and never
 * in the spec, so a reader of the spec alone would leave a granted file unread. The paths of a
 * correction round are the item's files and the files the last review listed that changed since
 * the review on record; the same set decides whether a fix review is owed again and whether a
 * minor correction stayed inside the listed files. A path of the ledger is never among them: the
 * proof leaves it out and the review binds none (run-review-file.cjs).
 *
 * The set is read from the dispatch records, not from the item's proof: the step decides whether a
 * review is owed before it asks for a proof, a fix that lands without a verify-item behind it
 * still has its grant on record, and a proof holds a granted path only once a builder reported it.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const dispatch = require('./run-dispatch.cjs');
const { grantedPaths } = require('./run-grant.cjs');

const { RunError } = lib;

const inLedger = (file) => file === lib.SPECS_DIR || file.startsWith(`${lib.SPECS_DIR}/`);

/** The spec ownership of `id`, or none when its spec does not read. */
function specOwned(tree, intentId, id) {
  try {
    const manifest = lib.readItemSpec(tree, intentId, id).manifest || {};
    return (manifest.ownership && manifest.ownership.editable) || [];
  } catch (error) {
    if (error instanceof RunError) return [];
    throw error;
  }
}

/** A record and the attempts behind it; a lineage the cache no longer holds whole is the record alone. */
function attempts(tree, record) {
  try {
    return dispatch.lineage(tree, record);
  } catch (error) {
    if (error instanceof RunError) return [record];
    throw error;
  }
}

/** The paths one attempt claims: every grant it carries, and once accepted, what it reported. */
function claimsOf(record) {
  const completion = record.phase === 'accepted' && record.completion ? record.completion : {};
  return [...grantedPaths(record), ...(completion.filesModified || []), ...(completion.carried || [])]
    .filter((file) => typeof file === 'string');
}

/**
 * The paths any dispatch of the item claimed, grants included, outside the ledger. A dispatch of a
 * chain claims for every item it built, so a path another item of the chain owns by its spec, and
 * this one does not, is that item's. A tree with no dispatch record, as one the released flow
 * built, claims nothing.
 */
function dispatchClaims(tree, intentId, itemId) {
  const own = specOwned(tree, intentId, itemId);
  const records = dispatch.currentRecords(tree)
    .filter((record) => record.assignment && record.assignment.intent === intentId && dispatch.itemsOf(record).includes(itemId));
  const claimed = new Set();
  for (const record of records) {
    const others = dispatch.itemsOf(record).filter((id) => id !== itemId).flatMap((id) => specOwned(tree, intentId, id));
    for (const file of attempts(tree, record).flatMap(claimsOf)) {
      if (inLedger(file)) continue;
      if (!lib.ownedBy(file, own) && lib.ownedBy(file, others)) continue;
      claimed.add(file);
    }
  }
  return [...claimed].sort();
}

/** The item's files as ownership entries: its spec's, then every path a dispatch of it claimed. */
const itemFiles = (context) => [...new Set([...(context.editable || []), ...(context.claimed || [])])];

/**
 * The files changed from `from` to HEAD that a correction round reads: those of the item and
 * those `listed`, the files the last review lists, never one of the ledger.
 */
function changedSince(tree, context, from, listed) {
  const owned = itemFiles(context);
  return lib.gitLines(tree, ['diff', '--name-only', `${from}..HEAD`], { tolerate: true })
    .filter((file) => !inLedger(file) && (lib.ownedBy(file, owned) || listed.includes(file)));
}

/** The most paths a range line lists itself. */
const LISTED_PATHS = 40;

/**
 * The range line of one lens's dispatch, and the file that lists its paths when the line does not.
 * Up to LISTED_PATHS paths stay on the line, as always. A longer list would make the reviewer's
 * brief hundreds of paths long, so it goes one per line into the run's cache, outside the tree,
 * and the line gives the count, with a `paths-file` line under it naming that file.
 */
function rangeLines(tree, context, which, range, read) {
  if (read.length <= LISTED_PATHS) return { file: null, lines: [`  range ${range} paths ${read.join(' ') || '(the whole range)'}`] };
  const file = path.join(lib.cacheDir(tree), 'review-paths', context.intent.id, context.item.id, `${which}.txt`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${read.join('\n')}\n`);
  return { file, lines: [`  range ${range} paths ${read.length}, one per line in the paths-file below`, `  paths-file ${file}`] };
}

/** The paths a delta reads that left the tree since the previous review: deleted, or renamed away. */
const goneFiles = (tree, read) => read.filter((file) => !fs.existsSync(path.join(tree, file)));

/**
 * The line that tells a delta's reviewer which paths are gone, so it reads their removal in the
 * range, never looks for them, and leaves them out of the files it lists, which hold only files
 * the tree holds.
 */
function goneLine(gone) {
  if (gone.length === 0) return [];
  const it = gone.length > 1 ? 'them' : 'it';
  return [`  gone ${gone.join(' ')}: not in the tree since the previous review, so read the removal in the range and leave ${it} out of files`];
}

module.exports = { changedSince, dispatchClaims, goneFiles, goneLine, itemFiles, rangeLines };
