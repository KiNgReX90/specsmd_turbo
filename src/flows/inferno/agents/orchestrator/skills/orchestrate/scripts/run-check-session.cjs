'use strict';

/**
 * One host session for the checks of one `run.cjs integrate` or one gate run:
 * `verification.session`. A host whose checks go to another machine through a wrapper paid that
 * wrapper's sync of the tree and its wait in the machine's queue once per command, five times for
 * an integrate of five. With the key the commands it reaches run back to back in one session, so
 * the tree is synced once and the queue waited in once. Each command keeps its own proof, keyed
 * by its command string as without the key (run-proofs.cjs).
 *
 * The key holds the strings of `mutate.session` (run-host-session.cjs) less `send`, since no
 * check changes the tree it proves: `match`, `open`, `run` and `close`. A command `match` does not
 * reach at its start runs here as before, so a host's local checks stand beside its remote ones.
 * Each session command runs in the tree under bash with INFERNO_TREE, the tree, and
 * INFERNO_SESSION, an empty directory of this session beside the step's logs, outside the tree;
 * `run` also gets INFERNO_TEST, the command with the words `match` reached cut off, as the mutate
 * session's run gets its test, so one wrapper serves both keys. The output and exit code of `run`
 * are the check's. A check verify-item placed through `verification.run` gets the bare check as
 * INFERNO_TEST instead, as a mutate session of a wrapped test runs the bare test (run-item-check.cjs).
 *
 * The session opens at the first command that runs through it, so a scoped check skipped for
 * the landing, or one whose proof still holds, opens nothing, and a step that runs none of them
 * opens no session. A session that did not open fails every command that would have run in it,
 * with the open's exit and log in the command's own log, so none of them runs or mints a proof.
 * An open that printed the host's `verification.refused` line gives them no verdict instead, and
 * `checkRounds` runs them again in a fresh session.
 * The close runs once the open has started, on every exit of the step: after the last command,
 * after a gate's first red, and after an error. A close that failed is a line beside the result,
 * and the host closes that session by hand.
 *
 * Before the open starts, a record of the session's close goes into the branch's cache folder,
 * and it goes once the close has run. A kill between the two leaves the record, and the next
 * integrate, gate, or verify-item with `verification.run` (run-item-check.cjs) in the tree runs
 * that close first (`closeLeft`), unless the process that opened it still lives.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { alive, owner } = require('./run-mutate-journal.cjs');
const { call, ending, exported, reach, validateSessionKey } = require('./run-host-session.cjs');
const { refusalIn, refusedOf } = require('./run-check-refused.cjs');

const KEYS = ['match', 'open', 'run', 'close'];

/** Refuse a `verification.session` this runner cannot use, naming the file. */
function validateChecks(verification, file) {
  validateSessionKey(verification.session, 'verification.session', KEYS, file);
}

/** The folder of the records of the sessions open in this tree's branch. */
const recordsOf = (tree) => path.join(lib.cacheDir(tree), lib.currentBranch(tree), 'check-sessions');

/**
 * The session of one step whose logs go to `dir`, or null when the config sets no key. `shell`
 * runs one command as lib.runShell does, through the session when `match` reaches it, on
 * `options.test` when the caller placed the command around that check, else on what `match` left; `close`
 * closes the session when its open started and returns the lines to print beside the result.
 */
function checkSession(tree, config, dir) {
  const key = config.verification && config.verification.session;
  if (!key) return null;
  const match = new RegExp(key.match);
  const refused = refusedOf(config);
  const env = { INFERNO_TREE: tree, INFERNO_SESSION: null };
  const record = path.join(recordsOf(tree), `${lib.stamp()}-${process.pid}.json`);
  let opened = null;

  // A step's log folder is named by the second, so two steps in one second share it; the session's folder is its own.
  const open = () => {
    fs.mkdirSync(dir, { recursive: true });
    env.INFERNO_SESSION = fs.mkdtempSync(path.join(dir, 'session-'));
    fs.mkdirSync(path.dirname(record), { recursive: true });
    fs.writeFileSync(record, `${JSON.stringify({ ...owner(), close: key.close, dir: env.INFERNO_SESSION, tree })}\n`);
    return call(key.open, env, `${env.INFERNO_SESSION}-open.log`);
  };

  return {
    shell(command, cwd, log, options = {}) {
      const inner = reach(match, command);
      if (inner === null) return lib.runShell(command, cwd, log);
      if (!opened) opened = open();
      if (opened.code === 0) return lib.runShell(exported({ ...env, INFERNO_TEST: options.test === undefined ? inner : options.test }) + key.run, tree, log, { wrap: false });
      fs.mkdirSync(path.dirname(log), { recursive: true });
      // The open's refusal line goes into the check's own log, where runCommand reads it as no verdict.
      const line = refused ? refusalIn(refused, opened.log) : null;
      fs.appendFileSync(log, `the host session did not open (exit ${opened.code} -> ${opened.log}), so this check did not run\n${line ? `${line}\n` : ''}`);
      return { command, code: opened.code || 1, signal: null, seconds: 0, log, wrapped: false };
    },
    close() {
      if (!opened) return [];
      const closed = call(key.close, env, `${env.INFERNO_SESSION}-close.log`);
      fs.rmSync(record, { force: true });
      return closed.code === 0 ? [] : [`the close of the host session ${ending(closed)}; close it on the host`];
    },
  };
}

/**
 * Run `steps` with the shell of this step's session, or lib.runShell without a key. The session
 * closes on every exit; returns what `steps` returned and the lines the close left to print.
 */
function inSession(tree, config, dir, steps) {
  const session = checkSession(tree, config, dir);
  if (!session) return { value: steps(lib.runShell), notes: [] };
  let value;
  let notes = [];
  try {
    value = steps(session.shell);
  } finally {
    notes = session.close();
  }
  return { value, notes };
}

/**
 * Run the checks of one step with `plan`, and once more each one the host's wrapper ran nothing
 * for (`verification.refused`, run-check-refused.cjs), so integrate and the gate share one retry.
 * `plan(check)` runs the step's checks in order, each as `check(key, run)`: `run(shell)` runs it
 * and returns its result. While a check was refused on its only run, the session closes and
 * `plan` runs again in a fresh one: a check with a verdict, or refused twice, returns its last
 * result without running, and one refused once runs again. A check outside the session runs once
 * more the same way, and a check a round first reaches, such as the browser step after the others
 * passed, gets its own second run. Returns what the last `plan` returned, the lines every close
 * left, and the checks refused twice.
 */
function checkRounds(tree, config, dir, plan) {
  const done = new Map();
  const notes = [];
  const again = (entry) => entry.result.result === 'refused' && entry.runs < 2;
  const round = () => {
    const ran = inSession(tree, config, dir, (shell) => plan((key, run) => {
      const before = done.get(key);
      if (before && !again(before)) return before.result;
      const result = run(shell);
      done.set(key, { result, runs: before ? before.runs + 1 : 1 });
      return result;
    }));
    notes.push(...ran.notes);
    return ran.value;
  };
  let value = round();
  while ([...done.values()].some(again)) value = round();
  return { value, notes, refused: [...done.values()].map((entry) => entry.result).filter((result) => result.result === 'refused') };
}

/**
 * Close each session a killed integrate, gate or verify-item left open in this tree's branch, from
 * its record, and drop the record. A session whose owner still lives is its own. Returns what happened.
 */
function closeLeft(tree) {
  const dir = recordsOf(tree);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch (error) {
    return [];
  }
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let entry = null;
    try {
      entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      entry = null;
    }
    if (!entry || typeof entry.close !== 'string' || typeof entry.dir !== 'string') {
      fs.rmSync(file, { force: true });
      out.push(`dropped the unreadable host session record ${file}`);
      continue;
    }
    if (Number.isInteger(entry.pid) && entry.pid !== process.pid && alive(entry)) continue;
    const log = path.join(path.dirname(dir), `check-session-recover-${name.replace(/\.json$/, '')}-close.log`);
    const closed = call(entry.close, { INFERNO_TREE: tree, INFERNO_SESSION: entry.dir }, log);
    fs.rmSync(file, { force: true });
    out.push(closed.code === 0 ? 'closed the host session an interrupted check run left open'
      : `the close of the host session an interrupted check run left open ${ending(closed)}; close it on the host by hand`);
  }
  return out;
}

module.exports = { checkRounds, checkSession, closeLeft, inSession, validateChecks };
