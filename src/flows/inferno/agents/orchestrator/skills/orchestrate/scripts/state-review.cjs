'use strict';

/**
 * The item review on the ledger: the `review-item` transition and the rule complete-item
 * checks against it.
 *
 * Its own module beside state-transition.cjs, the way state-block.cjs is: the writer stands
 * near the ceiling, and a review is a question of its own. Claim and complete say who builds
 * the item and how far it got. This says whether a cold reviewer found the item meets its
 * brief, which tier built the version it read, and how often a review sent the item back.
 */

const path = require('path');
const {
  TransitionError, findKeyLine, unquote, loadState, locateWorkItems, getIntent, setField, removeField, nowIso, writeState,
} = require('./state-ledger.cjs');
const { itemRecordCall, itemReviewCall } = require('./run-call.cjs');
const { ruleSince } = require('./flow-lock-rules.cjs');

const DEFAULT_STATE_PATH = '.specs-inferno/state.yaml';

/** What a host with no recorded cutover is told, on every refusal the rule makes. */
const REINSTALL = 'This host\'s .specsmd/inferno/flow.lock records no review cutover, so every item owes ' +
  'one: reinstall the flow to record it, and items completed before that stay exempt.';

/**
 * When the item review became mandatory on this host: the moment its first install of a flow
 * carrying the rule, as the installer recorded it in the primary checkout's flow.lock. An
 * item completed before it was integrated under a flow with no review. Null when the lock
 * records none, and then the rule applies to every item.
 */
function reviewRuleSince(root) {
  return ruleSince(root, 'review');
}

const TIERS = new Set(['cheap', 'strong', 'escalate']);

/**
 * The review states an item lands on: `clean`, and `settled`, a fix review whose findings were
 * all minor and whose correction stayed inside the files it lists (run-review.cjs). Every reader
 * of the ledger's `review` field asks this, never `=== 'clean'`.
 */
const LANDING = new Set(['clean', 'settled']);
const reviewLands = (review) => LANDING.has(review);

/**
 * The misses on record for an item: the fix reviews that weighed serious, counted once per item
 * and never restarted. A ledger the released flow wrote holds no `review_misses`: it counted in
 * `review_rejections` per tier and started over on each. Its count on the recorded tier plus the
 * misses that climbed to that tier is the miss count it reached: cheap to strong took one,
 * strong to escalate two. `item` holds the ledger fields as text or numbers.
 */
function missCount(item) {
  const recorded = item.review_misses;
  if (recorded !== null && recorded !== undefined && String(recorded).trim() !== '') return Number(recorded) || 0;
  const fromCheap = String(item.complexity || '').toLowerCase() === 'low' ? 1 : 0;
  const below = { cheap: 0, strong: fromCheap, escalate: 2 + fromCheap };
  return (Number(item.review_rejections) || 0) + (below[item.review_tier] || 0);
}

/** One field of a ledger entry as a plain string, or null when the entry has none. */
function entryField(lines, entry, key) {
  const idx = findKeyLine(lines, entry.start, entry.end, entry.keyIndent, key);
  return idx === -1 ? null : unquote(lines[idx].slice(entry.keyIndent + key.length + 1));
}

/**
 * Whether a completed item predates the review rule on this host. An item with no
 * completed_at was written by a flow older than the timestamp, so it predates it too.
 */
function completedBeforeReviewRule(completedAt, since) {
  if (since === null) return false;
  const completed = Date.parse(completedAt || '');
  return Number.isNaN(completed) || completed < since;
}

/**
 * The backstop complete-item runs after its idempotent return: an item is completed only
 * over a clean review, unless it was already completed before the rule. `options` name the
 * tree and intent of the review call the refusal prints; its host config comes from the caller
 * record.
 */
function refuseUnreviewed(lines, item, itemId, alreadyComplete, stateFile, options = {}) {
  if (reviewLands(entryField(lines, item, 'review'))) return;
  const since = reviewRuleSince(path.dirname(path.dirname(path.resolve(stateFile))));
  if (alreadyComplete && completedBeforeReviewRule(entryField(lines, item, 'completed_at'), since)) return;
  throw new TransitionError(
    `refusing to complete ${itemId}: its item review is not clean. Run ` +
      `${itemReviewCall(options.tree || '<worktree>', itemId, options.intent)}, have the builder fix every finding until the ` +
      `review is clean, then integrate.${since === null ? ` ${REINSTALL}` : ''}`,
    'REVIEW_OWED'
  );
}

/**
 * Record one review verdict on a work item: `clean`, `fix`, or `settled` over a minor-only fix.
 *
 * The miss count is kept per item and never starts over: it goes up by one on a `fix` that
 * weighs serious, whichever tier built the version the review read, because the ladder asks how
 * often a review sent the item back. The weight comes from the review file itself (weightOf in
 * run-review-file.cjs), so no caller can forget it. `settled` is written only over a recorded
 * `fix` that weighs minor, and its review file must still say so; it keeps the count and the
 * weight. `run.cjs review --item` is the caller: it validates the reviewer's file and hashes the
 * files the review binds first, and for `settled` it checks the correction stayed inside them.
 */
function reviewItem(options) {
  const file = options.file || DEFAULT_STATE_PATH;
  const verdict = String(options.verdict || '');
  if (verdict !== 'clean' && verdict !== 'fix' && verdict !== 'settled') {
    throw new TransitionError(`refusing review-item: --verdict must be clean, fix or settled, not ${verdict || 'empty'}.`, 'BAD_VERDICT');
  }
  const hash = String(options.files_hash || '');
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new TransitionError('refusing review-item: --files-hash must be the 64 hex digits the item review computed.', 'BAD_HASH');
  }
  const tier = String(options.tier || '');
  if (!TIERS.has(tier)) {
    throw new TransitionError(`refusing review-item: --tier must be cheap, strong or escalate, not ${tier || 'empty'}.`, 'BAD_TIER');
  }
  const commit = String(options.commit || '').trim();
  if (!commit) {
    throw new TransitionError('refusing review-item with no --commit: name the commit the reviewer read.', 'NO_COMMIT');
  }

  const lines = loadState(file);
  const intent = getIntent(lines, options.intent);
  const item = locateWorkItems(lines, intent).find((entry) => entry.id === options.item);
  if (!item) {
    throw new TransitionError(`work item not found: ${options.item} in intent ${options.intent}.`, 'ITEM_NOT_FOUND');
  }

  const field = (key) => entryField(lines, item, key);
  if (verdict === 'settled') refuseUnsettled(file, options, field);
  const { serious, weight } = verdict === 'clean' ? { serious: false, weight: 'none' } : fixWeight(file, options);
  const previous = missCount({
    review_misses: field('review_misses'), review_rejections: field('review_rejections'),
    review_tier: field('review_tier'), complexity: field('complexity'),
  });
  const misses = previous + (serious ? 1 : 0);
  const reviewedAt = nowIso(options.now);
  // Each insert lands directly under `status:`, so write back to front to leave the order
  // review, review_hash, review_commit, review_tier, review_misses, review_weight, reviewed_at.
  for (const [key, value] of [
    ['reviewed_at', reviewedAt],
    ['review_weight', weight],
    ['review_misses', String(misses)],
    ['review_tier', tier],
    ['review_commit', commit],
    ['review_hash', hash],
    ['review', verdict],
  ]) {
    const count = lines.length;
    setField(lines, item, key, value);
    item.end += lines.length - count;
  }
  // The per-tier count of the released flow gives way to the one count.
  removeField(lines, item, 'review_rejections');
  writeState(file, lines);

  return { changed: true, item: options.item, verdict, tier, misses, weight, reviewed_at: reviewedAt };
}

/** A settle lands only on a recorded fix review whose findings were all minor. */
function refuseUnsettled(file, options, field) {
  const [review, weight] = [field('review'), field('review_weight')];
  if (review === 'fix' && weight === 'minor') return;
  const root = path.dirname(path.dirname(path.resolve(file)));
  throw new TransitionError(`refusing to settle ${options.item}: its last review is ${review || 'none'}` +
    `${review === 'fix' ? ` weighing ${weight || 'nothing'}` : ''}, and only a fix review whose every finding is minor settles. ` +
    `Run ${itemReviewCall(root, options.item, options.intent)}, which settles the item when it may.`, 'NOT_SETTLED');
}

/**
 * The weight of a fix verdict, or of the fix review a settle lands on, read from the item's
 * review beside the ledger, the one reading of its contract file and its quality file: whether
 * it counts, and whether it weighs minor, serious or repeat. Required here, not at the top:
 * run-review-file loads run-lib, which loads the writer that loads this file.
 */
function fixWeight(file, options) {
  const { reviewPath, weightOf } = require('./run-review-file.cjs');
  const { readItemReview } = require('./run-review-quality.cjs');
  const root = path.dirname(path.dirname(path.resolve(file)));
  const rel = reviewPath(options.intent, options.item);
  const fix = `Record the review through ${itemRecordCall(root, options.item, options.intent)}, which validates the file first.`;
  let review;
  try {
    review = readItemReview(root, options.intent, options.item, { recorded: true });
  } catch (error) {
    if (error.code !== 'BAD_REVIEW' && error.code !== 'ENOENT') throw error;
    throw new TransitionError(`refusing review-item: a fix verdict is weighed by the findings in ${rel}, which cannot be read. ${fix}`,
      'NO_REVIEW_FILE');
  }
  if (review.verdict !== 'fix') {
    throw new TransitionError(`refusing review-item: --verdict ${options.verdict}, and ${rel} says ${review.verdict}. ${fix}`, 'VERDICT_MISMATCH');
  }
  const weighed = weightOf(review);
  if (options.verdict === 'settled' && weighed.weight !== 'minor') {
    throw new TransitionError(`refusing to settle ${options.item}: ${rel} weighs ${weighed.weight}, and only a minor-only fix review settles. ${fix}`,
      'NOT_SETTLED');
  }
  return weighed;
}

module.exports = { REINSTALL, completedBeforeReviewRule, missCount, refuseUnreviewed, reviewItem, reviewLands, reviewRuleSince };
