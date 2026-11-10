'use strict';

/**
 * Test fixtures for the smoke and Windows lanes: a throwaway host repo on an intent branch whose
 * lanes are stub commands, `node lane.cjs <name> <exit code | wait | movewait | redwait | file | verdicts>`.
 * `wait` holds until the release file exists, `movewait` then writes an in-scope file, `redwait`
 * first prints a product red class line and then holds like `wait`, `file` exits
 * with the code written to the code file outside the tree, and `verdicts` copies the verdicts-next
 * file outside the tree to the verdicts file beside it and exits 10. Every lane run appends its name and
 * INFERNO_GATE_CONFIG to the lane-env file outside the tree. The finalize stub `node proof.cjs hold`
 * holds until the release file exists, so the gate job stays in its finalize commands. A lane's `accept_check` stub,
 * `node check.cjs <exit>`, writes its INFERNO_* environment to the check-env file outside the
 * tree, prints its verdict as its last line and exits with that code.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const RUN = path.join(__dirname, 'run.cjs');
const { tempDir } = require('./test-temp.cjs');
const { writeFile } = require('./test-write.cjs');
const { reviewBefore } = require('./review-fixture.cjs');
const jobs = require('./run-jobs.cjs');

const BRANCH = 'inferno-intent/demo-00000000T000000Z';
const DEFAULT = '.specs-inferno/config.yaml';
const whole = 'node proof.cjs whole';
const red = 'node proof.cjs red';

function write(tree, file, body) {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
  writeFile(path.join(tree, file), body);
}

function git(tree, ...args) {
  return execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(tree, message = 'change') {
  git(tree, 'add', '-A');
  git(tree, 'commit', '-qm', message);
}

/**
 * A config whose lanes are the stub commands above, one `<lane>: <token>` entry each; `extra`
 * adds raw keys to a lane, as `{ smoke: { accept_check: 'node check.cjs 0' } }`.
 */
function config(lanes = { smoke: '0' }, finalize = [whole], scope = ['src/**'], extra = {}) {
  const keys = (name) => Object.entries(extra[name] || {}).map(([key, value]) => `    ${key}: ${value}\n`).join('');
  const blocks = Object.entries(lanes).map(([name, code]) =>
    `  ${name}:\n    command: node lane.cjs ${name} ${code}\n    scope: ${JSON.stringify(scope)}\n${keys(name)}`).join('');
  return `delivery:\n  base_branch: main\nverification:\n  finalize:\n${finalize.map((c) => `    - ${c}\n`).join('')}${blocks}`;
}

/** Every job file under a fixture's cache, whatever branch dir it sits in. */
function jobFiles(cache) {
  if (!fs.existsSync(cache)) return [];
  return fs.readdirSync(cache, { recursive: true, encoding: 'utf8' })
    .filter((rel) => rel.endsWith('-job.json'))
    .map((rel) => path.join(cache, rel));
}

/** Has every process of the group ended, or is it a zombie no signal reaches. */
function groupGone(pid) {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

/**
 * A job run.cjs detached in this fixture's tree: it leads its own process group and runs in the
 * tree. A job file a test wrote by hand for a process of its own names neither, and is left alone.
 */
function detachedHere(job, tree) {
  if (!jobs.alive(job)) return false;
  try {
    const stat = fs.readFileSync(`/proc/${job.pid}/stat`, 'utf8');
    const group = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
    return group === job.pid && fs.readlinkSync(`/proc/${job.pid}/cwd`) === fs.realpathSync(tree);
  } catch (error) {
    return false;
  }
}

/**
 * Stop every gate and lane job a test detached in this fixture, by the pid its job file records,
 * and wait until its whole process group is gone. A job outlives the run.cjs call that detached
 * it: the gate job folds the base and runs its finalize commands in the tree, which append to
 * `.runs`, and a lane job reads the tree with git once its command ends. A cleanup that removes
 * the dir while one still runs fails with ENOTEMPTY. The pass repeats until no job is alive.
 */
function stopJobs(cache, tree) {
  for (let pass = 0; pass < 10; pass += 1) {
    const running = jobFiles(cache).map(jobs.readJson).filter((job) => detachedHere(job, tree));
    if (running.length === 0) return;
    for (const job of running) {
      try {
        // The lane command and its children share the job's group, so they die with it.
        process.kill(-job.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    for (const job of running) {
      for (let i = 0; i < 100 && !groupGone(job.pid); i += 1) jobs.sleepSync(50);
    }
  }
}

function fixture(t, source = config()) {
  const dir = tempDir('inferno-lanes-');
  t.after(() => {
    writeFile(path.join(dir, 'release'), '');
    stopJobs(path.join(dir, 'cache'), path.join(dir, 'app'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const tree = path.join(dir, 'app');
  const release = path.join(dir, 'release');
  fs.mkdirSync(tree);
  git(tree, 'init', '-q', '-b', 'main');
  git(tree, 'config', 'user.email', 'test@example.com');
  git(tree, 'config', 'user.name', 'Test');
  write(tree, '.gitignore', '.runs\n.lane-runs\n');
  write(tree, 'src/input.txt', 'one\n');
  write(tree, 'docs/readme.txt', 'one\n');
  const code = path.join(dir, 'code');
  write(tree, DEFAULT, source.replace(/ (wait|movewait|redwait)\n/g, ` $1 ${release}\n`).replace(/ file\n/g, ` file ${code}\n`));
  write(tree, 'proof.cjs', `const fs = require('node:fs');
fs.appendFileSync('.runs', process.argv[2] + '\\n');
if (process.argv[2] === 'red') process.exit(1);
while (process.argv[2] === 'hold' && !fs.existsSync('../release')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
`);
  write(tree, 'lane.cjs', `const fs = require('node:fs');
const [name, code, release] = process.argv.slice(2);
fs.appendFileSync('.lane-runs', name + '\\n');
fs.appendFileSync('../lane-env', name + ' ' + (process.env.INFERNO_GATE_CONFIG || '') + '\\n');
if (code === 'redwait') console.log('PRODUCT RED demo: red on the branch');
if (code === 'verdicts') {
  fs.copyFileSync('../verdicts-next.json', '../verdicts.json');
  process.exit(10);
}
if (code === 'wait' || code === 'movewait' || code === 'redwait') {
  while (!fs.existsSync(release) && fs.existsSync('lane.cjs')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  if (code === 'movewait') fs.writeFileSync('src/moved.txt', 'moved\\n');
  process.exit(0);
}
process.exit(Number(code === 'file' ? fs.readFileSync(release, 'utf8') : code));
`);
  write(tree, 'check.cjs', `const { writeFile } = require(${JSON.stringify(path.join(__dirname, 'test-write.cjs'))});
const code = Number(process.argv[2]);
const seen = Object.keys(process.env).filter((key) => key.startsWith('INFERNO_')).sort();
writeFile('../check-env', seen.map((key) => key + '=' + process.env[key] + '\\n').join(''));
console.log('reading the lane log');
console.log(code === 0 ? 'the lane closed on its own line' : 'no closing line in the lane log');
console.log('');
process.exit(code);
`);
  commit(tree, 'fixture');
  git(tree, 'checkout', '-qb', BRANCH);
  return {
    tree, release, code, cache: path.join(dir, 'cache'), checkEnv: path.join(dir, 'check-env'), laneEnv: path.join(dir, 'lane-env'),
    next: path.join(dir, 'verdicts-next.json'), verdicts: path.join(dir, 'verdicts.json'),
  };
}

/** The verdicts the `verdicts` stub writes on its next run: each red test as `[name, base, again]`. */
function nextVerdicts(f, red) {
  writeFile(f.next, `${JSON.stringify({ red: red.map(([name, base, again]) => ({ name, base, again })) })}\n`);
}

/** A config whose smoke lane runs `token` and names the verdicts file the `verdicts` stub writes. */
const withVerdicts = (token = 'verdicts', lanes = {}) =>
  config({ smoke: token, ...lanes }, [whole], ['src/**'], { smoke: { verdicts: '../verdicts.json' } });

function run(f, ...args) {
  reviewBefore(args, f.tree);
  // CLAUDE_BUILD_WRAPPED is claude-build's nested-call marker: a fake command runs as is and never queues on the machine-wide build lock.
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: f.tree, encoding: 'utf8', env: { ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function passed(result) {
  assert.equal(result.code, 0, result.out + result.err);
}

function laneRuns(f) {
  const file = path.join(f.tree, '.lane-runs');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : [];
}

function touch(f, file = 'src/input.txt') {
  write(f.tree, file, `${Date.now()}-${Math.random()}\n`);
  commit(f.tree);
}

/** Detach the gate and wait it out; returns the wait's result. */
function gated(f, ...extra) {
  passed(run(f, 'gate', '--detach', ...extra));
  return run(f, 'gate', '--wait', '--minutes', '0.5', ...extra);
}

/** A harness fix committed on main and folded into the branch; returns its sha. */
function harnessFix(f) {
  git(f.tree, 'checkout', '-q', 'main');
  write(f.tree, 'harness.txt', `${Date.now()}\n`);
  commit(f.tree, 'harness fix');
  const fix = git(f.tree, 'rev-parse', 'HEAD');
  git(f.tree, 'checkout', '-q', BRANCH);
  git(f.tree, 'merge', '-q', '--no-edit', 'main');
  return fix;
}

const acceptLine = (lane) => new RegExp(`^land the harness fix on main, then: node \\S+run\\.cjs ${lane} --accept --harness-fix <sha> --tree \\S+$`);

/** The branch's cache dir, where the gate and lane job files live. */
function cacheOf(f) {
  return path.join(f.cache, 'specsmd-inferno', 'app', BRANCH);
}

module.exports = {
  BRANCH, acceptLine, cacheOf, commit, config, fixture, gated, git, harnessFix, laneRuns, nextVerdicts, passed, red, run, touch, whole,
  withVerdicts, write,
};
