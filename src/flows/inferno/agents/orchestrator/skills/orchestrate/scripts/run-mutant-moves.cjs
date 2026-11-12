'use strict';

/**
 * The intent review's way out for an item mutant recorded under the wrong criterion.
 *
 * A review recorded before its entries repeated their criterion's words (run-criterion-says.cjs) may
 * have numbered them in the order its reviewer wrote them, so a caught mutant reads as holding a
 * criterion it never breaks. The intent review moves it, under `moved`, as an entry of its own:
 * `{from: <item>:<n as its item review recorded it>, criterion: <item>:<the n it breaks>, says: <that
 * criterion's opening words>}`, the words checked against the criterion the same way. The mutant then
 * counts for the criterion it was moved to wherever it is counted (run-mutant-coverage.cjs), as a
 * proposal still owed, and as the entry an earlier intent review ran for it. The criterion it leaves
 * is owed again unless another entry holds it, so it takes a proposal in the same file.
 *
 * Only an entry recorded without `says` moves: one that repeats its words was checked when it was
 * recorded. Every record carries the last recorded review's moves over; a move written again for
 * the same `from` replaces the one recorded.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { bad, entries, isMap, sameMutant } = require('./run-review-file.cjs');
const { NAMED, criteriaOf, names, recordedMutants } = require('./run-mutant-coverage.cjs');
const { saysProblem } = require('./run-criterion-says.cjs');
const { dump, kept } = require('./run-mutant-runs.cjs');

const MOVE_KEYS = ['from', 'criterion', 'says'];

/** The refusal's lesson where a criterion is held by an item mutant that may break another one. */
const MOVE_HOW = 'If that is an item review\'s mutant whose line breaks another criterion, move it: under moved write ' +
  'from: <item>:<n as its item review recorded it>, criterion: <item>:<the n it breaks>, says: <that criterion\'s opening words>, ' +
  'and propose for the criterion it leaves in the same file';

/** The moves of the last recorded version of `rel`, none when HEAD holds no readable one. */
function lastMoves(tree, rel) {
  const text = lib.git(tree, ['show', `HEAD:${rel.split(path.sep).join('/')}`], { tolerate: true });
  if (text === null) return [];
  try {
    const doc = lib.parseYaml(text);
    return isMap(doc) && Array.isArray(doc.moved) ? doc.moved.filter(isMap) : [];
  } catch (error) {
    return [];
  }
}

/** What is wrong with one move the reviewer wrote, or null. */
function moveProblem(tree, intent, items, entry) {
  const from = NAMED.exec(entry.from);
  if (!from) return `from reads ${entry.from}; name it <item>:<n>, the work item and the number its item review recorded`;
  const to = NAMED.exec(entry.criterion);
  if (!to) return `criterion reads ${entry.criterion}; name it <item>:<n>, the work item and the number of the criterion the mutant breaks`;
  if (!items.includes(from[1])) return `moves ${from[1]}, which is no work item of this intent`;
  if (to[1] !== from[1]) return `moves a mutant of ${from[1]} to ${to[1]}; a mutant moves within its item`;
  const criteria = criteriaOf(tree, intent, from[1]);
  const [n, m] = [Number(from[2]), Number(to[2])];
  if (m < 1 || m > criteria.length) return `names criterion ${m}, and ${from[1]} has ${criteria.length} acceptance criteria`;
  if (m === n) return `moves ${entry.from} to itself`;
  const under = recordedMutants(tree, intent, from[1]).filter((one) => names(one, { id: from[1], criteria }, n - 1, true));
  if (under.length === 0) return `moves ${entry.from}, and the review of ${from[1]} recorded no mutant under ${n}`;
  if (under.every((one) => one.says !== undefined)) {
    return `moves ${entry.from}, whose words the review of ${from[1]} checked when it recorded it; it holds the criterion it names`;
  }
  return saysProblem(from[1], criteria, m, entry.says);
}

/**
 * Before the intent review's record counts anything: hold each move the reviewer wrote to the
 * criterion it names, carry the last recorded review's moves into the pending file, and return
 * `rename`, which puts an entry an earlier intent review ran for a moved item mutant under the
 * number it was moved to. `order` is the intent review's key order.
 */
function carryMoves(tree, rel, intent, items, order) {
  const doc = lib.parseYaml(fs.readFileSync(path.join(tree, rel), 'utf8'));
  const written = entries(rel, doc, 'moved', MOVE_KEYS);
  written.forEach((entry, index) => {
    const problem = moveProblem(tree, intent, items, entry);
    if (problem) throw bad(rel, `moved entry ${index + 1} ${problem}`);
  });
  const twice = written.find((entry, index) => written.findIndex((one) => one.from === entry.from) !== index);
  if (twice) throw bad(rel, `moved holds ${twice.from} twice; move a mutant once`);
  const moves = [...lastMoves(tree, rel).filter((last) => !written.some((one) => one.from === last.from)), ...written]
    .map((entry) => Object.fromEntries(MOVE_KEYS.map((key) => [key, entry[key]])));
  if (JSON.stringify(doc.moved || []) !== JSON.stringify(moves)) {
    const next = { ...doc, moved: moves.length > 0 ? moves : undefined };
    fs.writeFileSync(path.join(tree, rel), dump(Object.fromEntries(order.filter((key) => next[key] !== undefined).map((key) => [key, next[key]]))));
  }
  // An item mutant an earlier intent review ran carries the number its item review recorded.
  const renamed = moves.flatMap((move) => {
    const [, item, n] = NAMED.exec(move.from) || [];
    if (!item || !items.includes(item)) return [];
    const criteria = criteriaOf(tree, intent, item);
    return recordedMutants(tree, intent, item)
      .filter((one) => one.says === undefined && names(one, { id: item, criteria }, Number(n) - 1, true))
      .map((one) => ({ was: { ...kept(one), criterion: `${item}:${n}` }, to: move.criterion }));
  });
  const sameWherever = (a, b) => sameMutant({ ...a, file: b.file }, b);
  return {
    rename: (list) => list.map((entry) => {
      const hit = renamed.find((one) => sameWherever(one.was, entry));
      return hit ? { ...entry, criterion: hit.to } : entry;
    }),
  };
}

module.exports = { MOVE_HOW, MOVE_KEYS, carryMoves };
