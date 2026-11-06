const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { cacheOf, commit, config, fixture, git, passed, run, touch, whole, write } = require('./run-lanes-fixture.cjs');
const jobs = require('./run-jobs.cjs');
const { writeFile } = require('./test-write.cjs');

const LINUX = process.platform === 'linux' && fs.existsSync('/proc/self/stat');

/** The stop stub: writes its INFERNO_* environment to the stop-env file outside the tree, prints a verdict, exits with its argument. */
const STOP = `const { writeFile } = require(${JSON.stringify(path.join(__dirname, 'test-write.cjs'))});
const code = Number(process.argv[2]);
const seen = Object.keys(process.env).filter((key) => key.startsWith('INFERNO_')).sort();
writeFile('../stop-env', seen.map((key) => key + '=' + process.env[key] + '\\n').join(''));
console.log(code === 0 ? 'the walk is gone' : 'the walk still holds the machine lock');
process.exit(code);
`;

const withStop = (code) => config({ smoke: 'wait' }, [whole], ['src/**'], { smoke: { stop: `node stop.cjs ${code}` } });

/** A tree whose smoke lane walks (holds) after a gate on a change to src/. */
function walking(t, source = withStop(0)) {
  const f = fixture(t, source);
  write(f.tree, 'stop.cjs', STOP);
  touch(f);
  passed(run(f, 'gate', '--detach'));
  const lane = laneJob(f);
  assert.ok(jobs.alive(lane), 'the smoke lane walks');
  return { f, lane };
}

const laneJob = (f) => JSON.parse(fs.readFileSync(path.join(cacheOf(f), 'lane-smoke-job.json'), 'utf8'));
const stopEnv = (f) => fs.readFileSync(path.join(path.dirname(f.tree), 'stop-env'), 'utf8');
const pending = (f) => path.join(cacheOf(f), 'supersede-pending.json');

test('supersede stops a walking lane whose scope the fix touched and starts the gate on the fix', { skip: !LINUX }, (t) => {
  const { f, lane } = walking(t);
  assert.equal(lane.head, git(f.tree, 'rev-parse', 'HEAD'), 'the lane job records the head it walks');
  touch(f);
  const result = run(f, 'gate', '--detach', '--supersede');
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, new RegExp(`superseded smoke lane pid ${lane.pid}: stopped, proven by its stop check`));
  assert.match(result.out, /gate started pid \d+/);
  assert.equal(jobs.alive(lane), false, 'the old lane is dead');
  const env = stopEnv(f);
  assert.match(env, /^INFERNO_LANE=smoke$/m);
  assert.match(env, new RegExp(`^INFERNO_LANE_PID=${lane.pid}$`, 'm'));
  assert.match(env, /^INFERNO_LANE_LOG=\S+\.log$/m);
  assert.match(env, /^INFERNO_GATE_CONFIG=\.specs-inferno\/config\.yaml$/m);
  const next = laneJob(f);
  assert.notEqual(next.pid, lane.pid, 'a new lane walks the fix');
  assert.equal(next.head, git(f.tree, 'rev-parse', 'HEAD'));
  assert.equal(fs.existsSync(pending(f)), false);
});

test("a fix outside every running lane's scope is refused and the lane walks on", { skip: !LINUX }, (t) => {
  const { f, lane } = walking(t);
  touch(f, 'docs/readme.txt');
  const result = run(f, 'gate', '--detach', '--supersede');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /the fix changes nothing a running lane proves; wait for it: node \S+run\.cjs gate --wait/);
  assert.ok(jobs.alive(lane), 'the lane walks on');
});

test('a running lane with no stop is refused before any signal', { skip: !LINUX }, (t) => {
  const { f, lane } = walking(t, config({ smoke: 'wait' }));
  touch(f);
  const result = run(f, 'gate', '--detach', '--supersede');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /cannot prove the smoke lane stopped: set verification\.smoke\.stop/);
  assert.ok(jobs.alive(lane), 'the lane walks on');
});

test('a failing stop keeps the supersede pending and a plain detach refuses', { skip: !LINUX }, (t) => {
  const { f, lane } = walking(t, withStop(1));
  touch(f);
  const failed = run(f, 'gate', '--detach', '--supersede');
  assert.equal(failed.code, 2, failed.out + failed.err);
  assert.match(failed.err, /the smoke lane's stop exited 1: the walk still holds the machine lock/);
  assert.match(failed.err, /log \S+\.log/);
  assert.ok(fs.existsSync(pending(f)), 'the supersede stays pending');
  const plain = run(f, 'gate', '--detach');
  assert.equal(plain.code, 2, plain.out + plain.err);
  assert.match(plain.err, /a superseded lane is not proven stopped: run \S*run\.cjs gate --detach --supersede --tree \S+/);
  write(f.tree, '.specs-inferno/config.yaml', fs.readFileSync(path.join(f.tree, '.specs-inferno/config.yaml'), 'utf8').replace('stop.cjs 1', 'stop.cjs 0'));
  commit(f.tree, 'the stop check passes');
  const again = run(f, 'gate', '--detach', '--supersede');
  assert.equal(again.code, 0, again.out + again.err);
  assert.match(again.out, new RegExp(`superseded smoke lane pid ${lane.pid}: stopped, proven by its stop check`));
  assert.match(again.out, /gate started pid \d+/);
  assert.equal(fs.existsSync(pending(f)), false);
});

test('a running job without head is refused', { skip: !LINUX }, async (t) => {
  const f = fixture(t, withStop(0));
  write(f.tree, 'stop.cjs', STOP);
  touch(f);
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)', 'run.cjs'], { stdio: 'ignore' });
  t.after(() => child.kill('SIGKILL'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  fs.mkdirSync(cacheOf(f), { recursive: true });
  writeFile(path.join(cacheOf(f), 'lane-smoke-job.json'), JSON.stringify({ pid: child.pid, lane: 'smoke', started: new Date().toISOString() }));
  const result = run(f, 'gate', '--detach', '--supersede');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /the running gate predates supersede; wait for it: node \S+run\.cjs gate --wait/);
  assert.ok(jobs.alive({ pid: child.pid }), 'nothing was signalled');
});

test('--supersede without --detach is a usage error, and with no lane running there is nothing to supersede', (t) => {
  const f = fixture(t, withStop(0));
  write(f.tree, 'stop.cjs', STOP);
  touch(f);
  const usage = run(f, 'gate', '--supersede');
  assert.equal(usage.code, 1, usage.out + usage.err);
  assert.match(usage.err, /gate takes --supersede only with --detach/);
  const idle = run(f, 'gate', '--detach', '--supersede');
  assert.equal(idle.code, 2, idle.out + idle.err);
  assert.match(idle.err, /nothing to supersede: no lane of this tree is running/);
});
