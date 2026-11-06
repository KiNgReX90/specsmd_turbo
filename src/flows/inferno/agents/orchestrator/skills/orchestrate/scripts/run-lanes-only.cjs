'use strict';

/**
 * `gate --detach --lanes-only`: a driver that commits straight onto the base, holding its own
 * merge slot ticket, starts only the lanes its diff touched. There is no fold, no finalize
 * command, no ticket and no intent review. The gate job it writes has no process, and its
 * result names `lanes_only`, so `gate --wait` waits on the lanes alone and nothing reads that
 * result as a finalize proof. Each lane mints and checks its proof exactly as a gate's lane does.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const jobs = require('./run-jobs.cjs');
const lanes = require('./run-lanes.cjs');
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
  const job = {
    config: options.config || `${lib.SPECS_DIR}/config.yaml`, lanes_only: true, lanes: laneStart.started, started, tree,
    branch: lib.currentBranch(tree), job: paths.job, result: paths.result, log: paths.log,
  };
  writeJson(paths.job, job);
  return {
    exit: 0,
    payload: { started: true, folded: false, ...job },
    out: [...restored, 'lanes only: no fold, no finalize command, no ticket', ...laneStart.out, `wait with: ${gateWaitCall(tree)}`],
  };
}

module.exports = { sinceCommit, startLanesOnly };
