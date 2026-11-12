'use strict';

/**
 * Ownership grants. `run.cjs grant <dispatch_id> --path <file>` adds one path to the ownership a
 * started dispatch was signed with, the orchestrator signing it, when a builder needs a file the
 * planner left out (a frontier `candidate`, or the minimal extension a correction asks for). The
 * path is appended to `assignment.ownership.editable`, so every reader of a dispatch's frozen
 * ownership (verify-item's attribution, a sibling's overlap and peer checks) reads it there, and
 * it is listed in `assignment.ownership.granted` with its signer, so a later reader tells a
 * granted path from one the dispatch started with. The item spec is never edited: the item
 * commit holds only code, and its review binds only code.
 *
 * A grant goes on a dispatch that is still running. An accepted dispatch froze its ownership with
 * its result, and a superseded one answers for nothing, so both are refused. A correction starts
 * with a fresh dispatch-log, which carries every grant of the attempts before it. A path another
 * item's dispatch owns while it runs, or changed beside this item, is refused before the builder
 * builds on it, by the check verify-item runs later.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { chainDispatchCall } = require('./run-call.cjs');

const { RunError } = lib;

const SIGNER = 'orchestrator';
const USAGE = 'grant <dispatch-id> --path <file> --tree <dir>';

/** The grant entries a dispatch record carries, oldest first. */
function grantsOf(record) {
  const ownership = record && record.assignment && record.assignment.ownership;
  return (ownership && ownership.granted) || [];
}

const grantedPaths = (record) => grantsOf(record).map((entry) => entry.path);

/** The ownership a dispatch was signed with at dispatch-log, its grants left out. */
function startedWith(record) {
  const granted = new Set(grantedPaths(record));
  return record.assignment.ownership.editable.filter((entry) => !granted.has(entry));
}

/** `ownership` with each grant entry appended to its editable list and to its grants. Without one it is returned as is. */
function withGrants(ownership, entries) {
  const editable = [...ownership.editable];
  const granted = [...(ownership.granted || [])];
  for (const entry of entries) {
    if (editable.includes(entry.path)) continue;
    editable.push(entry.path);
    granted.push(entry);
  }
  return granted.length > 0 ? { ...ownership, editable, granted } : ownership;
}

/** The grants of the attempts a new dispatch-log supersedes, which the new record carries. */
const inherited = (previous) => previous.flatMap(grantsOf);

/**
 * The granted path relative to the tree. run.cjs resolves `--path` from the current directory,
 * so a path that lands in the tree is taken from there, and any other is the path as typed,
 * read relative to the tree: the orchestrator runs from the project root, not the worktree.
 */
function treePath(tree, options) {
  const absolute = path.resolve(options.cwd || process.cwd(), options.path);
  const inside = (file) => file !== '' && !file.startsWith('..') && !path.isAbsolute(file);
  let file = path.relative(tree, absolute);
  if (!inside(file)) file = path.relative(options.cwd || process.cwd(), absolute);
  file = file.split(path.sep).join('/');
  const refuse = (why) => new RunError(`grant ${options.path}: ${why}`, 'DISPATCH_PROOF');
  if (!inside(file) || path.posix.normalize(file) !== file) throw refuse('name one path inside the tree, relative to it');
  if (/[*?[\]{}]/.test(file)) throw refuse('a grant is one exact path, never a pattern');
  if (file === lib.SPECS_DIR || file.startsWith(`${lib.SPECS_DIR}/`)) {
    throw refuse('the ledger is the single writer\'s and never a builder\'s');
  }
  const stat = fs.statSync(path.join(tree, file), { throwIfNoEntry: false });
  if (stat && stat.isDirectory()) throw refuse('a grant is one exact file, never a directory');
  return file;
}

/** The started, current dispatch a grant goes on, or a refusal that names it. */
function grantable(dispatch, tree, id) {
  const record = dispatch.readJson(dispatch.recordFile(tree, id));
  if (!record) {
    throw dispatch.refuse(`no dispatch ${id} recorded for ${fs.realpathSync(tree)}: grant on the dispatch_id dispatch-log printed, ` +
      'with the --tree it used');
  }
  const named = `dispatch ${id} for ${dispatch.itemsOf(record).join(', ')}`;
  try {
    dispatch.validateDispatch(tree, record, {}, false);
  } catch (error) {
    if (!(error instanceof RunError) || !/superseded/.test(error.message)) throw error;
    throw dispatch.refuse(`${named} was superseded by a newer attempt: grant on the dispatch_id of the current one`);
  }
  if (record.phase === 'accepted') {
    throw dispatch.refuse(`${named} is already accepted, its ownership frozen with its result: a correction takes a fresh ` +
      'dispatch-log, and the grant goes on that dispatch_id');
  }
  return { record, named };
}

/**
 * Refuse a path another item's dispatch stands in the way of, by the check verify-item runs once
 * the item claims it (run-peers.cjs): an open dispatch that owns it, or one that changed it while
 * it ran beside this item. The refusal names that dispatch and the two ways on.
 */
function checkBeside(dispatch, tree, record, file) {
  // Loaded here: run-attribute.cjs loads this file for the paths a dispatch was granted.
  const { openDispatches } = require('./run-attribute.cjs');
  const { besideAt } = require('./run-peers.cjs');
  const own = dispatch.effective(tree, record);
  const peers = dispatch.currentRecords(tree).filter((entry) => entry.phase === 'accepted');
  const now = { ...dispatch.captureSnapshot(tree), seq: Infinity };
  const found = besideAt(tree, own, file, peers, openDispatches(tree, own), now);
  if (!found) return;
  const other = found.record;
  const theirs = dispatch.itemsOf(other);
  const mine = dispatch.itemsOf(record);
  const first = own.before.seq <= dispatch.effective(tree, other).before.seq;
  const chain = [...new Set(first ? [...mine, ...theirs] : [...theirs, ...mine])];
  throw dispatch.refuse(`grant ${file}: dispatch ${other.dispatchId} for ${theirs.join(', ')} ` +
    `${found.open ? 'owns it and is still open' : 'changed it beside this item'}, so verify-item would refuse ${mine.join(', ')} ` +
    `at it. Build both as one chain with ${chainDispatchCall(tree, record.assignment.intent, chain)}, or let the change wait ` +
    `until ${theirs.join(', ')} is integrated and dispatch ${mine.join(', ')} again`);
}

/** The step itself: append one path to a running dispatch's signed ownership. A path it already owns is no change. */
function grant(id, options) {
  if (!id || !options.path) throw new RunError(`usage: node run.cjs ${USAGE}`, 'BAD_ARGS', 1);
  // Loaded here: run-dispatch.cjs loads this file for the grants a new dispatch-log carries.
  const dispatch = require('./run-dispatch.cjs');
  const tree = options.tree || lib.repoRoot(options.cwd);
  const file = treePath(tree, options);
  const { record, named } = grantable(dispatch, tree, id);
  const owned = lib.ownedBy(file, record.assignment.ownership.editable, tree);
  if (!owned) checkBeside(dispatch, tree, record, file);
  const entry = { path: file, signer: SIGNER, dispatch: id, granted_at: new Date().toISOString() };
  const saved = owned ? record : dispatch.saveDispatch(tree, {
    ...record,
    assignment: { ...record.assignment, ownership: withGrants(record.assignment.ownership, [entry]) },
  });
  return {
    exit: 0,
    payload: { dispatch_id: id, path: file, granted: grantsOf(saved), started: startedWith(saved), tree },
    out: [owned ? `${named} already owns ${file}` : `granted ${file} to ${named}`],
  };
}

module.exports = { grant, grantedPaths, grantsOf, inherited, startedWith, withGrants };
