'use strict';

/**
 * The build half of the planner A/B eval: what a planner text change then costs or saves the
 * builder. `build --run <kept run> --out <dir>` copies the tree a planner run left, commits the
 * plan in it under the eval's invented identity, and gives the installed orchestrator its slash
 * command for the planned intent on stdin, headless, with the same command for every arm. It
 * keeps the tree, the stream, the start and end times and the exit, and after the session the
 * transcripts the host stored of its subagents, the only place a subagent's own output tokens are
 * written. A build whose meta.json is already in `--out` is kept and counted again, never rerun.
 * Dry mode prints every step and writes nothing.
 *
 * Codex: no Codex build has been run or read, so its shape is unknown and `build` refuses it.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { REPO, S } = require('./paths.cjs');
const { buildArgv, quote } = require('./hosts.cjs');
const { hostStored } = require('./count-build.cjs');
const { RunError, git } = require('./run.cjs');

const CODEX_NOT_BUILT = 'a Codex build is not built yet: no Codex build has been run or read, so the eval does not know its shape';
/** The identity the host's own commits carry in a build, so no person's name lands in a kept tree. */
const AUTHOR = { GIT_AUTHOR_NAME: 'Acme Eval', GIT_AUTHOR_EMAIL: 'eval@example.invalid', GIT_COMMITTER_NAME: 'Acme Eval', GIT_COMMITTER_EMAIL: 'eval@example.invalid' };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** What the build of a kept run starts from: its meta, its tree, the intent and the plan's item ids. */
function planOf(options) {
  const metaFile = path.join(options.run, 'meta.json');
  if (!fs.existsSync(metaFile)) throw new RunError(`${options.run} holds no meta.json: name a run folder a planner-ab run kept`);
  const meta = readJson(metaFile);
  if (meta.host === 'codex') throw new RunError(CODEX_NOT_BUILT);
  if (meta.host !== 'claude') throw new RunError(`${options.run} ran on host ${meta.host}, which the eval cannot build`);
  const tree = path.join(options.run, 'tree');
  if (!fs.existsSync(path.join(tree, '.specs-inferno', 'state.yaml'))) throw new RunError(`${tree} holds no .specs-inferno/state.yaml: the run planned nothing to build`);
  const { readLedger } = require(path.join(S, 'run-lib.cjs'));
  const intents = readLedger(tree).intents;
  const intent = options.intent ? intents.find((entry) => entry.id === options.intent) : intents.length === 1 ? intents[0] : null;
  if (!intent) {
    const ids = intents.map((entry) => entry.id).join(', ') || 'none';
    throw new RunError(options.intent ? `${options.intent} is no intent of the plan (it holds ${ids})` : `the plan holds ${intents.length} intents (${ids}): name one with --intent`);
  }
  const model = options.model || meta.model;
  if (!model) throw new RunError(`${metaFile} names no model: name the orchestrator's with --model`);
  return { meta, tree, intent: intent.id, items: intent.items.map((item) => item.id), model };
}

const promptOf = (intent) => `/specsmd-inferno ${intent}`;

function buildDry(options, env = process.env) {
  const plan = planOf(options);
  const tree = path.join(options.out, 'tree');
  const argv = buildArgv(plan.model, env);
  return [
    'planner A/B build dry run: nothing is copied and no host is started',
    `plan: ${options.run} (run ${plan.meta.id || 'unknown'}, arm ${plan.meta.arm || 'unknown'}), intent ${plan.intent}, ${plan.items.length} items: ${plan.items.join(', ')}`,
    `  copy: ${quote([plan.tree])} to ${quote([tree])}`,
    `  commit: git add -A && git commit -m ${quote([`Plan ${plan.intent}`])}, as Acme Eval <eval@example.invalid>`,
    `  host: cd ${quote([tree])} && echo ${quote([promptOf(plan.intent)])} | ${quote(argv)} > ${quote([path.join(options.out, 'transcript.jsonl')])}`,
    `  keep: the tree, transcript.jsonl, stderr.log, meta.json (start, end, exit) and subagents/ (the host's stored transcripts of the session's subagents)`,
    '',
    `then, from the repository root: node ${path.relative(REPO, path.join(__dirname, 'planner-ab.cjs'))} count ${options.out}`,
    '',
  ].join('\n');
}

/** Builds the plan of `options.run` into `options.out`; returns the folder to count. */
function buildReal(options, env = process.env) {
  const plan = planOf(options);
  if (fs.existsSync(path.join(options.out, 'meta.json'))) {
    process.stdout.write(`build ${options.out}: kept from an earlier start\n`);
    return options.out;
  }
  if (fs.existsSync(options.out) && fs.readdirSync(options.out).length > 0) {
    throw new RunError(`${options.out} holds an unfinished build: remove it or name a new --out`);
  }
  const found = spawnSync('claude', ['--version'], { encoding: 'utf8', env });
  if (found.status !== 0) throw new RunError('claude is not on PATH here, so no build can start');
  const tree = path.join(options.out, 'tree');
  fs.mkdirSync(options.out, { recursive: true });
  fs.cpSync(plan.tree, tree, { recursive: true, verbatimSymlinks: true });
  git(tree, ['add', '-A']);
  if (git(tree, ['status', '--porcelain']) !== '') git(tree, ['commit', '-q', '-m', `Plan ${plan.intent}`]);
  const argv = buildArgv(plan.model, env);
  const [cmd, ...args] = argv;
  const transcript = path.join(options.out, 'transcript.jsonl');
  const stdout = fs.openSync(transcript, 'w');
  const stderr = fs.openSync(path.join(options.out, 'stderr.log'), 'w');
  const started = new Date();
  process.stdout.write(`build ${plan.meta.id || options.run}: ${cmd} started ${started.toISOString()} on intent ${plan.intent}\n`);
  const result = spawnSync(cmd, args, {
    cwd: tree, env: { ...env, ...AUTHOR, SPECSMD_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1' }, input: `${promptOf(plan.intent)}\n`,
    stdio: ['pipe', stdout, stderr], timeout: options.timeoutMin * 60000, killSignal: 'SIGTERM',
  });
  const ended = new Date();
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  const sessionId = sessionOf(transcript);
  const meta = {
    kind: 'build', id: plan.meta.id || path.basename(options.run), arm: plan.meta.arm || null, host: 'claude', run: options.run,
    intent: plan.intent, items: plan.items, model: plan.model, command: argv, prompt: promptOf(plan.intent), tree: fs.realpathSync(tree),
    started: started.toISOString(), ended: ended.toISOString(), wallMs: ended - started, exit: result.status, signal: result.signal || null, sessionId,
  };
  if (result.error) meta.error = `${cmd} did not run: ${result.error.message}`;
  const stored = hostStored(sessionId, env);
  if (stored) fs.cpSync(stored, path.join(options.out, 'subagents'), { recursive: true });
  else meta.error = [meta.error, `no stored subagent transcripts of session ${sessionId || 'unknown'} under the host's projects folder`].filter(Boolean).join('; ');
  fs.writeFileSync(path.join(options.out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  process.stdout.write(`build ${meta.id}: exit ${result.status} after ${(meta.wallMs / 60000).toFixed(1)} min\n`);
  return options.out;
}

/** The session id the stream's init line names, or null. */
function sessionOf(transcript) {
  for (const line of fs.readFileSync(transcript, 'utf8').split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'system' && entry.subtype === 'init' && entry.session_id) return entry.session_id;
    } catch (error) {
      // A line that is no JSON names no session.
    }
  }
  return null;
}

module.exports = { CODEX_NOT_BUILT, buildDry, buildReal };
