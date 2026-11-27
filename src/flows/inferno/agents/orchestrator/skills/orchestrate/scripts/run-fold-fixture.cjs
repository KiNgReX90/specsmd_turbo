'use strict';

// The verify-item fixture (run-attribution-fixture.cjs) with a base rewritten after the intent
// folded it: an origin the local base is pushed to, another clone that moves origin the way
// another machine does, and the local base rebased, amended, reset or cherry-picked onto in the
// worktree that holds it, the way a host brings an unpushed base up to date.

const fs = require('node:fs');
const path = require('node:path');

const { git, write } = require('./run-attribution-fixture.cjs');

/** The worktree that holds the local base, the one the fixture's moveBase commits in. */
function baseTree(f) {
  const base = path.join(path.dirname(f.root), 'base');
  if (!fs.existsSync(base)) f.git('worktree', 'add', '-q', base, 'main');
  return base;
}

/** A git call in the local base's worktree. */
const onBase = (f, ...args) => git(baseTree(f), ...args);

/**
 * A bare origin that local main is pushed to, and another clone that moves it. `push(file, body)`
 * commits on origin's tip from that clone and pushes; `reword()` amends that clone's last commit
 * to the same patch and force-pushes it. Each fetches origin here after.
 */
function origin(f) {
  const dir = path.dirname(f.root);
  const bare = path.join(dir, 'origin.git');
  git(dir, 'init', '-q', '--bare', bare);
  f.git('remote', 'add', 'origin', bare);
  f.git('push', '-q', 'origin', 'main');
  const other = path.join(dir, 'other');
  git(dir, 'clone', '-q', '-b', 'main', bare, other);
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.test');
  function push(file, body) {
    write(other, file, body);
    git(other, 'add', file);
    git(other, 'commit', '-qm', `origin moved ${file}`);
    git(other, 'push', '-q', 'origin', 'main');
    f.git('fetch', '-q', 'origin');
  }
  function reword() {
    git(other, 'commit', '--amend', '-qm', 'origin moved, reworded');
    git(other, 'push', '-qf', 'origin', 'main');
    f.git('fetch', '-q', 'origin');
  }
  return { push, reword };
}

/** The local base rebased onto origin's, as a host brings an unpushed base up to date. */
const rebase = (f) => onBase(f, 'rebase', '-q', 'origin/main');

/** The local base's last commit amended to the same patch: a new id, nothing else changed. */
const reword = (f) => onBase(f, 'commit', '--amend', '-qm', 'the base moved, reworded');

/** The intent folds `refs` in: one is a merge, two or more an octopus. */
const fold = (f, ...refs) => f.git('merge', '-q', '--no-edit', ...(refs.length > 0 ? refs : ['main']));

/** A branch cut from main with one commit per [file, body], left where it ends. Returns its commits, oldest first. */
function side(f, name, ...files) {
  const tree = path.join(path.dirname(f.root), name);
  f.git('worktree', 'add', '-q', '-b', name, tree, 'main');
  return files.map(([file, body]) => {
    write(tree, file, body);
    git(tree, 'add', file);
    git(tree, 'commit', '-qm', `${name} wrote ${file}`);
    return git(tree, 'rev-parse', 'HEAD');
  });
}

module.exports = { baseTree, fold, onBase, origin, rebase, reword, side };
