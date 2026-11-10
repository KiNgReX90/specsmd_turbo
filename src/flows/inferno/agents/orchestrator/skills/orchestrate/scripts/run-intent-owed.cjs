'use strict';

/**
 * Whether the intent review holds for a tree, and what the gate and green owe without it.
 *
 * The review binds the whole tree by content (`proofs.scopeHash` with no scope), which leaves
 * out `.specs-inferno/`: a ledger commit, the review file itself and an archive move keep it
 * current, and any code change voids it, except a change to a `review.outside` kb that the
 * base synced and the intent never touched (outsideHash). The gate checks it after its fold, so it never proves
 * a tree the reviewer did not read, and green checks it before every merge, which is the one
 * call both hosts and a hand merge make.
 */

const fs = require('fs');
const { createHash } = require('crypto');
const path = require('path');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const { intentOf } = require('./run-worktrees.cjs');
const { parseIntentReview } = require('./run-intent-review-file.cjs');
const { itemProofs } = require('./run-mutant-coverage.cjs');
const { intentReviewCall, scanCall } = require('./run-call.cjs');
const { resolveBase } = require('./run-intents.cjs');
const { reviewOutside } = require('./run-config-gates.cjs');
const { reviewPath } = require('./run-review-file.cjs');
const { previousReview } = require('./run-review-delta.cjs');
const { deferredItems } = require('./state-defer.cjs');

const { RunError } = lib;

/** An intent file: in the live intent dir, or in the archive once archive-intent moved it there. */
function intentFile(tree, intentId, name) {
  const live = path.join(lib.SPECS_DIR, 'intents', intentId, name);
  const archived = path.join(lib.SPECS_DIR, 'archive', 'intents', intentId, name);
  if (fs.existsSync(path.join(tree, live))) return live;
  if (fs.existsSync(path.join(tree, archived))) return archived;
  const liveDir = fs.existsSync(path.join(tree, path.dirname(live)));
  return !liveDir && fs.existsSync(path.join(tree, path.dirname(archived))) ? archived : live;
}

const intentReviewPath = (tree, intentId) => intentFile(tree, intentId, 'review.yaml');
const scanPath = (tree, intentId) => intentFile(tree, intentId, 'scan.yaml');

/** The intent a tree builds: `--intent`, else its `inferno-intent/<id>-<stamp>` branch. Fails closed. */
function intentFor(tree, options = {}) {
  if (options.intent) return options.intent;
  const branch = lib.currentBranch(tree);
  const id = intentOf(branch);
  if (id) return id;
  throw new RunError(
    `cannot tell which intent ${tree} builds: its branch ${branch} is no intent branch. Pass --intent <id>.`,
    'NO_INTENT'
  );
}

/**
 * The work items of the intent, from its spec files, live or archived. A deferred item is left
 * out: it owes no review, no proof and no mutant, so neither the review nor the gate waits on it.
 */
function intentItems(tree, intentId) {
  const ids = new Set();
  for (const base of [['intents'], ['archive', 'intents']]) {
    const dir = path.join(tree, lib.SPECS_DIR, ...base, intentId, 'work-items');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) if (file.endsWith('.md')) ids.add(file.slice(0, -3));
  }
  const deferred = deferredItems(lib.statePath(tree), intentId);
  return [...ids].filter((id) => !deferred.has(id)).sort();
}

/** The ids of the collected scan's lines, or null when no scan was collected. */
function scanIds(tree, intentId) {
  const rel = scanPath(tree, intentId);
  if (!fs.existsSync(path.join(tree, rel))) return null;
  const doc = lib.parseYaml(fs.readFileSync(path.join(tree, rel), 'utf8'));
  const lines = doc && Array.isArray(doc.lines) ? doc.lines : [];
  return lines.map((line) => (line && typeof line.id === 'string' ? line.id : null)).filter(Boolean);
}

/** The scan is owed on every host until `run.cjs scan --collect` recorded one for the intent. */
function scanOwed(tree, intentId) {
  return scanIds(tree, intentId) === null;
}

/** Validate a review file against the intent as it stands. */
function parseFor(tree, rel, intentId, recorded) {
  const items = intentItems(tree, intentId);
  return parseIntentReview(tree, rel, {
    recorded, items, scanIds: scanIds(tree, intentId) || [], proofs: itemProofs(tree, intentId, items),
  });
}

/**
 * The tree hash that leaves out the kb the base synced, or null when `review.outside` is unset.
 * A kb path is left out only while the branch holds the base's version of it: one that differs
 * from the merge base of the base or of origin's base, or is dirty, is the intent's own edit and
 * stays in, so a doubtful path voids the review rather than keeps it.
 */
function outsideHash(tree, config) {
  const globs = reviewOutside(config || {});
  if (globs.length === 0) return null;
  const base = resolveBase(config, null, tree);
  // A base that is the tree's own branch moves with it, so no diff tells its kb edits from a sync.
  if (base === lib.currentBranch(tree)) return null;
  const refs = [base];
  if (lib.git(tree, ['rev-parse', '--verify', '--quiet', `origin/${base}`], { tolerate: true })) refs.push(`origin/${base}`);
  const reads = [
    ['diff', '--name-only', '--no-renames', '-z', 'HEAD'], ['ls-files', '--others', '--exclude-standard', '-z'],
    ...refs.map((ref) => ['diff', '--name-only', '--no-renames', '-z', `${ref}...HEAD`]),
  ];
  const own = new Set();
  for (const args of reads) {
    const out = lib.git(tree, args, { tolerate: true });
    if (out === null) return null; // a base it cannot diff leaves the kb in: the review is judged by the whole tree
    for (const file of out.split('\0').filter(Boolean)) own.add(file);
  }
  // The intent's own kb paths are named too: a page it deleted is in no hash of the files that exist.
  const kb = [...own].filter((file) => lib.matchesAny(file, globs)).sort();
  const hash = proofs.scopeHash(tree, null, { skip: (file) => lib.matchesAny(file, globs) && !own.has(file) });
  return createHash('sha256').update(JSON.stringify([hash, kb])).digest('hex');
}

/** The review reads the tree as it stands, whole or with the kb the base synced left out. */
function reviewCurrent(tree, config, review) {
  if (review.tree === proofs.scopeHash(tree)) return true;
  return typeof review.tree_outside === 'string' && review.tree_outside === outsideHash(tree, config);
}

/**
 * The review as it holds for the tree: `owed` lists every reason it does not, empty when a
 * recorded review reads clean for the current content.
 */
function intentReviewState(tree, config, intentId) {
  const rel = intentReviewPath(tree, intentId);
  const owed = [];
  if (scanOwed(tree, intentId)) {
    owed.push(`the scan is owed: run ${scanCall(tree)}, spawn the dispatch lines it prints, ` +
      `then run ${scanCall(tree, null, true)} before the review`);
  }
  if (!fs.existsSync(path.join(tree, rel))) return { rel, review: null, owed: [...owed, 'no intent review yet'] };
  if (lib.gitLines(tree, ['status', '--porcelain', '--', rel]).length > 0) {
    return { rel, review: null, owed: [...owed, `${rel} is written but not recorded`] };
  }
  let review;
  try {
    review = parseFor(tree, rel, intentId, true);
  } catch (error) {
    if (!(error instanceof RunError)) throw error;
    return { rel, review: null, owed: [...owed, error.message] };
  }
  if (!reviewCurrent(tree, config, review)) {
    owed.push(`the code changed since the review read it at ${(review.commit || 'an unknown commit').slice(0, 7)}`);
  } else if (review.verdict !== 'clean') {
    owed.push('the review says fix and its findings are not fixed');
  }
  return { rel, review, owed };
}

/**
 * The gate's refusal after its fold, or null when the review holds. `before` is HEAD before
 * the fold: when the fold moved the tree, the reviewer reads the base delta from there.
 * `shown` are the lines the gate printed so far.
 */
function gateRefusal(tree, config, intentId, before, shown) {
  const state = intentReviewState(tree, config, intentId);
  if (state.owed.length === 0) return null;
  const out = [...shown, ...state.owed.map((reason) => `intent review owed: ${reason}`)];
  const moved = lib.git(tree, ['rev-parse', 'HEAD']) !== before;
  if (moved) {
    out.push(`the fold moved the tree from ${lib.git(tree, ['rev-parse', '--short', before])}; the reviewer reads the base delta from there`);
  }
  out.push(`run ${intentReviewCall(tree)} first, then gate again`);
  return { exit: 3, payload: { ok: false, tree, owed: ['review'], reasons: state.owed, folded: moved }, out };
}

/**
 * The items of the intent whose minor-only fix settled with no second item review, each with
 * the range nobody re-read: from the commit that fix review read to the commit it settled at.
 * Only those settled after `from`, the commit the intent review reads from, so a delta of the
 * intent review lists none the last one already read.
 */
function settledItems(tree, intentId, from) {
  const intent = lib.readLedger(tree).intents.find((entry) => entry.id === intentId);
  const short = (ref) => lib.git(tree, ['rev-parse', '--short', ref], { tolerate: true }) || ref.slice(0, 7);
  return (intent ? intent.items : []).filter((item) => item.review === 'settled' && item.review_commit).flatMap((item) => {
    if (from && lib.git(tree, ['merge-base', '--is-ancestor', item.review_commit, from], { tolerate: true }) !== null) return [];
    const read = previousReview(tree, reviewPath(intentId, item.id));
    return [{ item: item.id, range: `${read ? short(read.commit.trim()) : 'unknown'}..${short(item.review_commit)}` }];
  });
}

/**
 * Whether an evidence path exists. A path inside the intent's own dir is found wherever the
 * intent lives now: both hosts archive that dir before they merge.
 */
function evidenceExists(tree, intentId, rel) {
  const live = `${lib.SPECS_DIR}/intents/${intentId}/`;
  const archived = `${lib.SPECS_DIR}/archive/intents/${intentId}/`;
  const candidates = [rel];
  if (rel.startsWith(live)) candidates.push(archived + rel.slice(live.length));
  if (rel.startsWith(archived)) candidates.push(live + rel.slice(archived.length));
  return candidates.some((candidate) => fs.existsSync(path.join(tree, candidate)));
}

/**
 * What a merge still owes beyond the command proofs: the review for this tree and the
 * evidence of every external criterion. The smoke lane's proof joins this list when the
 * flow gains one.
 */
function mergeOwed(tree, config, intentId) {
  const owed = [];
  const out = [];
  const state = intentReviewState(tree, config, intentId);
  if (state.owed.length > 0) {
    owed.push('review');
    out.push(...state.owed.map((reason) => `intent review owed: ${reason}`));
  }
  const missing = state.review
    ? state.review.criteria.filter((entry) => entry.proof === 'external' && !evidenceExists(tree, intentId, entry.evidence))
    : [];
  if (missing.length > 0) {
    owed.push('evidence');
    out.push(...missing.map((entry) => `evidence owed: ${entry.evidence} for ${entry.criterion}`));
  }
  return { owed, out };
}

module.exports = {
  gateRefusal, intentFor, intentItems, intentReviewPath, intentReviewState, mergeOwed, outsideHash, parseFor, reviewCurrent,
  scanOwed, scanPath, settledItems,
};
