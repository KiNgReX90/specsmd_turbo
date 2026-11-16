'use strict';

// A rule file under .specs-inferno/standards/ is the project's product, written by a work item,
// and everything else under .specs-inferno/ is the ledger. This suite follows an item that owns a
// rule file through its build: the ledger test itself, the dispatch's ownership, verify-item's
// proof, the review dispatch's paths line, a builder's escape into a rule file and a grant of one.
// Its review (a mutant, a pin, the files a review binds): run-standards-review.test.cjs. The
// intent's own reads (the tree hash, the intent review, the readers beside): run-standards-intent.test.cjs.

const assert = require('node:assert/strict');
const test = require('node:test');

const lib = require('./run-lib.cjs');
const { fixture } = require('./run-attribution-fixture.cjs');
const { proofPath, readItemProof } = require('./run-item-proof.cjs');
const { STANDARDS_DIR } = require('./run-standards.cjs');
const { RULE: DEFER_RULE } = require('./state-defer-finding.cjs');

const RULE = '.specs-inferno/standards/tooling.md';
const LOCK = `${JSON.stringify({ flow: 'inferno', rules: { review: '2026-09-20T00:00:00.000Z' }, files: {} })}\n`;

test('the ledger is .specs-inferno/ but for its standards folder, where the project keeps its rule files', () => {
  assert.equal(lib.STANDARDS_DIR, STANDARDS_DIR, 'the standards block and the ledger test name one folder');
  for (const file of ['.specs-inferno', '.specs-inferno/state.yaml', '.specs-inferno/config.yaml', '.specs-inferno/intents/alpha/brief.md',
    '.specs-inferno/intents/alpha/reviews/a.yaml', '.specs-inferno/archive/state.yaml', '.specs-inferno/standardsx/a.md']) {
    assert.equal(lib.inLedger(file), true, file);
  }
  for (const file of [RULE, '.specs-inferno/standards/defer-findings.yml', '.specs-inferno/standards', 'src/a.ts', 'standards/a.md']) {
    assert.equal(lib.inLedger(file), false, file);
  }
});

test('the defer rule in the standards folder is the flow\'s own policy and stays ledger, as config.yaml does', () => {
  assert.equal(lib.DEFER_RULE, DEFER_RULE, 'the ledger test and the defer writer name one file');
  assert.equal(lib.inLedger(DEFER_RULE), true);
  assert.equal(lib.inStandards(DEFER_RULE), false);
  assert.equal(lib.inStandards(RULE), true);
});

/** Items on an intent branch, with the review cutover recorded and the proof read from the fixture's cache. */
function setup(t, items) {
  const f = fixture(t, items);
  const before = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = f.cache;
  t.after(() => {
    if (before === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = before;
  });
  f.write('.specsmd/inferno/flow.lock', LOCK);
  f.land('.specsmd/inferno/flow.lock');
  return f;
}

const short = (f, ref) => f.git('rev-parse', '--short', ref);
const review = (f) => f.human('review', '--item', 'a', '--tree', f.root);

test('an item that owns a rule file proves it: verify-item lists it, the review reads it, and a later edit of it alone owes a new proof', (t) => {
  const f = setup(t, { a: { editable: [RULE, 'a.cjs'], check: 'node -e "0"' } });
  const baseline = f.git('rev-parse', 'HEAD');
  const dispatch = f.start('--item', 'a');
  f.write(RULE, '# Tooling\n\n## Search\n\nA structural search reads the syntax tree.\n');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(dispatch, [RULE, 'a.cjs']);
  const verified = f.verify('a');
  assert.equal(verified.code, 0, verified.out);
  assert.deepEqual(verified.data.outside, []);
  assert.deepEqual(readItemProof(f.root, 'alpha', 'a').diff.paths, [RULE, 'a.cjs']);
  f.land(RULE, 'a.cjs');

  const first = review(f);
  assert.equal(first.code, 3, first.out);
  assert.match(first.out, new RegExp(`^  range ${short(f, baseline)}\\.\\.${short(f, 'HEAD')} paths ${RULE} a\\.cjs$`, 'm'));
  assert.match(first.out, new RegExp(`^  proof ${proofPath(f.root, 'alpha', 'a')}$`, 'm'));

  f.write(RULE, '# Tooling\n\n## Search\n\nA text search is enough.\n');
  f.land(RULE);
  const stale = review(f);
  assert.equal(stale.code, 3, stale.out);
  assert.match(stale.out, /^verify-item owed for a before its review/m);
});

test('a builder that writes a rule file its item does not own has it named outside, as any other file', (t) => {
  const f = setup(t, { a: { editable: ['a.cjs'], check: 'node -e "0"' } });
  const dispatch = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(dispatch, ['a.cjs']);
  assert.deepEqual(f.verify('a').data.outside, []);
  f.write(RULE, '# Tooling\n');
  f.write('.specs-inferno/intents/alpha/notes.md', 'the ledger is no builder escape\n');
  const escaped = f.verify('a');
  assert.equal(escaped.code, 2, escaped.out);
  assert.deepEqual(escaped.data.outside, [RULE]);
  const since = f.verify('a', '--since', f.git('rev-parse', 'HEAD'));
  assert.equal(since.code, 2, since.out);
  assert.deepEqual(since.data.outside, [RULE]);
});

test('a rule file may be granted to a builder, and the ledger beside it still may not', (t) => {
  const f = setup(t, { a: { editable: ['a.cjs'], check: 'node -e "0"' } });
  const dispatch = f.start('--item', 'a');
  const granted = f.call('grant', dispatch, '--path', RULE, '--tree', f.root);
  assert.equal(granted.code, 0, granted.out);
  assert.deepEqual(granted.data.granted.map((entry) => entry.path), [RULE]);
  const refused = f.call('grant', dispatch, '--path', '.specs-inferno/config.yaml', '--tree', f.root);
  assert.equal(refused.code, 2, refused.out);
  assert.match(refused.out, /ledger/);
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write(RULE, '# Tooling\n');
  f.accepted(dispatch, ['a.cjs', RULE]);
  const verified = f.verify('a');
  assert.equal(verified.code, 0, verified.out);
  assert.deepEqual(readItemProof(f.root, 'alpha', 'a').diff.paths, [RULE, 'a.cjs']);
});

test('the defer rule beside a rule file is in no proof and no review paths, and an edit of it alone leaves the proof current', (t) => {
  const f = setup(t, { a: { editable: [RULE, DEFER_RULE, 'a.cjs'], check: 'node -e "0"' } });
  const dispatch = f.start('--item', 'a');
  f.write(RULE, '# Tooling\n\nSearch by syntax.\n');
  f.write(DEFER_RULE, 'survivors: true\n');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(dispatch, [RULE, DEFER_RULE, 'a.cjs']);
  const verified = f.verify('a');
  assert.equal(verified.code, 0, verified.out);
  assert.deepEqual(readItemProof(f.root, 'alpha', 'a').diff.paths, [RULE, 'a.cjs']);
  f.land(RULE, DEFER_RULE, 'a.cjs');
  const first = review(f);
  assert.match(first.out, new RegExp(`^  range \\S+ paths ${RULE} a\\.cjs$`, 'm'));

  f.write(DEFER_RULE, 'survivors: false\n');
  f.land(DEFER_RULE);
  const kept = review(f);
  assert.equal(kept.code, 3, kept.out);
  assert.match(kept.out, new RegExp(`^  proof ${proofPath(f.root, 'alpha', 'a')}$`, 'm'));
  assert.doesNotMatch(kept.out, /verify-item owed/);
});

test('the defer rule may not be granted, and a rule file beside it may', (t) => {
  const f = setup(t, { a: { editable: ['a.cjs'], check: 'node -e "0"' } });
  const dispatch = f.start('--item', 'a');
  const refused = f.call('grant', dispatch, '--path', DEFER_RULE, '--tree', f.root);
  assert.equal(refused.code, 2, refused.out);
  assert.match(refused.out, /ledger/);
  assert.equal(f.call('grant', dispatch, '--path', RULE, '--tree', f.root).code, 0);
});
