'use strict';

/**
 * A lane's product red the lane itself proved intermittent: every test it found red on the branch
 * was green on the base and green again on a second walk on the branch. The lane says so in the
 * file its `verdicts` key names, written during the run:
 *
 *   {"red": [{"name": "<test>", "base": "green", "again": "green"}]}
 *
 * one entry per test red on the branch, with its walk on the base and its second walk on the
 * branch. `run.cjs <lane> --accept-intermittent` names every red test of that file in one call,
 * one `--test` each, and records the accept beside the lane proof, bound like an instrument accept
 * to the proof's inputs and to the one run it accepted. A lane without the key has no such accept.
 *
 * The lasting record is the base branch: ship writes the accept into the ship commit as one
 * `exception: <lane> intermittent <json>` line, and every later accept and ship reads those lines
 * back from the base, so a later intent sees them however its cache and worktree were made. A
 * test accepted twice there is a race to fix on the host, so the next accept is refused until a
 * commit on the base carries `Fixes-intermittent: <test>`. A `Cases:` line is not that carrier: it
 * answers the tester case checks with ids split on spaces, so a test name would answer them.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const jobs = require('./run-jobs.cjs');
const slot = require('./run-slot.cjs');
const { atomicWrite } = require('./state-store.cjs');
const { mergeSlot } = require('./run-config-gates.cjs');
const { resolveBase } = require('./run-intents.cjs');
const { gateStartCall, gateWaitCall } = require('./run-call.cjs');

const { RunError } = lib;
const RECORD = '.intermittent';
/** The accepts of one test the base may already hold since its last fix; the next one is refused. */
const MAX_EARLIER = 2;
const EXCEPTION = /^exception: (\S+) intermittent (\{.*\})\s*$/;
const FIX = 'Fixes-intermittent:';
/** The verdicts file's shape, in the one line a lane without the key and a body without a red test print. */
const SHAPE = '{"red": [{"name": "<test>", "base": "green", "again": "green"}]}';

const filled = (text) => typeof text === 'string' && text.trim().length > 0;

/** Refuse a call that names no test, no reason or no signer, or names --accept beside it. */
function usage(name, options) {
  if (!options.accept && (options.tests || []).length > 0 && filled(options.reason) && filled(options.by)) return;
  throw new RunError(`usage: node run.cjs ${name} --accept-intermittent --test "<name>" [--test "<name>" ...] --reason "<why>" --by <who> ` +
    '[--tree <dir>] [--config <file>]', 'BAD_ARGS', 1);
}

/** The red tests a verdicts body lists when each was green on the base and on a second walk, else why it proves nothing. */
function intermittentTests(body) {
  const red = body && Array.isArray(body.red) ? body.red : [];
  if (red.length === 0) return { refusal: `no red test listed as ${SHAPE}` };
  if (red.some((entry) => !entry || !filled(entry.name))) return { refusal: 'a red test without a name' };
  const real = red.filter((entry) => entry.base !== 'green' || entry.again !== 'green');
  if (real.length > 0) {
    return { refusal: `not proven intermittent: ${real.map((entry) => `${entry.name} (base ${entry.base}, again ${entry.again})`).join('; ')}` };
  }
  return { tests: [...new Set(red.map((entry) => entry.name))], entries: red };
}

/**
 * What the lane's verdicts file proves for its last result `last` on the tree `proof` keys: the
 * red tests, or why it proves nothing. Only a product red of this tree counts, and only a file
 * written since that run started.
 */
function proven(tree, lane, last, proof) {
  if (!last || last.result !== 'product-red' || last.hash !== proof.hash) {
    return {
      code: 'NOTHING_TO_ACCEPT',
      refusal: `no product red of the ${lane.name} lane on this tree to accept: run ${gateStartCall(tree)}, then ${gateWaitCall(tree)}.`,
    };
  }
  if (!lane.verdicts) {
    return { code: 'NO_VERDICTS', refusal: `the ${lane.name} lane names no verdicts file, so its product red has no accept: set verification.${lane.name}.verdicts` };
  }
  const file = path.resolve(tree, lane.verdicts);
  let stat;
  let body;
  try {
    stat = fs.statSync(file);
    body = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { code: 'NOT_PROVEN', refusal: `no verdicts file the ${lane.name} lane wrote at ${file}: ${error.message}` };
  }
  if (!(stat.mtimeMs >= Date.parse(last.started))) {
    return { code: 'NOT_PROVEN', refusal: `the verdicts file ${file} is older than the lane's last run, started ${last.started}` };
  }
  const read = intermittentTests(body);
  return read.refusal ? { code: 'NOT_PROVEN', refusal: `${read.refusal} in ${file}` } : { ...read, file };
}

/**
 * The line a product red not proven intermittent ends on: for a lane without the key, how it gets
 * an accept; for one whose verdicts were refused, why.
 */
function unproven(lane, read) {
  if (!lane.verdicts) {
    return `an intermittent red can be accepted once the lane writes its red tests to the file verification.${lane.name}.verdicts names, ` +
      `as ${SHAPE}, one entry per red test with its walk on the base and its second walk on the branch`;
  }
  return `no intermittent accept: ${read.refusal}`;
}

/** The intermittent accept for exactly this proof's inputs and the run it accepted, or null. */
function readAccepted(tree, name, proof) {
  const record = jobs.readJson(`${proof.file}${RECORD}`);
  const latest = jobs.readJson(jobs.jobPaths(tree, name).result);
  // The record's file is keyed by the proof's inputs, so only the run it accepted is left to match.
  return record && latest && latest.run === record.run ? record : null;
}

function parsed(json) {
  try {
    const record = JSON.parse(json);
    return record && Array.isArray(record.tests) ? record : null;
  } catch (error) {
    return null;
  }
}

/** Each commit on the base, newest first, whose message carries an exception or a fix line, with those lines read. */
function baseLedger(tree, base) {
  const refs = [base, `origin/${base}`].filter((ref) => lib.git(tree, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { tolerate: true }));
  // A ledger that cannot be read refuses, so no earlier accept is ever skipped.
  if (refs.length === 0) throw new RunError(`no ${base} branch here to read the earlier intermittent accepts from`, 'NO_BASE');
  const raw = lib.git(tree, ['log', '--format=%H%x1f%h%x1f%cs%x1f%B%x1e', '-E', `--grep=^(exception: [^ ]+ intermittent |${FIX})`, ...refs]);
  return raw.split('\x1e').map((chunk) => chunk.replace(/^\n+/, '')).filter(Boolean).map((chunk) => {
    const [sha, short, date, body = ''] = chunk.split('\x1f');
    const lines = body.split('\n');
    return {
      sha, short, date,
      exceptions: lines.map((line) => EXCEPTION.exec(line)).filter(Boolean).map((match) => parsed(match[2])).filter(Boolean),
      fixes: lines.filter((line) => line.startsWith(FIX)).map((line) => line.slice(FIX.length).trim()),
    };
  });
}

/** The base's accepts of `test`, oldest first, in commits that no commit naming its fix comes after. */
function earlierAccepts(tree, ledger, test) {
  const fixes = ledger.filter((commit) => commit.fixes.includes(test)).map((commit) => commit.sha);
  const since = (commit) => fixes.every((fix) => lib.git(tree, ['merge-base', '--is-ancestor', commit.sha, fix], { tolerate: true }) === null);
  return ledger.filter(since).flatMap((commit) => commit.exceptions.filter((record) => record.tests.includes(test)).map((record) => ({ ...commit, record })))
    .reverse();
}

/**
 * The earlier accepts of `tests` on the base, as lines to print; refused when one of them reached
 * the limit, since two accepts of one test make its race a defect to fix on the host.
 */
function repeats(tree, base, tests) {
  const ledger = baseLedger(tree, base);
  const earlier = tests.map((test) => ({ test, accepts: earlierAccepts(tree, ledger, test) }));
  const over = earlier.filter((entry) => entry.accepts.length >= MAX_EARLIER);
  if (over.length > 0) {
    throw new RunError(over.map(({ test, accepts }) =>
      `refused: ${test} was accepted as intermittent ${accepts.length} times on ${base} since a commit there last named its fix: ` +
      `${accepts.map((entry) => `${entry.short} ${entry.date} by ${entry.record.by}`).join(', ')}. Its race is a defect to fix on the host: ` +
      `land the fix on ${base} with the line "${FIX} ${test}" in its message, then accept again.`).join('\n'), 'INTERMITTENT_LIMIT');
  }
  return earlier.flatMap(({ test, accepts }) =>
    accepts.map((entry) => `earlier intermittent accept of ${test}: ${entry.short} ${entry.date} by ${entry.record.by}: ${entry.record.reason}`));
}

/** `run.cjs <lane> --accept-intermittent`: bound that lane's product red on this tree, once its verdicts file proves every red test intermittent. */
function accept(tree, config, lane, proof, options) {
  const tests = [...new Set(options.tests)];
  const last = jobs.readJson(jobs.jobPaths(tree, lane.name).result);
  const read = proven(tree, lane, last, proof);
  if (read.refusal) throw new RunError(read.refusal, read.code);
  const unknown = tests.filter((test) => !read.tests.includes(test));
  if (unknown.length > 0) throw new RunError(`the verdicts file holds no red test ${unknown.join('; ')}: name only the tests ${read.file} lists`, 'NOT_PROVEN');
  const unnamed = read.tests.filter((test) => !tests.includes(test));
  if (unnamed.length > 0) throw new RunError(`no --test names the red test ${unnamed.join('; ')}: one accept names every red test of the run`, 'NOT_PROVEN');
  // The configured base, as ship's merge lands there; no --base reads another branch's ledger.
  const earlier = repeats(tree, resolveBase(config, null, tree), tests);
  const { file, ...identity } = proof;
  const record = {
    ...identity, tests, reason: options.reason.trim(), by: options.by.trim(), run: last.run, log: last.log, verdicts: read.file, named: lane.verdicts,
    entries: read.entries,
    stamp: new Date().toISOString(), branch: lib.currentBranch(tree),
  };
  atomicWrite(`${file}${RECORD}`, `${JSON.stringify(record)}\n`);
  if (mergeSlot(config)) slot.renew(tree);
  return {
    exit: 0,
    payload: { accepted: true, lane: lane.name, tests, hash: proof.hash, earlier },
    out: [...tests.map((test) => `accepted ${lane.name} product red as intermittent for this tree: ${test}`), ...earlier, `wait with: ${gateWaitCall(tree)}`],
  };
}

/**
 * The ship commit's line for one lane's intermittent accept. A repository may be public, so it
 * names no path of the machine that ran the lane: the log by its file name, the verdicts file as
 * the config names it relative to the tree, or by its file name when the config names it absolute.
 */
function exceptionLine(lane, record) {
  const { tests, reason, by, run, named } = record;
  const verdicts = path.isAbsolute(named) ? path.basename(named) : named;
  return `exception: ${lane} intermittent ${JSON.stringify({ tests, reason, by, run, log: path.basename(record.log), verdicts })}`;
}

/** The exception lines a ship commit carries for `held`, each lane's accept refused once the base holds its limit. */
function shipExceptions(primary, base, held) {
  return held.map(({ lane, record }) => {
    repeats(primary, base, record.tests);
    return exceptionLine(lane, record);
  });
}

module.exports = { SHAPE, accept, intermittentTests, proven, readAccepted, repeats, shipExceptions, unproven, usage };
