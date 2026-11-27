const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { cacheOf, commit, config, fixture, laneRuns, passed, run, touch, whole, write } = require('./run-lanes-fixture.cjs');
const jobs = require('./run-jobs.cjs');
const { writeFile } = require('./test-write.cjs');

// `gate --detach --lane <name>` walks one lane again on its own, through the detach call every
// lane start shares, while the gate job may still run its finalize commands.

const HOLD = 'node proof.cjs hold';
const laneJob = (f, lane) => jobs.readJson(path.join(cacheOf(f), `lane-${lane}-job.json`));
const gateJob = (f) => jobs.readJson(path.join(cacheOf(f), 'gate-job.json'));

/** Wait in short slices until the wait turns red. */
function untilRed(f) {
  let result;
  for (let i = 0; i < 40 && !(result && result.code === 2); i += 1) result = run(f, 'gate', '--wait', '--minutes', '0.05');
  return result;
}

test('gate --detach --lane starts only that lane while the gate job is still in its finalize commands', (t) => {
  const f = fixture(t, config({ smoke: 'file', windows: 'wait' }, [HOLD]));
  writeFile(f.code, '10');
  touch(f);
  passed(run(f, 'gate', '--detach'));
  const red = untilRed(f);
  assert.equal(red.code, 2, red.out + red.err);
  assert.match(red.out, /RED lane smoke: product red \(exit 10\)/);
  assert.match(red.out, /gate still running pid \d+/);
  const plain = run(f, 'gate', '--detach');
  assert.equal(plain.code, 2, plain.out + plain.err);
  assert.match(plain.err, /GATE_RUNNING/);

  writeFile(f.code, '0');
  const one = run(f, 'gate', '--detach', '--lane', 'smoke');
  passed(one);
  assert.match(one.out, /^smoke lane started pid \d+$/m);
  assert.match(one.out, /^wait with: node \S+run\.cjs gate --wait --tree \S+$/m);
  assert.doesNotMatch(one.out, /windows|gate started/);
  assert.ok(jobs.alive(gateJob(f)), 'the gate job still runs its finalize commands');
  assert.deepEqual(gateJob(f).lanes, ['smoke', 'windows']);
  assert.equal(laneJob(f, 'smoke').head, require('./run-lib.cjs').git(f.tree, ['rev-parse', 'HEAD']));
  // A lane that still walks is the one refusal.
  const busy = run(f, 'gate', '--detach', '--lane', 'windows');
  assert.equal(busy.code, 2, busy.out + busy.err);
  assert.match(busy.err, /LANE_RUNNING.*the windows lane is already running for this tree \(pid \d+, started \S+\); wait for it: node \S+run\.cjs gate --wait/);

  writeFile(f.release, '');
  const done = run(f, 'gate', '--wait', '--minutes', '0.5');
  passed(done);
  assert.match(done.out, /GREEN lane smoke/);
  assert.match(done.out, /GREEN lane windows/);
  assert.deepEqual(laneRuns(f).sort(), ['smoke', 'smoke', 'windows']);
});

test('a lane the gate did not start joins its wait', (t) => {
  const f = fixture(t);
  touch(f, 'docs/readme.txt');
  const gate = run(f, 'gate', '--detach');
  passed(gate);
  assert.match(gate.out, /SKIP smoke/);
  passed(run(f, 'gate', '--detach', '--lane', 'smoke'));
  assert.deepEqual(gateJob(f).lanes, ['smoke']);
  const done = run(f, 'gate', '--wait', '--minutes', '0.5');
  passed(done);
  assert.match(done.out, /GREEN lane smoke/);
  assert.deepEqual(laneRuns(f), ['smoke']);
});

test('with no gate job the lane starts on its own and gate --wait waits on it alone', (t) => {
  const f = fixture(t, config({ smoke: '10' }));
  touch(f);
  passed(run(f, 'gate', '--detach', '--lane', 'smoke'));
  assert.equal(gateJob(f).lanes_only, true);
  const red = run(f, 'gate', '--wait', '--minutes', '0.5');
  assert.equal(red.code, 2, red.out + red.err);
  assert.match(red.out, /RED lane smoke: product red \(exit 10\)/);
  // No finalize command ran.
  assert.equal(fs.existsSync(path.join(f.tree, '.runs')), false);
});

test('gate --detach --lane refuses a dirty tree, an unconfigured lane, a pending supersede of it, another config, and --lanes-only or --supersede', (t) => {
  const f = fixture(t);
  touch(f);
  write(f.tree, 'src/input.txt', 'dirty\n');
  const dirty = run(f, 'gate', '--detach', '--lane', 'smoke');
  assert.equal(dirty.code, 2, dirty.out + dirty.err);
  assert.match(dirty.err, /DIRTY/);
  commit(f.tree);

  const none = run(f, 'gate', '--detach', '--lane', 'windows');
  assert.equal(none.code, 2, none.out + none.err);
  assert.match(none.err, /NO_LANE/);
  for (const flag of ['--lanes-only', '--supersede']) {
    const mixed = run(f, 'gate', '--detach', '--lane', 'smoke', flag);
    assert.equal(mixed.code, 1, mixed.out + mixed.err);
    assert.match(mixed.err, /gate takes --lane with --detach alone/);
  }

  const pending = path.join(cacheOf(f), 'supersede-pending.json');
  fs.mkdirSync(path.dirname(pending), { recursive: true });
  writeFile(pending, `${JSON.stringify({ lanes: [{ lane: 'smoke', pid: 1, log: 'lane.log' }], groups: [], started: new Date().toISOString() })}\n`);
  const superseded = run(f, 'gate', '--detach', '--lane', 'smoke');
  assert.equal(superseded.code, 2, superseded.out + superseded.err);
  assert.match(superseded.err, /SUPERSEDE_PENDING.*the smoke lane's superseded walk is not proven stopped/);
  fs.rmSync(pending);

  write(f.tree, '.specs-inferno/config.codex.yaml', `delivery:\n  base_branch: main\nverification:\n  finalize:\n    - ${whole}\n`);
  commit(f.tree, 'host config');
  passed(run(f, 'gate', '--detach'));
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  const other = run(f, 'gate', '--detach', '--lane', 'smoke', '--config', '.specs-inferno/config.codex.yaml');
  assert.equal(other.code, 2, other.out + other.err);
  assert.match(other.err, /GATE_CONFIG.*the started gate uses config \.specs-inferno\/config\.yaml/);
  assert.deepEqual(laneRuns(f), ['smoke']);
});
