'use strict';

/**
 * A sibling's commit to a path two items of one intent own, as verify-item reads it
 * (run-attribute.cjs). When the bytes an accepted dispatch recorded at a path it claims changed
 * since, and a fold of the base alone does not explain them (run-fold.cjs), siblings' commits do
 * when the tree holds the path as HEAD does and, on HEAD's first-parent line after the newest
 * commit that holds the accepted bytes, every commit that changed the path is a fold of the base
 * whose merge holds it as the clean merge of both sides, or names in its `Item:` trailers, as git
 * reads them, siblings only: items of the same intent, none of the dispatch's own, that own the
 * path by their spec or a grant. A commit naming several items explains the path only when every
 * one is a sibling, and at least one sibling's commit is there. Anything else explains nothing: a
 * commit with no trailer, one naming the item itself, an item of another intent or no item, or an
 * item that does not own the path, a merge of any other branch, and accepted bytes that are no
 * regular file or that no commit holds. A path the accepted dispatch deleted is held by a commit
 * that lacks it.
 *
 * A trailer is a claim any commit can make. What keeps it honest is the item's review: verify-item
 * says it is owed for the range, a review on record no longer binds the changed file
 * (run-review-hash.cjs), and a minor fix never settles over a commit another item's trailer names
 * (`otherItemCommit`, read by run-review.cjs).
 */

const { createHash } = require('crypto');
const { spawnSync } = require('child_process');

const lib = require('./run-lib.cjs');
const dispatch = require('./run-dispatch.cjs');
const { foldRanges } = require('./run-fold.cjs');
const { grantedPaths } = require('./run-grant.cjs');
const { dispatchClaims } = require('./run-review-span.cjs');
const { itemReviewCall } = require('./run-call.cjs');

/** The values of the `Item:` trailers of `commit`, parsed and trimmed the way git parses trailers. */
const trailerItems = (tree, commit) => lib.gitLines(tree, ['log', '-1', '--format=%(trailers:key=Item,valueonly)', commit]);

/** `file` at `rev` as `ls-tree` prints it, which reads a path as itself: empty when `rev` lacks it, null when git cannot read `rev`. */
const entryAt = (tree, rev, file) => lib.git(tree, ['ls-tree', rev, '--', file], { tolerate: true });

const short = (tree, sha) => lib.git(tree, ['rev-parse', '--short', sha]);

/**
 * `file` at `rev` as a snapshot records a regular file (run-snapshot.cjs): its mode and the sha256
 * of its bytes, empty when `rev` lacks it, null when git cannot read `rev`.
 */
function bytesAt(tree, rev, file) {
  const entry = entryAt(tree, rev, file);
  if (!entry) return entry;
  const [mode, , id] = entry.split(/\s/);
  const bytes = spawnSync('git', ['cat-file', 'blob', id], { cwd: tree, maxBuffer: 256 * 1024 * 1024 }).stdout;
  return `${mode} ${createHash('sha256').update(bytes).digest('hex')}`;
}

/** Whether `id` is a sibling of the dispatch `record` at `file`: an item of its intent, not its own, owning the path. */
function isSibling(tree, record, id, file) {
  const { intent } = record.assignment;
  const items = lib.findIntent(lib.readLedger(tree), intent).items;
  if (dispatch.itemsOf(record).includes(id) || !items.some((item) => item.id === id)) return false;
  const granted = dispatch.currentRecords(tree)
    .filter((entry) => entry.assignment.intent === intent && dispatch.itemsOf(entry).includes(id)).flatMap(grantedPaths);
  return lib.ownedBy(file, (lib.readItemSpec(tree, intent, id).manifest.ownership || {}).editable, tree) || lib.ownedBy(file, granted, tree);
}

/** Whether the merge `[commit, first, second]` folds the base in (`tips`, run-fold.cjs) and holds `file` as the clean merge of both sides. */
function cleanFold(tree, tips, [commit, first, second], file) {
  if (lib.gitLines(tree, ['rev-list', second, '--not', ...tips]).length > 0) return false;
  // Two commits merge-tree writes the merged tree of: its id comes first.
  const merged = spawnSync('git', ['merge-tree', '-z', first, second], { cwd: tree, encoding: 'utf8' });
  return entryAt(tree, merged.stdout.split('\0')[0], file) === entryAt(tree, commit, file);
}

/**
 * The siblings' commits that explain `file` moving from the bytes the accepted dispatch `record`
 * recorded to the bytes the tree holds, oldest first, each as { file, items, commit, from }, `from`
 * the newest commit holding the accepted bytes; null when anything is left unexplained. `base` is
 * the branch whose fold is the base's.
 */
function siblingCommits(tree, record, file, base) {
  // Absent is empty, as bytesAt reads it, and a link or a submodule matches no commit's regular file.
  const accepted = record.acceptedSnapshot.files[file] || { kind: 'none' };
  const want = { none: '', file: `100${accepted.executable ? 755 : 644} ${accepted.hash}` }[accepted.kind];
  // A path whose name reads as a pattern may match more than itself here, which only refuses more.
  if (lib.gitLines(tree, ['status', '--porcelain', '--', file]).length > 0) return null;
  const rows = lib.gitLines(tree, ['rev-list', '--first-parent', '--parents', `${record.acceptedSnapshot.head_sha}..HEAD`]).map((row) => row.split(' '));
  const last = rows.findIndex(([commit]) => bytesAt(tree, `${commit}^`, file) === want);
  if (last < 0) return null;
  const from = rows[last][1];
  const tips = foldRanges(tree, from, base).map(({ tip }) => tip);
  const found = [];
  for (const row of rows.slice(0, last + 1).reverse()) {
    const [commit, first, second] = row;
    if (entryAt(tree, commit, file) === entryAt(tree, first, file)) continue;
    if (second) {
      if (!cleanFold(tree, tips, row, file)) return null;
      continue;
    }
    const items = trailerItems(tree, commit);
    if (items.length === 0 || !items.every((id) => isSibling(tree, record, id, file))) return null;
    found.push({ file, items, commit, from });
  }
  return found.length > 0 ? found : null;
}

/**
 * What verify-item says of each sibling's commit it read: the file, the commit and its siblings,
 * and the review owed for the range, of each item of `record` whose review reads the file.
 */
function siblingLines(tree, record, found) {
  const ids = dispatch.itemsOf(record);
  return found.map(({ file, items, commit, from }) => {
    const owners = ids.filter((id) => dispatchClaims(tree, record.assignment.intent, id).includes(file));
    return `${file}: commit ${short(tree, commit)} of ${items.join(' and ')} changed it after the accepted dispatch of ${ids.join(', ')}, ` +
      `so verify-item took the proof again with no new dispatch, and the review of ${owners.join(', ')} is owed for ` +
      `${short(tree, from)}..${short(tree, commit)}: run ${owners.map((id) => itemReviewCall(tree, id)).join(' and ')}`;
  });
}

/**
 * Why a minor fix of `id` does not settle: a commit since `from` that changed one of `files` and
 * names another item in its `Item:` trailers, which no reviewer of this item read. Null when none did.
 */
function otherItemCommit(tree, id, from, files) {
  // A path whose name reads as a pattern may match more than itself here, which only owes more.
  for (const commit of lib.gitLines(tree, ['rev-list', `${from}..HEAD`, '--', ...files])) {
    const other = trailerItems(tree, commit).find((named) => named !== id);
    if (other) return `commit ${short(tree, commit)} of ${other} changed a file the review lists, and a settle takes only the warm builder's correction`;
  }
  return null;
}

module.exports = { otherItemCommit, siblingCommits, siblingLines };
