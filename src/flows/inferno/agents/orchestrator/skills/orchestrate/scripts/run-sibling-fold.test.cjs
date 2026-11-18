'use strict';

// A sibling's commit beside a fold of the base in the shared file, in either order: a fold whose
// merge holds the file as the clean merge of both sides is the base's, and the sibling's commit
// is the sibling's, so the change is explained whole. A fold resolved by hand, a merge of any
// other branch, and a fold that is all there is to the change are refused as before. Also a
// file the item wrote executable, a link it wrote, and a file it deleted.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { fixture, write } = require('./run-attribution-fixture.cjs');
const { reword } = require('./run-fold-fixture.cjs');
const { ITEMS, SHARED, build, commit, refused, said, verifyFrom } = require('./run-sibling-fixture.cjs');

/** The guide in three parts far enough apart that a change to one merges cleanly with a change to another. */
const guide = (top, middle, bottom) => `top ${top}\n\n\n\n\nmiddle ${middle}\n\n\n\n\nbottom ${bottom}\n`;

/** An intent whose base and branch both hold the guide; item a then writes its middle and lands. */
function folding(t) {
  const f = fixture(t, ITEMS);
  f.moveBase(SHARED, guide(0, 0, 0));
  f.git('merge', '-q', '--ff-only', 'main');
  build(f, 'a', { [SHARED]: guide(0, 1, 0), 'a.cjs': 'a\n' });
  return { f, landed: commit(f, [SHARED, 'a.cjs'], 'Item: a') };
}

/** Sibling b writes the guide's bottom on top of what the tree holds and lands with its trailer. */
function bLands(f, top) {
  build(f, 'b', { [SHARED]: guide(top, 1, 2), 'b.cjs': 'b\n' });
  return commit(f, [SHARED, 'b.cjs'], 'Item: b');
}

test('a sibling\'s commit, then a fold that changed the shared file too, is explained whole', (t) => {
  const { f, landed } = folding(t);
  const sibling = bLands(f, 0);
  // The base's commit is dated after every other, so a walk that left HEAD's first-parent line would read it first.
  const base = path.join(path.dirname(f.root), 'base');
  write(base, SHARED, guide(3, 0, 0));
  execFileSync('git', ['commit', '-qam', 'the base moved'], { cwd: base, env: { ...process.env, GIT_COMMITTER_DATE: '2099-01-01T00:00:00Z' } });
  f.git('merge', '-q', '--no-edit', 'main');
  const result = verifyFrom(f, 'a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].siblings, [{ file: SHARED, items: ['b'], commit: sibling, from: landed }]);
  assert.match(f.human('verify-item', 'a', '--tree', f.root).out, said(f, { commit: sibling, from: landed }));
});

test('a fold that changed the shared file, then a sibling\'s commit, is explained whole', (t) => {
  const { f, landed } = folding(t);
  f.moveBase(SHARED, guide(3, 0, 0));
  f.git('merge', '-q', '--no-edit', 'main');
  const sibling = bLands(f, 3);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].siblings, [{ file: SHARED, items: ['b'], commit: sibling, from: landed }]);
});

test('a sibling\'s commit, then a fold of a local base rewritten to the same patch since, is explained whole', (t) => {
  const { f, landed } = folding(t);
  const sibling = bLands(f, 0);
  f.moveBase(SHARED, guide(3, 0, 0));
  f.git('merge', '-q', '--no-edit', 'main');
  reword(f);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].siblings, [{ file: SHARED, items: ['b'], commit: sibling, from: landed }]);
});

test('a fold resolved by hand in the shared file beside a sibling\'s commit is refused', (t) => {
  const { f } = folding(t);
  bLands(f, 0);
  f.moveBase(SHARED, guide(3, 0, 0));
  f.git('merge', '-q', '--no-ff', '--no-commit', 'main');
  f.write(SHARED, `${guide(3, 1, 2)}and a line the fold never held\n`);
  f.git('add', SHARED);
  f.git('commit', '-qm', 'the fold, resolved by hand');
  refused(f.verify('a'));
});

test('a merge of a branch that is not the base, changing the shared file beside a sibling\'s commit, is refused', (t) => {
  const { f } = folding(t);
  bLands(f, 0);
  f.git('checkout', '-qb', 'side');
  f.write(SHARED, guide(4, 1, 2));
  commit(f, [SHARED]);
  f.git('checkout', '-q', 'intent');
  f.git('merge', '-q', '--no-ff', '--no-edit', 'side');
  refused(f.verify('a'));
});

test('a fold that only made the shared file executable is no sibling\'s change, and is refused as before', (t) => {
  const { f } = folding(t);
  const base = path.join(path.dirname(f.root), 'base');
  execFileSync('git', ['update-index', '--chmod=+x', SHARED], { cwd: base });
  execFileSync('git', ['commit', '-qm', 'the base made the guide executable'], { cwd: base });
  f.git('merge', '-q', '--no-edit', 'main');
  refused(f.verify('a'));
});

test('an executable shared file the item wrote is found by its bytes and its mode', (t) => {
  const f = fixture(t, ITEMS);
  const dispatch = f.start('--item', 'a');
  f.write(SHARED, 'guide\nby a\n');
  fs.chmodSync(path.join(f.root, SHARED), 0o755);
  f.accepted(dispatch, [SHARED]);
  const landed = commit(f, [SHARED], 'Item: a');
  build(f, 'b', { [SHARED]: 'guide\nby a\nby b\n' });
  const sibling = commit(f, [SHARED], 'Item: b');
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].siblings, [{ file: SHARED, items: ['b'], commit: sibling, from: landed }]);
});

test('a link the item wrote is held by no commit, not even one holding a file of the link\'s bytes', (t) => {
  const f = fixture(t, ITEMS);
  const dispatch = f.start('--item', 'a');
  fs.mkdirSync(path.join(f.root, 'docs'), { recursive: true });
  fs.symlinkSync('guide-target', path.join(f.root, SHARED));
  f.accepted(dispatch, [SHARED]);
  fs.rmSync(path.join(f.root, SHARED));
  f.write(SHARED, 'guide-target');
  commit(f, [SHARED], 'Item: a');
  build(f, 'b', { [SHARED]: 'guide-target\nby b\n' });
  commit(f, [SHARED], 'Item: b');
  refused(f.verify('a'));
});

test('a shared file the item deleted is held by the commit that lacks it, and a sibling writing it again is the sibling\'s', (t) => {
  const { f } = folding(t);
  const dispatch = f.start('--item', 'a');
  fs.rmSync(path.join(f.root, SHARED));
  f.accepted(dispatch, [SHARED]);
  f.git('rm', '-q', SHARED);
  f.git('commit', '-qm', 'land the removal', '-m', 'Item: a');
  const removed = f.git('rev-parse', 'HEAD');
  build(f, 'b', { [SHARED]: 'guide\nby b\n' });
  const sibling = commit(f, [SHARED], 'Item: b');
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].siblings, [{ file: SHARED, items: ['b'], commit: sibling, from: removed }]);
});
