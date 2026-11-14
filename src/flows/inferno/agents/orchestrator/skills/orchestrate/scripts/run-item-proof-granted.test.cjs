'use strict';

// A proof is of the state its review reads only when no file of the item changed since it outside
// its paths, and the item's files are those its review reads: its spec's, and every path a
// dispatch of it claimed or was granted (dispatchClaims in run-review-span.cjs). A granted file a
// correction commits after the proof makes the proof stale, so the review asks for verify-item
// again, and the proof that verify-item then writes is current. An item with no grant is read as
// before. The review side of the same set: run-review-granted.test.cjs.

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');
const { proofAtHead, proofPath } = require('./run-item-proof.cjs');

const LOCK = `${JSON.stringify({ flow: 'inferno', rules: { review: '2026-09-20T00:00:00.000Z' }, files: {} })}\n`;
const ITEMS = { a: { editable: ['a.cjs', 'a.test.cjs'], check: 'node -e "0"' }, b: { editable: ['b.cjs'], check: 'node -e "0"' } };
const GUARD = 'gift-card-guard.cjs';
const ITEM_REVIEW = (id) => `.specs-inferno/intents/alpha/reviews/${id}.yaml`;
const QUALITY = (id) => `.specs-inferno/intents/alpha/reviews/quality/${id}.yaml`;

function setup(t) {
  const f = fixture(t, ITEMS);
  // proofPath reads the cache from the environment, as the runner's own process does.
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

const review = (f, id = 'a') => f.human('review', '--item', id, '--tree', f.root);
const state = (f, id = 'a') => proofAtHead(f.root, 'alpha', id).state;

/** One builder's turn: dispatch-log, each grant, the files written, accept-dispatch of them, verify-item when told, the commit. */
function turn(f, selector, files, { granted = [], verify = false } = {}) {
  const dispatch = f.start(...selector);
  for (const file of granted) {
    const result = f.call('grant', dispatch, '--path', file, '--tree', f.root);
    assert.equal(result.code, 0, result.out);
  }
  for (const [file, body] of Object.entries(files)) f.write(file, body);
  f.accepted(dispatch, Object.keys(files));
  if (verify) {
    const verified = f.verify(...(selector[0] === '--items' ? selector : [selector[1]]));
    assert.equal(verified.code, 0, verified.out);
  }
  f.land(...Object.keys(files));
}

/** The first round of `id` recorded with findings, both lenses written. */
function recordFix(f, id = 'a') {
  assert.equal(review(f, id).code, 3);
  f.write(ITEM_REVIEW(id), `item: ${id}\nverdict: fix\nfiles: [${id}.cjs]\nfindings:\n  - criterion: AC1 it reads three\n` +
    `    file: ${id}.cjs\n    line: 1\n    evidence: read ${id}.cjs, it exports 2\n    fix: export 3\n    severity: major\n`);
  f.write(QUALITY(id), `item: ${id}\nverdict: clean\nfiles: [${id}.cjs]\n`);
  const recorded = f.human('review', '--item', id, '--tree', f.root, '--reviewer', 'rev-1', '--quality-reviewer', 'rev-q');
  assert.equal(recorded.code, 2, recorded.out);
}

/** The range line of the first dispatch block in `out`. */
function rangeLine(out) {
  const line = out.split('\n').find((entry) => /^ {2}range /.test(entry));
  assert.ok(line, out);
  return line;
}

test('a correction that commits a granted file after the proof asks for verify-item again, and after verify-item the review goes on', (t) => {
  const f = setup(t);
  turn(f, ['--item', 'a'], { 'a.cjs': 'module.exports = 2;\n' }, { verify: true });
  recordFix(f);
  assert.equal(state(f), 'current');

  turn(f, ['--item', 'a'], { 'a.cjs': 'module.exports = 3;\n' }, { verify: true });
  assert.equal(state(f), 'current');

  // The fix of a red integrate needs a file outside the item's spec: the orchestrator grants it, the builder commits it.
  turn(f, ['--item', 'a'], { [GUARD]: 'module.exports = true;\n' }, { granted: [GUARD] });

  assert.equal(state(f), 'stale');
  const stale = review(f);
  assert.equal(stale.code, 3, stale.out);
  assert.match(stale.out, /^verify-item owed for a before its review/m);
  assert.doesNotMatch(stale.out, /^dispatch /m);

  assert.equal(f.verify('a').code, 0);
  assert.equal(state(f), 'current');
  const delta = review(f);
  assert.equal(delta.code, 3, delta.out);
  assert.match(delta.out, /^dispatch specsmd-inferno-reviewer item a$/m);
  assert.match(rangeLine(delta.out), new RegExp(` paths a\\.cjs ${GUARD.replace('.', '\\.')}$`));
  assert.match(delta.out, new RegExp(`^ {2}proof ${proofPath(f.root, 'alpha', 'a').replace(/[.]/g, '\\.')}$`, 'm'));
});

test('a granted file committed after the proof, before any review, makes the proof stale', (t) => {
  const f = setup(t);
  turn(f, ['--item', 'a'], { 'a.cjs': 'module.exports = 2;\n' }, { verify: true });
  turn(f, ['--item', 'a'], { [GUARD]: 'module.exports = true;\n' }, { granted: [GUARD] });

  assert.equal(state(f), 'stale');
  assert.equal(f.verify('a').code, 0);
  assert.equal(state(f), 'current');
});

test('a granted file the accept does not report is in the proof verify-item writes, so that proof is current', (t) => {
  const f = setup(t);
  const dispatch = f.start('--item', 'a');
  assert.equal(f.call('grant', dispatch, '--path', GUARD, '--tree', f.root).code, 0);
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write(GUARD, 'module.exports = true;\n');
  f.accepted(dispatch, ['a.cjs']);
  assert.equal(f.verify('a').code, 0);
  f.land('a.cjs', GUARD);

  const proof = proofAtHead(f.root, 'alpha', 'a');
  assert.equal(proof.state, 'current');
  assert.deepEqual(proof.paths, ['a.cjs', GUARD]);
});

test('an item with no grant reads as before: a file another item claimed or was granted leaves its proof current', (t) => {
  const f = setup(t);
  turn(f, ['--item', 'a'], { 'a.cjs': 'module.exports = 2;\n' }, { verify: true });
  turn(f, ['--item', 'b'], { 'b.cjs': 'module.exports = 2;\n', [GUARD]: 'module.exports = true;\n' }, { granted: [GUARD] });

  assert.equal(state(f), 'current');
  const result = review(f);
  assert.equal(result.code, 3, result.out);
  assert.match(rangeLine(result.out), / paths a\.cjs$/);
  assert.match(result.out, /^ {2}proof /m);
});

test('a ledger path committed after the proof stays out, as before', (t) => {
  const f = setup(t);
  turn(f, ['--item', 'a'], { 'a.cjs': 'module.exports = 2;\n' }, { verify: true });
  f.write(path.join('.specs-inferno', 'notes.md'), 'a note\n');
  f.land(path.join('.specs-inferno', 'notes.md'));

  assert.equal(state(f), 'current');
});

test('a batch proof reads each item\'s grants: a granted file of one item committed after it makes the batch verify again', (t) => {
  const f = setup(t);
  turn(f, ['--items', 'a,b'], { 'a.cjs': 'module.exports = 2;\n', 'b.cjs': 'module.exports = 2;\n' }, { verify: true });
  assert.equal(state(f, 'b'), 'current');

  turn(f, ['--item', 'b'], { [GUARD]: 'module.exports = true;\n' }, { granted: [GUARD] });

  assert.equal(state(f, 'a'), 'stale');
  assert.equal(state(f, 'b'), 'stale');
  const stale = review(f, 'b');
  assert.equal(stale.code, 3, stale.out);
  assert.match(stale.out, new RegExp(`^then run\\.cjs verify-item --items a,b --tree ${f.root}, then run\\.cjs review --item b --tree `, 'm'));
});

test('a batch proof gives each item its own granted file: the grant of one item is under its paths, not the other\'s', (t) => {
  const f = setup(t);
  const dispatch = f.start('--items', 'a,b');
  assert.equal(f.call('grant', dispatch, '--path', GUARD, '--tree', f.root).code, 0);
  const files = { 'a.cjs': 'module.exports = 2;\n', 'b.cjs': 'module.exports = 2;\n', [GUARD]: 'module.exports = true;\n' };
  for (const [file, body] of Object.entries(files)) f.write(file, body);
  f.accepted(dispatch, Object.keys(files));
  assert.equal(f.verify('--items', 'a,b').code, 0);
  f.land(...Object.keys(files));

  // A chain's grant is claimed by every item it built that no other item of the chain owns by spec.
  assert.deepEqual(proofAtHead(f.root, 'alpha', 'a').paths, ['a.cjs', GUARD]);
  assert.deepEqual(proofAtHead(f.root, 'alpha', 'b').paths, ['b.cjs', GUARD]);
});
