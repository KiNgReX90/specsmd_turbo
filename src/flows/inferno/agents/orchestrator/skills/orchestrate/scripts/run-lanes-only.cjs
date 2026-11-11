'use strict';

/**
 * `gate --detach --lanes-only`: a driver that commits straight onto the base, holding its own
 * merge slot ticket, starts only the lanes its diff touched. There is no fold, no finalize
 * command, no ticket and no intent review. The gate job it writes has no process, and its
 * result names `lanes_only`, so `gate --wait` waits on the lanes alone and nothing reads that
 * result as a finalize proof. Each lane mints and checks its proof exactly as a gate's lane does.
 *
 * The job names the ticket a red wait releases: `--holder`, else the ticket this tree took, else
 * none. Never another worktree's ticket, so a red here never drops another intent from the queue.
 *
 * `gate --detach --lane <name>` walks that one lane again through the detach call every lane start
 * shares, while the gate job may still run its finalize commands. It refuses only while that lane
 * still walks, and joins the lane to the tree's gate job so `gate --wait` waits on it; with no gate
 * job it writes a lanes-only one for the lane alone.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const jobs = require('./run-jobs.cjs');
const lanes = require('./run-lanes.cjs');
const slot = require('./run-slot.cjs');
const { pendingPath } = require('./run-supersede.cjs');
const { atomicWrite } = require('./state-store.cjs');
const { mergeSlot } = require('./run-config-gates.cjs');
const { gateSupersedeCall, gateWaitCall } = require('./run-call.cjs');
const { sinceCommit, unpushedFrom } = require('./run-since.cjs');

const { RunError } = lib;
const DEFAULT_CONFIG = `${lib.SPECS_DIR}/config.yaml`;

const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');

/**
 * The commit the lanes' diff starts from: `--since` when given. On the base branch the merge base
 * is HEAD, so the default is `origin/<base>`: a driver commits locally, waits on the lanes and
 * pushes after, so that diff is exactly its unpushed commits. Null on any other branch, whose
 * caller diffs against the merge base as a gate does.
 */
function lanesSince(tree, since, base) {
  if (since) return sinceCommit(tree, since);
  if (lib.currentBranch(tree) !== base) return null;
  const origin = unpushedFrom(tree, base);
  if (!origin) {
    throw new RunError(
      `on ${base} with no unpushed commit to diff (origin/${base} is missing or at HEAD): pass --since <the commit before your edit>`,
      'BAD_ARGS', 1
    );
  }
  return origin;
}

/** A directory's real path, or null when it is gone, as a removed worktree's is. */
function realDir(dir) {
  try {
    return fs.realpathSync(dir);
  } catch (error) {
    return null;
  }
}

/** The holder a red wait releases: `--holder`, else the first ticket whose tree is this tree, else none. */
function releaseHolder(tree, options, config) {
  if (options.holder) return options.holder;
  if (!mergeSlot(config)) return null;
  const here = realDir(tree);
  const mine = slot.queue(tree).tickets.find((ticket) => ticket.tree && realDir(ticket.tree) === here);
  return mine ? mine.holder : null;
}

/**
 * Start the configured lanes `changed` touched and write the gate job and its result; `restored`
 * leads the lines. The result is written before the job, so a wait never pairs the new job with
 * an earlier gate's result.
 */
function startLanesOnly(tree, options, config, restored, changed) {
  fs.mkdirSync(path.dirname(jobs.jobPaths(tree).job), { recursive: true });
  const started = new Date().toISOString();
  const laneStart = lanes.startLanes(tree, options, config, changed);
  const job = lanesOnlyJob(tree, options, config, started, laneStart.started);
  return {
    exit: 0,
    payload: { started: true, folded: false, ...job },
    out: [...restored, 'lanes only: no fold, no finalize command, no ticket', ...laneStart.out, `wait with: ${gateWaitCall(tree)}`],
  };
}

/** Write a gate job with no process and its lanes-only result, waiting on `names`; returns the job. */
function lanesOnlyJob(tree, options, config, started, names) {
  const paths = jobs.jobPaths(tree);
  writeJson(paths.result, { ok: true, lanes_only: true, results: [], hash: lib.codeTreeHash(tree) });
  fs.writeFileSync(paths.log, 'lanes only: no finalize command ran\n', 'utf8');
  const holder = releaseHolder(tree, options, config);
  const job = {
    config: options.config || DEFAULT_CONFIG, lanes_only: true, lanes: names, ...(holder ? { holder } : {}), started, tree,
    branch: lib.currentBranch(tree), job: paths.job, result: paths.result, log: paths.log,
  };
  writeJson(paths.job, job);
  return job;
}

/** Every refusal of a one-lane start: that lane still walks, or its superseded walk is not proven stopped, or the gate job reads another config. */
function refuseOneLane(tree, lane, gate, selected) {
  const live = jobs.readJson(jobs.jobPaths(tree, lane).job);
  if (jobs.alive(live)) {
    throw new RunError(`the ${lane} lane is already running for this tree (pid ${live.pid}, started ${live.started}); wait for it: ${gateWaitCall(tree)}`,
      'LANE_RUNNING');
  }
  const pending = jobs.readJson(pendingPath(tree));
  if (pending && (pending.lanes || []).some((entry) => entry.lane === lane)) {
    throw new RunError(`the ${lane} lane's superseded walk is not proven stopped: run ${gateSupersedeCall(tree)}`, 'SUPERSEDE_PENDING');
  }
  if (gate && path.resolve(tree, gate.config || DEFAULT_CONFIG) !== path.resolve(tree, selected)) {
    throw new RunError(`the started gate uses config ${gate.config}. Start the lane with the same --config file.`, 'GATE_CONFIG');
  }
}

/** `gate --detach --lane <name>`: start that one lane as its own job, and make the tree's gate job wait on it. */
function startOneLane(tree, options, config, restored) {
  const lane = lanes.laneOf(config, options.lane, options.config);
  const paths = jobs.jobPaths(tree);
  const gate = jobs.readJson(paths.job);
  refuseOneLane(tree, lane.name, gate, options.config || DEFAULT_CONFIG);
  const started = new Date().toISOString();
  const job = lanes.startLane(tree, options, lane, lib.git(tree, ['rev-parse', 'HEAD']));
  if (!gate) lanesOnlyJob(tree, options, config, started, [lane.name]);
  else if (!(gate.lanes || []).includes(lane.name)) atomicWrite(paths.job, `${JSON.stringify({ ...gate, lanes: [...(gate.lanes || []), lane.name] })}\n`);
  return {
    exit: 0,
    payload: { started: true, lane: lane.name, ...job },
    out: [...restored, `${lane.name} lane started pid ${job.pid}`, `log ${job.log}`, `wait with: ${gateWaitCall(tree)}`],
  };
}

module.exports = { lanesSince, startLanesOnly, startOneLane };
