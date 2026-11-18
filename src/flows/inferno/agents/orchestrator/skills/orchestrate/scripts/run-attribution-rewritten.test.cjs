'use strict';

// verify-item after the intent folded a local base that was rewritten since: rebased onto origin,
// amended or reset before its push. A fold is read from what HEAD merged, never from where a base
// ref stands today, so the commits a fold brought in stay the base's while the base holds a
// commit of the same patch for each. A second parent that fails git's own same-patch test, a
// merge of any other branch and an octopus merge are no fold of this kind: their files stay outside.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { fixture, git, write } = require('./run-attribution-fixture.cjs');
const { baseTree, fold, onBase, origin, rebase, reword, side } = require('./run-fold-fixture.cjs');

/** Item a lands its own file, beside an origin unless `withOrigin` is false. */
function landed(t, withOrigin = true) {
  const f = fixture(t, { a: ['a.cjs'] });
  const remote = withOrigin ? origin(f) : null;
  const dispatch = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(dispatch, ['a.cjs']);
  f.land('a.cjs');
  return { f, remote };
}

/** Item a has landed; then the local base commits x.cjs, which origin does not hold, and the intent folds it. */
function folded(t, withOrigin = true) {
  const { f, remote } = landed(t, withOrigin);
  f.moveBase('x.cjs', 'only the local base holds this\n');
  fold(f);
  return { f, remote };
}

function outside(f, expected) {
  const result = f.verify('a');
  assert.equal(result.code, expected.length > 0 ? 2 : 0, result.out);
  assert.deepEqual(result.data.outside, expected);
}

test('a fold of a local base rebased onto origin since names nothing outside, after one rebase, two, and a second fold and rebase', (t) => {
  const { f, remote } = folded(t);
  remote.push('y.cjs', 'origin moved\n');
  rebase(f);
  assert.throws(() => f.git('merge-base', '--is-ancestor', 'HEAD^2', 'main'), 'HEAD holds the commit, the base its copy');
  outside(f, []);
  remote.push('y.cjs', 'origin moved again\n');
  rebase(f);
  outside(f, []);
  fold(f);
  remote.push('z.cjs', 'origin moved a third time\n');
  rebase(f);
  outside(f, []);
});

test('with no remote, a local base commit amended to the same patch after the fold names nothing outside', (t) => {
  const { f } = folded(t, false);
  reword(f);
  outside(f, []);
});

test('a fold of origin that another machine rewrote to the same patches since names nothing outside', (t) => {
  const { f, remote } = landed(t);
  remote.push('x.cjs', 'origin holds this\n');
  fold(f, 'origin/main');
  remote.reword();
  outside(f, []);
});

for (const [how, rewrite] of [
  ['amended to another patch', (f) => {
    write(baseTree(f), 'x.cjs', 'the local base wrote this instead\n');
    onBase(f, 'commit', '--amend', '-qam', 'the base moved, amended');
  }],
  ['dropped', (f) => onBase(f, 'reset', '-q', '--hard', 'HEAD~1')],
  ['rebased over a conflict resolved by hand', (f, remote) => {
    remote.push('x.cjs', 'origin wrote this first\n');
    assert.throws(() => rebase(f));
    write(baseTree(f), 'x.cjs', 'resolved by hand\n');
    onBase(f, 'add', 'x.cjs');
    onBase(f, '-c', 'core.editor=true', 'rebase', '--continue');
  }],
]) {
  test(`a fold of a local base commit ${how} since still names its file outside`, (t) => {
    const { f, remote } = folded(t);
    rewrite(f, remote);
    outside(f, ['x.cjs']);
  });
}

test('a merge of a branch that never was the base names its files outside, also when one of its commits has a copy on the base', (t) => {
  const f = fixture(t, { a: ['a.cjs'] });
  const dispatch = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(dispatch, ['a.cjs']);
  const [copied] = side(f, 'side', ['z1.cjs', 'copied onto the base\n'], ['z2.cjs', 'only on the side branch\n']);
  // -x names the source in the message, so the copy is another commit even within the same second.
  onBase(f, 'cherry-pick', '-x', copied);
  fold(f, 'side');
  outside(f, ['z1.cjs', 'z2.cjs']);
});

test('an octopus merge of a base rewritten since and another branch names the files of both outside', (t) => {
  const { f } = landed(t, false);
  // The branch is cut before the base moves, so neither head holds the other and git keeps both.
  side(f, 'side', ['z.cjs', 'only on the side branch\n']);
  f.moveBase('x.cjs', 'only the local base holds this\n');
  fold(f, 'main', 'side');
  assert.equal(f.git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 4, 'an octopus of three parents');
  reword(f);
  outside(f, ['x.cjs', 'z.cjs']);
});

test('a fold of a local base that merged a branch, rebased flat onto origin since, names nothing outside', (t) => {
  const { f, remote } = landed(t);
  side(f, 'feature', ['w.cjs', 'the feature wrote this\n']);
  onBase(f, 'merge', '-q', '--no-ff', '--no-edit', 'feature');
  fold(f);
  remote.push('y.cjs', 'origin moved\n');
  rebase(f);
  outside(f, []);
});

test('a fold made on another branch that the intent then merged is read as before: a branch with a commit of its own is no fold', (t) => {
  const { f } = landed(t, false);
  f.moveBase('x.cjs', 'only the local base holds this\n');
  const other = path.join(path.dirname(f.root), 'other');
  f.git('worktree', 'add', '-q', '-b', 'other', other, 'intent');
  write(other, 'o.cjs', 'the other branch wrote this\n');
  git(other, 'add', 'o.cjs');
  git(other, 'commit', '-qm', 'the other branch wrote o.cjs');
  git(other, 'merge', '-q', '--no-edit', 'main');
  // A merge, not a fast-forward: the fold stays off the intent's own line.
  f.git('merge', '-q', '--no-ff', '--no-edit', 'other');
  reword(f);
  outside(f, ['o.cjs', 'x.cjs']);
});
