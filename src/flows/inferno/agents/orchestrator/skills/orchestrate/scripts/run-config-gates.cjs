'use strict';

/**
 * Two config keys the gate reads beside the lanes: `verification.merge_slot`, whether a merge
 * waits its turn in the slot across worktrees, and `review.outside`, the globs of a knowledge
 * base the base branch syncs, whose folded changes keep the intent review current.
 *
 * It sits apart from run-lib.cjs, as run-lane-config.cjs does, so the config reader validates
 * and inherits both keys and every reader asks one place for their values. The YAML reader has
 * no booleans, so `merge_slot` is read as `true` or `false`, bare or quoted.
 */

const { RunError } = require('./run-error.cjs');

const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const BOOLEANS = [true, false, 'true', 'false'];

const globList = (value) => Array.isArray(value) && value.length > 0 &&
  value.every((glob) => typeof glob === 'string' && glob.trim().length > 0);

function validateGates(config, file) {
  const verification = isMap(config.verification) ? config.verification : {};
  if (verification.merge_slot !== undefined && !BOOLEANS.includes(verification.merge_slot)) {
    throw new RunError(
      `verification.merge_slot in ${file} must be true or false: "merge_slot: true" under verification:.`,
      'BAD_CONFIG'
    );
  }
  const review = isMap(config.review) ? config.review : {};
  if (review.outside !== undefined && !globList(review.outside)) {
    throw new RunError(
      `review.outside in ${file} must be a list of path globs, each one not empty: ` +
        '"outside: [\\"wiki/**\\"]" under review:.',
      'BAD_CONFIG'
    );
  }
}

/** A --config file inherits merge_slot and review.outside from the project config when it sets neither. */
function inheritGates(config, defaults) {
  for (const [section, key] of [['verification', 'merge_slot'], ['review', 'outside']]) {
    const from = defaults[section];
    if (!isMap(from) || from[key] === undefined) continue;
    if (config[section] === undefined) config[section] = {};
    const own = config[section];
    if (isMap(own) && own[key] === undefined) own[key] = from[key];
  }
}

/** True only when the config turns the merge slot on. */
function mergeSlot(config) {
  const value = isMap(config.verification) ? config.verification.merge_slot : undefined;
  return value === true || value === 'true';
}

/** The globs whose base-side changes keep the intent review current, or none. */
function reviewOutside(config) {
  const value = isMap(config.review) ? config.review.outside : undefined;
  return globList(value) ? [...value] : [];
}

module.exports = { inheritGates, mergeSlot, reviewOutside, validateGates };
