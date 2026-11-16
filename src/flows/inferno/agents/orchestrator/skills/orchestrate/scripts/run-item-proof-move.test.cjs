'use strict';

// A move names both of its paths, the one it left and the one it took, wherever the runner lists
// what changed (changedPaths in run-gate.cjs). The proof verify-item writes then carries the old
// path that proofAtHead reads as a deletion the item owns, so an item whose spec asks for a
// `git mv` gets a current proof and its review goes on, instead of asking for verify-item again
// forever. A move out of the item's ownership, into it, with an edit, and of a test file each
// read here as the runner now reads them.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');
const { proofAtHead, proofPath } = require('./run-item-proof.cjs');
const { writeFile } = require('./test-write.cjs');

const LOCK = `${JSON.stringify({ flow: 'inferno', rules: { review: '2026-09-20T00:00:00.000Z' }, files: {} })}\n`;
const ITEMS = { a: { editable: ['cards/', 'wallet/'], check: 'node -e "0"' } };
const OLD = 'cards/balance.cjs';
const NEW = 'wallet/balance.cjs';
const OLD_TEST = 'cards/balance.test.cjs';
const NEW_TEST = 'wallet/balance.test.cjs';
// Long enough that a one-line edit keeps the move a rename git would detect.
const BODY = ['gift', 'card', 'store', 'credit', 'refund', 'voucher', 'wallet', 'ledger']
  .map((name) => `exports.${name} = '${name}';\n`).join('');

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
  f.write(OLD, BODY);
  f.write(OLD_TEST, 'require("node:test")("one", () => {});\n');
  f.land('.specsmd/inferno/flow.lock', OLD, OLD_TEST);
  return f;
}

/** One builder's turn that moves `from` to `to` with git mv, edits what `edits` names, reports `claims` and runs verify-item. */
function moved(f, moves, { edits = {}, claims = null, since = false } = {}) {
  const dispatch = f.start('--item', 'a');
  for (const [from, to] of moves) {
    fs.mkdirSync(path.dirname(path.join(f.root, to)), { recursive: true });
    f.git('mv', from, to);
  }
  for (const [file, body] of Object.entries(edits)) f.write(file, body);
  f.accepted(dispatch, claims || [...new Set([...moves.flat(), ...Object.keys(edits)])]);
  const verified = since ? f.verify('a', '--since', 'HEAD') : f.verify('a');
  f.git('add', '-A');
  f.git('commit', '-qm', 'the item moved a file');
  return verified;
}

const review = (f) => f.human('review', '--item', 'a', '--tree', f.root);

test('an item that moves an owned file with git mv gets a current proof, and its review prints the dispatch', (t) => {
  const f = setup(t);
  const verified = moved(f, [[OLD, NEW]]);
  assert.equal(verified.code, 0, verified.out);

  const proof = proofAtHead(f.root, 'alpha', 'a');
  assert.equal(proof.state, 'current');
  assert.deepEqual(proof.paths, [OLD, NEW]);
  const result = review(f);
  assert.equal(result.code, 3, result.out);
  assert.match(result.out, /^dispatch specsmd-inferno-reviewer item a$/m);
  assert.doesNotMatch(result.out, /verify-item owed/);
});

test('a move with an edit in the same commit names both paths and its proof is current', (t) => {
  const f = setup(t);
  const verified = moved(f, [[OLD, NEW]], { edits: { [NEW]: BODY.replace("'gift'", "'gift card'") } });
  assert.equal(verified.code, 0, verified.out);

  const proof = proofAtHead(f.root, 'alpha', 'a');
  assert.equal(proof.state, 'current');
  assert.deepEqual(proof.paths, [OLD, NEW]);
});

test('a move out of the item\'s ownership is outside, and the proof carries the owned path it left beside the claimed one', (t) => {
  const f = setup(t);
  const verified = moved(f, [[OLD, 'balance.cjs']]);
  assert.equal(verified.code, 2, verified.out);
  assert.deepEqual(verified.data.outside, ['balance.cjs']);

  const proof = proofAtHead(f.root, 'alpha', 'a');
  assert.equal(proof.state, 'current');
  assert.deepEqual(proof.paths, ['balance.cjs', OLD]);
});

test('a move into the item\'s ownership names the path it left outside, under --since too', (t) => {
  const f = setup(t);
  const verified = moved(f, [['other.cjs', 'wallet/other.cjs']], { since: true });
  assert.equal(verified.code, 2, verified.out);
  assert.deepEqual(verified.data.outside, ['other.cjs']);

  const proof = proofAtHead(f.root, 'alpha', 'a');
  assert.equal(proof.state, 'current');
  // The dispatch claimed both paths, and a claimed path is in the proof as its review reads it.
  assert.deepEqual(proof.paths, ['other.cjs', 'wallet/other.cjs']);
});

test('a moved test file reads as its old path deleted, as a move without git mv always read', (t) => {
  const f = setup(t);
  const verified = moved(f, [[OLD_TEST, NEW_TEST]]);
  assert.equal(verified.code, 0, verified.out);

  const written = JSON.parse(fs.readFileSync(proofPath(f.root, 'alpha', 'a'), 'utf8'));
  assert.deepEqual(written.diff.paths, [OLD_TEST, NEW_TEST]);
  assert.deepEqual(written.tests_changed, { modified: [], deleted: [OLD_TEST], switched_off: [] });
  assert.equal(proofAtHead(f.root, 'alpha', 'a').state, 'current');
});

test('a proof of a move the released flow wrote, with only the path the move took, reads stale as before, and verify-item makes it current', (t) => {
  const f = setup(t);
  assert.equal(moved(f, [[OLD, NEW]]).code, 0);
  const file = proofPath(f.root, 'alpha', 'a');
  const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
  writeFile(file, `${JSON.stringify({ ...proof, diff: { ...proof.diff, paths: [NEW] } }, null, 2)}\n`);

  assert.equal(proofAtHead(f.root, 'alpha', 'a').state, 'stale');
  assert.match(review(f).out, /^verify-item owed for a before its review/m);
  assert.equal(f.verify('a').code, 0);
  assert.equal(proofAtHead(f.root, 'alpha', 'a').state, 'current');
});
