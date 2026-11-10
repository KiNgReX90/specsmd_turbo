const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const RUN = path.join(__dirname, 'run.cjs');
const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');
const { reviewBefore } = require('./review-fixture.cjs');
const fixtures = require('./run-fixture.cjs');

// An intent run branch, the only kind of branch that keeps a run config.
const BRANCH = 'inferno-intent/demo-00000000T000000Z';
const DEFAULT = '.specs-inferno/config.yaml';
const RUN_CONFIG = '.specs-inferno/config.run.yaml';

/** A host config whose finalize and integrate commands name the config they came from. */
function config(name) {
  return `delivery:\n  base_branch: main\nverification:\n  finalize:\n    - node proof.cjs ${name}-final\n` +
    `  integrate:\n    - node proof.cjs ${name}-integrate\n`;
}

function write(tree, file, body) {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
  writeFile(path.join(tree, file), body);
}

function git(tree, ...args) {
  return execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A tree on the run branch with the repo config and a run config, each command logging its name to `.runs`. */
function fixture(t) {
  const dir = tempDir('inferno-run-config-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tree = path.join(dir, 'app');
  fs.mkdirSync(tree);
  git(tree, 'init', '-q', '-b', 'main');
  git(tree, 'config', 'user.email', 'test@example.com');
  git(tree, 'config', 'user.name', 'Test');
  write(tree, '.gitignore', '.runs\n');
  write(tree, 'src/input.txt', 'one\n');
  write(tree, DEFAULT, config('repo'));
  write(tree, RUN_CONFIG, config('run'));
  write(tree, 'proof.cjs', "require('node:fs').appendFileSync('.runs', process.argv[2] + '\\n');\n");
  git(tree, 'add', '-A');
  git(tree, 'commit', '-qm', 'fixture');
  git(tree, 'checkout', '-qb', BRANCH);
  return { dir, tree, cache: path.join(dir, 'cache') };
}

function run(f, ...args) {
  reviewBefore(args, f.tree);
  // CLAUDE_BUILD_WRAPPED is claude-build's nested-call marker: a fake command runs as is and never queues on the machine-wide build lock.
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: f.tree, encoding: 'utf8', env: { ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function ran(f) {
  const file = path.join(f.tree, '.runs');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : [];
}

function passed(result) {
  assert.equal(result.code, 0, result.out + result.err);
}

/** A committed source change, so a command proven on the old tree runs again instead of reusing its proof. */
function edit(f) {
  fs.appendFileSync(path.join(f.tree, 'src/input.txt'), 'more\n');
  git(f.tree, 'commit', '-qam', 'edit');
}

/** The record file the runner writes for the branch, read under the fixture's cache dir. */
function recordIn(f, branch) {
  const saved = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = f.cache;
  try {
    return require('./run-config-record.cjs').recordFile(f.tree, branch);
  } finally {
    if (saved === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = saved;
  }
}

test('integrate without --config runs the config a gate recorded on the run branch', (t) => {
  const f = fixture(t);
  passed(run(f, 'gate', '--config', RUN_CONFIG));
  passed(run(f, 'integrate'));
  assert.deepEqual(ran(f), ['run-final', 'run-integrate']);
});

test('gate without --config runs the config an integrate recorded', (t) => {
  const f = fixture(t);
  passed(run(f, 'integrate', '--config', RUN_CONFIG));
  passed(run(f, 'gate'));
  assert.deepEqual(ran(f), ['run-integrate', 'run-final']);
});

test('a new --config replaces the record', (t) => {
  const f = fixture(t);
  passed(run(f, 'integrate', '--config', RUN_CONFIG));
  edit(f);
  passed(run(f, 'integrate', '--config', DEFAULT));
  edit(f);
  passed(run(f, 'integrate'));
  assert.deepEqual(ran(f), ['run-integrate', 'repo-integrate', 'repo-integrate']);
});

test('a call that fails records nothing', (t) => {
  const f = fixture(t);
  passed(run(f, 'integrate', '--config', RUN_CONFIG));
  assert.equal(run(f, 'integrate', '--config', '.specs-inferno/missing.yaml').code, 2);
  edit(f);
  passed(run(f, 'integrate'));
  assert.deepEqual(ran(f), ['run-integrate', 'run-integrate']);
});

test('a recorded config that is gone is refused, never replaced by the repo config', (t) => {
  const f = fixture(t);
  const outside = path.join(f.dir, 'outside.yaml');
  writeFile(outside, config('outside'));
  passed(run(f, 'integrate', '--config', outside));
  fs.rmSync(outside);
  const result = run(f, 'integrate');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /BAD_CONFIG/);
  assert.ok(result.err.includes(outside), result.err);
  assert.match(result.err, /--config/);
  assert.deepEqual(ran(f), ['outside-integrate']);
});

test('the base branch records nothing', (t) => {
  const f = fixture(t);
  git(f.tree, 'checkout', '-q', 'main');
  passed(run(f, 'integrate', '--tree', f.tree, '--config', RUN_CONFIG));
  passed(run(f, 'integrate', '--tree', f.tree));
  assert.deepEqual(ran(f), ['run-integrate', 'repo-integrate']);
  assert.equal(fs.existsSync(recordIn(f, 'main')), false);
});

test('a bare gate --wait waits on the gate the recorded config started', (t) => {
  const f = fixture(t);
  passed(run(f, 'gate', '--detach', '--config', RUN_CONFIG));
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  assert.deepEqual(ran(f), ['run-final']);
});

test('green without --config checks the proofs of the recorded config', (t) => {
  const f = fixture(t);
  passed(run(f, 'gate', '--config', RUN_CONFIG));
  passed(run(f, 'green'));
});

test('a record of another version is no record', (t) => {
  const f = fixture(t);
  passed(run(f, 'integrate', '--config', RUN_CONFIG));
  const file = recordIn(f, BRANCH);
  const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual({ ...kept, recorded_at: null }, { version: 1, branch: BRANCH, config: RUN_CONFIG, step: 'integrate', recorded_at: null });
  writeFile(file, JSON.stringify({ ...kept, version: 2 }));
  passed(run(f, 'integrate'));
  assert.deepEqual(ran(f), ['run-integrate', 'repo-integrate']);
});

/** The CLI fixture with alpha claimed under a run config whose bootstrap and integrate differ from the repo's. */
function claimed(t) {
  const fixture = fixtures.repo();
  t.after(() => fs.rmSync(fixture.dir, { recursive: true, force: true }));
  const body = fixtures.CONFIG
    .replace('echo ran > node_modules/marker', 'echo ran > node_modules/run-marker')
    .replace('  finalize:', '  integrate:\n    - echo run integrate\n  finalize:');
  fixtures.write(fixture.root, RUN_CONFIG, body);
  fixtures.git(fixture.root, ['add', '-A']);
  fixtures.git(fixture.root, ['commit', '-qm', 'run config']);
  const claim = fixtures.run(fixture, ['claim', 'alpha', '--config', RUN_CONFIG]);
  assert.equal(claim.code, 0, claim.out + claim.err);
  return fixture;
}

test("a claim's --config reaches the worktree bootstrap and the integrate in it", (t) => {
  const fixture = claimed(t);
  const made = fixtures.run(fixture, ['worktree', 'alpha', '--json']);
  assert.equal(made.code, 0, made.out + made.err);
  const tree = JSON.parse(made.out).path;
  assert.ok(fs.existsSync(path.join(tree, 'node_modules/run-marker')));
  assert.equal(fs.existsSync(path.join(tree, 'node_modules/marker')), false);
  const landed = fixtures.run(fixture, ['integrate', '--tree', tree]);
  assert.equal(landed.code, 0, landed.out + landed.err);
  assert.match(landed.out, /echo run integrate/);
});

test('a call that names the recorded config prints its calls with it', (t) => {
  const fixture = claimed(t);
  const tree = JSON.parse(fixtures.run(fixture, ['worktree', 'alpha', '--json']).out).path;
  const refused = fixtures.run(fixture, ['integrate', '--item', 'a-one', '--tree', tree]);
  assert.equal(refused.code, 3, refused.out + refused.err);
  assert.ok(refused.err.includes(`review --item a-one --tree ${tree} --config ${RUN_CONFIG}`), refused.err);
});
