'use strict';

// The seeded toy-math intent is in the shape the flow of this tree plans and accepts. The sandbox
// is set up from this checkout's src, so nothing reaches the registry, and no host or model runs:
// the plan lint is clean, and the frontier offers add-add and add-mul at once while add-calc waits.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const S = path.join(REPO, 'src', 'flows', 'inferno', 'agents', 'orchestrator', 'skills', 'orchestrate', 'scripts');
const { tempDir } = require(path.join(S, 'test-temp.cjs'));

const RUN = '.specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs';

function sh(cmd, args, cwd, env = process.env) {
  const result = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: 300000 });
  return { code: result.status, out: `${result.stdout || ''}${result.stderr || ''}`, stdout: result.stdout || '' };
}

const setup = sh('bash', [path.join(__dirname, 'setup-sandbox.sh'), '--source', path.join(REPO, 'src')], REPO,
  { ...process.env, TMPDIR: tempDir('e2e-') });
const work = setup.stdout.trim().split('\n').pop();

test('setup-sandbox.sh --source installs the flow and seeds the intent', () => {
  assert.equal(setup.code, 0, setup.out);
  assert.equal(sh('git', ['status', '--porcelain'], work).stdout, '', 'the seeded work clone is committed');
  assert.equal(sh('git', ['rev-parse', 'main'], work).stdout, sh('git', ['rev-parse', 'origin/main'], work).stdout, 'and pushed');
});

test('plan-lint finds the seeded plan clean', () => {
  const lint = sh('node', [RUN, 'plan-lint', 'toy-math'], work);
  assert.equal(lint.code, 0, lint.out);
  assert.match(lint.out, /^clean toy-math: 3 open items, 1 criteria$/m);
});

test('frontier offers add-add and add-mul at once and holds add-calc, with no INVALID line', () => {
  const frontier = sh('node', [RUN, 'frontier', 'toy-math'], work);
  assert.equal(frontier.code, 0, frontier.out);
  assert.doesNotMatch(frontier.out, /INVALID/);
  assert.match(frontier.out, /^ready add-add /m);
  assert.match(frontier.out, /^ready add-mul /m);
  assert.match(frontier.out, /^waiting add-calc on add-add, add-mul$/m);
});
