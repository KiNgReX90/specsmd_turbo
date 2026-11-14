'use strict';

/**
 * Fixtures for the gate marks of acceptance criteria (run-criterion-marks.cjs): a host with a gate
 * command and a plan in the planner's full form, whose item a-one has three criteria and a test,
 * and the item and intent reviews recorded over it through run.cjs.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CONFIG, INTENT_TREE, git, run, worktree, write } = require('./review-fixture.cjs');
const { INTENT_REVIEW, REVIEW, itemReview, mutantRepo, proposal, record } = require('./run-review-mutants-fixture.cjs');

const GATE = 'echo gate ran';
const SPEC = '.specs-inferno/intents/alpha/work-items/a-one.md';
const ARCHIVED_SPEC = '.specs-inferno/archive/intents/alpha/work-items/a-one.md';
const BRIEF = '# Intent: Alpha\n\n## Success Criteria\n\n- SC-1: `node checks/has.cjs` reports green\n\n' +
  '## Item Map\n\n| Criterion | Items |\n| --- | --- |\n| SC-1 | a-one, a-two |\n';
const MARKED = `the size cap holds on every file (gate: ${GATE})`;
const UNMARKED = 'the size cap holds on every file (`scripts/size.sh`)';
const shown = (result) => result.out + result.err;

/** An item spec in the planner's full form, with the given criteria and manifest. */
function fullSpec(id, { kind, depends = [], criteria, plan, manifest }) {
  return `---\nid: ${id}\ntitle: "${id}"\nintent: alpha\nkind: ${kind}\nstatus: pending\ndepends_on: [${depends.join(', ')}]\n` +
    `delivers: [SC-1]\n---\n\n# Work Item: ${id}\n\n## Description\n\nThe values of the shop.\n\n## Acceptance Criteria\n\n` +
    `${criteria.map((text) => `- [ ] ${text}`).join('\n')}\n\n## Edge Cases\n\nNone.\n\n## Out of Scope\n\nNone.\n\n` +
    `## Test Plan\n\n${plan.join('\n')}\n- Breaks: none\n\n## Reuse\n\nNone.\n\n## Execution Manifest\n\n${manifest}\n` +
    '## Technical Notes\n\nNone.\n\n## Dependencies\n\nNone.\n';
}

const criteria = (second) => ['a reads one (`checks/one.expect`)', second, 'a2 reads two (`checks/a2.expect`)'];

const aOne = (second = MARKED) => fullSpec('a-one', {
  kind: 'behavior',
  criteria: criteria(second),
  plan: ['- Adds: `checks/has.cjs` :: reads the values', '- Integration: none'],
  manifest: 'context:\n  tests:\n    - path: checks/has.cjs\n      reason: proof\nownership:\n  editable:\n' +
    '    - src/a.ts\n    - checks/one.expect\n    - checks/two.expect\n',
});

const A_TWO = fullSpec('a-two', {
  kind: 'docs-only',
  depends: ['a-one'],
  criteria: ['the notes read docs (`docs/b.md`)'],
  plan: ['- Integration with a-one: `checks/has.cjs` :: reads the values'],
  manifest: 'context:\n  required:\n    - path: docs/b.md\n      reason: the notes\nownership:\n  editable:\n    - docs/b.md\n',
});

/** The host with a gate command, a plan in the full form whose a-one has three criteria, and the intent worktree. */
function planned(second = MARKED) {
  const fixture = mutantRepo({ config: CONFIG.replace('verification:\n', `verification:\n  finalize:\n    - ${GATE}\n`) });
  write(fixture.root, '.specs-inferno/intents/alpha/brief.md', BRIEF);
  write(fixture.root, SPEC, aOne(second));
  write(fixture.root, '.specs-inferno/intents/alpha/work-items/a-two.md', A_TWO);
  git(fixture.root, ['add', '-A']);
  git(fixture.root, ['commit', '-qm', 'the plan']);
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, '.specs-inferno/intents/alpha/scan.yaml', 'lines: []\n');
  git(tree, ['add', '-A']);
  git(tree, ['commit', '-qm', 'scan']);
  return { fixture, tree };
}

/** a-one's item review, clean, with no mutant of its own. */
function itemReviewed(fixture, tree) {
  write(tree, REVIEW, itemReview(''));
  const result = record(fixture, [], tree);
  assert.equal(result.code, 0, shown(result));
}

const FIRST_AND_THIRD = `verdict: clean\nmutants:\n${proposal('a-one:1')}` +
  `${proposal('a-one:3', { line: 2, find: 'a2 = 2', replace: 'a2 = 8', expect: 'checks/a2.expect' })}`;

/** Dispatch the intent review, write what its reviewer wrote, and record it. */
function intentReview(fixture, tree, body = FIRST_AND_THIRD) {
  assert.equal(run(fixture, ['review', '--tree', tree]).code, 3);
  write(tree, INTENT_REVIEW, body);
  return run(fixture, ['review', '--tree', tree, '--reviewer', 'rev-1']);
}

/** The commit that closes and archives the intent: its folder moved under the archive, each checkbox of a-one ticked. */
function archived(tree, change = (text) => text) {
  fs.mkdirSync(path.join(tree, '.specs-inferno/archive/intents'), { recursive: true });
  git(tree, ['mv', '.specs-inferno/intents/alpha', '.specs-inferno/archive/intents/alpha']);
  const spec = fs.readFileSync(path.join(tree, ARCHIVED_SPEC), 'utf8');
  write(tree, ARCHIVED_SPEC, change(spec.replace(/- \[ \] /g, '- [x] ')));
  git(tree, ['add', '-A']);
  git(tree, ['commit', '-qm', 'specsmd(alpha): close and archive']);
}

const lint = (fixture, tree) => run(fixture, ['plan-lint', 'alpha', '--tree', tree]);

module.exports = {
  ARCHIVED_SPEC, FIRST_AND_THIRD, GATE, MARKED, SPEC, UNMARKED, aOne, archived, intentReview, itemReviewed, lint, planned, shown,
};
