'use strict';

/**
 * The two lists of an intent review whose entries are set aside.
 *
 * `withdrawn` holds a mutant its reviewer proposed by mistake, such as one that changes a line no
 * test can read: the entry as it was recorded, plus `reason`. The intent reviewer writes it. The
 * runner stops running it and writes no finding for it, and it never counts for its criterion, so
 * a withdrawal never closes a gap: a clean review still needs another caught mutant or a checked pin.
 *
 * `deferred` holds a finding the user put after the release: the finding as recorded, plus `to`, a
 * file in the intent folder that names the finding's file and line for the next plan, and `reason`.
 * A deferred survivor carries its mutant too (`find`, `replace`, `test`, `caught: no`), which
 * leaves `mutants`, so it stops running, and it answers its criterion the way a checked pin does.
 * Only the orchestrator defers, with `state-transition.cjs defer-finding`, on a recorded review. A
 * reviewer's file is refused when it holds a deferred entry the last recorded review does not:
 * the command writes only there, and a reviewer never records.
 *
 * Every record carries both lists of the last recorded review over, so neither comes back.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { MUTANT_KEYS, bad, entries, isMap, mutantsOf, readDoc, sameMutant } = require('./run-review-file.cjs');
const { owedProposals } = require('./run-mutant-coverage.cjs');
const { dump } = require('./run-mutant-runs.cjs');

const DEFERRED_KEYS = ['criterion', 'file', 'line', 'evidence', 'fix', 'severity', 'owner', 'to', 'reason'];
const DEFERRED_MUTANT = ['mutant', 'find', 'replace', 'test', 'caught'];

const maps = (value) => (Array.isArray(value) ? value.filter(isMap) : []);

/** The withdrawn mutants of a review: each a mutant as recorded, plus reason. */
function withdrawnOf(rel, doc) {
  return entries(rel, doc, 'withdrawn', [...MUTANT_KEYS, 'reason'], ['caught', 'why'], ['replace']).map((entry, index) => {
    if (typeof entry.replace !== 'string') throw bad(rel, `withdrawn entry ${index + 1} has no replace: copy the mutant as recorded, then add reason`);
    return entry;
  });
}

/**
 * What is wrong with `to`, the file in the intent folder `dir` that is to hold a deferred finding,
 * or null: it lies in that folder, exists, and names the finding's file and line.
 */
function toProblem(dir, to, finding) {
  const name = path.posix.normalize(String(to));
  if (path.isAbsolute(name) || name.split('/').includes('..')) return `to names ${to}; name a file in the intent folder, relative to it`;
  const stat = fs.statSync(path.join(dir, name), { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) return `to names ${to}, which is no file in ${dir}; write the findings the user put after the release there first`;
  if (!fs.readFileSync(path.join(dir, name), 'utf8').includes(`${finding.file}:${finding.line}`)) {
    return `to names ${to}, which does not name ${finding.file}:${finding.line}; write the finding there by its file and line first`;
  }
  return null;
}

/** The deferred findings of a review, each held to its `to` file in the review's own folder. */
function deferredOf(tree, rel, doc) {
  return entries(rel, doc, 'deferred', DEFERRED_KEYS, DEFERRED_MUTANT, ['replace']).map((entry, index) => {
    const at = `deferred entry ${index + 1}`;
    const mutant = entry.find !== undefined && entry.test !== undefined && typeof entry.replace === 'string' && entry.caught === 'no';
    if (entry.mutant !== undefined && !mutant) {
      throw bad(rel, `${at} carries mutant ${entry.mutant} without the mutant as recorded: find, replace, test and caught: no`);
    }
    const problem = toProblem(path.join(tree, path.dirname(rel)), entry.to, entry);
    if (problem) throw bad(rel, `${at} ${problem}`);
    return entry;
  });
}

/**
 * The items' proofs with each deferred survivor counted for its criterion, as a pin of the item
 * counts: the user put that proof after the release, and the deferred file names it.
 */
function answered(proofs, deferred) {
  return proofs.map((proof) => {
    const extra = deferred.map((entry) => /^([^:\s]+):(\d+)$/.exec(entry.mutant))
      .filter((match) => match && match[1] === proof.id).map((match) => ({ criterion: match[2] }));
    return { ...proof, pins: [...proof.pins, ...extra] };
  });
}

/** The last recorded version of the review file, or an empty one. */
function lastRecorded(tree, rel) {
  const text = lib.git(tree, ['show', `HEAD:${rel.split(path.sep).join('/')}`], { tolerate: true });
  const doc = text === null ? null : lib.parseYaml(text);
  return isMap(doc) ? doc : {};
}

const sameEntry = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => String(a[key]) === String(b[key]));

/**
 * Before the intent review's record runs anything: hold the reviewer's lists to the last recorded
 * review, write both lists of that review into the pending file, and return `keep`, which leaves
 * every set-aside mutant out of a list of entries, and `answer`, which counts the deferred survivors.
 */
function carryAside(tree, rel, intent, items) {
  // Required here: run-intent-review-file loads this module for its schema.
  const { INTENT_KEYS } = require('./run-intent-review-file.cjs');
  const doc = readDoc(tree, rel);
  const last = lastRecorded(tree, rel);
  const deferred = maps(last.deferred);
  deferredOf(tree, rel, doc).forEach((entry, index) => {
    if (deferred.some((one) => sameEntry(one, entry))) return;
    throw bad(rel, `deferred entry ${index + 1} is not one the last recorded review holds: the reviewer never defers, only the orchestrator's ` +
      'defer-finding does. Leave deferred out: the runner carries the recorded entries over');
  });
  const owed = owedProposals(tree, intent, items).map(({ item, entry }) => ({ ...entry, criterion: `${item}:${entry.criterion}` }));
  const withdrawn = maps(last.withdrawn);
  const held = [...maps(last.mutants), ...withdrawn, ...owed];
  withdrawnOf(rel, doc).forEach((entry, index) => {
    if (!held.some((one) => sameMutant(one, entry))) {
      throw bad(rel, `withdrawn entry ${index + 1} names no mutant of this intent: copy one as the last intent review or an item review ` +
        'recorded it, then add reason');
    }
    if (!withdrawn.some((one) => sameMutant(one, entry))) withdrawn.push(entry);
  });
  mutantsOf(rel, doc).forEach((mutant, index) => {
    if (withdrawn.some((one) => sameMutant(one, mutant))) throw bad(rel, `mutants entry ${index + 1} is withdrawn: leave it out of mutants`);
  });
  const lists = { withdrawn: withdrawn.length > 0 ? withdrawn : undefined, deferred: deferred.length > 0 ? deferred : undefined };
  if (JSON.stringify([doc.withdrawn, doc.deferred]) !== JSON.stringify([lists.withdrawn, lists.deferred])) {
    const next = { ...doc, ...lists };
    fs.writeFileSync(path.join(tree, rel), dump(Object.fromEntries(INTENT_KEYS.filter((key) => next[key] !== undefined).map((key) => [key, next[key]]))));
  }
  // A deferred finding without a mutant has no find, so it matches no entry.
  const aside = [...withdrawn, ...deferred];
  return {
    keep: (list) => list.filter((entry) => !aside.some((one) => sameMutant(one, entry))),
    answer: (proofs) => answered(proofs, deferred),
  };
}

/**
 * The lines a summary prints for the intent's recorded review: the deferred findings and the file
 * that holds them, and with `withdrawn` the count of withdrawn mutants. None when both are none.
 */
function asideLines(tree, intentId, { withdrawn = false } = {}) {
  // Required here: run-intent-owed loads the intent review schema, which loads this module.
  const rel = require('./run-intent-owed.cjs').intentReviewPath(tree, intentId);
  const doc = lib.parseYaml(fs.readFileSync(path.join(tree, rel), 'utf8'));
  const out = [];
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const gone = maps(doc.withdrawn).length;
  if (withdrawn && gone > 0) {
    out.push(`WITHDRAWN ${plural(gone, 'mutant')} of the intent review, each with its reason in ${rel}; none counts for its criterion`);
  }
  const files = new Map();
  for (const entry of maps(doc.deferred)) {
    const to = path.join(path.dirname(rel), String(entry.to));
    files.set(to, (files.get(to) || 0) + 1);
  }
  for (const [to, count] of files) out.push(`DEFERRED ${plural(count, 'finding')} of the intent review to ${to}: the next plan picks them up`);
  return out;
}

module.exports = { answered, asideLines, carryAside, deferredOf, toProblem, withdrawnOf };
