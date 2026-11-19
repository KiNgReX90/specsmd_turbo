'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { BRANCH, config, detachedFolder, detachedTree, fixture, git, passed, run, write } = require('./run-lanes-fixture.cjs');
const jobs = require('./run-jobs.cjs');
const { writeFile } = require('./test-write.cjs');

// Git calls every detached checkout HEAD, so a folder named by the branch held the gate, lane and
// accept records of every detached tree of a repository at once: a lane of one tree answered
// another's wait, retired its accept and refused its start. Each detached tree keeps its own folder.

const lanesOnly = (tree) => ['gate', '--detach', '--lanes-only', '--tree', tree];
const wait = (tree) => ['gate', '--wait', '--minutes', '0.5', '--tree', tree];
const accept = (tree, fix) => ['smoke', '--accept', '--harness-fix', fix, '--tree', tree];
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The red one walk of `tree`'s smoke lane left, its log in the tree's own folder. */
function walkedRed(f, tree) {
  writeFile(f.code, '11');
  passed(run(f, ...lanesOnly(tree)));
  const red = run(f, ...wait(tree));
  assert.equal(red.code, 3, red.out + red.err);
  assert.match(red.out, new RegExp(`^INSTRUMENT RED lane smoke \\(exit 11\\) -> ${escape(detachedFolder(f, tree))}/lane-smoke-\\d{8}T\\d{6}Z\\.log$`, 'm'));
}

/** A green walk of `tree`'s smoke lane. */
function walkedGreen(f, tree) {
  writeFile(f.code, '0');
  passed(run(f, ...lanesOnly(tree)));
  const green = run(f, ...wait(tree));
  passed(green);
  assert.match(green.out, /^GREEN lane smoke \d+s$/m);
}

test('a detached tree waits on its own lane: another detached tree walking green neither answers its wait nor refuses its accept', (t) => {
  const f = fixture(t, config({ smoke: 'file' }));
  const a = detachedTree(f, 'A');
  const b = detachedTree(f, 'B');
  walkedRed(f, a);
  walkedGreen(f, b);

  const after = run(f, ...wait(a));
  assert.equal(after.code, 3, after.out + after.err);
  assert.match(after.out, /^INSTRUMENT RED lane smoke \(exit 11\)/m);
  assert.doesNotMatch(after.out, /GREEN lane smoke/);
  const accepted = run(f, ...accept(a, git(f.tree, 'rev-parse', 'main')));
  passed(accepted);
  assert.match(accepted.out, /^accepted smoke instrument red against harness fix [0-9a-f]{7} for this tree$/m);
  assert.equal(fs.existsSync(path.join(f.cache, 'specsmd-inferno', 'app', 'HEAD')), false, 'no detached tree writes a folder named HEAD');
});

test('an accepted instrument red of a detached tree holds while another detached tree walks its lane', (t) => {
  const f = fixture(t, config({ smoke: 'file' }));
  const a = detachedTree(f, 'A');
  const b = detachedTree(f, 'B');
  walkedRed(f, a);
  passed(run(f, ...accept(a, git(f.tree, 'rev-parse', 'main'))));
  walkedGreen(f, b);

  const held = run(f, ...wait(a));
  passed(held);
  assert.match(held.out, /^ACCEPTED lane smoke instrument red, harness fix [0-9a-f]{7}$/m);
  const again = run(f, ...lanesOnly(a));
  passed(again);
  assert.match(again.out, /^ACCEPTED lane smoke instrument red, harness fix [0-9a-f]{7}$/m);
  assert.doesNotMatch(again.out, /smoke lane started/);
});

test('a detached tree starts its lane while another detached tree of the repository walks one', (t) => {
  const f = fixture(t, config({ smoke: 'wait' }));
  const a = detachedTree(f, 'A');
  const b = detachedTree(f, 'B');
  passed(run(f, ...lanesOnly(a)));
  const beside = run(f, ...lanesOnly(b));
  passed(beside);
  assert.match(beside.out, /^smoke lane started pid \d+$/m);
  const lanes = [a, b].map((tree) => jobs.readJson(path.join(detachedFolder(f, tree), 'lane-smoke-job.json')));
  assert.notEqual(lanes[0].pid, lanes[1].pid);
  assert.deepEqual(lanes.map((job) => job.tree), [a, b]);

  writeFile(f.release, '');
  for (const tree of [a, b]) {
    const done = run(f, ...wait(tree));
    passed(done);
    assert.match(done.out, /^GREEN lane smoke \d+s$/m);
  }
});

test('a wait refuses a gate job of another tree in its folder and names both trees', (t) => {
  const f = fixture(t, config({ smoke: '0' }));
  const a = detachedTree(f, 'A');
  const b = detachedTree(f, 'B');
  // The folder the wait of A reads, whichever it is.
  process.env.XDG_CACHE_HOME = f.cache;
  const folder = path.dirname(jobs.jobPaths(a).job);
  const hand = (tree) => {
    const job = { pid: 1, lanes: [], lanes_only: true, started: new Date().toISOString(), tree, branch: 'HEAD', config: '.specs-inferno/config.yaml',
      job: path.join(folder, 'gate-job.json'), result: path.join(folder, 'gate-job.result.json'), log: path.join(folder, 'gate-job.log') };
    write(folder, 'gate-job.json', `${JSON.stringify(job)}\n`);
    write(folder, 'gate-job.result.json', `${JSON.stringify({ ok: true, lanes_only: true, results: [], hash: 'h' })}\n`);
  };
  for (const other of [b, path.join(path.dirname(a), 'gone')]) {
    hand(other);
    const refused = run(f, ...wait(a));
    assert.equal(refused.code, 2, refused.out + refused.err);
    assert.match(refused.err, new RegExp(`^ERROR \\[GATE_OTHER_TREE\\] the gate job in this tree's folder was started for ${escape(other)}, not for ${escape(a)}: ` +
      `start this tree's own gate with run\\.cjs gate --detach --tree ${escape(a)}$`, 'm'));
  }
  // The same tree by another path is the tree: its real path decides.
  const link = path.join(path.dirname(a), 'link-to-A');
  fs.symlinkSync(a, link);
  hand(link);
  passed(run(f, ...wait(a)));
});

test('a tree that leaves its branch for a detached HEAD finds no gate job of the branch, and finds it again on the branch', (t) => {
  const f = fixture(t, config({ smoke: '0' }));
  write(f.tree, 'src/input.txt', 'two\n');
  git(f.tree, 'commit', '-qam', 'work');
  passed(run(f, 'gate', '--detach', '--lanes-only', '--tree', f.tree));
  passed(run(f, ...wait(f.tree)));

  git(f.tree, 'checkout', '-q', '--detach');
  const none = run(f, ...wait(f.tree));
  assert.equal(none.code, 2, none.out + none.err);
  assert.match(none.err, new RegExp(`^ERROR \\[NO_GATE_JOB\\] no gate has been started for this tree; start one with run\\.cjs gate --detach --tree ${escape(f.tree)}$`, 'm'));

  git(f.tree, 'checkout', '-q', BRANCH);
  const back = run(f, ...wait(f.tree));
  passed(back);
  assert.match(back.out, /^GREEN lane smoke \d+s$/m);
});
