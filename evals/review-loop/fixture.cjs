'use strict';

/**
 * The fixture both review-loop suites read: a real temporary git repository, built with the
 * flow's own review fixture, holding item specs and item reviews recorded the way
 * `run.cjs review` records them (the reviewer's body, then `tree`, `commit` and `reviewer`
 * appended, committed on their own).
 *
 * The history, in order. `base` is the commit after the plan; everything after it is measured.
 *
 *   plan    specs of a-one (3 criteria, editable src/a.ts) and a-two (2 criteria); a review of
 *           z-old recorded before base
 *   ---- base ----
 *   z-old   recorded again with only its tree, commit and reviewer changed: no round
 *   a-one   round 1 fix: a major finding read from the code, a survivor on criterion 2
 *   a-one   round 1 recorded again under another reviewer and commit: no round
 *   grant   a-one gains src/a.test.ts
 *   a-one   round 2 fix: a major finding whose evidence is the surviving mutant
 *   a-two   round 1 fix: no finding, one survivor
 *   c-three spec added after base (1 criterion): no grant
 *   c-three round 1 fix: one minor finding, no mutant
 *   a-one   round 3 fix: one minor finding, no mutant
 *   grant   a-one gains src/b.ts and c-three gains src/c.test.ts, in one commit
 *   a-two   round 2 clean
 *   c-three round 2 fix: a blocker and a minor
 *   shrink  a-one drops src/b.ts again and reorders: no grant
 *   a-one   round 4 clean, the largest round (4 mutants)
 *   c-three round 3 clean
 *   ---- mid ----
 *   archive c-three's spec and review move to the archive unchanged: no round, no grant
 */

const fs = require('node:fs');
const path = require('node:path');

const S = path.join(__dirname, '..', '..', 'src', 'flows', 'inferno', 'agents', 'orchestrator', 'skills', 'orchestrate', 'scripts');
const { git, repo, write } = require(path.join(S, 'review-fixture.cjs'));

function spec(id, criteria, editable) {
  return `---
id: ${id}
title: "${id}"
intent: alpha
status: pending
depends_on: []
---

# Work Item: ${id}

## Description

Acme Shop gift card step ${id}.

## Acceptance Criteria

${criteria.map((text) => `- [ ] ${text}`).join('\n')}

## Execution Manifest

context:
  required:
    - path: src/a.ts
      reason: why
ownership:
  editable:
${editable.map((file) => `    - ${file}`).join('\n')}
`;
}

const specRel = (id, dir = 'intents') => `.specs-inferno/${dir}/alpha/work-items/${id}.md`;
const reviewRel = (id, dir = 'intents') => `.specs-inferno/${dir}/alpha/reviews/${id}.yaml`;

function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

let hashes = 0;

/** Record one review version as run.cjs review does: the body, then the three lines it appends. */
function record(root, id, body, reviewer = 'rev-1') {
  hashes += 1;
  const commit = git(root, ['rev-parse', 'HEAD']);
  write(root, reviewRel(id), `${body}tree: ${String(hashes).padStart(64, '0')}\ncommit: ${commit}\nreviewer: ${reviewer}\n`);
  return commitAll(root, `specsmd(alpha): review ${id}`);
}

const finding = (criterion, evidence, severity) =>
  `  - criterion: "${criterion}"\n    file: src/a.ts\n    line: 3\n    evidence: "${evidence}"\n    fix: "fix it"\n    severity: ${severity}\n`;
const mutant = (criterion, caught) => `  - criterion: "${criterion}"\n    test: npm test\n    caught: ${caught}\n`;

function review(id, verdict, files, findings = [], mutants = []) {
  return `item: ${id}\nverdict: ${verdict}\nfiles: [${files.join(', ')}]\n` +
    (findings.length ? `findings:\n${findings.join('')}` : '') +
    (mutants.length ? `mutants:\n${mutants.join('')}` : '');
}

const A_ONE = ['the code is checked', 'a bad code is refused', 'the balance is shown'];
const A_TWO = ['the card is issued', 'the card is mailed'];
const C_THREE = ['an empty code is refused'];

/** Build the history above and return the repository with its base, mid and head commits. */
function build() {
  const fixture = repo();
  const { root } = fixture;
  write(root, specRel('a-one'), spec('a-one', A_ONE, ['src/a.ts']));
  write(root, specRel('a-two'), spec('a-two', A_TWO, ['src/b.ts']));
  write(root, 'src/c.ts', 'export const c = 3;\n');
  commitAll(root, 'plan');
  record(root, 'z-old', review('z-old', 'clean', ['src/a.ts']));
  const base = git(root, ['rev-parse', 'HEAD']);

  // z-old again with only the recorded lines changed.
  record(root, 'z-old', review('z-old', 'clean', ['src/a.ts']), 'rev-9');

  const aOne1 = review('a-one', 'fix', ['src/a.ts'],
    [finding('1', 'the handler returns 200 on a bad code', 'major')],
    [mutant('1', 'yes'), mutant('2', 'no'), mutant('the code is checked', 'yes')]);
  record(root, 'a-one', aOne1);
  write(root, 'src/a.ts', 'export const a = 11;\n');
  commitAll(root, 'unrelated work');
  record(root, 'a-one', aOne1, 'rev-2');

  write(root, specRel('a-one'), spec('a-one', A_ONE, ['src/a.ts', 'src/a.test.ts']));
  commitAll(root, 'grant a-one a test');

  record(root, 'a-one', review('a-one', 'fix', ['src/a.ts', 'src/a.test.ts'],
    [finding('2', 'the mutant on line 4 survived: npm test still passes', 'major')],
    [mutant('a bad code is refused', 'no'), mutant('the balance is shown', 'yes')]));

  record(root, 'a-two', review('a-two', 'fix', ['src/b.ts'], [], [mutant('1', 'no'), mutant('2', 'yes')]));

  write(root, specRel('c-three'), spec('c-three', C_THREE, ['src/c.ts']));
  commitAll(root, 'plan c-three');

  record(root, 'c-three', review('c-three', 'fix', ['src/c.ts'], [finding('1', 'the name reads badly', 'minor')]));

  record(root, 'a-one', review('a-one', 'fix', ['src/a.ts', 'src/a.test.ts', 'src/b.ts'],
    [finding('3', 'a comment is stale', 'minor')]));

  write(root, specRel('a-one'), spec('a-one', A_ONE, ['src/a.ts', 'src/a.test.ts', 'src/b.ts']));
  write(root, specRel('c-three'), spec('c-three', C_THREE, ['src/c.ts', 'src/c.test.ts']));
  commitAll(root, 'grant a-one and c-three');

  record(root, 'a-two', review('a-two', 'clean', ['src/b.ts'], [], [mutant('1 again', 'yes'), mutant('AC2', 'yes')]));

  record(root, 'c-three', review('c-three', 'fix', ['src/c.ts', 'src/a.ts'],
    [finding('1', 'it crashes on empty input', 'blocker'), finding('1', 'a log line is noisy', 'minor')], [mutant('1', 'yes')]));

  write(root, specRel('a-one'), spec('a-one', A_ONE, ['src/a.test.ts', 'src/a.ts']));
  commitAll(root, 'shrink a-one');

  record(root, 'a-one', review('a-one', 'clean', ['src/a.ts', 'src/a.test.ts', 'src/b.ts', 'src/c.ts'],
    [], [mutant('1', 'yes'), mutant('2', 'yes'), mutant('3', 'yes'), mutant('the balance is shown twice', 'yes')]));

  record(root, 'c-three', review('c-three', 'clean', ['src/c.ts', 'src/a.ts', 'src/b.ts'], [], [mutant('the empty code is refused', 'yes')]));
  const mid = git(root, ['rev-parse', 'HEAD']);
  return { ...fixture, base, mid, head: archive(root) };
}

/** Move c-three's spec and review into the archive with their content as it is. */
function archive(root) {
  for (const [from, to] of [[specRel('c-three'), specRel('c-three', 'archive/intents')], [reviewRel('c-three'), reviewRel('c-three', 'archive/intents')]]) {
    fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
    git(root, ['mv', from, to]);
  }
  return commitAll(root, 'archive c-three');
}

module.exports = { S, build, git, write };
