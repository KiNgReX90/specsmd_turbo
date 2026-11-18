'use strict';

// verify-item after a sibling's commit changed a file two items of one intent own, once the
// item's dispatch was accepted: when every commit that changed it since names siblings in its
// `Item:` trailers, verify-item takes the proof again itself and says the item's review is owed
// for that range, with no new dispatch. Bytes no sibling's commit explains keep the
// DISPATCH_PROOF refusal word for word. Folds beside a sibling: run-sibling-fold.test.cjs. The
// owed review: run-sibling-review.test.cjs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');
const { ITEMS, SHARED, aLanded, build, commit, refused, said, siblingChanged, verifyFrom } = require('./run-sibling-fixture.cjs');

test('a sibling\'s commit to a file two items own gives a fresh proof and an owed review, never DISPATCH_PROOF', (t) => {
  const { f, dispatch, landed, sibling } = siblingChanged(t);
  // A later commit with no trailer that leaves the guide alone, as a review record is, explains nothing and needs nothing.
  f.write('.specs-inferno/notes.md', 'a ledger note\n');
  commit(f, ['.specs-inferno/notes.md']);
  const result = verifyFrom(f, 'a');
  assert.equal(result.code, 0, result.out);
  assert.equal(result.data.dispatches[0].dispatch_id, dispatch, 'no new dispatch');
  assert.deepEqual(result.data.dispatches[0].siblings, [{ file: SHARED, items: ['b'], commit: sibling, from: landed }]);
  assert.deepEqual([result.data.outside, result.data.unreported], [[], []]);
  const proof = JSON.parse(fs.readFileSync(result.data.proof, 'utf8'));
  assert.equal(proof.passed, true);
  assert.equal(proof.head, f.git('rev-parse', 'HEAD'));
  assert.ok(proof.diff.paths.includes(SHARED), proof.diff.paths.join(', '));
  const human = f.human('verify-item', 'a', '--tree', f.root);
  assert.equal(human.code, 0, human.out);
  assert.match(human.out, said(f, { commit: sibling, from: landed }));
  assert.doesNotMatch(human.out, /DISPATCH_PROOF/);
});

test('a shared file named with a leading dash and larger than a pipe\'s default buffer is read as itself', (t) => {
  const f = fixture(t, { a: ['-guide.md', 'a.cjs'], b: ['-guide.md', 'b.cjs'] });
  const page = `${'a line of the guide, long enough to fill a page quickly\n'.repeat(40000)}`;
  build(f, 'a', { '-guide.md': `${page}by a\n`, 'a.cjs': 'a\n' });
  const landed = commit(f, ['-guide.md', 'a.cjs'], 'Item: a');
  build(f, 'b', { '-guide.md': `${page}by a\nby b\n`, 'b.cjs': 'b\n' });
  const sibling = commit(f, ['-guide.md', 'b.cjs'], 'Item: b');
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].siblings, [{ file: '-guide.md', items: ['b'], commit: sibling, from: landed }]);
});

for (const [why, trailers] of [
  ['carries no Item trailer', []],
  ['names the item itself', ['Item: a']],
  ['names an id that is no item', ['Item: nobody']],
  ['names an item of the intent that does not own the file', ['Item: c']],
  ['names a sibling and the item itself', ['Item: b', 'Item: a']],
  ['names a sibling and an item that does not own the file', ['Item: b', 'Item: c']],
]) {
  test(`a commit to the shared file that ${why} keeps the DISPATCH_PROOF refusal`, (t) => {
    refused(siblingChanged(t, trailers).f.verify('a'));
  });
}

test('a commit naming an item of another intent that owns the same path explains nothing', (t) => {
  const { f } = siblingChanged(t, ['Item: z'], ITEMS, (repo) => {
    const state = fs.readFileSync(path.join(repo.root, '.specs-inferno/state.yaml'), 'utf8');
    repo.write('.specs-inferno/state.yaml', `${state}  - id: beta\n    status: pending\n    work_items:\n      - id: z\n        status: pending\n`);
    repo.write('.specs-inferno/intents/beta/work-items/z.md', '---\nid: z\nintent: beta\n---\n\n## Execution Manifest\n\nownership:\n  editable:\n    - docs/\n');
    commit(repo, ['.specs-inferno']);
  });
  refused(f.verify('a'));
});

test('a commit naming an item of the intent whose spec lists no ownership explains nothing', (t) => {
  const { f } = siblingChanged(t, ['Item: e'], ITEMS, (repo) => {
    const state = fs.readFileSync(path.join(repo.root, '.specs-inferno/state.yaml'), 'utf8');
    repo.write('.specs-inferno/state.yaml', `${state}      - id: e\n        status: pending\n`);
    repo.write('.specs-inferno/intents/alpha/work-items/e.md', '---\nid: e\nintent: alpha\n---\n\n# Work Item: e\n');
    commit(repo, ['.specs-inferno']);
  });
  refused(f.verify('a'));
});

test('the tree holding the shared file on other bytes than HEAD after the sibling\'s commit is refused', (t) => {
  const { f } = siblingChanged(t);
  f.write(SHARED, 'guide\nby a\nby b\nand by hand\n');
  refused(f.verify('a'));
});

test('accepted bytes no commit holds are refused, whatever the commit after them names', (t) => {
  const f = fixture(t, ITEMS);
  build(f, 'a', { [SHARED]: 'guide\nby a\n', 'a.cjs': 'a\n' });
  f.write(SHARED, 'guide\nby someone else\n');
  commit(f, [SHARED, 'a.cjs'], 'Item: b');
  refused(f.verify('a'));
});

test('a grant to an item of another intent with the same id owns nothing here', (t) => {
  const f = fixture(t, ITEMS);
  const state = fs.readFileSync(path.join(f.root, '.specs-inferno/state.yaml'), 'utf8');
  f.write('.specs-inferno/state.yaml', `${state}  - id: beta\n    status: pending\n    work_items:\n      - id: c\n        status: pending\n`);
  f.write('.specs-inferno/intents/beta/work-items/c.md', '---\nid: c\nintent: beta\n---\n\n## Execution Manifest\n\nownership:\n  editable:\n    - c.cjs\n');
  commit(f, ['.specs-inferno']);
  aLanded(f);
  const other = f.call('dispatch-log', 'beta', '--item', 'c', '--tier', 'strong', '--agent', 'builder', '--tree', f.root);
  assert.equal(other.code, 0, other.out);
  assert.equal(f.call('grant', other.data.dispatch_id, '--path', SHARED, '--tree', f.root).code, 0);
  f.accepted(other.data.dispatch_id, []);
  build(f, 'b', { [SHARED]: 'guide\nby a\nby b\n', 'b.cjs': 'b\n' });
  commit(f, [SHARED, 'b.cjs'], 'Item: c');
  refused(f.verify('a'));
});

test('a branch rewritten past the accepted commit is read no further than its new root, even one naming the sibling', (t) => {
  const f = fixture(t, ITEMS);
  f.write('docs/old.md', 'old\n');
  commit(f, ['docs/old.md']);
  const dispatch = f.start('--item', 'a');
  fs.rmSync(path.join(f.root, 'docs/old.md'));
  f.accepted(dispatch, ['docs/old.md']);
  f.write('docs/old.md', 'other\n');
  f.git('checkout', '-q', '--orphan', 'rewritten');
  f.git('add', '-A');
  f.git('commit', '-qm', 'a new root', '-m', 'Item: b');
  build(f, 'b', { 'docs/old.md': 'other\nby b\n' });
  commit(f, ['docs/old.md'], 'Item: b');
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /^ERROR \[DISPATCH_PROOF\] accepted dispatch bytes changed at docs\/old\.md: run dispatch-log before /m);
});

test('a commit with no trailer after the sibling\'s, changing the shared file again, is refused', (t) => {
  const { f } = siblingChanged(t);
  f.write(SHARED, 'guide\nby a\nby b\nby nobody\n');
  commit(f, [SHARED]);
  refused(f.verify('a'));
});

test('the walk starts at the newest commit that holds the accepted bytes, so a change undone before it needs no trailer', (t) => {
  const f = fixture(t, ITEMS);
  aLanded(f);
  f.write(SHARED, 'guide\nfor a moment\n');
  commit(f, [SHARED]);
  f.write(SHARED, 'guide\nby a\n');
  const restored = commit(f, [SHARED]);
  build(f, 'b', { [SHARED]: 'guide\nby a\nby b\n', 'b.cjs': 'b\n' });
  const sibling = commit(f, [SHARED, 'b.cjs'], 'Item: b');
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].siblings, [{ file: SHARED, items: ['b'], commit: sibling, from: restored }]);
});

test('two siblings\' commits in turn are each named, oldest first', (t) => {
  const { f, landed, sibling } = siblingChanged(t);
  build(f, 'd', { [SHARED]: 'guide\nby a\nby b\nby d\n', 'd.cjs': 'd\n' });
  const second = commit(f, [SHARED, 'd.cjs'], 'Item: d');
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].siblings, [
    { file: SHARED, items: ['b'], commit: sibling, from: landed },
    { file: SHARED, items: ['d'], commit: second, from: landed },
  ]);
  const human = f.human('verify-item', 'a', '--tree', f.root);
  assert.match(human.out, said(f, { commit: sibling, from: landed }));
  assert.match(human.out, said(f, { commit: second, from: landed, items: ['d'] }));
});

test('one commit naming two siblings that both own the file explains it, and the line names both', (t) => {
  const { f, landed, sibling } = siblingChanged(t, ['Item: b', 'Item: d']);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].siblings, [{ file: SHARED, items: ['b', 'd'], commit: sibling, from: landed }]);
  assert.match(f.human('verify-item', 'a', '--tree', f.root).out, said(f, { commit: sibling, from: landed, items: ['b', 'd'] }));
});

test('a sibling the file was granted to owns it as if its spec listed it', (t) => {
  const f = fixture(t, ITEMS);
  const { landed } = aLanded(f);
  const id = f.start('--item', 'c');
  const granted = f.call('grant', id, '--path', SHARED, '--tree', f.root);
  assert.equal(granted.code, 0, granted.out);
  f.write(SHARED, 'guide\nby a\nby c\n');
  f.write('c.cjs', 'c\n');
  f.accepted(id, [SHARED, 'c.cjs']);
  const sibling = commit(f, [SHARED, 'c.cjs'], 'Item: c');
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].siblings, [{ file: SHARED, items: ['c'], commit: sibling, from: landed }]);
});

test('the sibling\'s own verify-item, with its own dispatch-log, reads as before', (t) => {
  const { f } = siblingChanged(t);
  const result = f.verify('b');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].siblings, []);
  assert.doesNotMatch(f.human('verify-item', 'b', '--tree', f.root).out, /took the proof again/);
});

test('a dispatch-log of the item\'s own correction after a sibling\'s commit is not blocked, and its proof needs no sibling', (t) => {
  const { f } = siblingChanged(t);
  build(f, 'a', { 'a.cjs': 'a corrected\n' });
  commit(f, ['a.cjs'], 'Item: a');
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.dispatches[0].siblings, []);
});

test('a sibling that ran beside the item, its dispatch open while the item\'s was, still overlaps', (t) => {
  const f = fixture(t, ITEMS);
  const one = f.start('--item', 'a');
  const two = f.start('--item', 'b');
  f.write(SHARED, 'guide\nby a\n');
  f.write('a.cjs', 'a\n');
  f.accepted(one, [SHARED, 'a.cjs']);
  commit(f, [SHARED, 'a.cjs'], 'Item: a');
  f.write(SHARED, 'guide\nby a\nby b\n');
  f.write('b.cjs', 'b\n');
  f.accepted(two, [SHARED, 'b.cjs']);
  commit(f, [SHARED, 'b.cjs'], 'Item: b');
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /DISPATCH_PROOF\] dispatch ownership overlaps at docs\/guide\.md with dispatch /);
});

test('a change one sibling\'s builder made under another sibling\'s trailer still overlaps', (t) => {
  const f = fixture(t, ITEMS);
  aLanded(f);
  build(f, 'd', { [SHARED]: 'guide\nby a\nby d\n', 'd.cjs': 'd\n' });
  commit(f, [SHARED, 'd.cjs'], 'Item: b');
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /DISPATCH_PROOF\] dispatch ownership overlaps at docs\/guide\.md with dispatch /);
});

test('a sibling\'s change to another file the item owns but never changed still overlaps', (t) => {
  const f = fixture(t, ITEMS);
  aLanded(f);
  build(f, 'b', { [SHARED]: 'guide\nby a\nby b\n', 'docs/other.md': 'b\'s own page\n' });
  commit(f, [SHARED, 'docs/other.md'], 'Item: b');
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, /DISPATCH_PROOF\] dispatch ownership overlaps at docs\/other\.md with dispatch /);
});

test('a chain names the review owed only of its item whose review reads the file', (t) => {
  const f = fixture(t, { a1: ['docs/', 'a1.cjs'], a2: ['a2.cjs'], b: ['docs/', 'b.cjs'] });
  const chain = f.start('--items', 'a1,a2');
  for (const file of [SHARED, 'a1.cjs', 'a2.cjs']) f.write(file, `${file} by the chain\n`);
  f.accepted(chain, [SHARED, 'a1.cjs', 'a2.cjs']);
  const landed = commit(f, [SHARED, 'a1.cjs', 'a2.cjs'], 'Item: a1', 'Item: a2');
  build(f, 'b', { [SHARED]: `${SHARED} by the chain\nby b\n`, 'b.cjs': 'b\n' });
  const sibling = commit(f, [SHARED, 'b.cjs'], 'Item: b');
  const result = f.human('verify-item', '--items', 'a1,a2', '--tree', f.root);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, said(f, { commit: sibling, from: landed, ids: ['a1', 'a2'], owners: ['a1'] }));
});
