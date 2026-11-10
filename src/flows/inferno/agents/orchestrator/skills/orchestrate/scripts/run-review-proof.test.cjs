'use strict';

// The item review's dispatch names the proof verify-item wrote, and only a proof taken over the
// state the reviewer reads: the item's paths as HEAD holds them. A proof of an older state is
// never named, and the review stops on the verify-item call that writes a current one. With no
// proof at all, as on a tree verified by the released flow, the dispatch goes out without the
// line. A first review reads the range and paths the proof's own diff names; a delta review
// keeps the range from the commit the last review read. The proof itself: run-item-proof.test.cjs.

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');
const { proofPath } = require('./run-item-proof.cjs');
const { writeFile } = require('./test-write.cjs');

const RUN = path.join(__dirname, 'run.cjs');
const ITEM_REVIEW = (id) => `.specs-inferno/intents/alpha/reviews/${id}.yaml`;
const LOCK = `${JSON.stringify({ flow: 'inferno', rules: { review: '2026-09-20T00:00:00.000Z' }, files: {} })}\n`;

/** Items a and b on an intent branch, with a sibling's commit on it first, so the fork point is not the item's baseline. */
function setup(t) {
  const f = fixture(t, { a: { editable: ['a.cjs', 'a.test.cjs', 'a2.cjs'], check: 'node -e "0"' }, b: ['b.cjs'] });
  // proofPath reads the cache from the environment, as the runner's own process does.
  const before = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = f.cache;
  t.after(() => {
    if (before === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = before;
  });
  f.write('.specsmd/inferno/flow.lock', LOCK);
  f.write('other.cjs', 'a sibling landed first\n');
  f.land('.specsmd/inferno/flow.lock', 'other.cjs');
  return f;
}

const short = (f, ref) => f.git('rev-parse', '--short', ref);
const review = (f, id = 'a') => f.human('review', '--item', id, '--tree', f.root);
const payload = (f, id = 'a') => f.call('review', '--item', id, '--tree', f.root).data;

/** One build of `id` the way the orchestrator runs it: dispatch-log, the work, accept-dispatch, verify-item unless told not to, the commit. */
function build(f, selector, files, { verify = true } = {}) {
  const dispatch = f.start(...selector);
  for (const [file, body] of Object.entries(files)) f.write(file, body);
  f.accepted(dispatch, Object.keys(files));
  if (verify) {
    const verified = f.verify(...(selector[0] === '--items' ? selector : [selector[1]]));
    assert.equal(verified.code, 0, verified.out);
  }
  f.land(...Object.keys(files));
  return dispatch;
}

/** The lines of the dispatch block, from its dispatch line to its write line. */
function block(out) {
  const lines = out.split('\n');
  const at = lines.findIndex((line) => line.startsWith('dispatch '));
  assert.ok(at >= 0, out);
  return lines.slice(at, lines.findIndex((line, index) => index > at && line.startsWith('  write ')) + 1);
}

/** The verify-item call a review printed, run as printed from the project root. */
function runPrintedVerify(f, out) {
  const match = /\brun\.cjs (verify-item [^\n,]*?)(?:, then|$)/m.exec(out);
  assert.ok(match, out);
  const argv = match[1].split(' ');
  const result = spawnSync(process.execPath, [RUN, ...argv], {
    cwd: f.root, encoding: 'utf8', env: { ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache },
  });
  assert.equal(result.status, 0, `${argv.join(' ')}\n${result.stdout}${result.stderr}`);
  return argv;
}

function writeProof(f, id, proof) {
  const file = proofPath(f.root, 'alpha', id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFile(file, `${JSON.stringify(proof)}\n`);
}

test('a current proof is named in the dispatch and the payload, and a first review reads the range and paths of its diff', (t) => {
  const f = setup(t);
  const baseline = f.git('rev-parse', 'HEAD');
  build(f, ['--item', 'a'], { 'a.cjs': 'module.exports = 2;\n' });
  const result = review(f);
  assert.equal(result.code, 3, result.out);
  const file = proofPath(f.root, 'alpha', 'a');
  const range = `${short(f, baseline)}..${short(f, 'HEAD')}`;
  assert.deepEqual(block(result.out).slice(0, 3), ['dispatch specsmd-inferno-reviewer item a', `  range ${range} paths a.cjs`, `  proof ${file}`]);
  assert.doesNotMatch(result.out, /^no proof /m);
  const data = payload(f);
  assert.equal(data.proof, file);
  assert.equal(data.range, range);
  assert.deepEqual(data.paths, ['a.cjs']);
});

test('a proof of an older state is never named: the review stops on the verify-item call, and as printed it writes a current one', (t) => {
  const f = setup(t);
  const baseline = f.git('rev-parse', 'HEAD');
  build(f, ['--item', 'a'], { 'a.cjs': 'module.exports = 2;\n' });
  build(f, ['--item', 'a'], { 'a.cjs': 'module.exports = 3;\n' }, { verify: false });
  const stale = review(f);
  const file = proofPath(f.root, 'alpha', 'a');
  assert.equal(stale.code, 3, stale.out);
  assert.doesNotMatch(stale.out, /^dispatch |^ {2}proof /m);
  assert.match(stale.out, new RegExp(`^verify-item owed for a before its review: its proof ${file} was taken over an older state`, 'm'));
  assert.match(stale.out, new RegExp(`^then run\\.cjs verify-item a --tree ${f.root}, then run\\.cjs review --item a --tree ${f.root}$`, 'm'));
  const data = payload(f);
  assert.equal(data.ok, false);
  assert.equal(data.owed, 'verify-item');
  assert.equal(data.proof, null);
  assert.equal(data.stale, file);
  assert.equal(data.verify, `run.cjs verify-item a --tree ${f.root}`);

  runPrintedVerify(f, stale.out);
  const named = review(f);
  assert.equal(named.code, 3, named.out);
  assert.deepEqual(block(named.out).slice(1, 3), [`  range ${short(f, baseline)}..${short(f, 'HEAD')} paths a.cjs`, `  proof ${file}`]);
});

test('a path the item owns that changed after its proof and is not in it makes the proof one of an older state', (t) => {
  const f = setup(t);
  build(f, ['--item', 'a'], { 'a.cjs': 'module.exports = 2;\n' });
  f.write('a2.cjs', 'module.exports = 2;\n');
  f.land('a2.cjs');
  const result = review(f);
  assert.equal(result.code, 3, result.out);
  assert.match(result.out, /^verify-item owed for a before its review/m);
  assert.doesNotMatch(result.out, /^dispatch /m);
});

test("a single item's proof keeps a path its dispatch claimed outside the item's ownership in the first review's paths", (t) => {
  const f = setup(t);
  const baseline = f.git('rev-parse', 'HEAD');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('other.cjs', 'claimed by the dispatch of a\n');
  f.land('a.cjs', 'other.cjs');
  const diff = f.git('diff', '--full-index', '--binary', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv',
    '--src-prefix=a/', '--dst-prefix=b/', baseline, 'HEAD', '--', 'a.cjs', 'other.cjs');
  const sha256 = createHash('sha256').update(`${diff}\n`).digest('hex');
  writeProof(f, 'a', { item: 'a', intent: 'alpha', items: ['a'], passed: true, diff: { from: baseline, paths: ['a.cjs', 'other.cjs'], sha256 } });
  const result = review(f);
  assert.equal(result.code, 3, result.out);
  assert.equal(block(result.out)[1], `  range ${short(f, baseline)}..${short(f, 'HEAD')} paths a.cjs other.cjs`);
});

test('a proof whose baseline is no commit of the repository is one of an older state', (t) => {
  const f = setup(t);
  writeProof(f, 'a', { item: 'a', intent: 'alpha', items: ['a'], diff: { from: 'f'.repeat(40), paths: [], sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' } });
  const result = review(f);
  assert.equal(result.code, 3, result.out);
  assert.match(result.out, /^verify-item owed for a before its review/m);
});

test('without a proof the dispatch names none, keeps the fork point and the editable paths, and says which call writes one', (t) => {
  const f = setup(t);
  const fork = f.git('merge-base', 'HEAD', 'main');
  build(f, ['--item', 'a'], { 'a.cjs': 'module.exports = 2;\n' }, { verify: false });
  const check = (label) => {
    const result = review(f);
    assert.equal(result.code, 3, `${label}\n${result.out}`);
    const lines = block(result.out);
    assert.equal(lines[1], `  range ${short(f, fork)}..${short(f, 'HEAD')} paths a.cjs a.test.cjs a2.cjs`, label);
    assert.ok(!lines.some((line) => line.startsWith('  proof ')), `${label}\n${result.out}`);
    assert.match(result.out, new RegExp(`^no proof for a, so its reviewer runs the item's tests itself: run\\.cjs verify-item a --tree ${f.root} writes one, and review again names it$`, 'm'), label);
    assert.equal(payload(f).proof, null, label);
  };
  check('no proof file');
  // A proof whose baseline named no commit carries no diff: it proves nothing about these paths.
  writeProof(f, 'a', { item: 'a', intent: 'alpha', items: ['a'], passed: true, diff: null, tests_changed: null });
  check('a proof with no diff');
});

test('a current proof with no paths is named, and the first review keeps the fork point and the editable paths', (t) => {
  const f = setup(t);
  const fork = f.git('merge-base', 'HEAD', 'main');
  build(f, ['--item', 'a'], { 'a.cjs': 'module.exports = 2;\n' }, { verify: false });
  assert.equal(f.verify('a', '--since', 'HEAD').code, 0);
  // A sibling's commit after the proof changes none of its paths, so the proof stays current.
  f.write('b.cjs', 'module.exports = 2;\n');
  f.land('b.cjs');
  const result = review(f);
  assert.equal(result.code, 3, result.out);
  assert.deepEqual(block(result.out).slice(1, 3), [
    `  range ${short(f, fork)}..${short(f, 'HEAD')} paths a.cjs a.test.cjs a2.cjs`, `  proof ${proofPath(f.root, 'alpha', 'a')}`,
  ]);
});

test('a delta review keeps the range from the commit the last review read and its paths, and names the proof of the fix', (t) => {
  const f = setup(t);
  build(f, ['--item', 'a'], { 'a.cjs': 'module.exports = 2;\n' });
  assert.equal(review(f).code, 3);
  f.write(ITEM_REVIEW('a'), 'item: a\nverdict: fix\nfiles: [a.cjs]\nfindings:\n  - criterion: AC1 it reads three\n    file: a.cjs\n' +
    '    line: 1\n    evidence: read a.cjs, it exports 2\n    fix: export 3\n    severity: major\n');
  // a.cjs is production code, so the quality lens was dispatched beside the contract lens and wrote its file too.
  f.write('.specs-inferno/intents/alpha/reviews/quality/a.yaml', 'item: a\nverdict: clean\nfiles: [a.cjs]\n');
  const read = f.git('rev-parse', 'HEAD');
  const recorded = f.human('review', '--item', 'a', '--tree', f.root, '--reviewer', 'rev-1', '--quality-reviewer', 'rev-q');
  assert.equal(recorded.code, 2, recorded.out);

  build(f, ['--item', 'a'], { 'a.cjs': 'module.exports = 3;\n' }, { verify: false });
  const stale = review(f);
  assert.equal(stale.code, 3, stale.out);
  assert.match(stale.out, /^verify-item owed for a before its review/m, 'the proof of the first round is not the fix');

  assert.equal(f.verify('a').code, 0);
  const delta = review(f);
  assert.equal(delta.code, 3, delta.out);
  const range = `${short(f, read)}..${short(f, 'HEAD')}`;
  assert.deepEqual(block(delta.out).slice(1, 4), [`  previous ${ITEM_REVIEW('a')}`, `  range ${range} paths a.cjs`, `  proof ${proofPath(f.root, 'alpha', 'a')}`]);
  const data = payload(f);
  assert.equal(data.range, range);
  assert.deepEqual(data.paths, ['a.cjs']);
  assert.equal(data.proof, proofPath(f.root, 'alpha', 'a'));
});

test("a batch's proof gives each item's review only that item's paths, and its stale stop verifies the batch", (t) => {
  const f = setup(t);
  const baseline = f.git('rev-parse', 'HEAD');
  build(f, ['--items', 'a,b'], { 'a.cjs': 'module.exports = 2;\n', 'b.cjs': 'module.exports = 2;\n' });
  const result = review(f);
  assert.equal(result.code, 3, result.out);
  assert.deepEqual(block(result.out).slice(1, 3), [`  range ${short(f, baseline)}..${short(f, 'HEAD')} paths a.cjs`, `  proof ${proofPath(f.root, 'alpha', 'a')}`]);
  const other = review(f, 'b');
  assert.equal(other.code, 3, other.out);
  assert.equal(block(other.out)[1], `  range ${short(f, baseline)}..${short(f, 'HEAD')} paths b.cjs`);

  f.write('b.cjs', 'module.exports = 3;\n');
  f.land('b.cjs');
  const stale = review(f);
  assert.equal(stale.code, 3, stale.out);
  assert.match(stale.out, new RegExp(`^then run\\.cjs verify-item --items a,b --tree ${f.root}, then run\\.cjs review --item a --tree `, 'm'));
});
