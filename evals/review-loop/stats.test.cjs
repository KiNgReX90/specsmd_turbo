'use strict';

// The review-loop readout on a recorded history: every total of the plan's section 1 that
// comes from review files, and each rule of its appendix. The history is in fixture.cjs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { build, git } = require('./fixture.cjs');

const STATS = path.join(__dirname, 'stats.cjs');
const fixture = build();

function stats(args, env = {}) {
  const result = spawnSync(process.execPath, [STATS, ...args], {
    encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: fixture.cache, ...env },
  });
  return { code: result.status, out: result.stdout || '', err: result.stderr || '' };
}

function readout(args = []) {
  const result = stats(['--tree', fixture.root, '--base', fixture.base, '--json', ...args]);
  assert.equal(result.code, 0, result.out + result.err);
  return JSON.parse(result.out);
}

const data = readout();
const item = (id) => data.items.find((entry) => entry.item === id);

test('a round is a recorded version, and the tree, commit and reviewer lines never make one', () => {
  assert.deepEqual(data.items.map((entry) => [entry.item, entry.rounds]), [['a-one', 4], ['a-two', 2], ['c-three', 3]]);
  assert.equal(item('z-old'), undefined, 'a re-record of a review recorded before base is no round');
  assert.equal(data.totals.rounds, 9);
  assert.equal(data.totals.items, 3);
  assert.equal(data.totals.roundsPerItem, 3);
  assert.deepEqual(data.totals.roundsSorted, [4, 3, 2]);
});

test('an archive move keeps the review it moved, so it is no round', () => {
  const before = readout(['--head', fixture.mid]);
  assert.deepEqual(data.items, before.items, 'the move adds no round and no grant');
  assert.equal(data.totals.grantCommits, before.totals.grantCommits);
});

test('a fix round is serious, serious only through a survivor, or minor only', () => {
  assert.deepEqual(item('a-one').kinds, ['serious', 'survivor', 'minor', null]);
  assert.deepEqual(item('a-two').kinds, ['survivor', null]);
  assert.deepEqual(item('c-three').kinds, ['minor', 'serious', null]);
  assert.equal(data.totals.fixRounds, 6);
  assert.equal(data.totals.serious, 2);
  assert.equal(data.totals.survivorOnly, 2);
  assert.equal(data.totals.minorOnly, 2);
});

test('findings in round 2 and later are counted by severity', () => {
  assert.deepEqual(data.totals.laterFindings, { total: 4, blocker: 1, major: 1, minor: 2 });
});

test('criteria come from each reviewed item spec, wherever it lives at head', () => {
  assert.deepEqual(data.items.map((entry) => entry.criteria), [3, 2, 1]);
  assert.equal(data.totals.criteria, 6);
});

test('mutants are counted per round, and a numbered criterion is one that starts with a number', () => {
  const totals = data.totals;
  assert.equal(totals.mutants, 15);
  assert.equal(totals.mutantRounds, 7);
  assert.equal(totals.mutantsPerCriterion, 2.5);
  assert.deepEqual(totals.firstRound, { mutants: 5, numbered: 4, freeText: 1 });
  assert.deepEqual(totals.laterRounds, { mutants: 10, numbered: 5, freeText: 5 });
  assert.deepEqual(totals.survivors, { mutants: 3, numbered: 2, freeText: 1 });
});

test('the largest round names its mutants, its item and that item criteria', () => {
  assert.deepEqual(data.totals.largest, { mutants: 4, item: 'a-one', criteria: 3 });
});

test('a commit that grows an item editable list is a grant, once per commit', () => {
  assert.deepEqual(data.items.map((entry) => entry.grants), [2, 0, 1]);
  assert.equal(data.totals.grantCommits, 2);
});

test('the files a review lists are read from its first round to its last', () => {
  assert.deepEqual(data.items.map((entry) => [entry.filesFirst, entry.filesLast]), [[1, 4], [1, 1], [1, 3]]);
  assert.deepEqual(data.totals.filesGrowth, [{ item: 'a-one', first: 1, last: 4 }, { item: 'c-three', first: 1, last: 3 }]);
});

test('--head stops the walk at that commit', () => {
  const early = git(fixture.root, ['rev-list', '--reverse', `${fixture.base}..${fixture.head}`]).split('\n')[4];
  const cut = readout(['--head', early]);
  assert.deepEqual(cut.items.map((entry) => [entry.item, entry.rounds]), [['a-one', 1]]);
  assert.equal(cut.totals.grantCommits, 1);
});

test('oracle dispatches are counted by route, and an entry without one is unrouted', () => {
  const log = path.join(fixture.cache, 'specsmd-inferno', path.basename(fixture.root), 'dispatch', 'alpha.log');
  assert.equal(readout().oracle.present, false);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.writeFileSync(log, [
    ['t1', 'alpha', 'a-one', 'cheap', 'specsmd-inferno-builder-cheap', ''].join('\t'),
    ['t2', 'alpha', 'a-one', 'strong', 'specsmd-inferno-builder', '', 'd-1'].join('\t'),
    ['t3', 'alpha', 'a-one', 'escalate', 'specsmd-inferno-oracle', '', 'd-2'].join('\t'),
    ['t4', 'alpha', 'a-two', 'escalate', 'specsmd-inferno-oracle', '', 'd-3', 'route=hard', 'impact=high', 'complexity=high'].join('\t'),
    ['t5', 'alpha', 'a-two', 'escalate', 'specsmd_inferno_oracle', '', 'd-4', 'route=normal'].join('\t'),
    ['t6', 'alpha', 'c-three', 'escalate', 'specsmd-inferno-oracle', '', 'd-5', 'route=normal'].join('\t'),
  ].join('\n') + '\n');
  try {
    const oracle = readout().oracle;
    assert.equal(oracle.present, true);
    assert.equal(oracle.total, 4);
    assert.deepEqual(oracle.byRoute, { hard: 1, normal: 2, unrouted: 1 });
  } finally {
    fs.rmSync(log);
  }
});

test('the text readout prints one line per item and the section 1 rows', () => {
  const result = stats(['--tree', fixture.root, '--base', fixture.base]);
  assert.equal(result.code, 0, result.err);
  const lines = result.out.split('\n');
  assert.ok(lines.some((line) => /^a-one\b.*rounds 4\b/.test(line)), result.out);
  for (const row of [
    /Review rounds\s+9 over 3 items, so 3\.0 per item/,
    /Rounds per item, sorted\s+4, 3, 2/,
    /Fix rounds\s+6/,
    /Fix rounds with a blocker or major finding that is not a surviving mutant\s+2/,
    /Fix rounds that are serious only because a mutant survived\s+2/,
    /Fix rounds with minor findings only and no survivor\s+2/,
    /Findings in round 2 and later\s+4: 1 blocker, 1 major, 2 minor/,
    /Acceptance criteria of the 3 items\s+6/,
    /Mutants run\s+15 in 7 rounds, so 2\.5 per acceptance criterion/,
    /Mutants in a first round\s+5, of which 4 name a numbered criterion/,
    /Mutants in round 2 and later\s+10, of which 5 name a criterion in free text/,
    /Surviving mutants\s+3: 2 on a numbered criterion, 1 on a free-text one/,
    /Largest single round\s+4 mutants, on an item with 3 acceptance criteria \(a-one\)/,
    /Commits that grant an item more ownership\s+2/,
    /Files an item's review lists, first round to last\s+1 to 4, 1 to 3/,
    /Oracle dispatches\s+no dispatch log/,
  ]) {
    assert.match(result.out, row);
  }
});

test('a missing ref or argument is refused with the usage', () => {
  const missing = stats(['--tree', fixture.root]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /usage: node stats\.cjs --tree <intent worktree> --base <ref>/);
  const bad = stats(['--tree', fixture.root, '--base', 'no-such-ref']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /no-such-ref/);
});
