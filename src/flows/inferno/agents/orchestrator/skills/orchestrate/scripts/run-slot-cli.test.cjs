const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { config, fixture, git, passed, run, touch } = require('./run-lanes-fixture.cjs');
const slot = require('./run-slot.cjs');

/** The lanes fixture with the merge slot on, or off when `on` is false. */
const slotConfig = (lanes, on = true) => `${config(lanes)}${on ? '  merge_slot: true\n' : ''}`;

/** The fixture back on main, as a driver integrating straight onto the base works. */
function onMain(t, source) {
  const f = fixture(t, source);
  process.env.XDG_CACHE_HOME = f.cache;
  git(f.tree, 'checkout', '-q', 'main');
  return f;
}

const holders = (tree) => slot.queue(tree).tickets.map((ticket) => ticket.holder);
const mainCache = (f) => path.join(f.cache, 'specsmd-inferno', 'app', 'main');
const smokeJob = (f) => path.join(mainCache(f), 'lane-smoke-job.json');

/** A bare origin that holds main as it stands, so the next local commit is unpushed. */
function pushedOrigin(f) {
  const remote = path.join(path.dirname(f.tree), 'origin.git');
  git(path.dirname(f.tree), 'init', '-q', '--bare', remote);
  git(f.tree, 'remote', 'add', 'origin', remote);
  git(f.tree, 'push', '-q', 'origin', 'main');
}

test('slot --take exits 4 behind another holder and 0 at the head', (t) => {
  const f = onMain(t, slotConfig({ smoke: '0' }));
  passed(run(f, 'slot', '--take', '--holder', 'first'));
  const queued = run(f, 'slot', '--take', '--holder', 'second');
  assert.equal(queued.code, 4, queued.out + queued.err);
  assert.match(queued.out, /^queued behind first \(1 ahead\)$/m);
  assert.match(queued.out, /node \S+run\.cjs slot --take --holder second --tree \S+/);
  assert.deepEqual(holders(f.tree), ['first', 'second']);
  const listed = run(f, 'slot');
  passed(listed);
  assert.deepEqual(listed.out.trim().split('\n'), ['first', 'second']);
  passed(run(f, 'slot', '--renew', '--holder', 'first'));
  passed(run(f, 'slot', '--take', '--holder', 'first'));
});

test('slot --release frees the head for the next holder', (t) => {
  const f = onMain(t, slotConfig({ smoke: '0' }));
  passed(run(f, 'slot', '--take', '--holder', 'first'));
  assert.equal(run(f, 'slot', '--take', '--holder', 'second').code, 4);
  passed(run(f, 'slot', '--release', '--holder', 'first'));
  assert.deepEqual(holders(f.tree), ['second']);
  passed(run(f, 'slot', '--take', '--holder', 'second'));
});

test('slot without merge_slot says there is no queue and exits 0', (t) => {
  const f = onMain(t, slotConfig({ smoke: '0' }, false));
  for (const args of [['--take', '--holder', 'first'], ['--renew', '--holder', 'first'], ['--release', '--holder', 'first'], []]) {
    const result = run(f, 'slot', ...args);
    passed(result);
    assert.equal(result.out.trim(), 'no verification.merge_slot in .specs-inferno/config.yaml: there is no queue');
  }
  assert.equal(fs.existsSync(slot.slotPath(f.tree)), false);
});

test('slot refuses a form without its holder or with two verbs', (t) => {
  const f = onMain(t, slotConfig({ smoke: '0' }));
  assert.equal(run(f, 'slot', '--take').code, 1);
  assert.equal(run(f, 'slot', '--take', '--release', '--holder', 'first').code, 1);
});

test('the usage carries the three driver lines', (t) => {
  const f = onMain(t, slotConfig({ smoke: '0' }));
  const help = run(f, '--help');
  passed(help);
  for (const line of [
    'node run.cjs slot --take --holder <name> [--tree <dir>]',
    'node run.cjs slot --release --holder <name> [--tree <dir>]',
    'node run.cjs gate --detach --lanes-only [--since <ref>] [--tree <dir>]',
  ]) {
    assert.ok(help.out.includes(line), `no "${line}" in the usage`);
  }
});

test('gate --detach --lanes-only on the base branch starts the lanes the diff since --since touched, and gate --wait waits on them', (t) => {
  const f = onMain(t, slotConfig({ smoke: '0' }));
  passed(run(f, 'slot', '--take', '--holder', 'driver'));
  touch(f);
  const started = run(f, 'gate', '--detach', '--lanes-only', '--since', 'HEAD~1');
  passed(started);
  assert.match(started.out, /smoke lane started pid \d+/);
  assert.doesNotMatch(started.out, /gate started pid/);
  assert.match(started.out, /wait with: node \S+run\.cjs gate --wait --tree \S+/);
  // The driver holds its own ticket, so the lanes take none.
  assert.deepEqual(holders(f.tree), ['driver']);
  const job = JSON.parse(fs.readFileSync(path.join(mainCache(f), 'gate-job.json'), 'utf8'));
  assert.equal(job.pid, undefined);
  assert.equal(job.lanes_only, true);
  assert.deepEqual(job.lanes, ['smoke']);
  assert.equal(job.holder, 'driver');

  const waited = run(f, 'gate', '--wait', '--minutes', '0.5');
  passed(waited);
  assert.match(waited.out, /GREEN lane smoke/);
  assert.match(waited.out, /green \S+/);
  // No finalize command ran.
  assert.equal(fs.existsSync(path.join(f.tree, '.runs')), false);

  const skipped = run(f, 'gate', '--detach', '--lanes-only', '--since', 'HEAD');
  passed(skipped);
  assert.match(skipped.out, /SKIP smoke/);
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
});

test('gate --detach --lanes-only on the base branch without --since diffs the commits origin lacks', (t) => {
  const f = onMain(t, slotConfig({ smoke: '0' }));
  pushedOrigin(f);
  touch(f);
  const started = run(f, 'gate', '--detach', '--lanes-only');
  passed(started);
  assert.match(started.out, /smoke lane started pid \d+/);
  const waited = run(f, 'gate', '--wait', '--minutes', '0.5');
  passed(waited);
  assert.match(waited.out, /GREEN lane smoke/);
});

test('gate --detach --lanes-only on the base branch with no origin and no --since is refused', (t) => {
  const f = onMain(t, slotConfig({ smoke: '0' }));
  touch(f);
  const refused = run(f, 'gate', '--detach', '--lanes-only');
  assert.equal(refused.code, 1, refused.out + refused.err);
  assert.match(refused.err, /BAD_ARGS/);
  assert.match(refused.err, /--since <the commit before your edit>/);
  assert.equal(fs.existsSync(smokeJob(f)), false);
});

test('gate --detach --lanes-only --since an unknown ref is refused and starts no lane', (t) => {
  const f = onMain(t, slotConfig({ smoke: '0' }));
  touch(f);
  const refused = run(f, 'gate', '--detach', '--lanes-only', '--since', 'nosuchref');
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /BAD_REF/);
  assert.match(refused.err, /nosuchref/);
  assert.equal(fs.existsSync(smokeJob(f)), false);
});

test("a red lanes-only wait releases the driver's ticket", (t) => {
  const f = onMain(t, slotConfig({ smoke: '10' }));
  passed(run(f, 'slot', '--take', '--holder', 'driver'));
  touch(f);
  passed(run(f, 'gate', '--detach', '--lanes-only', '--since', 'HEAD~1'));
  const red = run(f, 'gate', '--wait', '--minutes', '0.5');
  assert.equal(red.code, 2, red.out + red.err);
  assert.deepEqual(holders(f.tree), []);
});

test('--since without --lanes-only is refused', (t) => {
  const f = onMain(t, slotConfig({ smoke: '0' }));
  const since = run(f, 'gate', '--detach', '--since', 'HEAD');
  assert.equal(since.code, 1, since.out + since.err);
  assert.match(since.err, /--since/);
  const lanesOnly = run(f, 'gate', '--lanes-only');
  assert.equal(lanesOnly.code, 1, lanesOnly.out + lanesOnly.err);
  assert.match(lanesOnly.err, /--lanes-only/);
});
