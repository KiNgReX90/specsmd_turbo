'use strict';

/**
 * The commit a step on the base branch diffs from. On the base the merge base with the base is
 * HEAD, so a selection anchored on it sees nothing: `--since` names the commit instead, else
 * `origin/<base>`, whose diff is exactly the commits a driver has not pushed yet.
 *
 * Requires `run-lib.cjs` only: `run-gate.cjs` loads `run-lanes-only.cjs`, which loads this, so
 * requiring the gate here would close a cycle.
 */

const lib = require('./run-lib.cjs');

const { RunError } = lib;

/** The commit `since` names, refused when it names none, so a typo never skips every lane. */
function sinceCommit(tree, since) {
  const sha = lib.git(tree, ['rev-parse', '--verify', '--quiet', `${since}^{commit}`], { tolerate: true });
  if (!sha) throw new RunError(`--since ${since} names no commit in ${tree}`, 'BAD_REF');
  return sha;
}

/**
 * Where integrate's landing starts. `--since` on any branch; null off the base, whose caller
 * keeps the merge base; on the base `origin/<base>` when it lacks commits HEAD has. With
 * neither there is no diff, and integrate runs every scoped check rather than skip its proof:
 * `all` is true and `out` says why.
 */
function landingSince(tree, base, since) {
  if (since) return { ref: sinceCommit(tree, since), all: false, out: [] };
  if (lib.currentBranch(tree) !== base) return null;
  const origin = lib.git(tree, ['rev-parse', '--verify', '--quiet', `origin/${base}^{commit}`], { tolerate: true });
  if (origin && origin !== lib.git(tree, ['rev-parse', 'HEAD'])) return { ref: origin, all: false, out: [] };
  return {
    ref: origin || null,
    all: true,
    out: [`on ${base} with no unpushed commit and no --since: every scoped check runs`],
  };
}

module.exports = { landingSince, sinceCommit };
