'use strict';

/**
 * The rule a delta review is held to when its file is recorded (P2 of the improvement plan): it
 * reads the fix and nothing else.
 *
 * A review file is a delta when HEAD holds a recorded version of it, one that carries the commit
 * its review read. The range is `git diff --name-only <that commit>..HEAD`, which is the fix,
 * because INFERNO commits every correction. Each finding of the file being recorded is one of:
 *
 * - The runner's: it carries `mutant`, and the runner writes it again while that mutant survives.
 *   It is left alone.
 * - An earlier one: the previous review held a finding, not the runner's, with the same
 *   `criterion`, `file`, `evidence` and `fix` (and `owner` in an intent review): what is wrong and
 *   where. It may come back whatever its severity and wherever it sits. `line` is not compared,
 *   since a fix moves lines, nor `severity`, since a still open finding may weigh otherwise after
 *   the fix, and `repeat` is a marker, not part of the finding.
 * - A new one: a `blocker` or a `major`, on a file the range lists. Never a new `minor`, and never
 *   one on a file the fix did not change.
 *
 * Only a file being recorded is held to this. A review already on record, of the released flow
 * or a delta recorded before this rule, is never read through it.
 */

const path = require('path');

const lib = require('./run-lib.cjs');

/** The fields that make a finding the one an earlier review held, per kind of review. */
const SAME_ITEM = ['criterion', 'file', 'evidence', 'fix'];
const SAME_INTENT = [...SAME_ITEM, 'owner'];

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** The recorded version of `rel` at HEAD, or null when there is none or it names no commit. */
function previousReview(tree, rel) {
  const body = lib.git(tree, ['show', `HEAD:${rel.split(path.sep).join('/')}`], { tolerate: true });
  if (body === null) return null;
  let doc;
  try {
    doc = lib.parseYaml(body);
  } catch (error) {
    return null;
  }
  return isMap(doc) && typeof doc.commit === 'string' && doc.commit.trim() !== '' ? doc : null;
}

/** The files the range changed, or null when the commit the previous review read is not in this history. */
function rangeFiles(tree, commit) {
  if (lib.git(tree, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`], { tolerate: true }) === null) return null;
  return lib.gitLines(tree, ['diff', '--name-only', `${commit}..HEAD`]);
}

/**
 * What is wrong with the findings of the review file `rel` as a delta, or null when nothing is or
 * it is no delta. `findings` are the entries the schema already checked; `same` names the fields
 * compared. The problem names the first finding that breaks the rule.
 */
function deltaProblem(tree, rel, findings, same) {
  const previous = previousReview(tree, rel);
  if (!previous) return null;
  const earlier = (Array.isArray(previous.findings) ? previous.findings : []).filter((one) => isMap(one) && one.mutant === undefined);
  const held = (finding) => earlier.some((one) => same.every((key) => text(one[key]) === text(finding[key])));
  const verbatim = `repeat an earlier finding verbatim, its ${same.join(', ')} as the previous review wrote them`;
  let range;
  for (const [index, finding] of findings.entries()) {
    if (finding.mutant !== undefined || held(finding)) continue;
    const at = `findings entry ${index + 1}`;
    if (finding.severity === 'minor') {
      return `${at} is new and minor: a delta review adds no minor. ${verbatim}, or drop it`;
    }
    if (range === undefined) range = rangeFiles(tree, previous.commit.trim());
    if (range === null) continue;
    if (!range.includes(path.posix.normalize(finding.file))) {
      const span = `${previous.commit.trim().slice(0, 7)}..${lib.git(tree, ['rev-parse', '--short', 'HEAD'])}`;
      const listed = range.filter((file) => file !== lib.SPECS_DIR && !file.startsWith(`${lib.SPECS_DIR}/`));
      return `${at} names ${finding.file}, which the range ${span} did not change: a new finding sits on a line the fix ` +
        `changed, in ${listed.join(', ') || 'no file outside the ledger'}. ${verbatim}, or drop it`;
    }
  }
  return null;
}

module.exports = { SAME_INTENT, SAME_ITEM, deltaProblem, previousReview };
