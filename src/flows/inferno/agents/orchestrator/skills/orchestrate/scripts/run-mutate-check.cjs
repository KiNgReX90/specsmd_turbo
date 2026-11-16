'use strict';

/**
 * A mutant whose test is a plain check: a grep count, a probe line, a diff count. It prints no test
 * runner's summary, so its entry says `check: true` and the batch reads its exit code instead
 * (run-mutate-batch.cjs). The check runs once on the tree as it is, before any mutant is written,
 * and every entry of the batch that names the same check shares that run: a batch of N entries on
 * M distinct checks costs M unmutated runs beside its N mutant runs. Green there and red on the
 * mutant reads caught; green on the mutant reads caught no, a survivor like any other.
 *
 * A plain check has no summary to tell its own red from a run that never got that far, so every
 * other way to a non-zero exit reads no verdict. A check red on the tree as it is proves nothing
 * on the mutant, and its mutant never runs. A run a signal ended stops the batch; one whose exit
 * says a signal killed it, a failed build and a file that does not parse read no verdict
 * (run-mutate-verdict.cjs). And no wrapper can fail a check: it runs as written in the tree, under
 * bash, never through the host's `mutate.run`, never in a `mutate.session`, never queued on the
 * machine's build wrapper (run-lib.cjs runShell), and never on a Rust switch, so a Rust check runs
 * on a build of its own in place. A check written behind the wrapper's own words, or a spelling
 * `mutate.wrapped` marks, would go through it, so it reads no verdict. A host's `mutate.checks`
 * entry is another way: its check runs through the wrapper and reads caught on its finding line.
 */

const lib = require('./run-lib.cjs');
const { startsWrapped } = require('./run-mutate-host.cjs');

const CHECK_HOW = 'write check: true for a test that is a plain check, or leave it out';
/** Why a Rust check takes no switch: it runs as written, so it never reads one. */
const CHECK_READ = 'a check runs as written, in place';
const WRAPPED = 'a check runs as written in the tree, never through the host\'s wrapper, whose own failure would read as caught; ' +
  'write the bare check';
/** Exit codes of a run whose child a signal ended: SIGINT, SIGKILL, SIGTERM. */
const KILLED = new Set([130, 137, 143]);

/** The command `e` runs as: a check as written, any other test as `commandOf` places it; `refused` when a check would go through the wrapper. */
function placed(host, e, commandOf) {
  if (!e.check) return { ...e, command: commandOf(e.test) };
  return { ...e, command: e.test, refused: host.run && startsWrapped(host.run, e.test) ? WRAPPED : undefined };
}

/** What an unmutated run of a check says: null when it is green, else why its entries read no verdict. */
function unmutated(run) {
  if (run.code === 0) return null;
  if (KILLED.has(run.code)) return `the unmutated run of the check was killed (exit ${run.code} -> ${run.log})`;
  return `the check is red on the tree as it is (exit ${run.code} -> ${run.log}), so its red on the mutant would prove nothing`;
}

/**
 * Each distinct check of `entries` once, on the tree as it is, before any mutant is written: `{ base }`,
 * a map from each check to `unmutated`'s answer, or `{ stopped }` once a signal is held or ended a run.
 */
async function baselines(session, entries, signalled) {
  const base = new Map();
  for (const e of entries) {
    if (!e.check || e.refused || base.has(e.test)) continue;
    const signal = await signalled(session);
    if (signal) return { stopped: signal };
    const run = lib.runShell(e.test, session.tree, session.log(`unmutated-${base.size + 1}`), { wrap: false });
    if (run.signal) return { stopped: `the unmutated run of ${e.test} ended on ${run.signal}, so the batch stopped` };
    base.set(e.test, unmutated(run));
  }
  return { base };
}

/** Why a check entry reads no verdict before its mutant runs, or null. */
const unproven = (base, e) => (e.check ? e.refused || base.get(e.test) || null : null);

module.exports = { CHECK_HOW, CHECK_READ, baselines, placed, unproven };
