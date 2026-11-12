'use strict';

// The run half of the planner A/B eval, in its dry mode: every host command it would run, in
// the order it would run them, one after the other, with nothing installed and no host started.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { S, SRC, STATEMENT } = require('./paths.cjs');
const { tempDir } = require(path.join(S, 'test-temp.cjs'));

const CLI = path.join(__dirname, 'planner-ab.cjs');

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

const CLAUDE_PLANNER = `---
name: specsmd-inferno-planner
description: plans
tools: Read, Bash
model: claude-opus-5-5
effort: xhigh
---

# INFERNO Planner

Read a subsystem per round.
`;

const CODEX_PLANNER = `name = "specsmd_inferno_planner"
description = "plans"
model = "gpt-5.6-sol"
model_reasoning_effort = "xhigh"
developer_instructions = """
Load and follow the planner procedure.
"""
`;

/** A source tree with only what dry mode reads: the CLI and both planner agent files. */
function source() {
  const root = tempDir('planner-ab-src-');
  const src = path.join(root, 'src');
  write(path.join(src, 'bin', 'cli.js'), '// the installer\n');
  write(path.join(src, 'flows', 'inferno', 'commands', 'inferno-planner.md'), CLAUDE_PLANNER);
  write(path.join(src, 'flows', 'inferno', 'codex', 'agents', 'specsmd_inferno_planner.toml'), CODEX_PLANNER);
  return { root, src };
}

/** A patch from the repository root that moves the Claude planner to another effort and rewords its body. */
function patch(root, from = 'effort: xhigh', to = 'effort: high') {
  const file = path.join(root, 'change.patch');
  write(file, [
    'diff --git a/src/flows/inferno/commands/inferno-planner.md b/src/flows/inferno/commands/inferno-planner.md',
    '--- a/src/flows/inferno/commands/inferno-planner.md',
    '+++ b/src/flows/inferno/commands/inferno-planner.md',
    '@@ -3,6 +3,6 @@ name: specsmd-inferno-planner',
    ' description: plans',
    ' tools: Read, Bash',
    ' model: claude-opus-5-5',
    `-${from}`,
    `+${to}`,
    ' ---',
    ' ',
    '',
  ].join('\n'));
  return file;
}

function dry(args) {
  const result = spawnSync(process.execPath, [CLI, 'run', '--dry', ...args], { encoding: 'utf8' });
  return { code: result.status, out: result.stdout || '', err: result.stderr || '' };
}

const hostLines = (out) => out.split('\n').filter((line) => line.startsWith('  host: ')).map((line) => line.slice(8));

test('dry mode prints every run in order, one at a time, each arm beside the other on each host', () => {
  const { root, src } = source();
  const out = path.join(root, 'out');
  const result = dry(['--source', src, '--b', patch(root), '--out', out]);
  assert.equal(result.code, 0, result.err);
  const runs = result.out.split('\n').filter((line) => line.startsWith('run ')).map((line) => line.split(' ')[1]);
  assert.deepEqual(runs, ['A-claude-1', 'B-claude-1', 'A-codex-1', 'B-codex-1', 'A-claude-2', 'B-claude-2', 'A-codex-2', 'B-codex-2']);
  assert.match(result.out, /one after the other, never two at once/);
  assert.equal(fs.existsSync(out), false, 'dry mode writes nothing');
});

test('each host command runs the installed planner on its pins, the statement on stdin', () => {
  const { root, src } = source();
  const out = path.join(root, 'out');
  const result = dry(['--source', src, '--b', patch(root), '--out', out]);
  const [a, b, codexA] = hostLines(result.out);
  const stdin = `< ${STATEMENT}`;
  assert.equal(a, 'claude -p --output-format stream-json --verbose --setting-sources project --agent specsmd-inferno-planner ' +
    '--model claude-opus-5-5 --effort xhigh --permission-mode acceptEdits --allowed-tools Bash,Read,Write,Edit,Grep,Glob,TodoWrite ' +
    `--permission-prompts none --no-session-persistence > ${path.join(out, 'runs', 'A-claude-1', 'transcript.jsonl')} ${stdin}`);
  assert.match(b, /--effort high /, 'the patched arm runs on the pin its patch sets');
  const tree = path.join(out, 'runs', 'A-codex-1', 'tree');
  assert.equal(codexA, `codex exec --json --cd ${tree} --sandbox workspace-write -m gpt-5.6-sol -c 'model_reasoning_effort="xhigh"' ` +
    `-c 'developer_instructions="Load and follow the planner procedure."' - > ${path.join(out, 'runs', 'A-codex-1', 'events.jsonl')} ${stdin}`);
});

test('each run names its tree at the fixed consumer commit, its install and its frontier check', () => {
  const { root, src } = source();
  const result = dry(['--source', src, '--b', patch(root), '--out', path.join(root, 'out')]);
  const sha = /consumer .* at ([0-9a-f]{40})/.exec(result.out);
  assert.ok(sha, result.out);
  assert.match(result.out, new RegExp(`  install: node ${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/bin/cli.js install --flow inferno --tools claude,codex`));
  assert.match(result.out, /  frontier: node \.specsmd\/inferno\/agents\/orchestrator\/skills\/orchestrate\/scripts\/run\.cjs frontier <intent-id> --config \.specs-inferno\/config\.codex\.yaml/);
  assert.match(result.out, /8 planner runs in all: 4 per arm, 2 per arm on each host/);
  const again = dry(['--source', src, '--b', patch(root), '--out', path.join(root, 'other')]);
  assert.equal(/consumer .* at ([0-9a-f]{40})/.exec(again.out)[1], sha[1], 'the consumer commit is the same every time');
});

test('a patch the source already holds is measured against the source with it taken out', () => {
  const { root, src } = source();
  const change = patch(root);
  const planner = path.join(src, 'flows', 'inferno', 'commands', 'inferno-planner.md');
  write(planner, CLAUDE_PLANNER.replace('effort: xhigh', 'effort: high'));
  const result = dry(['--source', src, '--b', change, '--out', path.join(root, 'out')]);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /arm A: .* without change\.patch/);
  assert.match(result.out, /arm B: .* as it is, holding change\.patch/);
  const [a, b] = hostLines(result.out);
  assert.match(a, /--effort xhigh /);
  assert.match(b, /--effort high /);
  assert.equal(fs.readFileSync(planner, 'utf8'), CLAUDE_PLANNER.replace('effort: xhigh', 'effort: high'), 'the source is never touched');
});

test('a patch that does not apply, fewer than two runs, or no arm B is refused before anything runs', () => {
  const { root, src } = source();
  const out = path.join(root, 'out');
  const stale = dry(['--source', src, '--b', patch(root, 'effort: max', 'effort: low'), '--out', out]);
  assert.equal(stale.code, 2);
  assert.match(stale.err, /does not apply/);
  const one = dry(['--source', src, '--b', patch(root), '--out', out, '--runs', '1']);
  assert.equal(one.code, 2);
  assert.match(one.err, /two runs per arm at least/);
  const none = dry(['--source', src, '--out', out]);
  assert.equal(none.code, 2);
  assert.match(none.err, /--b is required/);
  assert.equal(fs.existsSync(out), false);
});

test('the source tree of this repository holds both planner pins where the eval reads them', () => {
  const root = tempDir('planner-ab-real-');
  const result = dry(['--source', SRC, '--b', SRC, '--out', path.join(root, 'out'), '--hosts', 'claude,codex']);
  assert.equal(result.code, 0, result.err);
  const [claude, , codex] = hostLines(result.out);
  assert.match(claude, /--agent specsmd-inferno-planner --model \S+ --effort \S+ /);
  assert.match(codex, /-m \S+ -c 'model_reasoning_effort="\S+"' -c 'developer_instructions="Load and follow /);
});
