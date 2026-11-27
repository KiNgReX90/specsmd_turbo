'use strict';

// A mutant counted once: a carried mutant is no new mutant, and a later listing counts as run
// only when its verdict changed. The released flow's untargeted mutants count as before.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { countRounds } = require('./mutants.cjs');

const target = (criterion, caught, at = {}) => ({
  criterion: String(criterion), file: 'src/gift.ts', line: 10 + criterion, find: `a${criterion}`, replace: `b${criterion}`,
  test: 'npm test', ...(caught === undefined ? {} : { caught }), ...at,
});
const sizes = (rounds) => rounds.map((round) => [round.fresh.length, round.ran.length, round.survived.length]);

test('15 run in round 1 and 13 listed in round 2, two of them survivors run again: 15 distinct, 17 run', () => {
  const first = Array.from({ length: 15 }, (_, index) => target(index + 1, index < 2 ? 'no' : 'yes'));
  const second = [target(1, 'yes'), target(2, 'yes'), ...first.slice(4)];
  assert.equal(second.length, 13);
  const rounds = countRounds([first, second]);
  assert.deepEqual(sizes(rounds), [[15, 15, 2], [0, 2, 0]]);
  assert.equal(rounds.reduce((total, round) => total + round.fresh.length, 0), 15);
  assert.equal(rounds.reduce((total, round) => total + round.ran.length, 0), 17);
});

test('a mutant listed again with the same verdict is not counted again, not even a survivor', () => {
  const rounds = countRounds([[target(1, 'yes'), target(2, 'no')], [target(1, 'yes'), target(2, 'no')], [target(2, 'none', { why: 'x' })]]);
  assert.deepEqual(sizes(rounds), [[2, 2, 1], [0, 0, 0], [0, 1, 0]]);
});

test('a proposal that never ran is a distinct mutant and counts as run when it first reads a verdict', () => {
  const rounds = countRounds([[target(1), target(2, 'yes')], [target(1), target(2, 'yes')], [target(1, 'no'), target(2, 'yes')]]);
  assert.deepEqual(sizes(rounds), [[2, 1, 0], [0, 0, 0], [0, 1, 1]]);
});

test('a verdict a mutant cannot carry counts as none read', () => {
  assert.deepEqual(sizes(countRounds([[target(1, 'maybe')], [target(1, 'yes')]])), [[1, 0, 0], [0, 1, 0]]);
});

for (const [key, other] of [['criterion', '9'], ['find', 'other'], ['replace', 'other']]) {
  test(`a mutant on another ${key} is another mutant`, () => {
    assert.deepEqual(sizes(countRounds([[target(1, 'yes')], [target(1, 'yes', { [key]: other })]])), [[1, 1, 0], [1, 1, 0]]);
  });
}

test('two mutants of one criterion with another find stay two in one round', () => {
  assert.deepEqual(sizes(countRounds([[target(1, 'yes'), target(1, 'no', { find: 'other' })]])), [[2, 2, 1]]);
});

test('a proposal that never ran and runs in round 2 at a line the runner moved is one mutant, run once', () => {
  assert.deepEqual(sizes(countRounds([[target(1)], [target(1, 'yes', { line: 99 })]])), [[1, 0, 0], [0, 1, 0]]);
});

test('a proposal that never ran and runs in round 2 in the file its line moved to is one mutant, run once', () => {
  assert.deepEqual(sizes(countRounds([[target(1)], [target(1, 'yes', { file: 'src/moved.ts', line: 3 })]])), [[1, 0, 0], [0, 1, 0]]);
});

test('a survivor given another test and caught in round 2 is one mutant, run twice', () => {
  assert.deepEqual(sizes(countRounds([[target(1, 'no')], [target(1, 'yes', { test: 'npm run other' })]])), [[1, 1, 1], [0, 1, 0]]);
});

test('an empty replace and a missing one are the same text', () => {
  const dropped = target(1, 'yes', { replace: '' });
  const missing = { ...target(1, 'yes') };
  delete missing.replace;
  assert.deepEqual(sizes(countRounds([[dropped], [missing]])), [[1, 1, 0], [0, 0, 0]]);
});

test('a mutant the released flow planted counts in every round that lists it, run when it carries a verdict', () => {
  const planted = (caught) => ({ criterion: '1', test: 'npm test', ...(caught === undefined ? {} : { caught }) });
  const rounds = countRounds([[planted('yes'), planted('no')], [planted('yes'), planted()]]);
  assert.deepEqual(sizes(rounds), [[2, 2, 1], [2, 1, 0]]);
});

test('an item counts a mutant its first round lists twice once, in its first round and in its largest round too', () => {
  const { summarize } = require('./item-rounds.cjs');
  const twice = [target(1, 'yes'), target(1, 'yes')];
  const version = { readable: true, verdict: 'clean', findings: [], mutants: twice, survivors: [], files: [] };
  const round = { sha: 'r1', lenses: { contract: version }, readable: true, fix: false, findings: [], mutants: twice, survivors: [], files: [], kind: null };
  const item = summarize({ intent: 'i', item: 'x', rounds: [round], reviewers: { contract: [], quality: [] } }, undefined, null);
  assert.deepEqual([item.mutants, item.mutantsRun, item.firstRound.mutants, item.largest], [1, 1, 1, 1]);
});
