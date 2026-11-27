'use strict';

// The Claude Code count of one planner run, read from the stream `claude -p --output-format
// stream-json --verbose` writes: one JSON object per line, and one API message over several
// lines, one content block each, every line carrying the message's id and usage.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { S } = require('./paths.cjs');
const { tempDir } = require(path.join(S, 'test-temp.cjs'));
const { countClaude } = require('./count-claude.cjs');

const usage = (input, create, read, output) => ({
  input_tokens: input, cache_creation_input_tokens: create, cache_read_input_tokens: read, output_tokens: output,
});
const said = (id, block, use, parent = null) => ({
  type: 'assistant',
  message: { id, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [block], stop_reason: null, usage: use },
  parent_tool_use_id: parent,
  session_id: 'session-1',
  uuid: `${id}-${block.type}-${block.id || ''}`,
});
const model = (input, create, read, output, thinking, cost) => ({
  inputTokens: input, outputTokens: output, cacheReadInputTokens: read, cacheCreationInputTokens: create, thinkingTokens: thinking, costUSD: cost,
});
const result = ({ turns, ms, use, thinking, models, cost }) => ({
  type: 'result', subtype: 'success', is_error: false, duration_ms: ms, duration_api_ms: ms, num_turns: turns, result: 'Triage: intent',
  session_id: 'session-1', total_cost_usd: cost, usage: { ...use, output_tokens_details: { thinking_tokens: thinking } }, modelUsage: models,
});
const bash = (id, command) => ({ type: 'tool_use', id, name: 'Bash', input: { command, description: 'look' } });
const back = (id) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
  parent_tool_use_id: null,
  session_id: 'session-1',
});

function transcript(entries) {
  const file = path.join(tempDir('planner-ab-claude-'), 'transcript.jsonl');
  fs.writeFileSync(file, entries.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n') + '\n');
  return file;
}

const RUN = [
  { type: 'system', subtype: 'init', cwd: '/sandbox/tree', session_id: 'session-1', model: 'claude-opus-5-5', tools: ['Bash', 'Read'] },
  said('msg_01', { type: 'thinking', thinking: 'read the ledger first', signature: 'x' }, usage(10, 2000, 0, 5)),
  said('msg_01', bash('toolu_1', 'rg -n saveCard src && sed -n 1,40p src/ledger/movements.js'), usage(10, 2000, 0, 120)),
  said('msg_01', { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/sandbox/tree/src/orders/refund.js' } }, usage(10, 2000, 0, 140)),
  back('toolu_1'),
  back('toolu_2'),
  { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' }, session_id: 'session-1' },
  said('msg_02', { type: 'text', text: 'The refund path refuses gift cards.' }, usage(3, 100, 2000, 40)),
  said('msg_03', bash('toolu_3', 'ls .specs-inferno'), usage(2, 50, 2100, 30)),
  said('msg_03', bash('toolu_3', 'ls .specs-inferno'), usage(2, 50, 2100, 30)),
  back('toolu_3'),
  { type: 'system', subtype: 'compact_boundary', session_id: 'session-1', compact_metadata: { trigger: 'auto', pre_tokens: 160000 } },
  said('msg_04', { type: 'text', text: 'a side thread' }, usage(1, 0, 10, 7), 'toolu_9'),
  result({ turns: 4, ms: 61000, use: usage(16, 2150, 4110, 2170), thinking: 1500, models: { 'claude-opus-5-5': model(16, 2150, 4110, 2170, 1500, 1.25) }, cost: 1.25 }),
];

test('each API message counts once over its lines as one model round', () => {
  const count = countClaude(transcript(RUN));
  assert.equal(count.rounds, 4);
  assert.equal(count.subagentRounds, 1);
  assert.deepEqual(count.models, ['claude-opus-5-5']);
});

test('the run\'s totals come from its result line, never from the start value each assistant line carries', () => {
  const count = countClaude(transcript(RUN));
  assert.notEqual(count.output, 140 + 40 + 30 + 7, 'the lines carry the value each message started with');
  assert.equal(count.output, 2170);
  assert.equal(count.thinking, 1500);
  assert.equal(count.costUsd, 1.25);
  assert.equal(count.turns, 4);
  assert.equal(count.input, 16);
  assert.equal(count.cacheRead, 4110);
  assert.equal(count.cacheCreation, 2150);
  assert.equal(count.resultLines, 1);
});

test('with several result lines the last one\'s modelUsage is the session total, summed over its models and never over the lines', () => {
  const total = { 'claude-opus-5-5': model(500, 9000, 90000, 7000, 3000, 4.5), 'claude-haiku-5-5': model(20, 100, 1000, 300, 0, 0.06) };
  const lines = [
    ...RUN.slice(0, -1),
    // A build writes one result line per turn, all of them when the session ends, each with the session's running total.
    result({ turns: 20, ms: 700000, use: usage(40, 6000, 80000, 5000), thinking: 100, models: total, cost: 4.55 }),
    result({ turns: 3, ms: 9000, use: usage(4, 600, 8000, 900), thinking: 50, models: total, cost: 4.55 }),
  ];
  const count = countClaude(transcript(lines));
  assert.equal(count.output, 7300);
  assert.equal(count.thinking, 3000);
  assert.equal(count.costUsd, 4.55, 'the cost is the line\'s own total_cost_usd, not the sum of the models\' costUSD');
  assert.equal(count.input, 520);
  assert.equal(count.cacheRead, 91000);
  assert.equal(count.cacheCreation, 9100);
  assert.equal(count.turns, 23);
  assert.equal(count.hostWallMs, 709000);
  assert.equal(count.resultLines, 2);
  assert.deepEqual(count.models, ['claude-haiku-5-5', 'claude-opus-5-5']);
});

test('a result line that names no total_cost_usd has no cost, never a zero', () => {
  const [last] = RUN.slice(-1);
  const { total_cost_usd: dropped, ...rest } = last;
  assert.equal(dropped, 1.25);
  assert.equal(countClaude(transcript([...RUN.slice(0, -1), rest])).costUsd, null);
});

test('a single result line with no modelUsage gives its own usage as the run\'s total', () => {
  const lines = [...RUN.slice(0, -1), { type: 'result', subtype: 'success', duration_ms: 1000, num_turns: 2, total_cost_usd: 0.5, usage: { ...usage(1, 2, 3, 444), output_tokens_details: { thinking_tokens: 40 } } }];
  const count = countClaude(transcript(lines));
  assert.equal(count.output, 444);
  assert.equal(count.thinking, 40);
  assert.equal(count.costUsd, 0.5);
});

test('a result line that names no total fails loudly, never counted as zero', () => {
  const bare = { type: 'result', subtype: 'success', duration_ms: 1000 };
  assert.throws(() => countClaude(transcript([...RUN.slice(0, -1), bare])), /line 14: .*result line carries no usage/);
  const turn = { ...bare, usage: usage(1, 0, 0, 5) };
  assert.throws(() => countClaude(transcript([...RUN.slice(0, -1), turn, turn])), /line 15: .*no modelUsage/);
  const broken = result({ turns: 1, ms: 1, use: usage(1, 0, 0, 5), thinking: 0, models: { 'claude-opus-5-5': { inputTokens: 1 } }, cost: 0 });
  assert.throws(() => countClaude(transcript([...RUN.slice(0, -1), broken])), /line 14: .*claude-opus-5-5 .*outputTokens/);
});

test('a Bash call counts once by its id, and its subcommands are counted as well', () => {
  const count = countClaude(transcript(RUN));
  assert.equal(count.shellCalls, 2);
  assert.equal(count.shellSubcommands, 3);
  assert.deepEqual(count.tools, { Bash: 2, Read: 1 });
});

test('the host wall time and the compactions are read from their own lines', () => {
  const count = countClaude(transcript(RUN));
  assert.equal(count.hostWallMs, 61000);
  assert.equal(count.compactions, 1);
  assert.equal(count.finished, true);
});

test('a run that never wrote its result line is unfinished and has no totals, never a zero', () => {
  const count = countClaude(transcript(RUN.slice(0, -1)));
  assert.equal(count.hostWallMs, null);
  assert.equal(count.finished, false);
  assert.equal(count.rounds, 4);
  for (const key of ['output', 'thinking', 'costUsd', 'turns', 'input', 'cacheRead', 'cacheCreation']) assert.equal(count[key], null, key);
  assert.equal(count.resultLines, 0);
});

test('a line the counter does not know fails loudly with its line number', () => {
  assert.throws(() => countClaude(transcript([RUN[0], { type: 'brand_new_event' }])), /line 2: .*brand_new_event/);
  assert.throws(() => countClaude(transcript([RUN[0], 'not json'])), /line 2: .*not JSON/);
  const noId = { type: 'assistant', message: { role: 'assistant', content: [], usage: usage(1, 0, 0, 1) } };
  assert.throws(() => countClaude(transcript([noId])), /line 1: .*message\.id/);
  const noUsage = { type: 'assistant', message: { id: 'msg_9', role: 'assistant', content: [] } };
  assert.throws(() => countClaude(transcript([noUsage])), /line 1: .*usage/);
  assert.throws(() => countClaude(transcript([said('msg_5', { type: 'hologram' }, usage(1, 0, 0, 1))])), /line 1: .*content block hologram/);
  assert.throws(() => countClaude(transcript([said('msg_5', { type: 'tool_use', id: 't', name: 'Bash', input: {} }, usage(1, 0, 0, 1))])),
    /line 1: .*Bash call t has no command/);
});

test('a transcript with no API message at all is refused, not counted as zero', () => {
  assert.throws(() => countClaude(transcript([RUN[0]])), /no API message/);
});
