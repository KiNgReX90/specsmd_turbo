'use strict';

/**
 * The fourth proof of a success criterion, beside a test, a code line and an external proof:
 * `after_ship`, for an instrument that can only run once the intent landed on the base branch,
 * such as a timer the default branch's checkout runs, a deploy, or a migration read back on the
 * live copy. Its evidence cannot exist before the merge, so the merge does not wait for it.
 *
 * The plan says so first: the brief's success criterion line ends in `(after ship)`, as an
 * acceptance criterion ends in `(gate: <name>)` (run-criterion-marks.cjs). The intent review
 * may prove only a marked criterion this way (run-intent-review-file.cjs), so the kind is never a
 * way around an evidence file the merge could have waited for. `green` names the entries whose
 * path is missing, the ship prints them as its last lines, and `run.cjs select` lists them for
 * every shipped intent until each path exists. The list lives where the shipped intent keeps
 * its record, the recorded review in its archived folder, so it is never a second copy that
 * could drift from what green checked.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { isComplete } = require('./state-transition.cjs');

/** The brief's mark: a success criterion line ending in `(after ship)`. */
const MARK = /\s\(after ship\)\s*$/;
/** Any spelling of the mark, so plan-lint can refuse one the scripts would not read. */
const NEAR = /\(\s*after[\s_-]*ship\b[^)]*\)/i;
const SC_LINE = /^- (SC-[1-9]\d*): /;
const SC_ID = /^(SC-[1-9]\d*)\b/;

/** The ids of the brief's success criteria whose line carries the mark. */
function marksIn(content) {
  const marked = new Set();
  let inside = false;
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^## /.test(line)) inside = /^## Success Criteria\s*$/.test(line);
    const id = inside && SC_LINE.exec(line.trim());
    if (id && MARK.test(line)) marked.add(id[1]);
  }
  return marked;
}

/** The marked criteria of the brief that sits beside the intent review file `rel`. */
function briefMarks(tree, rel) {
  const brief = path.join(tree, path.dirname(rel), 'brief.md');
  return fs.existsSync(brief) ? marksIn(fs.readFileSync(brief, 'utf8')) : new Set();
}

/** The SC id an intent review's criterion names, or null. */
const criterionId = (criterion) => {
  const match = SC_ID.exec(String(criterion || '').trim());
  return match ? match[1] : null;
};

/**
 * Whether an evidence path exists. A path inside the intent's own dir is found wherever the
 * intent lives now: both hosts archive that dir before they merge.
 */
function evidenceExists(tree, intentId, rel) {
  const live = `${lib.SPECS_DIR}/intents/${intentId}/`;
  const archived = `${lib.SPECS_DIR}/archive/intents/${intentId}/`;
  const candidates = [rel];
  if (rel.startsWith(live)) candidates.push(archived + rel.slice(live.length));
  if (rel.startsWith(archived)) candidates.push(live + rel.slice(archived.length));
  return candidates.some((candidate) => fs.existsSync(path.join(tree, candidate)));
}

/** The after_ship entries of a review's criteria whose evidence path does not exist yet. */
function openAfterShip(tree, intentId, criteria) {
  return (criteria || [])
    .filter((entry) => entry && entry.proof === 'after_ship' && typeof entry.evidence === 'string')
    .filter((entry) => !evidenceExists(tree, intentId, entry.evidence))
    .map((entry) => ({ criterion: String(entry.criterion), where: String(entry.where), evidence: entry.evidence }));
}

const owedLine = (entry) => `owed after ship: ${entry.where} -> ${entry.evidence}`;

/** The intent's recorded review, live or archived, or null. */
function reviewOf(root, intentId) {
  for (const base of [['intents'], ['archive', 'intents']]) {
    const file = path.join(root, lib.SPECS_DIR, ...base, intentId, 'review.yaml');
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/**
 * Every shipped intent's open after_ship entry, for `run.cjs select`: the archived intents and
 * the completed ones the live ledger still holds. A review that names no after_ship proof is
 * never parsed, and one that cannot be read lists nothing: it passed green when it shipped.
 */
function shippedOwed(root, ledger, archived) {
  const ids = [...new Set([...archived, ...ledger.intents.filter((entry) => isComplete(entry.status)).map((entry) => entry.id)])];
  const owed = [];
  for (const id of ids.sort()) {
    const file = reviewOf(root, id);
    const text = file ? fs.readFileSync(file, 'utf8') : '';
    if (!text.includes('after_ship')) continue;
    let doc;
    try {
      doc = lib.parseYaml(text);
    } catch (error) {
      continue;
    }
    const criteria = doc && Array.isArray(doc.criteria) ? doc.criteria : [];
    for (const entry of openAfterShip(root, id, criteria)) owed.push({ id, ...entry });
  }
  return owed;
}

module.exports = { MARK, NEAR, briefMarks, criterionId, evidenceExists, openAfterShip, owedLine, shippedOwed };
