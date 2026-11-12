'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const lib = require('./run-lib.cjs');
const slot = require('./run-slot.cjs');
const { NO_VERDICT } = require('./run-exit.cjs');
const {
  LOCAL, REFUSED, REMOTE_CHECKS, calls, commit, configOf, counted, hostTree, openRecords, proofs, run, write,
} = require('./run-check-session-fixture.cjs');

// A host's wrapper that ran nothing, because its machine did not answer or the session's slot was
// gone, exits non-zero, and a check read only by its exit was a failed check: integrate printed
// FAIL and sent the builder after a machine fault, and the gate read a red. With
// `verification.refused`, the line the wrapper prints when it ran nothing, such a check, or a
// session open, is no verdict: it runs once more in a fresh session, and a second refusal ends the
// step with its own exit and a line that says to run it again, with no FAIL and no proof.

const INTEGRATE = [...REMOTE_CHECKS, LOCAL];
const BROKEN = 'node remote.cjs direct false';
const integrate = (f, act) => run(f, ['integrate', '--tree', f.tree], { act });
const gate = (f, act) => run(f, ['gate'], { act });
const NO_FAIL = /^FAIL /m;
const BUILDER = /builder/;

test('the no-verdict exit is its own code, apart from every code the runner already gives', () => {
  assert.ok(Number.isInteger(NO_VERDICT));
  assert.ok(![0, 1, 2, 3, 4].includes(NO_VERDICT));
});

test('integrate: a refused first open and a good second give a green integrate with two opens', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE, refused: REFUSED }));
  const result = integrate(f, 'open@1=fail');
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(counted(f), { open: 2, run: 5, close: 2, direct: 0 });
  const [first, second] = calls(f, 'open');
  assert.notEqual(first.session, second.session, 'the second open is a fresh session');
  for (const command of INTEGRATE) assert.match(result.out, new RegExp(`PASS \\d+s ${command}$`, 'm'));
  assert.doesNotMatch(result.out, NO_FAIL);
  assert.equal(proofs(f).length, 6);
  assert.deepEqual(openRecords(f), []);
});

test('integrate: two refused opens give the no-verdict exit, no failed check, no builder line and no proof of theirs', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE, refused: REFUSED }));
  const result = integrate(f, 'open@1=fail,open@2=fail');
  assert.equal(result.code, NO_VERDICT, result.out + result.err);
  assert.doesNotMatch(result.out, NO_FAIL);
  assert.doesNotMatch(result.out, BUILDER);
  for (const command of REMOTE_CHECKS) assert.match(result.out, new RegExp(`^NO VERDICT ${command} -> \\S+\nthe wrapper refused$`, 'm'));
  assert.match(result.out, /PASS \d+s echo local/);
  const last = result.out.trim().split('\n').at(-1);
  assert.match(last, /^5 of 6 integrate check\(s\) got no verdict: the host's wrapper ran nothing, twice, a fault of the test machine and not of the code; run the step again: run\.cjs integrate --tree \S+$/);
  assert.deepEqual(counted(f), { open: 2, run: 0, close: 2, direct: 0 });
  assert.equal(proofs(f).length, 1, 'only the local check proved anything');
  assert.deepEqual(openRecords(f), []);

  const json = run(f, ['integrate', '--tree', f.tree, '--json'], { act: 'open@3=fail,open@4=fail' });
  assert.equal(json.code, NO_VERDICT, json.out + json.err);
  const payload = JSON.parse(json.out);
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.no_verdict, REMOTE_CHECKS);
  assert.ok(payload.results.every((entry) => entry.result !== 'fail'));
});

test('integrate: the run-again line names the items and the --since of the call', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE, refused: REFUSED }));
  const result = run(f, ['integrate', '--tree', f.tree, '--since', 'HEAD'], { act: 'open@1=fail,open@2=fail' });
  assert.equal(result.code, NO_VERDICT, result.out + result.err);
  assert.match(result.out, /run the step again: run\.cjs integrate --since HEAD --tree \S+$/m);
});

test('integrate: a check refused once whose second run fails without the line is a failed check, though its log holds the first refusal', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE, refused: REFUSED }));
  const result = integrate(f, 'run@2=fail,run@6=exit143');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^FAIL \d+s node remote\.cjs direct echo two -> /m);
  assert.doesNotMatch(result.out, /NO VERDICT|no verdict/);
  assert.match(result.out, /1 of 6 integrate command\(s\) failed; send every failure above to the builder in one correction\./);
  assert.deepEqual(counted(f), { open: 2, run: 6, close: 2, direct: 0 });
});

const BROWSER = 'node remote.cjs direct echo browser';
/** A host that runs the browser step through the session, with a landing that touches its scope. */
function browserHost(t) {
  const e2e = `  integrate_e2e:\n    full: ${BROWSER}\n    full_when: ["src/**"]\n    map: {}\n`;
  const f = hostTree(t, configOf({ integrate: INTEGRATE, refused: REFUSED }) + e2e);
  write(f.tree, 'src/input.txt', 'two\n');
  commit(f.tree, 'the landing touches src');
  return f;
}

test('integrate: the browser step does not run while a check before it has no verdict', (t) => {
  const f = browserHost(t);
  const result = integrate(f, 'run@2=fail,run@6=fail');
  assert.equal(result.code, NO_VERDICT, result.out + result.err);
  assert.ok(calls(f, 'run').every((entry) => entry.test !== 'echo browser'), 'no browser run');
  assert.match(result.out, /^1 of 6 integrate check\(s\) got no verdict/m);
});

test('integrate: a browser step refused twice is no verdict, named and counted with the checks', (t) => {
  const f = browserHost(t);
  const result = run(f, ['integrate', '--tree', f.tree], { act: 'run@6=fail,run@7=fail' });
  assert.equal(result.code, NO_VERDICT, result.out + result.err);
  assert.match(result.out, new RegExp(`^NO VERDICT ${BROWSER} -> \\S+e2e\\.log\nthe wrapper refused$`, 'm'));
  assert.match(result.out, /^1 of 7 integrate check\(s\) got no verdict/m);
  assert.doesNotMatch(result.out, NO_FAIL);
  assert.deepEqual(counted(f), { open: 2, run: 7, close: 2, direct: 0 });

  const json = run(f, ['integrate', '--tree', f.tree, '--json'], { act: 'run@8=fail,run@9=fail' });
  assert.equal(json.code, NO_VERDICT, json.out + json.err);
  const payload = JSON.parse(json.out);
  assert.deepEqual(payload.no_verdict, [BROWSER]);
  assert.equal(payload.results.at(-1).command, BROWSER);
  assert.equal(payload.results.at(-1).result, 'refused');
});

test('integrate: a non-zero exit without the line fails as today, and nothing runs again', (t) => {
  const f = hostTree(t, configOf({ integrate: [...INTEGRATE, BROKEN], refused: REFUSED }));
  const result = integrate(f);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^FAIL \d+s node remote\.cjs direct false -> /m);
  assert.match(result.out, /1 of 7 integrate command\(s\) failed; send every failure above to the builder in one correction\./);
  assert.doesNotMatch(result.out, /NO VERDICT|no verdict/);
  assert.deepEqual(counted(f), { open: 1, run: 6, close: 1, direct: 0 });
});

test('integrate: an open that fails without a line the key matches fails every check as today', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE, refused: "'^REFUSED '" }));
  const result = integrate(f, 'open@1=fail');
  assert.equal(result.code, 2, result.out + result.err);
  for (const command of REMOTE_CHECKS) assert.match(result.out, new RegExp(`^FAIL 0s ${command} -> `, 'm'));
  assert.match(result.out, /5 of 6 integrate command\(s\) failed/);
  assert.deepEqual(counted(f), { open: 1, run: 0, close: 1, direct: 0 });
});

test('integrate: a real failure beside a refused check still goes to the builder, and the refused one reads no verdict', (t) => {
  const f = hostTree(t, configOf({ integrate: [...REMOTE_CHECKS, BROKEN], refused: REFUSED }));
  const result = integrate(f, 'run@2=fail,run@7=fail');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^FAIL \d+s node remote\.cjs direct false -> /m);
  assert.match(result.out, /^NO VERDICT node remote\.cjs direct echo two -> /m);
  assert.doesNotMatch(result.out, /^FAIL \d+s node remote\.cjs direct echo two/m);
  assert.match(result.out, /1 of 6 integrate command\(s\) failed; send every failure above to the builder in one correction\./);
  assert.deepEqual(counted(f), { open: 2, run: 7, close: 2, direct: 0 }, 'the refused check ran again in a fresh session');
});

test('integrate: a check outside a session runs once more, and a second refusal is no verdict', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE, session: false, refused: REFUSED }));
  const once = integrate(f, 'direct@2=fail');
  assert.equal(once.code, 0, once.out + once.err);
  assert.deepEqual(counted(f), { open: 0, run: 0, close: 0, direct: 6 });
  assert.equal(calls(f, 'direct').at(-1).test, 'echo two', 'only the refused check ran again');

  const other = hostTree(t, configOf({ integrate: INTEGRATE, session: false, refused: REFUSED }));
  const twice = integrate(other, 'direct@1=fail,direct@6=fail');
  assert.equal(twice.code, NO_VERDICT, twice.out + twice.err);
  assert.doesNotMatch(twice.out, NO_FAIL);
  assert.match(twice.out, /^NO VERDICT node remote\.cjs direct echo one -> /m);
  assert.match(twice.out, /^1 of 6 integrate check\(s\) got no verdict/m);
});

test('integrate: a check that prints the line and exits 0 passes', (t) => {
  const printed = "echo 'the wrapper refused'";
  const f = hostTree(t, configOf({ integrate: [printed], session: false, refused: REFUSED }));
  const result = integrate(f);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^PASS \d+s echo 'the wrapper refused'$/m);
});

test('a host without the key sees a refused open as a failed check, as today', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE }));
  const result = integrate(f, 'open@1=fail');
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /5 of 6 integrate command\(s\) failed/);
  assert.deepEqual(counted(f), { open: 1, run: 0, close: 1, direct: 0 });
});

test('gate: a refused first open and a good second give a green gate with two opens', (t) => {
  const f = hostTree(t, configOf({ finalize: REMOTE_CHECKS, refused: REFUSED }));
  const result = gate(f, 'open@1=fail');
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(counted(f), { open: 2, run: 5, close: 2, direct: 0 });
  assert.match(result.out, /^green /m);
  assert.equal(proofs(f).length, 5);
  assert.equal(run(f, ['green']).code, 0);
});

test('gate: two refused opens give the no-verdict exit, no red, and no proof', (t) => {
  const f = hostTree(t, configOf({ finalize: REMOTE_CHECKS, refused: REFUSED }));
  const result = gate(f, 'open@1=fail,open@2=fail');
  assert.equal(result.code, NO_VERDICT, result.out + result.err);
  assert.doesNotMatch(result.out, NO_FAIL);
  assert.doesNotMatch(result.out, BUILDER);
  assert.match(result.out, /^NO VERDICT node remote\.cjs direct echo one -> /m);
  assert.match(result.out.trim().split('\n').at(-1),
    /^5 of 5 finalize check\(s\) got no verdict: the host's wrapper ran nothing, twice, a fault of the test machine and not of the code; run the step again: run\.cjs gate --detach --tree \S+$/);
  assert.deepEqual(counted(f), { open: 2, run: 0, close: 2, direct: 0 });
  assert.equal(proofs(f).length, 0);
  assert.equal(run(f, ['green']).code, 3);
});

test('gate: a non-zero exit without the line is red as today', (t) => {
  const f = hostTree(t, configOf({ finalize: [...REMOTE_CHECKS.slice(0, 2), BROKEN], refused: REFUSED }));
  const result = gate(f);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^FAIL \d+s node remote\.cjs direct false -> /m);
  assert.doesNotMatch(result.out, /NO VERDICT|no verdict/);
  assert.deepEqual(counted(f), { open: 1, run: 3, close: 1, direct: 0 });
});

test('gate --wait reads a detached gate that got no verdict with the no-verdict exit and its line', (t) => {
  const f = hostTree(t, configOf({ finalize: REMOTE_CHECKS, refused: REFUSED }));
  const detached = run(f, ['gate', '--detach'], { act: 'open@1=fail,open@2=fail' });
  assert.equal(detached.code, 0, detached.out + detached.err);
  let waited = run(f, ['gate', '--wait', '--minutes', '1']);
  for (let i = 0; i < 20 && waited.code === 4; i += 1) waited = run(f, ['gate', '--wait', '--minutes', '1']);
  assert.equal(waited.code, NO_VERDICT, waited.out + waited.err);
  assert.doesNotMatch(waited.out, NO_FAIL);
  assert.match(waited.out, /^NO VERDICT node remote\.cjs direct echo one -> /m);
  assert.match(waited.out, /^5 of 5 finalize check\(s\) got no verdict: .*run the step again: run\.cjs gate --detach --tree \S+$/m);
});

test('gate --wait gives up the merge slot ticket of a gate that got no verdict', (t) => {
  const f = hostTree(t, `${configOf({ finalize: REMOTE_CHECKS, refused: REFUSED })}  merge_slot: true\n`);
  const cache = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = f.cache;
  t.after(() => {
    if (cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = cache;
  });
  const detached = run(f, ['gate', '--detach'], { act: 'open@1=fail,open@2=fail' });
  assert.equal(detached.code, 0, detached.out + detached.err);
  assert.equal(slot.queue(f.tree).tickets.length, 1, 'the gate holds a ticket while it runs');
  let waited = run(f, ['gate', '--wait', '--minutes', '1']);
  for (let i = 0; i < 20 && waited.code === 4; i += 1) waited = run(f, ['gate', '--wait', '--minutes', '1']);
  assert.equal(waited.code, NO_VERDICT, waited.out + waited.err);
  assert.deepEqual(slot.queue(f.tree).tickets, [], 'the ticket is given up');
});

test('verification.refused is a regex an empty line does not match, refused as BAD_CONFIG otherwise, and a --config file inherits it', (t) => {
  const f = hostTree(t, configOf({ integrate: INTEGRATE, refused: REFUSED }));
  write(f.dir, 'other.yaml', 'verification:\n  integrate:\n    - echo other\n');
  assert.equal(lib.readConfig(f.tree, path.join(f.dir, 'other.yaml')).verification.refused, '^the wrapper refused$');
  write(f.dir, 'own.yaml', "verification:\n  integrate:\n    - echo other\n  refused: '^REFUSED '\n");
  assert.equal(lib.readConfig(f.tree, path.join(f.dir, 'own.yaml')).verification.refused, '^REFUSED ');

  for (const [value, why] of [
    ["'.*'", /verification\.refused in \S+ must be a regex that an empty line does not match, or every failed check reads as refused\./],
    ["''", /verification\.refused in \S+ must be a non-empty regex\./],
    ["'^(REFUSED'", /verification\.refused in \S+ must be a regex \(/],
    ['[a, b]', /verification\.refused in \S+ must be a non-empty regex\./],
  ]) {
    write(f.dir, 'bad.yaml', `verification:\n  integrate:\n    - echo other\n  refused: ${value}\n`);
    const result = run(f, ['integrate', '--tree', f.tree, '--config', path.join(f.dir, 'bad.yaml')]);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, /BAD_CONFIG/);
    assert.match(result.err, why);
    assert.ok(result.err.includes(path.join(f.dir, 'bad.yaml')), result.err);
  }
  assert.deepEqual(calls(f), [], 'a refused config runs nothing');
});

test('the refused line the config example documents under verification reads as the key this runner takes', (t) => {
  const example = require('node:fs').readFileSync(path.join(__dirname, '../../../config.example.yaml'), 'utf8');
  const at = example.indexOf('\n  # refused:');
  assert.ok(at > 0 && at < example.indexOf('\ndoubles:'), 'the refused line sits in the verification block');
  const line = example.slice(at + 1).split('\n')[0].replace(/^ {2}# /, '  ').replace(/\s+# .*$/, '');
  const f = hostTree(t, `verification:\n  integrate:\n    - echo one\n${line}\n`);
  const refused = new RegExp(lib.readConfig(f.tree).verification.refused);
  assert.ok(refused.test('remote-run: REFUSED [machine] the test machine did not answer, no verdict'));
  assert.ok(!refused.test('test result: FAILED. 1 passed; 1 failed'));
});
