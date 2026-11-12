'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const {
  NAMES, REMOTE_CHECKS, calls, commit, configOf, counted, hostTree, openRecords, proofs, run, start, until, write,
} = require('./run-check-session-fixture.cjs');

// The gate's finalize commands have the shape of the integrate list and take the same key: the
// commands the session's match reaches run back to back in one session of the host's wrapper,
// each with its own proof, keyed as without the key. The gate stops at its first red, so a red
// closes the session there.

const gate = (f, act) => run(f, ['gate'], { act });

test('a gate of five wrapped finalize commands opens one session, runs the five in it, closes it, and writes five proofs', (t) => {
  const f = hostTree(t, configOf({ finalize: REMOTE_CHECKS }));
  const result = gate(f);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(counted(f), { open: 1, run: 5, close: 1, direct: 0 });
  assert.deepEqual(calls(f, 'run').map((entry) => entry.test), NAMES.map((name) => `echo ${name}`));
  for (const command of REMOTE_CHECKS) assert.match(result.out, new RegExp(`PASS \\d+s ${command}$`, 'm'));
  assert.equal(proofs(f).length, 5);
  assert.equal(run(f, ['green']).code, 0, 'green reads the five proofs');

  // Keyed as without the key: the gate without it reads all five green and opens nothing.
  write(f.tree, '.specs-inferno/config.yaml', configOf({ finalize: REMOTE_CHECKS, session: false }));
  commit(f.tree, 'no session');
  const again = gate(f);
  assert.equal(again.code, 0, again.out + again.err);
  for (const command of REMOTE_CHECKS) assert.match(again.out, new RegExp(`GREEN \\d+s ${command} \\(unchanged since`));
  assert.equal(calls(f).length, 7);
});

test('without the key the gate runs the five through the wrapper as today', (t) => {
  const f = hostTree(t, configOf({ finalize: REMOTE_CHECKS, session: false }));
  const result = gate(f);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(counted(f), { open: 0, run: 0, close: 0, direct: 5 });
  assert.equal(proofs(f).length, 5);
});

test('a finalize command that fails stops the gate as today and closes the session there', (t) => {
  const f = hostTree(t, configOf({ finalize: REMOTE_CHECKS }));
  const result = gate(f, 'run@3=fail');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^FAIL \d+s node remote\.cjs direct echo three -> \S+gate-\S+\/2\.log$/m);
  assert.match(result.out, /the wrapper refused/);
  assert.doesNotMatch(result.out, /echo four/);
  assert.deepEqual(counted(f), { open: 1, run: 3, close: 1, direct: 0 });
  assert.equal(proofs(f).length, 2);
  assert.deepEqual(openRecords(f), []);
});

test('a session that does not open reads the gate red on its first wrapped command, runs nothing in it, and still closes', (t) => {
  const f = hostTree(t, configOf({ finalize: REMOTE_CHECKS }));
  const result = gate(f, 'open@1=fail');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^FAIL 0s node remote\.cjs direct echo one -> /m);
  assert.match(result.out, /the host session did not open \(exit 3 -> \S+session-\S+-open\.log\), so this check did not run/);
  assert.doesNotMatch(result.out, /PASS|GREEN|^green /m);
  assert.deepEqual(counted(f), { open: 1, run: 0, close: 1, direct: 0 });
  assert.equal(proofs(f).length, 0);
  assert.equal(run(f, ['green']).code, 3);
});

test('a close that fails says so beside a green gate, also when the gate ran detached', async (t) => {
  const f = hostTree(t, configOf({ finalize: REMOTE_CHECKS }));
  const result = gate(f, 'close@1=fail');
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /the close of the host session failed \(exit 3 -> \S+session-\S+-close\.log\); close it on the host/);

  write(f.tree, 'src/input.txt', 'two\n');
  commit(f.tree, 'moved');
  const detached = run(f, ['gate', '--detach'], { act: 'close@2=fail' });
  assert.equal(detached.code, 0, detached.out + detached.err);
  let waited = run(f, ['gate', '--wait', '--minutes', '1']);
  for (let i = 0; i < 20 && waited.code === 4; i += 1) waited = run(f, ['gate', '--wait', '--minutes', '1']);
  assert.equal(waited.code, 0, waited.out + waited.err);
  assert.match(waited.out, /the close of the host session failed \(exit 3 -> \S+session-\S+-close\.log\); close it on the host/);
});

test('a gate killed between open and close leaves its close to the next gate, which runs it first', async (t) => {
  const f = hostTree(t, configOf({ finalize: REMOTE_CHECKS }));
  const killed = start(f, ['gate'], { act: 'run@2=hold' });
  assert.ok(await until(() => calls(f, 'run').some((entry) => entry.action === 'hold')), 'the second check is running');
  assert.equal(openRecords(f).length, 1);
  killed.child.kill('SIGKILL');
  await killed.ended;
  write(path.dirname(f.tree), 'release', 'go\n');
  const left = calls(f, 'open')[0].session;

  const next = gate(f);
  assert.equal(next.code, 0, next.out + next.err);
  assert.match(next.out, /^closed the host session an interrupted check run left open$/m);
  const closes = calls(f, 'close');
  assert.equal(closes.length, 2);
  assert.equal(closes[0].session, left);
  assert.deepEqual(openRecords(f), []);
});
