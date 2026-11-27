'use strict';

// The proof verify-item writes for an item, driven through run.cjs the way the orchestrator
// does: the commands it ran, the hash of the item's diff and the tests the item changed.
// The ownership verify-item checks beside it: run-attribution.test.cjs.

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');
const { parseCounts, proofPath, readItemProof } = require('./run-item-proof.cjs');

// Fifty numbered lines, then a vitest summary: the proof keeps the last forty.
const NOISY = 'node -e "for (let i = 1; i <= 50; i += 1) console.log(\'line \' + i); console.log(\' Tests  2 failed | 5 passed (7)\')"';

/** The proof module reads the cache from the environment, as the child process did. */
function inCache(t, f) {
  const before = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = f.cache;
  t.after(() => {
    if (before === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = before;
  });
}

test('verify-item writes the proof: each command with its exit, seconds, counts and last 40 lines, the diff hash and tests_changed', (t) => {
  const f = fixture(t, { a: { editable: ['a.cjs', 'a.test.cjs'], check: NOISY } });
  inCache(t, f);
  const dispatch = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('a.test.cjs', "test('two', () => {});\n");
  f.accepted(dispatch, ['a.cjs', 'a.test.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);

  const file = proofPath(f.root, 'alpha', 'a');
  assert.equal(file, path.join(f.cache, 'specsmd-inferno', 'repo', 'item-proofs', 'alpha', 'a.json'));
  assert.equal(result.data.proof, file);
  const proof = readItemProof(f.root, 'alpha', 'a');
  assert.deepEqual(proof, JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(proof.item, 'a');
  assert.equal(proof.intent, 'alpha');
  assert.deepEqual(proof.items, ['a']);
  assert.equal(proof.passed, true);
  assert.ok(Number.isFinite(Date.parse(proof.finished_at)));

  assert.equal(proof.commands.length, 1);
  const [command] = proof.commands;
  assert.equal(command.item, 'a');
  assert.equal(command.command, NOISY);
  assert.equal(command.exit, 0);
  assert.ok(Number.isFinite(command.seconds) && command.seconds >= 0);
  assert.deepEqual(command.counts, { passed: 5, failed: 2 });
  assert.equal(command.tail.length, 40);
  assert.equal(command.tail[0], 'line 12');
  assert.equal(command.tail[39], ' Tests  2 failed | 5 passed (7)');
  assert.ok(!JSON.stringify(proof).includes('"line 11"'), 'the proof keeps no line before the last forty');

  // The diff is the item's own since its dispatch baseline: the range its review reads once it is committed.
  assert.equal(proof.diff.from, result.data.since);
  assert.deepEqual(proof.diff.paths, ['a.cjs', 'a.test.cjs']);
  assert.match(proof.diff.sha256, /^[0-9a-f]{64}$/);
  f.land('a.cjs', 'a.test.cjs');
  const committed = f.git('diff', '--full-index', '--binary', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv',
    '--src-prefix=a/', '--dst-prefix=b/', proof.diff.from, 'HEAD', '--', 'a.cjs', 'a.test.cjs');
  assert.equal(proof.diff.sha256, createHash('sha256').update(`${committed}\n`).digest('hex'));

  assert.deepEqual(proof.tests_changed, { modified: ['a.test.cjs'], deleted: [], switched_off: [] });
});

test('a runner the count parser does not know leaves the counts null and passes', (t) => {
  const f = fixture(t, { a: { editable: ['a.cjs'], check: 'node -e "console.log(\'all good\')"' } });
  inCache(t, f);
  const dispatch = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(dispatch, ['a.cjs']);
  assert.equal(f.verify('a').code, 0);
  const [command] = readItemProof(f.root, 'alpha', 'a').commands;
  assert.equal(command.counts, null);
  assert.deepEqual(command.tail, ['all good']);
});

test('a line that switches a test off fails verify-item and is named with its file and line', (t) => {
  const f = fixture(t, { a: { editable: ['a.cjs', 'a.test.cjs', 'kept.test.cjs', 'spec/'], check: 'node -e "0"' } });
  inCache(t, f);
  f.write('kept.test.cjs', "test.skip('was already off', () => {});\n");
  f.land('kept.test.cjs');
  const dispatch = f.start('--item', 'a');
  f.write('a.cjs', "test.skip('not a test file', () => {});\n");
  f.write('a.test.cjs', "test('one', () => {});\ntest.skip('two', () => {});\n");
  f.write('kept.test.cjs', "test.skip('was already off', () => {});\ntest('more', () => {});\n");
  f.write('spec/new.test.cjs', "test('a', () => {});\ntest('b', { skip: true }, () => {});\n");
  f.accepted(dispatch, ['a.cjs', 'a.test.cjs', 'kept.test.cjs', 'spec/new.test.cjs']);

  const human = f.human('verify-item', 'a', '--tree', f.root);
  assert.equal(human.code, 2, human.out);
  assert.match(human.out, /^switched off: a\.test\.cjs:2: test\.skip\('two', \(\) => \{\}\);$/m);
  assert.match(human.out, /^switched off: spec\/new\.test\.cjs:2: test\('b', \{ skip: true \}, \(\) => \{\}\);$/m);
  assert.doesNotMatch(human.out, /switched off: (?:a\.cjs|kept\.test\.cjs)/);

  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.outside, []);
  const proof = readItemProof(f.root, 'alpha', 'a');
  assert.equal(proof.passed, false);
  assert.deepEqual(proof.tests_changed.switched_off, [
    { file: 'a.test.cjs', line: 2, text: "test.skip('two', () => {});" },
    { file: 'spec/new.test.cjs', line: 2, text: "test('b', { skip: true }, () => {});" },
  ]);
});

test('a modified and a deleted existing test file are in tests_changed, and a new test file is not', (t) => {
  const f = fixture(t, { a: { editable: ['a.cjs', 'kept.test.cjs', 'old.test.cjs', 'spec/'], check: 'node -e "0"' } });
  inCache(t, f);
  const dispatch = f.start('--item', 'a');
  f.write('kept.test.cjs', "test('kept, changed', () => {});\n");
  fs.rmSync(path.join(f.root, 'old.test.cjs'));
  f.write('spec/new.test.cjs', "test('new', () => {});\n");
  f.write('a.cjs', 'module.exports = 2;\n');
  f.accepted(dispatch, ['a.cjs', 'kept.test.cjs', 'old.test.cjs', 'spec/new.test.cjs']);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  const proof = readItemProof(f.root, 'alpha', 'a');
  assert.deepEqual(proof.tests_changed, { modified: ['kept.test.cjs'], deleted: ['old.test.cjs'], switched_off: [] });
  assert.deepEqual(proof.diff.paths, ['a.cjs', 'kept.test.cjs', 'old.test.cjs', 'spec/new.test.cjs']);
});

test('a second verify-item on an unchanged item rewrites the same proof', (t) => {
  const f = fixture(t, { a: { editable: ['a.cjs', 'a.test.cjs'], check: NOISY } });
  inCache(t, f);
  const dispatch = f.start('--item', 'a');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('a.test.cjs', "test('two', () => {});\n");
  f.accepted(dispatch, ['a.cjs', 'a.test.cjs']);
  const status = f.git('status', '--porcelain');
  assert.equal(f.verify('a').code, 0);
  const first = readItemProof(f.root, 'alpha', 'a');
  assert.equal(f.verify('a').code, 0);
  const second = readItemProof(f.root, 'alpha', 'a');
  assert.deepEqual(fs.readdirSync(path.dirname(proofPath(f.root, 'alpha', 'a'))), ['a.json']);
  const stable = ({ finished_at: _at, commands, ...rest }) =>
    ({ ...rest, commands: commands.map(({ seconds: _seconds, log: _log, ...command }) => command) });
  assert.deepEqual(stable(second), stable(first));
  assert.equal(f.git('status', '--porcelain'), status, 'the proof leaves the index and the tree as they were');
});

test('a batch writes its proof for each of its items', (t) => {
  const f = fixture(t, { a: { editable: ['a.cjs'], check: 'node -e "0"' }, b: { editable: ['b.cjs'], check: 'node -e "0"' } });
  inCache(t, f);
  const chain = f.start('--items', 'a,b');
  f.write('a.cjs', 'module.exports = 2;\n');
  f.write('b.cjs', 'module.exports = 2;\n');
  f.accepted(chain, ['a.cjs', 'b.cjs']);
  assert.equal(f.verify('--items', 'a,b').code, 0);
  for (const id of ['a', 'b']) {
    const proof = readItemProof(f.root, 'alpha', id);
    assert.equal(proof.item, id);
    assert.deepEqual(proof.items, ['a', 'b']);
    assert.deepEqual(proof.commands.map((command) => command.item), ['a', 'b']);
    assert.deepEqual(proof.diff.paths, ['a.cjs', 'b.cjs']);
  }
  assert.equal(readItemProof(f.root, 'alpha', 'missing'), null);
});

test('the counts of each runner the proof reads, and null where none shows', () => {
  const cases = [
    ['vitest', '\x1b[2m Tests \x1b[22m 1 failed | 13 passed (14)', 13, 1],
    ['jest', 'Tests:       1 failed, 13 passed, 14 total', 13, 1],
    ['node --test', 'ℹ tests 14\nℹ suites 0\nℹ pass 13\nℹ fail 1\nℹ cancelled 0', 13, 1],
    ['node --test tap', '# tests 3\n# pass 3\n# fail 0', 3, 0],
    ['cargo', 'test result: ok. 4 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s\n' +
      'test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s', 6, 1],
    ['playwright', 'Running 9 tests using 2 workers\n  1 failed\n    [chromium] login.spec.ts:3:1 logs in\n  8 passed (4.2s)', 8, 1],
    ['mocha', '  14 passing (20ms)\n  2 failing', 14, 2],
    ['pytest', '===== 13 passed, 1 failed, 2 warnings in 0.52s =====', 13, 1],
    ['pytest -q', '13 passed in 0.10s', 13, 0],
    ['go test -v', '--- PASS: TestA (0.00s)\n--- PASS: TestB (0.00s)\n--- FAIL: TestC (0.00s)\nFAIL', 2, 1],
    ['dotnet', 'Passed!  - Failed:     0, Passed:    14, Skipped:     0, Total:    14\nFailed!  - Failed:     1, Passed:     2, Skipped:     0, Total:     3', 16, 1],
    ['phpunit ok', 'OK (14 tests, 30 assertions)', 14, 0],
    ['phpunit failed', 'Tests: 14, Assertions: 30, Errors: 1, Failures: 2.', 11, 3],
    ['maven', 'Tests run: 3, Failures: 0, Errors: 0, Skipped: 0\nResults:\nTests run: 14, Failures: 1, Errors: 0, Skipped: 1', 12, 1],
  ];
  for (const [name, output, passed, failed] of cases) assert.deepEqual(parseCounts(output), { passed, failed }, name);
  assert.equal(parseCounts('ok  \texample.com/pkg\t0.01s\nBUILD SUCCESS'), null);
  assert.equal(parseCounts(''), null);
});
