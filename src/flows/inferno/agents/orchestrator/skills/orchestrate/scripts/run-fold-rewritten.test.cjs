'use strict';

// The readers of a fold (run-fold.cjs) after the local base was rewritten since the intent folded
// it: the bytes and the lines that fold brought in are the base's, read from what HEAD merged.
// And what reading the folds costs: one scan of HEAD's merges, git's same-patch test only for a
// second parent no base ref holds, and no git call made twice.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const lib = require('./run-lib.cjs');
const { foldRanges } = require('./run-fold.cjs');
const { fixture } = require('./run-attribution-fixture.cjs');
const { fold, origin, rebase, reword } = require('./run-fold-fixture.cjs');

/** A file in three parts far enough apart that a change to one merges cleanly with a change to another. */
const card = (top, middle, bottom) => `top ${top}\n\n\n\n\nmiddle ${middle}\n\n\n\n\nbottom ${bottom}\n`;

test('a claimed file a local base commit rewritten since and origin both changed, folded apart, is the base\'s alone', (t) => {
  const f = fixture(t, { a: ['card.cjs'] });
  f.moveBase('card.cjs', card(0, 0, 0));
  f.git('merge', '-q', '--ff-only', 'main');
  const remote = origin(f);
  const dispatch = f.start('--item', 'a');
  f.write('card.cjs', card(0, 1, 0));
  f.accepted(dispatch, ['card.cjs']);
  f.land('card.cjs');
  f.moveBase('card.cjs', card(2, 0, 0));
  fold(f);
  remote.push('card.cjs', card(0, 0, 3));
  fold(f, 'origin/main');
  rebase(f);
  assert.equal(fs.readFileSync(path.join(f.root, 'card.cjs'), 'utf8'), card(2, 1, 3));
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.outside, []);
});

const TESTS = 'src/gift_cards/tests/balance.rs';
/** A Rust test file of the named tests, each switched off with #[ignore] for `true`. */
const rust = (...tests) => tests.map(([name, ignore]) => `${ignore ? '#[ignore]\n' : ''}#[test]\nfn ${name}() {\n    assert_eq!(1, 1);\n}\n`).join('\n');

test('a test a local base commit rewritten since switched off in a file the item also edits is the base\'s', (t) => {
  const f = fixture(t, { a: [TESTS] });
  f.moveBase(TESTS, rust(['starts_at_zero'], ['grows_on_top_up'], ['shrinks_on_spend']));
  f.git('merge', '-q', '--ff-only', 'main');
  const remote = origin(f);
  const first = f.start('--item', 'a');
  f.write(TESTS, rust(['starts_at_zero'], ['grows_on_top_up'], ['shrinks_on_spend'], ['expires_after_a_year']));
  f.accepted(first, [TESTS]);
  f.land(TESTS);
  f.moveBase(TESTS, rust(['starts_at_zero'], ['grows_on_top_up', true], ['shrinks_on_spend']));
  fold(f);
  remote.push('other.cjs', 'origin moved\n');
  rebase(f);
  const fix = f.start('--item', 'a');
  f.write(TESTS, rust(['starts_at_zero'], ['grows_on_top_up', true], ['shrinks_on_spend'], ['expires_after_a_year'], ['refunds_in_full']));
  f.accepted(fix, [TESTS]);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.tests_changed.switched_off, []);
});

/** The git calls `fn` makes through run-lib, as argument lists. */
function gitCalls(t, fn) {
  const calls = [];
  for (const name of ['git', 'gitLines']) {
    const original = lib[name];
    t.mock.method(lib, name, (cwd, args, options) => {
      calls.push(args);
      return original(cwd, args, options);
    });
  }
  return { result: fn(), calls };
}

const kind = (args) => `${args[0]}${args.includes('--cherry-pick') ? ' --cherry-pick' : ''}`;
const kinds = (calls) => calls.reduce((counts, args) => ({ ...counts, [kind(args)]: (counts[kind(args)] || 0) + 1 }), {});

test('the folds cost one scan of HEAD\'s merges, a same-patch test only for a base rewritten since, and no git call twice', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const head = f.git('rev-parse', 'HEAD');
  const none = gitCalls(t, () => foldRanges(f.root, head, 'main'));
  assert.deepEqual(none.result, []);
  assert.deepEqual(kinds(none.calls), { 'merge-base': 3, 'rev-list': 1 });
  f.write('a.cjs', 'module.exports = 2;\n');
  f.land('a.cjs');
  for (const file of ['one.cjs', 'two.cjs', 'three.cjs']) {
    f.moveBase(file, 'the base moved\n');
    fold(f);
  }
  const normal = f.git('rev-parse', 'main');
  f.moveBase('x.cjs', 'only the local base holds this\n');
  fold(f);
  const rewritten = f.git('rev-parse', 'main');
  reword(f);
  t.mock.restoreAll();
  const read = gitCalls(t, () => foldRanges(f.root, head, 'main'));
  assert.deepEqual(read.result, [{ held: head, tip: normal }, { held: normal, tip: rewritten, merge: f.git('rev-parse', 'HEAD') }]);
  assert.deepEqual(kinds(read.calls), { 'merge-base': 4, 'rev-list': 2, 'rev-list --cherry-pick': 1 });
  assert.equal(new Set(read.calls.map((args) => JSON.stringify(args))).size, read.calls.length, 'no git call twice');
});

test('the folds into a commit are the ones that commit holds, and a baseline that shares no history with the base, or that git no longer holds, reads none', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const head = f.git('rev-parse', 'HEAD');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.land('a.cjs');
  f.moveBase('one.cjs', 'the base moved\n');
  fold(f);
  const first = f.git('rev-parse', 'main');
  const at = f.git('rev-parse', 'HEAD');
  f.moveBase('two.cjs', 'the base moved again\n');
  fold(f);
  const second = f.git('rev-parse', 'main');
  f.moveBase('x.cjs', 'only the local base holds this\n');
  fold(f);
  const rewritten = f.git('rev-parse', 'main');
  reword(f);
  assert.deepEqual(foldRanges(f.root, head, 'main', at), [{ held: head, tip: first }]);
  assert.deepEqual(foldRanges(f.root, head, 'main'), [{ held: head, tip: second }, { held: second, tip: rewritten, merge: f.git('rev-parse', 'HEAD') }]);
  const unrelated = f.git('commit-tree', 'HEAD^{tree}', '-m', 'a root of its own');
  assert.deepEqual(foldRanges(f.root, unrelated, 'main'), []);
  assert.deepEqual(foldRanges(f.root, '1'.repeat(40), 'main'), []);
});
