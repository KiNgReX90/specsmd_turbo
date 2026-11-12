'use strict';

/**
 * The smoke and Windows lanes in the gate. `gate --detach` starts each configured lane whose
 * scope the branch touched as a job of its own, `gate --wait` waits for the gate and every lane,
 * and `green` owes the smoke lane while it is in scope and unproven.
 *
 * Exit contract of a host lane command: 0 green, 10 product red, 11 instrument red, and any
 * other code is instrument red too. The host runner does its own single retry; the flow never
 * retries a lane. An instrument red is accepted only against a harness fix already on the base
 * branch, recorded by `run.cjs smoke --accept --harness-fix <sha>` for the tree it ran on. A
 * product red is accepted only when the lane's verdicts file proves every red test intermittent
 * (run-lanes-intermittent.cjs).
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const jobs = require('./run-jobs.cjs');
const { configuredLanes } = require('./run-lane-config.cjs');
const { mergeSlot } = require('./run-config-gates.cjs');
const slot = require('./run-slot.cjs');
const { resolveBase } = require('./run-intents.cjs');
const intermittent = require('./run-lanes-intermittent.cjs');
const { gateStartCall, gateWaitCall, laneAcceptCall, laneIntermittentCall } = require('./run-call.cjs');
const { NO_VERDICT } = require('./run-exit.cjs');

const { RunError } = lib;
const DEFAULT_CONFIG = `${lib.SPECS_DIR}/config.yaml`;
const PRODUCT_RED = 10;
const ACCEPTED = '.instrument-red';
/** gate --wait's exit when every job ended and a lane red waits on its accept: an instrument red, or a product red proven intermittent. */
const UNBOUNDED_EXIT = 3;
/** run.cjs prints at most this many human lines. */
const MAX_LINES = 30;

/**
 * A lane's proof is keyed like a finalize command's, by its command, its config and its own scope.
 * The smoke lane folds a configured Windows lane in, so its proof stands only for the Windows
 * definition and scope it was minted under.
 */
function laneProof(tree, selected, lane, config) {
  const windows = lane.name === 'smoke' && configuredLanes(config).find((entry) => entry.name === 'windows');
  if (windows) {
    const scope = [...new Set([...lane.scope, ...windows.scope])].sort();
    return proofs.commandProof(tree, {}, selected, `${lane.command} (folds windows: ${windows.command})`, scope);
  }
  return proofs.commandProof(tree, {}, selected, lane.command, lane.scope);
}

function writeRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pending = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(pending, `${JSON.stringify(record)}\n`);
  fs.renameSync(pending, file);
}

/**
 * The accepted instrument red for exactly this proof's inputs, or null. A record binds the one
 * run it accepted: it holds only while the lane's latest result is that same instrument-red
 * run, so any later run of the lane, red or green, retires it.
 */
function readAccepted(tree, name, proof) {
  const record = jobs.readJson(`${proof.file}${ACCEPTED}`);
  const latest = jobs.readJson(jobs.jobPaths(tree, name).result);
  const matches = record && record.command === proof.command && record.config === proof.config && record.hash === proof.hash &&
    typeof record.harness_fix === 'string' && typeof record.run === 'string';
  return matches && latest && latest.run === record.run ? record : null;
}

const heldLines = (name, record) => record.tests.map((test) => `ACCEPTED lane ${name} intermittent: ${test}`);

/** Each configured lane an intermittent accept holds on this tree, with its record, as ship writes them down. */
function intermittentHeld(tree, config, selected) {
  return configuredLanes(config)
    .map((lane) => ({ lane: lane.name, record: intermittent.readAccepted(tree, lane.name, laneProof(tree, selected, lane, config)) }))
    .filter((entry) => entry.record);
}

function touched(lane, changed) {
  return changed.some((file) => lib.matchesAny(file, lane.scope));
}

function laneOf(config, name, selected) {
  const lane = configuredLanes(config).find((entry) => entry.name === name);
  if (!lane) {
    throw new RunError(`no verification.${name} in ${selected || DEFAULT_CONFIG}: configure the lane there first.`, 'NO_LANE');
  }
  return lane;
}

/** Start one lane as its own job, by the one detach call every lane start shares; `head` is the commit it walks. */
function startLane(tree, options, lane, head) {
  const args = ['gate', '--lane', lane.name, '--tree', tree, '--json'];
  if (options.config) args.push('--config', options.config);
  return jobs.detach(tree, args, jobs.jobPaths(tree, lane.name), { lane: lane.name, head });
}

/** Start every configured lane the branch touched and holds no proof for; returns the started names. */
function startLanes(tree, options, config, changed) {
  const started = [];
  const out = [];
  // Each lane job records the head it walks, so a supersede can tell what a fix changed since.
  const head = lib.git(tree, ['rev-parse', 'HEAD']);
  for (const lane of configuredLanes(config)) {
    if (!touched(lane, changed)) {
      out.push(`SKIP ${lane.name} (no path in scope changed)`);
      continue;
    }
    const proof = laneProof(tree, options.config, lane, config);
    const green = !options.force && proofs.readProof(proof);
    const accepted = !options.force && readAccepted(tree, lane.name, proof);
    const flaky = !options.force && intermittent.readAccepted(tree, lane.name, proof);
    if (green) out.push(`GREEN lane ${lane.name} (unchanged since ${green.stamp})`);
    else if (accepted) out.push(`ACCEPTED lane ${lane.name} instrument red, harness fix ${accepted.harness_fix.slice(0, 7)}`);
    else if (flaky) out.push(...heldLines(lane.name, flaky));
    if (green || accepted || flaky) continue;
    const job = startLane(tree, options, lane, head);
    started.push(lane.name);
    out.push(`${lane.name} lane started pid ${job.pid}`, `log ${job.log}`);
  }
  return { started, out };
}

/** `gate --lane <name>`: run one lane's command in this process and classify its exit. */
function laneNow(options) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const config = lib.readConfig(tree, options.config);
  const lane = laneOf(config, options.lane, options.config);
  const proof = laneProof(tree, options.config, lane, config);
  fs.rmSync(proof.file, { force: true });
  const runId = `${lib.stamp()}-${process.pid}`;
  const log = path.join(lib.cacheDir(tree), lib.currentBranch(tree), `lane-${lane.name}-${lib.stamp()}.log`);
  // The lane names its log while it walks, so a wait can read a red line before the result exists.
  // The result keeps the start too, so a verdicts file written before this run never speaks for it.
  const started = new Date().toISOString();
  writeRecord(jobs.jobPaths(tree, lane.name).run, { run: runId, log, started });
  // runShell inherits this one-shot process's environment, so the lane reads the config the gate used.
  process.env.INFERNO_GATE_CONFIG = proof.config;
  const run = lib.runShell(lane.command, tree, log);
  const now = lib.readConfig(tree, options.config);
  const moved = laneProof(tree, options.config, laneOf(now, lane.name), now).file !== proof.file;
  let result = 'instrument-red';
  if (moved) result = 'moved';
  else if (run.code === 0) result = 'green';
  else if (run.code === PRODUCT_RED) result = 'product-red';
  if (result === 'green') {
    const { file, ...identity } = proof;
    writeRecord(file, { ...identity, stamp: new Date().toISOString(), seconds: run.seconds, branch: lib.currentBranch(tree) });
  }
  const payload = { lane: lane.name, run: runId, result, code: run.code, seconds: run.seconds, log, hash: proof.hash, started };
  return { exit: result === 'green' ? 0 : 2, payload, out: [`${result} lane ${lane.name} exit ${run.code} -> ${log}`] };
}

/**
 * The first line of a running lane's log that matches the lane's `red_line`, or null. Only the
 * run file of this job counts: one stamped before the job started belongs to an earlier run.
 */
function redLine(tree, lane, job) {
  if (!lane || !lane.red_line) return null;
  const run = jobs.readJson(jobs.jobPaths(tree, lane.name).run);
  if (!run || typeof run.log !== 'string' || !(Date.parse(run.started) >= Date.parse(job.started))) return null;
  let text;
  try {
    text = fs.readFileSync(run.log, 'utf8');
  } catch (error) {
    return null;
  }
  const pattern = new RegExp(lane.red_line);
  const line = text.split(/\r?\n/).find((entry) => pattern.test(entry));
  return line === undefined ? null : { log: run.log, line };
}

/** One lane job as it stands: running, running with a red line, its result, or a process that died without one. */
function laneState(tree, name, config) {
  const paths = jobs.jobPaths(tree, name);
  const job = jobs.readJson(paths.job);
  if (jobs.alive(job)) {
    const red = redLine(tree, configuredLanes(config).find((entry) => entry.name === name), job);
    // A red line speaks for the head the lane walks. Once a commit lands after it, the lane reads
    // running, so the wait blocks on it until its result decides instead of exiting 2 on every call.
    const walked = () => typeof job.head !== 'string' || !job.head || lib.git(tree, ['rev-parse', 'HEAD']) === job.head;
    if (red && walked()) return { lane: name, state: 'running-red', pid: job.pid, log: red.log, line: red.line };
    return { lane: name, state: 'running', pid: job.pid, log: paths.log };
  }
  const result = jobs.readJson(paths.result);
  if (result && result.lane === name) return { ...result, state: result.result };
  return { lane: name, state: 'died', pid: job && job.pid, log: paths.log };
}

function acceptFix(tree, lane, selected) {
  const base = resolveBase(lib.readConfig(tree, selected), null, tree);
  return `land the harness fix on ${base}, then: ${laneAcceptCall(lane, tree)}`;
}

/**
 * A product red holds on its intermittent accept. Unaccepted, it is red, or owed that accept when
 * the lane's verdicts file proves every red test of this run on this tree intermittent. A red it
 * is not owed ends on why: the key its lane does not set, or the refusal of its verdicts.
 */
function productRed(tree, selected, config, entry) {
  const lane = laneOf(config, entry.lane, selected);
  const proof = laneProof(tree, selected, lane, config);
  const held = intermittent.readAccepted(tree, entry.lane, proof);
  if (held) return { verdict: 'hold', out: heldLines(entry.lane, held) };
  const out = [`RED lane ${entry.lane}: product red (exit ${entry.code}) -> ${entry.log}`, ...lib.tail(entry.log, 5)];
  const read = intermittent.proven(tree, lane, entry, proof);
  if (read.refusal) return { verdict: 'red', out: [...out, intermittent.unproven(lane, read)] };
  return { verdict: 'unbounded', out: [...out, `the lane proved every red intermittent: ${laneIntermittentCall(entry.lane, tree, read.tests)}`] };
}

/** The lines for a lane, and whether it holds (green or bounded), fails (2) or is unbounded. */
function describeLane(tree, selected, config, entry) {
  if (entry.state === 'running') return { verdict: 'running', out: [`${entry.lane} lane still running pid ${entry.pid}, log ${entry.log}`] };
  // The lane walks on and writes its result as today; its red line only ends the wait sooner.
  if (entry.state === 'running-red') return { verdict: 'red', out: [`RED lane ${entry.lane} while it walks: ${entry.line} -> ${entry.log}`] };
  if (entry.state === 'green') return { verdict: 'hold', out: [`GREEN lane ${entry.lane} ${entry.seconds}s`] };
  if (entry.state === 'product-red') return productRed(tree, selected, config, entry);
  if (entry.state === 'moved') return { verdict: 'red', out: [`RED lane ${entry.lane}: the code changed while the lane ran. Re-run the gate.`] };
  if (entry.state === 'died') return { verdict: 'red', out: [`lane ${entry.lane} process ${entry.pid} ended without a result -> ${entry.log}`, ...lib.tail(entry.log, 5)] };
  const accepted = readAccepted(tree, entry.lane, laneProof(tree, selected, laneOf(config, entry.lane, selected), config));
  if (accepted) return { verdict: 'hold', out: [`ACCEPTED lane ${entry.lane} instrument red, harness fix ${accepted.harness_fix.slice(0, 7)}`] };
  return {
    verdict: 'unbounded',
    out: [`INSTRUMENT RED lane ${entry.lane} (exit ${entry.code}) -> ${entry.log}`, ...lib.tail(entry.log, 5), acceptFix(tree, entry.lane, selected)],
  };
}

/**
 * gate --wait over the gate and every lane it started: 2 as soon as the gate or a lane is red,
 * a running lane's red line included, 4 while anything runs at the deadline, else 0 when every
 * lane holds. `lead` are lines printed before the wait's own. A red releases the tree's merge
 * slot ticket, or the holder a lanes-only job names; a 0 or 3 keeps it, since the tree is next to
 * ship or owes an accept.
 */
function waitAll(job, options, deadline, gateResult, lead = []) {
  const tree = job.tree;
  const config = lib.readConfig(tree, options.config);
  for (;;) {
    const gate = jobs.alive(job) ? null : gateResult();
    const states = (job.lanes || []).map((name) => laneState(tree, name, config));
    const lanes = states.map((state, at) => ({ name: job.lanes[at], ...describeLane(tree, options.config, config, state) }));
    // An unbounded lane prints last, so its accept line is the last line of the wait.
    const laneOut = [...lanes.filter((entry) => entry.verdict !== 'unbounded'), ...lanes.filter((entry) => entry.verdict === 'unbounded')]
      .flatMap((entry) => entry.out);
    // The gate block gives way to the lane lines, so the 30-line cap never cuts an accept line.
    const fit = (gateOut, tail = []) =>
      [...lead, ...lib.capLines(gateOut, Math.max(1, MAX_LINES - lead.length - laneOut.length - tail.length)), ...laneOut, ...tail];
    const lanePayload = { lanes: states };
    // A gate that reached no verdict waits for its lanes, since a red lane is still a verdict, and then ends as itself.
    const unrun = Boolean(gate) && gate.exit === NO_VERDICT;
    if ((gate && gate.exit !== 0 && !unrun) || lanes.some((entry) => entry.verdict === 'red')) {
      const gateOut = gate ? gate.out : [`gate still running pid ${job.pid}`];
      if (mergeSlot(config)) slot.release(tree, job.holder);
      return { exit: 2, payload: { ...(gate ? gate.payload : { ok: false }), ok: false, ...lanePayload }, out: fit(gateOut) };
    }
    const running = !gate || lanes.some((entry) => entry.verdict === 'running');
    if (!running && unrun) {
      if (mergeSlot(config)) slot.release(tree, job.holder);
      return { exit: NO_VERDICT, payload: { ...gate.payload, ok: false, ...lanePayload }, out: fit(gate.out) };
    }
    if (!running) {
      const owed = lanes.filter((entry) => entry.verdict === 'unbounded').map((entry) => entry.name);
      if (owed.length > 0) return { exit: UNBOUNDED_EXIT, payload: { ...gate.payload, ok: false, owed, ...lanePayload }, out: fit(gate.out) };
      return { exit: 0, payload: { ...gate.payload, ...lanePayload }, out: fit(gate.out) };
    }
    if (Date.now() >= deadline) {
      const elapsed = Math.round((Date.now() - Date.parse(job.started)) / 60000);
      const gateOut = gate ? [] : [`gate still running pid ${job.pid}, ${elapsed} min so far`, `log ${job.log}`];
      return {
        exit: 4,
        payload: { running: true, ...job, elapsed_minutes: elapsed, ...lanePayload },
        out: fit(gateOut, [`call ${gateWaitCall(tree)} again`]),
      };
    }
    jobs.sleepSync(500);
  }
}

/**
 * The host's own check of the instrument red about to be accepted, when the lane sets
 * `accept_check`. It runs in the tree and sees the lane, the run, its log and the gate's config;
 * a non-zero exit refuses the accept.
 */
function acceptCheck(tree, lane, last, proof) {
  // runShell inherits this one-shot process's environment.
  Object.assign(process.env, {
    INFERNO_LANE: lane.name, INFERNO_LANE_LOG: String(last.log || ''), INFERNO_LANE_RUN: last.run, INFERNO_GATE_CONFIG: proof.config,
  });
  const log = path.join(lib.cacheDir(tree), lib.currentBranch(tree), `lane-${lane.name}-accept-${lib.stamp()}.log`);
  const run = lib.runShell(lane.accept_check, tree, log);
  if (run.code === 0) return;
  const said = fs.readFileSync(log, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean).pop() || '(no output)';
  throw new RunError(`refused: the ${lane.name} lane's accept_check exited ${run.code}: ${said}\nlog ${log}`, 'ACCEPT_REFUSED');
}

/** `run.cjs <lane> --accept-intermittent`: the lane's own inputs for its intermittent accept. */
function acceptIntermittent(name, options) {
  intermittent.usage(name, options);
  const tree = options.tree || lib.repoRoot(options.cwd);
  const config = lib.readConfig(tree, options.config);
  const lane = laneOf(config, name, options.config);
  return intermittent.accept(tree, config, lane, laneProof(tree, options.config, lane, config), options);
}

/** `run.cjs <lane> --accept --harness-fix <sha>`: bound that lane's instrument red on this tree, and no other lane's. */
function accept(name, options) {
  if (options.accept_intermittent) return acceptIntermittent(name, options);
  if (!options.accept || !options.harness_fix) {
    throw new RunError(`usage: node run.cjs ${name} --accept --harness-fix <sha> [--tree <dir>] [--config <file>]`, 'BAD_ARGS', 1);
  }
  const tree = options.tree || lib.repoRoot(options.cwd);
  const config = lib.readConfig(tree, options.config);
  const lane = laneOf(config, name, options.config);
  const base = options.base || resolveBase(config, null, tree);
  const sha = lib.git(tree, ['rev-parse', '--verify', '--quiet', `${options.harness_fix}^{commit}`], { tolerate: true });
  const refs = [base, `origin/${base}`].filter((ref) => lib.git(tree, ['rev-parse', '--verify', '--quiet', ref], { tolerate: true }));
  if (!sha || !refs.some((ref) => lib.git(tree, ['merge-base', '--is-ancestor', sha, ref], { tolerate: true }) !== null)) {
    throw new RunError(`harness fix ${options.harness_fix} is not on ${base}: land the harness fix on ${base} first, then accept its sha.`, 'NOT_ON_BASE');
  }
  const proof = laneProof(tree, options.config, lane, config);
  const last = jobs.readJson(jobs.jobPaths(tree, name).result);
  if (!last || last.lane !== name || last.result !== 'instrument-red' || last.hash !== proof.hash || typeof last.run !== 'string') {
    throw new RunError(`no instrument red of the ${name} lane on this tree to accept: run ${gateStartCall(tree)}, ` +
      `then ${gateWaitCall(tree)}.`, 'NOTHING_TO_ACCEPT');
  }
  if (lane.accept_check) acceptCheck(tree, lane, last, proof);
  const { file, ...identity } = proof;
  writeRecord(`${file}${ACCEPTED}`, { ...identity, harness_fix: sha, run: last.run, code: last.code, stamp: new Date().toISOString(), branch: lib.currentBranch(tree) });
  if (mergeSlot(config)) slot.renew(tree);
  return {
    exit: 0,
    payload: { accepted: true, lane: name, harness_fix: sha, hash: proof.hash },
    out: [
      `accepted ${name} instrument red against harness fix ${sha.slice(0, 7)} for this tree`,
      `wait with: ${gateWaitCall(tree)}`,
    ],
  };
}

/** What green owes for the smoke lane: nothing when unset or out of scope, else a green or accepted proof. */
function smokeOwed(tree, config, selected, changed) {
  const lane = configuredLanes(config).find((entry) => entry.name === 'smoke');
  if (!lane) return { owed: [], out: [`SKIP smoke (no verification.smoke in ${selected || DEFAULT_CONFIG})`] };
  if (!touched(lane, changed)) return { owed: [], out: ['SKIP smoke (no path in scope changed)'] };
  const proof = laneProof(tree, selected, lane, config);
  if (proofs.readProof(proof)) return { owed: [], out: [] };
  const accepted = readAccepted(tree, 'smoke', proof);
  if (accepted) return { owed: [], out: [`ACCEPTED smoke instrument red, harness fix ${accepted.harness_fix.slice(0, 7)}`] };
  const flaky = intermittent.readAccepted(tree, 'smoke', proof);
  if (flaky) return { owed: [], out: flaky.tests.map((test) => `ACCEPTED smoke intermittent: ${test}`) };
  return {
    owed: ['smoke'],
    out: [`smoke owed: no green or accepted instrument-red smoke run for this tree; run ${gateStartCall(tree)}, ` +
      `then ${gateWaitCall(tree)}`],
  };
}

module.exports = { accept, intermittentHeld, laneNow, laneOf, laneProof, smokeOwed, startLane, startLanes, waitAll };
