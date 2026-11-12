'use strict';

// The count half of the planner A/B eval: a folder of recorded runs, counted into the table,
// as often as one likes and without writing anything.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { S } = require('./paths.cjs');
const { tempDir } = require(path.join(S, 'test-temp.cjs'));
const { countRuns } = require('./count.cjs');

const CLI = path.join(__dirname, 'planner-ab.cjs');
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const jsonl = (entries) => entries.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n') + '\n';

/** A Claude stream of `rounds` messages, each with one Bash call of two subcommands and `output` tokens. */
function claudeStream(rounds, output) {
  const lines = [{ type: 'system', subtype: 'init', session_id: 's', model: 'claude-opus-5-5' }];
  for (let n = 1; n <= rounds; n += 1) {
    const message = (content) => ({
      type: 'assistant',
      message: { id: `msg_${n}`, model: 'claude-opus-5-5', content: [content], usage: { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: output } },
      parent_tool_use_id: null,
    });
    lines.push(message({ type: 'text', text: 'looking' }));
    lines.push(message({ type: 'tool_use', id: `toolu_${n}`, name: 'Bash', input: { command: 'ls && pwd' } }));
  }
  lines.push({ type: 'result', subtype: 'success', duration_ms: 1000, session_id: 's' });
  return jsonl(lines);
}

/** A Codex rollout of `rounds` rounds, each with one shell call of three subcommands and `output` tokens. */
function codexRollout(rounds, output) {
  const lines = [{ timestamp: '2026-11-12T10:00:00.000Z', type: 'session_meta', payload: { id: 't' } },
    { timestamp: '2026-11-12T10:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5.6-sol' } }];
  for (let n = 1; n <= rounds; n += 1) {
    lines.push({ timestamp: '2026-11-12T10:00:02.000Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'ls; pwd; id' }), call_id: `c${n}` } });
    const last = { input_tokens: 10, cached_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: 10 + output };
    const total = { ...last, total_tokens: n * (10 + output), output_tokens: n * output };
    lines.push({ timestamp: '2026-11-12T10:00:03.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } } });
  }
  return jsonl(lines);
}

const STATE = (items) => `project:
  name: acme-shop
intents:
  - id: gift-card-refunds
    title: "Gift card refunds"
    status: pending
    work_items:
${items.map((id) => `      - id: ${id}\n        title: "${id}"\n        kind: behavior\n        complexity: medium\n        status: pending\n        depends_on: []`).join('\n')}
`;

/** One recorded run folder as the run half leaves it. */
function recordRun(out, { arm, host, run, rounds, output, wallMs, items, frontier, sha = SHA, exit = 0, transcript }) {
  const dir = path.join(out, 'runs', `${arm}-${host}-${run}`);
  write(path.join(dir, 'meta.json'), JSON.stringify({ arm, host, run, wallMs, exit, consumerSha: sha }));
  write(path.join(dir, 'transcript.jsonl'), transcript || (host === 'claude' ? claudeStream(rounds, output) : codexRollout(rounds, output)));
  if (items) write(path.join(dir, 'tree', '.specs-inferno', 'state.yaml'), STATE(items));
  if (frontier) write(path.join(dir, 'frontier.json'), JSON.stringify(frontier));
}

const clean = [{ intent: 'gift-card-refunds', exit: 0, lines: ['ready refund-share medium behavior builder', 'waiting refund-email on refund-share'] }];
const candidates = [{ intent: 'gift-card-refunds', exit: 0, lines: ['ready refund-share medium behavior builder', 'candidate refund-share src/giftcards/adjust.js references recordMovement via src/ledger/movements.js', 'candidate refund-share src/giftcards/redeem.js references recordMovement via src/ledger/movements.js'] }];
const refused = [{ intent: 'gift-card-refunds', exit: 2, lines: ['INVALID refund-share: context.required path does not exist: src/refunds.js', 'INVALID refund-email: no proof'] }];

function recorded() {
  const out = tempDir('planner-ab-count-');
  write(path.join(out, 'ab.json'), JSON.stringify({
    statementSha: 'f'.repeat(40), consumerSha: SHA, runs: 2, hosts: ['claude', 'codex'],
    arms: { A: { label: 'src as installed' }, B: { label: 'src with thinner-items.patch' } },
  }));
  recordRun(out, { arm: 'A', host: 'claude', run: 1, rounds: 3, output: 1000, wallMs: 120000, items: ['a', 'b', 'c'], frontier: clean });
  recordRun(out, { arm: 'A', host: 'claude', run: 2, rounds: 5, output: 1000, wallMs: 180000, items: ['a', 'b', 'c', 'd', 'e'], frontier: candidates });
  recordRun(out, { arm: 'B', host: 'claude', run: 1, rounds: 2, output: 500, wallMs: 60000, items: ['a', 'b'], frontier: clean });
  recordRun(out, { arm: 'B', host: 'claude', run: 2, rounds: 2, output: 700, wallMs: 66000, items: ['a', 'b', 'c'], frontier: clean });
  recordRun(out, { arm: 'A', host: 'codex', run: 1, rounds: 4, output: 250, wallMs: 300000, items: ['a', 'b'], frontier: refused });
  recordRun(out, { arm: 'A', host: 'codex', run: 2, rounds: 4, output: 250, wallMs: 300000, items: ['a', 'b'], frontier: clean, sha: 'b'.repeat(40), exit: 1 });
  recordRun(out, { arm: 'B', host: 'codex', run: 1, rounds: 6, output: 100, wallMs: 240000, frontier: [] });
  recordRun(out, { arm: 'B', host: 'codex', run: 2, rounds: 1, output: 1, wallMs: 1, transcript: jsonl([{ type: 'session_meta', payload: {} }, { type: 'brand_new', payload: {} }]) });
  return out;
}

const row = (result, id) => result.runs.find((entry) => entry.id === id);

test('every run is counted from its own transcript, tree and frontier record', () => {
  const result = countRuns(recorded());
  assert.deepEqual(result.runs.map((entry) => entry.id),
    ['A-claude-1', 'A-claude-2', 'B-claude-1', 'B-claude-2', 'A-codex-1', 'A-codex-2', 'B-codex-1', 'B-codex-2']);
  const first = row(result, 'A-claude-1');
  assert.equal(first.rounds, 3);
  assert.equal(first.shellCalls, 3);
  assert.equal(first.shellSubcommands, 6);
  assert.equal(first.output, 3000);
  assert.equal(first.wallMs, 120000);
  assert.equal(first.items, 3);
  assert.equal(first.frontier, 'clean');
  const codex = row(result, 'A-codex-1');
  assert.equal(codex.rounds, 4);
  assert.equal(codex.shellCalls, 4);
  assert.equal(codex.shellSubcommands, 12);
  assert.equal(codex.output, 1000);
});

test('the frontier column says clean, the candidates, the refusal or that nothing was planned', () => {
  const result = countRuns(recorded());
  assert.equal(row(result, 'A-claude-2').frontier, '2 candidates');
  assert.equal(row(result, 'A-codex-1').frontier, 'refused: INVALID refund-share: context.required path does not exist: src/refunds.js (+1 more)');
  assert.equal(row(result, 'B-codex-1').frontier, 'no intent planned');
  assert.equal(row(result, 'B-codex-1').items, 0);
});

test('a run at another consumer commit, or whose host exited non-zero, says so', () => {
  const notes = row(countRuns(recorded()), 'A-codex-2').notes;
  assert.match(notes, /host exited 1/);
  assert.match(notes, /consumer at bbbbbbbbbbbb, not a1b2c3d4e5f6/);
});

test('a transcript the counter cannot read is that run\'s error, and the others are still counted', () => {
  const result = countRuns(recorded());
  assert.match(row(result, 'B-codex-2').error, /line 2: .*brand_new/);
  assert.equal(result.ok, false);
});

test('each arm on each host gets its mean, from the runs that counted', () => {
  const { means } = countRuns(recorded());
  const mean = (arm, host) => means.find((entry) => entry.arm === arm && entry.host === host);
  assert.deepEqual({ ...mean('A', 'claude') }, {
    arm: 'A', host: 'claude', counted: 2, rounds: 4, shellCalls: 4, shellSubcommands: 8, output: 4000, wallMs: 150000, items: 4, clean: 1,
  });
  assert.equal(mean('B', 'codex').counted, 1);
});

test('the table prints a row per run and per mean, and recounting writes nothing', () => {
  const out = recorded();
  const before = fs.readdirSync(out, { recursive: true }).sort();
  const result = spawnSync(process.execPath, [CLI, 'count', out], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const text = result.stdout;
  assert.match(text, /consumer a1b2c3d4e5f6, statement ffffffffffff, 2 runs per arm/);
  assert.match(text, /A: src as installed/);
  assert.match(text, /B: src with thinner-items\.patch/);
  assert.match(text, /^\| Run \| Model rounds \| Shell calls \| Subcommands \| Output tokens \| Wall \| Items \| Frontier \| Notes \|$/m);
  assert.match(text, /^\| A claude 1 \| 3 \| 3 \| 6 \| 3k \| 2\.0 min \| 3 \| clean \|  \|$/m);
  assert.match(text, /^\| A claude mean \| 4 \| 4 \| 8 \| 4k \| 2\.5 min \| 4 \| 1 of 2 clean \|  \|$/m);
  assert.match(text, /^\| B codex 2 \| error: transcript\.jsonl line 2: /m);
  assert.deepEqual(fs.readdirSync(out, { recursive: true }).sort(), before);
  const json = spawnSync(process.execPath, [CLI, 'count', out, '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(json.stdout).runs.length, 8);
});

test('a folder with no recorded run is refused with the usage', () => {
  const result = spawnSync(process.execPath, [CLI, 'count', tempDir('planner-ab-empty-')], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no ab\.json/);
  assert.match(result.stderr, /usage:/);
});
