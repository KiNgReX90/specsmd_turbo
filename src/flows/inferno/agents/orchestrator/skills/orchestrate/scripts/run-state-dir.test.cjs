'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { tempDir } = require('./test-temp.cjs');

// The folder of a tree's run records: on a branch `<cache>/<branch>/`, byte for byte as a host
// reads it today, and in a detached tree `<cache>/.detached/<name>-<hash>/`, named by the tree.

const XDG = path.join(tempDir('inferno-state-dir-cache-'), 'cache');
process.env.XDG_CACHE_HOME = XDG;

const { branchDir, holderOf, sameTree, stateDir } = require('./run-state-dir.cjs');
const { jobPaths } = require('./run-jobs.cjs');
const { ownerFile } = require('./run-owner.cjs');
const { recordsOf } = require('./run-check-session.cjs');
const { scanRoot } = require('./run-scan.cjs');
const { journalPath } = require('./run-mutate-journal.cjs');
const { reviewDispatchPath } = require('./run-slot.cjs');

const BRANCH = 'inferno-intent/demo-00000000T000000Z';
const NAMES = ['gate-job.json', 'lane-smoke-job.result.json', 'owner.json', 'check-sessions', 'scan', 'mutate-journal.json', 'intent-review-dispatch.json'];

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hash8 = (tree) => crypto.createHash('sha256').update(fs.realpathSync(tree)).digest('hex').slice(0, 8);

/** Every record of a tree a host reads, in the order of NAMES. */
const records = (tree) => [jobPaths(tree).job, jobPaths(tree, 'smoke').result, ownerFile(tree), recordsOf(tree), scanRoot(tree), journalPath(tree),
  reviewDispatchPath(tree)];

function repo(t) {
  const dir = tempDir('inferno-state-dir-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'app');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, '-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init');
  return { dir, root };
}

/** A detached worktree `name` of the repo, at its one commit. */
function detached(dir, root, name) {
  const tree = path.join(dir, name);
  git(root, 'worktree', 'add', '-q', '--detach', tree);
  return tree;
}

test('a tree on a branch keeps every record a host reads under <cache>/<branch>/, a slash in the branch a folder in it', (t) => {
  const { root } = repo(t);
  git(root, 'checkout', '-qb', BRANCH);
  assert.equal(stateDir(root), `${XDG}/specsmd-inferno/app/inferno-intent/demo-00000000T000000Z`);
  assert.deepEqual(records(root), NAMES.map((name) => `${XDG}/specsmd-inferno/app/inferno-intent/demo-00000000T000000Z/${name}`));
  assert.equal(holderOf(root), BRANCH);
  assert.equal(branchDir(root, 'inferno-intent/other-1'), `${XDG}/specsmd-inferno/app/inferno-intent/other-1`);
});

test('two detached trees at one commit keep two folders under <cache>/.detached/, each named by its tree', (t) => {
  const { dir, root } = repo(t);
  const a = detached(dir, root, 'A');
  const b = detached(dir, root, 'B');
  for (const [tree, name] of [[a, 'A'], [b, 'B']]) {
    const folder = `${XDG}/specsmd-inferno/app/.detached/${name}-${hash8(tree)}`;
    assert.equal(stateDir(tree), folder);
    assert.deepEqual(records(tree), NAMES.map((file) => `${folder}/${file}`));
    assert.equal(holderOf(tree), `${name}-${hash8(tree)}`);
  }
  assert.notEqual(hash8(a), hash8(b));
});

test('a tree reached through a symlink or from a folder inside it is the tree itself', (t) => {
  const { dir, root } = repo(t);
  const a = detached(dir, root, 'A');
  const link = path.join(dir, 'link');
  fs.symlinkSync(a, link);
  fs.mkdirSync(path.join(a, 'sub'));
  for (const way of [link, path.join(a, 'sub'), path.join(link, 'sub')]) {
    assert.equal(stateDir(way), stateDir(a));
    assert.equal(holderOf(way), holderOf(a));
    assert.equal(sameTree(way, a), true, way);
  }
  // A path in no tree, as a removed tree's, is the same tree only as itself.
  const gone = path.join(dir, 'gone');
  assert.equal(sameTree(a, detached(dir, root, 'B')), false);
  assert.equal(sameTree(gone, a), false);
  assert.equal(sameTree(gone, gone), true);
  assert.equal(sameTree(gone, path.join(dir, 'also-gone')), false);
});

test('a folder name keeps only [A-Za-z0-9._-], and one with nothing but dots left is named by its hash alone', (t) => {
  const { dir, root } = repo(t);
  const cases = [['a b+c', 'abc-'], ['日本', ''], ['...', ''], ['x.y_z-1', 'x.y_z-1-']];
  for (const [name, kept] of cases) {
    const tree = detached(dir, root, name);
    assert.equal(stateDir(tree), `${XDG}/specsmd-inferno/app/.detached/${kept}${hash8(tree)}`, name);
    assert.equal(holderOf(tree), `${kept}${hash8(tree)}`, name);
  }
});

test('a tree that leaves its branch for a detached HEAD changes folder, and is back in its branch folder on the branch', (t) => {
  const { root } = repo(t);
  assert.equal(stateDir(root), `${XDG}/specsmd-inferno/app/main`);
  git(root, 'checkout', '-q', '--detach');
  assert.equal(stateDir(root), `${XDG}/specsmd-inferno/app/.detached/app-${hash8(root)}`);
  assert.equal(holderOf(root), `app-${hash8(root)}`);
  git(root, 'checkout', '-q', 'main');
  assert.equal(stateDir(root), `${XDG}/specsmd-inferno/app/main`);
  assert.equal(holderOf(root), 'main');
});
