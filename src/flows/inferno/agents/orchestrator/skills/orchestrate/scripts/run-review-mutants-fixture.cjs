'use strict';

/**
 * Fixtures for the mutants the runner runs when it records a review: a host repository whose
 * item a-one has two numbered acceptance criteria and a test per criterion, and the proposals a
 * reviewer writes.
 *
 * A test is `node checks/has.cjs <expect file> ../runs.log`: it is green while every line of the
 * expect file (`<path> <text>`) finds its text in that path, prints node --test's summary either
 * way, and logs the expect file it read to runs.log beside the tree, so a test can tell which
 * mutants ran without dirtying the tree.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { CONFIG, git, repo, run, write } = require('./review-fixture.cjs');

const WRITER = path.join(__dirname, 'state-transition.cjs');
const REVIEW = '.specs-inferno/intents/alpha/reviews/a-one.yaml';
const INTENT_REVIEW = '.specs-inferno/intents/alpha/review.yaml';

// The child test's own source, written into the tree. It writes nothing in the tree.
const CHECK = String.raw`'use strict';
const fs = require('fs');
const [spec, log] = process.argv.slice(2);
if (log) fs.appendFileSync(log, spec + '\n');
const missed = fs.readFileSync(spec, 'utf8').split('\n').filter(Boolean).filter((line) => {
  const at = line.indexOf(' ');
  return !fs.readFileSync(line.slice(0, at), 'utf8').includes(line.slice(at + 1));
});
console.log(missed.length > 0 ? '# fail ' + missed.length : '# pass 1');
process.exit(missed.length > 0 ? 1 : 0);
`;

/** An item spec with numbered acceptance criteria and a test path, so it owes a caught mutant per criterion. */
function itemSpec(id, criteria, editable) {
  return `---\nid: ${id}\ntitle: "${id}"\nintent: alpha\nstatus: pending\ndepends_on: []\n---\n\n# Work Item: ${id}\n\n` +
    `## Acceptance Criteria\n\n${criteria.map((text) => `- [ ] ${text}`).join('\n')}\n\n## Execution Manifest\n\n` +
    `context:\n  tests:\n    - path: checks/has.cjs\n      reason: proof\nownership:\n  editable:\n${editable.map((p) => `    - ${p}`).join('\n')}\n`;
}

const A_ONE = ['a reads one', 'a2 reads two'];
const A_EDITABLE = ['src/a.ts', 'checks/one.expect', 'checks/two.expect'];

/**
 * The host on main with the check, a two-line src/a.ts, a strong test for criterion 1 and a weak
 * one for criterion 2 (it only finds `export`, so a mutant of line 2 survives it).
 */
function mutantRepo(options = {}) {
  const fixture = repo({
    ...options,
    files: {
      'checks/has.cjs': CHECK,
      'checks/one.expect': 'src/a.ts a = 1\n',
      'checks/two.expect': 'src/a.ts export\n',
      'checks/a2.expect': 'src/a.ts a2 = 2\n',
      ...(options.files || {}),
    },
  });
  write(fixture.root, 'src/a.ts', 'export const a = 1;\nexport const a2 = 2;\n');
  write(fixture.root, '.specs-inferno/intents/alpha/work-items/a-one.md', itemSpec('a-one', A_ONE, A_EDITABLE));
  git(fixture.root, ['add', '-A']);
  git(fixture.root, ['commit', '-qm', 'criteria and tests']);
  return fixture;
}

/** A proposal as the reviewer writes it under `mutants`. */
function proposal(criterion, { file = 'src/a.ts', line = 1, find = 'a = 1', replace = 'a = 7', expect = 'checks/one.expect' } = {}) {
  return `  - criterion: ${criterion}\n    file: ${file}\n    line: ${line}\n    find: "${find}"\n    replace: "${replace}"\n` +
    `    test: node checks/has.cjs ${expect} ../runs.log\n`;
}

/** Criterion 1 caught by its strong test; criterion 2 survives its weak one. */
const CAUGHT_ONE = proposal(1);
const SURVIVES_TWO = proposal(2, { line: 2, find: 'a2 = 2', replace: 'a2 = 8', expect: 'checks/two.expect' });

const itemReview = (body, verdict = 'clean') => `item: a-one\nverdict: ${verdict}\nfiles: [src/a.ts, checks/one.expect, checks/two.expect]\n${body}`;
const withMutants = (...entries) => itemReview(`mutants:\n${entries.join('')}`);

const record = (fixture, args = [], tree = fixture.root) =>
  run(fixture, ['review', '--item', 'a-one', '--tree', tree, '--reviewer', 'rev-1', ...args]);

/** The expect files the tests read, in the order they ran, since the last call. */
function runs(fixture) {
  const log = path.join(path.dirname(fixture.root), 'runs.log');
  if (!fs.existsSync(log)) return [];
  const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  fs.rmSync(log);
  return lines;
}

const read = (tree, rel) => fs.readFileSync(path.join(tree, rel), 'utf8');

/** Record a review for a-one straight through the writer, under the hash its files have now, and commit it. */
function recordedByHand(tree, body, verdict = 'clean', files = ['src/a.ts']) {
  const { filesHash } = require('./run-review-hash.cjs');
  const head = git(tree, ['rev-parse', 'HEAD']);
  write(tree, REVIEW, `${body}tree: ${filesHash(tree, files)}\ncommit: ${head}\nreviewer: rev-0\n`);
  execFileSync(process.execPath, [WRITER, 'review-item', '--intent', 'alpha', '--item', 'a-one', '--file', path.join(tree, '.specs-inferno/state.yaml'),
    '--verdict', verdict, '--files-hash', filesHash(tree, files), '--tier', 'cheap', '--commit', head]);
  git(tree, ['add', '-A']);
  git(tree, ['commit', '-qm', 'a review recorded by the released flow']);
}

module.exports = {
  A_EDITABLE, A_ONE, CAUGHT_ONE, CHECK, CONFIG, INTENT_REVIEW, REVIEW, SURVIVES_TWO, itemReview, itemSpec, mutantRepo, proposal, read, record,
  recordedByHand, runs, withMutants,
};
