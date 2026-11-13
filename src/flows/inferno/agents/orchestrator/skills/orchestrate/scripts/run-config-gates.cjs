'use strict';

/**
 * The config keys the gate, ship and verify-item read beside the lanes: `verification.merge_slot`, whether
 * a merge waits its turn in the slot across worktrees, `verification.ship_cleanup`, the host's
 * one shell command ship runs once a shipped worktree is gone, `verification.session`, the host
 * session the checks of one integrate or gate share (run-check-session.cjs), `verification.refused`,
 * the line the host's wrapper prints when it ran nothing (run-check-refused.cjs), `verification.run`
 * and `verification.wrapped`, the wrapper an item's own check runs through and the other spellings of
 * a check already wrapped (run-item-check.cjs, read as `mutate.run` is), and `review.outside`,
 * the globs whose folded changes keep the intent review current where the intent never touched the
 * file, such as a knowledge base the base branch syncs; `["**"]` binds the review to the files the
 * intent changed (run-intent-fold.cjs).
 *
 * It sits apart from run-lib.cjs, as run-lane-config.cjs does, so the config reader validates
 * and inherits both keys and every reader asks one place for their values. The YAML reader has
 * no booleans, so `merge_slot` is read as `true` or `false`, bare or quoted.
 */

const { RunError } = require('./run-error.cjs');
const { validateRefused } = require('./run-check-refused.cjs');
const { validateWrapper } = require('./run-mutate-host.cjs');

const isMap = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const BOOLEANS = [true, false, 'true', 'false'];

const globList = (value) => Array.isArray(value) && value.length > 0 &&
  value.every((glob) => typeof glob === 'string' && glob.trim().length > 0);
const command = (value) => typeof value === 'string' && value.trim().length > 0;

function validateGates(config, file) {
  const verification = isMap(config.verification) ? config.verification : {};
  if (verification.merge_slot !== undefined && !BOOLEANS.includes(verification.merge_slot)) {
    throw new RunError(
      `verification.merge_slot in ${file} must be true or false: "merge_slot: true" under verification:.`,
      'BAD_CONFIG'
    );
  }
  if (verification.ship_cleanup !== undefined && !command(verification.ship_cleanup)) {
    throw new RunError(
      `verification.ship_cleanup in ${file} must be one shell command: "ship_cleanup: \\"<command>\\"" under verification:.`,
      'BAD_CONFIG'
    );
  }
  // Required here: run-check-session.cjs loads run-lib.cjs, which loads this file.
  require('./run-check-session.cjs').validateChecks(verification, file);
  validateRefused(verification, file);
  validateWrapper(verification, 'verification', file);
  const review = isMap(config.review) ? config.review : {};
  if (review.outside !== undefined && !globList(review.outside)) {
    throw new RunError(
      `review.outside in ${file} must be a list of path globs, each one not empty: ` +
        '"outside: [\\"wiki/**\\"]" under review:.',
      'BAD_CONFIG'
    );
  }
}

/** A --config file inherits each verification key here and review.outside from the project config when it sets none. */
function inheritGates(config, defaults) {
  const keys = [['verification', 'merge_slot'], ['verification', 'ship_cleanup'], ['verification', 'session'], ['verification', 'refused'],
    ['verification', 'run'], ['verification', 'wrapped'], ['review', 'outside']];
  for (const [section, key] of keys) {
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

/** The host's ship cleanup command, trimmed, or null when the config sets none. */
function shipCleanup(config) {
  const value = isMap(config.verification) ? config.verification.ship_cleanup : undefined;
  return command(value) ? value.trim() : null;
}

/** The globs whose base-side changes keep the intent review current where the intent never touched the file, or none. */
function reviewOutside(config) {
  const value = isMap(config.review) ? config.review.outside : undefined;
  return globList(value) ? [...value] : [];
}

module.exports = { inheritGates, mergeSlot, reviewOutside, shipCleanup, validateGates };
