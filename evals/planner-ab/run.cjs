'use strict';

/**
 * The run half of the planner A/B eval. Per run it copies the consumer into a fresh tree, commits
 * it with a fixed author and date (so every run plans the same commit), installs the arm's flow
 * and commits that, plans the statement on one host, keeps the transcript, and runs the frontier
 * of every intent the planner wrote. Runs go one after the other, never two at once: run n of
 * every arm on every host before run n + 1, so a slow hour weighs on both arms alike. A run whose
 * meta.json is already in the output folder is kept and not run again, so an interrupted eval
 * resumes where it stopped. Dry mode prints every command it would run and writes nothing.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { REPO } = require('./paths.cjs');
const { prepareArm, holdsPatch, sourcePins, installedPins } = require('./arms.cjs');
const { CODEX_HOLDS, CONFIG, hostArgv, frontierArgv, threadIdOf, findRollout, quote } = require('./hosts.cjs');

class RunError extends Error {}

const ARMS = ['A', 'B'];
const SCRIPTS = path.join('.specsmd', 'inferno', 'agents', 'orchestrator', 'skills', 'orchestrate', 'scripts');
const FIXED = '2026-01-05T09:00:00Z';
/** Git as the eval runs it: no config of this machine, a fixed author and date, no hooks. */
const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
  GIT_AUTHOR_NAME: 'Acme Eval', GIT_AUTHOR_EMAIL: 'eval@example.invalid', GIT_AUTHOR_DATE: FIXED,
  GIT_COMMITTER_NAME: 'Acme Eval', GIT_COMMITTER_EMAIL: 'eval@example.invalid', GIT_COMMITTER_DATE: FIXED,
};

function git(cwd, args) {
  const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
    { cwd, env: { ...process.env, ...GIT_ENV }, encoding: 'utf8' });
  if (result.status !== 0) throw new RunError(`git ${args.join(' ')} failed in ${cwd}: ${(result.stderr || '').trim()}`);
  return result.stdout.trim();
}

/** The consumer copied into `tree` and committed; returns the commit. */
function plantConsumer(consumer, tree) {
  fs.mkdirSync(tree, { recursive: true });
  fs.cpSync(consumer, tree, { recursive: true });
  git(tree, ['init', '-q', '-b', 'main']);
  git(tree, ['add', '-A']);
  git(tree, ['commit', '-q', '-m', 'Acme Shop']);
  return git(tree, ['rev-parse', 'HEAD']);
}

function installArgv(src) {
  return ['node', path.join(src, 'bin', 'cli.js'), 'install', '--flow', 'inferno', '--tools', 'claude,codex'];
}

/** The order of the runs: run n of each arm on each host, before run n + 1. */
function schedule(hosts, runs) {
  const out = [];
  for (let run = 1; run <= runs; run += 1) {
    for (const host of hosts) for (const arm of ARMS) out.push({ id: `${arm}-${host}-${run}`, arm, host, run });
  }
  return out;
}

const sha = (text) => crypto.createHash('sha1').update(text).digest('hex');

/** The arms and the consumer commit, prepared in `work`. */
function prepare(options, work) {
  // A patch already in --source is the edited tree before its diff was put back: arm A is the
  // tree with the patch taken out, and arm B the tree as it is.
  const held = !options.a && holdsPatch(options.b, options.source);
  const arms = held
    ? {
      A: prepareArm(options.b, options.source, path.join(work, 'A'), { reverse: true }),
      B: { src: options.source, label: `${options.source} as it is, holding ${path.basename(options.b)}`, patch: options.b },
    }
    : {
      A: prepareArm(options.a || options.source, options.source, path.join(work, 'A')),
      B: prepareArm(options.b, options.source, path.join(work, 'B')),
    };
  for (const arm of ARMS) arms[arm].pins = sourcePins(arms[arm].src);
  const probe = path.join(work, 'consumer-probe');
  const consumerSha = plantConsumer(options.consumer, probe);
  fs.rmSync(probe, { recursive: true, force: true });
  return { arms, consumerSha };
}

function header(options, prepared, statement) {
  return {
    statement: options.statement,
    statementSha: sha(statement),
    consumer: options.consumer,
    consumerSha: prepared.consumerSha,
    hosts: options.hosts,
    runs: options.runs,
    arms: Object.fromEntries(ARMS.map((arm) => [arm, { label: prepared.arms[arm].label, patch: prepared.arms[arm].patch || null }])),
  };
}

function hostLine(host, pins, run) {
  const target = host === 'claude' ? 'transcript.jsonl' : 'events.jsonl';
  return `${quote(hostArgv(host, pins, run.tree))} > ${quote([path.join(run.dir, target)])} < ${quote([run.statement])}`;
}

function dryRun(options) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-ab-dry-'));
  try {
    const prepared = prepare(options, work);
    const plan = schedule(options.hosts, options.runs);
    const out = [
      'planner A/B dry run: nothing is installed and no host is started',
      `consumer ${options.consumer} at ${prepared.consumerSha}`,
      `statement ${options.statement}`,
      ...ARMS.map((arm) => `arm ${arm}: ${prepared.arms[arm].label}`),
      `${plan.length} planner runs in all: ${plan.length / 2} per arm, ${options.runs} per arm on each host, one after the other, never two at once`,
      '',
    ];
    for (const entry of plan) {
      const dir = path.join(options.out, 'runs', entry.id);
      const run = { dir, tree: path.join(dir, 'tree'), statement: options.statement };
      out.push(`run ${entry.id}`, `  tree: ${run.tree} (consumer at ${prepared.consumerSha})`,
        `  install: ${quote(installArgv(prepared.arms[entry.arm].src))}`,
        `  host: ${hostLine(entry.host, prepared.arms[entry.arm].pins, run)}`,
        `  frontier: ${quote(frontierArgv(entry.host, 'INTENT')).replace('INTENT', '<intent-id>')}`, '');
    }
    out.push(`then, from the repository root: node ${path.relative(REPO, path.join(__dirname, 'planner-ab.cjs'))} count ${options.out}`);
    return `${out.join('\n')}\n`;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** The ab.json already in `out` must describe the same eval, else its runs are not this eval's. */
function checkResume(out, ab) {
  const file = path.join(out, 'ab.json');
  if (!fs.existsSync(file)) return;
  const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of ['statementSha', 'consumerSha', 'runs']) {
    if (JSON.stringify(kept[key]) !== JSON.stringify(ab[key])) throw new RunError(`${out} holds another eval (${key} differs): name a new --out`);
  }
  for (const arm of ARMS) {
    if (kept.arms[arm].label !== ab.arms[arm].label) throw new RunError(`${out} holds another eval (arm ${arm} differs): name a new --out`);
  }
}

/** Runs one frontier per planned intent and records each exit and its lines. */
function frontiers(tree, host, env) {
  if (!fs.existsSync(path.join(tree, '.specs-inferno', 'state.yaml'))) return [];
  const { readLedger } = require(path.resolve(tree, SCRIPTS, 'run-lib.cjs'));
  let intents;
  try {
    ({ intents } = readLedger(tree));
  } catch (error) {
    // A ledger the flow cannot read is the plan's own result: no frontier can run on it.
    return [{ intent: null, exit: 2, lines: [`state.yaml does not read: ${error.message}`] }];
  }
  return intents.map((intent) => {
    const [cmd, ...args] = frontierArgv(host, intent.id);
    const result = spawnSync(cmd, args, { cwd: tree, env, encoding: 'utf8' });
    const lines = `${result.stdout || ''}${result.stderr || ''}`.split('\n').filter((line) => line.trim());
    return { intent: intent.id, exit: result.status, lines };
  });
}

function oneRun(entry, arm, options, consumerSha, stub) {
  const dir = path.join(options.out, 'runs', entry.id);
  fs.rmSync(dir, { recursive: true, force: true });
  const tree = path.join(dir, 'tree');
  const planted = plantConsumer(options.consumer, tree);
  const env = { ...process.env, SPECSMD_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', SPECSMD_CODEX: stub };
  const [node, ...install] = installArgv(arm.src);
  const installed = spawnSync(node, install, {
    cwd: tree, encoding: 'utf8', env: { ...env, XDG_DATA_HOME: path.join(dir, '.eval-data'), INFERNO_FLOW_BUDGET: '' },
  });
  fs.writeFileSync(path.join(dir, 'install.log'), `${installed.stdout || ''}${installed.stderr || ''}`);
  if (installed.status !== 0) throw new RunError(`the install of arm ${entry.arm} exited ${installed.status}: see ${path.join(dir, 'install.log')}`);
  git(tree, ['add', '-A']);
  git(tree, ['commit', '-q', '-m', 'Install the INFERNO flow']);
  const pins = installedPins(tree);
  const [cmd, ...args] = hostArgv(entry.host, pins, tree);
  const target = path.join(dir, entry.host === 'claude' ? 'transcript.jsonl' : 'events.jsonl');
  const stdout = fs.openSync(target, 'w');
  const stderr = fs.openSync(path.join(dir, 'stderr.log'), 'w');
  const started = new Date();
  process.stdout.write(`run ${entry.id}: ${cmd} started ${started.toISOString()}\n`);
  const result = spawnSync(cmd, args, {
    cwd: tree, env, input: fs.readFileSync(options.statement, 'utf8').trim(), stdio: ['pipe', stdout, stderr],
    timeout: options.timeoutMin * 60000, killSignal: 'SIGTERM',
  });
  const ended = new Date();
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  const meta = {
    id: entry.id, arm: entry.arm, host: entry.host, run: entry.run, consumerSha: planted, started: started.toISOString(),
    ended: ended.toISOString(), wallMs: ended - started, exit: result.status, signal: result.signal || null,
    model: pins[entry.host].model, effort: pins[entry.host].effort, command: [cmd, ...args],
  };
  if (result.error) meta.error = `${cmd} did not run: ${result.error.message}`;
  if (entry.host === 'codex') {
    const id = threadIdOf(target);
    const rollout = id && findRollout(id, started, ended);
    if (rollout) fs.copyFileSync(rollout, path.join(dir, 'transcript.jsonl'));
    else meta.error = id ? `no rollout of thread ${id} under the Codex sessions folder` : 'the Codex events name no thread';
  }
  fs.writeFileSync(path.join(dir, 'frontier.json'), `${JSON.stringify(frontiers(tree, entry.host, env), null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  if (planted !== consumerSha) process.stdout.write(`run ${entry.id}: the consumer planted at ${planted}, not ${consumerSha}\n`);
  process.stdout.write(`run ${entry.id}: exit ${result.status} after ${(meta.wallMs / 60000).toFixed(1)} min\n`);
}

function realRun(options) {
  for (const host of options.hosts) {
    const found = spawnSync(host, ['--version'], { encoding: 'utf8' });
    if (found.status !== 0) throw new RunError(`${host} is not on PATH here, so no ${host} run can start`);
  }
  fs.mkdirSync(options.out, { recursive: true });
  const prepared = prepare(options, path.join(options.out, 'arms'));
  const ab = header(options, prepared, fs.readFileSync(options.statement, 'utf8').trim());
  checkResume(options.out, ab);
  fs.writeFileSync(path.join(options.out, 'ab.json'), `${JSON.stringify(ab, null, 2)}\n`);
  const stub = path.join(options.out, 'bin', 'codex-holds');
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  fs.writeFileSync(stub, CODEX_HOLDS, { mode: 0o755 });
  for (const entry of schedule(options.hosts, options.runs)) {
    if (fs.existsSync(path.join(options.out, 'runs', entry.id, 'meta.json'))) {
      process.stdout.write(`run ${entry.id}: kept from an earlier start\n`);
      continue;
    }
    oneRun(entry, prepared.arms[entry.arm], options, prepared.consumerSha, stub);
  }
}

module.exports = { RunError, CONFIG, dryRun, realRun, schedule };
