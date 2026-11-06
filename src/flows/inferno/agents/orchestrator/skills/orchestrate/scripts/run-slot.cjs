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
 * The queue functions read no config: their callers decide whether the slot is in use. The
 * `run.cjs slot` command, `slotCommand`, reads it, so a driver on a host without the key never waits.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const jobs = require('./run-jobs.cjs');
const { worktreeEntries } = require('./run-worktrees.cjs');
const { atomicWrite, withFileLock } = require('./state-store.cjs');
const { mergeSlot } = require('./run-config-gates.cjs');
const { slotCall } = require('./run-call.cjs');

const { RunError } = lib;

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
  const ahead = aheadOf(tree, tickets, who);
  return { head: ahead.length === 0, ahead, out };
}

/** Every head and ticket ahead of the holder's ticket, which `tickets` holds. */
function aheadOf(tree, tickets, who) {
  const before = tickets.slice(0, tickets.findIndex((ticket) => ticket.holder === who)).map((ticket) => ticket.holder);
  return [...shimHeads(tree, tickets), ...before];
}

/** Mark the holder's ticket active; a holder not queued is left alone. True when it held one. */
function renew(tree, holder, now = Date.now()) {
  const who = holder || lib.currentBranch(tree);
  return locked(tree, (stored) => {
    const mine = stored.find((ticket) => ticket.holder === who);
    if (!mine) return { tickets: null };
    mine.activity = iso(now);
    return { tickets: stored };
  }).tickets !== null;
}

/** Drop the holder's ticket; a holder not queued is left alone. True when it held one. */
function release(tree, holder) {
  const who = holder || lib.currentBranch(tree);
  return locked(tree, (stored) => {
    const kept = stored.filter((ticket) => ticket.holder !== who);
    return { tickets: kept.length === stored.length ? null : kept };
  }).tickets !== null;
}

function evicted(tree, now) {
  return locked(tree, (stored) => {
    const result = evict(stored, now);
    return { tickets: result.out.length ? result.kept : null, ...result };
  });
}

/** Evict, then name the heads: every worktree running without a ticket, else the first ticket. */
function queue(tree, now = Date.now()) {
  const { kept, out } = evicted(tree, now);
  const shims = shimHeads(tree, kept);
  return { heads: shims.length ? shims : kept.slice(0, 1).map((ticket) => ticket.holder), tickets: kept, out };
}

/** Evict, then where the holder's ticket stands: the ticket (null when it holds none) and what is ahead of it. */
function standing(tree, holder, now = Date.now()) {
  const who = holder || lib.currentBranch(tree);
  const { kept, out } = evicted(tree, now);
  const ticket = kept.find((entry) => entry.holder === who) || null;
  return { ticket, ahead: ticket ? aheadOf(tree, kept, who) : [], out };
}

// ---------------------------------------------------------------------------
// run.cjs slot: the queue by hand, for a driver that commits straight onto the base. It takes a
// ticket under its own holder name before it commits, starts the lanes with
// `gate --detach --lanes-only`, waits, pushes and releases.
// ---------------------------------------------------------------------------

const SLOT_USAGE = 'slot [--take | --renew | --release] --holder <name> [--tree <dir>] [--config <file>]';

function takeTicket(tree, holder) {
  const turn = take(tree, { holder });
  if (turn.head) {
    return { exit: 0, payload: { head: true, holder, ahead: [] },
      out: [...turn.out, `${holder} holds the head of the merge slot`, `release with: ${slotCall(tree, 'release', holder)}`] };
  }
  return { exit: 4, payload: { head: false, holder, ahead: turn.ahead },
    out: [...turn.out, `queued behind ${turn.ahead[0]} (${turn.ahead.length} ahead)`, `take again with: ${slotCall(tree, 'take', holder)}`] };
}

/** The queue as it stands after eviction: every worktree running without a ticket first, then one line per holder. */
function listed(tree, now = Date.now()) {
  const { kept, out } = evicted(tree, now);
  const lines = [...shimHeads(tree, kept), ...kept.map((ticket) => ticket.holder)];
  return { exit: 0, payload: { heads: lines.slice(0, 1), tickets: kept }, out: [...out, ...(lines.length ? lines : ['the merge slot holds no ticket'])] };
}

/** `run.cjs slot`: take (0 at the head, 4 queued), renew or release a holder's ticket, or print the queue. */
function slotCommand(options) {
  const verbs = ['take', 'renew', 'release'].filter((verb) => options[verb]);
  if (verbs.length > 1 || (verbs.length === 1 && !options.holder)) throw new RunError(`usage: node run.cjs ${SLOT_USAGE}`, 'BAD_ARGS', 1);
  const tree = options.tree || lib.repoRoot(options.cwd);
  if (!mergeSlot(lib.readConfig(tree, options.config))) {
    const file = options.config || `${lib.SPECS_DIR}/config.yaml`;
    return { exit: 0, payload: { merge_slot: false }, out: [`no verification.merge_slot in ${file}: there is no queue`] };
  }
  const [verb] = verbs;
  const { holder } = options;
  if (verb === 'take') return takeTicket(tree, holder);
  if (verb === 'renew') {
    const held = renew(tree, holder);
    return { exit: 0, payload: { renewed: held, holder }, out: [held ? `renewed ${holder}` : `${holder} holds no ticket`] };
  }
  if (verb === 'release') {
    const held = release(tree, holder);
    return { exit: 0, payload: { released: held, holder }, out: [held ? `released ${holder}` : `${holder} holds no ticket`] };
  }
  return listed(tree);
}

module.exports = { IDLE_MS, REVIEW_CAP_MS, queue, release, renew, reviewDispatchPath, slotCommand, slotPath, standing, take };
