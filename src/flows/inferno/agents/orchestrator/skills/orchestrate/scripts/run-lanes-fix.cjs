'use strict';

/**
 * An accepted instrument red holds for a tree that differs from the accepted one only by the
 * harness fix it was accepted against, so the fold that brings a fix inside the lane's own scope
 * into the tree does not retire it. One rule, read by the accept and by every reader of it.
 *
 * The record keeps the files of the lane's scope the fix commit changed and the lane's scope hash
 * with those files left out. It holds for the tree it was written for, and for a later tree when
 * that hash reads the same, the fix is an ancestor of HEAD, and each of those files is what the fix
 * commit left. A merge names no single change, so it leaves out no file. The record sits by lane
 * in the branch's cache, so a tree whose proof hash moved still finds it; a record the released
 * flow wrote beside the proof holds for its own tree alone.
 */

const path = require('path');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const jobs = require('./run-jobs.cjs');

const ACCEPTED = '.instrument-red';

/** Where a lane's accept is recorded, by lane and branch rather than by the proof's key. */
const placeOf = (tree, name) => path.join(path.dirname(jobs.jobPaths(tree, name).job), `lane-${name}${ACCEPTED}`);

const names = (tree, args) => lib.git(tree, [...args, '-z']).split('\0').filter(Boolean);

/** The files of `scope` the fix commit changed, in git's order; none for a merge, whose `merge` says whether it reached the scope. */
function fixFiles(tree, sha, scope) {
  const inScope = (file) => lib.matchesAny(file, scope);
  if (lib.git(tree, ['rev-list', '--parents', '-n', '1', sha]).split(' ').length > 2) {
    return { files: [], merge: names(tree, ['diff', '--name-only', '--no-renames', `${sha}^1`, sha]).some(inScope) };
  }
  return { files: names(tree, ['diff-tree', '--no-commit-id', '-r', '--name-only', sha]).filter(inScope), merge: false };
}

/** The one rule: this tree differs from the one the record was accepted on only by its fix. */
function onlyByFix(tree, scope, record) {
  const files = record.fix_files || [];
  return proofs.scopeHash(tree, scope, { skip: (file) => files.includes(file) }) === record.fix_hash &&
    lib.git(tree, ['merge-base', '--is-ancestor', record.harness_fix, 'HEAD'], { tolerate: true }) !== null &&
    proofs.scopeHash(tree, files, { exact: true }) === proofs.scopeHash(tree, files, { exact: true, ref: record.harness_fix });
}

/**
 * The accepted instrument red that holds for this proof's inputs on `scope`, or null. It binds the
 * one run it accepted: only while the lane's latest result is that run, so any later run retires it.
 */
function readAccepted(tree, name, proof, scope) {
  const latest = jobs.readJson(jobs.jobPaths(tree, name).result) || {};
  const ours = (record) => record && record.command === proof.command && record.config === proof.config &&
    typeof record.harness_fix === 'string' && typeof record.run === 'string' && latest.run === record.run;
  // The released flow's record sits beside the proof, keyed by its inputs, so it holds for its own tree alone.
  const released = jobs.readJson(`${proof.file}${ACCEPTED}`);
  if (ours(released)) return released;
  const record = jobs.readJson(placeOf(tree, name));
  return ours(record) && (record.hash === proof.hash || onlyByFix(tree, scope, record)) ? record : null;
}

/**
 * What an accept of the instrument red `last` against the fix `sha` records, or null when `last`
 * ran on a tree this one differs from by more than the fix. A run on an earlier tree counts only
 * when it names the commit it walked and that commit hashes as the run did.
 */
function acceptable(tree, scope, proof, last, sha) {
  const { files, merge } = fixFiles(tree, sha, scope);
  const skip = (file) => files.includes(file);
  if (last.hash === proof.hash) return { fix_files: files, fix_hash: proofs.scopeHash(tree, scope, { skip }), merge };
  // A result the released flow wrote names no head, so it hashes as HEAD and never matches here.
  if (proofs.scopeHash(tree, scope, { ref: last.head }) !== last.hash) return null;
  const held = { fix_files: files, fix_hash: proofs.scopeHash(tree, scope, { ref: last.head, skip }), merge };
  return onlyByFix(tree, scope, { ...held, harness_fix: sha }) ? held : null;
}

/** The line an accept prints on what ships unwalked, or on a merge that leaves out nothing. */
function acceptLines(name, sha, held) {
  if (held.merge) {
    return [`harness fix ${sha.slice(0, 7)} is a merge, so the accept leaves out no file: accept the commit that changed the harness to hold through the fold`];
  }
  if (held.fix_files.length === 0) return [];
  return [`the accept leaves unwalked the files harness fix ${sha.slice(0, 7)} changed in the ${name} lane's scope: ${held.fix_files.join(', ')}`];
}

module.exports = { acceptLines, acceptable, placeOf, readAccepted };
