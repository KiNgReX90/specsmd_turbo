const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { acceptLine, cacheOf, config, fixture, gated, passed, run, touch, whole } = require('./run-lanes-fixture.cjs');
const jobs = require('./run-jobs.cjs');
const { writeFile } = require('./test-write.cjs');

const lines = (result) => result.out.trim().split('\n');

/** Wait in short slices until the gate itself is done and only lanes may still run. */
function gateDone(f) {
  for (let i = 0; i < 20; i += 1) {
    const result = run(f, 'gate', '--wait', '--minutes', '0.05');
    if (!/gate still running/.test(result.out)) return result;
  }
  throw new Error('the gate never finished');
}

test('a red lane exits 2 at once, while another lane still runs', (t) => {
  const f = fixture(t, config({ smoke: '10', windows: 'wait' }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  let result;
  for (let i = 0; i < 20 && !(result && result.code === 2); i += 1) result = run(f, 'gate', '--wait', '--minutes', '0.05');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /RED lane smoke: product red/);
  assert.match(result.out, /windows lane still running pid \d+/);
});

test('a running lane exits 4 before an unbounded instrument red exits 3', (t) => {
  const f = fixture(t, config({ smoke: '11', windows: 'wait' }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  const running = gateDone(f);
  assert.equal(running.code, 4, running.out + running.err);
  assert.match(running.out, /INSTRUMENT RED lane smoke/);
  writeFile(f.release, '');
  const done = run(f, 'gate', '--wait', '--minutes', '0.5');
  assert.equal(done.code, 3, done.out + done.err);
});

test('a lane process that died without a result is red', (t) => {
  const f = fixture(t, config({ windows: 'wait' }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  const job = JSON.parse(fs.readFileSync(path.join(cacheOf(f), 'lane-windows-job.json'), 'utf8'));
  process.kill(job.pid, 'SIGKILL');
  writeFile(f.release, '');
  const result = run(f, 'gate', '--wait', '--minutes', '0.5');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, new RegExp(`lane windows process ${job.pid} ended without a result`));
});

test('a lane whose scope changed while it ran is red and mints no proof', (t) => {
  const f = fixture(t, config({ smoke: 'movewait' }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  assert.equal(gateDone(f).code, 4);
  writeFile(f.release, '');
  const result = run(f, 'gate', '--wait', '--minutes', '0.5');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /RED lane smoke: the code changed while the lane ran/);
  fs.rmSync(path.join(f.tree, 'src/moved.txt'));
  const verdict = run(f, 'green', '--json');
  assert.equal(verdict.code, 3, verdict.out + verdict.err);
  assert.deepEqual(JSON.parse(verdict.out).owed, ['smoke']);
});

test('the accept line is last even when the unbounded lane comes first', (t) => {
  const f = fixture(t, config({ smoke: '11', windows: '0' }));
  touch(f);
  const result = gated(f);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(lines(result).pop(), acceptLine('smoke'));
});

test('a gate block past the output cap never cuts the accept line', (t) => {
  const many = Array.from({ length: 30 }, (_, index) => `${whole}-${index}`);
  const f = fixture(t, config({ smoke: '11' }, many));
  touch(f);
  const result = gated(f);
  assert.equal(result.code, 3, result.out + result.err);
  assert.ok(lines(result).length <= 30, result.out);
  assert.match(lines(result).pop(), acceptLine('smoke'));
});

test('gate --detach refuses while a lane of the earlier gate still runs', (t) => {
  const f = fixture(t, config({ windows: 'wait' }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  assert.equal(gateDone(f).code, 4);
  const again = run(f, 'gate', '--detach');
  assert.equal(again.code, 2, again.out + again.err);
  assert.match(again.err, /a windows lane is already running for this tree \(pid \d+, .*\); wait for it: node \S+run\.cjs gate --wait/);
});

const RED_LINE = { smoke: { red_line: '"^PRODUCT RED "' } };
const laneJob = (f) => JSON.parse(fs.readFileSync(path.join(cacheOf(f), 'lane-smoke-job.json'), 'utf8'));

test("a running lane's red line ends the wait with exit 2 while the lane walks on", (t) => {
  const f = fixture(t, config({ smoke: 'redwait' }, undefined, undefined, RED_LINE));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  const result = run(f, 'gate', '--wait', '--minutes', '0.1');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /RED lane smoke while it walks: PRODUCT RED demo: red on the branch -> \S+\.log/);
  assert.ok(jobs.alive(laneJob(f)), 'the lane walks on after the wait ends');
});

test('without red_line the same lane keeps the wait at 4', (t) => {
  const f = fixture(t, config({ smoke: 'redwait' }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  const result = run(f, 'gate', '--wait', '--minutes', '0.1');
  assert.equal(result.code, 4, result.out + result.err);
  assert.match(result.out, /smoke lane still running pid \d+/);
});

test('a line the pattern does not match keeps the wait at 4', (t) => {
  const f = fixture(t, config({ smoke: 'redwait' }, undefined, undefined, { smoke: { red_line: '"^NOT RED FIRST "' } }));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  const result = run(f, 'gate', '--wait', '--minutes', '0.1');
  assert.equal(result.code, 4, result.out + result.err);
  assert.match(result.out, /smoke lane still running pid \d+/);
});

test('a red line from an earlier run of the lane is not read', (t) => {
  const f = fixture(t, config({ smoke: 'wait' }, undefined, undefined, RED_LINE));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  const runFile = path.join(cacheOf(f), 'lane-smoke-job.run.json');
  for (let i = 0; i < 200 && !fs.existsSync(runFile); i += 1) jobs.sleepSync(50);
  assert.ok(fs.existsSync(runFile), 'the running lane names its log');
  const earlier = path.join(cacheOf(f), 'lane-smoke-earlier.log');
  writeFile(earlier, 'PRODUCT RED demo: red on an earlier run\n');
  const started = new Date(Date.parse(laneJob(f).started) - 60000).toISOString();
  writeFile(runFile, `${JSON.stringify({ run: 'earlier', log: earlier, started })}\n`);
  const result = run(f, 'gate', '--wait', '--minutes', '0.1');
  assert.equal(result.code, 4, result.out + result.err);
  assert.doesNotMatch(result.out, /while it walks/);
});

test('a commit after the red line turns the walking lane back to running, so the wait blocks on it', (t) => {
  const f = fixture(t, config({ smoke: 'redwait' }, undefined, undefined, RED_LINE));
  touch(f);
  passed(run(f, 'gate', '--detach'));
  const red = run(f, 'gate', '--wait', '--minutes', '0.1');
  assert.equal(red.code, 2, red.out + red.err);
  // The commit lands only once the gate has ended green, so the walking lane is all that is left.
  const gate = JSON.parse(fs.readFileSync(path.join(cacheOf(f), 'gate-job.json'), 'utf8'));
  for (let i = 0; i < 400 && jobs.alive(gate); i += 1) jobs.sleepSync(50);
  assert.ok(!jobs.alive(gate), 'the gate never ended');
  const result = jobs.readJson(gate.result);
  assert.ok(result && result.ok === true, `the gate is not green: ${JSON.stringify(result)}`);
  touch(f);
  const after = run(f, 'gate', '--wait', '--minutes', '0.05');
  assert.equal(after.code, 4, after.out + after.err);
  assert.doesNotMatch(after.out, /while it walks/);
  assert.match(after.out, /smoke lane still running pid \d+/);
  assert.ok(jobs.alive(laneJob(f)), 'the lane still walks');
});
