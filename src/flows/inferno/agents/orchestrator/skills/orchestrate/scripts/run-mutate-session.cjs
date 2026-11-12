'use strict';

/**
 * A host session for `run.cjs mutate --batch`. A host whose tests run through a wrapper that
 * first syncs the tree to another machine and waits there for a slot pays that sync and that wait
 * once per mutant. With `mutate.session` the mutants that share a test command share one session
 * of the wrapper, so the tree is synced once and the slot is taken once.
 *
 * The key holds five strings. `match` is a regex that marks a test command as going through the
 * wrapper when it matches at the command's start; the rest of the command is the test the session
 * runs. `open` copies the tree as it stands into a fresh session and takes the slot. `send` puts
 * one path of the tree into the session as it stands now, and deletes it there when it is gone.
 * `run` runs the test in the session, with the test's output and exit code. `close` gives the
 * session and the slot up, and exits 0 when nothing is open. Each runs in the tree under bash
 * with INFERNO_TREE, the tree, and INFERNO_SESSION, an empty directory of this session beside the
 * batch's logs, outside the tree, for the host's own state. `send` also gets INFERNO_FILE, the path
 * relative to the tree, and `run` gets INFERNO_TEST, the test.
 *
 * Only the entries no Rust build shares go into a session; one whose test command `match` does not
 * reach runs in place as before. `match` reads the command as `mutate.run` wrapped it
 * (run-mutate-host.cjs), and a session of a test the key wrapped runs the test as written. After those, with every file and seal back, each test command
 * opens a session. Per mutant the line is written (and resealed when the host seals the file), the
 * file and every path the reseal changed are sent, the test runs, the file and the seal go back,
 * and those paths are sent again. A session that did not open, and a send of the mutant that
 * failed, read no verdict. A send back that failed may leave the mutant in the session, so its
 * group stops there and the rest of it reads no verdict. A session command that a signal ended,
 * or that a shell reports killed, stops the batch, as a test that a signal ended does. The close
 * runs once the open has started, on every exit.
 *
 * The journal holds the open session's close (run-mutate-journal.cjs), so the next step that
 * reads the tree closes a session a killed batch left open (`closeLeft`). A close that failed says
 * so, and the host closes it by hand. A session left holding a mutant never reaches a verdict,
 * since every open copies the whole tree again.
 */

const path = require('path');
const fs = require('fs');

const lib = require('./run-lib.cjs');
const { reseal, unseal } = require('./run-mutate-seal.cjs');
const { readLog, verdictOf } = require('./run-mutate-verdict.cjs');
const { quote } = require('./run-mutate-host.cjs');

const { RunError } = lib;
const KEYS = ['match', 'open', 'send', 'run', 'close'];
/** The exit codes a shell gives when a signal ended its child. */
const KILLED = { 130: 'SIGINT', 137: 'SIGKILL', 143: 'SIGTERM' };
const UNSEALED = 'the batch stopped, since a seal could not be put back';

/** Refuse a `mutate.session` this runner cannot use, naming the file. */
function validateSession(mutate, file) {
  const session = mutate.session;
  if (session === undefined) return;
  const bad = (key, what) => new RunError(`${key} in ${file} must be ${what}.`, 'BAD_CONFIG');
  if (!session || typeof session !== 'object' || Array.isArray(session)) throw bad('mutate.session', `a map of ${KEYS.join(', ')}`);
  const unknown = Object.keys(session).filter((key) => !KEYS.includes(key));
  if (unknown.length > 0) throw bad('mutate.session', `a map of ${KEYS.join(', ')} only, not ${unknown.join(', ')}`);
  for (const key of KEYS) {
    if (typeof session[key] !== 'string' || session[key].trim() === '') throw bad(`mutate.session.${key}`, 'a non-empty string');
  }
  try {
    new RegExp(session.match);
  } catch (error) {
    throw bad('mutate.session.match', `a regex (${error.message})`);
  }
}

/** The session a config names, with its regex compiled, or null. */
function sessionOf(config) {
  const session = config.mutate && config.mutate.session;
  return session ? { ...session, match: new RegExp(session.match) } : null;
}

/**
 * The groups of the entries `hosted` reaches, one per test command in the order given, each with
 * the test its session runs. An entry's `command` is its test as the host's wrapper runs it, the
 * test itself when no `mutate.run` wrapped it. Each grouped entry's plan becomes `session`.
 */
function sessionGroups(hosted, entries, plans) {
  const groups = new Map();
  for (const e of hosted ? entries.filter((item) => !item.rust) : []) {
    const command = e.command || e.test;
    const reached = hosted.match.exec(command);
    if (!reached || reached.index !== 0) continue;
    const inner = command === e.test ? command.slice(reached[0].length) : e.test;
    if (!groups.has(e.test)) groups.set(e.test, { test: e.test, inner, entries: [] });
    groups.get(e.test).entries.push(e);
    plans.set(e.k, { form: 'session' });
  }
  return [...groups.values()];
}

/** The verdict of a mistake whose reseal did not exit 0: none, with the signal that stops the batch if one ended it. */
const unsealedVerdict = (failed) => ({ caught: null, why: failed.why, code: failed.code, log: failed.log, signal: failed.signal });

const exported = (env) => `export ${Object.entries(env).map(([key, value]) => `${key}=${quote(value)}`).join(' ')}; `;

/** Run one session command in the tree; `signal` names the signal that ended it, also when a shell reports it killed. */
function call(command, env, log) {
  const run = lib.runShell(exported(env) + command, env.INFERNO_TREE, log, { wrap: false });
  return { code: run.code, log: run.log, signal: run.signal || KILLED[run.code] || null };
}

const stopOn = (what, signal) => ({ stopped: `the ${what} ended on ${signal}, so the batch stopped` });

/** Send each of `paths`; the first send that failed, with the path, or null. */
function send(ctx, paths, env, label) {
  for (const [index, rel] of paths.entries()) {
    const sent = call(ctx.hosted.send, { ...env, INFERNO_FILE: rel }, ctx.session.log(`${label}-${index + 1}`));
    if (sent.code !== 0) return { ...sent, rel };
  }
  return null;
}

/** One mutant in the session: written, resealed, sent, run, put back and sent back. */
function mutant(ctx, group, e, env) {
  const { session, verdicts } = ctx;
  const line = session.original(e.rel).split('\n')[e.n - 1];
  session.write(e.rel, new Map([[e.n, line.slice(0, e.col) + e.replace + line.slice(e.col + e.find.length)]]));
  // The seal went back before the open and after the mutant before, so this reseal finds none left.
  const failed = reseal(session, ctx.sealed, [e.rel], `own-${e.k}`);
  if (failed) {
    session.putBack(e.rel);
    verdicts.set(e.k, unsealedVerdict(failed));
    return failed.signal ? { stopped: `the reseal of entry ${e.k} ended on ${failed.signal}, so the batch stopped` } : {};
  }
  const paths = [e.rel, ...session.seal.paths.map((record) => record.file)];
  const sent = send(ctx, paths, env, `send-${e.k}`);
  if (sent && sent.signal) return stopOn(`send of ${sent.rel}`, sent.signal);
  let verdict = sent ? { caught: null, why: `the send of ${sent.rel} into the session failed (exit ${sent.code} -> ${sent.log})`, code: sent.code, log: sent.log } : null;
  if (!verdict) {
    const run = lib.runShell(exported({ ...env, INFERNO_TEST: group.inner }) + ctx.hosted.run, session.tree, session.log(`session-${e.k}`));
    const read = verdictOf(run, readLog(run.log), e.abs, { test: e.test, checks: ctx.checks || [] });
    verdict = { ...read, code: run.code, log: run.log, signal: run.signal };
  }
  verdicts.set(e.k, verdict);
  session.putBack(e.rel);
  if (unseal(session).length > 0) return { stopped: UNSEALED };
  if (verdict.signal) return { stopped: `the test of entry ${e.k} ended on ${verdict.signal}, so the batch stopped` };
  const back = send(ctx, paths, env, `back-${e.k}`);
  if (back && back.signal) return stopOn(`send of ${back.rel}`, back.signal);
  if (back) {
    return { held: `the send of ${back.rel} back into the session failed (exit ${back.code} -> ${back.log}), ` +
      `so the session may still hold the mutant of entry ${e.k} and its group stopped` };
  }
  return {};
}

async function inSession(ctx, group, env, n) {
  const { session, verdicts } = ctx;
  const opened = call(ctx.hosted.open, env, session.log(`session-${n}-open`));
  if (opened.signal) return stopOn("session's open", opened.signal);
  if (opened.code !== 0) {
    const why = `the session did not open (exit ${opened.code} -> ${opened.log})`;
    for (const e of group.entries) verdicts.set(e.k, { caught: null, why, code: opened.code, log: opened.log });
    return {};
  }
  for (const [index, e] of group.entries.entries()) {
    const signal = await ctx.signalled(session);
    if (signal) return { stopped: signal };
    const out = mutant(ctx, group, e, env);
    if (out.stopped) return out;
    if (out.held) {
      for (const rest of group.entries.slice(index + 1)) verdicts.set(rest.k, { caught: null, why: out.held });
      return {};
    }
  }
  return {};
}

/**
 * Run one group in a session of its own, the `n`th of the batch. `ctx` holds the batch's journal
 * session, the seal, the session key, the host's checks, the verdicts to fill, the notes to print,
 * the count of sessions opened and `signalled`. Returns `{stopped}` when the batch must stop, `{}` otherwise.
 */
async function runGroup(ctx, group, n) {
  const { session } = ctx;
  const signal = await ctx.signalled(session);
  if (signal) return { stopped: signal };
  if (unseal(session).length > 0) return { stopped: UNSEALED };
  const dir = session.log(`session-${n}`).replace(/\.log$/, '');
  fs.mkdirSync(dir, { recursive: true });
  const env = { INFERNO_TREE: session.tree, INFERNO_SESSION: dir };
  session.hold({ close: ctx.hosted.close, dir });
  ctx.sessions += 1;
  let result = {};
  try {
    result = await inSession(ctx, group, env, n);
  } finally {
    const closed = call(ctx.hosted.close, env, session.log(`session-${n}-close`));
    session.hold(null);
    if (closed.code !== 0) {
      const how = closed.signal ? `ended on ${closed.signal}` : `failed (exit ${closed.code} -> ${closed.log})`;
      ctx.notes.push(`the close of the session for ${group.test} ${how}; close it on the host`);
    }
    if (closed.signal && !result.stopped) result = stopOn("session's close", closed.signal);
  }
  return result;
}

/**
 * Close the session a killed batch left open, from its record in `entry`, the journal read from
 * `journal`, and drop the record from `entry`, which every later write of that journal starts
 * from. Returns the line that says what happened, none when no session was open.
 */
function closeLeft(tree, entry, journal) {
  const left = entry.session;
  if (!left) return [];
  const log = path.join(path.dirname(journal), `mutate-recover-${lib.stamp()}-${process.pid}-close.log`);
  const closed = call(left.close, { INFERNO_TREE: tree, INFERNO_SESSION: left.dir }, log);
  delete entry.session;
  return [closed.code === 0 ? 'closed the host session an interrupted mutate left open'
    : `the close of the host session an interrupted mutate left open failed (exit ${closed.code} -> ${closed.log}); close it on the host by hand`];
}

module.exports = { closeLeft, runGroup, sessionGroups, sessionOf, unsealedVerdict, validateSession };
