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
 *
 * One intent worktree holds several items at once, so a moved path may be another item's work. A
 * path that a dispatch open during the batch owns or claims, or another item's review file, is
 * printed as moved, under `moved`, and never named as left behind. Beside such work, a path nobody
 * owns may be either one's: it stays under `left`, `beside` names what ran beside the batch, and
 * the lines say so. A file the batch broke is its own whoever owns it, and nothing ran beside it.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dispatch = require('./run-dispatch.cjs');
const lib = require('./run-lib.cjs');
const { changedPaths } = require('./run-mutate-seal.cjs');

const { RunError } = lib;

/** A lens file of an item review: `<ledger>/intents/<intent>/reviews/[quality/]<item>.yaml`. */
const REVIEW_FILE = new RegExp(`^${lib.SPECS_DIR.replace(/\./g, '\\.')}/intents/[^/]+/reviews/(?:quality/)?([^/]+)\\.yaml$`);

/** The item whose review file `rel` is, or null. */
function reviewedBy(rel) {
  const match = REVIEW_FILE.exec(rel);
  return match ? match[1] : null;
}

/** The bytes' hash, or why the path reads as no file: gone (ENOENT), a directory (EISDIR). */
function stateOf(abs) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  } catch (error) {
    return `unreadable: ${error.code}`;
  }
}

const statesOf = (tree) => new Map(changedPaths(tree).map((rel) => [rel, stateOf(path.join(tree, rel))]));

/**
 * The tree's current dispatch records that validate. Only a moved path's owner is read from them,
 * so a cache that cannot be read gives none, and every moved path reads as the batch's own.
 */
function records(tree) {
  try {
    return dispatch.currentRecords(tree).filter((record) => {
      try {
        dispatch.validateDispatch(tree, record, {}, false);
        return true;
      } catch (error) {
        if (error instanceof RunError) return false;
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof RunError || error.code === 'ENOENT' || error instanceof SyntaxError) return [];
    throw error;
  }
}

const open = (tree) => records(tree).filter((record) => record.phase !== 'accepted').map((record) => record.dispatchId);

/** The dispatches open when a snapshot was read, by that snapshot. */
const openAtStart = new WeakMap();

/** Every path git calls changed or new, with its state. Read before the first write. */
function snapshot(tree) {
  const states = statesOf(tree);
  openAtStart.set(states, open(tree));
  return states;
}

/** The dispatches open at `before` or now, each with the paths it owns and claims. */
function besideOf(tree, before) {
  const ids = new Set([...(openAtStart.get(before) || []), ...open(tree)]);
  return records(tree).filter((record) => ids.has(record.dispatchId)).map((record) => ({
    name: `dispatch ${record.dispatchId} of ${dispatch.itemsOf(record).join(', ')}`,
    editable: (record.assignment.ownership && record.assignment.ownership.editable) || [],
    claimed: claimedBy(tree, record),
  }));
}

/** The paths a dispatch's accepted attempts claimed, none when an earlier attempt's record is gone. */
function claimedBy(tree, record) {
  try {
    return dispatch.effective(tree, record).claimed;
  } catch (error) {
    if (error instanceof RunError) return [];
    throw error;
  }
}

function owns(tree, rel, editable) {
  try {
    return lib.ownedBy(rel, editable, tree);
  } catch (error) {
    if (error instanceof RunError) return false;
    throw error;
  }
}

/** Whose work a moved path is, as `{ by, who }`, or null when nobody else's. */
function whose(tree, rel, dispatches) {
  const item = reviewedBy(rel);
  if (item) return { by: `the review file of ${item}`, who: `a reviewer of ${item}` };
  const claimer = dispatches.find((one) => one.claimed.includes(rel));
  if (claimer) return { by: `claimed by ${claimer.name}`, who: claimer.name };
  const owner = dispatches.find((one) => owns(tree, rel, one.editable));
  return owner ? { by: `owned by ${owner.name}`, who: owner.name } : null;
}

/**
 * The paths whose state differs from `before`, sorted, under `paths`; `by` says whose work each
 * other item's path is, and `beside` names the dispatches open during the batch. Read after the
 * last restore.
 */
function leftBehind(tree, before) {
  const after = statesOf(tree);
  const paths = [...new Set([...before.keys(), ...after.keys()])].filter((rel) => before.get(rel) !== after.get(rel)).sort();
  if (paths.length === 0) return { paths, by: {}, beside: [] };
  const dispatches = besideOf(tree, before);
  const by = {};
  for (const rel of paths) {
    const owner = whose(tree, rel, dispatches);
    if (owner) by[rel] = owner;
  }
  return { paths, by, beside: dispatches.map((one) => one.name) };
}

const listed = (items) => items.slice(0, 5).join(', ') + (items.length > 5 ? ` and ${items.length - 5} more` : '');
const SEALED = 'a sealed file goes under mutate.sealed in .specs-inferno/config.yaml, so mutate reseals it before the test and puts it back after';

/** The warnings of a settled payload: the paths another item's work moved, and the ones that may be either's. */
function notices(payload) {
  const { left = [], moved = [], beside = [] } = payload;
  const out = [];
  if (moved.length > 0) {
    out.push(`WARNING moved during the batch: ${listed(moved.map((one) => `${one.file} (${one.by})`))}; it may be another dispatch's work, ` +
      'so mutate left it as it is and the verdicts stand');
  }
  if (left.length > 0 && beside.length > 0) {
    out.push(`WARNING changed during the batch: ${listed(left)}, while ${listed(beside)} ran beside it, so it may be another dispatch's work; ` +
      'mutate left it as it is',
    `if the test command wrote it: ${SEALED}; any other path the test command must leave as it found it, so name another command ` +
      'or write where git ignores, and put it back before the next step');
  }
  return out;
}

/** The files a result's mutants broke: a batch's entries, or a single mutant's file. */
function brokenBy(payload) {
  return new Set([...(Array.isArray(payload.entries) ? payload.entries.map((row) => row.file) : []), ...(payload.file ? [payload.file] : [])]);
}

/**
 * The result with its `restored` value: true when nothing of the batch's own was left, else
 * `restored: false`, the paths under `left`, exit 2, and the lines that name them and the key a
 * sealing host sets. `behind` is what leftBehind read, or a plain list of paths, all the batch's own.
 */
function settle(result, behind) {
  const { paths, by = {}, beside: open = [] } = Array.isArray(behind) ? { paths: behind } : behind;
  const broken = brokenBy(result.payload);
  const moved = paths.filter((rel) => by[rel] && !broken.has(rel)).map((rel) => ({ file: rel, by: by[rel].by }));
  const left = paths.filter((rel) => !moved.some((one) => one.file === rel));
  const beside = left.some((rel) => broken.has(rel)) ? [] : [...new Set([...open, ...moved.map((one) => by[one.file].who)])];
  const payload = { ...result.payload, ...(moved.length > 0 ? { moved } : {}) };
  if (left.length === 0) return { ...result, payload: { ...payload, restored: true }, out: [...result.out, ...notices(payload)] };
  const kept = result.out.filter((line) => line !== 'every file is restored');
  if (beside.length > 0) {
    const settled = { ...payload, restored: false, left, beside };
    return { exit: 2, payload: settled, out: [...kept, ...notices(settled)] };
  }
  return {
    exit: 2,
    payload: { ...payload, restored: false, left },
    out: [
      ...kept,
      `not restored: the test command left ${listed(left)} changed; mutate puts back only the line it broke and the seal it resealed`,
      SEALED,
      'any other path: the test command must leave the tree as it found it, so name another command or write where git ignores; ' +
        `put ${left.length === 1 ? 'that path' : 'those paths'} back before the next step`,
      ...notices(payload),
    ],
  };
}

module.exports = { leftBehind, notices, reviewedBy, settle, snapshot };
