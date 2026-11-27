'use strict';

/**
 * What a dispatch-log covers, and its door. A correction named for one item of a chain is logged
 * for the whole chain its current record covers (run-dispatch.cjs), and the record owns what every
 * covered item's spec owns.
 *
 * Two builders on one file is the state verify-item refuses once both are accepted (run-peers.cjs),
 * and only the runner holds every open record and its frozen ownership. So a dispatch whose frozen
 * ownership overlaps an open record of another lineage is refused before anything is written: no
 * record, no log line, no baseline. An open record the new one supersedes is the attempt before it
 * in its own lineage, a builder sent back, and never refused; so is the dispatch that joins two
 * chains, which supersedes both. An oracle ask owns nothing and never reaches the door.
 */

const lib = require('./run-lib.cjs');
const dispatch = require('./run-dispatch.cjs');
const { acceptDispatchCall } = require('./run-call.cjs');
const { firstShared, joinCall } = require('./run-peers.cjs');

/**
 * The items a dispatch-log of `requested` covers, each it took in that the caller did not name with
 * the dispatch id of the record that covers it, and the ownership their specs list.
 */
function scope(tree, intent, requested) {
  const { items, takenIn } = dispatch.coveredItems(tree, intent, requested);
  const editable = new Set();
  for (const id of items) {
    const spec = lib.readItemSpec(tree, intent, id);
    for (const entry of (spec.manifest.ownership && spec.manifest.ownership.editable) || []) editable.add(entry);
  }
  return { items, takenIn, editable: [...editable] };
}

/**
 * Refuse a dispatch of `items` whose frozen ownership, `editable` with the grants of the attempts it
 * supersedes, overlaps an open record of another lineage. The refusal names that dispatch, its items
 * and the first shared path as each side's entry names it, and the ways on: accept it first, or log
 * both as one chain, which only a dispatch-log of one intent can.
 */
function refuseOverlap(tree, intent, items, editable) {
  const { previous, ownership } = dispatch.planned(tree, intent, items, editable);
  for (const open of dispatch.currentRecords(tree)) {
    if (open.phase === 'accepted' || previous.has(open.dispatchId)) continue;
    const shared = firstShared(ownership.editable, open.assignment.ownership.editable, tree);
    if (!shared) continue;
    const [mine, theirs] = shared;
    const first = Math.min(...[...previous.values()].map((record) => dispatch.effective(tree, record).before.seq));
    const chain = open.assignment.intent === intent ? `, or build both as one chain with ${joinCall(tree, intent, items, first, open)}` : '';
    throw dispatch.refuse(`dispatch-log ${items.join(', ')}: dispatch ${open.dispatchId} for ${dispatch.itemsOf(open).join(', ')} is still ` +
      `open and owns ${theirs}${mine === theirs ? ' too' : `, which this dispatch owns as ${mine}`}, and verify-item refuses two builders ` +
      `on one file. Accept it first, once its builder is done, with ${acceptDispatchCall(tree, open.dispatchId)}${chain}`);
  }
}

module.exports = { refuseOverlap, scope };
