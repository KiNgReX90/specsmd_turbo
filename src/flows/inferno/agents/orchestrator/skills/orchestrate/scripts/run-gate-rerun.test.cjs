'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const RUN = path.join(__dirname, 'run.cjs');
const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');
const { intentReviewed, reviewBefore } = require('./review-fixture.cjs');
const { readConfig } = require('./run-lib.cjs');
const jobs = require('./run-jobs.cjs');

// A finalize command red on one gate and green on the next gate of the same code leaves a record:
// the second gate knows it runs a red again, takes its cause and signer, and its green carries
// them for ship (run-ship-rerun.test.cjs). The command reads its mode from a file outside the tree,
// so the code stays the same between the gates: red, refuse (the host's wrapper ran nothing),
// moveself (it edits its own input), move (the scoped mover commits outside its scope), moverred
// (the flaky command passes and the mover fails) or hold.

const BRANCH = 'inferno-intent/demo-00000000T000000Z';
const FLAKY = 'node flaky.cjs';
const MOVER = 'node flaky.cjs mover';
const CAUSE = 'the "shared" port {8080} was taken\nby another suite';
const NO_CAUSE = `no --cause on a rerun of the red ${FLAKY} on unchanged code: its green records no cause, and ship writes no exception line`;
const USAGE = /^ERROR \[BAD_ARGS\] usage: node run\.cjs gate \[--detach\] \[--supersede\] --cause "<why>" --by <who> /m;
const CAUSE_LINE = /^if this red is not this branch's work, gate the same code again with its cause: run\.cjs gate --detach --cause "<why>" --by <who> --tree \S+$/m;

const FLAKY_JS = `const fs = require('node:fs');
const name = process.argv[2] || 'flaky';
fs.appendFileSync('.runs', name + '\\n');
const mode = fs.existsSync('../mode') ? fs.readFileSync('../mode', 'utf8').trim() : 'green';
if (name === 'mover') {
  if (mode === 'moverred') { console.log('mover failed'); process.exit(1); }
  if (mode === 'move') {
    fs.appendFileSync('src/input.txt', 'moved\\n');
    require('node:child_process').execFileSync('git', ['commit', '-qam', 'mid-gate']);
  }
  process.exit(0);
}
if (mode === 'red') { console.log('  1 failed'); process.exit(1); }
if (mode === 'refuse') { console.log('the wrapper refused'); process.exit(1); }
if (mode === 'moveself') fs.appendFileSync('src/input.txt', 'moved\\n');
while (mode === 'hold' && !fs.existsSync('../release')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
`;

function write(tree, file, body) {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
  writeFile(path.join(tree, file), body);
}

function git(tree, ...args) {
  return execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(tree, message = 'change') {
  git(tree, 'add', '-A');
  git(tree, 'commit', '-qm', message);
}

/** Stop a gate job this test detached, by the pid its job file records, and wait until its group is gone. */
function stopJob(f) {
  const job = jobs.readJson(path.join(branchDir(f), 'gate-job.json'));
  if (!job || !jobs.alive(job)) return;
  try {
    process.kill(-job.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  for (let i = 0; i < 100 && jobs.alive(job); i += 1) jobs.sleepSync(50);
}

function fixture(t, extra = '') {
  const dir = tempDir('inferno-rerun-');
  const f = { dir, tree: path.join(dir, 'app'), cache: path.join(dir, 'cache') };
  t.after(() => {
    writeFile(path.join(dir, 'release'), '');
    stopJob(f);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.mkdirSync(f.tree);
  git(f.tree, 'init', '-q', '-b', 'main');
  git(f.tree, 'config', 'user.email', 'test@example.com');
  git(f.tree, 'config', 'user.name', 'Test');
  write(f.tree, '.gitignore', '.runs\n');
  write(f.tree, 'src/input.txt', 'one\n');
  write(f.tree, 'docs/readme.md', 'docs\n');
  write(f.tree, 'flaky.cjs', FLAKY_JS);
  write(f.tree, '.specs-inferno/config.yaml', `delivery:\n  base_branch: main\nverification:\n  finalize:\n    - ${FLAKY}\n    - ${MOVER}\n` +
    `  finalize_scopes:\n    "${MOVER}": ["docs/**"]\n${extra}`);
  commit(f.tree, 'fixture');
  git(f.tree, 'checkout', '-qb', BRANCH);
  return f;
}

function run(f, ...args) {
  reviewBefore(args, f.tree);
  // CLAUDE_BUILD_WRAPPED is claude-build's nested-call marker: a fake command runs as is and never queues on the machine-wide build lock.
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: f.tree, encoding: 'utf8', env: { ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const mode = (f, value) => writeFile(path.join(f.dir, 'mode'), value);
const lines = (result) => result.out.split('\n').filter(Boolean);
const branchDir = (f) => path.join(f.cache, 'specsmd-inferno', 'app', BRANCH);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const held = (cause, by = 'lead') => new RegExp(`^RERUN node flaky\\.cjs: red in gate-\\d{8}T\\d{6}Z, cause by ${by}: ${escape(JSON.stringify(cause))}$`, 'm');

function ran(f) {
  const file = path.join(f.tree, '.runs');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : [];
}

/** The rerun records beside the command proofs. */
function records(f) {
  const dir = path.join(f.cache, 'specsmd-inferno', 'app', 'green-commands');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.rerun')).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
}

function passed(result) {
  assert.equal(result.code, 0, result.out + result.err);
}

/** A red gate of the flaky command on the code as it stands; returns the red log it names. */
function redGate(f, ...extra) {
  mode(f, 'red');
  const red = run(f, 'gate', ...extra);
  assert.equal(red.code, 2, red.out + red.err);
  mode(f, 'green');
  return /^FAIL \d+s node flaky\.cjs -> (\S+)$/m.exec(red.out)[1];
}

/** An empty commit on main, folded into the branch by the next gate, whose message carries `body`; returns its short sha. */
function onMain(f, body) {
  git(f.tree, 'checkout', '-q', 'main');
  git(f.tree, 'commit', '-q', '--allow-empty', '-m', 'an earlier landing', '-m', body);
  const sha = git(f.tree, 'rev-parse', '--short', 'HEAD');
  git(f.tree, 'checkout', '-q', BRANCH);
  return sha;
}

function refusedNoRerun(f, result) {
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, new RegExp(`^ERROR \\[NO_RERUN\\] no finalize command was red on the last gate of ${escape(BRANCH)} on this code, ` +
    'so there is no cause to record: run the gate without --cause, run\\.cjs gate --detach --tree \\S+$', 'm'));
}

test('a gate after a red one on the same code takes the cause, its green and the command proof carry it, and a later green gate keeps it', (t) => {
  const f = fixture(t);
  mode(f, 'red');
  const red = run(f, 'gate');
  assert.equal(red.code, 2, red.out + red.err);
  assert.match(red.out, CAUSE_LINE);
  const log = /^FAIL \d+s node flaky\.cjs -> (\S+\/gate-\d{8}T\d{6}Z\/0\.log)$/m.exec(red.out)[1];
  mode(f, 'green');

  const again = run(f, 'gate', '--cause', CAUSE, '--by', 'lead');
  passed(again);
  assert.ok(lines(again).includes(`rerun of the red ${FLAKY} on unchanged code, cause by lead: ${JSON.stringify(CAUSE)}`), again.out);
  assert.match(again.out, held(CAUSE));
  assert.doesNotMatch(again.out, CAUSE_LINE);
  const hash = /^green ([0-9a-f]+)$/.exec(lines(again).pop())[1];
  assert.deepEqual(ran(f), ['flaky', 'flaky', 'mover']);
  const [record, ...more] = records(f);
  assert.deepEqual(more, []);
  assert.deepEqual({ ...record, stamp: null }, {
    hash, branch: BRANCH, command: FLAKY, tests: [FLAKY], cause: CAUSE, by: 'lead', run: path.basename(path.dirname(log)), dir: path.dirname(log), log, stamp: null,
  });
  assert.ok(Number.isFinite(Date.parse(record.stamp)), record.stamp);
  assert.match(fs.readFileSync(record.log, 'utf8'), /1 failed/);

  // A later gate of that code reads its cached proofs and keeps the cause; it is green, so it is no rerun.
  const kept = run(f, 'gate', '--json');
  passed(kept);
  const payload = JSON.parse(kept.out);
  assert.deepEqual(payload.rerun, [record]);
  assert.ok(payload.notes.some((line) => held(CAUSE).test(line)), payload.notes);
  assert.deepEqual(ran(f), ['flaky', 'flaky', 'mover']);
  refusedNoRerun(f, run(f, 'gate', '--cause', 'once more', '--by', 'lead'));
  assert.equal(records(f)[0].cause, CAUSE);

  // Another branch on the same code holds no cause of this one.
  git(f.tree, 'checkout', '-qb', 'inferno-intent/other-00000000T000000Z');
  const other = run(f, 'gate', '--json');
  passed(other);
  assert.equal('rerun' in JSON.parse(other.out), false);
});

test('a gate after a red one carries no cause once a fix or a fold moved the code', (t) => {
  const fixed = fixture(t);
  redGate(fixed);
  write(fixed.tree, 'src/input.txt', 'fixed\n');
  commit(fixed.tree, 'the fix');
  refusedNoRerun(fixed, run(fixed, 'gate', '--cause', CAUSE, '--by', 'lead'));
  assert.deepEqual(ran(fixed), ['flaky']);
  const green = run(fixed, 'gate');
  passed(green);
  assert.doesNotMatch(green.out, /rerun|RERUN/);
  assert.deepEqual(records(fixed), []);

  // The base brings a change between the two gates, outside what the intent review binds: the fold makes the code new.
  const folded = fixture(t, 'review:\n  outside: ["docs/**"]\n');
  intentReviewed(folded.tree, 'demo', 'verdict: clean\n', readConfig(folded.tree));
  redGate(folded);
  git(folded.tree, 'checkout', '-q', 'main');
  write(folded.tree, 'docs/readme.md', 'the base moved\n');
  commit(folded.tree, 'base');
  git(folded.tree, 'checkout', '-q', BRANCH);
  refusedNoRerun(folded, run(folded, 'gate', '--cause', CAUSE, '--by', 'lead'));
  assert.deepEqual(ran(folded), ['flaky']);
  const after = run(folded, 'gate');
  passed(after);
  assert.doesNotMatch(after.out, /rerun|RERUN/);
  assert.deepEqual(records(folded), []);
});

test('a rerun without a cause runs, says in one line what its green loses, and records nothing', (t) => {
  const f = fixture(t);
  redGate(f);
  const again = run(f, 'gate');
  passed(again);
  assert.ok(lines(again).includes(NO_CAUSE), again.out);
  assert.doesNotMatch(again.out, /^RERUN /m);
  assert.deepEqual(records(f), []);
  assert.equal('rerun' in JSON.parse(run(f, 'gate', '--json').out), false);
});

test('a red rerun or one with no verdict records nothing, and the gate after it on the same code is a rerun again', (t) => {
  const f = fixture(t, '  refused: "^the wrapper refused$"\n');
  redGate(f);
  mode(f, 'red');
  const red = run(f, 'gate', '--cause', 'first', '--by', 'lead');
  assert.equal(red.code, 2, red.out + red.err);
  assert.match(red.out, CAUSE_LINE);
  assert.deepEqual(records(f), []);
  mode(f, 'refuse');
  const none = run(f, 'gate', '--cause', 'second', '--by', 'lead');
  assert.equal(none.code, 5, none.out + none.err);
  assert.doesNotMatch(none.out, CAUSE_LINE);
  assert.deepEqual(records(f), []);
  mode(f, 'green');
  const green = run(f, 'gate', '--cause', 'third', '--by', 'release-lead');
  passed(green);
  assert.equal(lines(green).filter((line) => line.startsWith('rerun of the red ')).length, 1, green.out);
  const [record] = records(f);
  assert.equal(record.cause, 'third');
  assert.equal(record.by, 'release-lead');
  assert.match(fs.readFileSync(record.log, 'utf8'), /1 failed/);
  assert.equal(path.dirname(path.dirname(record.log)), branchDir(f));
});

test('a gate whose code moved while it ran is no red, and leaves the red before it standing', (t) => {
  // The command edits its own input: the gate is red with the code moved, and the next gate on that code is no rerun.
  const own = fixture(t);
  mode(own, 'moveself');
  const moved = run(own, 'gate');
  assert.equal(moved.code, 2, moved.out + moved.err);
  assert.match(moved.out, /changed while the gate ran/);
  assert.doesNotMatch(moved.out, CAUSE_LINE);
  git(own.tree, 'checkout', '--', 'src/input.txt');
  mode(own, 'green');
  refusedNoRerun(own, run(own, 'gate', '--cause', CAUSE, '--by', 'lead'));

  // The scoped mover commits outside its scope after the flaky command passed: no verdict on the red's code.
  const f = fixture(t);
  redGate(f);
  mode(f, 'move');
  const after = run(f, 'gate');
  assert.equal(after.code, 2, after.out + after.err);
  assert.match(after.out, /changed while the gate ran/);
  assert.doesNotMatch(after.out, /^RERUN /m);
  git(f.tree, 'reset', '-q', '--hard', 'HEAD~1');
  mode(f, 'green');
  passed(run(f, 'gate', '--cause', CAUSE, '--by', 'lead'));
  assert.equal(records(f)[0].cause, CAUSE);
});

test('a gate killed mid-run leaves the red before it standing', (t) => {
  const f = fixture(t);
  redGate(f);
  mode(f, 'hold');
  passed(run(f, 'gate', '--detach'));
  for (let i = 0; i < 200 && ran(f).length < 2; i += 1) jobs.sleepSync(25);
  assert.deepEqual(ran(f), ['flaky', 'flaky']);
  stopJob(f);
  mode(f, 'green');
  passed(run(f, 'gate', '--cause', CAUSE, '--by', 'lead'));
  assert.equal(records(f)[0].cause, CAUSE);
});

test('a red the released flow left, with no code hash, makes the next gate no rerun', (t) => {
  const f = fixture(t);
  const dir = path.join(branchDir(f), 'gate-20260101T000000Z');
  write(dir, '0.log', '  1 failed\n');
  write(branchDir(f), 'gate-job.result.json', `${JSON.stringify({ ok: false, tree: f.tree, branch: BRANCH, folded: false,
    results: [{ command: FLAKY, result: 'fail', seconds: 0, log: path.join(dir, '0.log') }] })}\n`);
  refusedNoRerun(f, run(f, 'gate', '--cause', CAUSE, '--by', 'lead'));
  // A verdict without the hash it ran on names no code, so it is no red of this code either.
  write(branchDir(f), 'gate-verdict.json', `${JSON.stringify({ ok: false, reds: [{ command: FLAKY, dir, log: path.join(dir, '0.log') }] })}\n`);
  refusedNoRerun(f, run(f, 'gate', '--cause', CAUSE, '--by', 'lead'));
  const green = run(f, 'gate');
  passed(green);
  assert.doesNotMatch(green.out, /rerun|RERUN/);
});

test('a cause given wrongly is refused before anything runs, and only a gate takes one', (t) => {
  const f = fixture(t);
  redGate(f);
  for (const args of [
    ['gate', '--cause', 'why'],
    ['gate', '--by', 'lead'],
    ['gate', '--cause', '  ', '--by', 'lead'],
    ['gate', '--cause', 'why', '--by', ' '],
    ['gate', '--wait', '--cause', 'why', '--by', 'lead'],
    ['gate', '--detach', '--lanes-only', '--cause', 'why', '--by', 'lead'],
    ['gate', '--lane', 'smoke', '--cause', 'why', '--by', 'lead'],
    ['gate', '--cause', 'why', '--by', 'lead', '--test', 'checkout.test.mjs "redeems a card"'],
  ]) {
    const refused = run(f, ...args);
    assert.equal(refused.code, 1, `${args.join(' ')}: ${refused.out}${refused.err}`);
    assert.match(refused.err, USAGE);
  }
  for (const [step, ...args] of [['integrate', '--cause', 'why', '--by', 'lead'], ['verify-item', 'a-one', '--cause', 'why']]) {
    const refused = run(f, step, ...args);
    assert.equal(refused.code, 1, refused.out + refused.err);
    assert.match(refused.err, new RegExp(`^ERROR \\[BAD_ARGS\\] ${step} takes no --cause: only a gate run again on the code a finalize command was red on records one$`, 'm'));
  }
  assert.deepEqual(ran(f), ['flaky']);
  passed(run(f, 'gate', '--cause', ' why\n', '--by', ' lead '));
  assert.equal(records(f)[0].cause, 'why');
  assert.equal(records(f)[0].by, 'lead');
});

test('a rerun red on another command keeps both reds, and the green after it records the cause for each', (t) => {
  const f = fixture(t);
  redGate(f);
  mode(f, 'moverred');
  const red = run(f, 'gate', '--cause', 'first', '--by', 'lead');
  assert.equal(red.code, 2, red.out + red.err);
  assert.match(red.out, /^FAIL \d+s node flaky\.cjs mover -> /m);
  mode(f, 'green');
  const green = run(f, 'gate', '--cause', 'both', '--by', 'lead');
  passed(green);
  assert.deepEqual(lines(green).filter((line) => line.startsWith('rerun of the red ')),
    [FLAKY, MOVER].map((command) => `rerun of the red ${command} on unchanged code, cause by lead: "both"`));
  const byCommand = Object.fromEntries(records(f).map((record) => [record.command, record]));
  assert.deepEqual(Object.keys(byCommand).sort(), [FLAKY, MOVER]);
  assert.match(fs.readFileSync(byCommand[FLAKY].log, 'utf8'), /1 failed/);
  assert.match(fs.readFileSync(byCommand[MOVER].log, 'utf8'), /mover failed/);
  assert.ok(Object.values(byCommand).every((record) => record.cause === 'both'));
});

test('the base holding two causes of the command, a lane accept of that name among them, refuses the next until a commit names its fix', (t) => {
  const f = fixture(t);
  const lane = `exception: smoke intermittent ${JSON.stringify({ tests: [FLAKY], reason: 'a lane race', by: 'lead', run: 'earlier', log: 'lane-smoke.log' })}`;
  const first = onMain(f, lane);
  redGate(f);
  const taken = run(f, 'gate', '--cause', CAUSE, '--by', 'lead');
  passed(taken);
  assert.ok(lines(taken).some((line) => new RegExp(`^earlier intermittent accept of node flaky\\.cjs: ${first} \\d{4}-\\d\\d-\\d\\d by lead: a lane race$`).test(line)),
    taken.out);

  redGate(f, '--force');
  const rerun = `exception: ${FLAKY} rerun ${JSON.stringify({ command: FLAKY, tests: [FLAKY], cause: 'an earlier race', by: 'release-lead', run: 'gate-x', log: 'not kept: gone before ship' })}`;
  const second = onMain(f, rerun);
  const refused = run(f, 'gate', '--cause', 'a third race', '--by', 'lead');
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /^ERROR \[INTERMITTENT_LIMIT\] refused: node flaky\.cjs was accepted as intermittent 2 times on main since a commit there last named its fix: /m);
  assert.match(refused.err, new RegExp(`${first} \\S+ by lead, ${second} \\S+ by release-lead\\.`));
  assert.ok(refused.err.includes(`land the fix on main with the line "Fixes-intermittent: ${FLAKY}" in its message, then run the gate again with its cause.`), refused.err);
  assert.deepEqual(ran(f), ['flaky', 'flaky', 'mover', 'flaky']);
  assert.equal(records(f)[0].cause, CAUSE);

  onMain(f, `Fixes-intermittent: ${FLAKY}`);
  const fixed = run(f, 'gate', '--cause', 'a third race', '--by', 'lead');
  passed(fixed);
  assert.doesNotMatch(fixed.out, /^earlier intermittent accept/m);
  assert.equal(records(f)[0].cause, 'a third race');
});

test('gate --detach carries the cause to the detached gate, and --wait prints and returns what it recorded', (t) => {
  const f = fixture(t);
  redGate(f);
  const plain = run(f, 'gate', '--detach');
  passed(plain);
  assert.ok(lines(plain).includes(NO_CAUSE), plain.out);
  const plainWait = run(f, 'gate', '--wait', '--minutes', '0.5');
  passed(plainWait);
  assert.doesNotMatch(plainWait.out, /^RERUN /m);
  assert.deepEqual(records(f), []);

  redGate(f, '--force');
  const started = run(f, 'gate', '--detach', '--cause', CAUSE, '--by', 'lead');
  passed(started);
  assert.ok(lines(started).includes(`rerun of the red ${FLAKY} on unchanged code, cause by lead: ${JSON.stringify(CAUSE)}`), started.out);
  assert.doesNotMatch(started.out, /no --cause/);
  const waited = run(f, 'gate', '--wait', '--minutes', '0.5');
  passed(waited);
  assert.match(waited.out, held(CAUSE));
  assert.match(lines(waited).pop(), /^green [0-9a-f]+$/);
  assert.deepEqual(JSON.parse(run(f, 'gate', '--wait', '--json').out).rerun, records(f));
  assert.equal(records(f)[0].cause, CAUSE);

  const job = fs.readFileSync(path.join(branchDir(f), 'gate-job.json'), 'utf8');
  refusedNoRerun(f, run(f, 'gate', '--detach', '--cause', 'again', '--by', 'lead'));
  assert.equal(fs.readFileSync(path.join(branchDir(f), 'gate-job.json'), 'utf8'), job);
});

test('a queued gate --detach keeps its cause for the start at the head, and a refused cause gives the ticket back', (t) => {
  const f = fixture(t, '  merge_slot: true\n');
  redGate(f);
  passed(run(f, 'slot', '--take', '--holder', 'other'));
  const queued = run(f, 'gate', '--detach', '--cause', CAUSE, '--by', 'lead');
  assert.equal(queued.code, 4, queued.out + queued.err);
  assert.deepEqual(ran(f), ['flaky']);
  passed(run(f, 'slot', '--release', '--holder', 'other'));
  const waited = run(f, 'gate', '--wait', '--minutes', '0.5');
  passed(waited);
  assert.ok(lines(waited).includes(`rerun of the red ${FLAKY} on unchanged code, cause by lead: ${JSON.stringify(CAUSE)}`), waited.out);
  assert.match(waited.out, held(CAUSE));
  assert.equal(records(f)[0].cause, CAUSE);
  assert.ok(lines(run(f, 'slot')).includes(BRANCH));

  // A plain detach is a start of its own: it takes no cause a queued detach left.
  redGate(f, '--force');
  passed(run(f, 'slot', '--release', '--holder', BRANCH));
  passed(run(f, 'slot', '--take', '--holder', 'other'));
  assert.equal(run(f, 'gate', '--detach', '--cause', 'left behind', '--by', 'lead').code, 4);
  passed(run(f, 'slot', '--release', '--holder', 'other'));
  const plain = run(f, 'gate', '--detach');
  passed(plain);
  assert.ok(lines(plain).includes(NO_CAUSE), plain.out);
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  assert.equal(records(f)[0].cause, CAUSE);

  refusedNoRerun(f, run(f, 'gate', '--detach', '--cause', 'again', '--by', 'lead'));
  assert.ok(!lines(run(f, 'slot')).includes(BRANCH));
});
