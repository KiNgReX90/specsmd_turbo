'use strict';

// A path the range deleted is gone, never read. Every item review dispatch, a first review and a
// delta, in both lenses, names it under `gone` and leaves it out of `paths`, of the range line, of
// the paths file a long list goes to and of the rule files the quality lens is sent. The reviewer
// copies `paths` into `files` and the record takes it, for an item that only deletes too, whose
// dispatch has no path left and whose reviewers write `files: []`. An owned path the item never
// wrote is no deletion and stays under `paths`. Deltas whose listed files left the tree:
// run-review-gone.test.cjs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const { fixture } = require('./run-attribution-fixture.cjs');
const { CONFIG, git, write } = require('./review-fixture.cjs');
const { block, contractFix, firstRound, host, qualityFix } = require('./run-review-quality-fixture.cjs');
const { filesHash } = require('./run-review-hash.cjs');
const { owedReviews } = require('./run-review.cjs');
const { splitGone } = require('./run-review-span.cjs');
const { tempDir } = require('./test-temp.cjs');
const lib = require('./run-lib.cjs');

const RUN = path.join(__dirname, 'run.cjs');
const LOCK = `${JSON.stringify({ flow: 'inferno', rules: { review: '2026-09-20T00:00:00.000Z' }, files: {} })}\n`;
const REVIEW = '.specs-inferno/intents/alpha/reviews/a.yaml';
const QUALITY = '.specs-inferno/intents/alpha/reviews/quality/a.yaml';
const BALANCE = 'cards/balance.cjs';
const REFUND = 'cards/refund.cjs';
const LENSES = ['specsmd-inferno-reviewer', 'specsmd-inferno-reviewer-quality'];
const NONE = 'files must list every file the review read for this item';
const QUALITY_ONE = '.specs-inferno/intents/alpha/reviews/quality/a-one.yaml';

/** Item a of a gift card shop owns the cards folder and a.cjs; the fixture writes two card modules on the base. */
function setup(t) {
  const f = fixture(t, { a: { editable: ['cards/', 'a.cjs', BALANCE, REFUND], check: 'node -e "0"' } });
  f.write('.specsmd/inferno/flow.lock', LOCK);
  f.land('.specsmd/inferno/flow.lock');
  return f;
}

/** One builder turn on item a: it deletes `removed`, writes `edits`, reports both, verify-item proves it, and it is committed. */
function build(f, removed, edits = {}) {
  const dispatch = f.start('--item', 'a');
  for (const file of removed) f.git('rm', '-q', file);
  for (const [file, body] of Object.entries(edits)) f.write(file, body);
  f.accepted(dispatch, [...removed, ...Object.keys(edits)]);
  const verified = f.verify('a');
  assert.equal(verified.code, 0, verified.out);
  f.git('add', '-A');
  f.git('commit', '-qm', 'item a built');
}

const owed = (f) => f.call('review', '--item', 'a', '--tree', f.root).data;
const printed = (f) => f.human('review', '--item', 'a', '--tree', f.root).out;
const record = (f) => f.human('review', '--item', 'a', '--tree', f.root, '--reviewer', 'rev-1', '--quality-reviewer', 'rev-q');
const ledger = (f) => f.git('show', 'HEAD:.specs-inferno/state.yaml');

/** Both review files, each listing exactly the paths its own dispatch printed. */
function copied(f, data, verdict = 'clean', findings = '') {
  f.write(REVIEW, `item: a\nverdict: ${verdict}\nfiles: [${data.paths.join(', ')}]\n${findings}`);
  f.write(QUALITY, `item: a\nverdict: clean\nfiles: [${data.quality.paths.join(', ')}]\n`);
}

const REFUND_FINDING = `findings:
  - criterion: AC1 the refund module goes
    file: ${REFUND}
    line: 1
    evidence: read ${REFUND}, it still exports the refund
    fix: delete ${REFUND}
    severity: major
`;

test('a first review of an item that deletes one file and changes another names the deletion gone in both lenses, and the files copied from paths record', (t) => {
  const f = setup(t);
  build(f, [BALANCE], { 'a.cjs': 'module.exports = 2;\n' });

  const data = owed(f);
  for (const lens of [data, data.quality]) {
    assert.deepEqual(lens.paths, ['a.cjs']);
    assert.deepEqual(lens.gone, [BALANCE]);
  }
  const out = printed(f);
  for (const agent of LENSES) {
    assert.deepEqual(block(out, agent).slice(1, 3), [
      `  range ${data.range} paths a.cjs`,
      `  gone ${BALANCE}: the range deleted it, so read the removal in the range and leave it out of files`,
    ]);
  }
  copied(f, data);
  const recorded = record(f);
  assert.equal(recorded.code, 0, recorded.out);
  assert.match(ledger(f), /review: clean/);
});

test('a first review of an item that moves a file names the path it left gone and reads the path it took', (t) => {
  const f = setup(t);
  const dispatch = f.start('--item', 'a');
  f.git('mv', BALANCE, 'cards/wallet.cjs');
  f.accepted(dispatch, [BALANCE, 'cards/wallet.cjs']);
  assert.equal(f.verify('a').code, 0);
  f.git('commit', '-qam', 'item a moved the balance');

  const data = owed(f);
  assert.deepEqual([data.paths, data.gone], [['cards/wallet.cjs'], [BALANCE]]);
});

test('a correction that deletes a file the first review listed leaves it out of the delta paths, names it gone, and the delta records', (t) => {
  const f = setup(t);
  build(f, [BALANCE], { 'a.cjs': 'module.exports = 2;\n', [REFUND]: 'module.exports = 2;\n' });
  const first = owed(f);
  assert.deepEqual(first.paths, ['a.cjs', REFUND]);
  copied(f, first, 'fix', REFUND_FINDING);
  const fix = record(f);
  assert.equal(fix.code, 2, fix.out);

  build(f, [REFUND]);
  const delta = owed(f);
  assert.deepEqual([delta.previous, delta.quality.previous], [REVIEW, QUALITY]);
  for (const lens of [delta, delta.quality]) {
    assert.deepEqual(lens.paths, ['a.cjs']);
    assert.deepEqual(lens.gone, [REFUND]);
  }
  copied(f, delta);
  const recorded = record(f);
  assert.equal(recorded.code, 0, recorded.out);
  assert.match(ledger(f), /review: clean/);
});

test('an item that only deletes gets a dispatch with no paths, its reviewers write files: [], the record takes it, and the stored review reads as current', (t) => {
  const f = setup(t);
  build(f, [BALANCE, REFUND]);

  const data = owed(f);
  for (const lens of [data, data.quality]) {
    assert.deepEqual(lens.paths, []);
    assert.deepEqual(lens.gone, [BALANCE, REFUND]);
  }
  const out = printed(f);
  for (const agent of LENSES) {
    assert.deepEqual(block(out, agent).slice(1, 3), [
      `  range ${data.range} paths none: every path is gone, so write files: []`,
      `  gone ${BALANCE} ${REFUND}: the range deleted them, so read the removal in the range and leave them out of files`,
    ]);
  }
  copied(f, data);
  assert.match(fs.readFileSync(path.join(f.root, REVIEW), 'utf8'), /^files: \[\]$/m);
  const recorded = record(f);
  assert.equal(recorded.code, 0, recorded.out);
  assert.equal(f.git('status', '--porcelain'), '', 'the note of the dispatch stays outside the tree');
  assert.match(ledger(f), /review: clean/);
  assert.equal(/review_hash: ([0-9a-f]{64})/.exec(ledger(f))[1], filesHash(f.root, []));
  const again = f.human('review', '--item', 'a', '--tree', f.root);
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /^review a clean for the current files/m);

  // A machine whose cache never saw the dispatch reads the stored review as current all the same.
  const elsewhere = tempDir('inferno-gone-cache-');
  const fresh = spawnSync(process.execPath, [RUN, 'review', '--item', 'a', '--tree', f.root],
    { cwd: f.root, encoding: 'utf8', env: { ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: elsewhere } });
  assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
  const before = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = elsewhere;
  t.after(() => {
    if (before === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = before;
  });
  assert.deepEqual(owedReviews(f.root, lib.readLedger(f.root), ['a'], {}), []);
});

test('files: [] is refused once a later dispatch of the item printed paths again', (t) => {
  const f = setup(t);
  build(f, [BALANCE, REFUND]);
  assert.deepEqual(owed(f).paths, []);
  build(f, [], { 'cards/voucher.cjs': 'module.exports = 3;\n' });
  const data = owed(f);
  assert.deepEqual([data.paths, data.quality.paths], [['cards/voucher.cjs'], ['cards/voucher.cjs']]);

  copied(f, { paths: [], quality: { paths: [] } });
  const refused = record(f);
  assert.equal(refused.code, 2, refused.out);
  assert.match(refused.out, new RegExp(`BAD_REVIEW.*${NONE}`));
});

test('files: [] is refused after a dispatch that reads the whole range, since nothing is gone', () => {
  const h = host({ editable: [] });
  const owing = h.review();
  assert.match(owing.out, /^ {2}range \S+ paths \(the whole range\)$/m);
  assert.doesNotMatch(owing.out, /^ {2}gone /m);
  write(h.tree, '.specs-inferno/intents/alpha/reviews/a-one.yaml', 'item: a-one\nverdict: clean\nfiles: []\n');
  const refused = h.at(['review', '--item', 'a-one', '--reviewer', 'rev-1']);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, new RegExp(`BAD_REVIEW.*${NONE}`));
});

test('a long list goes to the paths file without the deleted path, and the range line counts only the paths that stand', (t) => {
  const f = setup(t);
  const added = Object.fromEntries(Array.from({ length: 41 }, (_, n) => [`cards/card-${String(n).padStart(2, '0')}.cjs`, `module.exports = ${n};\n`]));
  build(f, [BALANCE], added);

  const data = owed(f);
  assert.deepEqual([data.paths.length, data.gone], [41, [BALANCE]]);
  assert.deepEqual(fs.readFileSync(data.paths_file, 'utf8').split('\n').filter(Boolean), Object.keys(added));
  assert.deepEqual(block(printed(f), 'specsmd-inferno-reviewer').slice(1, 3), [
    `  range ${data.range} paths 41, one per line in the paths-file below`, `  paths-file ${data.paths_file}`,
  ]);
});

// --- a first review with no proof reads the item's owned paths --------------------------------------

test('a first review with no proof names gone an owned path the range deleted and a folder it emptied, and keeps those the item never wrote', () => {
  // src/card is a folder the item may write; the deleted src/cards.ts only shares the start of its name.
  const editable = ['src/a.ts', 'src/a2.test.ts', 'src/card', 'src/cards.ts', 'src/older/'];
  const h = host({ editable, files: { 'src/cards.ts': 'export const cards = 1;\n', 'src/older/x.ts': 'export const x = 1;\n' } });
  git(h.tree, ['rm', '-q', 'src/cards.ts', 'src/older/x.ts']);
  git(h.tree, ['commit', '-qm', 'the item drops the old card modules']);

  const data = JSON.parse(h.review(['--json']).out);
  for (const lens of [data, data.quality]) {
    assert.equal(lens.previous, null);
    assert.deepEqual(lens.paths, ['src/a.ts', 'src/a2.test.ts', 'src/card']);
    assert.deepEqual(lens.gone, ['src/cards.ts', 'src/older/']);
  }
});

test('the quality lens reading the whole item from its fork point beside a contract delta names the deletion gone too', () => {
  const h = host({ editable: ['src/a.ts', 'src/old/legacy.ts'], files: { 'src/old/legacy.ts': 'export const legacy = 1;\n' } });
  git(h.tree, ['rm', '-q', 'src/old/legacy.ts']);
  git(h.tree, ['commit', '-qm', 'the item drops the legacy module']);
  // The released flow dispatched one reviewer and recorded its file alone.
  write(h.tree, '.specs-inferno/intents/alpha/reviews/a-one.yaml', contractFix('major'));
  assert.equal(h.at(['review', '--item', 'a-one', '--reviewer', 'rev-1']).code, 2);
  write(h.tree, 'src/a.ts', 'export const a = 4;\n');
  git(h.tree, ['commit', '-qam', 'the fix']);

  const data = JSON.parse(h.review(['--json']).out);
  assert.deepEqual([data.paths, data.gone], [['src/a.ts'], []]);
  assert.equal(data.quality.previous, null);
  assert.deepEqual([data.quality.paths, data.quality.gone], [['src/a.ts'], ['src/old/legacy.ts']]);
});

test('each lens may list no file only when its own dispatch printed none: a contract delta with every path gone beside a quality lens that reads the whole item', () => {
  const h = host({ editable: ['src/a.ts', 'src/old/legacy.ts'], files: { 'src/old/legacy.ts': 'export const legacy = 1;\n' } });
  // The released flow dispatched one reviewer, and its file lists the legacy module alone.
  write(h.tree, '.specs-inferno/intents/alpha/reviews/a-one.yaml', contractFix('major', 'src/old/legacy.ts').replace('[src/a.ts]', '[src/old/legacy.ts]'));
  assert.equal(h.at(['review', '--item', 'a-one', '--reviewer', 'rev-1']).code, 2);
  git(h.tree, ['rm', '-q', 'src/old/legacy.ts']);
  git(h.tree, ['commit', '-qm', 'the fix drops the legacy module']);

  const data = JSON.parse(h.review(['--json']).out);
  assert.deepEqual([data.paths, data.gone], [[], ['src/old/legacy.ts']]);
  assert.deepEqual([data.quality.paths, data.quality.gone], [['src/a.ts'], ['src/old/legacy.ts']]);
  write(h.tree, '.specs-inferno/intents/alpha/reviews/a-one.yaml', 'item: a-one\nverdict: clean\nfiles: []\n');
  write(h.tree, QUALITY_ONE, 'item: a-one\nverdict: clean\nfiles: []\n');
  const refused = h.review();
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.ok(refused.err.includes(`[BAD_REVIEW] ${QUALITY_ONE}: ${NONE}`), refused.err);

  write(h.tree, QUALITY_ONE, 'item: a-one\nverdict: clean\nfiles: [src/a.ts]\n');
  const recorded = h.review();
  assert.equal(recorded.code, 0, recorded.out + recorded.err);
});

test('a delta whose review commit is no longer in the history names gone every listed path the tree lacks', () => {
  const h = host({ editable: ['src/a.ts', 'src/old/legacy.ts'], files: { 'src/old/legacy.ts': 'export const legacy = 1;\n' } });
  assert.equal(firstRound(h, contractFix().replace('[src/a.ts]', '[src/a.ts, src/old/legacy.ts]'), qualityFix()).code, 2);
  const state = path.join(h.tree, '.specs-inferno/state.yaml');
  write(h.tree, '.specs-inferno/state.yaml', fs.readFileSync(state, 'utf8').replace(/review_commit: [0-9a-f]+/, `review_commit: ${'d'.repeat(40)}`));
  git(h.tree, ['commit', '-qam', 'a ledger whose review commit is not in this history']);
  git(h.tree, ['rm', '-q', 'src/old/legacy.ts']);
  git(h.tree, ['commit', '-qm', 'the fix drops the legacy module']);

  const data = JSON.parse(h.review(['--json']).out);
  assert.match(data.range, /^d{7,}\.\./);
  assert.deepEqual([data.paths, data.gone], [['src/a.ts'], ['src/old/legacy.ts']]);
});

test('the quality lens is sent no rule file that applies only to a path the range deleted', () => {
  const config = `${CONFIG}standards:\n  - file: code.md\n    paths: ["src/**"]\n  - file: legacy.md\n    paths: ["legacy/**"]\n`;
  const files = { 'legacy/old.ts': 'export const old = 1;\n', '.specs-inferno/standards/legacy.md': '# Legacy\n\n## Names\n\nOld names stay.\n' };
  const h = host({ config, editable: ['src/a.ts', 'legacy/old.ts'], files });
  git(h.tree, ['rm', '-q', 'legacy/old.ts']);
  git(h.tree, ['commit', '-qm', 'the item drops the old module']);

  const data = JSON.parse(h.review(['--json']).out);
  assert.deepEqual(data.quality.gone, ['legacy/old.ts']);
  assert.deepEqual(data.quality.standards, ['.specs-inferno/standards/code.md']);
  assert.doesNotMatch(block(h.review().out, 'specsmd-inferno-reviewer-quality').join('\n'), /legacy\.md/);
});

test('a deleted path whose name git would quote or read as pathspec magic is gone all the same', () => {
  const h = host({ editable: ['src/'], files: { 'src/café.ts': 'export const cafe = 1;\n', ':memo.ts': 'export const memo = 1;\n' } });
  git(h.tree, ['--literal-pathspecs', 'rm', '-q', 'src/café.ts', ':memo.ts']);
  git(h.tree, ['commit', '-qm', 'the item drops two modules']);
  const fork = git(h.tree, ['merge-base', 'HEAD', 'main']);

  assert.deepEqual(splitGone(h.tree, fork, ['src/a.ts', 'src/café.ts', ':memo.ts']), { paths: ['src/a.ts'], gone: ['src/café.ts', ':memo.ts'] });
});
