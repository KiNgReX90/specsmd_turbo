'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const lib = require('./run-lib.cjs');
const { NO_VERDICT } = require('./run-exit.cjs');
const { readRun } = require('./run-check-refused.cjs');
const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');
const { REFUSED, REMOTE_CHECKS, calls, configOf, counted, hostTree, run, write } = require('./run-check-session-fixture.cjs');

// A refusal is read only where a host's wrapper writes one: the last non-empty line of the run,
// on the wrapper's refusal exit (`verification.refused_exit`) where the host names it. A suite
// whose tests print a refusal line as a fixture and then fail for a real reason is a red, never
// "no verdict, a fault of the test machine", so its failure goes to the builder and the step does
// not rerun it without end.

const integrate = (f, act) => run(f, ['integrate', '--tree', f.tree], { act });
const NO_VERDICT_LINE = /NO VERDICT|no verdict/;
const exitKey = (code) => `  refused_exit: ${code}\n`;

/** A config of the one direct check `command`, with the fake wrapper's refusal regex and `extra` lines under verification. */
const direct = (command, extra = '') => configOf({ integrate: [command], session: false, refused: REFUSED }) + extra;

test('integrate: a suite that prints a refusal line as a fixture and then fails for a real reason is a red, with or without refused_exit', (t) => {
  const command = "echo 'the wrapper refused'; echo '1 failing test'; exit 1";
  for (const extra of ['', exitKey(75)]) {
    const f = hostTree(t, direct(command, extra));
    const result = integrate(f);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.out, /^FAIL \d+s echo 'the wrapper refused'; echo '1 failing test'; exit 1 -> /m);
    assert.match(result.out, /1 of 1 integrate command\(s\) failed; send every failure above to the builder in one correction\./);
    assert.doesNotMatch(result.out, NO_VERDICT_LINE);
  }
});

test('integrate: a last line that matches on an exit other than refused_exit is a red', (t) => {
  const f = hostTree(t, direct("echo 'the wrapper refused'; exit 1", exitKey(75)));
  const result = integrate(f);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^FAIL \d+s /m);
  assert.doesNotMatch(result.out, NO_VERDICT_LINE);
});

test('integrate: a last line that matches on the refusal exit is refused, runs once more, and twice ends with exit 5 and the run-again line', (t) => {
  const f = hostTree(t, direct("echo 'the suite started'; echo 'the wrapper refused'; exit 75", exitKey(75)));
  const result = integrate(f);
  assert.equal(result.code, NO_VERDICT, result.out + result.err);
  assert.doesNotMatch(result.out, /^FAIL /m);
  assert.match(result.out, /^NO VERDICT echo 'the suite started'; echo 'the wrapper refused'; exit 75 -> \S+\nthe wrapper refused$/m);
  assert.match(result.out.trim().split('\n').at(-1),
    /^1 of 1 integrate check\(s\) got no verdict: the host's wrapper ran nothing, twice, a fault of the test machine and not of the code; run the step again: run\.cjs integrate --tree \S+$/);
});

/** A host whose session opens with `../open.sh`, the script `body` beside the tree. */
function openHost(t, body, extra) {
  const block = "  session:\n    match: '^node remote\\.cjs direct '\n    open: bash ../open.sh\n    run: node remote.cjs run\n    close: node remote.cjs close\n";
  const f = hostTree(t, configOf({ integrate: REMOTE_CHECKS.slice(0, 2), session: false, refused: REFUSED }) + block + extra);
  writeFile(path.join(f.dir, 'open.sh'), body);
  return f;
}

test('integrate: a session open whose refusal line is not its last line fails its checks, as an open that failed', (t) => {
  const f = openHost(t, "echo 'the wrapper refused'\necho 'the open broke for a reason of its own'\nexit 75\n", exitKey(75));
  const result = integrate(f);
  assert.equal(result.code, 2, result.out + result.err);
  for (const command of REMOTE_CHECKS.slice(0, 2)) assert.match(result.out, new RegExp(`^FAIL 0s ${command} -> `, 'm'));
  assert.doesNotMatch(result.out, NO_VERDICT_LINE);
  assert.deepEqual(counted(f), { open: 0, run: 0, close: 1, direct: 0 });
});

test('integrate: a session open whose last line is the refusal on the refusal exit gives its checks no verdict', (t) => {
  const f = openHost(t, "echo 'syncing the tree'\necho 'the wrapper refused'\nexit 75\n", exitKey(75));
  const result = integrate(f);
  assert.equal(result.code, NO_VERDICT, result.out + result.err);
  for (const command of REMOTE_CHECKS.slice(0, 2)) assert.match(result.out, new RegExp(`^NO VERDICT ${command} -> \\S+\nthe wrapper refused$`, 'm'));
  assert.deepEqual(counted(f), { open: 0, run: 0, close: 2, direct: 0 }, 'the open ran twice, each in a fresh session');
});

const CONFIG = { verification: { refused: '^REFUSED [a-z]+$', refused_exit: '75' } };

/** Read one run of `command` with `config`, its log in a fresh folder, `before` written there first. */
function read(t, command, config = CONFIG, before = '') {
  const dir = tempDir('inferno-refused-last-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'check.log');
  if (before) writeFile(log, before);
  return readRun(config, lib.runShell, command, dir, log).line;
}

test('the last non-empty line is read past trailing blank and blank-looking lines, without a final newline, CR and colour codes', (t) => {
  for (const command of [
    "printf 'REFUSED x\\n\\n\\n'",
    "printf 'REFUSED x\\n  \\t\\n'",
    "printf 'started\\nREFUSED x'",
    "printf 'REFUSED x\\r\\n\\r\\n'",
    "printf 'syncing 50%%\\rREFUSED x\\n'",
    "printf '\\033[1;31mREFUSED x\\033[0m\\n\\033[0m\\n'",
  ]) assert.equal(read(t, `${command}; exit 75`), 'REFUSED x', command);
});

test('a refusal line anywhere but last, on an exit of 0 or another exit, or before this run started is no refusal', (t) => {
  assert.equal(read(t, "printf 'REFUSED x\\nreal failure\\n'; exit 75"), null);
  assert.equal(read(t, "printf 'REFUSED x\\rreal failure\\n'; exit 75"), null);
  assert.equal(read(t, "printf 'REFUSED x\\n'; exit 1"), null);
  assert.equal(read(t, "printf 'REFUSED x\\n'", { verification: { refused: '^REFUSED [a-z]+$' } }), null);
  assert.equal(read(t, 'exit 75', CONFIG, 'REFUSED x\n'), null);
  assert.equal(read(t, "printf 'REFUSED x\\n'; exit 75", { verification: {} }), null);
  assert.equal(read(t, 'exit 75', { verification: { refused: '^[a-z]+$', refused_exit: '75' } }), null, 'a run that printed nothing');
});

test('without refused_exit any non-zero exit whose last line matches is refused, as before', (t) => {
  assert.equal(read(t, "printf 'REFUSED x\\n'; exit 3", { verification: { refused: '^REFUSED [a-z]+$' } }), 'REFUSED x');
});

test('a run whose log was never written has no refusal line', () => {
  const shell = (command, cwd, log) => ({ command, code: 75, signal: null, seconds: 0, log });
  const log = path.join(tempDir('inferno-refused-none-'), 'never.log');
  assert.equal(readRun({ verification: { refused: '^[a-z]+$' } }, shell, 'true', __dirname, log).line, null);
});

test('verification.refused_exit is an exit code from 1 to 255 beside refused, refused as BAD_CONFIG otherwise, and a --config file inherits it', (t) => {
  const f = hostTree(t, direct('echo one', exitKey(75)));
  const config = (name, body) => {
    write(f.dir, name, `verification:\n  integrate:\n    - echo other\n${body}`);
    return path.join(f.dir, name);
  };
  assert.equal(lib.readConfig(f.tree, config('inherit.yaml', '')).verification.refused_exit, '75');
  assert.equal(lib.readConfig(f.tree, config('own.yaml', '  refused_exit: "255"\n')).verification.refused_exit, '255');
  assert.equal(lib.readConfig(f.tree, config('low.yaml', '  refused_exit: 1\n')).verification.refused_exit, '1');

  for (const value of ['0', '256', '075', '7.5', '-1', 'abc', '[75]']) {
    const file = config('bad.yaml', `  refused_exit: ${value}\n`);
    const result = run(f, ['integrate', '--tree', f.tree, '--config', file]);
    assert.equal(result.code, 2, value + result.out + result.err);
    assert.match(result.err, /BAD_CONFIG/);
    assert.ok(result.err.includes(`verification.refused_exit in ${file} must be an exit code from 1 to 255: "refused_exit: 75" under verification:.`), value + result.err);
  }

  const bare = hostTree(t, configOf({ integrate: ['echo one'], session: false }) + exitKey(75));
  const result = run(bare, ['integrate', '--tree', bare.tree]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /BAD_CONFIG/);
  assert.match(result.err, /verification\.refused_exit in \S+config\.yaml needs verification\.refused, the line the host's wrapper prints when it ran nothing\./);
  assert.deepEqual(calls(f), [], 'a refused config runs nothing');
});

test('the refused_exit line the config example documents beside refused reads as the key this runner takes', (t) => {
  const example = fs.readFileSync(path.join(__dirname, '../../../config.example.yaml'), 'utf8');
  const lineOf = (key) => {
    const at = example.indexOf(`\n  # ${key}:`);
    assert.ok(at > 0 && at < example.indexOf('\ndoubles:'), `the ${key} line sits in the verification block`);
    return { at, line: example.slice(at + 1).split('\n')[0].replace(/^ {2}# /, '  ').replace(/\s+# .*$/, '') };
  };
  const refused = lineOf('refused');
  const exit = lineOf('refused_exit');
  assert.equal(example.slice(refused.at + 1).split('\n')[1], example.slice(exit.at + 1).split('\n')[0], 'it sits right after refused');
  const f = hostTree(t, `verification:\n  integrate:\n    - echo one\n${refused.line}\n${exit.line}\n`);
  assert.equal(lib.readConfig(f.tree).verification.refused_exit, '75');
});
