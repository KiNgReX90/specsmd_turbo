'use strict';

/**
 * Sealed files for `run.cjs mutate`. A host can seal files: a manifest holds their digests, and
 * its loader refuses them all when one byte differs. A mutant in a sealed file then fails every
 * test before the code under test runs, and the run would read caught.
 *
 * The config key `mutate.sealed` lists `{paths, reseal}`: globs of the sealed files and of the
 * seal itself, and the command that reseals them. Once a mutant sits in a sealed file, mutate
 * runs that command in the tree before the test. Every other path the reseal changed goes into
 * the journal with its bytes from before, and gets them back before the next reseal and at the
 * end. Git status names what the reseal changed among the files git sees. A file git ignores is
 * read under the sealed globs before the reseal runs and compared after it, so an ignored seal
 * goes back too. A byte restore, not a second reseal, keeps the tree exactly as it was.
 *
 * A reseal that exits non-zero reads no verdict. One that a signal ended, that a shell reports
 * killed, or that ran past `mutate.reseal_seconds` reads no verdict and stops the run. The
 * reseal runs in a process group of its own under a supervisor that stays in mutate's group: a
 * stop signal reaches the reseal through it, and the timeout ends every process the reseal
 * started, so none writes to the tree after its paths are recorded.
 *
 * The bytes from before are the committed ones for a file git sees, since mutate runs on a clean
 * tree only. A run killed during the reseal leaves the paths it changed unknown, so recovery
 * refuses the tree.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const lib = require('./run-lib.cjs');

const { RunError } = lib;

/** How long one reseal may run when the config names no `mutate.reseal_seconds`. */
const DEFAULT_SECONDS = 300;
/** How long the reseal's group has to end after a stop signal before it is killed. */
const GRACE_MS = 2000;
/** The exit codes a shell gives when a signal ended its child. */
const KILLED = { 130: 'SIGINT', 137: 'SIGKILL', 143: 'SIGTERM' };

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

/** Refuse a `mutate` block this runner cannot use, naming the file. */
function validateSealed(config, file) {
  if (config.mutate === undefined) return;
  const bad = (key, what) => new RunError(`${key} in ${file} must be ${what}.`, 'BAD_CONFIG');
  const mutate = config.mutate;
  const holding = 'a map holding sealed, reseal_seconds, session, run, wrapped and checks';
  if (!mutate || typeof mutate !== 'object' || Array.isArray(mutate)) throw bad('mutate', holding);
  const unknown = Object.keys(mutate).filter((key) => !['sealed', 'reseal_seconds', 'session', 'run', 'wrapped', 'checks'].includes(key));
  if (unknown.length > 0) throw bad('mutate', `${holding} only, not ${unknown.join(', ')}`);
  // Required here: run-mutate-session.cjs loads this file.
  require('./run-mutate-session.cjs').validateSession(mutate, file);
  require('./run-mutate-host.cjs').validateHost(mutate, file);
  const seconds = Number(mutate.reseal_seconds);
  if (mutate.reseal_seconds !== undefined && !(Number.isFinite(seconds) && seconds > 0)) {
    throw bad('mutate.reseal_seconds', 'a positive number of seconds');
  }
  if (mutate.sealed === undefined) return;
  if (!Array.isArray(mutate.sealed)) throw bad('mutate.sealed', 'a list of {paths, reseal}');
  mutate.sealed.forEach((entry, i) => {
    const at = `mutate.sealed[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw bad(at, 'a map of paths and reseal');
    const extra = Object.keys(entry).filter((key) => key !== 'paths' && key !== 'reseal');
    if (extra.length > 0) throw bad(at, `a map of paths and reseal only, not ${extra.join(', ')}`);
    if (!Array.isArray(entry.paths) || entry.paths.length === 0 || !entry.paths.every(nonEmpty)) {
      throw bad(`${at}.paths`, 'a non-empty list of path globs, none blank');
    }
    if (!nonEmpty(entry.reseal)) throw bad(`${at}.reseal`, 'the shell command that reseals those paths');
  });
}

/** The seal a config holds: its sealed entries, none when it seals nothing, and the reseal's timeout. */
function sealOf(config) {
  const mutate = config.mutate || {};
  const seconds = mutate.reseal_seconds === undefined ? DEFAULT_SECONDS : Number(mutate.reseal_seconds);
  return { entries: mutate.sealed || [], seconds };
}

/** Every path git calls changed or new, each file of a new directory by name. */
function changedPaths(tree) {
  const result = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: tree, encoding: 'utf8' });
  if (result.status !== 0) throw new RunError(`git status failed in ${tree}`, 'GIT');
  const fields = (result.stdout || '').split('\0');
  const paths = [];
  for (let i = 0; i < fields.length; i += 1) {
    if (fields[i].length < 4) continue;
    paths.push(fields[i].slice(3));
    // A rename or a copy carries its source in the next field.
    if (/^[RC]/.test(fields[i])) i += 1;
  }
  return paths;
}

const bytesAt = (abs) => (fs.existsSync(abs) ? fs.readFileSync(abs) : null);

/** The directory a glob cannot match outside of, for git to list from; `.` for a glob of any depth. */
const rootOf = (glob) => (glob.includes('/') ? glob.slice(0, glob.search(/[*?]|$/)).replace(/[^/]*$/, '') : '') || '.';

/** Every file git ignores under `globs`, with its bytes: what a reseal may write that git status never names. */
function ignoredUnder(tree, globs) {
  const roots = [...new Set(globs.map(rootOf))];
  const result = spawnSync('git', ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', ...roots],
    { cwd: tree, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new RunError(`git ls-files failed in ${tree}`, 'GIT');
  const rels = result.stdout.split('\0').filter((rel) => rel.length > 0 && lib.matchesAny(rel, globs));
  return new Map(rels.map((rel) => [rel, bytesAt(path.join(tree, rel))]));
}

/** The committed bytes of `rel` as a checkout writes them, or null when HEAD has no such file. */
function committed(tree, rel) {
  const result = spawnSync('git', ['cat-file', '--filters', `HEAD:${rel}`], { cwd: tree, maxBuffer: 1 << 30 });
  return result.status === 0 ? result.stdout : null;
}

/** Write `before` (base64, or null for a file that did not exist) back to `rel`. */
function writeBefore(tree, rel, before) {
  const abs = path.join(tree, rel);
  if (before === null) fs.rmSync(abs, { force: true });
  else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(before, 'base64'));
  }
}

/** Whether `rel` holds `before` again. */
function holds(tree, rel, before) {
  const now = bytesAt(path.join(tree, rel));
  return before === null ? now === null : now !== null && now.equals(Buffer.from(before, 'base64'));
}

/**
 * Put every path the reseals changed back to its bytes from before. A path that holds them again
 * leaves the record; the failures are returned, and their records stay in the journal.
 */
function unseal(ctx) {
  if (ctx.seal.paths.length === 0) return [];
  const failed = [];
  ctx.seal.paths = ctx.seal.paths.filter((record) => {
    try {
      writeBefore(ctx.tree, record.file, record.before);
    } catch (error) {
      // The check below names the path.
    }
    if (holds(ctx.tree, record.file, record.before)) return false;
    failed.push(`the restore of ${record.file}, which a reseal changed, failed; the journal keeps its bytes from before, ` +
      `and the next mutate in ${ctx.tree} puts them back once the file can be written`);
    return true;
  });
  ctx.save();
  return failed;
}

// The reseal's supervisor. It starts the reseal in a process group of its own and passes each
// stop signal it gets on to that group, the timeout's included, then kills what is left of the
// group. It ends the way the reseal ended: with the same code, or by the same signal.
const SUPERVISOR = String.raw`'use strict';
const { spawn } = require('child_process');
const [file, ...args] = JSON.parse(process.argv[1]);
const child = spawn(file, args, { detached: true, stdio: 'inherit' });
let stopped = false;
const group = (signal) => {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    // The group has ended.
  }
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopped = true;
    group(signal);
    setTimeout(() => group('SIGKILL'), ${GRACE_MS}).unref();
  });
}
child.on('exit', (code, signal) => {
  if (stopped) group('SIGKILL');
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  }
  process.exit(code === null ? 1 : code);
});
`;

/** Run one reseal command under its supervisor, its whole output in `log`, ended after `seconds`. */
function runReseal(command, tree, log, seconds) {
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const shell = ['bash', '-c', command];
  const argv = lib.isHeavy(command) && lib.onPath('claude-build') ? ['claude-build', '--', ...shell] : shell;
  const handle = fs.openSync(log, 'a');
  const result = spawnSync(process.execPath, ['-e', SUPERVISOR, JSON.stringify(argv)],
    { cwd: tree, stdio: ['ignore', handle, handle], timeout: Math.max(1, Math.round(seconds * 1000)) });
  fs.closeSync(handle);
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  return { code: result.status === null ? 1 : result.status, signal: result.signal || null, timedOut, log };
}

/** Why a reseal run gives no verdict, or null when it exited 0. A failure that carries a signal stops the run. */
function failure(run, seconds) {
  const base = { code: run.code, log: run.log };
  // The timeout stops the reseal with SIGTERM, whatever the reseal did with it.
  if (run.timedOut) return { ...base, why: `reseal timed out after ${seconds} seconds`, signal: 'SIGTERM' };
  if (run.signal) return { ...base, why: `reseal ended on ${run.signal}`, signal: run.signal };
  if (KILLED[run.code]) return { ...base, why: `reseal ended on ${KILLED[run.code]} (exit ${run.code})`, signal: KILLED[run.code] };
  return run.code === 0 ? null : { ...base, why: `reseal failed (exit ${run.code})`, signal: null };
}

/**
 * Bring the seal in line with `rels`, the files that hold a mutant now. The seal goes back to its
 * bytes from before, then every reseal command those files need runs in the tree. Each path a
 * reseal changed is recorded with its bytes from before and the hash of what the reseal wrote,
 * and `ctx.rehash(rel, hash)` hands over the hash of what the reseal left in each mutated file.
 * `ctx` also holds the tree, the seal record the journal carries, `save` and `log`; `sealed` is
 * what `sealOf` returns. Returns null; `{why, code, log, signal}` when a reseal did not exit 0,
 * with `signal` set when it must stop the run; or `{why, left}` when the seal of an earlier
 * mutant could not go back, with the lines that say which paths, and then no reseal ran.
 */
function reseal(ctx, sealed, rels, label) {
  const left = unseal(ctx);
  if (left.length > 0) return { why: 'a seal could not be put back', left };
  const sealing = sealed.entries.filter((entry) => rels.some((rel) => lib.matchesAny(rel, entry.paths)));
  if (sealing.length === 0) return null;
  const commands = [...new Set(sealing.map((entry) => entry.reseal))];
  const globs = sealing.flatMap((entry) => entry.paths);
  const skip = new Set(changedPaths(ctx.tree));
  const ignored = ignoredUnder(ctx.tree, globs);
  ctx.seal.running = commands.join(' && ');
  ctx.save();
  let failed = null;
  for (const [index, command] of commands.entries()) {
    failed = failure(runReseal(command, ctx.tree, ctx.log(`${label}-reseal-${index + 1}`), sealed.seconds), sealed.seconds);
    if (failed) break;
  }
  const records = new Map();
  for (const rel of changedPaths(ctx.tree)) {
    if (skip.has(rel)) continue;
    const before = committed(ctx.tree, rel);
    records.set(rel, { file: rel, before: before === null ? null : before.toString('base64') });
  }
  const now = ignoredUnder(ctx.tree, globs);
  for (const rel of new Set([...ignored.keys(), ...now.keys()])) {
    const was = ignored.get(rel) || null;
    const is = now.get(rel) || null;
    if (was === null ? is === null : is !== null && was.equals(is)) continue;
    records.set(rel, { file: rel, before: was === null ? null : was.toString('base64') });
  }
  for (const record of records.values()) {
    const bytes = bytesAt(path.join(ctx.tree, record.file));
    record.after = bytes === null ? null : sha(bytes);
  }
  for (const rel of rels) {
    const bytes = bytesAt(path.join(ctx.tree, rel));
    if (bytes !== null) ctx.rehash(rel, sha(bytes));
  }
  ctx.seal.paths = [...records.values()];
  ctx.seal.running = null;
  ctx.save();
  return failed;
}

/**
 * Recovery after a killed mutate: put back each path a reseal changed, when it still holds what
 * the reseal wrote. Returns the lines of what it did, the records it refused with why, and the
 * reseal that was still running, if any.
 */
function putBackSeal(tree, seal) {
  const done = [];
  const refused = [];
  if (!seal || typeof seal !== 'object') return { done, refused, running: null };
  for (const record of Array.isArray(seal.paths) ? seal.paths : []) {
    const complete = record && nonEmpty(record.file) && (record.before === null || typeof record.before === 'string') &&
      (record.after === null || typeof record.after === 'string');
    if (!complete) {
      refused.push({ record, why: 'its journal lacks what a restore needs' });
      continue;
    }
    if (holds(tree, record.file, record.before)) continue;
    const now = bytesAt(path.join(tree, record.file));
    if ((now === null ? null : sha(now)) !== record.after) {
      refused.push({ record, why: 'the file changed since' });
      continue;
    }
    writeBefore(tree, record.file, record.before);
    done.push(`restored ${record.file}, which a reseal changed, from an interrupted mutate`);
  }
  return { done, refused, running: nonEmpty(seal.running) ? seal.running : null };
}

/** The paths a seal record names, for the check that a live run owns them. */
const sealPaths = (seal) => (seal && Array.isArray(seal.paths) ? seal.paths.map((record) => String(record && record.file)) : []);

module.exports = { changedPaths, committed, putBackSeal, reseal, sealOf, sealPaths, unseal, validateSealed };
