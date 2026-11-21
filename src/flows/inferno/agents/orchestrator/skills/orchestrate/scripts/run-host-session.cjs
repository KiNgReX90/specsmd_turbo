'use strict';

/**
 * What the two host sessions share. A host whose tests run through a wrapper that first syncs the
 * tree to another machine and waits there for a slot can hand the flow the wrapper's session
 * commands, so the tree is synced once and the slot taken once: `mutate.session` for the mutants
 * of one batch (run-mutate-session.cjs) and `verification.session` for the checks of one
 * integrate or one gate run (run-check-session.cjs).
 *
 * Both keys are maps of non-empty strings. `match` is a regex that marks a command as going
 * through the wrapper when it matches at the command's start; the rest of the command is what the
 * session runs. Every session command runs in the tree under bash, with its variables exported
 * first, and its output in its own log.
 *
 * It requires run-lib.cjs, so the config reader loads it when it validates, never at its own load.
 */

const { RunError } = require('./run-error.cjs');
const lib = require('./run-lib.cjs');
const { quote } = require('./run-mutate-host.cjs');

/** The exit codes a shell gives when a signal ended its child. */
const KILLED = { 130: 'SIGINT', 137: 'SIGKILL', 143: 'SIGTERM' };

/** Refuse a session key at `at` that is not a map of exactly `keys`, each a non-empty string, with `match` a regex. */
function validateSessionKey(session, at, keys, file) {
  if (session === undefined) return;
  const bad = (key, what) => new RunError(`${key} in ${file} must be ${what}.`, 'BAD_CONFIG');
  if (!session || typeof session !== 'object' || Array.isArray(session)) throw bad(at, `a map of ${keys.join(', ')}`);
  const unknown = Object.keys(session).filter((key) => !keys.includes(key));
  if (unknown.length > 0) throw bad(at, `a map of ${keys.join(', ')} only, not ${unknown.join(', ')}`);
  for (const key of keys) {
    if (typeof session[key] !== 'string' || session[key].trim() === '') throw bad(`${at}.${key}`, 'a non-empty string');
  }
  try {
    new RegExp(session.match);
  } catch (error) {
    throw bad(`${at}.match`, `a regex (${error.message})`);
  }
}

/** The rest of `command` after `match` reached it at its start, or null when it does not. */
function reach(match, command) {
  const reached = match.exec(command);
  return reached && reached.index === 0 ? command.slice(reached[0].length) : null;
}

const exported = (env) => `export ${Object.entries(env).map(([key, value]) => `${key}=${quote(value)}`).join(' ')}; `;

/** Run one session command in the tree; `signal` names the signal that ended it, also when a shell reports it killed. */
function call(command, env, log) {
  const run = lib.runShell(exported(env) + command, env.INFERNO_TREE, log, { wrap: false });
  return { code: run.code, log: run.log, signal: run.signal || KILLED[run.code] || null, seconds: run.seconds };
}

/** How a session command that did not exit 0 ended, for a line. */
const ending = (run) => (run.signal ? `ended on ${run.signal}` : `failed (exit ${run.code} -> ${run.log})`);

module.exports = { KILLED, call, ending, exported, reach, validateSessionKey };
