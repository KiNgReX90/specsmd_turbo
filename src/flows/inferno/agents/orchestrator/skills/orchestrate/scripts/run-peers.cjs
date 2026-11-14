'use strict';

/**
 * Who made each change since an item's baseline, for verify-item.
 *
 * Every snapshot a dispatch record stores carries the number the tree's sequence gave it, so
 * the records of one tree line up on one timeline: the item's first baseline, every later
 * snapshot of the item and of its peers, then the tree now. Between two neighbouring snapshots a
 * changed path is a peer's when one of the peer's attempts ran across that stretch and claims the
 * path. It is the item's when the item claims it, and nobody's otherwise. A run of nobody's
 * changes that leaves a path on other bytes than it found is flagged. The run is bounded by
 * claimed changes or the ends of the timeline.
 *
 * A peer's change to a path the item owns is an overlap only when the peer ran beside the item.
 * A peer whose whole window lies between two of the item's own attempts, after one was accepted
 * and before the next began, ran after the item: its change is its own. A dispatch over several
 * completed items keeps their histories apart: a peer beside one of them overlaps only at a path
 * that one claims or owns, and beside the batch's own attempt at every path the batch claims or owns.
 */

const lib = require('./run-lib.cjs');
const dispatch = require('./run-dispatch.cjs');

function seqOf(snapshot) {
  if (!snapshot || !Number.isInteger(snapshot.seq)) {
    throw dispatch.refuse('a dispatch snapshot carries no sequence number: run dispatch-log for its item again, ' +
      'then accept-dispatch the result');
  }
  return snapshot.seq;
}

/** Whether any entry of one frozen ownership list can name a file an entry of the other names. */
function ownershipOverlaps(left, right, tree) {
  return (left || []).some((entry) => (right || []).some((other) => lib.overlaps(entry, other, tree)));
}

/** Each attempt of a lineage by the id of the attempt it superseded. */
function successors(members) {
  const next = new Map();
  for (const member of members) for (const id of member.previous || []) next.set(id, member);
  return next;
}

/**
 * The stretch of the timeline one attempt ran in: from its baseline to its acceptance, or, never
 * accepted, to the baseline of the attempt after it, or to the end while it still runs.
 */
function span(member, next) {
  const end = member.phase === 'accepted' ? member.acceptedSnapshot : (next.get(member.dispatchId) || {}).beforeSnapshot;
  return { start: seqOf(member.beforeSnapshot), end: end ? seqOf(end) : Infinity };
}

/**
 * Whether a peer's run lay beside the item: it shares a stretch with one of the item's own
 * attempts, or it ran after the last of them. A run wholly between two of the item's attempts,
 * after one was accepted and before the next began, ran after the item and not beside it.
 */
function ranBeside(run, own) {
  const apart = own.every((attempt) => run.end < attempt.start || attempt.end < run.start);
  return !apart || !own.some((attempt) => run.end < attempt.start);
}

/**
 * The windows the attempts of a peer lineage ran in. An accepted attempt runs from its baseline
 * to its acceptance and claims what it changed. An attempt nobody accepted runs until the next
 * attempt started, and claims what the attempts after it claim, back to the nearest accepted
 * one. A path an attempt carried is claimed by every attempt before it in the lineage. The tail
 * of an `open` lineage, still running, runs to the end of the timeline, and it and every attempt
 * nobody accepted before it, back to the nearest accepted one, claim every path the tail's frozen
 * ownership covers. Such a claim is `frozen`: it yields to a path the reviewed item claims.
 */
function windows(tree, peer, open = false) {
  const members = dispatch.lineage(tree, peer);
  const byId = new Map(members.map((member) => [member.dispatchId, member]));
  const next = successors(members);
  const claims = new Map(members.map((member) => [member, new Set(member.phase === 'accepted' ? dispatch.claimedPaths(member) : [])]));
  for (const member of members.filter((entry) => entry.phase === 'accepted')) {
    const reported = [...dispatch.claimedPaths(member), ...(member.completion.carried || [])];
    const queue = [...(member.previous || [])];
    while (queue.length > 0) {
      const prior = byId.get(queue.shift());
      if (!prior || prior.phase === 'accepted') continue;
      for (const file of reported) claims.get(prior).add(file);
      queue.push(...(prior.previous || []));
    }
  }
  for (const member of members.filter((entry) => entry.phase === 'accepted' && (entry.completion.carried || []).length)) {
    const queue = [...(member.previous || [])];
    const seen = new Set();
    while (queue.length > 0) {
      const prior = byId.get(queue.shift());
      if (!prior || seen.has(prior)) continue;
      seen.add(prior);
      for (const file of member.completion.carried) claims.get(prior).add(file);
      queue.push(...(prior.previous || []));
    }
  }
  const frozen = { frozen: true, has: (file) => lib.ownedBy(file, peer.assignment.ownership.editable, tree) };
  const unaccepted = open ? [members[0]] : [];
  while (unaccepted.length > 0) {
    const member = unaccepted.shift();
    if (!member || member.phase === 'accepted' || claims.get(member) === frozen) continue;
    claims.set(member, frozen);
    unaccepted.push(...(member.previous || []).map((id) => byId.get(id)));
  }
  return members.map((member) => ({ peer, member, ...span(member, next), claims: claims.get(member) }));
}

/** The paths the accepted attempts among `members` changed or carried. */
function claimsOf(members) {
  const claims = new Set();
  for (const member of members.filter((entry) => entry.phase === 'accepted')) {
    for (const file of [...dispatch.claimedPaths(member), ...(member.completion.carried || [])]) claims.add(file);
  }
  return claims;
}

/** The attempt `id` names and every attempt behind it. */
function behind(byId, id) {
  const found = new Set();
  const queue = [byId.get(id)];
  while (queue.length > 0) {
    const member = queue.shift();
    if (!member || found.has(member)) continue;
    found.add(member);
    queue.push(...(member.previous || []).map((prior) => byId.get(prior)));
  }
  return [...found];
}

/**
 * The histories a dispatch over several completed items joins, kept apart. The trunk is the
 * record and the attempts it continues one by one, down to the first that supersedes more than
 * one: every path the trunk claims and every path the items own are its own. Each record that one
 * superseded heads a branch, which holds what its attempts claim and what its items own, and
 * runs across its own attempts and the trunk's, since the batch's attempt counts for every item.
 * A peer overlaps at a path only beside the attempts of a history that holds it. Null for one
 * history, which is read whole as before.
 */
function histories(tree, own, editable) {
  const byId = new Map(own.members.map((member) => [member.dispatchId, member]));
  const next = successors(own.members);
  const trunk = [];
  for (let entry = own.record; entry && !trunk.includes(entry); entry = byId.get(entry.previous[0])) {
    trunk.push(entry);
    if ((entry.previous || []).length !== 1) break;
  }
  const split = trunk[trunk.length - 1];
  if (!split || (split.previous || []).length < 2) return null;
  const owned = (file) => lib.ownedBy(file, editable, tree);
  const along = trunk.map((member) => span(member, next));
  const claimed = claimsOf(trunk);
  const lines = [{ attempts: along, holds: (file) => claimed.has(file) || owned(file) }];
  for (const id of split.previous) {
    const branch = behind(byId, id);
    const claims = claimsOf(branch);
    const ownedHere = (file) => owned(file) && branch.some((member) => lib.ownedBy(file, member.assignment.ownership.editable, tree));
    lines.push({ attempts: [...along, ...branch.map((member) => span(member, next))], holds: (file) => claims.has(file) || ownedHere(file) });
  }
  return lines;
}

/** A peer's change must lie inside its own ownership, and outside this item's when it ran beside the item. */
function checkPeerChange(tree, run, file) {
  const { peer } = run;
  if (!lib.ownedBy(file, peer.assignment.ownership.editable, tree)) {
    throw dispatch.refuse(`dispatch ${peer.dispatchId} for ${dispatch.itemsOf(peer).join(', ')} claims ${file} outside its ` +
      'ownership: review that item first, its verify-item names the file');
  }
  if (run.overlaps(file)) {
    throw dispatch.refuse(`dispatch ownership overlaps at ${file} with dispatch ${peer.dispatchId}: ` +
      'a serial chain one builder builds takes one dispatch-log for all its items, with --items a,b');
  }
}

/**
 * The item's timeline from its first baseline to `now`, and the runs of its peers on it, each
 * marked `beside` when it ran beside one of the item's own attempts, and able to tell whether its
 * change to a path `overlaps` the item: beside a history of the item that claims the path or owns
 * it by `editable`. `peers` are accepted records, `open` the records still running beside the item.
 */
function layout(tree, own, peers, open, now, editable = []) {
  const root = seqOf(dispatch.checkSnapshot(own.before));
  const next = successors(own.members);
  const attempts = own.members.map((member) => span(member, next));
  const lines = histories(tree, own, editable);
  const overlapping = (run) => (lines
    ? (file) => lines.some((line) => ranBeside(run, line.attempts) && line.holds(file))
    : (file) => run.beside && (own.claimed.includes(file) || lib.ownedBy(file, editable, tree)));
  const runs = [];
  for (const [records, accepted] of [[peers, true], [open, false]]) {
    for (const peer of records) {
      dispatch.validateDispatch(tree, peer, {}, accepted);
      if (own.ids.has(peer.dispatchId)) continue;
      for (const run of windows(tree, peer, !accepted).filter((entry) => entry.end > root)) {
        const entry = { ...run, beside: ranBeside(run, attempts) };
        runs.push({ ...entry, overlaps: overlapping(entry) });
      }
    }
  }
  const snapshots = new Map([[root, own.before]]);
  for (const member of [...own.members, ...runs.map((run) => run.member)]) {
    for (const snapshot of [member.beforeSnapshot, member.acceptedSnapshot]) {
      if (snapshot && seqOf(snapshot) > root) snapshots.set(snapshot.seq, dispatch.checkSnapshot(snapshot));
    }
  }
  return { runs, timeline: [...[...snapshots.keys()].sort((left, right) => left - right).map((seq) => snapshots.get(seq)), now] };
}

/**
 * The peer run a change of `file` between two neighbouring snapshots is read as: one that ran
 * across that stretch and claims the path, a run that overlaps the item there before one beside
 * it, and that before one after it. A frozen claim yields to a path the item claims.
 */
function runAt(runs, before, after, file, claimed) {
  const across = runs.filter((entry) => entry.start <= before.seq && after.seq <= entry.end && entry.claims.has(file) &&
    !(claimed && entry.claims.frozen));
  return across.find((entry) => entry.overlaps(file)) || across.find((entry) => entry.beside) || across[0];
}

/**
 * The paths that nobody's changes since the item's first baseline leave on other bytes. `now`
 * is the tree as verify-item reads it, and `folded` the paths the fold of the base brought in.
 * `peers` are accepted records, `open` the records still running beside the item.
 */
function unexplainedChanges(tree, own, editable, peers, now, folded, open = []) {
  const { runs, timeline } = layout(tree, own, peers, open, now, editable);
  const flagged = new Set();
  const stretches = new Map();
  const close = (file) => {
    const stretch = stretches.get(file);
    if (stretch && stretch.found !== stretch.left) flagged.add(file);
    stretches.delete(file);
  };
  for (let index = 1; index < timeline.length; index += 1) {
    const [before, after] = [timeline[index - 1], timeline[index]];
    for (const file of dispatch.snapshotDelta(before, after, true)) {
      const claimed = own.claimed.includes(file);
      if (folded.has(file) && !claimed) continue;
      const run = runAt(runs, before, after, file, claimed);
      if (run) checkPeerChange(tree, run, file);
      if (run || claimed) {
        close(file);
        continue;
      }
      const stretch = stretches.get(file) || { found: dispatch.identity(before, file) };
      stretch.left = dispatch.identity(after, file);
      stretches.set(file, stretch);
    }
  }
  for (const file of [...stretches.keys()]) close(file);
  return flagged;
}

/**
 * The record of the dispatch that stands in the way of the item owning `file`, the check
 * verify-item runs once the item claims it: an open one whose frozen ownership covers the path,
 * or one whose change to it lies in a stretch it ran beside the item, as `{ record, open }`, `open`
 * telling the first from the second. Null when no dispatch stands in the way.
 */
function besideAt(tree, own, file, peers, open, now) {
  const holder = open.find((record) => !own.ids.has(record.dispatchId) && lib.ownedBy(file, record.assignment.ownership.editable, tree));
  if (holder) return { record: holder, open: true };
  const { runs, timeline } = layout(tree, own, peers, open, now);
  for (let index = 1; index < timeline.length; index += 1) {
    const [before, after] = [timeline[index - 1], timeline[index]];
    if (!dispatch.snapshotDelta(before, after, true).includes(file)) continue;
    const run = runAt(runs, before, after, file, true);
    if (run && run.beside) return { record: run.peer, open: false };
  }
  return null;
}

module.exports = { besideAt, ownershipOverlaps, unexplainedChanges };
