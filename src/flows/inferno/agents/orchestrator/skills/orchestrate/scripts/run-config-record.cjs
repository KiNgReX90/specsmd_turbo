'use strict';

/**
 * The host config an intent run branch was given, kept between calls.
 *
 * Why this exists: a step reads the `--config` its own call names, else the tree's repo
 * config, and the flags of one process die with it. A later step that forgot the flag ran the
 * repo's checks on the host the run config sent elsewhere (Skoft_CRA, 2026-11-09: a local test
 * run on a reserved machine, killed for memory). The record keeps the config claim, worktree,
 * integrate or gate was last called with, per run branch, and the steps that run or prove
 * configured commands read it when their call names none.
 *
 * Keyed by the run branch in the cache dir of the primary checkout, beside the gate job, so a
 * claim on the primary (before the worktree exists) and every step inside the worktree address
 * one file. Only an `inferno-intent/<id>-<stamp>` branch records or recalls: sessions share the
 * primary checkout on the base branch, and a record there would hand one session's config to
 * the next. The config is kept as given, so a relative path resolves against each step's own
 * tree, as readConfig resolves it.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { LANES } = require('./run-lane-config.cjs');
const { intentOf, worktreeFor } = require('./run-worktrees.cjs');
const { atomicWrite } = require('./state-store.cjs');

const VERSION = 1;

/** The steps whose calls name the config that becomes the branch's record. */
const WRITERS = new Set(['claim', 'worktree', 'integrate', 'gate']);

/** The steps that run or prove configured commands, so a call without `--config` reads the record. */
const READERS = new Set(['worktree', 'integrate', 'gate', 'green', 'ship', ...LANES]);

function recordFile(tree, branch) {
  return path.join(lib.cacheDir(tree), branch, 'run-config.json');
}

function remember(tree, branch, config, step) {
  if (!intentOf(branch)) return;
  const record = { version: VERSION, branch, config, step, recorded_at: new Date().toISOString() };
  atomicWrite(recordFile(tree, branch), `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * The branch's record, or null when none was written or it is of another version. A record that
 * exists but cannot be read, is cut short, or names no config path is refused: answering null
 * there would hand the step the repo config, the fallback the record exists to close.
 */
function readRecord(file, branch) {
  const unreadable = () => new lib.RunError(`the run config record ${file} for ${branch} cannot be read: pass --config <file>`, 'BAD_CONFIG');
  let body;
  try {
    body = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw unreadable();
  }
  let record;
  try {
    record = JSON.parse(body);
  } catch {
    throw unreadable();
  }
  if (!record || typeof record !== 'object') throw unreadable();
  if (record.version !== VERSION) return null;
  if (typeof record.config !== 'string') throw unreadable();
  return record;
}

/**
 * The config recorded for the branch, or null. A recorded file that is gone is refused, never
 * answered with the repo config: that fallback is the defect the record exists to close.
 */
function recall(tree, branch) {
  if (!intentOf(branch)) return null;
  const record = readRecord(recordFile(tree, branch), branch);
  if (!record) return null;
  if (!fs.existsSync(path.resolve(tree, record.config))) {
    throw new lib.RunError(`the run config ${record.config} recorded for ${branch} is gone: pass --config <file>`, 'BAD_CONFIG');
  }
  return record.config;
}

/** The branch of a git tree, or null when the dir is no repository (the step itself reports that). */
function branchOf(dir) {
  const branch = lib.git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], { tolerate: true });
  return branch || null;
}

/** The tree a step resolves its config against and the run branch it works on, or null. */
function target(command, args, options) {
  if (command === 'worktree') {
    const root = lib.git(options.cwd, ['rev-parse', '--show-toplevel'], { tolerate: true }) && lib.primaryRoot(options.cwd);
    if (!root || !args[0]) return null;
    const open = worktreeFor(root, args[0]);
    if (open) return { tree: root, branch: open.branch };
    let intent = null;
    try {
      intent = lib.findIntent(lib.readLedger(root), args[0]);
    } catch {
      return null; // the step refuses an unknown intent itself
    }
    return intentOf(intent.claimed_by) === args[0] ? { tree: root, branch: intent.claimed_by } : null;
  }
  const tree = options.tree || lib.git(options.cwd, ['rev-parse', '--show-toplevel'], { tolerate: true });
  const branch = tree ? branchOf(tree) : null;
  return branch ? { tree, branch } : null;
}

/** Before the step: a reading step that names no `--config` takes the branch's recorded one. */
function recallInto(command, args, options) {
  if (options.config || !READERS.has(command)) return;
  const at = target(command, args, options);
  const config = at ? recall(at.tree, at.branch) : null;
  if (config) options.config = config;
}

/** After a step that returned: the `--config` its own call named becomes the branch's record. */
function rememberFrom(command, options, named, result) {
  if (!named || !WRITERS.has(command)) return;
  const payload = (result && result.payload) || {};
  const tree = options.tree || options.cwd;
  let branch = null;
  if (command === 'claim') branch = payload.run;
  else if (command === 'worktree') branch = payload.branch;
  else branch = branchOf(tree);
  if (branch) remember(tree, branch, named, command);
}

module.exports = { recall, recallInto, recordFile, remember, rememberFrom };
