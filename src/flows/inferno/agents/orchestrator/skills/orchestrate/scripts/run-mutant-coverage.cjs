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
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { pinProblem, testPaths } = require('./run-review-pins.cjs');

/** The criteria under `## Acceptance Criteria`, one per list line, checkbox or not. */
function acceptanceCriteria(content) {
  const section = /\n## Acceptance Criteria[ \t]*\n([\s\S]*?)(?=\n## |$)/.exec(content);
  if (!section) return [];
  return section[1].split('\n')
    .map((line) => /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
}

/** Every `key` entry (mutants or pins) an item review recorded; none when it has no review file yet. */
function recorded(tree, intentId, itemId, key) {
  for (const base of [['intents'], ['archive', 'intents']]) {
    const file = path.join(tree, lib.SPECS_DIR, ...base, intentId, 'reviews', `${itemId}.yaml`);
    if (!fs.existsSync(file)) continue;
    let doc;
    try {
      doc = lib.parseYaml(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      return [];
    }
    return doc && Array.isArray(doc[key]) ? doc[key].filter((entry) => entry && typeof entry === 'object') : [];
  }
  return [];
}

const recordedMutants = (tree, intentId, itemId) => recorded(tree, intentId, itemId, 'mutants');

/** The caught mutants an item review recorded. */
const itemMutants = (tree, intentId, itemId) => recordedMutants(tree, intentId, itemId).filter((entry) => entry.caught === 'yes');

/** The proposals an item review recorded that never ran, each with the item that owes it. */
const owedProposals = (tree, intentId, ids) => ids.flatMap((id) => recordedMutants(tree, intentId, id)
  .filter((entry) => entry.caught === undefined && typeof entry.find === 'string')
  .map((entry) => ({ item: id, entry })));

/**
 * What each item of the intent needs: its criteria, how its tests prove them, its manifest's test
 * paths, its own caught mutants and its own pins that still stand.
 */
function itemProofs(tree, intentId, ids) {
  return ids.map((id) => {
    const spec = lib.readItemSpec(tree, intentId, id);
    const tests = testPaths(spec);
    return {
      id,
      criteria: acceptanceCriteria(fs.readFileSync(spec.file, 'utf8')),
      tested: tests.length > 0,
      tests,
      mutants: itemMutants(tree, intentId, id),
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

/**
 * One line per item that still owes a caught mutant or a checked pin, naming the criteria it owes.
 * `intentPins` are the intent review's pins, which its record checked.
 */
function mutantGaps(items, intentMutants, intentPins = []) {
  const lines = [];
  const caught = intentMutants.filter((entry) => entry.caught === 'yes');
  for (const item of items) {
    const own = [...item.mutants, ...item.pins];
    const named = (index) => own.some((entry) => names(entry, item, index, true)) ||
      [...caught, ...intentPins].some((entry) => names(entry, item, index, false));
    if (!item.tested) continue;
    const owed = item.criteria.map((text, index) => (named(index) ? null : `${index + 1} "${text}"`)).filter(Boolean);
    if (owed.length > 0) lines.push(`${item.id} owes a caught mutant or a checked pin for criteria ${owed.join(', ')}`);
  }
  return lines;
}

/** The refusal of a clean intent review while criteria owe: the reviewer proposes, the runner runs or checks. */
const gapRefusal = (gaps) => `verdict clean while ${gaps.join('; ')}. Propose one mutant for each under mutants, ` +
  'its criterion written <item>:<n>, or a pin under pins where its test pins reader-facing copy verbatim; ' +
  'the runner runs or checks each when it records this file';

module.exports = { acceptanceCriteria, gapRefusal, itemProofs, mutantGaps, names, owedProposals };
