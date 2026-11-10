'use strict';

/**
 * Which acceptance criteria still owe a caught mutant before an intent review may say clean.
 *
 * The item's manifest decides by its test paths. An item with any test path owes, for every
 * criterion, a caught mutant that names it, whatever language the tests are in: the batch mutate
 * builds every Rust mutant of a review once. An item with no test path owes none. A mutant counts
 * from the item's own review or from the intent review, and only when it reads caught yes, so an
 * entry the batch gave no verdict never counts. A proposal an item review recorded without
 * `caught` never ran: the intent review's record runs it (run-review-mutants.cjs).
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');

/** The criteria under `## Acceptance Criteria`, one per list line, checkbox or not. */
function acceptanceCriteria(content) {
  const section = /\n## Acceptance Criteria[ \t]*\n([\s\S]*?)(?=\n## |$)/.exec(content);
  if (!section) return [];
  return section[1].split('\n')
    .map((line) => /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
}

/** Every mutant entry an item review recorded; none when it has no review file yet. */
function recordedMutants(tree, intentId, itemId) {
  for (const base of [['intents'], ['archive', 'intents']]) {
    const file = path.join(tree, lib.SPECS_DIR, ...base, intentId, 'reviews', `${itemId}.yaml`);
    if (!fs.existsSync(file)) continue;
    let doc;
    try {
      doc = lib.parseYaml(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      return [];
    }
    return doc && Array.isArray(doc.mutants) ? doc.mutants.filter((entry) => entry && typeof entry === 'object') : [];
  }
  return [];
}

/** The caught mutants an item review recorded. */
const itemMutants = (tree, intentId, itemId) => recordedMutants(tree, intentId, itemId).filter((entry) => entry.caught === 'yes');

/** The proposals an item review recorded that never ran, each with the item that owes it. */
const owedProposals = (tree, intentId, ids) => ids.flatMap((id) => recordedMutants(tree, intentId, id)
  .filter((entry) => entry.caught === undefined && typeof entry.find === 'string')
  .map((entry) => ({ item: id, entry })));

/** What each item of the intent needs: its criteria, how its tests prove them, its own mutants. */
function itemProofs(tree, intentId, ids) {
  return ids.map((id) => {
    const spec = lib.readItemSpec(tree, intentId, id);
    const tests = ((spec.manifest.context && spec.manifest.context.tests) || [])
      .map((entry) => (entry && typeof entry === 'object' ? entry.path : entry))
      .filter((entry) => typeof entry === 'string');
    return {
      id,
      criteria: acceptanceCriteria(fs.readFileSync(spec.file, 'utf8')),
      tested: tests.length > 0,
      mutants: itemMutants(tree, intentId, id),
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

/** One line per item that still owes a caught mutant, naming the criteria it owes. */
function mutantGaps(items, intentMutants) {
  const lines = [];
  const caught = intentMutants.filter((entry) => entry.caught === 'yes');
  for (const item of items) {
    const named = (index) => item.mutants.some((mutant) => names(mutant, item, index, true)) ||
      caught.some((mutant) => names(mutant, item, index, false));
    if (!item.tested) continue;
    const owed = item.criteria.map((text, index) => (named(index) ? null : `${index + 1} "${text}"`)).filter(Boolean);
    if (owed.length > 0) lines.push(`${item.id} owes a caught mutant for criteria ${owed.join(', ')}`);
  }
  return lines;
}

/** The refusal of a clean intent review while criteria owe: the reviewer proposes, the runner runs. */
const gapRefusal = (gaps) => `verdict clean while ${gaps.join('; ')}. Propose one mutant for each under mutants, ` +
  'its criterion written <item>:<n>; the runner runs it when it records this file';

module.exports = { acceptanceCriteria, gapRefusal, itemProofs, mutantGaps, names, owedProposals };
