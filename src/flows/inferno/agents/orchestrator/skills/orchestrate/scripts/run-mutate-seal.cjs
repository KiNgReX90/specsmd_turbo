'use strict';

/**
 * Sealed files for `run.cjs mutate`. A host can seal files: a manifest holds their digests, and
 * its loader refuses them all when one byte differs. A mutant in a sealed file then fails every
 * test before the code under test runs, and the run would read caught.
 *
 * The config key `mutate.sealed` lists `{paths, reseal}`: globs of sealed files and the command
 * that reseals them. Once a mutant sits in a sealed file, mutate runs that command in the tree
 * before the test. Every other path the reseal changed goes into the journal with its bytes from
 * before, and after the revert it gets those bytes back. A byte restore, not a second reseal,
 * keeps the tree exactly as committed. A reseal that exits non-zero reads no verdict.
 *
 * The bytes from before are the committed ones, since mutate runs on a clean tree only. A run
 * killed during the reseal leaves the paths it changed unknown, so recovery refuses the tree.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const lib = require('./run-lib.cjs');

const { RunError } = lib;

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

/** Refuse a `mutate` block this runner cannot use, naming the file. */
function validateSealed(config, file) {
  if (config.mutate === undefined) return;
  const bad = (key, what) => new RunError(`${key} in ${file} must be ${what}.`, 'BAD_CONFIG');
  const mutate = config.mutate;
  if (!mutate || typeof mutate !== 'object' || Array.isArray(mutate)) throw bad('mutate', 'a map holding sealed');
  const unknown = Object.keys(mutate).filter((key) => key !== 'sealed');
  if (unknown.length > 0) throw bad('mutate', `a map holding sealed only, not ${unknown.join(', ')}`);
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

/** The sealed entries a config holds, none when it seals nothing. */
const sealedOf = (config) => (config.mutate && config.mutate.sealed) || [];

/** The reseal commands of every entry that seals one of `rels`, each once, in config order. */
const commandsFor = (sealed, rels) =>
  [...new Set(sealed.filter((entry) => rels.some((rel) => lib.matchesAny(rel, entry.paths))).map((entry) => entry.reseal))];

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

/** The committed bytes of `rel` as a checkout writes them, or null when HEAD has no such file. */
function committed(tree, rel) {
  const result = spawnSync('git', ['cat-file', '--filters', `HEAD:${rel}`], { cwd: tree, maxBuffer: 1 << 30 });
  return result.status === 0 ? result.stdout : null;
}

const bytesAt = (abs) => (fs.existsSync(abs) ? fs.readFileSync(abs) : null);

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
    failed.push(`the restore of ${record.file}, which a reseal changed, failed; run git checkout -- ${record.file} in ${ctx.tree} by hand`);
    return true;
  });
  ctx.save();
  return failed;
}

/**
 * Bring the seal in line with `rels`, the files that hold a mutant now. The seal goes back to its
 * bytes from before, then every reseal command those files need runs in the tree. Each path a
 * reseal changed is recorded with its committed bytes and the hash of what the reseal wrote.
 * `ctx` holds the tree, the seal record the journal carries, `save` and `log`. Returns null, or
 * `{why, code, log}` when a reseal did not exit 0.
 */
function reseal(ctx, sealed, rels, label) {
  unseal(ctx);
  const commands = commandsFor(sealed, rels);
  if (commands.length === 0) return null;
  const skip = new Set(changedPaths(ctx.tree));
  ctx.seal.running = commands.join(' && ');
  ctx.save();
  let failed = null;
  for (const [index, command] of commands.entries()) {
    const run = lib.runShell(command, ctx.tree, ctx.log(`${label}-reseal-${index + 1}`));
    if (run.code === 0 && !run.signal) continue;
    failed = { why: run.signal ? `reseal ended on ${run.signal}` : `reseal failed (exit ${run.code})`, code: run.code, log: run.log };
    break;
  }
  const known = new Map(ctx.seal.paths.map((record) => [record.file, record]));
  for (const rel of changedPaths(ctx.tree)) {
    if (skip.has(rel) || known.has(rel)) continue;
    const before = committed(ctx.tree, rel);
    known.set(rel, { file: rel, before: before === null ? null : before.toString('base64') });
  }
  for (const record of known.values()) {
    const now = bytesAt(path.join(ctx.tree, record.file));
    record.after = now === null ? null : sha(now);
  }
  ctx.seal.paths = [...known.values()];
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

module.exports = { putBackSeal, reseal, sealPaths, sealedOf, unseal, validateSealed };
