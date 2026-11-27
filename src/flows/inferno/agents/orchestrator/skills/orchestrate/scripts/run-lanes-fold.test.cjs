const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { writeFile } = require('./test-write.cjs');

const {
  BRANCH, cacheOf, commit, config, fixture, gated, git, harnessFix, laneRuns, passed, run, touch, whole, write,
} = require('./run-lanes-fixture.cjs');

// An accepted instrument red holds for a tree that differs from the accepted one only by the
// harness fix, so the fold that brings a fix inside the lane's own scope does not retire it.

const WALK = 'src/walk.txt';
const short = (sha) => sha.slice(0, 7);
const unwalked = (fix, files) =>
  new RegExp(`^the accept leaves unwalked the files harness fix ${short(fix)} changed in the smoke lane's scope: ${files.join(', ')}$`, 'm');

/**
 * The smoke lane ends instrument red on a tree the branch changed in scope. The harness file WALK
 * is on the base and in the tree first, so a fix to it changes a file the red tree holds.
 */
function redLane(f) {
  harnessFix(f, WALK);
  touch(f);
  const wait = gated(f);
  assert.equal(wait.code, 3, wait.out + wait.err);
}

function accept(f, fix) {
  const result = run(f, 'smoke', '--accept', '--harness-fix', fix);
  passed(result);
  return result;
}

/** green holds the smoke lane on its accept. */
function held(f) {
  const verdict = run(f, 'green');
  passed(verdict);
  assert.match(verdict.out, /^ACCEPTED smoke instrument red, harness fix [0-9a-f]{7}$/m);
}

/** green owes the smoke lane, whatever else it owes. */
function owed(f) {
  const verdict = run(f, 'green', '--json');
  assert.equal(verdict.code, 3, verdict.out + verdict.err);
  assert.deepEqual(JSON.parse(verdict.out).owed, ['smoke']);
}

/** Fold the base into the branch as a gate does, then prove the finalize commands with the gate that walks no lane. */
function fold(f) {
  git(f.tree, 'merge', '-q', '--no-edit', 'main');
  passed(run(f, 'gate'));
}

test('an accept before the fold holds once the gate folds a fix inside the lane scope, and the lane walks once', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  const fix = harnessFix(f, WALK, false);
  const accepted = accept(f, fix);
  assert.match(accepted.out, unwalked(fix, [WALK]));
  held(f);
  git(f.tree, 'merge', '-q', '--no-edit', 'main');
  const started = run(f, 'gate', '--detach');
  passed(started);
  assert.match(started.out, new RegExp(`^ACCEPTED lane smoke instrument red, harness fix ${short(fix)}$`, 'm'));
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  assert.deepEqual(laneRuns(f), ['smoke']);
  held(f);
});

test('the fold-first order accepts, and gate --wait holds the lane on it', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  const fix = harnessFix(f, WALK, false);
  fold(f);
  owed(f);
  assert.match(accept(f, fix).out, unwalked(fix, [WALK]));
  held(f);
  const wait = run(f, 'gate', '--wait', '--minutes', '0.5');
  passed(wait);
  assert.match(wait.out, /^ACCEPTED lane smoke instrument red, harness fix [0-9a-f]{7}$/m);
});

test('a second base commit to the fixed file retires the accept and green owes the lane', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  accept(f, harnessFix(f, WALK, false));
  fold(f);
  held(f);
  harnessFix(f, WALK, false);
  fold(f);
  owed(f);
});

test('a fix that adds a file the red tree does not hold holds through the fold too', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  const fix = harnessFix(f, 'src/added.txt', false);
  assert.match(accept(f, fix).out, unwalked(fix, ['src/added.txt']));
  fold(f);
  held(f);
});

test('a base commit to another file in scope retires the accept', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  accept(f, harnessFix(f, WALK, false));
  fold(f);
  held(f);
  harnessFix(f, 'src/other.txt', false);
  fold(f);
  owed(f);
});

test('a fix outside the lane scope reads as today, and its accept leaves out no file', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  const fix = harnessFix(f, 'harness.txt', false);
  const accepted = accept(f, fix);
  const lines = accepted.out.trim().split('\n');
  assert.equal(lines.length, 2, accepted.out);
  assert.equal(lines[0], `accepted smoke instrument red against harness fix ${short(fix)} for this tree`);
  fold(f);
  held(f);
});

test('a record the released flow wrote beside the proof holds for its own tree and retires on the fold', (t) => {
  const lib = require('./run-lib.cjs');
  const { laneProof } = require('./run-lanes.cjs');
  const { configuredLanes } = require('./run-lane-config.cjs');
  const f = fixture(t, config({ smoke: '11' }));
  const before = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = f.cache;
  t.after(() => {
    if (before === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = before;
  });
  redLane(f);
  const fix = harnessFix(f, WALK, false);
  const loaded = lib.readConfig(f.tree);
  const { file, ...identity } = laneProof(f.tree, null, configuredLanes(loaded).find((lane) => lane.name === 'smoke'), loaded);
  const last = JSON.parse(fs.readFileSync(path.join(cacheOf(f), 'lane-smoke-job.result.json'), 'utf8'));
  const record = { ...identity, run: last.run, code: 11, stamp: new Date().toISOString(), branch: BRANCH };
  writeFile(`${file}.instrument-red`, `${JSON.stringify(record)}\n`);
  owed(f);
  writeFile(`${file}.instrument-red`, `${JSON.stringify({ ...record, harness_fix: fix })}\n`);
  held(f);
  fold(f);
  owed(f);
});

test('the accept names every file of the scope the fix changed, and accept_check sees the fix sha', (t) => {
  const f = fixture(t, config({ smoke: '11' }, [whole], ['src/**'], { smoke: { accept_check: 'node check.cjs 0' } }));
  redLane(f);
  const fix = harnessFix(f, [WALK, 'src/cart.txt', 'docs/walk.txt'], false);
  assert.match(accept(f, fix).out, unwalked(fix, ['src/cart.txt', WALK]));
  assert.ok(fs.readFileSync(f.checkEnv, 'utf8').split('\n').includes(`INFERNO_HARNESS_FIX=${fix}`));
  fold(f);
  held(f);
});

test('a merge as the fix leaves out no file and says so, and the commit it merged accepts', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  git(f.tree, 'checkout', '-qb', 'walk-fix', 'main');
  write(f.tree, WALK, 'fixed\n');
  commit(f.tree, 'harness fix');
  const inner = git(f.tree, 'rev-parse', 'HEAD');
  git(f.tree, 'checkout', '-q', 'main');
  git(f.tree, 'merge', '-q', '--no-ff', '-m', 'merge the harness fix', 'walk-fix');
  const merge = git(f.tree, 'rev-parse', 'HEAD');
  git(f.tree, 'checkout', '-q', BRANCH);
  const accepted = accept(f, merge);
  assert.match(accepted.out, new RegExp(`^harness fix ${short(merge)} is a merge, so the accept leaves out no file: ` +
    'accept the commit that changed the harness to hold through the fold$', 'm'));
  assert.doesNotMatch(accepted.out, /leaves unwalked/);
  fold(f);
  owed(f);
  assert.match(accept(f, inner).out, unwalked(inner, [WALK]));
  held(f);
});

test('a merge whose change lies outside the lane scope accepts as today, with no line on it', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  git(f.tree, 'checkout', '-qb', 'docs-fix', 'main');
  write(f.tree, 'harness.txt', 'fixed\n');
  commit(f.tree, 'harness fix');
  git(f.tree, 'checkout', '-q', 'main');
  git(f.tree, 'merge', '-q', '--no-ff', '-m', 'merge the harness fix', 'docs-fix');
  const merge = git(f.tree, 'rev-parse', 'HEAD');
  git(f.tree, 'checkout', '-q', BRANCH);
  assert.doesNotMatch(accept(f, merge).out, /is a merge|leaves unwalked/);
  fold(f);
  held(f);
});

test('a commit of the branch to the fixed file retires the accept', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  accept(f, harnessFix(f, WALK, false));
  fold(f);
  held(f);
  write(f.tree, WALK, 'changed on the branch\n');
  commit(f.tree, 'branch change');
  owed(f);
});

test('the same change brought in by a cherry-pick, not the fix itself, retires the accept', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  const fix = harnessFix(f, WALK, false);
  accept(f, fix);
  git(f.tree, 'cherry-pick', fix);
  owed(f);
});

test('a second accept against another fix replaces the first, so the fold of both retires it', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  accept(f, harnessFix(f, WALK, false));
  const second = harnessFix(f, 'src/other.txt', false);
  assert.match(accept(f, second).out, unwalked(second, ['src/other.txt']));
  fold(f);
  owed(f);
});

test('a fixed file left dirty in the tree retires the accept in gate --wait', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  accept(f, harnessFix(f, WALK, false));
  fold(f);
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  write(f.tree, WALK, 'edited, not committed\n');
  const wait = run(f, 'gate', '--wait', '--minutes', '0.5');
  assert.equal(wait.code, 3, wait.out + wait.err);
  assert.match(wait.out, /^INSTRUMENT RED lane smoke \(exit 11\)/m);
});

test('the fold-first accept refuses a tree that differs by more than the fix', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  const fix = harnessFix(f, WALK, false);
  harnessFix(f, 'src/other.txt', false);
  fold(f);
  const refused = run(f, 'smoke', '--accept', '--harness-fix', fix);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /no instrument red of the smoke lane on this tree to accept/);
});

test('the fold-first accept refuses a lane result that names no walked head, or a head it did not walk', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  const walked = git(f.tree, 'rev-parse', 'HEAD');
  const fix = harnessFix(f, WALK, false);
  fold(f);
  const file = path.join(cacheOf(f), 'lane-smoke-job.result.json');
  const last = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(last.head, walked);
  for (const result of [{ ...last, head: undefined }, { ...last, head: git(f.tree, 'rev-parse', 'main') }]) {
    writeFile(file, `${JSON.stringify(result)}\n`);
    const refused = run(f, 'smoke', '--accept', '--harness-fix', fix);
    assert.equal(refused.code, 2, refused.out + refused.err);
    assert.match(refused.err, /no instrument red of the smoke lane on this tree to accept/);
  }
  writeFile(file, `${JSON.stringify(last)}\n`);
  accept(f, fix);
});

test('an accept holds only under the lane command and the config it was accepted under', (t) => {
  const f = fixture(t, config({ smoke: '11' }));
  redLane(f);
  accept(f, harnessFix(f, WALK, false));
  fold(f);
  held(f);
  const source = fs.readFileSync(path.join(f.tree, '.specs-inferno/config.yaml'), 'utf8');
  write(f.tree, '.specs-inferno/config.codex.yaml', source);
  commit(f.tree, 'a second config');
  const other = run(f, 'green', '--json', '--config', '.specs-inferno/config.codex.yaml');
  assert.equal(other.code, 3, other.out + other.err);
  assert.deepEqual(JSON.parse(other.out).owed, ['smoke']);
  write(f.tree, '.specs-inferno/config.yaml', source.replace('command: node lane.cjs smoke', 'command: node ./lane.cjs smoke'));
  commit(f.tree, 'the lane command changed');
  owed(f);
});
