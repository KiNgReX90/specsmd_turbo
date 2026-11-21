'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const lib = require('./run-lib.cjs');
const {
  LOCAL, NAMES, REMOTE_CHECKS, calls, commit, configOf, counted, hostTree, openRecords, proofs, run, sessionBlock, start, until, write,
} = require('./run-check-session-fixture.cjs');

// On a host that sends every check to another machine through a wrapper, each integrate command
// synced the tree again and waited in that machine's queue again: one integrate of five commands
// paid the sync and the wait five times, well over half of its wall time. With
// `verification.session` the commands the session's match reaches run back to back in one
// session of the wrapper, and each keeps its own proof, keyed as without the key.

const INTEGRATE = [...REMOTE_CHECKS, LOCAL];
const integrate = (f, act) => run(f, ['integrate', '--tree', f.tree], { act });

test('an integrate of five wrapped commands opens one session, runs the five in it, closes it, and writes five proofs', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE }));
  const result = integrate(f);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(counted(f), { open: 1, run: 5, close: 1, direct: 0 });
  const runs = calls(f, 'run');
  assert.deepEqual(runs.map((entry) => entry.test), NAMES.map((name) => `echo ${name}`), 'the session runs each check with the wrapper words cut off');
  const [opened] = calls(f, 'open');
  assert.ok(calls(f).every((entry) => entry.session === opened.session && entry.tree === f.tree), 'every command gets the same session and the tree');
  assert.ok(!opened.session.startsWith(f.tree), 'the session directory is outside the tree');
  for (const command of INTEGRATE) assert.match(result.out, new RegExp(`PASS \\d+s ${command}$`, 'm'));
  assert.equal(proofs(f).length, 6, 'five proofs for the wrapped commands and one for the local one');
  assert.deepEqual(openRecords(f), [], 'no session is left recorded open');

  // The proofs are keyed as without the key: the same integrate without it reads all six green and runs nothing.
  write(f.tree, '.specs-inferno/config.yaml', configOf({ integrate: INTEGRATE, session: false }));
  commit(f.tree, 'no session');
  const again = integrate(f);
  assert.equal(again.code, 0, again.out + again.err);
  for (const command of INTEGRATE) assert.match(again.out, new RegExp(`GREEN \\d+s ${command} \\(unchanged since`));
  assert.equal(calls(f).length, 7, 'a green proof opens nothing and runs nothing');
});

test('without the key the five run through the wrapper as today, each syncing the tree again', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE, session: false }));
  const result = integrate(f);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(counted(f), { open: 0, run: 0, close: 0, direct: 5 });
  assert.equal(proofs(f).length, 6);
});

test('a command that fails in the session reports as today, the others still run, and the session closes', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE }));
  const result = integrate(f, 'run@3=fail');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^FAIL \d+s node remote\.cjs direct echo three -> \S+integrate-\S+\/2\.log$/m);
  assert.match(result.out, /the wrapper refused/);
  assert.match(result.out, /1 of 6 integrate command\(s\) failed; send every failure above to the builder in one correction\./);
  assert.deepEqual(counted(f), { open: 1, run: 5, close: 1, direct: 0 });
  assert.equal(proofs(f).length, 5, 'the red command mints no proof');
  assert.deepEqual(openRecords(f), []);
});

test('a session that does not open fails every command it would run, runs none of them, and still closes', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE }));
  const result = integrate(f, 'open@1=fail');
  assert.equal(result.code, 2, result.out + result.err);
  for (const command of REMOTE_CHECKS) assert.match(result.out, new RegExp(`^FAIL 0s ${command} -> `, 'm'));
  assert.match(result.out, /the host session did not open \(exit 3 -> \S+session-\S+-open\.log\), so this check did not run/);
  assert.match(result.out, /PASS \d+s echo local/, 'a check the session does not reach runs here as before');
  assert.doesNotMatch(result.out, /(PASS|GREEN) \d+s node remote/);
  assert.match(result.out, /5 of 6 integrate command\(s\) failed/);
  assert.deepEqual(counted(f), { open: 1, run: 0, close: 1, direct: 0 });
  assert.equal(proofs(f).length, 1, 'only the local command proved anything');

  const retry = integrate(f);
  assert.equal(retry.code, 0, retry.out + retry.err);
  for (const command of REMOTE_CHECKS) assert.match(retry.out, new RegExp(`PASS \\d+s ${command}$`, 'm'));
});

test('a scoped check skipped for the landing opens nothing, and an integrate whose every command is skipped opens no session', (t) => {
  const scopes = Object.fromEntries(REMOTE_CHECKS.map((command) => [command, ['docs/**']]));
  const f = hostTree(t, configOf({ integrate: REMOTE_CHECKS, scopes }));
  const result = integrate(f);
  assert.equal(result.code, 0, result.out + result.err);
  for (const command of REMOTE_CHECKS) assert.match(result.out, new RegExp(`SKIP ${command} \\(no path in scope changed\\)`));
  assert.deepEqual(calls(f), []);
});

test('an integrate killed between open and close leaves its close to the next integrate, which runs it first', async (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE }));
  const killed = start(f, ['integrate', '--tree', f.tree], { act: 'run@2=hold' });
  assert.ok(await until(() => calls(f, 'run').some((entry) => entry.action === 'hold')), 'the second check is running');
  assert.equal(openRecords(f).length, 1, 'the open session is recorded');
  killed.child.kill('SIGKILL');
  await killed.ended;
  write(path.dirname(f.tree), 'release', 'go\n');
  const left = calls(f, 'open')[0].session;
  assert.equal(calls(f, 'close').length, 0, 'the kill skipped the close');

  const next = integrate(f);
  assert.equal(next.code, 0, next.out + next.err);
  assert.match(next.out, /^closed the host session an interrupted check run left open$/m);
  const closes = calls(f, 'close');
  assert.equal(closes.length, 2, 'the left session closed, then the new one');
  assert.equal(closes[0].session, left, 'the first close is the left session\'s');
  assert.notEqual(calls(f, 'open')[1].session, left);
  assert.deepEqual(openRecords(f), []);
});

test('a close that fails says so and the integrate stands', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE }));
  const result = integrate(f, 'close@1=fail');
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /the close of the host session failed \(exit 3 -> \S+session-\S+-close\.log\); close it on the host/);
  assert.equal(proofs(f).length, 6);
});

test('a --config file inherits verification.session, and a key this runner cannot use is refused naming it and the file', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE }));
  const selected = path.join(f.dir, 'other.yaml');
  write(f.dir, 'other.yaml', 'verification:\n  integrate:\n    - echo other\n');
  assert.equal(lib.readConfig(f.tree, selected).verification.session.open, 'node remote.cjs open');
  write(f.dir, 'own.yaml', `verification:\n  integrate:\n    - echo other\n${sessionBlock().replace('remote.cjs open', 'remote.cjs open --own')}`);
  assert.equal(lib.readConfig(f.tree, path.join(f.dir, 'own.yaml')).verification.session.open, 'node remote.cjs open --own');

  const block = sessionBlock();
  for (const [body, key] of [
    ['  session: on\n', /verification\.session in \S+ must be a map of match, open, run, close\./],
    [sessionBlock({ extra: '    send: node remote.cjs send\n' }), /verification\.session in \S+ must be a map of match, open, run, close only, not send\./],
    [sessionBlock({ drop: 'close' }), /verification\.session\.close in \S+ must be a non-empty string\./],
    [block.replace(/run: .*/, 'run: " "'), /verification\.session\.run in \S+ must be a non-empty string\./],
    [block.replace(/match: .*/, "match: '^(node'"), /verification\.session\.match in \S+ must be a regex \(/],
  ]) {
    write(f.dir, 'bad.yaml', `verification:\n  integrate:\n${REMOTE_CHECKS.map((command) => `    - ${command}\n`).join('')}${body}`);
    const result = run(f, ['integrate', '--tree', f.tree, '--config', path.join(f.dir, 'bad.yaml')]);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, /BAD_CONFIG/);
    assert.match(result.err, key);
    assert.ok(result.err.includes(path.join(f.dir, 'bad.yaml')), result.err);
  }
  assert.deepEqual(calls(f), [], 'a refused config runs nothing');
});

test('the session lines the config example documents under verification read as the key this runner takes', (t) => {
  const example = require('node:fs').readFileSync(path.join(__dirname, '../../../config.example.yaml'), 'utf8');
  const at = example.indexOf('\n  # session:');
  assert.ok(at > 0 && at < example.indexOf('\ndoubles:'), 'the session lines sit in the verification block');
  const lines = example.slice(at + 1).split('\n');
  const block = lines.slice(0, lines.findIndex((line, index) => index > 0 && !line.startsWith('  #   ')))
    .map((line) => line.replace(/^ {2}# /, '  ').replace(/\s+# .*$/, '')).join('\n');
  const f = hostTree(t, `verification:\n  integrate:\n    - echo one\n${block}\n`);
  const session = lib.readConfig(f.tree).verification.session;
  assert.deepEqual(Object.keys(session), ['match', 'open', 'run', 'close']);
  assert.ok(new RegExp(session.match).test('tools/remote-test.sh . npm test'));
});

test('the browser step goes through the same session when match reaches it', (t) => {
  const browser = 'node remote.cjs direct echo browser';
  const e2e = `  integrate_e2e:\n    full: ${browser}\n    full_when: ["src/**"]\n    map: {}\n`;
  const f = hostTree(t, configOf({ integrate: INTEGRATE }) + e2e);
  write(f.tree, 'src/input.txt', 'two\n');
  commit(f.tree, 'the landing touches src');
  const result = integrate(f);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, new RegExp(`PASS \\d+s ${browser}$`, 'm'));
  assert.deepEqual(counted(f), { open: 1, run: 6, close: 1, direct: 0 });
  assert.equal(calls(f, 'run').at(-1).test, 'echo browser');
});

test('a second integrate beside a running one leaves the running one\'s session open, and that one closes it itself', async (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE }));
  const first = start(f, ['integrate', '--tree', f.tree], { act: 'run@2=hold' });
  assert.ok(await until(() => calls(f, 'run').some((entry) => entry.action === 'hold')), 'the first integrate holds its second check');
  const held = calls(f, 'open')[0].session;

  const beside = integrate(f);
  assert.equal(beside.code, 0, beside.out + beside.err);
  assert.doesNotMatch(beside.out, /closed the host session an interrupted check run left open/);
  assert.deepEqual(calls(f, 'close').map((entry) => entry.session).filter((session) => session === held), [], 'the running session is not closed under it');
  assert.equal(openRecords(f).length, 1, 'the running session stays recorded');

  write(path.dirname(f.tree), 'release', 'go\n');
  assert.equal(await first.ended, 0);
  assert.equal(calls(f, 'close').filter((entry) => entry.session === held).length, 1, 'its owner closed it once');
  assert.deepEqual(openRecords(f), []);
});
