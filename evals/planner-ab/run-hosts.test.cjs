'use strict';

// The run half of the planner A/B eval end to end, with stand-ins for both host CLIs on PATH:
// each run plants the consumer at its fixed commit, installs the arm's flow from this
// repository's source, starts the host once with the statement on stdin, keeps the transcript
// (for Codex the session rollout its events name) and its meta, and the eval ends with the table.
// No model runs: the stand-ins write a small transcript in each host's format and plan nothing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { S, SRC, STATEMENT } = require('./paths.cjs');
const { tempDir } = require(path.join(S, 'test-temp.cjs'));

const CLI = path.join(__dirname, 'planner-ab.cjs');

/** A stand-in host: it logs its argv and stdin, then writes what the real one writes. */
const STAND_IN = `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const host = path.basename(process.argv[1]);
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log(host + ' stand-in'); process.exit(0); }
const stdin = fs.readFileSync(0, 'utf8');
fs.appendFileSync(path.join(process.env.FAKE_LOG, 'calls.jsonl'), JSON.stringify({ host, args, stdin, cwd: process.cwd() }) + '\\n');
const out = (entry) => process.stdout.write(JSON.stringify(entry) + '\\n');
if (host === 'claude') {
  out({ type: 'system', subtype: 'init', session_id: 's', model: 'claude-opus-5-5' });
  const usage = { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 100, output_tokens: 40 };
  out({ type: 'assistant', message: { id: 'msg_1', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls src && cat CLAUDE.md' } }], usage }, parent_tool_use_id: null });
  out({ type: 'assistant', message: { id: 'msg_2', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Triage: intent' }], usage }, parent_tool_use_id: null });
  out({ type: 'result', subtype: 'success', duration_ms: 1200, num_turns: 2, session_id: 's', total_cost_usd: 0.02, usage: { input_tokens: 10, output_tokens: 80 }, modelUsage: { 'claude-opus-5-5': { inputTokens: 10, outputTokens: 80, cacheReadInputTokens: 0, cacheCreationInputTokens: 200, costUSD: 0.02 } } });
} else {
  const id = '0190aaaa-bbbb-7ccc-8ddd-' + String(Date.now()).slice(-12).padStart(12, '0');
  const now = new Date();
  const day = path.join(process.env.CODEX_HOME, 'sessions', String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'));
  fs.mkdirSync(day, { recursive: true });
  const at = now.toISOString();
  const lines = [
    { timestamp: at, type: 'session_meta', payload: { id } },
    { timestamp: at, type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
    { timestamp: at, type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'ls src; cat AGENTS.md; pwd' }), call_id: 'c1' } },
    { timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 9, output_tokens: 30, total_tokens: 39 }, last_token_usage: { input_tokens: 9, output_tokens: 30, total_tokens: 39 } } } },
    { timestamp: at, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Triage: intent' }] } },
  ];
  fs.writeFileSync(path.join(day, 'rollout-' + at.slice(0, 19).replace(/:/g, '-') + '-' + id + '.jsonl'), lines.map((l) => JSON.stringify(l)).join('\\n') + '\\n');
  fs.writeFileSync(path.join(day, 'rollout-2026-01-01T00-00-00-another-thread.jsonl'), 'not this run\\n');
  out({ type: 'thread.started', thread_id: id });
  out({ type: 'turn.completed', usage: { input_tokens: 9, cached_input_tokens: 0, output_tokens: 30 } });
}
`;

function standIns() {
  const root = tempDir('planner-ab-hosts-');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  for (const host of ['claude', 'codex']) fs.writeFileSync(path.join(bin, host), STAND_IN, { mode: 0o755 });
  const log = path.join(root, 'log');
  const codexHome = path.join(root, 'codex-home');
  fs.mkdirSync(log);
  fs.mkdirSync(codexHome);
  const claudeHome = path.join(root, 'claude-home');
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_LOG: log, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome };
  return { root, env, claudeHome, calls: () => fs.readFileSync(path.join(log, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) };
}

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout.trim();

test('every run plants the consumer, installs the arm, runs its host once and keeps what the count reads', () => {
  const hosts = standIns();
  const out = path.join(hosts.root, 'out');
  const result = spawnSync(process.execPath, [CLI, 'run', '--source', SRC, '--b', SRC, '--out', out], { env: hosts.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const ab = JSON.parse(fs.readFileSync(path.join(out, 'ab.json'), 'utf8'));
  const calls = hosts.calls();
  assert.deepEqual(calls.map((call) => call.host), ['claude', 'claude', 'codex', 'codex', 'claude', 'claude', 'codex', 'codex']);
  const statement = fs.readFileSync(STATEMENT, 'utf8').trim();
  for (const call of calls) assert.equal(call.stdin, statement);
  assert.ok(calls[0].args.includes('specsmd-inferno-planner'));
  const settings = calls[0].args[calls[0].args.indexOf('--settings') + 1];
  assert.deepEqual(JSON.parse(settings), { claudeMdExcludes: [path.join(hosts.claudeHome, 'CLAUDE.md')] }, 'the user\'s own instructions stay out');
  assert.ok(calls[2].args.includes('--cd'));
  for (const id of ['A-claude-1', 'B-claude-1', 'A-codex-1', 'B-codex-1', 'A-claude-2', 'B-claude-2', 'A-codex-2', 'B-codex-2']) {
    const dir = path.join(out, 'runs', id);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    assert.equal(meta.exit, 0, id);
    assert.equal(meta.consumerSha, ab.consumerSha, id);
    assert.equal(meta.error, undefined, id);
    const tree = path.join(dir, 'tree');
    assert.equal(git(tree, ['rev-list', '--max-parents=0', 'HEAD']), ab.consumerSha, `${id} planned on the fixed consumer commit`);
    assert.equal(git(tree, ['status', '--porcelain']), '', `${id} planned on a committed install`);
    assert.ok(fs.existsSync(path.join(tree, '.claude', 'agents', 'specsmd-inferno-planner.md')), id);
    assert.ok(fs.existsSync(path.join(tree, '.codex', 'agents', 'specsmd_inferno_planner.toml')), id);
    assert.match(fs.readFileSync(path.join(dir, 'transcript.jsonl'), 'utf8'), meta.host === 'claude' ? /"type":"result"/ : /"session_meta"/, id);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'frontier.json'), 'utf8')), [], `${id} planned no intent`);
  }
  assert.match(result.stdout, /^\| A codex 1 \| 1 \| 1 \| 3 \| 30 \| /m);
  assert.match(result.stdout, /^\| B claude 2 \| 2 \| 1 \| 2 \| 80 \| 0\.02 USD \| /m);
  assert.match(result.stdout, /\| no intent planned \|/);

  const again = spawnSync(process.execPath, [CLI, 'run', '--source', SRC, '--b', SRC, '--out', out], { env: hosts.env, encoding: 'utf8' });
  assert.equal(again.status, 0, again.stderr);
  assert.equal((again.stdout.match(/kept from an earlier start/g) || []).length, 8);
  assert.equal(hosts.calls().length, 8, 'a kept run is never run again');
});
