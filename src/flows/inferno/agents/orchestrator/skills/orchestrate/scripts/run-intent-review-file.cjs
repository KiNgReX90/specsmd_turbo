'use strict';

/**
 * The intent review file a cold reviewer writes before the gate, and the schema it is held to.
 *
 * The same contract as the item review in run-review-file.cjs: only the keys below, every
 * entry complete, and the verdict held to what the file found. On top of that, every finding
 * names the work item that owns its fix, every scan line gets an answer, and a criterion only
 * a person or another machine can prove names the evidence the merge waits for, and one only the
 * landing makes provable names the path the ship lists as owed (run-after-ship.cjs). Its entries set
 * aside, `withdrawn` mutants and `deferred` findings, are held in run-review-aside.cjs.
 */

const {
  FINDING_KEYS, RECORDED_KEYS, bad, entries, isMap, pinsOf, readDoc, recordedReviewer, relativePath, verdictParts,
} = require('./run-review-file.cjs');
const { gapRefusal, mutantGaps } = require('./run-mutant-coverage.cjs');
const { SAME_INTENT, deltaProblem } = require('./run-review-delta.cjs');
const { answered, deferredOf, withdrawnOf } = require('./run-review-aside.cjs');
const { briefMarks, criterionId } = require('./run-after-ship.cjs');

const INTENT_KEYS = ['verdict', 'criteria', 'findings', 'scanner', 'mutants', 'pins', 'withdrawn', 'deferred'];
/** An intent review also records the hash that leaves out the kb the base synced (review.outside). */
const INTENT_RECORDED = [...RECORDED_KEYS, 'tree_outside'];
const CRITERION_KEYS = ['criterion', 'proof', 'where'];
const PROOFS = ['test', 'code', 'external', 'after_ship'];
/** The proofs that name an evidence path: external, which the merge waits for, and after_ship, which the ship lists as owed. */
const EVIDENCED = ['external', 'after_ship'];
const SCANNER_KEYS = ['id', 'answer', 'reason'];
const ANSWERS = ['confirmed', 'struck'];

/** `marks` are the success criteria the brief beside the review marks (after ship) (run-after-ship.cjs). */
function criteriaOf(rel, doc, marks) {
  return entries(rel, doc, 'criteria', CRITERION_KEYS, ['evidence']).map((entry, index) => {
    const at = `criteria entry ${index + 1}`;
    if (!PROOFS.includes(entry.proof)) throw bad(rel, `${at} proof must be test, code, external or after_ship`);
    if (entry.proof === 'external' && entry.evidence === undefined) {
      throw bad(rel, `${at} is proven externally and names no evidence path; the merge waits for that path`);
    }
    if (entry.proof === 'after_ship') afterShipProblem(rel, at, entry, marks);
    if (!EVIDENCED.includes(entry.proof) && entry.evidence !== undefined) {
      throw bad(rel, `${at} carries evidence, which is for an external proof only, or an after_ship one`);
    }
    return entry.evidence === undefined ? entry : { ...entry, evidence: relativePath(rel, entry.evidence, at) };
  });
}

/** An after_ship proof names its evidence path and a criterion the plan marked, never one the merge could wait for. */
function afterShipProblem(rel, at, entry, marks) {
  if (entry.evidence === undefined) {
    throw bad(rel, `${at} is proven after the ship and names no evidence path; the ship lists that path as owed`);
  }
  const id = criterionId(entry.criterion);
  if (id === null) {
    throw bad(rel, `${at} is proven after_ship and names no SC-<n> of the brief; start its criterion with the id the brief marks (after ship)`);
  }
  if (!marks.has(id)) {
    throw bad(rel, `${at} is proven after_ship for ${id}, which the brief does not mark (after ship): only a criterion ` +
      'whose instrument the plan said runs after the landing waits past the merge, so prove this one as test, code or external');
  }
}

/** Every scan line answered once, and no answer to a line the scan does not hold. */
function scannerOf(rel, doc, scanIds) {
  const answers = entries(rel, doc, 'scanner', SCANNER_KEYS);
  const answered = new Set();
  for (const answer of answers) {
    if (!ANSWERS.includes(answer.answer)) throw bad(rel, `scan line ${answer.id} answer must be confirmed or struck`);
    if (!scanIds.includes(answer.id)) throw bad(rel, `scanner answers ${answer.id}, a line the scan does not hold`);
    if (answered.has(answer.id)) throw bad(rel, `scan line ${answer.id} is answered twice`);
    answered.add(answer.id);
  }
  const open = scanIds.filter((id) => !answered.has(id));
  if (open.length > 0) {
    throw bad(rel, `scan line ${open.slice(0, 5).join(', ')} has no answer; answer every line confirmed or struck`);
  }
  return answers;
}

/**
 * Read and validate the intent review. `items` are the ids of the intent's work items,
 * `scanIds` the ids of the collected scan's lines (none when no scan ran). `recorded` is
 * true for a file run.cjs already recorded, which carries the tree and commit it added.
 * `proofs` holds what each item owes in mutants or pins (run-mutant-coverage.cjs itemProofs). A
 * pin's text is checked against the tree when the review is recorded (run-review-mutants.cjs).
 */
function parseIntentReview(tree, rel, { recorded, items, scanIds, proofs = [] }) {
  const doc = readDoc(tree, rel);
  if (!isMap(doc)) throw bad(rel, `an intent review is a map of ${INTENT_KEYS.join(', ')}`);
  for (const key of Object.keys(doc)) {
    if (INTENT_KEYS.includes(key) || (recorded && INTENT_RECORDED.includes(key))) continue;
    if (INTENT_RECORDED.includes(key)) throw bad(rel, `${key} is written when the review is recorded, so drop it`);
    throw bad(rel, `unknown key ${key}: an intent review holds ${INTENT_KEYS.join(', ')} only`);
  }
  if (doc.verdict !== 'clean' && doc.verdict !== 'fix') throw bad(rel, 'verdict must be clean or fix');
  const criteria = criteriaOf(rel, doc, briefMarks(tree, rel));
  const { findings, mutants, survivors } = verdictParts(rel, doc, [...FINDING_KEYS, 'owner']);
  for (const finding of findings) {
    if (!items.includes(finding.owner)) {
      throw bad(rel, `finding at ${finding.file}:${finding.line} names owner ${finding.owner}, which is no work item of this intent`);
    }
  }
  // A delta review being recorded reads the fix and nothing else (run-review-delta.cjs).
  const delta = recorded ? null : deltaProblem(tree, rel, findings, SAME_INTENT);
  if (delta) throw bad(rel, delta);
  const scanner = scannerOf(rel, doc, scanIds);
  const pins = pinsOf(rel, doc);
  const withdrawn = withdrawnOf(rel, doc);
  const deferred = deferredOf(tree, rel, doc);
  const gaps = doc.verdict === 'clean' ? mutantGaps(answered(proofs, deferred), mutants, pins) : [];
  if (gaps.length > 0) throw bad(rel, gapRefusal(gaps));
  return {
    verdict: doc.verdict, criteria, findings, mutants, survivors, pins, scanner, withdrawn, deferred,
    tree: typeof doc.tree === 'string' ? doc.tree : null,
    tree_outside: typeof doc.tree_outside === 'string' ? doc.tree_outside : null,
    commit: typeof doc.commit === 'string' ? doc.commit : null,
    reviewer: recorded ? recordedReviewer(doc) : null,
  };
}

module.exports = { CRITERION_KEYS, INTENT_KEYS, SCANNER_KEYS, parseIntentReview };
