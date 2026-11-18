'use strict';

/**
 * `run.cjs review ... --detach` and `review --wait`: a review's record as a job of its own, the
 * way the gate runs.
 *
 * The record runs the review's mutants before it writes anything, and on a cold machine that
 * batch outlives the ten-minute cap a host puts on one tool call: the call is cut, the batch puts
 * every file back and closes its session, and its run is lost. So a record may start as its own
 * detached process through the gate's job runner (run-jobs.cjs), and `--wait` blocks on it under
 * the cap: 4 while it runs, then the exit code, the lines and the payload the record called in the
 * foreground would have given, a refusal on stderr as the call itself prints it. A job that ended
 * without a result did not finish: the wait says so, puts back what it left, and prints the call
 * that starts it again. The record called in the foreground is untouched.
 *
 * The batch changes the tree's files in place, and a caller blocked on the record started nothing
 * beside it. A caller of a job does, so while a record job runs it keeps out of its tree every
 * call that would race it. A second record, of any item or of the intent, would meet the batch's
 * journal and leave its own mutants owed. verify-item and integrate run checks that may read a
 * planted mutant, and integrate's own guard sees a batch only while its journal is open. The gate
 * was refused by the record's pending review file all along; it now names the wait. A dispatch
 * and a commit of another item's own files stay free: neither runs a check, and neither writes a
 * file the batch breaks or the record commits.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const jobs = require('./run-jobs.cjs');
const { review } = require('./run-review.cjs');
const { reviewIntent } = require('./run-intent-review.cjs');
const { recoverInterrupted } = require('./run-mutate.cjs');
const { TransitionError } = require('./state-transition.cjs');
const { recordStartCall, recordWaitCall } = require('./run-call.cjs');

const { RunError } = lib;

/** The flags of the call that started a record that its job runs with, as given. */
const CARRIED = ['--tree', '--item', '--reviewer', '--quality-reviewer', '--rerun', '--intent', '--config'];

/** The calls a running record keeps out of its tree, beside every other call that records. */
const KEPT_OUT = new Set(['verify-item', 'integrate', 'gate']);

const treeOf = (options) => options.tree || lib.repoRoot(options.cwd);

const named = (id) => (id ? `item ${id}` : 'the intent review');

/** The job files of the record of item `id`, or of the intent review without one, beside the gate's. */
function recordPaths(tree, id) {
  const stem = path.join(path.dirname(jobs.jobPaths(tree).job), id ? `review-item-${id}-job` : 'review-intent-job');
  return { job: `${stem}.json`, result: `${stem}.result.json`, log: `${stem}.log` };
}

/** The record job running in the tree, other than this process, or null. */
function running(tree) {
  const dir = path.dirname(jobs.jobPaths(tree).job);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => /^review-.+-job\.json$/.test(name)) : [];
  return files.map((name) => jobs.readJson(path.join(dir, name))).find((job) => jobs.alive(job) && job.pid !== process.pid) || null;
}

/** Refuse, with the wait on it, a call that would race the record job running in `tree`. */
function refuseRacing(tree) {
  const job = running(tree);
  if (!job) return;
  throw new RunError(`a record of ${named(job.item)} is running in this tree (pid ${job.pid}, started ${job.started}); ` +
    `wait for it: ${recordWaitCall(tree, job.item)}`, 'RECORD_RUNNING');
}

/** run.cjs refuses each call a record job keeps out of its tree before it starts; a --wait only waits. */
function keepOut(command, options) {
  if (KEPT_OUT.has(command) && !options.wait) refuseRacing(treeOf(options));
}

const foreground = (options) => (options.item ? review(options) : reviewIntent(options));

/** Start the record as its own process, with the flags it was called with; it writes its own result. */
function start(options) {
  const tree = treeOf(options);
  const id = options.item;
  const paths = recordPaths(tree, id);
  const carried = CARRIED.flatMap((flag) => {
    const value = options[flag.slice(2).replace(/-/g, '_')];
    return value ? [flag, value] : [];
  });
  const job = jobs.detach(tree, ['review', ...carried, '--job'], paths, { item: id, quality: Boolean(options.quality_reviewer) });
  return {
    exit: 0,
    payload: job,
    out: [`record of ${named(id)} started pid ${job.pid}`, `log ${paths.log}`, `result ${paths.result}`, `wait with: ${recordWaitCall(tree, id)}`],
  };
}

/** What a job prints: one JSON line, and the same JSON as its payload. */
const jobResult = (record) => ({ payload: record, out: [JSON.stringify(record)] });

/**
 * The job's own run: the record as the call runs it, or its refusal, as one JSON line on its
 * stdout. A crash prints none, so the wait reads a job that did not finish and points at its log.
 */
async function asJob(options) {
  try {
    refuseRacing(treeOf(options));
    const { exit, payload, out } = await foreground(options);
    return jobResult({ exit, payload, out });
  } catch (error) {
    if (!(error instanceof RunError) && !(error instanceof TransitionError)) throw error;
    return jobResult({ refused: { code: error.code, message: error.message, exit: error.exit } });
  }
}

/** How a record job that is no longer running ended: as the record did, or without a result. */
function ended(tree, job) {
  const record = jobs.readJson(job.result);
  if (record && record.refused) throw new RunError(record.refused.message, record.refused.code, record.refused.exit);
  if (record) return { exit: record.exit, payload: record.payload, out: record.out };
  // A job killed outright left its mutant and its session to the next step that reads the tree: this is that step.
  const restored = recoverInterrupted(tree);
  return {
    exit: 2,
    payload: { ok: false, item: job.item, died: true },
    out: [`record of ${named(job.item)} ended without a result, so it did not finish: pid ${job.pid} -> ${job.log}`, ...lib.tail(job.log, 5),
      ...restored, `start it again with: ${recordStartCall(tree, job.item, job.quality)}`],
  };
}

/** Block on the record job under the cap, then end as it ended; 4 while it still runs at the deadline. */
function wait(options) {
  const tree = treeOf(options);
  const id = options.item;
  const minutes = Number(options.minutes || 9);
  if (!(minutes >= 0)) throw new RunError(`review takes --minutes as a number of minutes, not ${options.minutes}`, 'BAD_ARGS', 1);
  const job = jobs.readJson(recordPaths(tree, id).job);
  if (!job) {
    throw new RunError(`no record of ${named(id)} has been started in this tree; start one with ${recordStartCall(tree, id)}`, 'NO_RECORD_JOB');
  }
  const deadline = Date.now() + minutes * 60000;
  while (jobs.alive(job)) {
    if (Date.now() >= deadline) {
      const elapsed = Math.round((Date.now() - Date.parse(job.started)) / 60000);
      return {
        exit: 4,
        payload: { running: true, ...job, elapsed_minutes: elapsed },
        out: [`record of ${named(id)} still running pid ${job.pid}, ${elapsed} min so far`, `log ${job.log}`, `call ${recordWaitCall(tree, id)} again`],
      };
    }
    jobs.sleepSync(500);
  }
  return ended(tree, job);
}

/** `run.cjs review`: misuse refused first, then the job's own run, the wait, the start, or the call as it always ran. */
function reviewCall(options) {
  if (options.detach && options.wait) throw new RunError('review takes --detach or --wait, not both', 'BAD_ARGS', 1);
  if (options.wait && (options.reviewer || options.quality_reviewer || options.rerun)) {
    throw new RunError('review takes --wait without --reviewer, --quality-reviewer or --rerun: it waits on the record --detach started', 'BAD_ARGS', 1);
  }
  if (options.detach && !options.reviewer && !options.rerun) {
    throw new RunError('review takes --detach only on a call that records: with --reviewer, or the intent\'s --rerun survivors', 'BAD_ARGS', 1);
  }
  if (options.job) return asJob(options);
  if (options.wait) return wait(options);
  if (options.reviewer || options.rerun) refuseRacing(treeOf(options));
  if (options.detach) return start(options);
  return foreground(options);
}

module.exports = { keepOut, reviewCall };
