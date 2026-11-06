'use strict';

/**
 * `gate --detach --lanes-only`: a driver that commits straight onto the base, holding its own
 * merge slot ticket, starts only the lanes its diff touched. There is no fold, no finalize
 * command, no ticket and no intent review. The gate job it writes has no process, and its
 * result names `lanes_only`, so `gate --wait` waits on the lanes alone and nothing reads that
 * result as a finalize proof. Each lane mints and checks its proof exactly as a gate's lane does.
 *
 * The job names the ticket a red wait releases: `--holder`, else the head ticket under the merge
 * slot, since the driver holding the head is the one that started the lanes.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const jobs = require('./run-jobs.cjs');
const lanes = require('./run-lanes.cjs');
const slot = require('./run-slot.cjs');
const { mergeSlot } = require('./run-config-gates.cjs');
const { gateWaitCall } = require('./run-call.cjs');

const { RunError } = lib;

const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');

/** The commit `since` names, refused when it names none, so a typo never skips every lane. */
function sinceCommit(tree, since) {
  const sha = lib.git(tree, ['rev-parse', '--verify', '--quiet', `${since}^{commit}`], { tolerate: true });
  if (!sha) throw new RunError(`--since ${since} names no commit in ${tree}`, 'BAD_REF');
  return sha;
}

/**
 * The commit the lanes' diff starts from: `--since` when given. On the base branch the merge base
 * is HEAD, so the default is `origin/<base>`: a driver commits locally, waits on the lanes and
 * pushes after, so that diff is exactly its unpushed commits. Null on any other branch, whose
 * caller diffs against the merge base as a gate does.
 */
function lanesSince(tree, since, base) {
  if (since) return sinceCommit(tree, since);
  if (lib.currentBranch(tree) !== base) return null;
  const origin = lib.git(tree, ['rev-parse', '--verify', '--quiet', `origin/${base}^{commit}`], { tolerate: true });
  if (!origin || origin === lib.git(tree, ['rev-parse', 'HEAD'])) {
    throw new RunError(
      `on ${base} with no unpushed commit to diff (origin/${base} is missing or at HEAD): pass --since <the commit before your edit>`,
      'BAD_ARGS', 1
    );
  }
  return origin;
}

/** The holder a red wait releases: `--holder`, else the head ticket (never a worktree running without one), else none. */
function releaseHolder(tree, options, config) {
  if (options.holder) return options.holder;
  if (!mergeSlot(config)) return null;
  const [head] = slot.queue(tree).tickets;
  return head ? head.holder : null;
}

/**
 * Start the configured lanes `changed` touched and write the gate job and its result; `restored`
 * leads the lines. The result is written before the job, so a wait never pairs the new job with
 * an earlier gate's result.
 */
function startLanesOnly(tree, options, config, restored, changed) {
  const paths = jobs.jobPaths(tree);
  fs.mkdirSync(path.dirname(paths.job), { recursive: true });
  const started = new Date().toISOString();
  const laneStart = lanes.startLanes(tree, options, config, changed);
  writeJson(paths.result, { ok: true, lanes_only: true, results: [], hash: lib.codeTreeHash(tree) });
  fs.writeFileSync(paths.log, 'lanes only: no finalize command ran\n', 'utf8');
  const holder = releaseHolder(tree, options, config);
  const job = {
    config: options.config || `${lib.SPECS_DIR}/config.yaml`, lanes_only: true, lanes: laneStart.started, ...(holder ? { holder } : {}), started, tree,
    branch: lib.currentBranch(tree), job: paths.job, result: paths.result, log: paths.log,
  };
  writeJson(paths.job, job);
  return {
    exit: 0,
    payload: { started: true, folded: false, ...job },
    out: [...restored, 'lanes only: no fold, no finalize command, no ticket', ...laneStart.out, `wait with: ${gateWaitCall(tree)}`],
  };
}

module.exports = { lanesSince, startLanesOnly };
