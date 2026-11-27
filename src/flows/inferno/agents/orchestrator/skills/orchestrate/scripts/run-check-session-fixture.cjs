'use strict';
// A host whose checks go to another machine through a wrapper, for the `verification.session`
// suites of integrate and the gate (run-check-session.cjs). The wrapper is the fake one of the
// mutate session suites (run-mutate-session-fixture.cjs): `node remote.cjs direct <command...>`
// copies the whole tree beside it and runs the command there, and its session modes split that
// into open, run and close. Every call logs one line to calls.log beside the tree, so a test counts
// the opens, the runs and the closes, and FAKE_ACT makes one call misbehave.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');

const { REMOTE, beside, calls, until } = require('./run-mutate-session-fixture.cjs');
const { reviewBefore } = require('./review-fixture.cjs');
const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');

const RUN = path.join(__dirname, 'run.cjs');
const BRANCH = 'inferno-intent/demo-00000000T000000Z';
const NAMES = ['one', 'two', 'three', 'four', 'five'];
/** The five checks that go through the wrapper, and one that runs here. */
const REMOTE_CHECKS = NAMES.map((name) => `node remote.cjs direct echo ${name}`);
const LOCAL = 'echo local';

/** The `verification.session` block for the fake wrapper; `drop` leaves one key out, `extra` adds lines. */
const sessionBlock = ({ drop = null, extra = '' } = {}) =>
  `  session:\n${[['match', "'^node remote\\.cjs direct '"], ['open', 'node remote.cjs open'], ['run', 'node remote.cjs run'],
    ['close', 'node remote.cjs close']].filter(([key]) => key !== drop).map(([key, value]) => `    ${key}: ${value}\n`).join('')}${extra}`;

const list = (values) => values.map((value) => `    - ${value}\n`).join('');

/** The line the fake wrapper prints when it ran nothing, as `verification.refused` reads it. */
const REFUSED = "'^the wrapper refused$'";

/**
 * A config with `finalize` and `integrate` lists, the session block when `session` is true,
 * `scopes` as finalize_scopes, and `refused` as verification.refused when it is set.
 */
function configOf({ finalize = [LOCAL], integrate = [], session = true, scopes = {}, refused = null } = {}) {
  const scoped = Object.entries(scopes);
  return 'delivery:\n  base_branch: main\nverification:\n' +
    `  finalize:\n${list(finalize)}` + (integrate.length ? `  integrate:\n${list(integrate)}` : '') +
    (scoped.length ? `  finalize_scopes:\n${scoped.map(([command, globs]) => `    "${command}": ${JSON.stringify(globs)}\n`).join('')}` : '') +
    (refused ? `  refused: ${refused}\n` : '') + (session ? sessionBlock() : '');
}

function git(tree, ...args) {
  return execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(tree, rel, body) {
  fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
  writeFile(path.join(tree, rel), body);
}

/** Commit every change in the tree. */
function commit(tree, message = 'fixture') {
  git(tree, 'add', '-A');
  git(tree, 'commit', '-qm', message);
}

/** A committed host tree with the wrapper and `config`, on an intent branch; the wrapper's files sit beside it. */
function hostTree(t, config) {
  const dir = tempDir('inferno-check-session-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tree = path.join(dir, 'app');
  fs.mkdirSync(tree);
  git(tree, 'init', '-q', '-b', 'main');
  git(tree, 'config', 'user.email', 'test@example.com');
  git(tree, 'config', 'user.name', 'Test');
  write(tree, 'src/input.txt', 'one\n');
  write(tree, 'remote.cjs', REMOTE);
  write(tree, '.specs-inferno/config.yaml', config);
  commit(tree);
  git(tree, 'checkout', '-qb', BRANCH);
  return { dir, tree, cache: path.join(dir, 'cache'), ...beside(tree) };
}

// CLAUDE_BUILD_WRAPPED is claude-build's nested-call marker: a fake command runs as is and never queues on the machine-wide build lock.
const envOf = (f, act) => ({ ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache, FAKE_ACT: act || '' });

/** Run `run.cjs <args>` in the tree; `act` sets FAKE_ACT. */
function run(f, args, { act = '' } = {}) {
  reviewBefore(args, f.tree);
  const result = spawnSync(process.execPath, [RUN, ...args], { cwd: f.tree, encoding: 'utf8', env: envOf(f, act) });
  return { code: result.status, out: result.stdout || '', err: result.stderr || '' };
}

/** Start `run.cjs <args>` as a process of its own, to kill it mid run. */
function start(f, args, { act = '' } = {}) {
  reviewBefore(args, f.tree);
  const child = spawn(process.execPath, [RUN, ...args], { cwd: f.tree, env: envOf(f, act), stdio: 'ignore' });
  const ended = new Promise((resolve) => child.on('exit', resolve));
  return { child, ended };
}

/** The proofs the checks minted: one file per command under the cache's green-commands. */
function proofs(f) {
  const dir = path.join(f.cache, 'specsmd-inferno', 'app', 'green-commands');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => !name.startsWith('.')) : [];
}

/** The records of the host sessions open now, under the branch's cache folder. */
function openRecords(f) {
  const dir = path.join(f.cache, 'specsmd-inferno', 'app', BRANCH, 'check-sessions');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

/** How many calls of each mode the wrapper logged. */
function counted(f) {
  const out = { open: 0, run: 0, close: 0, direct: 0 };
  for (const entry of calls(f)) out[entry.call] = (out[entry.call] || 0) + 1;
  return out;
}

module.exports = {
  BRANCH, LOCAL, NAMES, REFUSED, REMOTE_CHECKS, calls, commit, configOf, counted, hostTree, openRecords, proofs, run, sessionBlock, start,
  until, write,
};
