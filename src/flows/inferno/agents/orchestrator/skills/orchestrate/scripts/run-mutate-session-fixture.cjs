'use strict';
// A host's test wrapper for the session tests of `run.cjs mutate --batch` (run-mutate-session.cjs).
// `node remote.cjs direct <command...>` is the wrapper as a test command calls it: it copies the
// whole tree into a remote copy beside the tree, then runs the command there. The session modes
// split that up: `open` copies the tree, `send` copies INFERNO_FILE into the copy (or deletes it
// there when the tree no longer holds it), `run` runs INFERNO_TEST in the copy, `close` does
// nothing. Each call logs one JSON line to calls.log beside the tree, with what the copy held when a
// test ran, so a test can count the opens, the sends and the runs and see which mutant each run was
// judged on.
// FAKE_ACT makes one call misbehave, as `<mode>@<n>=<action>` for the n-th call of that mode:
// `fail` exits 3 before doing anything, `exit143` exits 143 as a shell reports a killed child,
// `signal` ends the shell that runs it with SIGTERM, and `hold` waits for a release file beside the
// tree. FAKE_WATCH names the paths a run records, src/m.txt by default.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { batchTree, journalOf } = require('./run-mutate-fixture.cjs');
const { writeFile } = require('./test-write.cjs');

const RUN = path.join(__dirname, 'run.cjs');

// The wrapper's own source. It copies and appends, so this fixture holds no direct write.
const REMOTE = String.raw`'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const [mode, ...rest] = process.argv.slice(2);
const tree = process.env.INFERNO_TREE || process.cwd();
const [remote, calls, release] = ['remote', 'calls.log', 'release'].map((name) => path.join(path.dirname(tree), name));
const seen = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
const nth = seen.filter((call) => call.call === mode).length + 1;
const acts = (process.env.FAKE_ACT || '').split(',').map((item) => /^(\w+)@(\d+)=(\w+)$/.exec(item)).filter(Boolean);
const act = acts.find((m) => m[1] === mode && Number(m[2]) === nth);
const call = { call: mode, nth, action: act ? act[3] : null, session: process.env.INFERNO_SESSION || null, tree: process.env.INFERNO_TREE || null };
if (mode === 'send') call.file = process.env.INFERNO_FILE;
if (mode === 'run') call.test = process.env.INFERNO_TEST;
if (mode === 'direct') call.test = rest.join(' ');
const log = () => fs.appendFileSync(calls, JSON.stringify(call) + '\n');
if (call.action === 'fail') { log(); console.log('the wrapper refused'); process.exit(3); }
if (call.action === 'exit143') { log(); process.exit(143); }
if (call.action === 'signal') { log(); process.kill(process.ppid, 'SIGTERM'); process.kill(process.pid, 'SIGTERM'); }
if (mode === 'open' || mode === 'direct') {
  fs.rmSync(remote, { recursive: true, force: true });
  fs.cpSync(tree, remote, { recursive: true, filter: (src) => path.basename(src) !== '.git' });
}
if (mode === 'send') {
  const from = path.join(tree, call.file);
  const to = path.join(remote, call.file);
  if (fs.existsSync(from)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  } else fs.rmSync(to, { force: true });
}
if (mode === 'run' || mode === 'direct') {
  const watch = (process.env.FAKE_WATCH || 'src/m.txt').split(',');
  call.held = Object.fromEntries(watch.map((rel) => [rel, fs.existsSync(path.join(remote, rel)) ? fs.readFileSync(path.join(remote, rel), 'utf8') : null]));
}
log();
if (call.action === 'hold') {
  while (!fs.existsSync(release) && fs.existsSync(path.dirname(calls))) spawnSync('sleep', ['0.05']);
}
if (mode === 'run' || mode === 'direct') {
  const run = mode === 'run'
    ? spawnSync('bash', ['-c', process.env.INFERNO_TEST], { cwd: remote, stdio: 'inherit' })
    : spawnSync(rest[0], rest.slice(1), { cwd: remote, stdio: 'inherit' });
  process.exit(run.status === null ? 1 : run.status);
}
`;

// The test: green while src/m.txt holds every argument, with node --test's summary either way.
const CHECK = String.raw`'use strict';
const fs = require('fs');
const text = fs.readFileSync('src/m.txt', 'utf8');
const missed = process.argv.slice(2).filter((want) => !text.includes(want));
console.log(missed.length > 0 ? '# fail ' + missed.length : '# pass 1');
process.exit(missed.length > 0 ? 1 : 0);
`;

const LINES = 'alpha = 1\nbeta = 2\ngamma = 3\n';

/** The test command that goes through the wrapper, around `inner`. */
const wrapped = (inner) => `node remote.cjs direct ${inner}`;
/** The check `inner` runs: green while src/m.txt holds each of `wants`. */
const checks = (...wants) => `node check.cjs ${wants.map((want) => JSON.stringify(want)).join(' ')}`;

/** The `mutate.session` block for the fake wrapper, under `mutate:`; `match` replaces its regex. */
const sessionBlock = ({ match = '^node remote\\.cjs direct ' } = {}) =>
  `  session:\n    match: '${match}'\n    open: node remote.cjs open\n    send: node remote.cjs send\n    run: node remote.cjs run\n    close: node remote.cjs close\n`;

/** The wrapper's files beside `tree`: its remote copy, its call log and its release file. */
const beside = (tree) => ({ remote: path.join(path.dirname(tree), 'remote'), calls: path.join(path.dirname(tree), 'calls.log'), release: path.join(path.dirname(tree), 'release') });

/** A committed tree with src/m.txt, the check and the wrapper; `files` adds or replaces files. */
function sessionTree(t, files = {}) {
  const f = batchTree(t, { 'src/m.txt': LINES, 'check.cjs': CHECK, 'remote.cjs': REMOTE, ...files });
  return { ...f, tree: f.root, ...beside(f.root) };
}

/** A config file outside the tree, so the tree stays clean; returns its path. */
function outsideConfig(f, body, name = 'session.yaml') {
  const file = path.join(f.dir, name);
  writeFile(file, body);
  return file;
}

// CLAUDE_BUILD_WRAPPED is claude-build's nested-call marker: a fake command runs as is and never queues on the machine-wide build lock.
const sessionEnv = (f, extra = {}) => ({
  ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache, SEAL_RUNS: path.join(f.dir, 'seal-runs'),
  ...(f.state ? { FAKE_RUST_STATE: f.state } : {}), ...extra,
});

/** The args of a batch of `entries` written outside the tree. */
function batchArgs(f, entries, { config = null, json = false } = {}) {
  const file = path.join(f.dir, 'batch.json');
  writeFile(file, JSON.stringify(entries));
  return [RUN, 'mutate', '--tree', f.tree, '--batch', file, ...(config ? ['--config', config] : []), ...(json ? ['--json'] : [])];
}

/** Run a batch of `entries`; `act` sets FAKE_ACT, `env` adds variables, `json` adds the payload. */
function sessionBatch(f, entries, { config = null, json = false, act = '', env = {} } = {}) {
  const result = spawnSync(process.execPath, batchArgs(f, entries, { config, json }),
    { cwd: f.tree, encoding: 'utf8', env: sessionEnv(f, { FAKE_ACT: act, ...env }) });
  let payload = null;
  try {
    payload = json ? JSON.parse(result.stdout) : null;
  } catch (error) {
    payload = null;
  }
  return { code: result.status, out: result.stdout, err: result.stderr, payload };
}

/** Every call the wrapper logged, in order, or those of `mode`. */
function calls(f, mode = null) {
  const all = fs.existsSync(f.calls) ? fs.readFileSync(f.calls, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  return mode ? all.filter((call) => call.call === mode) : all;
}

/** Poll until `done()` holds, up to ten seconds. */
async function until(done) {
  for (let i = 0; i < 400 && !done(); i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  return done();
}

/** `LINES` with `find` replaced by `replace` on line `n`. */
function mutated(n, find, replace) {
  const lines = LINES.split('\n');
  lines[n - 1] = lines[n - 1].replace(find, replace);
  return lines.join('\n');
}

const readIn = (f, rel) => fs.readFileSync(path.join(f.tree, rel), 'utf8');

module.exports = {
  CHECK, LINES, REMOTE, RUN, batchArgs, beside, calls, checks, journalOf, mutated, outsideConfig, readIn, sessionBatch, sessionBlock,
  sessionEnv, sessionTree, until, wrapped,
};
