'use strict';

/**
 * The runner runs a review's mutants, once, when it records the review (P1 of the improvement plan).
 *
 * Item review. A first review proposes one mutant per acceptance criterion a test covers, under
 * `mutants`, named by the criterion's number: `{criterion, file, line, find, replace, test}`. The
 * record step runs them in one batch, writes `caught` (yes, no, or none with `why`) on each, and
 * writes a `major` finding per survivor, marked `mutant: <criterion>`; a survivor makes the verdict
 * fix. A delta review proposes none: its record carries the last review's entries over, reruns
 * only the survivors and the entries that never ran, and keeps the rest as they read. A released
 * flow's `{criterion, test, caught}` entry is carried while caught; one that survived names no line
 * to break again, so it is dropped and its criterion is the intent review's.
 *
 * Pins. A criterion whose test pins reader-facing copy verbatim may be held by a pin instead,
 * under `pins`, which the record checks and never runs (run-review-pins.cjs): a first item review
 * and every intent review write their own, a delta item review carries the last review's and
 * drops one that no longer stands. A pin that does not stand is refused before anything runs.
 *
 * Intent review. Its record runs, in one batch, every proposal an item review left without
 * `caught`, the survivors of the last intent review, and the intent reviewer's own proposals,
 * named `<item>:<n>` and only for a criterion that has no mutant yet. Each lands in review.yaml
 * under that name, and a survivor is a `major` finding owned by its item. Every owed proposal is
 * placed before anything is judged, followed into another file when the item moved its line
 * there; one that cannot be placed reads `caught: none` with its why, holds its criterion for
 * nobody and counts as caught for nothing, so the reviewer may propose for it in the same record.
 *
 * An item's record runs its mutants beside both lens files it signs. On a tree that holds a
 * sibling's uncommitted work nothing runs: an item review is recorded with its proposals owed,
 * and the intent review, which records on a clean tree only, runs them. What
 * the runner writes into a pending file is written again on every record, so a record that was
 * cut off records the same way the next time.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const {
  ITEM_KEYS, isMap, itemCriterion, pinsOf, proposalsOf, readDoc, refuseComments, refuseNew, sameMutant, samePin, bad,
} = require('./run-review-file.cjs');
const { carryAside } = require('./run-review-aside.cjs');
const { checkPins, pinProblem, previousPins, testPaths } = require('./run-review-pins.cjs');
const { INTENT_KEYS, parseIntentReview } = require('./run-intent-review-file.cjs');
const { acceptanceCriteria, gapRefusal, itemProofs, mutantGaps, names, owedProposals } = require('./run-mutant-coverage.cjs');
const {
  changedSince, checkTargets, dump, kept, locate, ownFindings, previousEntries, ranLines, runEntries, survivorFinding,
} = require('./run-mutant-runs.cjs');

const { RunError } = lib;

/** A pin as a review file keeps it, in the schema's key order. */
const keptPin = (pin) => ({ criterion: pin.criterion, file: pin.file, test: pin.test, text: pin.text });

/** An entry still to run: a proposal that never ran, or one whose test stayed green. */
const due = (entry) => entry.find !== undefined && (entry.caught === undefined || entry.caught === 'no');

/** The review file as the runner leaves it, in the schema's key order. */
function rewrite(abs, doc, order, changes) {
  const next = { ...doc, ...changes };
  fs.writeFileSync(abs, dump(Object.fromEntries(order.filter((key) => next[key] !== undefined).map((key) => [key, next[key]]))));
}

/**
 * A delta item review's pins: the last review's, carried, each one that no longer stands dropped
 * with a line. The reviewer writes none of its own.
 */
function carriedPins(tree, rel, doc, owner, out) {
  const previous = previousPins(tree, rel);
  pinsOf(rel, doc).forEach((pin, index) => {
    if (previous.some((one) => samePin(one, pin))) return;
    throw bad(rel, `pins entry ${index + 1} is new: a delta review writes no pin. Leave pins out: the runner carries the last ` +
      'review\'s over and checks them again');
  });
  return previous.filter((pin) => {
    const problem = pinProblem(tree, pin, owner);
    if (problem) {
      out.push(`PIN ${pin.criterion} no longer holds: ${problem}, so the intent review owes criterion ${pin.criterion} ` +
        'a caught mutant or a checked pin');
    }
    return !problem;
  });
}

/** The item review's mutants, run and written into its pending file, and its pins checked. Returns the lines to print. */
async function itemMutants(tree, context) {
  const { intent, item, rel, configFile, signs } = context;
  const doc = readDoc(tree, rel);
  const own = ownFindings(doc);
  const out = [];
  const spec = lib.readItemSpec(tree, intent.id, item.id);
  const owner = { item: item.id, tests: testPaths(spec) };
  let entries;
  let pins;
  if (item.review) {
    const previous = previousEntries(tree, rel);
    refuseNew(rel, doc, previous);
    entries = previous.filter((entry) => entry.find !== undefined || entry.caught === 'yes');
    for (const entry of previous.filter((one) => !entries.includes(one))) {
      out.push(`MUTANT ${entry.criterion} names no line to break, so the intent review owes its criterion a caught mutant or a checked pin`);
    }
    pins = carriedPins(tree, rel, doc, owner, out);
  } else {
    const named = itemCriterion(item.id, acceptanceCriteria(fs.readFileSync(spec.file, 'utf8')).length);
    entries = proposalsOf(rel, doc, named);
    refuseComments(tree, rel, entries);
    checkTargets(tree, rel, entries);
    pins = pinsOf(rel, doc, named);
    checkPins(tree, rel, pins, () => owner);
  }
  const written = Array.isArray(doc.findings) ? doc.findings.length : 0;
  if (entries.length === 0 && pins.length === 0 && own.length === written) return out;

  const elsewhere = () => changedSince(tree, rel, spec.manifest.ownership.editable);
  const result = await runEntries(tree, entries.filter(due), { configFile, rel, signs, elsewhere });
  const owes = (entry) => `the intent review owes criterion ${entry.criterion} a caught mutant or a checked pin`;
  const survivors = entries.filter((entry) => entry.caught === 'no');
  rewrite(path.join(tree, rel), doc, ITEM_KEYS, {
    verdict: own.length > 0 || survivors.length > 0 ? 'fix' : 'clean',
    findings: [...own, ...survivors.map((entry) => survivorFinding(entry))],
    mutants: entries.map(kept),
    pins: pins.length > 0 ? pins.map(keptPin) : undefined,
  });
  return [...out, ...ranLines(result, entries, owes)];
}

/** The ids of the collected scan's lines, as the intent review answers them. */
function scanIds(tree, intent, owed) {
  const file = path.join(tree, owed.scanPath(tree, intent));
  const doc = fs.existsSync(file) ? lib.parseYaml(fs.readFileSync(file, 'utf8')) : null;
  return isMap(doc) && Array.isArray(doc.lines) ? doc.lines.map((line) => line && line.id).filter((id) => typeof id === 'string') : [];
}

/** How the intent review names a criterion: `<item>:<n>`, an item of the intent and one of its criteria. */
const intentCriterion = (proofs) => (text) => {
  const match = /^([^:\s]+):(\d+)$/.exec(text);
  if (!match) return `criterion reads ${text}; name it <item>:<n>, the work item and the number of its acceptance criterion`;
  const item = proofs.find((proof) => proof.id === match[1]);
  if (!item) return `names ${match[1]}, which is no work item of this intent`;
  const n = Number(match[2]);
  return n >= 1 && n <= item.criteria.length ? null : `names criterion ${n}, and ${item.id} has ${item.criteria.length} acceptance criteria`;
};

/** The item and the criterion index an intent entry names, or null for a released flow's free text. */
function namedBy(proofs, entry) {
  const match = /^([^:\s]+):(\d+)$/.exec(String(entry.criterion));
  const item = match && proofs.find((proof) => proof.id === match[1]);
  return item ? { item, index: Number(match[2]) - 1 } : null;
}

/** Refuse a proposal for a criterion that has a mutant: a caught one, or one this record runs. */
function refuseSecond(rel, proofs, proposals, held) {
  proposals.forEach((proposal) => {
    const { item, index } = namedBy(proofs, proposal);
    const caught = item.mutants.some((mutant) => names(mutant, item, index, true));
    if (caught || held.some((entry) => names(entry, item, index, false))) {
      throw bad(rel, `mutants proposes one for ${proposal.criterion}, which has a mutant ${caught ? 'its item review caught' : 'this record runs'}; ` +
        'propose only for a criterion still without one');
    }
  });
}

/** Two entries are one mutant wherever its line went: a placed entry keeps all but its file. */
const sameButFile = (a, b) => sameMutant({ ...a, file: b.file }, b);

/**
 * Every proposal an item review left owed and no earlier intent review took up, named
 * `<item>:<n>` and placed on the tree as it stands (run-mutant-runs.cjs `locate`): on its line,
 * or in the file the item moved it to. One that cannot be placed reads `caught: none` with its why.
 */
function placedOwed(tree, intent, items, carried) {
  return owedProposals(tree, intent, items)
    .map(({ item, entry }) => ({ item, entry, named: { ...kept(entry), criterion: `${item}:${entry.criterion}` } }))
    .filter(({ named }) => !carried.some((one) => sameButFile(one, named)))
    .map(({ item, entry, named }) => {
      const review = path.join(lib.SPECS_DIR, 'intents', intent, 'reviews', `${item}.yaml`);
      const at = locate(tree, entry, () => changedSince(tree, review, lib.readItemSpec(tree, intent, item).manifest.ownership.editable));
      return Object.assign(named, at.why ? { caught: 'none', why: at.why, tried: true } : at);
    });
}

/** The intent review's mutants, run and written into its pending file. Returns the lines to print. */
async function intentMutants(tree, context) {
  // Required here, not at the top: run-intent-owed loads run-intents, which loads run-frontier and run-review.
  const owed = require('./run-intent-owed.cjs');
  const { intent, rel } = context;
  const items = owed.intentItems(tree, intent);
  parseIntentReview(tree, rel, { recorded: false, items, scanIds: scanIds(tree, intent, owed) });
  const abs = path.join(tree, rel);
  // The withdrawn mutants and the deferred findings, carried over and left out of what runs (run-review-aside.cjs).
  const aside = carryAside(tree, rel, intent, items);
  const text = fs.readFileSync(abs, 'utf8');
  const doc = readDoc(tree, rel);
  const own = ownFindings(doc);
  const proofs = aside.answer(itemProofs(tree, intent, items));
  const carried = aside.keep(previousEntries(tree, rel).filter((entry) => entry.find !== undefined || entry.caught === 'yes'));
  // Placed before anything is judged: an owed proposal its item's code no longer holds is held by nothing and counts for nothing.
  const fromItems = aside.keep(placedOwed(tree, intent, items, carried));
  const proposals = proposalsOf(rel, doc, intentCriterion(proofs), (entry) => [...carried, ...fromItems].some((one) => sameMutant(one, entry)));
  refuseSecond(rel, proofs, proposals, [...carried, ...fromItems].filter((entry) => entry.caught !== 'none'));
  const entries = [...carried, ...fromItems, ...proposals];
  // The intent reviewer's own pins, checked against the item each names; the last intent review's are carried while they stand.
  const ownerOf = (pin) => {
    const { item } = namedBy(proofs, pin);
    return { item: item.id, tests: item.tests };
  };
  const written = pinsOf(rel, doc, intentCriterion(proofs));
  checkPins(tree, rel, written, ownerOf);
  const pins = [...written, ...previousPins(tree, rel).filter((pin) => !written.some((one) => samePin(one, pin)))
    .filter((pin) => pinProblem(tree, pin, ownerOf(pin)) === null)];
  const gaps = (counted) => (doc.verdict === 'clean' ? mutantGaps(proofs, counted, pins) : []);
  const before = gaps(entries.filter((entry) => entry.caught === 'yes' || due(entry)).map((entry) => ({ ...entry, caught: 'yes' })));
  if (before.length > 0) throw bad(rel, gapRefusal(before));
  refuseComments(tree, rel, proposals);
  checkTargets(tree, rel, proposals);
  if (entries.length === 0 && pins.length === 0 && own.length === (Array.isArray(doc.findings) ? doc.findings.length : 0)) return [];

  const result = await runEntries(tree, entries.filter(due), { configFile: context.configFile, rel });
  if (result.busy) throw new RunError(`no mutant could run: ${result.busy}. Nothing is recorded: run the same command again`, 'DIRTY');
  const survivors = entries.filter((entry) => entry.caught === 'no');
  const ownedBy = (entry) => ({ owner: entry.criterion.split(':')[0] });
  const verdict = own.length > 0 || survivors.length > 0 ? 'fix' : 'clean';
  rewrite(abs, doc, INTENT_KEYS, {
    verdict,
    findings: [...own, ...survivors.map((entry) => survivorFinding(entry, ownedBy(entry)))],
    mutants: entries.map(kept),
    pins: pins.length > 0 ? pins.map(keptPin) : undefined,
  });
  const after = verdict === 'clean' ? mutantGaps(proofs, entries, pins) : [];
  if (after.length > 0) {
    fs.writeFileSync(abs, text);
    throw bad(rel, gapRefusal(after));
  }
  const owes = (entry) => `propose another for ${entry.criterion} in the next intent review`;
  return ranLines(result, entries, owes);
}

module.exports = { intentMutants, itemMutants };
