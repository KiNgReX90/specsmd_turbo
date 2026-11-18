'use strict';

// How a moved test file's switch-off is told from a new one (run-test-moves.cjs): by the test it
// mutes, named by the marker's line, what it stands above when it is an attribute, and every line
// that encloses it. The same file read twice carries every switch-off; a marker put on another test,
// or a second one on the same test, is new. Driven through verify-item: run-test-moves.test.cjs.

const assert = require('node:assert/strict');
const test = require('node:test');

const { isSwitchOff } = require('./run-test-files.cjs');
const { switchOffCounts, uncarried } = require('./run-test-moves.cjs');

/** The lines of `after` that switch a test off which `before`, the file at its old path, did not, read as `file`. */
function fresh(file, before, after) {
  const off = after.split('\n').map((text, at) => ({ line: at + 1, text })).filter((entry) => isSwitchOff(entry.text, file));
  return uncarried(off, after, switchOffCounts(before, file)).map((entry) => entry.line);
}

const lines = (...rows) => `${rows.join('\n')}\n`;

// [what, file, before, after, the new lines of after]
const CASES = [
  ['a marker on a test\'s own line, put on another test', 'web/cart.test.js',
    lines("test.skip('one', () => {});", "test('two', () => {});"),
    lines("test('one', () => {});", "test.skip('two', () => {});"), [2]],
  ['a switch-off in a test body whose test opens the file, put in another test that opens it', 'web/cart.test.js',
    lines("test('one', (t) => {", '  t.skip();', '});', "test('two', () => {});"),
    lines("test('two', (t) => {", '  t.skip();', '});', "test('one', () => {});"), [2]],
  ['a switch-off in a test body under a blank line, put in another test', 'web/cart.test.js',
    lines("test('one', (t) => {", '', '  t.skip();', '});', "test('two', (t) => {", '', '});'),
    lines("test('one', (t) => {", '', '});', "test('two', (t) => {", '', '  t.skip();', '});'), [6]],
  ['a switched-off test the move puts lower in the file', 'web/cart.test.js',
    lines("test('one', (t) => {", '  t.skip();', '});', "test('two', () => {});"),
    lines("test('two', () => {});", "test('one', (t) => {", '  t.skip();', '});'), []],
  ['a skip in a branch of one test function, the branch put in another', 'pkg/cart_test.go',
    lines('func TestOne(t *testing.T) {', '\tif testing.Short() {', '\t\tt.Skip("slow")', '\t}', '}', '', 'func TestTwo(t *testing.T) {', '}'),
    lines('func TestOne(t *testing.T) {', '}', '', 'func TestTwo(t *testing.T) {', '\tif testing.Short() {', '\t\tt.Skip("slow")', '\t}', '}'), [6]],
  ['an #[ignore] above #[test], put above another fn', 'crate/src/cart_tests.rs',
    lines('#[ignore]', '#[test]', 'fn one() {}', '', '#[test]', 'fn two() {}'),
    lines('#[test]', 'fn one() {}', '', '#[ignore]', '#[test]', 'fn two() {}'), [4]],
  ['an #[ignore] with its reason under it, both put above another fn', 'crate/src/cart_tests.rs',
    lines('#[test]', '#[ignore]', '// needs a browser', 'fn one() {}', '', '#[test]', 'fn two() {}'),
    lines('#[test]', 'fn one() {}', '', '#[test]', '#[ignore]', '// needs a browser', 'fn two() {}'), [5]],
  ['an annotation over two lines with another one and a comment under it, put on another method', 'src/test/java/shop/CardTest.java',
    lines('class CardTest {', '    @Disabled(', '        "flaky on the build machine")', '    @Test', '    /* Needs the ledger. */',
      '    void refundsACard() {}', '', '    @Test', '    void chargesACard() {}', '}'),
    lines('class CardTest {', '    @Test', '    void refundsACard() {}', '', '    @Disabled(', '        "flaky on the build machine")', '    @Test',
      '    /* Needs the ledger. */', '    void chargesACard() {}', '}'), [5]],
  ['a decorator closed on a line of its own with a comment under it, put on another def', 'tests/test_cart.py',
    lines('@pytest.mark.skipif(', '    sys.platform == "win32",', '    reason="no ledger on this platform",', ')',
      '# The ledger runs on the build machine only.', 'def test_refund():', '    pass', '', '', 'def test_charge():', '    pass'),
    lines('def test_refund():', '    pass', '', '', '@pytest.mark.skipif(', '    sys.platform == "win32",', '    reason="no ledger on this platform",', ')',
      '# The ledger runs on the build machine only.', 'def test_charge():', '    pass'), [5]],
  ['a file the move indents twice as deep, nested tests and a body switch-off', 'web/cart.test.js',
    lines("describe('cart', () => {", "  describe('refunds', () => {", "    test('one', (t) => {", '      t.skip();', '    });', '  });', '});'),
    lines("describe('cart', () => {", "    describe('refunds', () => {", "        test('one', (t) => {", '            t.skip();', '        });', '    });', '});'), []],
  ['a module the move indents less deep, an #[ignore] above its fn', 'crate/src/cart_tests.rs',
    lines('mod tests {', '    #[test]', '    #[ignore]', '    fn one() {}', '}'),
    lines('mod tests {', '  #[test]', '  #[ignore]', '  fn one() {}', '}'), []],
  ['a second switch-off of the same kind on the same test', 'web/cart.test.js',
    lines("test.skip('one', () => {});"),
    lines("test.skip('one', () => {});", "test.skip('one', () => {});"), [2]],
  ['an attribute with nothing under it', 'crate/src/cart_tests.rs',
    '',
    lines('#[test]', 'fn one() {}', '#[ignore]'), [3]],
];

test('only switch-off lines are counted, each test as often as it is switched off', () => {
  const counts = switchOffCounts(lines("test('one', () => {});", "test.skip('two', () => {});", "test.skip('two', () => {});",
    "test('three', (t) => {", "  t.skip('later');", '});'), 'web/cart.test.js');
  assert.deepEqual([...counts.values()], [2, 1]);
});

for (const [what, file, before, after, expected] of CASES) {
  test(`${what}: carried when the file is the same, and new at ${JSON.stringify(expected)} when moved`, () => {
    assert.deepEqual(fresh(file, after, after), []);
    assert.deepEqual(fresh(file, before, after), expected);
  });
}
