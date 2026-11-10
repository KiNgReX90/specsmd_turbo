'use strict';

// What a test file is, which added line switches a test off, and which lines a diff adds:
// the rules verify-item reads for tests_changed. Ported from the Turbo flow's rules, plus the
// Rust and node runners the INFERNO scripts run.

const assert = require('node:assert/strict');
const test = require('node:test');

const { isSwitchOff, isTestFile, parseAddedLines } = require('./run-test-files.cjs');

test('a test file is known by its name or its folder, per language', () => {
  for (const file of [
    'src/login.test.ts', 'web/app.spec.tsx', 'src/__tests__/login.ts', 'src/__snapshots__/x.test.ts.snap',
    'src/test/java/com/shop/LoginTest.java', 'core/src/main/java/LoginTests.java', 'core/LoginIT.java',
    'module/src/test/resources/data.xml',
    'test_login.py', 'pkg/login_test.py', 'tests/helpers.py', 'pkg/test/conftest.py',
    'pkg/login_test.go',
    'scripts/run-gate.test.cjs', 'lib/cart.test.mjs', 'lib/cart-test.cjs', 'lib/cart_test.mjs',
    'crate/tests/checkout.rs', 'crate/src/cart/tests.rs', 'crate/src/cart_test.rs', 'crate/src/cart_tests.rs',
    'src\\__tests__\\a.ts', './src/login.test.ts',
  ]) {
    assert.equal(isTestFile(file), true, file);
  }
});

test('a source file that only looks like a test is none', () => {
  for (const file of [
    'src/login.ts', 'src/testing.ts', 'src/latest.js', 'src/main/java/Tester.java', 'src/contest.py',
    'pkg/login.go', 'src/tests.ts', 'attest/x.js', 'e2e/login.ts',
    'scripts/test-write.cjs', 'scripts/run-attribution-fixture.cjs', 'crate/src/testing.rs', 'crate/src/attests.rs',
  ]) {
    assert.equal(isTestFile(file), false, file);
  }
});

test('each runner\'s way of switching a test off is found', () => {
  for (const line of [
    "it.skip('logs in', () => {",
    "  test.only('logs in', async () => {",
    "describe.todo('later')",
    "context.skip('x', () => {})",
    "suite.only('x', () => {})",
    "test.describe.skip('playwright', () => {",
    "it.skip.each([1, 2])('n %i', (n) => {",
    "xit('logs in', () => {",
    "xdescribe('login', () => {",
    "xtest('x', () => {})",
    "fit('focused', () => {",
    "fdescribe('focused', () => {",
    '    @Disabled("flaky")',
    '    @Ignore',
    '@pytest.mark.skip(reason="later")',
    '@pytest.mark.skipif(sys.platform == "win32", reason="x")',
    '@unittest.skip("later")',
    '    pytest.skip("not now")',
    '\tt.Skip("later")',
    '\tt.Skipf("later %d", 1)',
    '@pytest.mark.xfail(reason="bug")',
    '    pytest.xfail("known bug")',
    "it.fails('is red on purpose', () => {",
    "test.fails('is red on purpose', () => {",
    // node --test
    "test('refunds a gift card', { skip: true }, () => {",
    "test('refunds a gift card', { todo: 'after the ledger' }, () => {",
    "describe('cart', { only: true }, () => {",
    "it('pays', { timeout: 50, skip: process.platform === 'win32' }, () => {",
    '  t.skip(\'not on this host\');',
    '  t.todo();',
    // cargo test
    '#[ignore]',
    '    #[ignore = "slow"]',
    '#[cfg_attr(windows, ignore)]',
  ]) {
    assert.equal(isSwitchOff(line), true, line);
  }
});

test('a line that only looks like a switch-off is none', () => {
  for (const line of [
    "it('logs in', () => {",
    "test('skip the header', () => {",
    'const items = list.skip(2);',
    'model.fit(data)',
    'outfit(x)',
    '@DisabledOnOs(OS.WINDOWS)',
    '@Ignored',
    '@pytest.mark.parametrize("a", [1])',
    't.Run("x", func(t *testing.T) {',
    'expected_xfail = 1',
    'result.fails(x)',
    "test('pays', { skip: false }, () => {",
    "test('pays', { timeout: 50 }, () => {",
    'assert.deepEqual(plan, { skip: 2, only: 1 });',
    'const skip = true;',
    'cart.skip(1);',
    '#[test]',
    '#[should_panic]',
    '// #[ignore] would hide this test',
    "assert.equal(t.name, 'skip');",
  ]) {
    assert.equal(isSwitchOff(line), false, line);
  }
});

test('the added lines of a zero-context diff carry their line in the new file', () => {
  const diff = [
    'diff --git a/cart.test.cjs b/cart.test.cjs',
    'index 1111111..2222222 100644',
    '--- a/cart.test.cjs',
    '+++ b/cart.test.cjs',
    '@@ -2 +2 @@ test(\'a\', () => {',
    "-test('b', () => {});",
    "+test.skip('b', () => {});",
    '@@ -5,0 +6,2 @@',
    "+test('c', () => {});",
    "+xit('d', () => {});\r",
    '@@ -9,2 +11,0 @@',
    '-gone',
    '-gone too',
    '@@ -20 +21 @@',
    '++counter;',
  ].join('\n');
  assert.deepEqual(parseAddedLines(diff), [
    { line: 2, text: "test.skip('b', () => {});" },
    { line: 6, text: "test('c', () => {});" },
    { line: 7, text: "xit('d', () => {});" },
    { line: 21, text: '+counter;' },
  ]);
});

test('a new file\'s diff adds every line from the first', () => {
  const diff = ['new file mode 100644', '--- /dev/null', '+++ b/a.test.cjs', '@@ -0,0 +1,2 @@', '+one', '+two', ''].join('\n');
  assert.deepEqual(parseAddedLines(diff), [{ line: 1, text: 'one' }, { line: 2, text: 'two' }]);
  assert.deepEqual(parseAddedLines(''), []);
});
