'use strict';

/**
 * What of a fold the intent review binds under `review.outside`. The key's globs name the paths
 * whose base-side changes keep the review current while the intent never touched them, and
 * `["**"]` names every path, which binds the review to the files the intent changed. Here are the
 * files the intent changed (`ownFiles`, which outsideHash hashes in) and, for a fold since a
 * commit, the folded files the review still binds (`foldBound`): the delta dispatch names them,
 * with the base's change to read, so a reviewer is never handed the whole base delta.
 */

const lib = require('./run-lib.cjs');
const { reviewOutside } = require('./run-config-gates.cjs');
const { foldRanges } = require('./run-fold.cjs');

const isLedger = (file) => file === lib.SPECS_DIR || file.startsWith(`${lib.SPECS_DIR}/`);

/** The diffs that name a file as the intent's own at `at`: the dirty tree for HEAD, then against each base ref. */
function ownReads(tree, base, at) {
  const refs = [base];
  if (lib.git(tree, ['rev-parse', '--verify', '--quiet', `origin/${base}`], { tolerate: true })) refs.push(`origin/${base}`);
  const dirty = at === 'HEAD'
    ? [['diff', '--name-only', '--no-renames', '-z', 'HEAD'], ['ls-files', '--others', '--exclude-standard', '-z']]
    : [];
  return [...dirty, ...refs.map((ref) => ['diff', '--name-only', '--no-renames', '-z', `${ref}...${at}`])];
}

/**
 * The files the intent changed at `at` (HEAD with its dirty files, or a commit), its ledger
 * files included, or null when a base cannot be diffed or is the tree's own branch: then no diff
 * tells the intent's edits from a sync.
 */
function ownFiles(tree, base, at = 'HEAD') {
  if (!base || base === lib.currentBranch(tree)) return null;
  const own = new Set();
  for (const args of ownReads(tree, base, at)) {
    const out = lib.git(tree, args, { tolerate: true });
    if (out === null) return null;
    for (const file of out.split('\0').filter(Boolean)) own.add(file);
  }
  return own;
}

/**
 * The files a fold of the base since `from` changed that the review binds: each the intent
 * changed then or now, or outside the key's globs. Null when the key is unset, no fold came in
 * since `from`, or the intent's files cannot be told: the review then reads the range whole.
 */
function foldBound(tree, config, from, base) {
  const globs = reviewOutside(config || {});
  if (globs.length === 0 || !from) return null;
  const ranges = foldRanges(tree, from, base);
  const now = ranges.length > 0 && ownFiles(tree, base);
  const then = now && ownFiles(tree, base, from);
  if (!then) return null;
  const folded = new Map();
  for (const range of ranges) {
    const files = lib.git(tree, ['diff', '--name-only', '--no-renames', '-z', range.held, range.tip], { tolerate: true });
    if (files === null) return null;
    for (const file of files.split('\0').filter(Boolean)) {
      if (isLedger(file) || !(now.has(file) || then.has(file) || !lib.matchesAny(file, globs))) continue;
      if (!folded.has(file)) folded.set(file, []);
      folded.get(file).push(range);
    }
  }
  const bound = [...folded.keys()].sort();
  return { bound, ranges: ranges.filter((range) => bound.some((file) => folded.get(file).includes(range))) };
}

/** The delta dispatch's line on a fold since `from`: what of the base to read, or nothing when the range is read whole. */
function foldLines(tree, config, from, base) {
  const fold = foldBound(tree, config, from, base);
  if (!fold) return [];
  const short = (ref) => lib.git(tree, ['rev-parse', '--short', ref]);
  const own = `read the intent's own commits (git log -p --first-parent --no-merges ${short(from)}..HEAD)`;
  const head = `  the base folded in since ${short(from)} changed`;
  if (fold.bound.length === 0) return [`${head} no file the review binds: ${own} and none of the base delta`];
  const files = fold.bound.join(' ');
  const diffs = fold.ranges.map((range) => `git diff ${short(range.held)} ${short(range.tip)} -- ${files}`).join('; ');
  return [`${head} ${files}, which the review binds: ${own} and, of the base, only its change to them (${diffs}) ` +
    'and what calls them, not the rest of the base delta'];
}

module.exports = { foldBound, foldLines, isLedger, ownFiles };
