'use strict';

// Tokens, rounds and context per round by agent type, read from session transcripts laid out
// as the host writes them: <dir>/<session>.jsonl for the orchestrator's own thread, and
// <dir>/<session>/subagents/agent-<id>.jsonl with agent-<id>.meta.json beside each.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { S } = require('./fixture.cjs');
const { tempDir } = require(path.join(S, 'test-temp.cjs'));

const TOKENS = path.join(__dirname, 'tokens.cjs');

const said = (id, [input, read, create, output], model = 'model-a') => ({
  type: 'assistant',
  message: { id, model, usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: create, output_tokens: output } },
});

function thread(file, entries, meta) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n') + '\n');
  if (meta) fs.writeFileSync(file.replace(/\.jsonl$/, '.meta.json'), JSON.stringify(meta));
}

function sessions() {
  const dir = path.join(tempDir('review-loop-tokens-'), 'project');
  thread(path.join(dir, 's1.jsonl'), [
    { type: 'user', message: { role: 'user', content: 'build the Acme Shop gift cards' } },
    said('m1', [10, 100, 20, 5]),
    said('m1', [10, 100, 20, 7]),
    'not a json line',
    { type: 'assistant', message: { id: 'm3', model: 'model-a' } },
    said('m2', [1, 200, 0, 3]),
  ]);
  const sub = path.join(dir, 's1', 'subagents');
  thread(path.join(sub, 'agent-r1.jsonl'), [said('m10', [2, 1000, 50, 10], 'model-r'), said('m11', [3, 3000, 0, 20], 'model-r')],
    { agentType: 'specsmd-inferno-reviewer' });
  thread(path.join(sub, 'agent-r2.jsonl'), [said('m12', [1, 500, 100, 1], 'model-r')], { agentType: 'specsmd-inferno-reviewer' });
  thread(path.join(sub, 'agent-b1.jsonl'), [said('m20', [5, 4000, 0, 50]), said('m20', [5, 4000, 0, 50]), said('m20', [5, 4000, 0, 50])],
    { agentType: 'specsmd-inferno-builder' });
  thread(path.join(sub, 'agent-x.jsonl'), [said('m40', [0, 0, 9, 1])]);
  thread(path.join(dir, 's2.jsonl'), [said('m30', [0, 513000000, 174000, 2000])]);
  return dir;
}

function tokens(args) {
  const result = spawnSync(process.execPath, [TOKENS, ...args], { encoding: 'utf8' });
  return { code: result.status, out: result.stdout || '', err: result.stderr || '' };
}

function readout(target) {
  const result = tokens(['--session', target, '--json']);
  assert.equal(result.code, 0, result.out + result.err);
  return JSON.parse(result.out);
}

const dir = sessions();

test('one session folder: each agent type with its threads, rounds, tokens and context per round', () => {
  const data = readout(path.join(dir, 's1'));
  assert.deepEqual(data.sessions.map((session) => session.id), ['s1']);
  const types = data.sessions[0].types;
  assert.deepEqual(Object.keys(types), ['orchestrator', 'specsmd-inferno-builder', 'specsmd-inferno-reviewer', 'unknown']);
  assert.deepEqual(types.orchestrator, {
    threads: 1, rounds: 2, input: 11, cacheRead: 300, cacheCreation: 20, output: 10, total: 341,
    contextMedian: 165.5, contextMax: 201, models: ['model-a'],
  });
  assert.deepEqual(types['specsmd-inferno-reviewer'], {
    threads: 2, rounds: 3, input: 6, cacheRead: 4500, cacheCreation: 150, output: 31, total: 4687,
    contextMedian: 1052, contextMax: 3003, models: ['model-r'],
  });
  assert.equal(types['specsmd-inferno-builder'].rounds, 1, 'one API message id counts once over its lines');
  assert.equal(types['specsmd-inferno-builder'].cacheRead, 4000);
  assert.equal(types.unknown.threads, 1, 'a thread without meta is counted under unknown');
  assert.equal(data.sessions[0].skipped, 1, 'a line that is no JSON is skipped and counted');
});

test('the folder that holds sessions reads every session and adds them up', () => {
  const data = readout(dir);
  assert.deepEqual(data.sessions.map((session) => session.id), ['s1', 's2']);
  assert.equal(data.total.types.orchestrator.threads, 2);
  assert.equal(data.total.types.orchestrator.rounds, 3);
  assert.equal(data.total.types.orchestrator.contextMax, 513174000);
  assert.equal(data.total.types['specsmd-inferno-reviewer'].rounds, 3);
});

test('a session file names its session too', () => {
  assert.deepEqual(readout(path.join(dir, 's2.jsonl')).sessions.map((session) => session.id), ['s2']);
});

test('the text readout prints one line per agent type with tokens in k and M', () => {
  const result = tokens(['--session', dir]);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /^session s1$/m);
  assert.match(result.out, /^ {2}orchestrator\s+threads 1\s+rounds 2\s+input 11\s+cache read 300\s+cache write 20\s+output 10\s+total 341\s+context per round median 166, max 201\s+models model-a$/m);
  assert.match(result.out, /^session s2$/m);
  assert.match(result.out, /cache read 513M\s+cache write 174k\s+output 2k\s+total 513M\s+context per round median 513M, max 513M/);
  assert.match(result.out, /^all sessions$/m);
});

test('a folder with no session and a missing argument are refused with the usage', () => {
  const empty = tempDir('review-loop-empty-');
  const none = tokens(['--session', empty]);
  assert.equal(none.code, 1);
  assert.match(none.err, /no session/);
  const missing = tokens([]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /usage: node tokens\.cjs --session <transcript dir>/);
});
