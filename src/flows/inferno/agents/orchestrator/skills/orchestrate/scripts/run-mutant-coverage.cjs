'use strict';

/**
 * Which acceptance criteria still owe a caught mutant or a checked pin before an intent review may
 * say clean.
 *
 * The item's manifest decides by its test paths. An item with any test path owes, for every
 * criterion, a caught mutant or a checked pin that names it, whatever language the tests are in:
 * the batch mutate builds every Rust mutant of a review once. An item with no test path owes none.
 * A mutant counts from the item's own review or from the intent review, and only when it reads
 * caught yes, so an entry the batch gave no verdict never counts. A proposal an item review
 * recorded without `caught` never ran: the intent review's record runs it (run-review-mutants.cjs).
 * A pin counts from either review too (run-review-pins.cjs): the intent review's once its record
 * checked it, an item review's while it still stands in the tree as it is.
 *
 * A criterion whose line ends in a gate mark, `(gate: <name>)`, owes neither: the gate proves it
 * (run-criterion-marks.cjs). It keeps its number, so every recorded mutant names what it named,
 * unless its mark came after the item's first review outside a commit of its spec alone.
 *
 * An item mutant the intent review moved, under `moved`, counts for the criterion it was moved to
 * and no longer for the one its item review recorded (run-mutant-moves.cjs): a review recorded
 * before its entries repeated their criterion's words may have numbered them wrong. An entry that
 * repeats them, under `says`, was checked when it was recorded and is never moved.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { pinProblem, testPaths } = require('./run-review-pins.cjs');
const { gateMark, lateMarks } = require('./run-criterion-marks.cjs');

/** The criteria under `## Acceptance Criteria`, one per list line, checkbox or not. */
function acceptanceCriteria(content) {
  const section = /\n## Acceptance Criteria[ \t]*\n([\s\S]*?)(?=\n## |$)/.exec(content);
  if (!section) return [];
  return section[1].split('\n')
    .map((line) => /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
}

/** The review file at `parts` under the intent's folder, live or archived, as data; null when there is none. */
function reviewDoc(tree, intentId, parts) {
  for (const base of [['intents'], ['archive', 'intents']]) {
    const file = path.join(tree, lib.SPECS_DIR, ...base, intentId, ...parts);
    if (!fs.existsSync(file)) continue;
    try {
      return lib.parseYaml(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      return null;
    }
  }
  return null;
}

/** Every `key` entry (mutants or pins) an item review recorded; none when it has no review file yet. */
function recorded(tree, intentId, itemId, key) {
  const doc = reviewDoc(tree, intentId, ['reviews', `${itemId}.yaml`]);
  return doc && Array.isArray(doc[key]) ? doc[key].filter((entry) => entry && typeof entry === 'object') : [];
}

const recordedMutants = (tree, intentId, itemId) => recorded(tree, intentId, itemId, 'mutants');

const NAMED = /^([^:\s]+):(\d+)$/;

/** The moves the intent review holds, as `{ item, from, to }` with both numbers 1-based; a malformed entry moves nothing. */
function intentMoves(tree, intentId) {
  const doc = reviewDoc(tree, intentId, ['review.yaml']);
  const moved = doc && Array.isArray(doc.moved) ? doc.moved : [];
  return moved.flatMap((entry) => {
    const from = entry && NAMED.exec(String(entry.from));
    const to = entry && NAMED.exec(String(entry.criterion));
    return from && to && from[1] === to[1] ? [{ item: from[1], from: Number(from[2]), to: Number(to[2]) }] : [];
  });
}

/**
 * The item review's mutants of `itemId` with every move applied: an entry its item review recorded
 * under a moved number, without `says`, reads the number it was moved to. `criteria` lets a released
 * flow's free-text name match as it does when it counts.
 */
function movedMutants(tree, intentId, itemId, criteria, moves = intentMoves(tree, intentId)) {
  const own = moves.filter((one) => one.item === itemId);
  return recordedMutants(tree, intentId, itemId).map((entry) => {
    const one = entry.says === undefined && own.find((move) => names(entry, { id: itemId, criteria }, move.from - 1, true));
    return one ? { ...entry, criterion: String(one.to) } : entry;
  });
}

/** The proposals an item review recorded that never ran, each with the item that owes it, under the number a move gave it. */
const owedProposals = (tree, intentId, ids) => {
  const moves = intentMoves(tree, intentId);
  return ids.flatMap((id) => movedMutants(tree, intentId, id, criteriaOf(tree, intentId, id), moves)
    .filter((entry) => entry.caught === undefined && typeof entry.find === 'string')
    .map((entry) => ({ item: id, entry })));
};

/** The acceptance criteria of an item, in order. */
const criteriaOf = (tree, intentId, itemId) => acceptanceCriteria(fs.readFileSync(lib.readItemSpec(tree, intentId, itemId).file, 'utf8'));

/**
 * What each item of the intent needs: its criteria, how its tests prove them, its manifest's test
 * paths, its own caught mutants, its own pins that still stand, and its marks that count for nothing.
 */
function itemProofs(tree, intentId, ids) {
  const moves = intentMoves(tree, intentId);
  return ids.map((id) => {
    const spec = lib.readItemSpec(tree, intentId, id);
    const tests = testPaths(spec);
    const criteria = acceptanceCriteria(fs.readFileSync(spec.file, 'utf8'));
    return {
      id,
      criteria,
      late: lateMarks(tree, intentId, id, spec.file, criteria),
      tested: tests.length > 0,
      tests,
      mutants: movedMutants(tree, intentId, id, criteria, moves).filter((entry) => entry.caught === 'yes'),
      pins: recorded(tree, intentId, id, 'pins').filter((pin) => pinProblem(tree, pin, { item: id, tests }) === null),
    };
  });
}

const norm = (text) => String(text).trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Whether a mutant names criterion `index` (0-based) of `item`. In the item's own review a leading
 * number names it (`2`, `AC2`, `AC-2 the total`); in the intent review it carries the item
 * (`<item>:2`). The criterion's text names it in either.
 */
function names(mutant, item, index, own) {
  const said = norm(mutant.criterion);
  if (said === norm(item.criteria[index])) return true;
  const number = own ? /^(?:ac-?\s*)?#?(\d+)\b/.exec(said) : new RegExp(`^${item.id.toLowerCase()}\\s*[:#]\\s*(?:ac-?\\s*)?(\\d+)\\b`).exec(said);
  return Boolean(number) && Number(number[1]) === index + 1;
}

const LATE = " (its gate mark came after the item's first review, outside a commit of its spec alone)";

/**
 * One line per item that still owes a caught mutant or a checked pin, naming the criteria it owes.
 * `intentPins` are the intent review's pins, which its record checked. A criterion with a gate
 * mark owes none, unless the item lists its index under `late`.
 */
function mutantGaps(items, intentMutants, intentPins = []) {
  const lines = [];
  const caught = intentMutants.filter((entry) => entry.caught === 'yes');
  for (const item of items) {
    const own = [...item.mutants, ...item.pins];
    const named = (index) => own.some((entry) => names(entry, item, index, true)) ||
      [...caught, ...intentPins].some((entry) => names(entry, item, index, false));
    const late = (index) => (item.late || []).includes(index);
    const gated = (index) => gateMark(item.criteria[index]) !== null && !late(index);
    if (!item.tested) continue;
    const owed = item.criteria.map((text, index) => (gated(index) || named(index) ? null : `${index + 1} "${text}"${late(index) ? LATE : ''}`))
      .filter(Boolean);
    if (owed.length > 0) lines.push(`${item.id} owes a caught mutant or a checked pin for criteria ${owed.join(', ')}`);
  }
  return lines;
}

/** The refusal of a clean intent review while criteria owe: the reviewer proposes, the runner runs or checks. */
const gapRefusal = (gaps) => `verdict clean while ${gaps.join('; ')}. Propose one mutant for each under mutants, ` +
  'its criterion written <item>:<n>, or a pin under pins where its test pins reader-facing copy verbatim; ' +
  'the runner runs or checks each when it records this file';

module.exports = {
  NAMED, acceptanceCriteria, criteriaOf, gapRefusal, intentMoves, itemProofs, mutantGaps, names, owedProposals, recordedMutants,
};
