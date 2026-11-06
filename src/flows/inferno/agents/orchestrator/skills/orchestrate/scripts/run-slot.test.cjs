const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');

const LINUX = process.platform === 'linux' && fs.existsSync('/proc/self/stat');
const MINUTE = 60 * 1000;
const T0 = Date.parse('2026-01-01T00:00:00.000Z');

// Every cache path this suite touches (job files, review dispatches) lands in a cache of its own.
process.env.XDG_CACHE_HOME = path.join(tempDir('inferno-slot-cache-'), 'cache');

const slot = require('./run-slot.cjs');

/** Write a cache file whose branch dir may not exist yet. */
function put(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFile(file, body);
}

function repo(t) {
  const dir = tempDir('inferno-slot-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'app');
  fs.mkdirSync(root);
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root });
  return { dir, root };
}

test('tickets queue first come, first served, and a second take keeps its place', (t) => {
  const { root } = repo(t);
  assert.deepEqual(slot.take(root, { holder: 'A' }), { head: true, ahead: [], out: [] });
  const second = slot.take(root, { holder: 'B' });
  assert.equal(second.head, false);
  assert.deepEqual(second.ahead, ['A']);
  const again = slot.take(root, { holder: 'A' });
  assert.equal(again.head, true);
  assert.deepEqual(slot.queue(root).tickets.map((ticket) => ticket.holder), ['A', 'B']);
  assert.deepEqual(slot.queue(root).heads, ['A']);
  slot.release(root, 'A');
  const after = slot.queue(root);
  assert.deepEqual(after.heads, ['B']);
  assert.deepEqual(after.tickets.map((ticket) => ticket.holder), ['B']);
  assert.equal(after.tickets[0].tree, root);
});

test('a holder defaults to the branch of the tree it takes from', (t) => {
  const { root } = repo(t);
  slot.take(root, { intent: 'x' });
  assert.deepEqual(slot.queue(root).tickets.map((ticket) => [ticket.holder, ticket.intent]), [['main', 'x']]);
});

test('a ticket with no activity for 30 minutes is evicted with a line', (t) => {
  const { root } = repo(t);
  slot.take(root, { holder: 'A' }, T0);
  assert.equal(slot.queue(root, T0 + 30 * MINUTE).tickets.length, 1);
  slot.renew(root, 'A', T0 + 10 * MINUTE);
  slot.renew(root, 'nobody', T0 + 10 * MINUTE);
  assert.equal(slot.queue(root, T0 + 39 * MINUTE).tickets.length, 1);
  const late = slot.queue(root, T0 + 41 * MINUTE);
  assert.deepEqual(late.tickets, []);
  assert.deepEqual(late.out, [`evicted A: no gate, wait or review since ${new Date(T0 + 10 * MINUTE).toISOString()}`]);
  assert.deepEqual(slot.queue(root, T0 + 42 * MINUTE).out, []);
});

test('an open review dispatch holds a ticket up to 120 minutes', (t) => {
  const { root } = repo(t);
  slot.take(root, { holder: 'A' }, T0);
  const dispatch = slot.reviewDispatchPath(root);
  assert.equal(dispatch, path.join(process.env.XDG_CACHE_HOME, 'specsmd-inferno', 'app', 'main', 'intent-review-dispatch.json'));
  put(dispatch, `${JSON.stringify({ intent: 'x' })}\n`);
  const stamp = new Date(T0 + 1000);
  fs.utimesSync(dispatch, stamp, stamp);
  const held = slot.queue(root, T0 + 31 * MINUTE);
  assert.deepEqual(held.tickets.map((ticket) => ticket.holder), ['A']);
  assert.deepEqual(held.out, []);
  const capped = slot.queue(root, T0 + 121 * MINUTE);
  assert.deepEqual(capped.tickets, []);
  assert.deepEqual(capped.out, ['evicted A: its intent review has no verdict after the cap']);
});

test('a review dispatch older than the activity holds nothing', (t) => {
  const { root } = repo(t);
  const dispatch = slot.reviewDispatchPath(root);
  put(dispatch, `${JSON.stringify({ intent: 'x' })}\n`);
  const stamp = new Date(T0 - 1000);
  fs.utimesSync(dispatch, stamp, stamp);
  slot.take(root, { holder: 'A' }, T0);
  assert.deepEqual(slot.queue(root, T0 + 31 * MINUTE).out, [`evicted A: no gate, wait or review since ${new Date(T0).toISOString()}`]);
});

test('a live job in a worktree with no ticket is the head', { skip: !LINUX }, async (t) => {
  const { dir, root } = repo(t);
  const branch = 'inferno-intent/x-20260910T000000Z';
  const other = path.join(dir, 'other');
  execFileSync('git', ['worktree', 'add', '-q', '-b', branch, other], { cwd: root });
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)', 'run.cjs'], { stdio: 'ignore' });
  t.after(() => child.kill('SIGKILL'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const jobFile = path.join(process.env.XDG_CACHE_HOME, 'specsmd-inferno', 'app', branch, 'gate-job.json');
  put(jobFile, JSON.stringify({ pid: child.pid, started: new Date().toISOString() }));
  const shim = `running without a ticket: ${branch}`;
  const taken = slot.take(root, { holder: 'A' });
  assert.equal(taken.head, false);
  assert.deepEqual(taken.ahead, [shim]);
  assert.deepEqual(slot.queue(root).heads, [shim]);
  slot.take(other, {});
  assert.deepEqual(slot.take(root, { holder: 'A' }).ahead, []);
  assert.deepEqual(slot.take(other, {}).ahead, ['A']);
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
  slot.release(other, branch);
  assert.deepEqual(slot.queue(root).heads, ['A']);
});

test('two processes taking at once both land in the queue', async (t) => {
  const { root } = repo(t);
  const at = Date.now() + 500;
  const code = 'const slot = require(process.argv[1]); const at = Number(process.argv[4]);' +
    ' while (Date.now() < at) {} slot.take(process.argv[2], { holder: process.argv[3] });';
  const children = ['X', 'Y'].map((holder) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code, path.join(__dirname, 'run-slot.cjs'), root, holder, String(at)], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', resolve);
  }));
  assert.deepEqual(await Promise.all(children), [0, 0]);
  const stored = JSON.parse(fs.readFileSync(slot.slotPath(root), 'utf8'));
  assert.deepEqual(stored.tickets.map((ticket) => ticket.holder).sort(), ['X', 'Y']);
});
