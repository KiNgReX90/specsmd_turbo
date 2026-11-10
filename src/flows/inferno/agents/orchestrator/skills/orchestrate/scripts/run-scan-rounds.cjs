'use strict';

/**
 * The cross-check's rounds, counted by the script so no agent text has to. A plan is read whole
 * once, in the pass. Each round after it is a fix round: one reader over the earlier round's
 * findings and the parts the repair changed. There are at most two, and what is still open
 * after the second goes to the oracle, so the plan is never read whole again.
 *
 * Measured on the old plan-time scan: one intent ran six whole-plan rounds and its open gaps
 * rose from 25 to 44; in another, 19 of the last round's 30 gaps sat in text earlier repairs had
 * written. A round that rereads the whole plan finds a new sample each time, and never ends.
 *
 * The record sits beside the scan's cache dir, which every dispatch empties: `<dir>-rounds.json`
 * holds each collected round's findings, and `<dir>-rounds/<n>/` the plan files as round n was
 * sent them, so the next round diffs the repair against the text its reader saw. A round counts
 * when its collect finds something, once however often it is dispatched or collected, and a
 * clean collect removes the record, so the next call is a pass over a new plan.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');

/** The pass and its two fix rounds. */
const FIX_ROUNDS = 2;
const MAX_ROUNDS = FIX_ROUNDS + 1;

const recordFile = (dir) => `${dir}-rounds.json`;
const snapshotDir = (dir, round) => path.join(`${dir}-rounds`, String(round));

/** A round's name as a reader and the planner read it. */
const roundName = (round) => (round === 1 ? 'the pass' : `fix round ${round - 1} of ${FIX_ROUNDS}`);

/** The plan's files relative to its directory: the brief, then every work item, sorted. */
function planFiles(root) {
  const items = path.join(root, 'work-items');
  return [
    ...(fs.existsSync(path.join(root, 'brief.md')) ? ['brief.md'] : []),
    ...(fs.existsSync(items) ? fs.readdirSync(items).filter((file) => file.endsWith('.md')).sort().map((file) => `work-items/${file}`) : []),
  ];
}

const planRoot = (tree, intent) => path.join(tree, lib.SPECS_DIR, 'intents', intent);

/** The rounds collected with findings, in order, each `{ round, findings }`; none for another intent. */
function readRounds(dir, intent) {
  try {
    const record = JSON.parse(fs.readFileSync(recordFile(dir), 'utf8'));
    return record && record.intent === intent && Array.isArray(record.rounds) ? record.rounds : [];
  } catch (error) {
    return [];
  }
}

/** The round the next dispatch is, or null when the pass and both fix rounds are spent. */
function nextRound(done) {
  return done.length >= MAX_ROUNDS ? null : done.length + 1;
}

/** Record round `round`'s findings, dropping any later round a re-collect left behind. */
function recordRound(dir, intent, round, findings) {
  const rounds = [...readRounds(dir, intent).filter((entry) => entry.round < round), { round, findings }];
  fs.mkdirSync(path.dirname(recordFile(dir)), { recursive: true });
  fs.writeFileSync(recordFile(dir), `${JSON.stringify({ intent, rounds })}\n`);
}

/** A clean collect ends the cross-check: its record and snapshots go. */
function clearRounds(dir) {
  fs.rmSync(recordFile(dir), { force: true });
  fs.rmSync(`${dir}-rounds`, { recursive: true, force: true });
}

/** Keep the plan files as round `round` is sent them, for the next round's diff. */
function snapshot(tree, intent, dir, round) {
  const to = snapshotDir(dir, round);
  fs.rmSync(to, { recursive: true, force: true });
  const from = planRoot(tree, intent);
  for (const rel of planFiles(from)) {
    fs.mkdirSync(path.dirname(path.join(to, rel)), { recursive: true });
    fs.copyFileSync(path.join(from, rel), path.join(to, rel));
  }
}

/**
 * What the repair changed since round `round - 1` was sent: each changed file with the text
 * that round read and the file now, and the files added and dropped, all relative to the plan.
 */
function repairChanges(tree, intent, dir, round) {
  const before = snapshotDir(dir, round - 1);
  const now = planRoot(tree, intent);
  const was = planFiles(before);
  const is = planFiles(now);
  const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  return {
    changed: is.filter((rel) => was.includes(rel) && read(before, rel) !== read(now, rel))
      .map((rel) => ({ rel, before: path.join(before, rel), now: path.join(now, rel) })),
    added: is.filter((rel) => !was.includes(rel)),
    dropped: was.filter((rel) => !is.includes(rel)),
  };
}

module.exports = { FIX_ROUNDS, MAX_ROUNDS, clearRounds, nextRound, readRounds, recordRound, repairChanges, roundName, snapshot };
