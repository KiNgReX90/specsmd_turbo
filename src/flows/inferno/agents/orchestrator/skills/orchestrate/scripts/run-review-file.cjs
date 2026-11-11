'use strict';

/**
 * The review file a cold reviewer writes, and the schema it is held to.
 *
 * Split from run-review.cjs because the schema is a contract of its own: the reviewer agent
 * writes to it and the step reads it, and nothing else may ride along. An unknown key is
 * refused rather than ignored, because a key nobody reads is where a reviewer would park a
 * "residual risk" the builder never sees.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { SAME_ITEM, deltaProblem } = require('./run-review-delta.cjs');

const { RunError } = lib;

const ITEM_KEYS = ['item', 'verdict', 'files', 'findings', 'mutants', 'pins'];
/** What run.cjs adds when it records a review. A reviewer that writes them is refused. */
const RECORDED_KEYS = ['tree', 'commit', 'reviewer'];
/**
 * A reviewer's agent id as the host returns it: the id on Claude, the task path such as
 * /root/review_a_one on Codex. One token, so never the placeholder a record call prints.
 */
const AGENT_ID = /^[\w./:-]+$/;
const FINDING_KEYS = ['criterion', 'file', 'line', 'evidence', 'fix', 'severity'];
/** The severities a finding may carry, as the refusal of a finding without one names them. */
const SEVERITIES = ['blocker', 'major', 'minor'];
const SEVERITY_FIX = 'blocker when the change breaks a criterion or other behaviour, major when a criterion is unproven ' +
  'or a test proves nothing, minor for any other defect';
/**
 * A mutant as a reviewer proposes it: the criterion it breaks, a line of a file, the text on that
 * line and its broken version, and the test that should notice. The runner adds `caught` (yes, no,
 * or none when the run read no verdict, with `why`) when it runs it; an entry without `caught`
 * never ran and is owed to the intent review. A file the released flow recorded holds
 * `{criterion, test, caught}`, a mutant its reviewer ran itself, and still reads.
 */
const MUTANT_KEYS = ['criterion', 'file', 'line', 'find', 'replace', 'test'];
const TARGET_KEYS = ['file', 'line', 'find', 'replace'];
const RUNNER_KEYS = ['caught', 'why', 'was'];
const CAUGHT = ['yes', 'no', 'none'];

const PROPOSE = `propose {${MUTANT_KEYS.join(', ')}}; the runner runs it and writes caught`;
/**
 * A pin as a reviewer writes it: the criterion its test holds by pinning reader-facing copy
 * verbatim, the product file the copy stands in, that test file, and the text both hold. The
 * runner checks it when it records the file (run-review-pins.cjs), and a checked pin counts where
 * a caught mutant does. The text holds at least `PIN_WORDS` words that hold a letter, so a pin is
 * copy and never a count, a computed value or a code token, which keep their mutant.
 */
const PIN_KEYS = ['criterion', 'file', 'test', 'text'];
const PIN_WORDS = 4;

function reviewPath(intentId, itemId) {
  return path.join(lib.SPECS_DIR, 'intents', intentId, 'reviews', `${itemId}.yaml`);
}

/**
 * The agent id a review is recorded under, the reviewer that wrote it. `call` is the record call
 * to run instead.
 */
function reviewerId(value, call) {
  if (typeof value === 'string' && AGENT_ID.test(value)) return value;
  throw new RunError(`refusing to record the review without the agent id of the reviewer that wrote it${value ? `, and ${value} is none` : ''}: ` +
    `run ${call} with <agent-id> replaced by the id the host returned when it spawned the reviewer.`, 'NO_REVIEWER', 2);
}

/** The reviewer a recorded review names, or null for a record written before reviewers were. */
const recordedReviewer = (doc) => (typeof doc.reviewer === 'string' && AGENT_ID.test(doc.reviewer) ? doc.reviewer : null);

function bad(rel, problem) {
  return new RunError(`${rel}: ${problem}. send this back to the reviewer that wrote the file, then run the same command again.`, 'BAD_REVIEW', 2);
}

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A value as a refusal names it: the text, or the shape that is no text. */
function reads(value) {
  if (typeof value === 'string' && value.trim() !== '') return value;
  return Array.isArray(value) ? 'a list' : isMap(value) ? 'a map' : 'nothing';
}

/** A list field, where an empty value or `[]` is the empty list. */
function listOf(rel, doc, key) {
  const value = doc[key];
  if (value === undefined || value === '') return [];
  if (!Array.isArray(value)) throw bad(rel, `${key} must be a list`);
  return value;
}

/**
 * Every entry of a list holds `keys`, each with a value, plus at most the `optional` ones,
 * which carry a value when present. The `held` ones the caller checks itself, so its refusal
 * names what they may hold.
 */
function entries(rel, doc, key, keys, optional = [], held = []) {
  const known = [...keys, ...optional];
  return listOf(rel, doc, key).map((entry, index) => {
    if (!isMap(entry)) throw bad(rel, `${key} entry ${index + 1} must be a map of ${known.join(', ')}`);
    for (const name of Object.keys(entry)) {
      if (!known.includes(name)) throw bad(rel, `unknown key ${name} in ${key} entry ${index + 1}: it holds ${known.join(', ')} only`);
    }
    for (const name of known) {
      if (held.includes(name) || (!keys.includes(name) && entry[name] === undefined)) continue;
      if (typeof entry[name] !== 'string' || entry[name].trim() === '') {
        throw bad(rel, `${key} entry ${index + 1} has no ${name}`);
      }
    }
    return entry;
  });
}

/** A path a review names: relative, inside the tree. */
function relativePath(rel, file, what) {
  const normal = path.posix.normalize(file);
  if (path.isAbsolute(file) || normal.startsWith('../') || normal === '..') {
    throw bad(rel, `${what} names ${file}, a path outside the tree; name paths relative to the tree`);
  }
  return normal;
}

/**
 * The files a review binds: paths inside the tree and outside the ledger, and for a fresh file,
 * one being recorded, present on disk. A recorded review keeps a path that left the tree since:
 * a file deleted or renamed after its review is a file that changed, so the review's hash no
 * longer holds and the review reads as stale (itemReviewCurrent), never as a malformed file.
 */
function boundFiles(tree, rel, doc, { recorded = false } = {}) {
  const files = listOf(rel, doc, 'files');
  if (files.length === 0) throw bad(rel, 'files must list every file the review read for this item');
  for (const file of files) {
    if (typeof file !== 'string' || file.trim() === '') throw bad(rel, 'files holds paths only');
    const normal = relativePath(rel, file, 'files');
    if (normal === lib.SPECS_DIR || normal.startsWith(`${lib.SPECS_DIR}/`)) {
      throw bad(rel, `files lists ${file}; the ledger is never part of the code a review binds`);
    }
    if (!recorded && !fs.existsSync(path.join(tree, normal))) {
      throw bad(rel, `files lists ${file}, which is not in the tree; list only files the tree holds, never one the change deleted`);
    }
  }
  return [...new Set(files.map((file) => path.posix.normalize(file)))];
}

/** A review file as data; a YAML error goes back to the reviewer like any other. */
function readDoc(tree, rel) {
  try {
    return lib.parseYaml(fs.readFileSync(path.join(tree, rel), 'utf8'));
  } catch (error) {
    if (error instanceof RunError) throw bad(rel, error.message.replace(/\.$/, ''));
    throw error;
  }
}

/**
 * Read and validate one item review. `recorded` is true for a file run.cjs already recorded,
 * which carries the tree and commit it added; a fresh file may not carry them.
 */
function parseItemReview(tree, rel, itemId, { recorded }) {
  const doc = readDoc(tree, rel);
  if (!isMap(doc)) throw bad(rel, `an item review is a map of ${ITEM_KEYS.join(', ')}`);
  for (const key of Object.keys(doc)) {
    if (ITEM_KEYS.includes(key) || (recorded && RECORDED_KEYS.includes(key))) continue;
    if (RECORDED_KEYS.includes(key)) throw bad(rel, `${key} is written when the review is recorded, so drop it`);
    throw bad(rel, `unknown key ${key}: an item review holds ${ITEM_KEYS.join(', ')} only`);
  }
  if (doc.item !== itemId) throw bad(rel, `item reads ${doc.item || 'nothing'}, and this is the review of ${itemId}`);
  if (doc.verdict !== 'clean' && doc.verdict !== 'fix') throw bad(rel, 'verdict must be clean or fix');

  const files = boundFiles(tree, rel, doc, { recorded });
  const { findings, mutants, survivors } = verdictParts(rel, doc, FINDING_KEYS, ['repeat']);
  for (const [index, finding] of findings.entries()) {
    if (finding.repeat !== undefined && finding.repeat !== 'true') {
      throw bad(rel, `findings entry ${index + 1} repeat reads ${reads(finding.repeat)}; write repeat: true when an earlier ` +
        'round of this item reported the same kind, or leave it out');
    }
  }
  // A delta review being recorded reads the fix and nothing else (run-review-delta.cjs).
  const delta = recorded ? null : deltaProblem(tree, rel, findings, SAME_ITEM);
  if (delta) throw bad(rel, delta);
  const pins = pinsOf(rel, doc);
  return { item: itemId, verdict: doc.verdict, files, findings, mutants, survivors, pins, reviewer: recorded ? recordedReviewer(doc) : null };
}

/**
 * What a fix review weighs on the ladder, read from the one reading of both lenses
 * (readItemReview in run-review-quality.cjs). It counts when a finding of either lens is blocker
 * or major, or a mutant survived; minor findings alone do not. A finding that repeats an earlier
 * round sends the review to the oracle, whatever it counts.
 */
function weightOf(review) {
  const serious = review.survivors.length > 0 || review.findings.some((finding) => finding.severity !== 'minor');
  const repeat = review.findings.some((finding) => finding.repeat === 'true');
  return { serious, weight: repeat ? 'repeat' : serious ? 'serious' : 'minor' };
}

/**
 * The mutants of a review, in either shape: a proposal the runner ran or still owes, or a mutant
 * the released flow's reviewer ran itself. `replace` may be empty, since dropping text is a mistake.
 */
function mutantsOf(rel, doc) {
  return entries(rel, doc, 'mutants', ['criterion', 'test'], [...TARGET_KEYS, ...RUNNER_KEYS], ['replace']).map((mutant, index) => {
    const at = `mutants entry ${index + 1}`;
    const targeted = TARGET_KEYS.some((key) => mutant[key] !== undefined);
    if (targeted) {
      const missing = TARGET_KEYS.find((key) => mutant[key] === undefined);
      if (missing) throw bad(rel, `${at} has no ${missing}: ${PROPOSE}`);
      if (typeof mutant.replace !== 'string') throw bad(rel, `${at} replace must be text, empty to drop find`);
      if (!/^\d+$/.test(mutant.line)) throw bad(rel, `${at} line must be a line number, not ${mutant.line}`);
    }
    if (mutant.caught !== undefined && !CAUGHT.includes(mutant.caught)) throw bad(rel, `${at} caught must be yes, no or none`);
    if (!targeted && mutant.caught !== 'yes' && mutant.caught !== 'no') throw bad(rel, `${at} has no file: ${PROPOSE}`);
    if ((mutant.why !== undefined) !== (mutant.caught === 'none')) throw bad(rel, `${at} carries why exactly when caught reads none`);
    return mutant;
  });
}

/** The words of a pin's text that hold a letter. */
const pinWords = (text) => text.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length;

/**
 * The pins of a review, held to their shape: paths inside the tree and outside the ledger, and a
 * text of copy. `criterionOf` names what is wrong with a criterion's name, as for a proposal; a
 * recorded file was named when it was recorded, so its read leaves it out.
 */
function pinsOf(rel, doc, criterionOf = () => null) {
  return entries(rel, doc, 'pins', PIN_KEYS).map((pin, index) => {
    const at = `pins entry ${index + 1}`;
    const problem = criterionOf(pin.criterion);
    if (problem) throw bad(rel, `${at} ${problem}`);
    const [file, test] = [relativePath(rel, pin.file, at), relativePath(rel, pin.test, at)];
    const ledger = [file, test].find((name) => name === lib.SPECS_DIR || name.startsWith(`${lib.SPECS_DIR}/`));
    if (ledger) throw bad(rel, `${at} names ${ledger}; a pin reads the code, never the ledger`);
    const words = pinWords(pin.text);
    if (words < PIN_WORDS) {
      throw bad(rel, `${at} text holds ${words} word${words === 1 ? '' : 's'}; a pin holds reader-facing copy of at least ${PIN_WORDS}, ` +
        'and a pattern, a count or a computed value keeps its mutant');
    }
    return { criterion: pin.criterion, file, test, text: pin.text };
  });
}

/** Two pins are one when they name the same criterion, files and text. */
const samePin = (a, b) => PIN_KEYS.every((key) => (a[key] || '') === (b[key] || ''));

/**
 * Two mutants are one when they break the same text the same way for the same test; a moved line
 * is the same mutant, and so is a survivor given another test, which keeps its first as `was`.
 */
const testsOf = (mutant) => [mutant.test || '', ...(mutant.was ? [mutant.was] : [])];
const sameMutant = (a, b) => ['criterion', 'file', 'find', 'replace'].every((key) => (a[key] || '') === (b[key] || '')) &&
  testsOf(a).some((test) => testsOf(b).includes(test));

/**
 * The proposals of a review as it is recorded: whole mistakes on code, each named by
 * `criterionOf` (null when the name holds, else what is wrong with it), one per criterion. What
 * the runner writes is left out, so a record run twice runs the same proposals. `held` names an
 * entry the runner holds already, such as one it carried over, which is no proposal.
 */
function proposalsOf(rel, doc, criterionOf, held = () => false) {
  const proposals = mutantsOf(rel, doc).flatMap((mutant, index) => {
    if (held(mutant)) return [];
    const at = `mutants entry ${index + 1}`;
    if (mutant.find === undefined) throw bad(rel, `${at} has no file: ${PROPOSE}`);
    const problem = criterionOf(mutant.criterion);
    if (problem) throw bad(rel, `${at} ${problem}`);
    const file = relativePath(rel, mutant.file, at);
    if (file === lib.SPECS_DIR || file.startsWith(`${lib.SPECS_DIR}/`)) throw bad(rel, `${at} breaks ${file}; a mutant breaks the code, never the ledger`);
    return [Object.fromEntries(MUTANT_KEYS.map((key) => [key, key === 'file' ? file : mutant[key]]))];
  });
  const counts = new Map();
  for (const { criterion } of proposals) counts.set(criterion, (counts.get(criterion) || 0) + 1);
  const twice = [...counts].find(([, count]) => count > 1);
  if (twice) throw bad(rel, `criterion ${twice[0]} has ${twice[1]} mutants; propose one per criterion`);
  return proposals;
}

/**
 * The marker that opens a comment line, by the file's extension or its whole name, for the languages
 * a name tells. A file of any other language is not judged.
 */
const COMMENT_MARKERS = new Map([
  ['#', 'py pyi sh bash zsh rb pl pm r yaml yml toml tf ps1 nix ex exs jl coffee cmake mk makefile dockerfile'],
  ['//', 'js cjs mjs jsx ts tsx mts cts java kt kts scala groovy gradle c h cc cpp cxx hpp hh cs go rs swift dart php proto zig sol scss less jsonc'],
  ['--', 'sql lua hs elm ada adb ads vhd vhdl'],
].flatMap(([marker, names]) => names.split(' ').map((name) => [name, marker])));

/** The comment marker `text`, a line of `file`, opens with after its indent, or null. */
function commentMarker(file, text) {
  const name = path.posix.basename(file).toLowerCase();
  const marker = COMMENT_MARKERS.get(name.slice(name.lastIndexOf('.') + 1));
  return marker && text.trimStart().startsWith(marker) ? marker : null;
}

/**
 * Refuse a proposal on a comment line: no test can tell it from the original, so it survives and
 * proves nothing. A file or line the tree does not hold is left to the batch's own refusal.
 */
function refuseComments(tree, rel, proposals) {
  proposals.forEach((proposal, index) => {
    let lines;
    try {
      lines = fs.readFileSync(path.join(tree, proposal.file), 'utf8').split('\n');
    } catch (error) {
      return;
    }
    const marker = commentMarker(proposal.file, lines[Number(proposal.line) - 1] || '');
    if (marker) {
      throw bad(rel, `mutants entry ${index + 1} breaks ${proposal.file}:${proposal.line}, a line that opens with the comment marker ${marker}, ` +
        'so no test can tell; propose a mutant on a line that runs');
    }
  });
}

/** How a first item review names a criterion: its number alone, among the item's `count`. */
const itemCriterion = (itemId, count) => (text) => {
  if (!/^\d+$/.test(text)) return `criterion reads ${text}; name the acceptance criterion by its number alone, 1 for the first`;
  const n = Number(text);
  return n >= 1 && n <= count ? null : `names criterion ${n}, and ${itemId} has ${count} acceptance criteria`;
};

/** A delta review holds no mutant the last review did not hold: the runner carries those over itself. */
function refuseNew(rel, doc, previous) {
  mutantsOf(rel, doc).forEach((mutant, index) => {
    if (previous.some((entry) => sameMutant(entry, mutant))) return;
    throw bad(rel, `mutants entry ${index + 1} is new: a delta review proposes no mutant. Leave mutants out: the runner carries ` +
      'the last review\'s over and reruns its survivors, and a criterion still without a caught mutant or a checked pin is the intent review\'s');
  });
}

/**
 * The findings and mutants of an item or intent review, held to its verdict. A surviving
 * mutant is a finding too: a test that misses a broken criterion proves nothing.
 */
function verdictParts(rel, doc, findingKeys, optional = []) {
  // Severity is held below, so a finding without one is refused with the three it may carry.
  const required = findingKeys.filter((key) => key !== 'severity');
  const findings = entries(rel, doc, 'findings', required, ['severity', ...optional, 'mutant'], ['severity', ...optional]);
  for (const [index, finding] of findings.entries()) {
    if (!/^\d+$/.test(finding.line)) throw bad(rel, `finding line must be a line number, not ${finding.line}`);
    if (!SEVERITIES.includes(finding.severity)) {
      throw bad(rel, `findings entry ${index + 1} severity reads ${reads(finding.severity)}; it must be ${SEVERITY_FIX}`);
    }
  }
  const mutants = mutantsOf(rel, doc);
  const survivors = mutants.filter((mutant) => mutant.caught === 'no');
  if (doc.verdict === 'clean' && findings.length > 0) {
    throw bad(rel, `verdict clean with ${findings.length} finding(s); a review with a finding says fix`);
  }
  if (doc.verdict === 'clean' && survivors.length > 0) {
    throw bad(rel, 'verdict clean with a mutant that reads caught: no; a surviving mutant says fix, and the runner writes caught itself, ' +
      'so a review it records leaves caught out');
  }
  // An intent review whose every finding is deferred stays fix while a criterion owes a proof (state-defer-finding.cjs).
  if (doc.verdict === 'fix' && findings.length === 0 && survivors.length === 0 && listOf(rel, doc, 'deferred').length === 0) {
    throw bad(rel, 'verdict fix with no finding and no surviving mutant; name what to fix or say clean');
  }
  return { findings, mutants, survivors };
}

module.exports = {
  FINDING_KEYS, ITEM_KEYS, MUTANT_KEYS, PIN_KEYS, RECORDED_KEYS, SEVERITIES, bad, boundFiles, commentMarker, entries, isMap, itemCriterion, mutantsOf,
  parseItemReview, pinsOf, proposalsOf, readDoc, recordedReviewer, refuseComments, refuseNew, relativePath, reviewPath, reviewerId, sameMutant, samePin,
  verdictParts, weightOf,
};
