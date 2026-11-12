'use strict';

// The build half of the planner A/B eval: the plan a kept planner run left, built by the
// installed orchestrator, headless, with the same command for every arm. Dry mode prints it and
// writes nothing; a stand-in host on PATH plays the real one, so no model runs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { S } = require('./paths.cjs');
const { tempDir } = require(path.join(S, 'test-temp.cjs'));

const CLI = path.join(__dirname, 'planner-ab.cjs');
const HOME = '/acme/home/.claude';

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const git = (cwd, args) => spawnSync('git', ['-c', 'user.name=Acme Eval', '-c', 'user.email=eval@example.invalid', ...args], { cwd, encoding: 'utf8' }).stdout.trim();

const intent = (id, items) => `  - id: ${id}
    title: "${id}"
    status: pending
    work_items:
${items.map((item) => `      - id: ${item}\n        title: "${item}"\n        kind: behavior\n        complexity: medium\n        status: pending\n        depends_on: []`).join('\n')}`;
const STATE = (intents) => `project:\n  name: acme-shop\nintents:\n${intents.join('\n')}\n`;

/** A kept planner run: its meta and a git tree whose plan is not committed yet, as a planner leaves it. */
function keptRun({ host = 'claude', intents = [intent('gift-card-refunds', ['refund-share', 'refund-email'])] } = {}) {
  const root = tempDir('planner-ab-kept-');
  const dir = path.join(root, 'runs', `A-${host}-1`);
  write(path.join(dir, 'meta.json'), JSON.stringify({ id: `A-${host}-1`, arm: 'A', host, run: 1, model: host === 'claude' ? 'claude-opus-5-5' : 'gpt-5.6-sol' }));
  const tree = path.join(dir, 'tree');
  write(path.join(tree, 'README.md'), '# Acme Shop\n');
  git(tree, ['init', '-q', '-b', 'main']);
  git(tree, ['add', '-A']);
  git(tree, ['commit', '-q', '-m', 'Acme Shop']);
  write(path.join(tree, '.specs-inferno', 'state.yaml'), STATE(intents));
  return { root, dir };
}

const run = (args, env = {}) => {
  const result = spawnSync(process.execPath, [CLI, 'build', ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: HOME, ...env } });
  return { code: result.status, out: result.stdout || '', err: result.stderr || '' };
};

test('dry mode prints the one build command, the slash command on stdin, and writes nothing', () => {
  const { root, dir } = keptRun();
  const out = path.join(root, 'build');
  const result = run(['--dry', '--run', dir, '--out', out]);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /intent gift-card-refunds, 2 items: refund-share, refund-email/);
  const host = result.out.split('\n').find((line) => line.startsWith('  host: '));
  assert.equal(host, `  host: cd ${path.join(out, 'tree')} && echo '/specsmd-inferno gift-card-refunds' | claude -p --output-format stream-json --verbose ` +
    `--setting-sources project --settings '{"claudeMdExcludes":["${HOME}/CLAUDE.md"]}' --model claude-opus-5-5 --permission-mode acceptEdits ` +
    `--allowed-tools Bash,Read,Write,Edit,Grep,Glob,Agent,Task,Skill --permission-prompts none > ${path.join(out, 'transcript.jsonl')}`);
  assert.doesNotMatch(host, /--no-session-persistence/, 'the stored subagent transcripts are the only record of their output tokens');
  assert.doesNotMatch(host, /--agent /, 'the orchestrator is a command, so --agent cannot start it');
  assert.match(result.out, /commit: git add -A && git commit -m 'Plan gift-card-refunds', as Acme Eval <eval@example\.invalid>/);
  assert.match(result.out, /--model claude-opus-5-5/);
  assert.equal(fs.existsSync(out), false, 'dry mode writes nothing');
  const other = run(['--dry', '--run', dir, '--out', out, '--model', 'claude-sonnet-5-5']);
  assert.match(other.out, /--model claude-sonnet-5-5 /);
});

test('a Codex run is refused in one plain line: its build is not built yet', () => {
  const { root, dir } = keptRun({ host: 'codex' });
  for (const args of [['--dry'], []]) {
    const result = run([...args, '--run', dir, '--out', path.join(root, 'build')]);
    assert.notEqual(result.code, 0);
    assert.match(result.err, /^a Codex build is not built yet: /);
    assert.equal(fs.existsSync(path.join(root, 'build')), false);
  }
});

test('a plan of several intents needs --intent, and a run with no plan or no meta is refused', () => {
  const { root, dir } = keptRun({ intents: [intent('gift-card-refunds', ['a']), intent('card-expiry', ['b'])] });
  const out = path.join(root, 'build');
  assert.match(run(['--dry', '--run', dir, '--out', out]).err, /2 intents \(gift-card-refunds, card-expiry\): name one with --intent/);
  assert.match(run(['--dry', '--run', dir, '--out', out, '--intent', 'card-expiry']).out, /intent card-expiry, 1 items: b/);
  assert.match(run(['--dry', '--run', dir, '--out', out, '--intent', 'nope']).err, /nope is no intent of the plan/);
  assert.match(run(['--dry', '--run', root, '--out', out]).err, /holds no meta\.json/);
  assert.match(run(['--dry', '--out', out]).err, /--run is required/);
});

/** A stand-in Claude Code: it logs its call, writes a small build stream and stores one subagent transcript. */
const STAND_IN = `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('claude stand-in'); process.exit(0); }
const stdin = fs.readFileSync(0, 'utf8');
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, stdin, cwd: process.cwd(), author: process.env.GIT_AUTHOR_NAME }) + '\\n');
const session = 'sess-' + process.pid;
const store = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'), session, 'subagents');
if (!process.env.FAKE_NO_STORE) {
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'agent-b1.jsonl'), JSON.stringify({ type: 'assistant', timestamp: '2026-11-12T10:00:00.000Z', message: { id: 'm1', content: [], usage: { output_tokens: 700 } } }) + '\\n');
  fs.writeFileSync(path.join(store, 'agent-b1.meta.json'), JSON.stringify({ agentType: 'specsmd-inferno-builder', toolUseId: 't1' }));
}
const out = (entry) => process.stdout.write(JSON.stringify(entry) + '\\n');
out({ type: 'system', subtype: 'init', session_id: session, model: 'claude-opus-5-5' });
out({ type: 'assistant', parent_tool_use_id: null, message: { id: 'o1', content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'specsmd-inferno-builder', prompt: 'Item: refund-share.' } }], usage: { output_tokens: 1 } } });
out({ type: 'result', subtype: 'success', duration_ms: 1000, num_turns: 1, total_cost_usd: 0.25, usage: { output_tokens: 40 }, modelUsage: { 'claude-opus-5-5': { inputTokens: 3, outputTokens: 740, costUSD: 0.25 } } });
`;

/** The stand-in host on PATH, its call log and its user folder. */
function standIn(root, extra = {}) {
  const bin = path.join(root, 'bin');
  write(path.join(bin, 'claude'), STAND_IN);
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  const log = path.join(root, 'calls.jsonl');
  const home = path.join(root, 'claude-home');
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0);
  return { log, home, calls, env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_LOG: log, CLAUDE_CONFIG_DIR: home, ...extra } };
}

test('a build copies the tree, commits the plan, runs the host once and keeps what the count reads', () => {
  const { root, dir } = keptRun();
  const { log, home, env } = standIn(root);
  const out = path.join(root, 'build');
  const result = run(['--run', dir, '--out', out], env);
  assert.equal(result.code, 0, result.out + result.err);
  const [call] = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(call.stdin, '/specsmd-inferno gift-card-refunds\n');
  assert.equal(call.cwd, fs.realpathSync(path.join(out, 'tree')));
  assert.equal(call.author, 'Acme Eval', 'the host\'s own commits carry the eval\'s identity');
  assert.deepEqual(JSON.parse(call.args[call.args.indexOf('--settings') + 1]), { claudeMdExcludes: [path.join(home, 'CLAUDE.md')] });
  const tree = path.join(out, 'tree');
  assert.equal(git(tree, ['log', '-1', '--format=%s %an <%ae>']), 'Plan gift-card-refunds Acme Eval <eval@example.invalid>');
  assert.equal(git(tree, ['status', '--porcelain']), '');
  assert.equal(git(path.join(dir, 'tree'), ['status', '--porcelain']), '?? .specs-inferno/', 'the kept run is never touched');
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  assert.equal(meta.kind, 'build');
  assert.equal(meta.exit, 0);
  assert.deepEqual(meta.items, ['refund-share', 'refund-email']);
  assert.ok(Date.parse(meta.ended) >= Date.parse(meta.started));
  assert.ok(fs.existsSync(path.join(out, 'subagents', 'agent-b1.jsonl')), 'the stored subagent transcripts are kept beside the stream');
  assert.match(result.out, /0\.25 USD, 740 output tokens/);
  assert.match(result.out, /^\| refund-share \| first build \| 1 \| 700 \| 0\.0 min \|$/m);

  const again = run(['--run', dir, '--out', out], env);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /kept from an earlier start/);
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1, 'a kept build is never run again');
});

test('an --out that holds an unfinished build is refused before anything is copied or run', () => {
  const { root, dir } = keptRun();
  const host = standIn(root);
  const out = path.join(root, 'build');
  write(path.join(out, 'transcript.jsonl'), 'half a stream\n');
  const result = run(['--run', dir, '--out', out], host.env);
  assert.equal(result.code, 2);
  assert.match(result.err, /holds an unfinished build: remove it or name a new --out/);
  assert.equal(host.calls(), 0, 'no host was started');
  assert.deepEqual(fs.readdirSync(out), ['transcript.jsonl'], 'nothing was copied over it');
  assert.equal(fs.readFileSync(path.join(out, 'transcript.jsonl'), 'utf8'), 'half a stream\n');
});

test('a build whose session left no stored subagent transcripts says so in its meta and its count', () => {
  const { root, dir } = keptRun();
  const host = standIn(root, { FAKE_NO_STORE: '1' });
  const out = path.join(root, 'build');
  const result = run(['--run', dir, '--out', out], host.env);
  assert.equal(host.calls(), 1);
  const meta = JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8'));
  assert.match(meta.error, /^no stored subagent transcripts of session sess-\d+ under the host's projects folder$/);
  assert.equal(fs.existsSync(path.join(out, 'subagents')), false);
  assert.match(result.out, /note: no stored subagent transcripts of session sess-\d+/);
  assert.match(result.out, /^\| refund-share \| first build \| not counted \| not counted \| - \|$/m);
});
