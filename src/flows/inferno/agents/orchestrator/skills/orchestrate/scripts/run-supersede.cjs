'use strict';

/**
 * `gate --detach --supersede`: a fix restarts the gate only after the tree's running lanes are
 * proven stopped. Every refusal comes before any signal. Then the pending file is written, every
 * live job's process group is recorded (a job is spawned detached, so its pid leads its group) and
 * gets SIGTERM, every group with a member left gets SIGKILL after a grace period, and each
 * superseded lane's host `stop` command proves its walk gone, because only the host knows where a
 * walk runs outside those groups. While the pending file
 * stands, a plain detach is refused, so a half-stopped walk is never raced by a new one.
 *
 * Nothing proven stops being proven: a killed lane mints no proof (only a lane that finished
 * writes one), and the gate that follows is today's gate on the fixed tree.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const jobs = require('./run-jobs.cjs');
const slot = require('./run-slot.cjs');
const { configuredLanes } = require('./run-lane-config.cjs');
const { mergeSlot } = require('./run-config-gates.cjs');
const { gateSupersedeCall, gateWaitCall } = require('./run-call.cjs');

const { RunError } = lib;
const PENDING = 'supersede-pending.json';
const GRACE_MS = 10000;
const POLL_MS = 100;

const pendingPath = (tree) => path.join(path.dirname(jobs.jobPaths(tree).job), PENDING);

/** The refusal of today's detach while a job of the tree runs. */
function running(tree, job) {
  return new RunError(
    `a ${job.lane ? `${job.lane} lane` : 'gate'} is already running for this tree (pid ${job.pid}, started ${job.started}); wait for it: ${gateWaitCall(tree)}`,
    'GATE_RUNNING'
  );
}

/** A plain detach: refused while a supersede is pending or a job of the tree runs. */
function refusePlain(tree) {
  if (fs.existsSync(pendingPath(tree))) {
    throw new RunError(`a superseded lane is not proven stopped: run ${gateSupersedeCall(tree)}`, 'SUPERSEDE_PENDING');
  }
  const live = jobs.everyJob(tree).find((job) => jobs.alive(job));
  if (live) throw running(tree, live);
}

/** The log a lane job walks into: its run file's when that run belongs to this job, else the job's log. */
function laneLog(tree, job) {
  const run = jobs.readJson(jobs.jobPaths(tree, job.lane).run);
  const own = run && typeof run.log === 'string' && Date.parse(run.started) >= Date.parse(job.started);
  return own ? run.log : job.log;
}

/** Every refusal over the tree's live jobs, then the lanes to supersede and every process group to stop. */
function targets(tree, config, live) {
  const laneJobs = live.filter((job) => job.lane);
  if (laneJobs.length === 0) {
    if (live.length > 0) throw running(tree, live[0]);
    throw new RunError('nothing to supersede: no lane of this tree is running', 'NOTHING_TO_SUPERSEDE');
  }
  if (live.some((job) => typeof job.head !== 'string' || !job.head)) {
    throw new RunError(`the running gate predates supersede; wait for it: ${gateWaitCall(tree)}`, 'GATE_RUNNING');
  }
  const configured = configuredLanes(config);
  const lanes = laneJobs.map((job) => {
    const lane = configured.find((entry) => entry.name === job.lane);
    if (!lane || !lane.stop) {
      throw new RunError(`cannot prove the ${job.lane} lane stopped: set verification.${job.lane}.stop`, 'NO_STOP');
    }
    return { lane, job };
  });
  const touched = lanes.some(({ lane, job }) =>
    lib.gitLines(tree, ['diff', '--name-only', job.head, 'HEAD'], { tolerate: true }).some((file) => lib.matchesAny(file, lane.scope)));
  if (!touched) throw new RunError(`the fix changes nothing a running lane proves; wait for it: ${gateWaitCall(tree)}`, 'NOT_SUPERSEDED');
  return {
    lanes: lanes.map(({ job }) => ({ lane: job.lane, pid: job.pid, log: laneLog(tree, job) })),
    groups: live.map((job) => job.pid),
  };
}

/**
 * Signal a recorded process group. Only groups whose leader a job file of this tree named, as a
 * live runner, when the pending file was written: Linux keeps that number allocated while any
 * member of the group lives, so the signal reaches no stranger.
 */
function signal(group, name) {
  try {
    process.kill(-group, name);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

/** Does any process of the group still live: signal 0 is refused with ESRCH once none is left. */
function hasMember(group) {
  try {
    process.kill(-group, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const recorded = (groups) => groups.filter((group) => Number.isSafeInteger(group) && group > 1 && group !== process.pid);

/** The recorded groups that still have a member, polled until none has or the grace period ends. */
function membersAfter(groups, ms) {
  const deadline = Date.now() + ms;
  let left = groups.filter(hasMember);
  while (left.length > 0 && Date.now() < deadline) {
    jobs.sleepSync(POLL_MS);
    left = left.filter(hasMember);
  }
  return left;
}

/**
 * SIGTERM every recorded group, then SIGKILL each group with a member left after the grace
 * period, which reaches a child that ignores SIGTERM after its runner died. Returns the groups
 * that still have a member after both.
 */
function stopGroups(groups) {
  const own = recorded(groups);
  for (const group of own.filter(hasMember)) signal(group, 'SIGTERM');
  const stubborn = membersAfter(own, GRACE_MS);
  for (const group of stubborn) signal(group, 'SIGKILL');
  return membersAfter(stubborn, GRACE_MS);
}

/** Run one lane's stop in the tree; returns null when it proved the walk gone, else its failing lines. */
function proveStopped(tree, lane, entry, selected) {
  // runShell inherits this one-shot process's environment.
  Object.assign(process.env, {
    INFERNO_LANE: entry.lane, INFERNO_LANE_PID: String(entry.pid), INFERNO_LANE_LOG: String(entry.log || ''),
    INFERNO_GATE_CONFIG: path.relative(tree, path.resolve(tree, selected || `${lib.SPECS_DIR}/config.yaml`)),
  });
  const log = path.join(path.dirname(pendingPath(tree)), `lane-${entry.lane}-stop-${lib.stamp()}.log`);
  const run = lib.runShell(lane.stop, tree, log);
  if (run.code === 0) return null;
  const said = lib.tail(log, 1)[0] || '(no output)';
  return [`the ${entry.lane} lane's stop exited ${run.code}: ${said.trim()}`, `log ${log}`];
}

/**
 * Supersede the tree's running lanes, or rerun the stop checks of a pending supersede. Returns
 * the lines that lead today's detach once every walk is proven stopped; throws otherwise.
 */
function supersede(tree, config, selected, { lanesOnly = false } = {}) {
  const file = pendingPath(tree);
  let record = jobs.readJson(file);
  if (!record) {
    record = { ...targets(tree, config, jobs.everyJob(tree).filter((job) => jobs.alive(job))), started: new Date().toISOString() };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  }
  const left = stopGroups(record.groups || []);
  const configured = configuredLanes(config);
  const failed = [];
  for (const entry of record.lanes || []) {
    const lane = configured.find((candidate) => candidate.name === entry.lane);
    if (!lane || !lane.stop) failed.push(`cannot prove the ${entry.lane} lane stopped: set verification.${entry.lane}.stop`);
    else failed.push(...(proveStopped(tree, lane, entry, selected) || []));
  }
  if (left.length > 0) failed.push(`still running after SIGKILL: process group ${left.join(', ')}`);
  if (failed.length > 0) {
    throw new RunError([...failed, `the supersede stays pending; once fixed: ${gateSupersedeCall(tree)}`].join('\n'), 'SUPERSEDE_UNPROVEN');
  }
  fs.rmSync(file, { force: true });
  // A lanes-only driver holds its own ticket and releases it itself.
  if (mergeSlot(config) && !lanesOnly) slot.release(tree);
  return record.lanes.map((entry) => `superseded ${entry.lane} lane pid ${entry.pid}: stopped, proven by its stop check`);
}

module.exports = { pendingPath, refusePlain, supersede };
