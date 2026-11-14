'use strict';

/**
 * The lanes a host configures beside the finalize list: a short smoke run of the built app and
 * the suite on Windows. Each is `verification.<lane>: {command, scope}`. The gate starts a lane
 * whose scope the branch touched and waits for it, so a branch no longer merges red on a check
 * that used to run by hand.
 *
 * It sits apart from run-lib.cjs so the config reader and the job plumbing can both name the
 * lanes without requiring each other. A lane may also set `accept_check`, the host's own check
 * that an instrument red may be accepted, `stop`, `red_line`, a pattern, and `verdicts`, the file
 * where the lane writes which of its red tests it proved intermittent (run-lanes-intermittent.cjs).
 */

const { RunError } = require('./run-error.cjs');

const LANES = ['smoke', 'windows'];
/** The optional lane keys: the host's check before an accept, its stop command, the line pattern that marks a red, and its verdicts file. */
const COMMANDS = ['accept_check', 'stop'];
const OPTIONAL = [...COMMANDS, 'red_line', 'verdicts'];

const filled = (text) => typeof text === 'string' && text.trim().length > 0;

function compiles(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch (error) {
    return false;
  }
}

function validLane(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    filled(value.command) &&
    Array.isArray(value.scope) && value.scope.length > 0 &&
    value.scope.every((glob) => typeof glob === 'string' && glob.length > 0) &&
    COMMANDS.every((key) => value[key] === undefined || filled(value[key])) &&
    (value.red_line === undefined || (filled(value.red_line) && compiles(value.red_line))) &&
    (value.verdicts === undefined || filled(value.verdicts));
}

function validateLanes(verification, file) {
  for (const lane of LANES) {
    if (verification[lane] === undefined || validLane(verification[lane])) continue;
    throw new RunError(
      `verification.${lane} in ${file} must be a map with command, one shell command, and scope, a list of path globs, ` +
        "and may set accept_check and stop, each one shell command, red_line, a pattern, and verdicts, the path of the lane's verdicts file: " +
        `"${lane}:" then "command: <shell command>" and "scope: [\\"src/**\\"]" indented under it.`,
      'BAD_CONFIG'
    );
  }
}

/** A --config file inherits each lane the project config sets and it does not. */
function inheritLanes(config, defaults) {
  const from = defaults.verification;
  if (!from || typeof from !== 'object' || Array.isArray(from)) return;
  for (const lane of LANES) {
    if (from[lane] === undefined) continue;
    if (config.verification === undefined) config.verification = {};
    const own = config.verification;
    if (own && typeof own === 'object' && !Array.isArray(own) && own[lane] === undefined) own[lane] = from[lane];
  }
}

/** The configured lanes, in a fixed order, each with its name and each optional key it sets. */
function configuredLanes(config) {
  const verification = config.verification || {};
  return LANES.filter((lane) => verification[lane] !== undefined).map((lane) => {
    const own = verification[lane];
    const entry = { name: lane, command: own.command, scope: own.scope };
    for (const key of OPTIONAL) if (own[key] !== undefined) entry[key] = own[key];
    return entry;
  });
}

module.exports = { LANES, configuredLanes, inheritLanes, validateLanes };
