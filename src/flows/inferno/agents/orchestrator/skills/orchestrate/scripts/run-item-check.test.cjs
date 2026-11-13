'use strict';

// Where verify-item runs an item's own check. With `verification.run` a bare check goes through
// the host's wrapper as a mutant's test does with `mutate.run`, inside the host's check session
// when it has one, and a run the wrapper refused is no verdict: exit 5 and no failed proof.
// Without the key the check runs in the tree as it always did. The config: run-item-check-config.test.cjs.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');
const { verifyItemCall } = require('./run-call.cjs');
const { owner } = require('./run-mutate-journal.cjs');
const { writeFile } = require('./test-write.cjs');
const { CHECK, REFUSED, WRAPPER, configOf, hostOf, leftSession, placed, refuse, wrapCalls } = require('./run-item-check-fixture.cjs');

/** Items with their checks, dispatched as `selector` and changed, on the host `config` describes. */
function host(t, checks, config, selector = ['--item', 'a']) {
  const items = Object.fromEntries(Object.entries(checks).map(([id, check]) => [id, { editable: [`${id}.cjs`], check }]));
  const f = hostOf(fixture(t, items));
  f.write('.specs-inferno/config.yaml', config);
  const dispatch = f.start(...selector);
  for (const id of Object.keys(checks)) f.write(`${id}.cjs`, 'module.exports = 2;\n');
  f.accepted(dispatch, Object.keys(checks).map((id) => `${id}.cjs`));
  return f;
}

/** Where verify-item wrote the proof of `id`, in the fixture's own cache. */
const proofFile = (f, id = 'a') => path.join(f.cache, 'specsmd-inferno', 'repo', 'item-proofs', 'alpha', `${id}.json`);
const proofText = (f, id = 'a') => fs.readFileSync(proofFile(f, id), 'utf8');
const proofOf = (f, id = 'a') => JSON.parse(proofText(f, id));
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const human = (f) => f.human('verify-item', 'a', '--tree', f.root);

test('with verification.run a bare check runs through the wrapper, and the proof and the PASS line hold the command as it ran', (t) => {
  const f = host(t, { a: CHECK }, configOf());
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(wrapCalls(f).map((call) => [call.mode, call.tree, call.test]), [['auto', f.root, CHECK]], 'the tree and the check go in one word each');
  const proof = proofOf(f);
  assert.equal(proof.passed, true);
  assert.deepEqual(proof.commands.map((entry) => [entry.item, entry.command, entry.exit, entry.tail]), [['a', placed(f.root, CHECK), 0, ['item check ran']]]);
  assert.deepEqual(result.data.checks.map((entry) => [entry.item, entry.command, entry.code]), [['a', placed(f.root, CHECK), 0]]);
  const shown = human(f);
  assert.equal(shown.code, 0, shown.out);
  assert.match(shown.out, new RegExp(`^PASS \\d+s ${literal(placed(f.root, CHECK))}$`, 'm'));
});

test('a red check placed through the wrapper fails as before, its FAIL line naming the command as it ran', (t) => {
  const f = host(t, { a: 'echo item check failed; exit 1' }, configOf({ refused: REFUSED }));
  const shown = human(f);
  assert.equal(shown.code, 2, shown.out);
  assert.match(shown.out, new RegExp(`^FAIL \\d+s ${literal(placed(f.root, 'echo item check failed; exit 1'))} -> \\S+$`, 'm'));
  assert.match(shown.out, /^item check failed$/m);
  assert.equal(proofOf(f).passed, false);
  assert.equal(wrapCalls(f).length, 1, 'a red with a verdict runs once');
});

test('a check that already starts with the wrapper\'s words, or that verification.wrapped marks, runs as written', (t) => {
  const own = `${WRAPPER} auto . '${CHECK}'`;
  for (const [check, wrapped] of [[own, null], [`WRAP_ZONE=north ${own}`, String.raw`^(?:\w+=\S* +)+node `]]) {
    const f = host(t, { a: check }, configOf({ wrapped }));
    const result = f.verify('a');
    assert.equal(result.code, 0, result.out);
    assert.deepEqual(wrapCalls(f).map((call) => [call.tree, call.test]), [['.', CHECK]], `one call of the wrapper, as written: ${check}`);
    assert.equal(proofOf(f).commands[0].command, check);
  }
});

test('a check the wrapper refused twice exits 5 with the no-verdict line, and leaves the last proof as it was, or none', (t) => {
  const f = host(t, { a: CHECK }, configOf({ refused: REFUSED }));
  refuse(f, 2);
  const none = human(f);
  assert.equal(none.code, 5, none.out);
  assert.match(none.out, new RegExp(`^NO VERDICT ${literal(placed(f.root, CHECK))} -> \\S+$`, 'm'));
  assert.match(none.out, /^wrapper: no machine free$/m);
  assert.match(none.out, new RegExp(`^1 of 1 item check\\(s\\) got no verdict: the host's wrapper ran nothing, twice, .*; run the step again: ${literal(verifyItemCall(f.root, ['a']))}$`, 'm'));
  assert.doesNotMatch(none.out, /^(FAIL|PASS) /m);
  assert.match(none.out, /^ownership clean since /m, 'the ownership still reads');
  assert.ok(!fs.existsSync(proofFile(f)), 'no proof before, none after');
  assert.equal(wrapCalls(f).length, 2, 'the refused check ran once more');

  assert.equal(f.verify('a').code, 0);
  const before = proofText(f);
  refuse(f, 2);
  const again = f.verify('a');
  assert.equal(again.code, 5, again.out);
  assert.deepEqual(again.data.no_verdict, [placed(f.root, CHECK)]);
  assert.deepEqual({ ...again.data, checks: again.data.checks.map((entry) => [entry.item, entry.command, entry.code]), dispatches: again.data.dispatches.length }, {
    items: ['a'], item: 'a', intent: 'alpha', since: again.data.since, outside: [], unreported: [], checks: [['a', placed(f.root, CHECK), 3]],
    dispatches: 1, proof: null, tests_changed: null, no_verdict: [placed(f.root, CHECK)],
  });
  assert.match(again.data.since, /^[0-9a-f]{40}$/);
  assert.equal(proofText(f), before, 'the proof that passed is still there, unchanged');
});

test('a check the wrapper refused once runs again, and the proof reads the run that had a verdict', (t) => {
  const f = host(t, { a: CHECK }, configOf({ refused: REFUSED }));
  refuse(f, 1);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.equal(wrapCalls(f).length, 2);
  const proof = proofOf(f);
  assert.equal(proof.passed, true);
  assert.deepEqual(proof.commands.map((entry) => [entry.exit, entry.tail]), [[0, ['item check ran']]]);
});

test('with verification.session the placed check runs inside the session: open, run and close once each, the run on the bare check', (t) => {
  const f = host(t, { a: CHECK }, configOf({ session: true, refused: REFUSED }));
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(wrapCalls(f).map((call) => [call.mode, call.tree, call.test]), [['open', f.root, null], ['run', f.root, CHECK], ['close', f.root, null]]);
  const proof = proofOf(f);
  assert.deepEqual(proof.commands.map((entry) => [entry.command, entry.tail]), [[placed(f.root, CHECK), ['item check ran']]]);
  assert.deepEqual(result.data.checks.map((entry) => entry.command), [placed(f.root, CHECK)], 'the payload names the check, not the session\'s call');
  const shown = human(f);
  assert.equal(shown.code, 0, shown.out);
  assert.match(shown.out, new RegExp(`^PASS \\d+s ${literal(placed(f.root, CHECK))}$`, 'm'), 'the PASS line names the check, not the session\'s call');
});

test('a red check inside the session fails with a FAIL line naming the check as placed, not the session\'s call', (t) => {
  const red = 'echo item check failed; exit 1';
  const f = host(t, { a: red }, configOf({ session: true, refused: REFUSED }));
  const shown = human(f);
  assert.equal(shown.code, 2, shown.out);
  assert.match(shown.out, new RegExp(`^FAIL \\d+s ${literal(placed(f.root, red))} -> \\S+$`, 'm'));
  assert.match(shown.out, /^item check failed$/m);
  assert.deepEqual(wrapCalls(f).map((call) => [call.mode, call.test]), [['open', null], ['run', red], ['close', null]]);
  assert.equal(proofOf(f).passed, false);
});

test('a session a killed verify-item left open is closed by the next verify-item with the key, first, and one whose owner lives is left alone', (t) => {
  const f = host(t, { a: CHECK }, configOf({ session: true }));
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  const record = leftSession(f, { pid: dead, start: null }, '/left/session');
  const living = leftSession(f, owner(), '/living/session');
  const shown = human(f);
  assert.equal(shown.code, 0, shown.out);
  assert.match(shown.out, /^closed the host session an interrupted check run left open\n/, 'the close is the first line');
  assert.deepEqual(wrapCalls(f).map((call) => [call.mode, call.session && call.session.startsWith('/') && !call.session.startsWith('/left') && !call.session.startsWith('/living') ? 'own' : call.session]),
    [['close', '/left/session'], ['open', 'own'], ['run', 'own'], ['close', 'own']], 'the left session closes before the new one opens');
  assert.ok(!fs.existsSync(record), 'the left record is gone');
  assert.ok(fs.existsSync(living), 'a session whose owner lives is its own');
});

test('a verify-item without verification.run closes no session a killed run left', (t) => {
  const f = host(t, { a: CHECK }, configOf({ run: false, session: true }));
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  const record = leftSession(f, { pid: dead, start: null }, '/left/session');
  const shown = human(f);
  assert.equal(shown.code, 0, shown.out);
  assert.doesNotMatch(shown.out, /host session/);
  assert.deepEqual(wrapCalls(f), []);
  assert.ok(fs.existsSync(record), 'the record waits for the next integrate or gate, or verify-item with the key');
});

test('a session whose close failed leaves its line beside the verdict, which stands', (t) => {
  const f = host(t, { a: CHECK }, configOf({ session: true }));
  writeFile(path.join(path.dirname(f.root), 'close-fails'), '');
  const shown = human(f);
  assert.equal(shown.code, 0, shown.out);
  assert.match(shown.out, /^PASS \d+s .*\nthe close of the host session failed \(exit 1 -> \S+\); close it on the host$/m);
  assert.equal(proofOf(f).passed, true);
});

test('in a batch a check refused twice beside one that passed is no verdict for the batch: one of two, and no proof', (t) => {
  const f = host(t, { a: CHECK, b: 'echo other check ran' }, configOf({ refused: REFUSED }), ['--items', 'a,b']);
  refuse(f, 2, CHECK);
  const result = f.verify('--items', 'a,b');
  assert.equal(result.code, 5, result.out);
  assert.deepEqual(result.data.no_verdict, [placed(f.root, CHECK)]);
  assert.ok(!fs.existsSync(proofFile(f, 'a')) && !fs.existsSync(proofFile(f, 'b')), 'no proof for either item');
  const shown = f.human('verify-item', '--items', 'a,b', '--tree', f.root);
  assert.equal(shown.code, 0, shown.out);
  const before = proofText(f, 'b');
  refuse(f, 2, CHECK);
  const again = f.human('verify-item', '--items', 'a,b', '--tree', f.root);
  assert.equal(again.code, 5, again.out);
  assert.match(again.out, /^PASS \d+s .*'echo other check ran'$/m);
  assert.match(again.out, new RegExp(`^1 of 2 item check\\(s\\) got no verdict: .*; run the step again: ${literal(verifyItemCall(f.root, ['a', 'b']))}$`, 'm'));
  assert.equal(proofText(f, 'b'), before, 'the batch\'s last proof stands, also for the item whose check passed');
});

test('a check already spelled with the wrapper runs in the session on the rest its match left, as an integrate check does', (t) => {
  const f = host(t, { a: `${WRAPPER} auto ${CHECK}` }, configOf({ session: true }));
  assert.equal(f.verify('a').code, 0);
  assert.deepEqual(wrapCalls(f).map((call) => [call.mode, call.test]), [['open', null], ['run', CHECK], ['close', null]]);
});

test('a batch places each item\'s check, and its checks share one session', (t) => {
  const other = 'echo other check ran';
  const f = host(t, { a: CHECK, b: other }, configOf({ session: true }), ['--items', 'a,b']);
  const result = f.verify('--items', 'a,b');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(wrapCalls(f).map((call) => [call.mode, call.test]), [['open', null], ['run', CHECK], ['run', other], ['close', null]]);
  assert.deepEqual(proofOf(f, 'b').commands.map((entry) => [entry.item, entry.command]), [['a', placed(f.root, CHECK)], ['b', placed(f.root, other)]]);
});

test('without verification.run the check runs in the tree as before: no wrapper, no session, and a refused line is a failed proof', (t) => {
  const bare = host(t, { a: CHECK }, configOf({ run: false, session: true, refused: REFUSED }));
  assert.equal(bare.verify('a').code, 0);
  assert.deepEqual(wrapCalls(bare), [], 'a bare check reaches no wrapper and opens no session');
  assert.equal(proofOf(bare).commands[0].command, CHECK);

  // A check the session's match reaches, and whose wrapper refuses, still runs once, here, and fails.
  const spelled = `${WRAPPER} auto . '${CHECK}'`;
  const f = host(t, { a: spelled }, configOf({ run: false, session: true, refused: REFUSED }));
  refuse(f, 1);
  const shown = human(f);
  assert.equal(shown.code, 2, shown.out);
  assert.match(shown.out, new RegExp(`^FAIL \\d+s ${literal(spelled)} -> \\S+$`, 'm'));
  assert.doesNotMatch(shown.out, /NO VERDICT|got no verdict/);
  assert.deepEqual(wrapCalls(f).map((call) => [call.mode, call.tree]), [['auto', '.']], 'one direct call, no session');
  const proof = proofOf(f);
  assert.equal(proof.passed, false);
  assert.deepEqual(proof.commands.map((entry) => [entry.command, entry.exit]), [[spelled, 3]]);
});
