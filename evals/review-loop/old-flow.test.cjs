'use strict';

// A history of the released flow (contract files only, every round plants new mutants) reads
// as it read before the readout learnt both lenses and to count a mutant once. The text and the
// numbers below are what the readout printed for fixture.cjs before that change.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { build } = require('./fixture.cjs');

const STATS = path.join(__dirname, 'stats.cjs');
const fixture = build();

const BEFORE = `review loop of <tree> from <base> to <head>

a-one    rounds 4  fix 3 (serious 1, survivor only 1, minor only 1)  later findings 0 blocker, 1 major, 1 minor  criteria 3  mutants 9 in 3 rounds, first 3  survivors 2  largest 4  files 1 to 4  grants 2
a-two    rounds 2  fix 1 (serious 0, survivor only 1, minor only 0)  later findings 0 blocker, 0 major, 0 minor  criteria 2  mutants 4 in 2 rounds, first 2  survivors 1  largest 2  files 1 to 1  grants 0
c-three  rounds 3  fix 2 (serious 1, survivor only 0, minor only 1)  later findings 1 blocker, 0 major, 1 minor  criteria 1  mutants 2 in 2 rounds, first 0  survivors 0  largest 1  files 1 to 3  grants 1

Review rounds                                                              9 over 3 items, so 3.0 per item
Rounds per item, sorted                                                    4, 3, 2
Fix rounds                                                                 6
Fix rounds with a blocker or major finding that is not a surviving mutant  2
Fix rounds that are serious only because a mutant survived                 2
Fix rounds with minor findings only and no survivor                        2
Findings in round 2 and later                                              4: 1 blocker, 1 major, 2 minor
Acceptance criteria of the 3 items                                         6
Mutants run                                                                15 in 7 rounds, so 2.5 per acceptance criterion
Mutants in a first round                                                   5, of which 4 name a numbered criterion
Mutants in round 2 and later                                               10, of which 5 name a criterion in free text
Surviving mutants                                                          3: 2 on a numbered criterion, 1 on a free-text one
Largest single round                                                       4 mutants, on an item with 3 acceptance criteria (a-one)
Commits that grant an item more ownership                                  2
Files an item's review lists, first round to last                          1 to 4, 1 to 3
Oracle dispatches                                                          no dispatch log at <cache>/specsmd-inferno/app/dispatch/alpha.log

Reviewer, builder and orchestrator tokens: node evals/review-loop/tokens.cjs --session <transcript dir>
`;

const counts = (total, blocker, major, minor) => ({ total, blocker, major, minor });
const split = (mutants, numbered, freeText) => ({ mutants, numbered, freeText });
const ITEMS = [
  {
    intent: 'alpha', item: 'a-one', rounds: 4, unreadable: 0, kinds: ['serious', 'survivor', 'minor', null], fix: 3, serious: 1, survivorOnly: 1,
    minorOnly: 1, laterFindings: counts(2, 0, 1, 1), criteria: 3, mutants: 9, mutantRounds: 3, firstRound: split(3, 2, 1),
    laterRounds: split(6, 3, 3), survivors: split(2, 1, 1), largest: 4, filesFirst: 1, filesLast: 4, grants: 2,
  },
  {
    intent: 'alpha', item: 'a-two', rounds: 2, unreadable: 0, kinds: ['survivor', null], fix: 1, serious: 0, survivorOnly: 1, minorOnly: 0,
    laterFindings: counts(0, 0, 0, 0), criteria: 2, mutants: 4, mutantRounds: 2, firstRound: split(2, 2, 0), laterRounds: split(2, 1, 1),
    survivors: split(1, 1, 0), largest: 2, filesFirst: 1, filesLast: 1, grants: 0,
  },
  {
    intent: 'alpha', item: 'c-three', rounds: 3, unreadable: 0, kinds: ['minor', 'serious', null], fix: 2, serious: 1, survivorOnly: 0,
    minorOnly: 1, laterFindings: counts(2, 1, 0, 1), criteria: 1, mutants: 2, mutantRounds: 2, firstRound: split(0, 0, 0),
    laterRounds: split(2, 1, 1), survivors: split(0, 0, 0), largest: 1, filesFirst: 1, filesLast: 3, grants: 1,
  },
];
const TOTALS = {
  items: 3, rounds: 9, roundsPerItem: 3, roundsSorted: [4, 3, 2], unreadable: 0, fixRounds: 6, serious: 2, survivorOnly: 2, minorOnly: 2,
  laterFindings: counts(4, 1, 1, 2), criteria: 6, criteriaMissing: [], mutants: 15, mutantRounds: 7, mutantsPerCriterion: 2.5,
  firstRound: split(5, 4, 1), laterRounds: split(10, 5, 5), survivors: split(3, 2, 1), largest: { mutants: 4, item: 'a-one', criteria: 3 },
  grantCommits: 2, filesGrowth: [{ item: 'a-one', first: 1, last: 4 }, { item: 'c-three', first: 1, last: 3 }],
};

function stats(args) {
  const result = spawnSync(process.execPath, [STATS, '--tree', fixture.root, '--base', fixture.base, ...args], {
    encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: fixture.cache },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

const pick = (entry, keys) => Object.fromEntries(keys.map((key) => [key, entry[key]]));

test('every number the readout gave a released-flow history before, it gives the same', () => {
  const data = JSON.parse(stats(['--json']));
  assert.deepEqual(data.items.map((item) => pick(item, Object.keys(ITEMS[0]))), ITEMS);
  assert.deepEqual(pick(data.totals, Object.keys(TOTALS)), TOTALS);
  assert.deepEqual(pick(data.oracle, ['present', 'total', 'byRoute']), { present: false, total: 0, byRoute: {} });
  assert.equal(data.totals.mutantsRun, 15, 'a released-flow mutant is run in every round that lists it');
  assert.equal(data.totals.lenses.quality.items, 0);
});

test('the text a released-flow history printed before stands, with only lines and segments added', () => {
  const now = stats([]).split(fixture.root).join('<tree>').split(fixture.cache).join('<cache>')
    .replace(`from ${fixture.base.slice(0, 9)} to ${fixture.head.slice(0, 9)}`, 'from <base> to <head>');
  const added = /^(?:Mutants counted as run|Contract lens|Quality lens|Reviewer tokens per item)\b/;
  const kept = now.split('\n').filter((line) => !added.test(line))
    .map((line) => line.replace(/ {2}mutants run \d+ {2}contract rounds .*$/, '').replace(/^Mutants, each counted once( +)/, (_, gap) => `Mutants run${' '.repeat(gap.length + 15)}`));
  assert.equal(kept.join('\n'), BEFORE);
});
