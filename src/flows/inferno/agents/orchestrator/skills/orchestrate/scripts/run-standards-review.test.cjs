'use strict';

// The review of an item that owns a rule file under .specs-inferno/standards/: a mutant on the
// rule file is run and caught by a test that reads it, a pin on it is checked, the review binds
// it, and a delta review names it among the files its range changed. A review the released flow
// recorded, which bound no rule file, reads as before while the rule files it lists stay as it
// read them. The item's build: run-standards-product.test.cjs.

const assert = require('node:assert/strict');
const test = require('node:test');

const lib = require('./run-lib.cjs');
const { git, repo, run, write } = require('./review-fixture.cjs');
const { A_EDITABLE, A_ONE, CAUGHT_ONE, REVIEW, itemSpec, mutantRepo, proposal, record, recordedByHand, runs, withMutants } =
  require('./run-review-mutants-fixture.cjs');
const { parseItemReview } = require('./run-review-file.cjs');
const { itemReviewCurrent } = require('./run-review-hash.cjs');
const { RULE: DEFER_RULE } = require('./state-defer-finding.cjs');

const RULE = '.specs-inferno/standards/tooling.md';
const SENTENCE = 'A refused tool stays on record with its reason.';
const SPEC = '.specs-inferno/intents/alpha/work-items/a-one.md';
const shown = (result) => result.out + result.err;

/** The mutant host, with a-one owning the rule file and a test that reads it. */
function ruleRepo() {
  const fixture = mutantRepo({
    files: {
      [RULE]: `# Tooling\n\n${SENTENCE}\n`,
      'checks/rule.expect': `${RULE} ${SENTENCE}\n`,
      'checks/rule.test.cjs': `says(['${SENTENCE}']);\n`,
    },
  });
  write(fixture.root, SPEC, itemSpec('a-one', A_ONE, [...A_EDITABLE, RULE, 'checks/rule.expect']));
  git(fixture.root, ['commit', '-qam', 'a-one owns the rule file']);
  return fixture;
}

const ON_RULE = proposal(2, { file: RULE, line: 3, find: 'on record', replace: 'forgotten', expect: 'checks/rule.expect' });
const pinOnRule = (text = SENTENCE) =>
  `pins:\n  - criterion: 2\n    says: ${A_ONE[1]}\n    file: ${RULE}\n    test: checks/rule.test.cjs\n    text: "${text}"\n`;

test('a mutant on a rule file is run and caught by the test that reads it', () => {
  const fixture = ruleRepo();
  write(fixture.root, REVIEW, withMutants(CAUGHT_ONE, ON_RULE));
  const result = record(fixture);
  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /mutants: 2 ran, 2 caught, 0 survived/);
  assert.deepEqual(runs(fixture), ['checks/one.expect', 'checks/rule.expect']);
});

test('a pin on a rule file is checked against the rule file, and the ledger beside it is still no pin', () => {
  const fixture = ruleRepo();
  write(fixture.root, REVIEW, `${withMutants(CAUGHT_ONE)}${pinOnRule('A refused tool is forgotten with its reason.')}`);
  const wrong = record(fixture);
  assert.equal(wrong.code, 2, shown(wrong));
  assert.match(wrong.err, /pins entry 1 text does not stand verbatim in \.specs-inferno\/standards\/tooling\.md/);
  write(fixture.root, REVIEW, `${withMutants(CAUGHT_ONE)}${pinOnRule().replace(RULE, '.specs-inferno/config.yaml')}`);
  const ledger = record(fixture);
  assert.equal(ledger.code, 2, shown(ledger));
  assert.match(ledger.err, /pins entry 1 names \.specs-inferno\/config\.yaml; a pin reads the code, never the ledger/);
  write(fixture.root, REVIEW, `${withMutants(CAUGHT_ONE)}${pinOnRule()}`);
  const result = record(fixture);
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(parseItemReview(fixture.root, REVIEW, 'a-one', { recorded: true }).pins.map((pin) => pin.file), [RULE]);
});

/** Whether a-one's recorded review binds its files as the tree holds them. */
function current(tree) {
  const intent = lib.readLedger(tree).intents.find((entry) => entry.id === 'alpha');
  const item = intent.items.find((entry) => entry.id === 'a-one');
  const { files } = parseItemReview(tree, REVIEW, 'a-one', { recorded: true });
  return itemReviewCurrent(tree, { intent, item, files, config: lib.readConfig(tree) });
}

function commitRule(tree, body) {
  write(tree, RULE, body);
  git(tree, ['commit', '-qam', 'the rule file changed']);
}

test('a review binds the rule file it lists, so a later edit of the rule file alone owes the review again', () => {
  const fixture = ruleRepo();
  write(fixture.root, REVIEW, `item: a-one\nverdict: clean\nfiles: [src/a.ts, ${RULE}]\nmutants:\n${CAUGHT_ONE}${ON_RULE}`);
  const result = record(fixture);
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(parseItemReview(fixture.root, REVIEW, 'a-one', { recorded: true }).files, ['src/a.ts', RULE]);
  assert.equal(current(fixture.root), true);
  commitRule(fixture.root, `# Tooling\n\n${SENTENCE}\nAnd one more rule.\n`);
  assert.equal(current(fixture.root), false);
});

test('a review the released flow recorded over the code alone reads as before while the rule file it lists is as it read it', () => {
  const fixture = ruleRepo();
  const body = `item: a-one\nverdict: clean\nfiles: [src/a.ts, ${RULE}]\nmutants:\n${CAUGHT_ONE}`;
  recordedByHand(fixture.root, body, 'clean', ['src/a.ts']);
  assert.equal(current(fixture.root), true, 'the released flow hashed src/a.ts alone');
  commitRule(fixture.root, `# Tooling\n\n${SENTENCE}\nAnd one more rule.\n`);
  assert.equal(current(fixture.root), false, 'a rule file it lists changed since that review');

  const code = ruleRepo();
  recordedByHand(code.root, body, 'clean', ['src/a.ts']);
  write(code.root, 'src/a.ts', 'export const a = 5;\nexport const a2 = 2;\n');
  git(code.root, ['commit', '-qam', 'the code changed']);
  assert.equal(current(code.root), false, 'a code change owes it as before');
});

test('a delta review that names a file outside its range is told the rule file the fix changed, never the ledger', () => {
  const fixture = repo({ editable: ['src/a.ts', RULE] });
  const fix = (file) => `item: a-one\nverdict: fix\nfiles: [src/a.ts]\nfindings:\n  - criterion: "1"\n    file: ${file}\n    line: 1\n` +
    '    evidence: it breaks criterion 1\n    fix: restore it\n    severity: major\n';
  write(fixture.root, REVIEW, fix('src/a.ts'));
  assert.equal(run(fixture, ['review', '--item', 'a-one', '--tree', fixture.root, '--reviewer', 'rev-1']).code, 2);
  write(fixture.root, 'src/a.ts', 'export const a = 2;\n');
  write(fixture.root, RULE, '# Tooling\n');
  git(fixture.root, ['add', '-A']);
  git(fixture.root, ['commit', '-qm', 'the fix']);
  write(fixture.root, REVIEW, fix('src/b.ts'));
  const result = run(fixture, ['review', '--item', 'a-one', '--tree', fixture.root, '--reviewer', 'rev-1']);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /did not change: a new finding sits on a line the fix changed, in \.specs-inferno\/standards\/tooling\.md, src\/a\.ts\. /);
});

test('the defer rule beside a rule file stays ledger: a mutant or a pin on it is refused, and a review that lists it binds the rule file alone', () => {
  const fixture = ruleRepo();
  write(fixture.root, DEFER_RULE, 'survivors: true\n');
  git(fixture.root, ['add', '-A']);
  git(fixture.root, ['commit', '-qm', "the user's defer rule"]);
  const onDefer = proposal(2, { file: DEFER_RULE, line: 1, find: 'true', replace: 'false', expect: 'checks/rule.expect' });
  write(fixture.root, REVIEW, withMutants(CAUGHT_ONE, onDefer));
  const mutant = record(fixture);
  assert.equal(mutant.code, 2, shown(mutant));
  assert.match(mutant.err, /mutants entry 2 breaks \.specs-inferno\/standards\/defer-findings\.yaml; a mutant breaks the code, never the ledger/);
  write(fixture.root, REVIEW, `${withMutants(CAUGHT_ONE)}${pinOnRule().replace(RULE, DEFER_RULE)}`);
  const pin = record(fixture);
  assert.equal(pin.code, 2, shown(pin));
  assert.match(pin.err, /pins entry 1 names \.specs-inferno\/standards\/defer-findings\.yaml; a pin reads the code, never the ledger/);
  assert.deepEqual(runs(fixture), []);

  write(fixture.root, REVIEW, `item: a-one\nverdict: clean\nfiles: [src/a.ts, ${RULE}, ${DEFER_RULE}]\nmutants:\n${CAUGHT_ONE}${ON_RULE}`);
  const result = record(fixture);
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(parseItemReview(fixture.root, REVIEW, 'a-one', { recorded: true }).files, ['src/a.ts', RULE]);
  write(fixture.root, DEFER_RULE, 'survivors: false\n');
  git(fixture.root, ['commit', '-qam', 'the defer rule changed']);
  assert.equal(current(fixture.root), true, 'the defer rule is no file the review binds');
  commitRule(fixture.root, `# Tooling\n\n${SENTENCE}\nAnd one more rule.\n`);
  assert.equal(current(fixture.root), false);
});
