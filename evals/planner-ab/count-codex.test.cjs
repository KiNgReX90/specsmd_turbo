'use strict';

// The Codex count of one planner run, read from the session rollout Codex keeps for a
// `codex exec` run: one JSON object per line with a `type` and a `payload`. A model round ends
// in a token_count event, and one shell call may batch several commands.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { S } = require('./paths.cjs');
const { tempDir } = require(path.join(S, 'test-temp.cjs'));
const { countCodex } = require('./count-codex.cjs');

let clock = Date.parse('2026-11-12T10:00:00.000Z');
const at = (seconds = 1) => new Date((clock += seconds * 1000)).toISOString();
const line = (type, payload, seconds) => ({ timestamp: at(seconds), type, payload });
const item = (payload, seconds) => line('response_item', payload, seconds);
const call = (name, args, id) => item({ type: 'function_call', name, arguments: JSON.stringify(args), call_id: id });
const tokens = (total, last) => line('event_msg', {
  type: 'token_count',
  info: { total_token_usage: total, last_token_usage: last, model_context_window: 272000 },
  rate_limits: { primary: { used_percent: 10 } },
});
const use = (input, cached, output, reasoning) => ({
  input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output,
});

function rollout(entries) {
  const file = path.join(tempDir('planner-ab-codex-'), 'transcript.jsonl');
  fs.writeFileSync(file, entries.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n') + '\n');
  return file;
}

function run() {
  clock = Date.parse('2026-11-12T10:00:00.000Z');
  return [
    line('session_meta', { id: 'thread-1', timestamp: at(0), cwd: '/sandbox/tree', originator: 'codex_exec', cli_version: '0.115.0' }, 0),
    line('turn_context', { cwd: '/sandbox/tree', model: 'gpt-5.6-sol', effort: 'xhigh', approval_policy: 'never' }),
    item({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Load and follow the procedure.' }] }),
    item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'When an Acme Shop order is refunded...' }] }),
    line('event_msg', { type: 'user_message', message: 'When an Acme Shop order is refunded...' }),
    line('event_msg', { type: 'token_count', info: null, rate_limits: { primary: { used_percent: 9 } } }),
    item({ type: 'reasoning', summary: [], content: null, encrypted_content: 'opaque' }),
    call('shell', { command: ['bash', '-lc', 'rg -n saveCard src; sed -n 1,40p src/ledger/movements.js'], workdir: '/sandbox/tree' }, 'c1'),
    call('exec_command', { cmd: 'ls .specs-inferno && cat .specs-inferno/state.yaml' }, 'c2'),
    item({ type: 'function_call_output', call_id: 'c1', output: '{"output":"..."}' }),
    item({ type: 'function_call_output', call_id: 'c2', output: '{"output":"..."}' }),
    tokens(use(1000, 0, 300, 200), use(1000, 0, 300, 200)),
    tokens(use(1000, 0, 300, 200), use(1000, 0, 300, 200)),
    item({ type: 'local_shell_call', call_id: 'c3', status: 'completed', action: { type: 'exec', command: ['cat', 'src/orders/refund.js'] } }),
    call('shell_command', { command: 'wc -l src/orders/*.js', workdir: '/sandbox/tree' }, 'c4'),
    item({ type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** End Patch', call_id: 'c5', status: 'completed' }),
    call('update_plan', { plan: [] }, 'c6'),
    call('acme_docs__search', { query: 'refunds' }, 'c7'),
    line('compacted', { message: 'summary of the work so far' }),
    tokens(use(3000, 800, 500, 300), use(2000, 800, 200, 100)),
    line('event_msg', { type: 'agent_message', message: 'Triage: intent' }),
    item({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Triage: intent' }] }, 720),
  ];
}

test('a model round is a token count that moved the total, and its output is that round\'s own', () => {
  const count = countCodex(rollout(run()));
  assert.equal(count.rounds, 2);
  assert.equal(count.output, 300 + 200);
  assert.equal(count.reasoning, 200 + 100);
  assert.equal(count.input, 3000);
  assert.equal(count.cacheRead, 800);
  assert.deepEqual(count.models, ['gpt-5.6-sol']);
});

test('every shell call counts once, and the commands it batches count as subcommands', () => {
  const count = countCodex(rollout(run()));
  assert.equal(count.shellCalls, 4);
  assert.equal(count.shellSubcommands, 2 + 2 + 1 + 1);
  assert.deepEqual(count.tools, {
    shell: 1, exec_command: 1, local_shell_call: 1, shell_command: 1, apply_patch: 1, update_plan: 1, acme_docs__search: 1,
  });
});

test('the host wall time runs from the first line to the last, and a compaction is counted', () => {
  const count = countCodex(rollout(run()));
  const first = run();
  assert.equal(count.hostWallMs, Date.parse(first.at(-1).timestamp) - Date.parse(first[0].timestamp));
  assert.equal(count.compactions, 1);
  assert.equal(count.finished, true);
});

test('a line the counter does not know fails loudly with its line number', () => {
  const [meta] = run();
  assert.throws(() => countCodex(rollout([meta, line('brand_new', {})])), /line 2: .*brand_new/);
  assert.throws(() => countCodex(rollout([meta, 'not json'])), /line 2: .*not JSON/);
  assert.throws(() => countCodex(rollout([meta, item({ type: 'hologram' })])), /line 2: .*response item hologram/);
  assert.throws(() => countCodex(rollout([meta, call('teleport', {}, 'x')])), /line 2: .*function teleport/);
  assert.throws(() => countCodex(rollout([meta, item({ type: 'function_call', name: 'shell', arguments: '{oops', call_id: 'x' })])),
    /line 2: .*arguments are not JSON/);
  assert.throws(() => countCodex(rollout([meta, call('exec_command', { workdir: '/x' }, 'x')])), /line 2: .*shell call x has no command/);
  assert.throws(() => countCodex(rollout([meta, line('event_msg', { type: 'token_count', info: { last_token_usage: use(1, 0, 1, 0) } })])),
    /line 2: .*total_token_usage/);
  assert.throws(() => countCodex(rollout([meta, item({ type: 'custom_tool_call', name: 'mystery', input: '', call_id: 'x' })])),
    /line 2: .*custom tool mystery/);
});

test('a rollout with no model round is refused, not counted as zero', () => {
  assert.throws(() => countCodex(rollout(run().slice(0, 6))), /no model round/);
});
