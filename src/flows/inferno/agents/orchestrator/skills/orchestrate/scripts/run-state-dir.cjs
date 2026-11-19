'use strict';

/**
 * The folder of a tree's run records under the cache: its gate and lane jobs and their results,
 * its lane accepts, its owner, its check sessions, its mutate journal, its scan and the logs of
 * its steps. This module alone names it; no other file joins the cache folder with a branch name
 * (test-state-dir.test.cjs holds every script to that).
 *
 * On a branch the folder is `<cache>/<branch>/`, as it always was: git checks a branch out in one
 * worktree at a time. Git names every detached checkout `HEAD`, so a folder named by the branch
 * was one folder for every detached tree of a repository, and a gate in one answered another's
 * wait. A detached tree's folder is named by the tree, never by its commit:
 * `<cache>/.detached/<name>-<hash>/`, the folder name of its top level reduced to [A-Za-z0-9._-]
 * and the first 8 hex of the sha256 of its real path. A name reduced to nothing or to dots alone is
 * left out, and the hash alone names the folder. No branch maps there, since a ref's path component
 * never starts with a dot. A tree reached through a symlink is the tree it points to; a tree that
 * is moved gets a new folder, and one that leaves its branch or checks one out changes folder with it.
 */

const crypto = require('crypto');
const path = require('path');

const lib = require('./run-lib.cjs');

const DETACHED = '.detached';

/**
 * The real path of the top level of the tree `dir` is in, which git prints with every symlink
 * resolved, or `dir` as given when it is in no tree, as a removed tree is not.
 */
function realTree(dir) {
  try {
    return lib.repoRoot(dir);
  } catch (error) {
    return dir;
  }
}

/** Do two paths name one tree. */
const sameTree = (a, b) => realTree(a) === realTree(b);

/** The folder of the branch `branch`, which claim and ship address by its name. */
const branchDir = (tree, branch) => path.join(lib.cacheDir(tree), branch);

/** A detached tree's name: its reduced folder name and the hash of its real path, or the hash alone. */
function detachedName(tree) {
  const real = realTree(tree);
  const hash = crypto.createHash('sha256').update(real).digest('hex').slice(0, 8);
  const name = path.basename(real).replace(/[^A-Za-z0-9._-]/g, '');
  return /^\.*$/.test(name) ? hash : `${name}-${hash}`;
}

/** Where the tree's records go, and the name its merge slot ticket is held under unless a holder is named. */
function place(tree) {
  const branch = lib.currentBranch(tree);
  if (branch !== 'HEAD') return { dir: branchDir(tree, branch), holder: branch };
  const name = detachedName(tree);
  return { dir: path.join(lib.cacheDir(tree), DETACHED, name), holder: name };
}

/** The folder of the tree's run records. */
const stateDir = (tree) => place(tree).dir;

/** The merge slot holder a tree takes, renews and releases by default: its branch, or its detached folder's name. */
const holderOf = (tree) => place(tree).holder;

module.exports = { branchDir, holderOf, sameTree, stateDir };
