'use strict';

/**
 * `verification.refused`: the line a host's wrapper prints when it ran nothing. A wrapper whose
 * machine did not answer, or whose session slot was gone, exits non-zero, and a check read only by
 * its exit was a failed check: integrate printed FAIL and sent the builder after a machine fault,
 * and the gate read a red. With the key, a check that exits non-zero with a last line the regex
 * matches, or that ran in a session whose open did so, is no verdict. It mints no proof
 * and runs once more in a fresh session (`checkRounds`, run-check-session.cjs); a second refusal
 * ends the step with its own exit (NO_VERDICT, run-exit.cjs) and the line `noVerdictLine` builds.
 * A non-zero exit without such a line is a failed check as before, and a host without the key
 * sees no change.
 *
 * A refusal is read only where a wrapper writes one: the run's last non-empty line, past blank
 * lines, carriage returns and colour codes, never a line before it, since a suite whose tests
 * print a refusal line as a fixture and then fail is a red. `verification.refused_exit`, the exit
 * code the wrapper ends a refusal with, narrows it to that exit; without it any non-zero exit counts.
 *
 * The regex is read per line, so `^` and `$` hold a line. One an empty line matches would read
 * every failed check as refused, so it is refused, as `mutate.wrapped` is (run-mutate-host.cjs).
 * A leaf: it loads no script that loads the config reader.
 */

const fs = require('fs');

const { RunError } = require('./run-error.cjs');

/** Refuse a `verification.refused` or `verification.refused_exit` this runner cannot use, naming the file. */
function validateRefused(verification, file) {
  validateRefusedExit(verification, file);
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

/** Refuse a `verification.refused_exit` that is no exit code, or that stands without `verification.refused`. */
function validateRefusedExit(verification, file) {
  const value = verification.refused_exit;
  if (value === undefined) return;
  const key = `verification.refused_exit in ${file}`;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > 255) {
    throw new RunError(`${key} must be an exit code from 1 to 255: "refused_exit: 75" under verification:.`, 'BAD_CONFIG');
  }
  if (verification.refused === undefined) {
    throw new RunError(`${key} needs verification.refused, the line the host's wrapper prints when it ran nothing.`, 'BAD_CONFIG');
  }
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

/**
 * The last line `log` holds from byte `from` on with more than blanks, its colour codes cut and a
 * carriage return read as a line's end, or '' when there is none, a line no refusal regex matches.
 */
function lastLine(log, from) {
  let text = '';
  try {
    text = fs.readFileSync(log).subarray(from).toString('utf8');
  } catch (error) {
    // A run that wrote no log printed no line.
  }
  return text.replace(/\x1b\[[0-9;]*m/g, '').split(/[\r\n]+/).reverse().find((line) => line.trim() !== '') || '';
}

/**
 * The refusal line a run that ended with `code` wrote to `log` from byte `from` on: its last
 * non-empty line, when the config names a refusal, the line matches it and `code` is the refusal
 * exit (any non-zero one without `refused_exit`); else null. Every reader of a refusal reads it here.
 */
function refusal(config, code, log, from) {
  const regex = refusedOf(config);
  if (!regex || code === 0) return null;
  const exit = config.verification.refused_exit;
  if (exit !== undefined && code !== Number(exit)) return null;
  const line = lastLine(log, from);
  return regex.test(line) ? line : null;
}

/**
 * Run `command` with `shell` (lib.runShell, or a host session's) and read whether the host's wrapper
 * refused it: `run` as the shell returned it, `from`, the byte of `log` this run's output starts at,
 * and `line`, its refusal line (`refusal`), null for a run with a verdict or without the key. `rest` goes to `shell` after the log. Integrate, the gate and verify-item read
 * a refusal only here.
 */
function readRun(config, shell, command, cwd, log, ...rest) {
  const from = logSize(log);
  const run = shell(command, cwd, log, ...rest);
  return { run, from, line: refusal(config, run.code, log, from) };
}

/** The last line of a step whose checks got no verdict twice: the machine fault, and the call that runs it again. */
function noVerdictLine(list, count, total, again) {
  return `${count} of ${total} ${list} check(s) got no verdict: the host's wrapper ran nothing, twice, ` +
    `a fault of the test machine and not of the code; run the step again: ${again}`;
}

module.exports = { logSize, noVerdictLine, readRun, refusal, validateRefused };
