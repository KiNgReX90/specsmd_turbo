'use strict';

/**
 * A host session for `run.cjs mutate --batch`. A host whose tests run through a wrapper that
 * first syncs the tree to another machine and waits there for a slot pays that sync and that wait
 * once per mutant. With `mutate.session` every entry of a batch whose test goes through that
 * wrapper shares one session of it, whatever its test command, so the tree is synced once and the
 * slot is taken once per batch.
 *
 * The key holds five strings. `match` is a regex that marks a test command as going through the
 * wrapper when it matches at the command's start; the rest of the command is the test the session
 * runs. `open` copies the tree as it stands into a fresh session and takes the slot. `send` puts
 * one path of the tree into the session as it stands now, and deletes it there when it is gone.
 * `run` runs the test in the session, with the test's output and exit code. `close` gives the
 * session and the slot up, and exits 0 when nothing is open. Each runs in the tree under bash
 * with INFERNO_TREE, the tree, and INFERNO_SESSION, an empty directory of this session beside the
 * batch's logs, outside the tree, for the host's own state. `send` also gets INFERNO_FILE, the path
 * relative to the tree, and `run` gets INFERNO_TEST, the test of the entry it runs for.
 *
 * An entry whose test command `match` does not reach runs in place as before. `match` reads the
 * command as `mutate.run` wrapped it (run-mutate-host.cjs), and a session of a test the key wrapped
 * runs the test as written. The session opens, on a whole tree, at the first entry it serves and
 * closes once after the last. A shared Rust build it serves sends its switched files and every path
 * their reseal changed once per build, runs its control and each switched run there (with
 * INFERNO_MUTANT as the plain wrapper gets it), and sends those paths back once after. Per mutant
 * the line is written (and resealed when the host seals the file), the file and every path the
 * reseal changed are sent, the test runs, the file and the seal go back, and those paths are sent
 * again. A session that did not open, and a send of the mutant that failed, read no verdict. A send
 * back that failed may leave the mutant in the session, so the session's remaining entries read no
 * verdict. A session command that a signal ended, or that a shell reports killed, stops the batch,
 * as a test that a signal ended does. The close runs once the open has started, on every exit.
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
const { call, ending, exported, reach, validateSessionKey } = require('./run-host-session.cjs');

const KEYS = ['match', 'open', 'send', 'run', 'close'];
const UNSEALED = 'the batch stopped, since a seal could not be put back';

/** Refuse a `mutate.session` this runner cannot use, naming the file. */
function validateSession(mutate, file) {
  validateSessionKey(mutate.session, 'mutate.session', KEYS, file);
}

/** The session a config names, with its regex compiled, or null. */
function sessionOf(config) {
  const session = config.mutate && config.mutate.session;
  return session ? { ...session, match: new RegExp(session.match) } : null;
}

/**
 * The test the batch's session runs for each entry `hosted` reaches, by entry number. An entry's
 * `command` is its test as the host's wrapper runs it, the test itself when no `mutate.run` wrapped
 * it. The plan of each reached entry no Rust build can hold becomes `session`.
 */
function sessionTests(hosted, entries, plans) {
  const tests = new Map();
  for (const e of hosted ? entries : []) {
    const command = e.command || e.test;
    const rest = reach(hosted.match, command);
    if (rest === null) continue;
    tests.set(e.k, command === e.test ? rest : e.test);
    if (!e.rust) plans.set(e.k, { form: 'session' });
  }
  return tests;
}

/**
 * The one session of a batch, not open yet. `ctx` holds the batch's journal session, the seal, the
 * session key, the tests `sessionTests` gave, the host's checks, the verdicts to fill and
 * `signalled`. It gathers the notes to print and the count of sessions opened. `lost` is the
 * verdict every entry still to run in it reads once it cannot serve one, and `missed` the one the
 * entries of the batch's one shared build read once its send failed; `sent` says that build's
 * paths went in and must go back.
 */
function hostSession(ctx) {
  return { ...ctx, notes: [], sessions: 0, started: false, env: null, lost: null, missed: null, sent: false };
}

/** The verdict of a mistake whose reseal did not exit 0: none, with the signal that stops the batch if one ended it. */
const unsealedVerdict = (failed) => ({ caught: null, why: failed.why, code: failed.code, log: failed.log, signal: failed.signal });

const stopOn = (what, signal) => ({ stopped: `the ${what} ended on ${signal}, so the batch stopped` });

/** Open the session unless it was; `{stopped}` when the batch must stop, `{}` otherwise. */
function openOnce(hs) {
  if (hs.started) return {};
  const { session } = hs;
  if (unseal(session).length > 0) return { stopped: UNSEALED };
  const dir = session.log('host-session').replace(/\.log$/, '');
  fs.mkdirSync(dir, { recursive: true });
  hs.env = { INFERNO_TREE: session.tree, INFERNO_SESSION: dir };
  session.hold({ close: hs.hosted.close, dir });
  hs.started = true;
  hs.sessions += 1;
  const opened = call(hs.hosted.open, hs.env, session.log('host-session-open'));
  if (opened.signal) return stopOn("session's open", opened.signal);
  if (opened.code !== 0) hs.lost = { why: `the session did not open (exit ${opened.code} -> ${opened.log})`, code: opened.code, log: opened.log };
  return {};
}

/** Close the session when it was opened, once after the batch's last entry; `{stopped}` when a signal ended the close, `{}` otherwise. */
function closeOnce(hs) {
  if (!hs.started) return {};
  const closed = call(hs.hosted.close, hs.env, hs.session.log('host-session-close'));
  hs.session.hold(null);
  if (closed.code !== 0) hs.notes.push(`the close of the host session ${ending(closed)}; close it on the host`);
  return closed.signal ? stopOn("session's close", closed.signal) : {};
}

/** Why an entry the session serves reads no verdict now, or null when it can run there. */
const noVerdict = (hs) => hs.lost || hs.missed;

/** Run entry `e`'s test in the session, behind `prefix`. */
function runIn(hs, e, prefix, label) {
  const test = exported({ ...hs.env, INFERNO_TEST: hs.tests.get(e.k) });
  return lib.runShell(prefix + test + hs.hosted.run, hs.session.tree, hs.session.log(label));
}

/** Send each of `paths`; the first send that failed, with the path, or null. */
function send(hs, paths, label) {
  for (const [index, rel] of paths.entries()) {
    const sent = call(hs.hosted.send, { ...hs.env, INFERNO_FILE: rel }, hs.session.log(`${label}-${index + 1}`));
    if (sent.code !== 0) return { ...sent, rel };
  }
  return null;
}

/** Send what a shared build changed, `paths`, into the session it runs in; a failed send leaves its entries `missed`. */
function syncBuild(hs, paths, label) {
  if (!hs.started || noVerdict(hs)) return {};
  hs.sent = true;
  const sent = send(hs, paths, label);
  if (sent && sent.signal) return stopOn(`send of ${sent.rel}`, sent.signal);
  if (sent) hs.missed = { why: `the send of ${sent.rel} into the session failed (exit ${sent.code} -> ${sent.log})`, code: sent.code, log: sent.log };
  return {};
}

/** Once a shared build's files are back in the tree, send `paths` back into the session too. */
function syncBack(hs, paths) {
  if (!hs.sent) return {};
  if (unseal(hs.session).length > 0) return { stopped: UNSEALED };
  const back = send(hs, paths, 'back-build');
  if (back && back.signal) return stopOn(`send of ${back.rel}`, back.signal);
  if (back) {
    hs.lost = { why: `the send of ${back.rel} back into the session failed (exit ${back.code} -> ${back.log}), ` +
      'so the session may still hold the switches of the shared build and the rest of the session stopped' };
  }
  return {};
}

/** One mutant in the session: written, resealed, sent, run, put back and sent back. */
function mutant(hs, e, prefix) {
  const { session, verdicts } = hs;
  const line = session.original(e.rel).split('\n')[e.n - 1];
  session.write(e.rel, new Map([[e.n, line.slice(0, e.col) + e.replace + line.slice(e.col + e.find.length)]]));
  // The seal went back before the open and after the mutant before, so this reseal finds none left.
  const failed = reseal(session, hs.sealed, [e.rel], `own-${e.k}`);
  if (failed) {
    session.putBack(e.rel);
    if (failed.left) return { stopped: UNSEALED };
    verdicts.set(e.k, unsealedVerdict(failed));
    return failed.signal ? { stopped: `the reseal of entry ${e.k} ended on ${failed.signal}, so the batch stopped` } : {};
  }
  const paths = [e.rel, ...session.seal.paths.map((record) => record.file)];
  const sent = send(hs, paths, `send-${e.k}`);
  if (sent && sent.signal) return stopOn(`send of ${sent.rel}`, sent.signal);
  let verdict = sent ? { caught: null, why: `the send of ${sent.rel} into the session failed (exit ${sent.code} -> ${sent.log})`, code: sent.code, log: sent.log } : null;
  if (!verdict) {
    const run = runIn(hs, e, prefix, `session-${e.k}`);
    const read = verdictOf(run, readLog(run.log), e.abs, { test: e.test, checks: hs.checks || [] });
    verdict = { ...read, code: run.code, log: run.log, signal: run.signal };
  }
  verdicts.set(e.k, verdict);
  session.putBack(e.rel);
  if (unseal(session).length > 0) return { stopped: UNSEALED };
  if (verdict.signal) return { stopped: `the test of entry ${e.k} ended on ${verdict.signal}, so the batch stopped` };
  const back = send(hs, paths, `back-${e.k}`);
  if (back && back.signal) return stopOn(`send of ${back.rel}`, back.signal);
  if (back) {
    hs.lost = { why: `the send of ${back.rel} back into the session failed (exit ${back.code} -> ${back.log}), ` +
      `so the session may still hold the mutant of entry ${e.k} and the rest of the session stopped` };
  }
  return {};
}

/**
 * Run entry `e` as a mutant of its own in the session, opening it first when this is the first
 * entry it serves. Returns `{stopped}` when the batch must stop, and `ran` once the mutant was written.
 */
async function inSession(hs, e, prefix = '') {
  const signal = await hs.signalled(hs.session);
  if (signal) return { stopped: signal };
  const opened = openOnce(hs);
  if (opened.stopped) return opened;
  if (hs.lost) {
    hs.verdicts.set(e.k, { caught: null, ...hs.lost });
    return {};
  }
  return { ...mutant(hs, e, prefix), ran: true };
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

module.exports = {
  closeLeft, closeOnce, hostSession, inSession, noVerdict, openOnce, runIn, sessionOf, sessionTests, syncBack, syncBuild,
  unsealedVerdict, validateSession,
};
