'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const RUN = path.join(__dirname, 'run.cjs');
const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');
const { reviewBefore } = require('./review-fixture.cjs');
const { rerunLine } = require('./run-lanes-intermittent.cjs');

// The gate counts a rerun's cause under its command's name: the rest after the session's match on a
// host whose wrapper takes the tree as an argument, else the command with the gate tree's path as
// {tree}. Lines of another tree, of a lane, and of the build before names count under that name.

const BRANCH = 'inferno-intent/demo-00000000T000000Z';
const BARE = 'node flaky.cjs';
const SESSION = "  session:\n    match: '^tools/remote\\.sh auto \\S+ '\n    open: echo open\n    run: bash -c \"$INFERNO_TEST\"\n    close: echo close\n";
const FLAKY_JS = `const fs = require('node:fs');
if (fs.existsSync('../mode') && fs.readFileSync('../mode', 'utf8').trim() === 'red') { console.log('  1 failed'); process.exit(1); }
`;

function git(tree, ...args) {
  return execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A tree on an intent branch whose one finalize command is `command(tree)`, under `extra` keys of verification. */
function fixture(t, command, extra = '') {
  const dir = tempDir('inferno-rerun-name-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = { dir, tree: path.join(dir, 'app'), cache: path.join(dir, 'cache') };
  fs.mkdirSync(f.tree);
  git(f.tree, 'init', '-q', '-b', 'main');
  git(f.tree, 'config', 'user.email', 'test@example.com');
  git(f.tree, 'config', 'user.name', 'Test');
  writeFile(path.join(f.tree, 'flaky.cjs'), FLAKY_JS);
  f.command = command(f.tree);
  fs.mkdirSync(path.join(f.tree, '.specs-inferno'));
  writeFile(path.join(f.tree, '.specs-inferno', 'config.yaml'), `delivery:\n  base_branch: main\nverification:\n  finalize:\n    - ${f.command}\n${extra}`);
  git(f.tree, 'add', '-A');
  git(f.tree, 'commit', '-qm', 'fixture');
  git(f.tree, 'checkout', '-qb', BRANCH);
  return f;
}

function run(f, ...args) {
  reviewBefore(args, f.tree);
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: f.tree, encoding: 'utf8', env: { ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

/** A red gate of the command on the code as it stands. */
function redGate(f, ...extra) {
  writeFile(path.join(f.dir, 'mode'), 'red');
  const red = run(f, 'gate', ...extra);
  assert.equal(red.code, 2, red.out + red.err);
  writeFile(path.join(f.dir, 'mode'), 'green');
}

/** An empty commit on main, folded into the branch by the next gate, whose message carries `body`; returns its short sha. */
function onMain(f, body) {
  git(f.tree, 'checkout', '-q', 'main');
  git(f.tree, 'commit', '-q', '--allow-empty', '-m', 'an earlier landing', '-m', body);
  const sha = git(f.tree, 'rev-parse', '--short', 'HEAD');
  git(f.tree, 'checkout', '-q', BRANCH);
  return sha;
}

/** The rerun records beside the command proofs, with the command each proof names. */
function records(f) {
  const dir = path.join(f.cache, 'specsmd-inferno', 'app', 'green-commands');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.rerun')).map((name) => ({
    ...JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')),
    proof: JSON.parse(fs.readFileSync(path.join(dir, name.slice(0, -'.rerun'.length)), 'utf8')).command,
  }));
}

const cause = (command, by, tests = [command]) =>
  rerunLine({ command, tests, cause: `a race ${by} saw`, by, run: 'gate-20260101T000000Z', log: 'rerun-evidence/a/0.log' });
const lane = (test, by) => `exception: smoke intermittent ${JSON.stringify({ tests: [test], reason: 'a lane race', by, run: 'r', log: 'lane.log' })}`;
const limit = (name, then) => `land the fix on main with the line "Fixes-intermittent: ${name}" in its message, then ${then}.`;

test("under a session whose match ends past the tree, the gate counts another tree's whole command and a lane accept under the rest, and records the rest", (t) => {
  const f = fixture(t, (tree) => `tools/remote.sh auto ${tree} ${BARE}`, SESSION);
  const usage = run(f, 'gate', '--cause', 'why');
  assert.equal(usage.code, 1, usage.out + usage.err);
  assert.match(usage.err, /never with --wait, --lane, --lanes-only or --test, since the cap counts the command by its name$/m);
  assert.match(run(f, 'help').out, /^ {2}node run\.cjs gate --detach --cause "<why>" .* past two causes under its name on the base since a "Fixes-intermittent: <name>" commit$/m);

  // The build before names wrote another tree's whole command; a lane accepted the same check by its name.
  const first = onMain(f, cause(`tools/remote.sh auto ${path.join(f.dir, 'gate-a')} ${BARE}`, 'lead'));
  const second = onMain(f, lane(BARE, 'release-lead'));
  redGate(f);
  const refused = run(f, 'gate', '--cause', 'a third race', '--by', 'lead');
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, new RegExp(`^ERROR \\[INTERMITTENT_LIMIT\\] refused: ${BARE} was accepted as intermittent 2 times on main since a commit there ` +
    `last named its fix: ${first} \\S+ by lead, ${second} \\S+ by release-lead\\.`, 'm'));
  assert.ok(refused.err.includes(limit(BARE, 'run the gate again with its cause')), refused.err);
  assert.equal(refused.err.includes(f.tree), false, refused.err);
  assert.deepEqual(records(f), []);

  // A fix line written with the whole command of yet another tree names the same check, and lifts it.
  onMain(f, `Fixes-intermittent: tools/remote.sh auto ${path.join(f.dir, 'gate-b')} ${BARE}`);
  const taken = run(f, 'gate', '--cause', 'a third race', '--by', 'lead');
  assert.equal(taken.code, 0, taken.out + taken.err);
  assert.doesNotMatch(taken.out, /^earlier intermittent accept/m);
  const [record, ...more] = records(f);
  assert.deepEqual(more, []);
  assert.deepEqual([record.command, record.proof, record.tests, record.cause], [f.command, f.command, [BARE], 'a third race']);
});

test("without a session a command holding the gate tree's path is counted and recorded with {tree}, and one of another tree stays as written", (t) => {
  const f = fixture(t, (tree) => `node ${tree}/flaky.cjs --root=${tree}`);
  const name = 'node {tree}/flaky.cjs --root={tree}';
  const other = path.join(f.dir, 'gate-a');
  const named = onMain(f, cause(name, 'lead'));
  onMain(f, cause(`node ${other}/flaky.cjs --root=${other}`, 'release-lead'));
  redGate(f);
  const taken = run(f, 'gate', '--cause', 'a second race', '--by', 'lead');
  assert.equal(taken.code, 0, taken.out + taken.err);
  assert.deepEqual(taken.out.split('\n').filter((line) => line.startsWith('earlier ')).map((line) => line.replace(/ \d{4}-\d\d-\d\d /, ' <date> ')),
    [`earlier intermittent accept of ${name}: ${named} <date> by lead: a race lead saw`]);
  assert.deepEqual(records(f).map((record) => [record.command, record.proof, record.tests]), [[f.command, f.command, [name]]]);

  // A line the build before names wrote with this tree's path counts under the name.
  const whole = onMain(f, cause(f.command, 'release-lead'));
  redGate(f, '--force');
  const refused = run(f, 'gate', '--cause', 'a third race', '--by', 'lead');
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, new RegExp(`refused: node \\{tree\\}/flaky\\.cjs --root=\\{tree\\} was accepted as intermittent 2 times .*: ${named} \\S+ by lead, ${whole} \\S+ by release-lead\\.`));
  assert.ok(refused.err.includes(limit(name, 'run the gate again with its cause')), refused.err);
});
