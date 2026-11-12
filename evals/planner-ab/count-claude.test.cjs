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
  { type: 'result', subtype: 'success', is_error: false, duration_ms: 61000, duration_api_ms: 50000, num_turns: 4, result: 'Triage: intent', session_id: 'session-1', total_cost_usd: 1.25, usage: usage(16, 2150, 4110, 217) },
];

test('each API message counts once over its lines, each usage field at its largest', () => {
  const count = countClaude(transcript(RUN));
  assert.equal(count.rounds, 4);
  assert.equal(count.subagentRounds, 1);
  assert.equal(count.output, 140 + 40 + 30 + 7);
  assert.equal(count.input, 10 + 3 + 2 + 1);
  assert.equal(count.cacheRead, 0 + 2000 + 2100 + 10);
  assert.equal(count.cacheCreation, 2000 + 100 + 50 + 0);
  assert.deepEqual(count.models, ['claude-opus-5-5']);
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

test('a run that never wrote its result line has no host wall time and is not finished', () => {
  const count = countClaude(transcript(RUN.slice(0, -1)));
  assert.equal(count.hostWallMs, null);
  assert.equal(count.finished, false);
  assert.equal(count.rounds, 4);
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
