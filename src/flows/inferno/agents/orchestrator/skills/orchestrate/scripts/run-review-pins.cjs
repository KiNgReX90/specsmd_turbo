'use strict';

/**
 * The runner's check of a review's pins (run-review-file.cjs PIN_KEYS), the claim that a
 * criterion's test pins reader-facing copy verbatim. A reviewer confirms such a pin by reading it,
 * because a mutant of that copy asks a question the test file already answers. Its word alone
 * does not hold the criterion: the runner checks what it can for free when it records the file.
 * The product file is no test file, the test is a test file or a test path of the item's manifest,
 * and the text stands verbatim in both, read with every run of whitespace as one space, so copy
 * a page wraps across lines still reads as the one sentence its test holds.
 *
 * A pin is checked again wherever it counts: a delta review carries the last review's pins and
 * drops one that no longer stands, and the intent review counts an item review's pin only while
 * it stands in the tree as it is.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { isTestFile } = require('./run-test-files.cjs');
const { bad, isMap } = require('./run-review-file.cjs');

const flat = (text) => String(text).replace(/\s+/g, ' ');

/** The test paths an item's manifest names under `context.tests`. */
function testPaths(spec) {
  return ((spec.manifest.context && spec.manifest.context.tests) || [])
    .map((entry) => (entry && typeof entry === 'object' ? entry.path : entry))
    .filter((entry) => typeof entry === 'string')
    .map((entry) => path.posix.normalize(entry));
}

/**
 * What keeps `pin` from standing in the tree as it is, or null. `owner` is the item the pin's
 * criterion belongs to: `{ item, tests }`, its id and the test paths of its manifest.
 */
function pinProblem(tree, pin, owner) {
  if (isTestFile(pin.file)) return `names ${pin.file} as the product file, and that is a test file`;
  if (!isTestFile(pin.test) && !owner.tests.includes(pin.test)) {
    return `names ${pin.test} as its test, and that is no test file and no test path of ${owner.item}`;
  }
  for (const file of [pin.file, pin.test]) {
    let text;
    try {
      text = fs.readFileSync(path.join(tree, file), 'utf8');
    } catch (error) {
      return `names ${file}, which is not in the tree`;
    }
    if (!flat(text).includes(flat(pin.text))) return `text does not stand verbatim in ${file}`;
  }
  return null;
}

/** Refuse the first pin that does not stand; `ownerOf(pin)` names its item. */
function checkPins(tree, rel, pins, ownerOf) {
  pins.forEach((pin, index) => {
    const problem = pinProblem(tree, pin, ownerOf(pin));
    if (problem) throw bad(rel, `pins entry ${index + 1} ${problem}`);
  });
}

/** The pins the last recorded version of `rel` holds, none when HEAD has no readable one. */
function previousPins(tree, rel) {
  const text = lib.git(tree, ['show', `HEAD:${rel.split(path.sep).join('/')}`], { tolerate: true });
  if (text === null) return [];
  try {
    const doc = lib.parseYaml(text);
    return isMap(doc) && Array.isArray(doc.pins) ? doc.pins.filter(isMap) : [];
  } catch (error) {
    return [];
  }
}

module.exports = { checkPins, pinProblem, previousPins, testPaths };
