'use strict';

/**
 * `verification.refused`: the line a host's wrapper prints when it ran nothing. A wrapper whose
 * machine did not answer, or whose session slot was gone, exits non-zero, and a check read only by
 * its exit was a failed check: integrate printed FAIL and sent the builder after a machine fault,
 * and the gate read a red. With the key, a check that exits non-zero with a line the regex matches
 * in its own output, or that ran in a session whose open did so, is no verdict. It mints no proof
 * and runs once more in a fresh session (`checkRounds`, run-check-session.cjs); a second refusal
 * ends the step with its own exit (NO_VERDICT, run-exit.cjs) and the line `noVerdictLine` builds.
 * A non-zero exit without such a line is a failed check as before, and a host without the key
 * sees no change.
 *
 * The regex is read per line, so `^` and `$` hold a line. One an empty line matches would read
 * every failed check as refused, so it is refused, as `mutate.wrapped` is (run-mutate-host.cjs).
 * A leaf: it loads no script that loads the config reader.
 */

const fs = require('fs');

const { RunError } = require('./run-error.cjs');

/** Refuse a `verification.refused` this runner cannot use, naming the file. */
function validateRefused(verification, file) {
  const value = verification.refused;
  if (value === undefined) return;
  const bad = (what) => new RunError(`verification.refused in ${file} must be ${what}.`, 'BAD_CONFIG');
  if (typeof value !== 'string' || value.trim() === '') throw bad('a non-empty regex');
  let regex;
  try {
    regex = new RegExp(value);
  } catch (error) {
    throw bad(`a regex (${error.message})`);
  }
  if (regex.test('')) throw bad('a regex that an empty line does not match, or every failed check reads as refused');
}

/** The refusal regex a config names, or null without the key. */
function refusedOf(config) {
  const value = config.verification && config.verification.refused;
  return typeof value === 'string' ? new RegExp(value) : null;
}

/** The bytes `log` holds now, so a later read takes only what one run wrote after it. */
function logSize(log) {
  try {
    return fs.statSync(log).size;
  } catch (error) {
    return 0;
  }
}

/** The first line of `log` from byte `from` on that `regex` matches, or null. */
function refusalIn(regex, log, from = 0) {
  let text;
  try {
    text = fs.readFileSync(log).subarray(from).toString('utf8');
  } catch (error) {
    return null;
  }
  return text.split('\n').find((line) => regex.test(line)) || null;
}

/** The last line of a step whose checks got no verdict twice: the machine fault, and the call that runs it again. */
function noVerdictLine(list, count, total, again) {
  return `${count} of ${total} ${list} check(s) got no verdict: the host's wrapper ran nothing, twice, ` +
    `a fault of the test machine and not of the code; run the step again: ${again}`;
}

module.exports = { logSize, noVerdictLine, refusalIn, refusedOf, validateRefused };
