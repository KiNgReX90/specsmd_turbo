'use strict';

/**
 * The merge slot: one queue of tickets per repository, shared by every worktree of it, so one
 * intent at a time gates and ships against the base while the others wait their turn.
 *
 * The queue lives in the git common directory, never in the cache dir: the cache dir is keyed
 * by the primary checkout's name, and two clones of one name would share it. Every change runs
 * under the queue's own file lock and lands by an atomic replace.
 *
 * A ticket that shows no activity is evicted, so a session that died never holds the slot;
 * an open intent review holds its ticket longer, up to a cap. A worktree running a gate or a
 * lane without a ticket (started by an older runner) stands at the head until its job ends.
 *
 * This module reads no config: its callers decide whether the slot is in use.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const jobs = require('./run-jobs.cjs');
const { worktreeEntries } = require('./run-worktrees.cjs');
const { atomicWrite, withFileLock } = require('./state-store.cjs');

const MINUTE = 60 * 1000;
const IDLE_MS = 30 * MINUTE;
const REVIEW_CAP_MS = 120 * MINUTE;
const LABEL = 'merge slot';

const iso = (now) => new Date(now).toISOString();

function commonDir(tree) {
  return fs.realpathSync(path.resolve(tree, lib.git(tree, ['rev-parse', '--git-common-dir'])));
}

const slotPath = (tree) => path.join(commonDir(tree), 'inferno-merge-slot.json');
const lockFile = (tree) => path.join(commonDir(tree), 'inferno-merge-slot.lock');

/** The intent review dispatch of a tree's branch, as `run.cjs review` writes it. */
const reviewDispatchPath = (tree) => path.join(lib.cacheDir(tree), lib.currentBranch(tree), 'intent-review-dispatch.json');

function readTickets(file) {
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(stored.tickets) ? stored.tickets : [];
  } catch (error) {
    return [];
  }
}

function writeTickets(file, tickets) {
  atomicWrite(file, `${JSON.stringify({ tickets }, null, 2)}\n`);
}

/** When the ticket's tree last dispatched an intent review, or null. */
function dispatchedAt(ticket) {
  try {
    return fs.statSync(reviewDispatchPath(ticket.tree)).mtimeMs;
  } catch (error) {
    return null;
  }
}

/** The eviction line for a ticket, or null while it stays. */
function evictionLine(ticket, now) {
  const activity = Date.parse(ticket.activity);
  if (now - activity <= IDLE_MS) return null;
  const dispatched = dispatchedAt(ticket);
  if (dispatched !== null && dispatched > activity) {
    return now - dispatched < REVIEW_CAP_MS ? null : `evicted ${ticket.holder}: its intent review has no verdict after the cap`;
  }
  return `evicted ${ticket.holder}: no gate, wait or review since ${ticket.activity}`;
}

function evict(tickets, now) {
  const kept = [];
  const out = [];
  for (const ticket of tickets) {
    const line = evictionLine(ticket, now);
    if (line) out.push(line);
    else kept.push(ticket);
  }
  return { kept, out };
}

/** Run `change` on the queue under its lock; it returns the tickets to store, or null to leave the file. */
function locked(tree, change) {
  const file = slotPath(tree);
  return withFileLock(lockFile(tree), () => {
    const result = change(readTickets(file));
    if (result.tickets) writeTickets(file, result.tickets);
    return result;
  }, { label: LABEL });
}

function liveJob(tree) {
  try {
    return jobs.everyJob(tree).some(jobs.alive);
  } catch (error) {
    return false;
  }
}

/** A head for each worktree running a job with no ticket for its branch. */
function shimHeads(tree, tickets) {
  const held = new Set(tickets.map((ticket) => ticket.holder));
  return worktreeEntries(lib.primaryRoot(tree))
    .filter((entry) => entry.branch && !held.has(entry.branch) && fs.existsSync(entry.path) && liveJob(entry.path))
    .map((entry) => `running without a ticket: ${entry.branch}`);
}

/** Queue `holder` (the tree's branch by default), or renew the ticket it already holds. */
function take(tree, { holder, intent } = {}, now = Date.now()) {
  const who = holder || lib.currentBranch(tree);
  const { tickets, out } = locked(tree, (stored) => {
    const { kept, out: evicted } = evict(stored, now);
    const mine = kept.find((ticket) => ticket.holder === who);
    if (mine) mine.activity = iso(now);
    else kept.push({ holder: who, tree, intent: intent || null, taken: iso(now), activity: iso(now) });
    return { tickets: kept, out: evicted };
  });
  const before = tickets.slice(0, tickets.findIndex((ticket) => ticket.holder === who)).map((ticket) => ticket.holder);
  const ahead = [...shimHeads(tree, tickets), ...before];
  return { head: ahead.length === 0, ahead, out };
}

/** Mark the holder's ticket active; a holder not queued is left alone. */
function renew(tree, holder, now = Date.now()) {
  const who = holder || lib.currentBranch(tree);
  locked(tree, (stored) => {
    const mine = stored.find((ticket) => ticket.holder === who);
    if (!mine) return { tickets: null };
    mine.activity = iso(now);
    return { tickets: stored };
  });
}

/** Drop the holder's ticket; a holder not queued is left alone. */
function release(tree, holder) {
  const who = holder || lib.currentBranch(tree);
  locked(tree, (stored) => {
    const kept = stored.filter((ticket) => ticket.holder !== who);
    return { tickets: kept.length === stored.length ? null : kept };
  });
}

/** Evict, then name the heads: every worktree running without a ticket, else the first ticket. */
function queue(tree, now = Date.now()) {
  const { kept, out } = locked(tree, (stored) => {
    const evicted = evict(stored, now);
    return { tickets: evicted.out.length ? evicted.kept : null, ...evicted };
  });
  const shims = shimHeads(tree, kept);
  return { heads: shims.length ? shims : kept.slice(0, 1).map((ticket) => ticket.holder), tickets: kept, out };
}

module.exports = { IDLE_MS, REVIEW_CAP_MS, queue, release, renew, reviewDispatchPath, slotPath, take };
