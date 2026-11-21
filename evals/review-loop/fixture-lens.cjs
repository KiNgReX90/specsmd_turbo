'use strict';

/**
 * The fixture of the current flow's review files: an item with production code has a contract
 * file `reviews/<item>.yaml` and a quality file `reviews/quality/<item>.yaml`, and `run.cjs
 * review` records both in one commit. A later round carries the contract file's mutants over and
 * runs only the survivors and the proposals that never ran. A real temporary git repository,
 * built with the flow's own review fixture, in the system's temporary folder.
 *
 * The history of intent beta, in order. `base` is the commit after the plan.
 *
 *   plan    specs of q-one (3 criteria) and q-two (2 criteria)
 *   ---- base ----
 *   q-one   round 1, both files in one commit. contract fix: a blocker read from the code, and
 *           the runner's major finding for the survivor on criterion 2 (3 mutants, 1 survivor).
 *           quality fix: 1 major, 2 minor. Reviewers c1 and q1.
 *   q-one   round 2, both files in one commit. contract clean: the 3 mutants carried, the
 *           survivor run again and caught. quality fix: 1 minor. Reviewers c1 and q1.
 *   q-one   round 3, the quality file alone: clean. Reviewer q1.
 *   q-one   the quality file recorded again with only its recorded lines changed: no round.
 *           Reviewer q9.
 *   q-two   round 1, both files. contract fix: criterion 1 proposed and not run, criterion 2 a
 *           survivor. quality clean. Reviewers c2 and q2.
 *   q-two   round 2, the contract file alone, fix: criterion 1 runs and is caught, criterion 2
 *           run again and survives again. Reviewer c3.
 *   q-two   round 3, the contract file alone, clean: criterion 2 caught. Reviewer c3.
 *   ---- mid ----
 *   archive every spec and both review files of beta move to the archive unchanged: no round
 *   ---- head ----
 *   g-one   intent gamma, round 1, both files: the contract file does not read as YAML, the
 *           quality file is clean and lists two files. Both name reviewer c7.
 *   g-one   round 2, the contract file alone, written without the recorded lines: a verdict
 *           the schema does not hold, one file, a major finding and one of a weight it does not hold.
 *   ---- edge ----
 */

const fs = require('node:fs');
const path = require('node:path');

const { S, commitAll, git, spec, write } = require('./fixture.cjs');
const { repo } = require(path.join(S, 'review-fixture.cjs'));

const INTENT = 'beta';
const rel = (dir, id, ext, intent = INTENT) => `.specs-inferno/intents/${intent}/${dir}/${id}.${ext}`;
const contractRel = (id, intent) => rel('reviews', id, 'yaml', intent);
const qualityRel = (id, intent) => rel('reviews/quality', id, 'yaml', intent);

let hashes = 0;

/** Record lens files in one commit as run.cjs review does: each body, then the three lines it appends. */
function record(root, id, files) {
  const commit = git(root, ['rev-parse', 'HEAD']);
  for (const [file, body, reviewer] of files) {
    hashes += 1;
    write(root, file, `${body}tree: ${String(hashes).padStart(64, '0')}\ncommit: ${commit}\nreviewer: ${reviewer}\n`);
  }
  return commitAll(root, `specsmd: review ${id}`);
}

const finding = (criterion, evidence, severity) =>
  `  - criterion: "${criterion}"\n    file: src/gift.ts\n    line: 4\n    evidence: "${evidence}"\n    fix: "fix it"\n    severity: ${severity}\n`;
const survivor = (criterion) => finding(criterion, `mutant ${criterion} survived: no test failed`, 'major');
const mutant = (criterion, caught) => `  - criterion: "${criterion}"\n    file: src/gift.ts\n    line: ${10 + criterion}\n` +
  `    find: "a${criterion}"\n    replace: "b${criterion}"\n    test: npm test\n${caught ? `    caught: ${caught}\n` : ''}`;
const issue = (id, check, severity) =>
  `  - id: ${id}\n    check: ${check}\n    file: src/gift.ts\n    line: ${id.slice(1)}\n    evidence: "seen"\n    fix: "fix it"\n    severity: ${severity}\n`;

function contract(id, verdict, findings, mutants) {
  return `item: ${id}\nverdict: ${verdict}\nfiles: [src/gift.ts]\n` +
    (findings.length ? `findings:\n${findings.join('')}` : '') + (mutants.length ? `mutants:\n${mutants.join('')}` : '');
}

function quality(id, verdict, issues, files = ['src/gift.ts']) {
  return `item: ${id}\nverdict: ${verdict}\nfiles: [${files.join(', ')}]\n` + (issues.length ? `findings:\n${issues.join('')}` : '');
}

/** Build the history above and return the repository with its base, mid and head commits. */
function build() {
  const fixture = repo();
  const { root } = fixture;
  write(root, rel('work-items', 'q-one', 'md'), spec('q-one', ['a total is summed', 'a bad total is refused', 'a total is shown'], ['src/gift.ts'], INTENT));
  write(root, rel('work-items', 'q-two', 'md'), spec('q-two', ['a card is frozen', 'a frozen card is refused'], ['src/gift.ts'], INTENT));
  commitAll(root, 'plan beta');
  const base = git(root, ['rev-parse', 'HEAD']);

  record(root, 'q-one', [
    [contractRel('q-one'), contract('q-one', 'fix', [finding('1', 'the total skips the last line', 'blocker'), survivor('2')],
      [mutant(1, 'yes'), mutant(2, 'no'), mutant(3, 'yes')]), 'c1'],
    [qualityRel('q-one'), quality('q-one', 'fix', [issue('Q1', 'correctness', 'major'), issue('Q2', 'readability', 'minor'),
      issue('Q3', 'leftovers', 'minor')]), 'q1'],
  ]);
  record(root, 'q-one', [
    [contractRel('q-one'), contract('q-one', 'clean', [], [mutant(1, 'yes'), mutant(2, 'yes'), mutant(3, 'yes')]), 'c1'],
    [qualityRel('q-one'), quality('q-one', 'fix', [issue('Q4', 'readability', 'minor')]), 'q1'],
  ]);
  const cleanQuality = quality('q-one', 'clean', [], ['src/gift.ts', 'src/gift.test.ts']);
  record(root, 'q-one', [[qualityRel('q-one'), cleanQuality, 'q1']]);
  record(root, 'q-one', [[qualityRel('q-one'), cleanQuality, 'q9']]);

  record(root, 'q-two', [
    [contractRel('q-two'), contract('q-two', 'fix', [survivor('2')], [mutant(1), mutant(2, 'no')]), 'c2'],
    [qualityRel('q-two'), quality('q-two', 'clean', []), 'q2'],
  ]);
  record(root, 'q-two', [[contractRel('q-two'), contract('q-two', 'fix', [survivor('2')], [mutant(1, 'yes'), mutant(2, 'no')]), 'c3']]);
  record(root, 'q-two', [[contractRel('q-two'), contract('q-two', 'clean', [], [mutant(1, 'yes'), mutant(2, 'yes')]), 'c3']]);
  const mid = git(root, ['rev-parse', 'HEAD']);
  const head = archive(root);
  return { ...fixture, base, mid, head, edge: edge(root) };
}

/** Intent gamma: a lens file that does not read, and one with a verdict the schema does not hold. */
function edge(root) {
  write(root, rel('work-items', 'g-one', 'md', 'gamma'), spec('g-one', ['a gift is wrapped'], ['src/g.ts'], 'gamma'));
  commitAll(root, 'plan gamma');
  record(root, 'g-one', [
    [contractRel('g-one', 'gamma'), 'item: g-one\n  verdict: fix\n', 'c7'],
    [qualityRel('g-one', 'gamma'), quality('g-one', 'clean', [], ['src/g.ts', 'src/h.ts']), 'c7'],
  ]);
  write(root, contractRel('g-one', 'gamma'), 'item: g-one\nverdict: later\nfiles: [src/g.ts]\nfindings:\n' + finding('1', 'seen', 'major') + finding('1', 'seen', 'huge'));
  return commitAll(root, 'specsmd: review g-one by hand');
}

/** Move beta's specs and review files, both lenses, into the archive with their content as it is. */
function archive(root) {
  const moves = ['q-one', 'q-two'].flatMap((id) =>
    [rel('work-items', id, 'md'), contractRel(id), qualityRel(id)]);
  for (const from of moves) {
    const to = from.replace('.specs-inferno/intents/', '.specs-inferno/archive/intents/');
    fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
    git(root, ['mv', from, to]);
  }
  return commitAll(root, 'archive beta');
}

module.exports = { build };
