'use strict';

// Reviewer tokens of both lenses: the two reviewer agent types summed over a session, and per
// item the threads its review files name on their reviewer lines, both lenses together.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { S } = require('./fixture.cjs');
const { build } = require('./fixture-lens.cjs');
const { tempDir } = require(path.join(S, 'test-temp.cjs'));

const TOKENS = path.join(__dirname, 'tokens.cjs');
const fixture = build();

const said = (id, [input, read, create, output]) => ({
  type: 'assistant',
  message: { id, model: 'model-r', usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: create, output_tokens: output } },
});

function agent(dir, session, id, type, entries) {
  const file = path.join(dir, session, 'subagents', `agent-${id}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  fs.writeFileSync(file.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ agentType: type }));
}

function sessions() {
  const dir = path.join(tempDir('review-loop-item-tokens-'), 'project');
  fs.mkdirSync(dir, { recursive: true });
  for (const id of ['s1', 's2']) fs.writeFileSync(path.join(dir, `${id}.jsonl`), `${JSON.stringify(said(`main-${id}`, [1, 1, 0, 1]))}\n`);
  agent(dir, 's1', 'c1', 'specsmd-inferno-reviewer', [said('m1', [1, 100, 10, 1]), said('m2', [1, 200, 0, 1])]);
  agent(dir, 's1', 'q1', 'specsmd-inferno-reviewer-quality', [said('m3', [2, 300, 0, 2])]);
  agent(dir, 's1', 'c2', 'specsmd-inferno-reviewer', [said('m4', [1, 50, 0, 2])]);
  agent(dir, 's1', 'q2', 'specsmd-inferno-reviewer-quality', [said('m5', [1, 60, 0, 1])]);
  agent(dir, 's1', 'b1', 'specsmd-inferno-builder', [said('m6', [5, 5000, 0, 5])]);
  agent(dir, 's1', 'c7', 'specsmd_inferno_reviewer', [said('m8', [1, 10, 0, 1])]);
  agent(dir, 's1', 'c3', 'specsmd-inferno-reviewer', [said('m7', [3, 700, 0, 3])]);
  agent(dir, 's2', 'c3', 'specsmd-inferno-reviewer', [said('m7', [3, 700, 0, 3])]);
  return dir;
}

const dir = sessions();

function tokens(args) {
  const result = spawnSync(process.execPath, [TOKENS, '--session', dir, ...args], { encoding: 'utf8' });
  return { code: result.status, out: result.stdout || '', err: result.stderr || '' };
}

function readout(args) {
  const result = tokens(['--json', ...args]);
  assert.equal(result.code, 0, result.out + result.err);
  return JSON.parse(result.out);
}

const range = (head = fixture.head) => ['--tree', fixture.root, '--base', fixture.base, '--head', head];
const pick = (tally) => [tally.threads, tally.rounds, tally.total];

test('the reviewer types of both lenses add up per session, on either platform, and a builder is no reviewer', () => {
  const data = readout([]);
  assert.deepEqual(pick(data.sessions[0].reviewers), [6, 7, 1451]);
  assert.deepEqual(pick(data.sessions[1].reviewers), [1, 1, 706]);
  assert.deepEqual(pick(data.total.reviewers), [7, 8, 2157]);
  assert.equal(data.items, undefined, 'without --tree no item is read');
});

test('per item, the threads both reviewers wrote are summed, a thread in two sessions once', () => {
  const data = readout(range());
  const [one, two] = data.items;
  assert.deepEqual([one.item, pick(one.contract), pick(one.quality), pick(one.both), one.missing], ['q-one', [1, 2, 314], [1, 1, 304], [2, 3, 618], ['q9']]);
  assert.equal(one.both.contextMedian, 201);
  assert.deepEqual([two.item, pick(two.contract), pick(two.quality), pick(two.both), two.missing], ['q-two', [3, 2, 759], [1, 1, 62], [4, 3, 821], []]);
  assert.deepEqual(data.perItem, { items: 2, total: 1439, mean: 720 });
});

test('a reviewer both lenses name counts once, and --intent picks the intent', () => {
  const data = readout([...range(fixture.edge), '--intent', 'gamma']);
  assert.deepEqual(data.items.map((entry) => [entry.item, pick(entry.contract), pick(entry.quality), pick(entry.both)]),
    [['g-one', [1, 1, 12], [1, 1, 12], [1, 1, 12]]]);
  assert.deepEqual(data.perItem, { items: 1, total: 12, mean: 12 });
});

test('the text readout prints the reviewers line and one line per item', () => {
  const result = tokens(range());
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /^ {2}reviewers, both lenses {2}threads 6 {2}rounds 7 .* total 1k {2}/m);
  assert.match(result.out, /^reviewer tokens per item, both lenses$/m);
  assert.match(result.out, /^ {2}q-one {2}contract 314 in 2 rounds {2}quality 304 in 1 round {2}both 618, context per round median 201 {2}no transcript for q9$/m);
  assert.match(result.out, /^ {2}q-two {2}contract 759 in 2 rounds {2}quality 62 in 1 round {2}both 821, context per round median 61$/m);
  assert.match(result.out, /^ {2}2 items, 1k in all, so 720 per item$/m);
  const none = tokens([...range(fixture.base)]);
  assert.match(none.out, /^ {2}no item review was recorded in this range$/m);
  assert.match(none.out, /^ {2}0 items, 0 in all, so 0 per item$/m);
});

test('a session without a reviewer prints no reviewers line', () => {
  const lone = path.join(tempDir('review-loop-lone-'), 'project');
  fs.mkdirSync(lone, { recursive: true });
  fs.writeFileSync(path.join(lone, 'solo.jsonl'), `${JSON.stringify(said('x1', [1, 1, 1, 1]))}\n`);
  const result = spawnSync(process.execPath, [TOKENS, '--session', lone], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /reviewers, both lenses/);
});

test('the review range is refused when it is half given or names nothing', () => {
  for (const [args, reason] of [
    [['--tree', fixture.root], /--tree and --base go together/],
    [['--base', fixture.base], /--tree and --base go together/],
    [['--intent', 'beta'], /need --tree and --base/],
    [['--head', fixture.head], /need --tree and --base/],
    [['--tree', path.join(fixture.root, 'no-such-dir'), '--base', fixture.base], /does not exist/],
    [['--tree', fixture.root, '--base', 'no-such-ref'], /no-such-ref names no commit/],
    [['--tree'], /--tree needs a value/],
    [['--bogus'], /--bogus is no option here/],
  ]) {
    const result = tokens(args);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.err, reason);
    assert.match(result.err, /usage: node tokens\.cjs --session <transcript dir> \[--json\] \[--tree <intent worktree> --base <ref>/);
  }
});
