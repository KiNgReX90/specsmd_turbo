'use strict';

// The readout of the current flow's review files: both lenses, a round as one record, and a
// carried mutant counted once. The history is in fixture-lens.cjs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { build } = require('./fixture-lens.cjs');

const STATS = path.join(__dirname, 'stats.cjs');
const fixture = build();

function stats(args) {
  const result = spawnSync(process.execPath, [STATS, '--tree', fixture.root, '--base', fixture.base, ...args], {
    encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: fixture.cache },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

const readout = (args = []) => JSON.parse(stats(['--json', '--head', fixture.head, ...args]));
const data = readout();
const item = (id, from = data) => from.items.find((entry) => entry.item === id);
const counts = (total, blocker, major, minor) => ({ total, blocker, major, minor });

test('a commit that records both lens files is one round, and a later commit of the quality file alone is a round too', () => {
  assert.deepEqual(data.items.map((entry) => [entry.item, entry.rounds]), [['q-one', 3], ['q-two', 3]]);
  assert.equal(data.totals.rounds, 6);
  assert.deepEqual(item('q-one').kinds, ['serious', 'minor', null], 'round 2 is fix through the quality lens alone, round 3 is clean');
  assert.deepEqual(item('q-two').kinds, ['survivor', 'survivor', null]);
  assert.equal(data.totals.fixRounds, 4);
});

test('each lens gives its rounds, fix rounds and findings by weight, in all and in its first round', () => {
  assert.deepEqual(item('q-one').lenses, {
    contract: { rounds: 2, fix: 1, findings: counts(2, 1, 1, 0), firstFindings: counts(2, 1, 1, 0) },
    quality: { rounds: 3, fix: 2, findings: counts(4, 0, 1, 3), firstFindings: counts(3, 0, 1, 2) },
  });
  assert.deepEqual(item('q-two').lenses, {
    contract: { rounds: 3, fix: 2, findings: counts(2, 0, 2, 0), firstFindings: counts(1, 0, 1, 0) },
    quality: { rounds: 1, fix: 0, findings: counts(0, 0, 0, 0), firstFindings: counts(0, 0, 0, 0) },
  });
  assert.deepEqual(data.totals.lenses, {
    contract: { items: 2, rounds: 5, fixRounds: 3, findings: counts(4, 1, 3, 0), firstFindings: counts(3, 1, 2, 0), findingsPerItem: 2 },
    quality: { items: 2, rounds: 4, fixRounds: 2, findings: counts(4, 0, 1, 3), firstFindings: counts(3, 0, 1, 2), findingsPerItem: 2 },
  });
  assert.deepEqual(data.totals.laterFindings, counts(2, 0, 1, 1), 'findings in round 2 and later come from both lenses');
});

test('a carried mutant counts once, and a listing counts as run only when its verdict changed', () => {
  assert.deepEqual([item('q-one').mutants, item('q-one').mutantsRun, item('q-one').mutantRounds], [3, 4, 1]);
  assert.deepEqual([item('q-two').mutants, item('q-two').mutantsRun, item('q-two').mutantRounds], [2, 3, 1]);
  assert.equal(data.totals.mutants, 5);
  assert.equal(data.totals.mutantsRun, 7);
  assert.equal(data.totals.mutantsPerCriterion, 1, 'per criterion is the distinct mutants over the 5 criteria');
  assert.deepEqual(data.totals.firstRound, { mutants: 5, numbered: 5, freeText: 0 });
  assert.deepEqual(data.totals.laterRounds, { mutants: 0, numbered: 0, freeText: 0 }, 'a later round plants none');
  assert.deepEqual(data.totals.survivors, { mutants: 2, numbered: 2, freeText: 0 }, 'a survivor that survives again is not counted again');
  assert.deepEqual(data.totals.largest, { mutants: 3, item: 'q-one', criteria: 3 });
});

test('the files of a round are what both lens files list after it', () => {
  assert.deepEqual([item('q-one').filesFirst, item('q-one').filesLast], [1, 2]);
});

test('every reviewer a lens file names is kept by lens, each once', () => {
  assert.deepEqual(item('q-one').reviewers, { contract: ['c1'], quality: ['q1', 'q9'] });
  assert.deepEqual(item('q-two').reviewers, { contract: ['c2', 'c3'], quality: ['q2'] });
});

test('an archive move of both lens files is no round', () => {
  const before = readout(['--head', fixture.mid]);
  assert.deepEqual(data.items, before.items);
});

test('--head stops the walk inside an item: one record of both lens files is one round', () => {
  const first = spawnSync('git', ['rev-list', '--reverse', `${fixture.base}..${fixture.head}`], { cwd: fixture.root, encoding: 'utf8' }).stdout.split('\n')[0];
  const cut = readout(['--head', first]);
  assert.deepEqual(cut.items.map((entry) => [entry.item, entry.rounds, entry.lenses.contract.rounds, entry.lenses.quality.rounds]), [['q-one', 1, 1, 1]]);
});

test('a lens version that does not read makes its round one without a verdict, and the other lens still lists its files', () => {
  const edge = readout(['--head', fixture.edge, '--intent', 'gamma']);
  const one = item('g-one', edge);
  assert.deepEqual([one.rounds, one.unreadable, one.fix, one.kinds], [2, 1, 0, [null, null]]);
  assert.deepEqual(one.lenses.contract, { rounds: 2, fix: 0, findings: { ...counts(2, 0, 1, 0), unrated: 1 }, firstFindings: counts(0, 0, 0, 0) });
  assert.deepEqual([one.filesFirst, one.filesLast], [2, 2], 'round 2 lists the contract file and the quality file of round 1');
  assert.deepEqual(one.reviewers, { contract: ['c7'], quality: ['c7'] }, 'a version without a reviewer line names none');
  assert.deepEqual(readout(['--head', fixture.edge, '--intent', 'beta']).items.map((entry) => entry.item), ['q-one', 'q-two']);
});

test('the text readout prints both lenses per item and in total', () => {
  const out = stats(['--head', fixture.head]);
  assert.match(out, /^q-one +rounds 3 .*mutants 3 in 1 round, first 3 .* {2}mutants run 4 {2}contract rounds 2, fix 1, findings 1 blocker, 1 major, 0 minor {2}quality rounds 3, fix 2, findings 0 blocker, 1 major, 3 minor$/m);
  assert.match(out, /^q-two +rounds 3 .* {2}quality rounds 1, fix 0, findings 0 blocker, 0 major, 0 minor$/m);
  assert.match(out, /Mutants, each counted once\s+5 in 2 rounds, so 1\.0 per acceptance criterion/);
  assert.match(out, /Mutants counted as run\s+7: a carried mutant counts again only when its verdict changed/);
  assert.match(out, /Contract lens\s+5 rounds over 2 items, fix 3; findings 4, so 2\.0 per item: 1 blocker, 3 major, 0 minor; in its first round 1 blocker, 2 major, 0 minor/);
  assert.match(out, /Quality lens\s+4 rounds over 2 items, fix 2; findings 4, so 2\.0 per item: 0 blocker, 1 major, 3 minor; in its first round 0 blocker, 1 major, 2 minor/);
  const edge = stats(['--head', fixture.edge, '--intent', 'gamma']);
  assert.match(edge, /Quality lens\s+1 round over 1 item/);
  assert.match(edge, /^g-one .* {2}contract rounds 2, fix 0, findings 0 blocker, 1 major, 0 minor, 1 unrated {2}quality /m);
  assert.match(out, /Reviewer tokens per item, both lenses: add --tree, --base and --intent as here/);
});
