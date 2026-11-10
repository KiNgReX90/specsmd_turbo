'use strict';

/**
 * `run.cjs ship`: fold the base branch in, confirm the folded tree is green, merge, push,
 * prove the merge landed, and tear the worktree and branch down.
 *
 * It runs from the PRIMARY checkout, never from inside the worktree, because git refuses to
 * check the base branch out twice and the improvisation around that refusal (pushing
 * HEAD:base from the worktree) advances origin while the local base never moves. Every
 * precondition is its own refusal, and nothing after the merge is skipped silently: a
 * failure there prints exactly what is left to do.
 *
 * `run.cjs teardown` is ship's last step on its own, for the host that merges by hand and
 * for a worktree an interrupted ship left standing. It removes nothing the base branch
 * does not already hold.
 *
 * Both end with the host's `verification.ship_cleanup`, when set: one command run from the primary
 * checkout once the tree and branch are gone. Its failure prints a line and never undoes the ship.
 *
 * A lane red accepted as intermittent goes into the ship commit as one `exception:` line per lane,
 * written here so nobody writes it by hand; those lines on the base are the ledger a later accept
 * reads (run-lanes-intermittent.cjs), and ship refuses an accept the base already holds twice.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { resolveBase } = require('./run-intents.cjs');
const { intentOf, worktreeEntries } = require('./run-worktrees.cjs');
const { green } = require('./run-gate.cjs');
const { intermittentHeld } = require('./run-lanes.cjs');
const { shipExceptions } = require('./run-lanes-intermittent.cjs');
const { linkedTree, loadOwnership, stopOwnedProcesses } = require('./run-processes.cjs');
const gates = require('./run-config-gates.cjs');

const { mergeSlot } = gates;
const slot = require('./run-slot.cjs');

const { RunError } = lib;
const TERMINAL = new Set(['completed', 'done']);

/** The intent is shippable when the branch already closed it, archived or not. */
function closedInTree(tree, intentId) {
  const ledger = lib.readLedger(tree);
  const intent = ledger.intents.find((entry) => entry.id === intentId);
  if (intent) {
    if (TERMINAL.has(intent.status)) return { where: 'ledger', base_branch: intent.base_branch };
    throw new RunError(
      `refusing to ship ${intentId}: the worktree ledger has it ${intent.status || 'unset'}, not completed. Run close-intent first.`,
      'NOT_COMPLETE'
    );
  }
  const archive = path.join(tree, lib.SPECS_DIR, 'archive', 'state.yaml');
  if (fs.existsSync(archive) && new RegExp(`^ *- id: ${intentId}\\s*$`, 'm').test(fs.readFileSync(archive, 'utf8'))) {
    return { where: 'archive', base_branch: null };
  }
  throw new RunError(
    `refusing to ship ${intentId}: the worktree knows nothing about it, neither open nor completed in its ledger.`,
    'INTENT_NOT_FOUND'
  );
}

function ship(intentId, options) {
  if (!options.tree) throw new RunError('ship requires --tree <worktree path>', 'BAD_ARGS', 1);
  const tree = path.resolve(options.tree);
  const primary = lib.primaryRoot(options.cwd);
  // Before anything merges, pushes or signals: the tree is this intent's linked worktree.
  linkedTree(primary, tree, intentId);
  const config = lib.readConfig(options.config ? tree : primary, options.config);
  const closed = closedInTree(tree, intentId);
  const base = options.base || resolveBase(config, closed, primary);
  const branch = lib.git(tree, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const out = [];

  const on = lib.currentBranch(primary);
  if (on !== base) {
    throw new RunError(`refusing to ship: the primary checkout is on ${on}, not the base branch ${base}.`, 'NOT_ON_BASE');
  }
  // The primary checkout usually carries other sessions' edits; every merge below runs with --autostash.
  const dirtyTree = lib.dirtyPaths(tree);
  if (dirtyTree.length > 0) {
    throw new RunError(`refusing to ship: the worktree carries ${dirtyTree.slice(0, 5).join(', ')}`, 'DIRTY');
  }

  // (1) Fold the base in, so the tree the gate passed is the tree that becomes the base.
  const remote = lib.git(primary, ['remote'], { tolerate: true });
  if (remote) {
    lib.git(primary, ['fetch', '--quiet', 'origin', base], { tolerate: true });
    const behind = lib.git(primary, ['rev-list', '--count', `${base}..origin/${base}`], { tolerate: true });
    if (behind && Number(behind) > 0) lib.git(primary, ['merge', '--no-edit', '--autostash', `origin/${base}`]);
  }
  const fold = lib.git(tree, ['merge', '--no-edit', base], { tolerate: true });
  if (fold === null) {
    const conflicts = lib.gitLines(tree, ['diff', '--name-only', '--diff-filter=U'], { tolerate: true });
    out.push(`conflict folding ${base} into ${branch}:`, ...conflicts.slice(0, 10));
    out.push('resolve them in the worktree, commit, then run ship again. Nothing else was done.');
    return { exit: 2, payload: { ok: false, step: 'fold', conflicts }, out };
  }

  // (2) The folded tree has to be the tree that passed the gate.
  const proof = green({ tree, config: options.config, intent: intentId });
  if (proof.exit !== 0) {
    out.push(`${branch} is not green after folding ${base} in`, ...proof.out);
    return { exit: 3, payload: { ok: false, step: 'green', hash: proof.payload.hash, owed: proof.payload.owed }, out };
  }

  // The lane reds accepted as intermittent, refused before anything merges once the base holds two accepts of a test.
  const exceptions = shipExceptions(primary, base, intermittentHeld(tree, lib.readConfig(tree, options.config), options.config));

  // (3) Merge, from the primary checkout.
  const tip = lib.git(tree, ['rev-parse', 'HEAD']);
  lib.git(primary, ['merge', '--no-ff', '--autostash', '-m', `Merge branch '${branch}'`, ...exceptions.flatMap((line) => ['-m', line]), branch]);
  const sha = lib.git(primary, ['rev-parse', '--short', 'HEAD']);
  out.push(`merged ${branch} into ${base} as ${sha}`);

  const left = [];
  let cleanup = null;
  try {
    // (4) Push, and (5) prove the merge is an ancestor of what the base now points at.
    if (remote) {
      left.push(`push ${base}`);
      lib.git(primary, ['push', '--quiet', 'origin', base]);
      left.pop();
    }
    const target = remote ? `origin/${base}` : base;
    if (lib.git(primary, ['merge-base', '--is-ancestor', tip, target], { tolerate: true }) === null) {
      throw new RunError(`${branch} is not an ancestor of ${target} after the merge`, 'NOT_ANCESTOR');
    }
    out.push(`${base} verified against ${target}`);

    // (6) Teardown, safe because step 5 proved the work is reachable from the base branch.
    cleanup = removeWorktree(primary, tree, branch, out, left, options, gates.shipCleanup(config));
  } catch (error) {
    out.push(`${error.message}`, `left to do: ${left.join('; ')}`);
    return { exit: 2, payload: { ok: false, step: 'after-merge', sha, left }, out };
  }

  out.push('shipped');
  return { exit: 0, payload: { ok: true, intent: intentId, branch, base, sha, tip, cleanup, exceptions }, out };
}

/**
 * Stop the processes the run registered in the worktree, remove it, delete its branch, then run
 * the host's ship cleanup when one is set. A process that merely sits in the tree is never
 * signalled; see run-processes.cjs. `left` names what a failure leaves owed. Returns the
 * cleanup's `{ code, log }`, or null without one.
 */
function removeWorktree(primary, tree, branch, out, left, options, command) {
  // The base holds the branch's work, so its merge slot ticket goes first: a failed removal never holds the slot.
  left.push(`git -C ${primary} worktree remove ${tree}`, `git -C ${primary} branch -d ${branch}`);
  if (mergeSlot(lib.readConfig(primary, options.config))) slot.release(primary, branch);
  if (command) left.push(`INFERNO_BRANCH=${branch} INFERNO_TREE=${tree} ${command} (in ${primary})`);
  const killed = stopOwnedProcesses(loadOwnership(tree), options.processTransport);
  if (killed.length > 0) out.push(`stopped ${killed.length} process(es) in the worktree`);
  lib.git(primary, ['worktree', 'remove', tree]);
  left.shift();
  lib.git(primary, ['branch', '-d', branch]);
  left.shift();
  if (!command) return null;
  const cleanup = shipCleanup(primary, tree, branch, command, out);
  left.shift();
  return cleanup;
}

/**
 * Run the host's ship cleanup from the primary checkout, with the branch and the tree in its
 * environment. Its log sits in the primary's cache, outside the branch's folder the host removes.
 * Nothing here throws: the ship already stands, so a failure is one printed line.
 */
function shipCleanup(primary, tree, branch, command, out) {
  let log = null;
  try {
    // runShell inherits this one-shot process's environment.
    Object.assign(process.env, { INFERNO_BRANCH: branch, INFERNO_TREE: path.resolve(tree) });
    log = path.join(lib.cacheDir(primary), 'ship-cleanup', `${branch.replace(/[^A-Za-z0-9._-]/g, '-')}-${lib.stamp()}.log`);
    const run = lib.runShell(command, primary, log);
    const said = fs.readFileSync(log, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).pop() || '(no output)';
    if (run.code === 0) out.push(`ship cleanup: ${said}`);
    else out.push(`ship cleanup exited ${run.code}: ${said}`, `log ${log}`);
    return { code: run.code, log };
  } catch (error) {
    out.push(`ship cleanup failed: ${error.message}`);
    return { code: null, log };
  }
}

/**
 * `run.cjs teardown --tree <dir>`: remove an intent worktree whose work the base branch
 * already holds. Refuses the primary checkout, a tree that is not a linked worktree, a dirty
 * tree, a branch with commits the base does not reach, and the worktree of an intent the
 * ledger still has in progress, since that tree is a run or a recovery.
 */
function teardown(options) {
  if (!options.tree) throw new RunError('teardown requires --tree <worktree path>', 'BAD_ARGS', 1);
  const tree = path.resolve(options.tree);
  const primary = path.resolve(lib.primaryRoot(options.cwd));
  if (tree === primary) throw new RunError('refusing to tear down the primary checkout', 'PRIMARY');
  const entry = worktreeEntries(primary).find((candidate) => path.resolve(candidate.path) === tree);
  if (!entry || !entry.branch) throw new RunError(`${tree} is not a linked worktree of ${primary} on a branch`, 'NOT_A_WORKTREE');
  const branch = entry.branch;

  const intentId = intentOf(branch);
  if (intentId) {
    const intent = lib.readLedger(primary).intents.find((candidate) => candidate.id === intentId);
    if (intent && intent.status === 'in_progress') {
      throw new RunError(`refusing to tear down ${tree}: ${intentId} is in progress in the ledger`, 'LIVE_RUN');
    }
  }
  const dirty = lib.dirtyPaths(tree);
  if (dirty.length > 0) {
    throw new RunError(`refusing to tear down ${tree}: it carries ${dirty.slice(0, 5).join(', ')}`, 'DIRTY');
  }

  const config = lib.readConfig(primary, options.config);
  const base = options.base || resolveBase(config, null, primary);
  const remote = lib.git(primary, ['remote'], { tolerate: true });
  if (remote) lib.git(primary, ['fetch', '--quiet', 'origin', base], { tolerate: true });
  const target = remote ? `origin/${base}` : base;
  const tip = lib.git(tree, ['rev-parse', 'HEAD']);
  if (lib.git(primary, ['merge-base', '--is-ancestor', tip, target], { tolerate: true }) === null) {
    throw new RunError(`refusing to tear down ${tree}: ${branch} carries commits ${target} does not hold. Ship it first.`, 'NOT_MERGED');
  }

  const out = [];
  const left = [];
  let cleanup = null;
  try {
    cleanup = removeWorktree(primary, tree, branch, out, left, options, gates.shipCleanup(config));
  } catch (error) {
    out.push(`${error.message}`, `left to do: ${left.join('; ')}`);
    return { exit: 2, payload: { ok: false, tree, branch, left }, out };
  }
  out.push(`removed ${tree}`, `deleted ${branch}`);
  return { exit: 0, payload: { ok: true, tree, branch, base, tip, cleanup }, out };
}

module.exports = { ship, teardown };
