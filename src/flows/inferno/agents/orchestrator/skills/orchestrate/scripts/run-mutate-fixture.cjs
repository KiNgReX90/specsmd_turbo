'use strict';
// A committed tree and a fake Rust toolchain for the batch mutate tests, and a sealed tree for the
// seal tests (below).
// The fake reads every source under src/ as a build would. It counts a build whenever the sources
// changed since the last one, refuses a line the way a compiler refuses it, and answers a test from
// the line its function sits on, with only the switch INFERNO_MUTANT names turned on. A red test
// prints cargo's failing summary, since a red run without one reads no verdict. Its hold
// also ends once the state dir is gone, so it never outlives its test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');

const RUN = path.join(__dirname, 'run.cjs');

// The fake's own source. It overwrites a file by removing it and appending, so this fixture holds
// no direct write.
const FAKE = String.raw`'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const [name, expected] = process.argv.slice(2);
const state = process.env.FAKE_RUST_STATE;
const src = path.join(process.cwd(), 'src');
const files = fs.readdirSync(src).filter((f) => f.endsWith('.rs')).sort();
const bodies = files.map((f) => [f, fs.readFileSync(path.join(src, f), 'utf8')]);
const hash = crypto.createHash('sha256').update(JSON.stringify(bodies)).digest('hex');
const built = path.join(state, 'built');
const last = fs.existsSync(built) ? fs.readFileSync(built, 'utf8') : '';
if (last !== hash) {
  const count = fs.existsSync(path.join(state, 'builds')) ? fs.readFileSync(path.join(state, 'builds'), 'utf8').split('\n').length - 1 : 0;
  fs.appendFileSync(path.join(state, 'builds'), hash + '\n');
  for (const [f, body] of bodies) fs.appendFileSync(path.join(state, 'source-' + (count + 1) + '-' + f), body);
  console.log('   Compiling fixture v0.1.0');
  const errors = [];
  for (const [f, body] of bodies) {
    body.split('\n').forEach((line, i) => {
      const switched = line.includes('INFERNO_MUTANT');
      if (line.includes('nocompile') || (switched && line.includes('const '))) errors.push([f, i + 1, line]);
      if (switched && line.includes('scoped')) errors.push([f, i + 2, '']);
    });
  }
  if (errors.length > 0) {
    for (const [f, n, line] of errors) {
      console.log('error[E0015]: cannot call non-const fn in constant functions\n --> src/' + f + ':' + n + ':5\n  |\n' + n + ' | ' + line + '\n  |     ^^^\n');
    }
    console.log('error: could not compile ' + '\x60fixture\x60 (lib test) due to ' + errors.length + ' previous errors');
    process.exit(101);
  }
  fs.rmSync(built, { force: true });
  fs.appendFileSync(built, hash);
}
const on = process.env.INFERNO_MUTANT || null;
const SWITCH = /\(?if \{ static INFERNO_SWITCH[^{}]*?v == "(\d+)"[^{}]*\} \{ (.*?) \} else \{ (.*?) \}\)?/g;
const lines = bodies.flatMap(([, body]) => body.split('\n'));
const line = lines.find((entry) => entry.includes('fn ' + name + '(')) || '';
const effective = line.replace(SWITCH, (all, k, broken, kept) => (k === on ? broken : kept));
fs.appendFileSync(path.join(state, 'runs'), JSON.stringify({ name, on, effective }) + '\n');
if (expected === 'hold') {
  while (!fs.existsSync(path.join(state, 'release')) && fs.existsSync(state)) spawnSleep();
}
function spawnSleep() { require('child_process').spawnSync('sleep', ['0.05']); }
if (effective.includes(expected) || expected === 'hold') {
  console.log('test result: ok. 1 passed');
  process.exit(0);
}
console.log('test ' + name + ' ... FAILED');
console.log('test result: FAILED. 0 passed; 1 failed');
process.exit(101);
`;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A committed tree holding `files` ({rel: body}), with a cache dir, a state dir and the fake toolchain. */
function batchTree(t, files) {
  const dir = tempDir('inferno-mutate-batch-');
  t.after(() => {
    spawnSync('chmod', ['-R', 'u+w', dir]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const root = path.join(dir, 'app');
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFile(path.join(root, rel), body);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  const state = path.join(dir, 'state');
  fs.mkdirSync(state, { recursive: true });
  const fake = path.join(dir, 'fake-rust.cjs');
  writeFile(fake, FAKE);
  return { root, dir, state, fake, cache: path.join(dir, 'cache') };
}

/** The test command the fake answers: green while the line of `fn name(` holds `expected`. */
const fakeTest = (f, name, expected) => `node ${JSON.stringify(f.fake)} ${name} ${JSON.stringify(expected)}`;

// CLAUDE_BUILD_WRAPPED is claude-build's nested-call marker: a fake command runs as is and never queues on the machine-wide build lock.
const env = (f) => ({ ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache, FAKE_RUST_STATE: f.state });

/** Write the batch as JSON (or as the text given) outside the tree and run it; `--json` adds the payload. */
function runBatch(f, entries, { json = false, file = path.join(f.dir, 'batch.json') } = {}) {
  writeFile(file, typeof entries === 'string' ? entries : JSON.stringify(entries));
  const args = [RUN, 'mutate', '--tree', f.root, '--batch', file, ...(json ? ['--json'] : [])];
  const result = spawnSync(process.execPath, args, { cwd: f.root, encoding: 'utf8', env: env(f) });
  return { code: result.status, out: result.stdout, err: result.stderr, payload: json && result.status !== 1 ? safeJson(result.stdout) : null };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

/** How many builds the fake counted, and the runs it answered in order. */
const builds = (f) => (fs.existsSync(path.join(f.state, 'builds')) ? fs.readFileSync(path.join(f.state, 'builds'), 'utf8').split('\n').filter(Boolean).length : 0);
const runs = (f) => (fs.existsSync(path.join(f.state, 'runs')) ? fs.readFileSync(path.join(f.state, 'runs'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const source = (f, n, file = 'lib.rs') => fs.readFileSync(path.join(f.state, `source-${n}-${file}`), 'utf8');

/** The journal a run left under the tree's cache, or null. */
function journalOf(f) {
  const rel = fs.existsSync(f.cache) && fs.readdirSync(f.cache, { recursive: true }).find((p) => p.endsWith('mutate-journal.json'));
  return rel ? path.join(f.cache, rel) : null;
}

// ---------------------------------------------------------------------------
// Sealed files (run-mutate-seal.cjs). A host can seal files: a manifest holds their digests, and the
// loader refuses them all when one byte differs, so a mutant in a sealed file fails every test before
// the code under test runs. Here two seals hold the digest of the sealed file: `manifest.txt`, which
// git tracks, and a `seal.lock` beside the sealed file, which git ignores. Each is committed or built
// with a comment the reseal never writes, so only a byte restore gives it back.
// ---------------------------------------------------------------------------

const VALUE = 'defs/value.txt';
const digest = (text) => require('node:crypto').createHash('sha256').update(text).digest('hex');
const sealLines = (rel, body, comment) => `# ${comment}\n${digest(body)}  ${rel}\n`;

// The reseal. It counts its runs outside the tree, rewrites both seals, leaves a new ignored file
// beside the sealed one and a new file git sees at the root. `--rewrite` also rewrites the sealed file
// itself, as a reseal that stamps or reformats it does. It overwrites a file by removing it and
// appending, so this fixture holds no direct write.
const SEAL = String.raw`'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rel = process.argv[2];
fs.appendFileSync(process.env.SEAL_RUNS, 'reseal\n');
if (process.argv.includes('--rewrite')) fs.appendFileSync(rel, '# sealed\n');
const line = crypto.createHash('sha256').update(fs.readFileSync(rel)).digest('hex') + '  ' + rel + '\n';
for (const seal of ['manifest.txt', path.join(path.dirname(rel), 'seal.lock')]) {
  fs.rmSync(seal, { force: true });
  fs.appendFileSync(seal, line);
}
fs.appendFileSync(path.join(path.dirname(rel), 'stamp.lock'), 'resealed\n');
fs.appendFileSync('.seal-stamp', 'resealed\n');
if (process.argv.includes('--fail')) process.exit(3);
`;

// The test: red on a stale digest in either seal, as the host's loader refuses the whole pack. With
// 'strict' it also checks the value the mutant changed. A red run prints node --test's failing summary.
const CHECK = String.raw`'use strict';
const fs = require('fs');
const crypto = require('crypto');
const fail = (why) => { console.log(why); console.log('# fail 1'); process.exit(1); };
const seals = ['manifest.txt', ...fs.readdirSync('.').map((dir) => dir + '/seal.lock')].filter((seal) => fs.existsSync(seal));
for (const seal of seals) {
  for (const line of fs.readFileSync(seal, 'utf8').split('\n')) {
    const [sum, rel] = line.split('  ');
    if (!rel || line.startsWith('#')) continue;
    if (crypto.createHash('sha256').update(fs.readFileSync(rel)).digest('hex') !== sum) fail('stale seal on ' + rel + ' in ' + seal);
  }
}
if (process.argv[2] === 'strict' && fs.readFileSync('defs/value.txt', 'utf8') !== '1\n') fail('wrong value');
`;

/** A config whose `mutate` block seals `glob` with `reseal`, and `extra` lines under `mutate`. */
const sealConfig = (reseal, { glob = 'defs/**', extra = '' } = {}) =>
  `mutate:\n${extra}  sealed:\n    - paths: ["${glob}"]\n      reseal: "${reseal}"\n`;

/** The seals of a sealed tree: the tracked manifest and the ignored lock beside the sealed file. */
function seals(rel, body) {
  const lock = { rel: `${path.dirname(rel)}/seal.lock`, body: sealLines(rel, body, 'built by hand') };
  return { manifest: sealLines(rel, body, 'sealed by hand'), lock, stamp: `${path.dirname(rel)}/stamp.lock` };
}

/** A committed tree with a sealed `defs/value.txt` and a plain `src/plain.txt`; `files` adds or replaces files. */
function sealTree(t, files = {}) {
  const dir = tempDir('inferno-mutate-seal-');
  t.after(() => {
    spawnSync('chmod', ['-R', 'u+w', dir]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const tree = path.join(dir, 'app');
  const all = {
    [VALUE]: '1\n',
    'src/plain.txt': 'x\n',
    'manifest.txt': sealLines(VALUE, '1\n', 'sealed by hand'),
    '.gitignore': '*.lock\n',
    'seal.cjs': SEAL,
    'check.cjs': CHECK,
    '.specs-inferno/config.yaml': sealConfig(`node seal.cjs ${VALUE}`),
    '.specs-inferno/config.fail.yaml': sealConfig(`node seal.cjs ${VALUE} --fail`),
    ...files,
  };
  for (const [rel, body] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
    writeFile(path.join(tree, rel), body);
  }
  git(tree, 'init', '-q', '-b', 'main');
  git(tree, 'config', 'user.email', 'test@example.com');
  git(tree, 'config', 'user.name', 'Test');
  git(tree, 'add', '-A');
  git(tree, 'commit', '-qm', 'init');
  const sealed = seals(VALUE, '1\n');
  writeFile(path.join(tree, sealed.lock.rel), sealed.lock.body);
  return { dir, tree, cache: path.join(dir, 'cache'), runs: path.join(dir, 'seal-runs'), ...sealed };
}

/** A Rust batch tree whose `src/lib.rs` is sealed, with `files` beside it, in the shape `sealTree` returns plus the fake's state. */
function sealedRustTree(t, lib, reseal = 'node seal.cjs src/lib.rs', files = {}) {
  const sealed = seals('src/lib.rs', lib);
  const f = batchTree(t, {
    ...files,
    'src/lib.rs': lib,
    'manifest.txt': sealed.manifest,
    '.gitignore': '*.lock\n',
    'seal.cjs': SEAL,
    'check.cjs': CHECK,
    '.specs-inferno/config.yaml': sealConfig(reseal, { glob: 'src/**' }),
  });
  writeFile(path.join(f.root, sealed.lock.rel), sealed.lock.body);
  return { ...f, tree: f.root, runs: path.join(f.dir, 'seal-runs'), ...sealed };
}

// CLAUDE_BUILD_WRAPPED is claude-build's nested-call marker: a fake command runs as is and never queues on the machine-wide build lock.
const sealEnv = (f) => ({ ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache, SEAL_RUNS: f.runs, ...(f.state ? { FAKE_RUST_STATE: f.state } : {}) });
const singleArgs = (f, test, extra = []) =>
  [RUN, 'mutate', '--tree', f.tree, '--file', VALUE, '--line', '1', '--replace', '2', '--test', test, ...extra];

/** One mutant on line 1 of the sealed file; `--json` in `extra` adds the payload. */
function sealMutate(f, test, extra = []) {
  const result = spawnSync(process.execPath, singleArgs(f, test, extra), { cwd: f.tree, encoding: 'utf8', env: sealEnv(f) });
  const json = extra.includes('--json') ? safeJson(result.stdout) : null;
  return { code: result.status, out: result.stdout, err: result.stderr, json };
}

/** A batch of `entries` with `--json`, written outside the tree. */
function sealBatch(f, entries, extra = []) {
  const file = path.join(f.dir, 'batch.json');
  writeFile(file, JSON.stringify(entries));
  const result = spawnSync(process.execPath, [RUN, 'mutate', '--tree', f.tree, '--batch', file, '--json', ...extra],
    { cwd: f.tree, encoding: 'utf8', env: sealEnv(f) });
  return { code: result.status, out: result.stdout, err: result.stderr, payload: safeJson(result.stdout) };
}

const readIn = (f, rel) => fs.readFileSync(path.join(f.tree, rel), 'utf8');
const existsIn = (f, rel) => fs.existsSync(path.join(f.tree, rel));
const reseals = (f) => (fs.existsSync(f.runs) ? fs.readFileSync(f.runs, 'utf8').split('\n').filter(Boolean).length : 0);

/**
 * The tree is exactly as before the call: the sealed file, the tracked manifest's own bytes, the
 * ignored lock's own bytes, and no file the reseal left, whether git sees it or ignores it.
 */
function assertSealed(f, value = '1\n', rel = VALUE) {
  assert.equal(readIn(f, 'manifest.txt'), f.manifest);
  assert.equal(readIn(f, f.lock.rel), f.lock.body, `the ignored seal ${f.lock.rel} holds its bytes from before`);
  assert.equal(existsIn(f, f.stamp), false, `the ignored ${f.stamp} the reseal made is gone`);
  assert.equal(existsIn(f, '.seal-stamp'), false);
  assert.equal(git(f.tree, 'status', '--porcelain'), '');
  if (value !== null) assert.equal(readIn(f, rel), value);
}

/** A config file outside the tree, so the tree stays clean; returns its path. */
function configFile(f, name, body) {
  const file = path.join(f.dir, name);
  writeFile(file, body);
  return file;
}

/** Poll until `done()` holds, up to ten seconds. */
async function until(done) {
  for (let i = 0; i < 400 && !done(); i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  return done();
}

module.exports = {
  RUN, batchTree, builds, env, fakeTest, git, journalOf, runBatch, runs, source,
  VALUE, assertSealed, configFile, existsIn, readIn, reseals, sealBatch, sealConfig, sealEnv, sealMutate, sealTree,
  sealedRustTree, singleArgs, until,
};
