'use strict';

// A test file an item moves keeps the switch-offs it already had (run-test-moves.cjs). verify-item
// still lists a move as its old path deleted and its new one added, and reads each switch-off line
// at the new path against the source as the diff's start held it: the same marker on the same test
// is not new, one the move adds or puts on another test is. Driven through run.cjs the way the
// orchestrator does, for a JavaScript and a Rust test file, committed, uncommitted and across a
// fold of the base. How a test is named: run-test-moves-keys.test.cjs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');

const JS_OLD = 'cards/balance.test.cjs';
const JS_NEW = 'wallet/balance.test.cjs';
// A node --test file with a switch-off on a test's own line, one under its options and one in its body.
const JS = [
  "const test = require('node:test');",
  "const balance = require('./balance.cjs');",
  '',
  "test.describe('gift card balance', () => {",
  "  test('starts at zero', () => {});",
  "  test('grows on a top-up', { skip: 'needs the ledger' }, () => {});",
  "  test.skip('shrinks on a spend', () => {});",
  "  test('expires after a year', (t) => {",
  "    t.skip('needs a clock');",
  '  });',
  "  test('refunds to the card', (t) => {",
  '    balance.refund(t);',
  '  });',
  '});',
  '',
].join('\n');
// The move's own edit: the module the file tests is one folder away now.
const MOVED_JS = JS.replace("'./balance.cjs'", "'../cards/balance.cjs'");
const SKIPPED_START = "  test.skip('starts at zero', () => {});";

const RS_OLD = 'src/gift_cards/balance_tests.rs';
const RS_NEW = 'src/wallet/balance_tests.rs';

/** A Rust test file of the named tests, `true` for one switched off with #[ignore] and the reason under it. */
const rust = (...tests) => ['use super::*;', '', ...tests.flatMap(([name, ignore]) => [
  '#[test]',
  ...(ignore ? ['#[ignore]', '// Runs on purpose with --ignored from the end-to-end suite.'] : []),
  `fn ${name}() {`, '    assert_eq!(1, 1);', '}', '',
])].join('\n');

/** An item `a` owning both folders of the JavaScript move, its test file landed with the module it tests. */
function jsIntent(t) {
  const f = fixture(t, { a: { editable: ['cards/', 'wallet/'], check: 'node -e "0"' } });
  f.write(JS_OLD, JS);
  f.write('cards/balance.cjs', 'exports.refund = () => {};\n');
  f.land(JS_OLD, 'cards/balance.cjs');
  return f;
}

function mv(f, from, to) {
  fs.mkdirSync(path.dirname(path.join(f.root, to)), { recursive: true });
  f.git('mv', from, to);
}

/** One builder's turn of item `a`: each [from, to] moved with git mv, then `edits` written, accepted with every path. */
function turn(f, moves, edits = {}) {
  const dispatch = f.start('--item', 'a');
  for (const [from, to] of moves) mv(f, from, to);
  for (const [file, body] of Object.entries(edits)) f.write(file, body);
  f.accepted(dispatch, [...new Set([...moves.flat(), ...Object.keys(edits)])]);
}

const switchedOff = (result) => result.data.tests_changed.switched_off;

test('a JavaScript test file moved with an edit keeps its switch-offs, and the listing reads the move as before', (t) => {
  const f = jsIntent(t);
  // The module beside it changes too: its line comes first in what git lists.
  turn(f, [[JS_OLD, JS_NEW]], { [JS_NEW]: MOVED_JS, 'cards/balance.cjs': 'exports.refund = () => 0;\n' });
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.tests_changed, { modified: [], deleted: [JS_OLD], switched_off: [] });
});

test('a switch-off the move adds fails the item at its line, in the shape every switch-off has', (t) => {
  const f = jsIntent(t);
  turn(f, [[JS_OLD, JS_NEW]], { [JS_NEW]: MOVED_JS.replace("  test('starts at zero', () => {});", SKIPPED_START) });
  const human = f.human('verify-item', 'a', '--tree', f.root);
  assert.equal(human.code, 2, human.out);
  assert.deepEqual(human.out.split('\n').filter((line) => line.startsWith('switched off:')),
    [`switched off: ${JS_NEW}:5: ${SKIPPED_START.trim()}`]);
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(switchedOff(result), [{ file: JS_NEW, line: 5, text: SKIPPED_START.trim() }]);
});

test('a switch-off moved to another test of the moved file is new, and so is a second one on the same test', (t) => {
  const f = jsIntent(t);
  const body = MOVED_JS
    .replace("    t.skip('needs a clock');\n", '')
    .replace('    balance.refund(t);\n', "    t.skip('needs a clock');\n    balance.refund(t);\n")
    .replace("  test.skip('shrinks on a spend', () => {});\n", "  test.skip('shrinks on a spend', () => {});\n".repeat(2));
  turn(f, [[JS_OLD, JS_NEW]], { [JS_NEW]: body });
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(switchedOff(result), [
    { file: JS_NEW, line: 8, text: "test.skip('shrinks on a spend', () => {});" },
    { file: JS_NEW, line: 12, text: "t.skip('needs a clock');" },
  ]);
});

test('a Rust test file moved with an edit keeps its #[ignore] on the same fn', (t) => {
  const f = fixture(t, { a: ['src/gift_cards/', 'src/wallet/'] });
  f.write(RS_OLD, rust(['starts_at_zero'], ['watches_the_setup_session', true], ['shrinks_on_spend']));
  f.land(RS_OLD);
  turn(f, [[RS_OLD, RS_NEW]], {
    [RS_NEW]: rust(['starts_at_zero'], ['watches_the_setup_session', true], ['shrinks_on_spend']).replace('use super::*;', 'use crate::gift_cards::*;'),
  });
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.tests_changed, { modified: [], deleted: [RS_OLD], switched_off: [] });
});

test('a Rust move that adds an #[ignore], or puts one on another fn, fails at each such line', (t) => {
  const f = fixture(t, { a: ['src/gift_cards/', 'src/wallet/'] });
  f.write(RS_OLD, rust(['starts_at_zero'], ['watches_the_setup_session', true], ['shrinks_on_spend']));
  f.land(RS_OLD);
  turn(f, [[RS_OLD, RS_NEW]], { [RS_NEW]: rust(['starts_at_zero', true], ['watches_the_setup_session'], ['shrinks_on_spend', true]) });
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(switchedOff(result), [{ file: RS_NEW, line: 4, text: '#[ignore]' }, { file: RS_NEW, line: 16, text: '#[ignore]' }]);
});

test('a committed move passes, and a switch-off a later commit of the same range adds to the moved file fails', (t) => {
  const f = jsIntent(t);
  turn(f, [[JS_OLD, JS_NEW]], { [JS_NEW]: MOVED_JS });
  f.git('commit', '-qm', 'the item moved its test');
  const moved = f.verify('a');
  assert.equal(moved.code, 0, moved.out);
  assert.deepEqual(switchedOff(moved), []);

  const fix = f.start('--item', 'a');
  f.write(JS_NEW, MOVED_JS.replace("  test('starts at zero', () => {});", SKIPPED_START));
  f.accepted(fix, [JS_NEW]);
  f.git('commit', '-qam', 'the fix');
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(switchedOff(result), [{ file: JS_NEW, line: 5, text: SKIPPED_START.trim() }]);
});

test('a move made without git, its new path untracked, reads as the same move', (t) => {
  const f = jsIntent(t);
  const dispatch = f.start('--item', 'a');
  fs.mkdirSync(path.join(f.root, 'wallet'));
  fs.renameSync(path.join(f.root, JS_OLD), path.join(f.root, JS_NEW));
  f.accepted(dispatch, [JS_OLD, JS_NEW]);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.tests_changed, { modified: [], deleted: [JS_OLD], switched_off: [] });
});

test('a file moved twice in the range reads against its first source', (t) => {
  const f = jsIntent(t);
  turn(f, [[JS_OLD, JS_NEW]], { [JS_NEW]: MOVED_JS });
  f.git('commit', '-qm', 'the first move');
  turn(f, [[JS_NEW, 'wallet/card-balance.test.cjs']]);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.tests_changed, { modified: [], deleted: [JS_OLD], switched_off: [] });
});

test('a copy whose source still stands is no move: each switch-off it carries is new', (t) => {
  const f = jsIntent(t);
  const dispatch = f.start('--item', 'a');
  f.write(JS_NEW, MOVED_JS);
  // The item edits the source as well: git finds a copy only from a file the same diff changes.
  f.write(JS_OLD, JS.replace("test('starts at zero'", "test('starts at zero on a new card'"));
  f.accepted(dispatch, [JS_OLD, JS_NEW]);
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.tests_changed.modified, [JS_OLD]);
  assert.deepEqual(switchedOff(result).map((entry) => `${entry.file}:${entry.line}`), [`${JS_NEW}:6`, `${JS_NEW}:7`, `${JS_NEW}:9`]);
});

/** The moved file's first `kept` lines, then a new test per name and the end of its describe. */
const rewritten = (kept, names) => [
  ...MOVED_JS.split('\n').slice(0, kept),
  ...names.map((name) => `  test('books ${name} against the card', () => {});`),
  '});',
  '',
].join('\n');

test('a move that rewrites close to half the file is still a move git pairs, and keeps its switch-offs', (t) => {
  const f = jsIntent(t);
  // 53% alike: past git's default of 50%.
  turn(f, [[JS_OLD, JS_NEW]], { [JS_NEW]: rewritten(13, ['a top-up', 'a refund', 'a transfer', 'a charge-back', 'a voucher']) });
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(switchedOff(result), []);
});

test('a test file deleted and another added that git does not pair read as before', (t) => {
  const f = jsIntent(t);
  const dispatch = f.start('--item', 'a');
  fs.rmSync(path.join(f.root, JS_OLD));
  // 46% alike: short of git's default of 50%, though it holds the same switch-offs on the same tests.
  f.write(JS_NEW, rewritten(7, ['a top-up', 'a refund', 'a transfer', 'a charge-back']));
  f.accepted(dispatch, [JS_OLD, JS_NEW]);
  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(result.data.tests_changed, {
    modified: [], deleted: [JS_OLD], switched_off: [
      { file: JS_NEW, line: 6, text: "test('grows on a top-up', { skip: 'needs the ledger' }, () => {});" },
      { file: JS_NEW, line: 7, text: "test.skip('shrinks on a spend', () => {});" },
    ],
  });
});

test('a file that was no test file at its old path keeps the switch-offs it already held', (t) => {
  const f = jsIntent(t);
  f.write('cards/balance-checks.cjs', JS);
  f.land('cards/balance-checks.cjs');
  turn(f, [['cards/balance-checks.cjs', 'cards/balance-checks.test.cjs']]);
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(switchedOff(result), []);
});

test('a host config that turns rename detection off or limits it low changes nothing', (t) => {
  const f = fixture(t, { a: ['src/gift_cards/', 'src/wallet/'] });
  const refunds = 'src/gift_cards/refund_tests.rs';
  f.write(RS_OLD, rust(['starts_at_zero'], ['watches_the_setup_session', true], ['shrinks_on_spend']));
  f.write(refunds, rust(['refunds_in_full', true], ['refunds_in_part'], ['refuses_a_spent_card']));
  f.land(RS_OLD, refunds);
  f.git('config', 'diff.renames', 'false');
  f.git('config', 'diff.renameLimit', '1');
  // Other names and an edit each: git pairs them only by their content, past its rename limit.
  turn(f, [[RS_OLD, 'src/wallet/purse_tests.rs'], [refunds, 'src/wallet/payback_tests.rs']], {
    'src/wallet/purse_tests.rs': rust(['starts_at_zero'], ['watches_the_setup_session', true], ['shrinks_on_spend']).replace('use super::*;', 'use crate::gift_cards::*;'),
    'src/wallet/payback_tests.rs': rust(['refunds_in_full', true], ['refunds_in_part'], ['refuses_a_spent_card']).replace('use super::*;', 'use crate::gift_cards::*;'),
  });
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(result.data.tests_changed, { modified: [], deleted: [RS_OLD, refunds], switched_off: [] });
});

/**
 * Item `a` moves the Rust test file the base and the intent hold, with `held` switched off, and lands;
 * the base then writes the old path as `base` and the intent folds, which carries the base's change
 * into the new path.
 */
function movedThenFolded(t, held, base) {
  const f = fixture(t, { a: ['src/gift_cards/', 'src/wallet/'] });
  f.moveBase(RS_OLD, rust(...held));
  f.git('merge', '-q', '--ff-only', 'main');
  turn(f, [[RS_OLD, RS_NEW]]);
  f.git('commit', '-qm', 'the item moved its test');
  f.moveBase(RS_OLD, rust(...base));
  f.git('merge', '-q', '--no-edit', 'main');
  assert.equal(fs.readFileSync(path.join(f.root, RS_NEW), 'utf8'), rust(...base), 'the fold follows the move');
  return f;
}

/** A fix of item `a` that writes the moved file as `body`, then verify-item. */
function fixed(f, body) {
  const fix = f.start('--item', 'a');
  f.write(RS_NEW, body);
  f.accepted(fix, [RS_NEW]);
  return f.verify('a');
}

const HELD = [['starts_at_zero'], ['watches_the_setup_session', true], ['shrinks_on_spend']];
const BASE_OFF = [['starts_at_zero'], ['watches_the_setup_session', true], ['shrinks_on_spend', true]];

test('a moved file keeps its own switch-off and the one a fold of the base brought in at its old path', (t) => {
  const f = movedThenFolded(t, HELD, BASE_OFF);
  const result = fixed(f, rust(...BASE_OFF, ['expires_after_a_year']));
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(switchedOff(result), []);
});

test('the item switching another test off in the moved file after the fold is refused', (t) => {
  const f = movedThenFolded(t, HELD, BASE_OFF);
  const result = fixed(f, rust(['starts_at_zero', true], ...BASE_OFF.slice(1), ['expires_after_a_year']));
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(switchedOff(result), [{ file: RS_NEW, line: 4, text: '#[ignore]' }]);
});

test('a test the base switched back on at the old path, switched off again by the item, is the item\'s', (t) => {
  const f = movedThenFolded(t, HELD, [['starts_at_zero'], ['watches_the_setup_session'], ['shrinks_on_spend']]);
  const result = fixed(f, rust(...HELD));
  assert.equal(result.code, 2, result.out);
  assert.deepEqual(switchedOff(result), [{ file: RS_NEW, line: 9, text: '#[ignore]' }]);
});

test('a test file the intent wrote, moved across a fold of a base that never held it, keeps its switch-off', (t) => {
  const f = fixture(t, { a: ['src/gift_cards/', 'src/wallet/'] });
  f.write(RS_OLD, rust(...HELD));
  f.land(RS_OLD);
  turn(f, [[RS_OLD, RS_NEW]]);
  f.git('commit', '-qm', 'the item moved its test');
  f.moveBase('other.cjs', 'moved on the base\n');
  f.git('merge', '-q', '--no-edit', 'main');
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.deepEqual(switchedOff(result), []);
});
