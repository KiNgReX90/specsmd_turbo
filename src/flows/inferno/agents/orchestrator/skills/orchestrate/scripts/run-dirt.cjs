'use strict';

/**
 * The uncommitted files of a tree, one entry per file, and the refusal of the ones a step reads
 * or commits.
 *
 * `git status --porcelain` collapses an untracked directory to `dir/`, so a path filter on it
 * misses every file inside: `ownedBy("src/new/", ["src/new/a.ts"])` is false. Here a file is read
 * as `proofs.scopeHash` reads it, the tracked changes against HEAD and every untracked file, each
 * by its own path.
 *
 * Integrate lands an item while sibling builders and reviewers work in the same tree, so it
 * refuses only what it would read or commit. A check reads the tree it runs in, uncommitted
 * sibling bytes included: one with a `finalize_scopes` entry reads its globs, one without reads
 * every path outside `.specs-inferno/`, exactly what `proofs.scopeHash` hashes for it.
 *
 * Requires `run-lib.cjs` only, so `run-gate.cjs` and `run-review.cjs` load it without a cycle.
 */

const { spawnSync } = require('child_process');

const lib = require('./run-lib.cjs');

const { RunError } = lib;

/** NUL-separated git output, so a path with a space or a non-ASCII name arrives unquoted. Null when tolerated and git fails. */
function gitFiles(tree, args, options = {}) {
  const result = spawnSync('git', args, { cwd: tree, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    if (options.tolerate) return null;
    throw new RunError(`git ${args.join(' ')} failed in ${tree}: ${(result.stderr || '').trim().split('\n')[0]}`, 'GIT');
  }
  return result.stdout.split('\0').filter(Boolean);
}

/** Every uncommitted file once: a tracked change against HEAD, or an untracked file git does not ignore. */
function dirtyFiles(tree) {
  return [...new Set([
    ...gitFiles(tree, ['diff', '--name-only', '--no-renames', '-z', 'HEAD']),
    ...gitFiles(tree, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])];
}

/**
 * What a set of checks reads, one scope per check, null for a check with no scope entry: the
 * union of their globs, or null, every path outside `.specs-inferno/`, once one is unscoped. No
 * check reads nothing.
 */
function scopeOf(scopes) {
  if (scopes.some((scope) => !scope)) return null;
  return [...new Set(scopes.flat())];
}

/** Whether checks reading `scope` (from scopeOf) read `file`. */
function reads(scope, file) {
  if (file === lib.SPECS_DIR || file.startsWith(`${lib.SPECS_DIR}/`)) return false;
  return scope === null || lib.matchesAny(file, scope);
}

/**
 * The uncommitted files git refuses to merge `ref` over before it starts: the dirty files the
 * incoming commits change since the merge base, and every staged file, since a merge that is not
 * a fast forward refuses any staged change, touched or not. A file only HEAD's side changed and
 * left unstaged never stops a merge, so the diff is three-dot.
 */
function foldBlockers(tree, ref) {
  const incoming = new Set(gitFiles(tree, ['diff', '--name-only', '--no-renames', '-z', `HEAD...${ref}`], { tolerate: true }) || []);
  const staged = gitFiles(tree, ['diff', '--cached', '--name-only', '--no-renames', '-z', 'HEAD'], { tolerate: true }) || [];
  return [...new Set([...dirtyFiles(tree).filter((file) => incoming.has(file)), ...staged])];
}

/** Refuse with DIRTY when there is any file: up to five named, `lead` says whose they are and `advice` what to do. */
function refuseDirt(files, lead, advice) {
  if (files.length === 0) return;
  const named = `${files.slice(0, 5).join(', ')}${files.length > 5 ? ` and ${files.length - 5} more` : ''}`;
  throw new RunError(`${lead}: ${named}. ${advice}`, 'DIRTY');
}

module.exports = { dirtyFiles, foldBlockers, reads, refuseDirt, scopeOf };
