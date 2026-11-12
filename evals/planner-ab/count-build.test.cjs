'use strict';

// The count of one build of a kept plan: the orchestrator's stream for the whole build, and the
// transcripts the host stored of its subagents for what each one wrote, split per work item into
// the first build and each correction the orchestrator sent.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { S } = require('./paths.cjs');
const { tempDir } = require(path.join(S, 'test-temp.cjs'));
const { countBuild, buildTable, integrateSteps, itemOf, roleOf } = require('./count-build.cjs');

const CLI = path.join(__dirname, 'planner-ab.cjs');
const ITEMS = ['refund-email', 'refund-share'];
const CORRECTION = 'Correction for refund-share: the email names the wrong balance. Fix it in the same worktree.';

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const jsonl = (entries) => `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;

const said = (id, blocks, output = 1, parent = null) => ({
  type: 'assistant', parent_tool_use_id: parent, session_id: 'sess-1',
  message: { id, model: 'claude-opus-5-5', content: blocks, usage: { input_tokens: 1, output_tokens: output } },
});
const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
const back = (id, text, { error = false, agentId } = {}) => ({
  type: 'user', parent_tool_use_id: null, session_id: 'sess-1',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(error ? { is_error: true } : {}) }] },
  ...(agentId ? { tool_use_result: { status: 'completed', agentId, totalDurationMs: 1000 } } : {}),
});
const total = { 'claude-opus-5-5': { inputTokens: 90, outputTokens: 9000, cacheReadInputTokens: 50000, cacheCreationInputTokens: 4000, thinkingTokens: 4000, costUSD: 3.5 } };
const result = (turns, output) => ({
  type: 'result', subtype: 'success', duration_ms: 60000, num_turns: turns, session_id: 'sess-1', total_cost_usd: 3.5,
  usage: { input_tokens: 5, output_tokens: output }, modelUsage: total,
});

const INTEGRATE_RED = 'S=.specsmd/scripts; node $S/run.cjs integrate --item refund-share --tree ../w; echo "EXIT $?"; node $S/run.cjs frontier refunds; echo "EXIT $?"';
const FAILED_STEP_OUT = 'FAIL 1s npm test -> .specs-inferno/logs/0.log\n1 of 1 integrate command(s) failed; send every failure above to the builder in one correction.\nEXIT 2\nready refund-email\nEXIT 0';

function stream({ finished = true } = {}) {
  const lines = [
    { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-5-5' },
    // The description names the other item; the prompt names the item the builder builds first.
    said('o1', [use('t-build', 'Agent', { subagent_type: 'specsmd-inferno-builder', description: 'Build refund-email next',
      prompt: 'Build exactly one work item.\nItem: refund-share. Intent: refunds.\nrefund-email waits on it.' })]),
    said('s1', [{ type: 'text', text: 'building' }], 1, 't-build'),
    back('t-build', 'built', { agentId: 'agent1' }),
    said('o2', [use('t-review', 'Agent', { subagent_type: 'specsmd-inferno-reviewer', description: 'Review', prompt: 'Review refund-share.' })]),
    back('t-review', 'clean'),
    said('o3', [use('t-quality', 'Agent', { subagent_type: 'specsmd-inferno-reviewer-quality', description: 'Quality', prompt: 'Quality of refund-share.' })]),
    back('t-quality', 'clean', { agentId: 'agent3' }),
    said('o4', [use('t-send', 'SendMessage', { to: 'agent1', summary: 'Correction', message: CORRECTION })]),
    back('t-send', '{"success":true}'),
    said('o5', [use('t-red', 'Bash', { command: INTEGRATE_RED })]),
    back('t-red', FAILED_STEP_OUT),
    said('o6', [use('t-green', 'Bash', { command: 'node .specsmd/scripts/run.cjs integrate --item refund-share' })]),
    back('t-green', 'PASS 1s npm test\ncompleted refund-share at abc1234'),
    said('o7', [use('t-both', 'Bash', { command: 'node .specsmd/scripts/run.cjs integrate --items refund-email,refund-share' })]),
    back('t-both', 'Exit code 2\nFAIL 2s npm test -> log', { error: true }),
    // A subagent's own calls show in the stream too: none of them is the orchestrator's.
    said('s2', [use('t-sub-int', 'Bash', { command: 'node .specsmd/scripts/run.cjs integrate --item refund-share' }),
      use('t-sub-agent', 'Agent', { subagent_type: 'specsmd-inferno-builder', prompt: 'Item: refund-email.' }),
      use('t-sub-send', 'SendMessage', { to: 'agent1', message: 'Correction for refund-share from a subagent' })], 1, 't-build'),
    { ...back('t-sub-int', 'Exit code 2\nFAIL 1s npm test -> log', { error: true }), parent_tool_use_id: 't-build' },
    // A second builder for the same item is a correction too.
    said('o8', [use('t-build2', 'Agent', { subagent_type: 'specsmd-inferno-builder', description: 'Rebuild', prompt: 'Item: refund-share, built again.' })]),
    back('t-build2', 'built', { agentId: 'agent4' }),
  ];
  return finished ? [...lines, result(5, 700), result(2, 300)] : lines;
}

const at = (seconds) => new Date(Date.parse('2026-11-12T10:00:00.000Z') + seconds * 1000).toISOString();
const stored = (id, output, seconds) => ({ type: 'assistant', timestamp: at(seconds), message: { id, content: [], usage: { output_tokens: output } } });
const told = (content, seconds, extra = {}) => ({ type: 'user', timestamp: at(seconds), message: { role: 'user', content }, ...extra });

const BUILDER = [
  told('Build exactly one work item.\nItem: refund-share.', 0),
  stored('m1', 1, 10),
  stored('m1', 300, 12),
  told([{ type: 'tool_result', tool_use_id: 'x1', content: 'ok' }], 20),
  // The host injects the skill body as a plain user message: it is no correction.
  told([{ type: 'text', text: '# INFERNO Builder\n\nImplement exactly the assigned work.' }], 30, { isMeta: true }),
  stored('m2', 500, 60),
  { type: 'attachment', timestamp: at(90) },
  told(`The coordinator sent a message while you were working:\n${CORRECTION}`, 300, { isMeta: true, origin: { kind: 'coordinator' } }),
  // The message lands while m2 is still being written: m2 stays in the step it started in.
  stored('m2', 600, 310),
  stored('m3', 200, 330),
  stored('m3', 250, 360),
];

/** A kept build folder; `subagents: false` keeps no stored transcripts. */
function keptBuild({ finished = true, subagents = true } = {}) {
  const dir = tempDir('planner-ab-build-count-');
  write(path.join(dir, 'meta.json'), JSON.stringify({ kind: 'build', id: 'A-claude-1', arm: 'A', host: 'claude', intent: 'refunds', items: ITEMS, wallMs: 1200000, exit: 0 }));
  write(path.join(dir, 'transcript.jsonl'), jsonl(stream({ finished })));
  if (subagents) {
    const kept = path.join(dir, 'subagents');
    write(path.join(kept, 'agent-agent1.jsonl'), jsonl(BUILDER));
    write(path.join(kept, 'agent-agent1.meta.json'), JSON.stringify({ agentType: 'specsmd-inferno-builder', toolUseId: 't-build' }));
    write(path.join(kept, 'agent-agent2.jsonl'), jsonl([told('Review refund-share.', 0), stored('r1', 1000, 40)]));
    // The stream says nothing of this agent's id: only its stored meta file maps it to its call.
    write(path.join(kept, 'agent-agent2.meta.json'), JSON.stringify({ agentType: 'specsmd-inferno-reviewer', toolUseId: 't-review' }));
    write(path.join(kept, 'agent-agent4.jsonl'), jsonl([told('Item: refund-share, built again.', 400), stored('n1', 100, 420)]));
  }
  return dir;
}

const noStore = () => ({ ...process.env, CLAUDE_CONFIG_DIR: tempDir('planner-ab-no-store-') });

test('the whole build takes its cost and output from the last result line, its subagents counted by role', () => {
  const count = countBuild(keptBuild(), noStore());
  assert.deepEqual(count.whole, { wallMs: 1200000, costUsd: 3.5, output: 9000, thinking: 4000, orchestratorRounds: 8, resultLines: 2, finished: true });
  assert.deepEqual(count.roles, [
    { role: 'builder', count: 2, stored: 2, output: 300 + 600 + 250 + 100 },
    { role: 'reviewer', count: 1, stored: 1, output: 1000 },
    { role: 'quality reviewer', count: 1, stored: 0, output: null },
  ]);
});

test('a builder splits at the orchestrator\'s message only, never at a skill body, each message at its largest output', () => {
  const share = countBuild(keptBuild(), noStore()).perItem.find((entry) => entry.item === 'refund-share');
  assert.deepEqual(share.steps, [
    { step: 'first build', counted: true, rounds: 2, output: 300 + 600, wallMs: 90000 },
    { step: 'correction 1', counted: true, rounds: 1, output: 250, wallMs: 60000 },
    { step: 'correction 2', counted: true, rounds: 1, output: 100, wallMs: 20000 },
  ]);
  assert.equal(share.corrections, 2, 'one message to the builder and one builder started again');
  assert.equal(share.builders, 2);
});

test('the item a builder built is the plan id its prompt names first, not the description\'s wording', () => {
  const items = countBuild(keptBuild(), noStore()).perItem;
  assert.deepEqual(items.map((entry) => [entry.item, entry.builders]), [['refund-email', 0], ['refund-share', 2]]);
  const prefixed = { prompt: 'Item: card-refund-movement. Then card-refund-email.' };
  assert.equal(itemOf(prefixed, ['card-refund', 'card-refund-movement', 'card-refund-email']), 'card-refund-movement',
    'an id that only starts another id is not named');
});

test('a red integrate is the orchestrator\'s own integrate that exited non-zero, read from its echo or its exit', () => {
  const count = countBuild(keptBuild(), noStore());
  assert.deepEqual(count.integrates, { total: 3, red: 2 }, 'a subagent\'s own integrate is not the orchestrator\'s');
  assert.equal(count.perItem.find((entry) => entry.item === 'refund-share').redIntegrates, 2);
  assert.equal(count.perItem.find((entry) => entry.item === 'refund-email').redIntegrates, 1);
});

test('the echo is read in its own wording, a call with no echo by the red lines integrate prints', () => {
  const echoed = integrateSteps('node run.cjs integrate --item a; echo "rc=$?"; node run.cjs gate; echo "rc=$?"', { text: 'rc=0\nFAIL 1s x\nrc=2', isError: false });
  assert.deepEqual(echoed, [{ items: ['a'], red: false, exit: 0 }]);
  const unechoed = integrateSteps('node run.cjs integrate --item a && node run.cjs frontier i', { text: '2 of 3 integrate command(s) failed; send every failure', isError: false });
  assert.deepEqual(unechoed, [{ items: ['a'], red: true, exit: 2 }]);
  assert.deepEqual(integrateSteps('node run.cjs frontier i; echo "EXIT $?"', { text: 'EXIT 2', isError: false }), []);
  const two = integrateSteps('node run.cjs integrate --item a; echo "EXIT $?"; node run.cjs integrate --item b; echo "EXIT $?"',
    { text: 'PASS 1s npm test\nEXIT 0\nFAIL 1s npm test -> log\nEXIT 2', isError: false });
  assert.deepEqual(two, [{ items: ['a'], red: false, exit: 0 }, { items: ['b'], red: true, exit: 2 }], 'each call reads its own echo');
});

test('a subagent with no stored transcript is not counted, never zero', () => {
  const count = countBuild(keptBuild({ subagents: false }), noStore());
  assert.ok(count.roles.every((role) => role.output === null));
  assert.deepEqual(count.perItem.find((entry) => entry.item === 'refund-share').steps,
    [{ step: 'first build', counted: false }, { step: 'correction 1', counted: false }]);
  assert.equal(count.perItem.find((entry) => entry.item === 'refund-share').corrections, 2, 'the orchestrator\'s calls still say the corrections were sent');
  assert.match(count.notes.join('\n'), /stored subagent transcripts are not there/);
  const text = buildTable(count);
  assert.match(text, /^\| builder \| 2 \| not counted \(0 of 2 stored\) \|$/m);
  assert.match(text, /^\| refund-share \| first build \| not counted \| not counted \| - \|$/m);
});

test('the host\'s stored transcripts are found by the session id when the build kept none', () => {
  const home = tempDir('planner-ab-store-');
  const store = path.join(home, 'projects', '-sandbox-builds-a-tree', 'sess-1', 'subagents');
  write(path.join(store, 'agent-agent1.jsonl'), jsonl(BUILDER));
  write(path.join(store, 'agent-agent1.meta.json'), JSON.stringify({ toolUseId: 't-build' }));
  const count = countBuild(keptBuild({ subagents: false }), { ...process.env, CLAUDE_CONFIG_DIR: home });
  assert.equal(count.roles.find((role) => role.role === 'builder').output, null, 'one of the two builders is not stored');
  assert.equal(count.perItem.find((entry) => entry.item === 'refund-share').steps[0].output, 900);
});

test('a build whose stream has no result line is unfinished: the table says so and gives no totals', () => {
  const dir = keptBuild({ finished: false });
  const count = countBuild(dir, noStore());
  assert.equal(count.whole.finished, false);
  assert.equal(count.whole.output, null);
  assert.equal(count.whole.costUsd, null);
  const cli = spawnSync(process.execPath, [CLI, 'count', dir], { encoding: 'utf8', env: noStore() });
  assert.equal(cli.status, 1, 'an unfinished build is no count to rest on');
  assert.match(cli.stdout, /Whole build: 20\.0 min wall, unfinished: the stream has no result line, so no cost and no output tokens/);
  assert.doesNotMatch(cli.stdout, /0 output tokens/);
});

test('count reads a kept build folder into its tables', () => {
  const cli = spawnSync(process.execPath, [CLI, 'count', keptBuild()], { encoding: 'utf8', env: noStore() });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /^Build A-claude-1: intent refunds, arm A, 2 items in the plan$/m);
  assert.match(cli.stdout, /^Whole build: 20\.0 min wall, 3\.50 USD, 9000 output tokens \(4000 thinking\), 8 orchestrator rounds, 3 integrate steps \(2 red\)$/m);
  assert.match(cli.stdout, /^\| refund-share \| correction 1 \| 1 \| 250 \| 1\.0 min \|$/m);
  assert.match(cli.stdout, /^\| refund-email \| no builder \| {2}\| {2}\| {2}\|$/m);
  assert.match(cli.stdout, /^\| refund-share \| 2 \| 2 \| 2 \|$/m);
});

test('each subagent type has its role', () => {
  assert.deepEqual(['specsmd-inferno-builder', 'specsmd-inferno-builder-cheap', 'specsmd-inferno-reviewer', 'specsmd-inferno-reviewer-quality',
    'specsmd-inferno-scanner', 'specsmd-inferno-oracle'].map(roleOf), ['builder', 'builder', 'reviewer', 'quality reviewer', 'scanner', 'specsmd-inferno-oracle']);
});
