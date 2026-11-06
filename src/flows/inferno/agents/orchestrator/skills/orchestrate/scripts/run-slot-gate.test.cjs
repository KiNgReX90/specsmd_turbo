const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { commit, config, fixture, git, passed, run, touch, write } = require('./run-lanes-fixture.cjs');
const { reviewBefore } = require('./review-fixture.cjs');
const { writeFile } = require('./test-write.cjs');
const slot = require('./run-slot.cjs');

const ONE = 'inferno-intent/one-00000000T000000Z';
const TWO = 'inferno-intent/two-00000000T000000Z';

/** The lanes fixture with the merge slot on, or off when `on` is false. */
const slotConfig = (lanes, on = true) => `${config(lanes)}${on ? '  merge_slot: true\n' : ''}`;

/**
 * Two intent worktrees of one fixture repository, each off main with an in-scope change, and the
 * primary checkout back on main with a ledger, so a base commit lands where both trees fold from.
 */
function twoTrees(t, source) {
  const f = fixture(t, source);
  // The slot reads job files from the cache the runs write, as a run would.
  process.env.XDG_CACHE_HOME = f.cache;
  const dir = path.dirname(f.tree);
  git(f.tree, 'checkout', '-q', 'main');
  write(f.tree, '.specs-inferno/state.yaml', 'project:\n  name: demo\nintents:\n');
  commit(f.tree, 'ledger');
  const trees = [[ONE, 'one'], [TWO, 'two']].map(([branch, name]) => {
    const tree = path.join(dir, name);
    git(f.tree, 'worktree', 'add', '-q', '-b', branch, tree, 'main');
    const at = { ...f, tree };
    touch(at);
    return at;
  });
  return { f, primary: f, one: trees[0], two: trees[1] };
}

/** A commit on main that the gate folds in and the intent review does not read. */
function baseMoves(primary) {
  write(primary.tree, '.specs-inferno/base-note.txt', `${Date.now()}-${Math.random()}\n`);
  commit(primary.tree, 'base moves');
}

const holders = (tree) => slot.queue(tree).tickets.map((ticket) => ticket.holder);
const head = (tree) => git(tree, 'rev-parse', 'HEAD');
const gateJob = (at, branch) => path.join(at.cache, 'specsmd-inferno', 'app', branch, 'gate-job.json');

function waited(at, minutes = '0.5') {
  return run(at, 'gate', '--wait', '--minutes', minutes);
}

test('a second gate --detach queues behind the first and folds nothing', (t) => {
  const { primary, one, two } = twoTrees(t, slotConfig({ smoke: '0' }));
  passed(run(one, 'gate', '--detach'));
  baseMoves(primary);
  reviewBefore(['gate'], two.tree);
  const before = head(two.tree);
  const queued = run(two, 'gate', '--detach');
  assert.equal(queued.code, 4, queued.out + queued.err);
  assert.match(queued.out, new RegExp(`queued behind ${ONE} \\(1 ahead\\); nothing folded`));
  assert.match(queued.out, /wait with: node \S+run\.cjs gate --wait --tree \S+/);
  assert.equal(head(two.tree), before);
  assert.equal(fs.existsSync(gateJob(two, TWO)), false);
  assert.deepEqual(holders(primary.tree), [ONE, TWO]);
});

test("the queued tree's wait folds and starts once the head's wait is red", (t) => {
  const { primary, one, two } = twoTrees(t, slotConfig({ smoke: 'file' }));
  writeFile(primary.code, '10');
  passed(run(one, 'gate', '--detach'));
  baseMoves(primary);
  assert.equal(run(two, 'gate', '--detach').code, 4);
  const red = waited(one);
  assert.equal(red.code, 2, red.out + red.err);
  writeFile(primary.code, '0');
  const started = waited(two);
  assert.equal(started.code, 0, started.out + started.err);
  assert.match(started.out, new RegExp(`folded main into ${TWO}`));
  assert.match(started.out, /gate started pid \d+/);
  assert.match(started.out, /GREEN lane smoke/);
  assert.deepEqual(holders(primary.tree), [TWO]);
});

test('teardown and a red wait free the slot, an exit 3 keeps it', (t) => {
  const { primary, one, two } = twoTrees(t, slotConfig({ smoke: 'file' }));
  writeFile(primary.code, '11');
  passed(run(one, 'gate', '--detach'));
  const unbounded = waited(one);
  assert.equal(unbounded.code, 3, unbounded.out + unbounded.err);
  assert.deepEqual(holders(primary.tree), [ONE]);

  assert.equal(run(two, 'gate', '--detach').code, 4);
  writeFile(primary.code, '10');
  passed(run(one, 'gate', '--detach'));
  assert.equal(waited(one).code, 2);
  assert.deepEqual(holders(primary.tree), [TWO]);

  git(primary.tree, 'merge', '-q', '--no-edit', TWO);
  const removed = run(primary, 'teardown', '--tree', two.tree);
  assert.equal(removed.code, 0, removed.out + removed.err);
  assert.deepEqual(holders(primary.tree), []);
});

test('an intent review call renews the ticket', (t) => {
  const { primary, one } = twoTrees(t, slotConfig({ smoke: '0' }));
  passed(run(one, 'gate', '--detach'));
  const [taken] = slot.queue(primary.tree).tickets;
  run(one, 'review', '--tree', one.tree);
  const [renewed] = slot.queue(primary.tree).tickets;
  assert.equal(renewed.holder, ONE);
  assert.ok(Date.parse(renewed.activity) > Date.parse(taken.activity), `${taken.activity} -> ${renewed.activity}`);
});

test('without merge_slot both trees start at once', (t) => {
  const { primary, one, two } = twoTrees(t, slotConfig({ smoke: '0' }, false));
  passed(run(one, 'gate', '--detach'));
  baseMoves(primary);
  const second = run(two, 'gate', '--detach');
  passed(second);
  assert.match(second.out, new RegExp(`folded main into ${TWO}`));
  assert.equal(fs.existsSync(slot.slotPath(primary.tree)), false);
});
