/**
 * Unit tests for lib/test-files.cjs of the AI-DLC Turbo flow.
 *
 * story-verify.cjs and story-mutate.cjs both need to know what a test file is
 * and which added line switches a test off:
 * - test files by path, per language, plus the Playwright folder of repo.yaml;
 * - the switch-off markers of JS/TS, Java, Python and Go, never a lookalike.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const { isTestFile, isSwitchOff } = createRequire(import.meta.url)(path.join(FLOW, 'scripts/lib/test-files.cjs'));

describe('aidlc-turbo test-files isTestFile', () => {
  it.each([
    'src/login.test.ts', 'web/app.spec.tsx', 'src/__tests__/login.ts', 'src/__snapshots__/x.test.ts.snap',
    'src/test/java/com/shop/LoginTest.java', 'core/src/main/java/LoginTests.java', 'core/LoginIT.java',
    'module/src/test/resources/data.xml',
    'test_login.py', 'pkg/login_test.py', 'tests/helpers.py', 'pkg/test/conftest.py',
    'pkg/login_test.go',
  ])('%s is a test file', (file) => {
    expect(isTestFile(file, null)).toBe(true);
  });

  it.each([
    'src/login.ts', 'src/testing.ts', 'src/latest.js', 'src/main/java/Tester.java', 'src/contest.py',
    'pkg/login.go', 'src/tests.ts', 'attest/x.js', 'e2e/login.ts',
  ])('%s is no test file', (file) => {
    expect(isTestFile(file, null)).toBe(false);
  });

  it('counts everything under the Playwright folder, and Windows separators', () => {
    expect(isTestFile('e2e/login.ts', 'e2e')).toBe(true);
    expect(isTestFile('e2e/pages/login-page.ts', './e2e/')).toBe(true);
    expect(isTestFile('e2e-other/login.ts', 'e2e')).toBe(false);
    expect(isTestFile('src\\__tests__\\a.ts', null)).toBe(true);
  });
});

describe('aidlc-turbo test-files isSwitchOff', () => {
  it.each([
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
  ])('%s switches a test off', (line) => {
    expect(isSwitchOff(line)).toBe(true);
  });

  it.each([
    "it('logs in', () => {",
    "test('skip the header', () => {",
    "const items = list.skip(2);",
    'model.fit(data)',
    'outfit(x)',
    '@DisabledOnOs(OS.WINDOWS)',
    '@Ignored',
    '@pytest.mark.parametrize("a", [1])',
    't.Run("x", func(t *testing.T) {',
    'expected_xfail = 1',
    'result.fails(x)',
  ])('%s does not', (line) => {
    expect(isSwitchOff(line)).toBe(false);
  });
});
