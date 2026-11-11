'use strict';

/**
 * What a mutant's test command left in the tree. mutate puts back the file it broke and the paths
 * a host's own reseal changed (run-mutate-seal.cjs), and nothing else. A test command that writes
 * into the tree, a reseal inside it among them, leaves its change behind, and an orchestrator that
 * stages everything commits a seal that no longer matches its files.
 *
 * So the paths git calls changed or new are read with a hash of their bytes before the first write
 * and again after the last restore. A path whose state moved makes the result `restored: false` and
 * is named; a path that was already changed and still holds the same bytes is not. A file git
 * ignores is never named: a build's output lands there.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { changedPaths } = require('./run-mutate-seal.cjs');

/** The bytes' hash, or why the path reads as no file: gone (ENOENT), a directory (EISDIR). */
function stateOf(abs) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  } catch (error) {
    return `unreadable: ${error.code}`;
  }
}

/** Every path git calls changed or new, with its state. Read before the first write. */
function snapshot(tree) {
  return new Map(changedPaths(tree).map((rel) => [rel, stateOf(path.join(tree, rel))]));
}

/** The paths whose state differs from `before`, sorted. Read after the last restore. */
function leftBehind(tree, before) {
  const after = snapshot(tree);
  return [...new Set([...before.keys(), ...after.keys()])].filter((rel) => before.get(rel) !== after.get(rel)).sort();
}

/**
 * The result with its `restored` value: true when nothing was left, else `restored: false`, the
 * paths under `left`, exit 2, and the lines that name them and the key a sealing host sets.
 */
function settle(result, left) {
  if (left.length === 0) return { ...result, payload: { ...result.payload, restored: true } };
  const shown = left.slice(0, 5).join(', ') + (left.length > 5 ? ` and ${left.length - 5} more` : '');
  return {
    exit: 2,
    payload: { ...result.payload, restored: false, left },
    out: [
      ...result.out.filter((line) => line !== 'every file is restored'),
      `not restored: the test command left ${shown} changed; mutate puts back only the line it broke and the seal it resealed`,
      'a sealed file goes under mutate.sealed in .specs-inferno/config.yaml, so mutate reseals it before the test and puts it back after',
      'any other path: the test command must leave the tree as it found it, so name another command or write where git ignores; ' +
        `put ${left.length === 1 ? 'that path' : 'those paths'} back before the next step`,
    ],
  };
}

module.exports = { leftBehind, settle, snapshot };
