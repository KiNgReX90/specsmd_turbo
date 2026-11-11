'use strict';

/**
 * The quality lens beside the contract review of an item (P6 of the improvement plan).
 *
 * The contract reviewer asks whether the item does what its spec says and its tests prove it.
 * The quality reviewer, `reviewer-quality`, asks whether the production code is correct, safe
 * and well written beyond what those tests reach, against the project's rule files that apply.
 * Both read the same change at the same time and each writes its own file:
 *
 *   .specs-inferno/intents/<intent>/reviews/<item>.yaml           the contract lens
 *   .specs-inferno/intents/<intent>/reviews/quality/<item>.yaml   the quality lens
 *
 * The step reads the two as one review (mergeReviews): `fix` when either says so, the files of
 * both, and the same fault from both lenses, the same file and line, once at the higher
 * severity. Every reader of an item's review reads that one reading (readItemReview), so the
 * ledger's hash, the weight on the ladder, the settle rule and the builder's findings agree.
 *
 * The lens is owed by an item with production code in its change (qualityLens), and by an item
 * whose quality file exists, so a lens that read the item once re-reads it in every delta. The
 * review step notes which lenses it dispatched (noteDispatched) in the machine's run cache,
 * beside the dispatch log, and the record step waits for each of them.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { bad, boundFiles, entries, isMap, parseItemReview, readDoc, recordedReviewer, reviewPath, verdictParts, RECORDED_KEYS } =
  require('./run-review-file.cjs');
const { deltaProblem, previousReview } = require('./run-review-delta.cjs');
const { itemRecordCall } = require('./run-call.cjs');
const { standardsFor } = require('./run-standards.cjs');

const { RunError } = lib;

const QUALITY_KEYS = ['item', 'verdict', 'files', 'findings', 'lint'];
const QUALITY_FINDING_KEYS = ['id', 'check', 'file', 'line', 'evidence', 'fix', 'severity'];
const QUALITY_OPTIONAL = ['rule', 'oracle', 'repeat'];
const CHECKS = ['correctness', 'errors', 'security', 'fit', 'readability', 'cost', 'leftovers', 'rule', 'lint'];
/** The fields that make a quality finding the one its previous review held (run-review-delta.cjs). */
const SAME_QUALITY = ['id', 'check', 'file', 'evidence', 'fix'];
const RANK = { minor: 1, major: 2, blocker: 3 };

/** The line printed under two dispatches: the lenses read the change side by side. */
const ONE_MESSAGE = 'send both dispatches in one message: the two lenses read the change side by side, and each writes its own file';

function qualityPath(intentId, itemId) {
  return path.join(lib.SPECS_DIR, 'intents', intentId, 'reviews', 'quality', `${itemId}.yaml`);
}

// --- which items the lens reads ------------------------------------------------------------

const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.rst', '.adoc', '.txt']);
const DOC_NAMES = new Set(['readme', 'license', 'licence', 'changelog', 'authors', 'notice', 'contributing', 'copying']);
const CONFIG_EXTENSIONS = new Set(['.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.properties', '.lock']);

/** A document: prose by its extension, or one of the plain-text files a repository names by convention. */
function isDoc(file) {
  const base = path.posix.basename(file).toLowerCase();
  return DOC_EXTENSIONS.has(path.posix.extname(base)) || DOC_NAMES.has(base);
}

/**
 * Configuration: data by its extension, a dot file with no further extension such as
 * `.gitignore`, or an env file. A config written as code, such as `vite.config.ts`, is code.
 */
function isConfig(file) {
  const base = path.posix.basename(file).toLowerCase();
  if (/^\.env(\..+)?$/.test(base)) return true;
  if (base.startsWith('.') && !base.slice(1).includes('.')) return true;
  return CONFIG_EXTENSIONS.has(path.posix.extname(base));
}

const inLedger = (file) => file === lib.SPECS_DIR || file.startsWith(`${lib.SPECS_DIR}/`);

/**
 * Whether an item gets the quality lens: never one of kind `test`, and else only one whose
 * changed paths hold production code, a path that is neither a document nor configuration.
 * The kind an item claims decides nothing else, and one production file among any number of
 * documents or config files keeps the lens, so no item escapes it by what it touches beside.
 */
function qualityLens(kind, paths) {
  if (String(kind || '').toLowerCase() === 'test') return false;
  return (paths || []).some((file) => !inLedger(file) && !isDoc(file) && !isConfig(file));
}

/** The paths the item changed since `from`: every changed file it owns. */
function changedPaths(tree, from, editable) {
  return lib.gitLines(tree, ['diff', '--name-only', '--no-renames', `${from}..HEAD`], { tolerate: true })
    .filter((file) => lib.ownedBy(file, editable, tree));
}

/**
 * Whether a review of the item owes the quality lens: its change since `fork` holds production
 * code, or the lens read it before, so the lens re-reads its own findings in every delta, a
 * clean one too, since the fix is production code only this lens judges for soundness.
 */
function qualityOwed(tree, context, fork) {
  return qualityLens(context.item.kind, changedPaths(tree, fork, context.editable)) ||
    fs.existsSync(path.join(tree, context.qualityRel));
}

// --- what the dispatch carries ---------------------------------------------------------------

/** The lint and analysis commands of the host config, `verification.lint`, one dispatch line each. */
function lintCommands(config, label) {
  const verification = config && config.verification;
  const lint = verification && typeof verification === 'object' ? verification.lint : undefined;
  if (lint === undefined || lint === null || lint === '') return [];
  if (!Array.isArray(lint) || !lint.every((command) => typeof command === 'string' && command.trim() !== '')) {
    throw new RunError(`verification.lint in ${label} must be a list of shell commands, one per line under a dash.`, 'BAD_CONFIG');
  }
  return lint;
}

/**
 * The lines under the quality dispatch line: its range and paths (`ranged`, as run-review.cjs
 * prints them for both lenses), the spec and the brief, one `standards` line per rule file that
 * applies to those paths, one `lint` line per host command, and the file to write. No proof and
 * no real-app line: those are the contract lens's.
 */
function qualityBody(tree, context, { ranged, read, spec, brief }) {
  const standards = standardsFor(tree, read, { config: context.configFile });
  const lint = lintCommands(context.config, context.configFile || path.join(lib.SPECS_DIR, 'config.yaml'));
  const lines = [
    ...ranged,
    `  spec ${spec}`,
    `  brief ${brief}`,
    ...standards.map((file) => `  standards ${file}`),
    ...lint.map((command) => `  lint ${command}`),
    `  write ${context.qualityRel}`,
  ];
  return { lines, standards, lint };
}

// --- the lenses dispatched ---------------------------------------------------------------------

const LENSES = ['contract', 'quality'];

function dispatchRecord(tree, intentId, itemId) {
  return path.join(lib.cacheDir(tree), 'review-lenses', intentId, `${itemId}.json`);
}

/** Note the lenses a review dispatch printed, so the record step waits for each of them. */
function noteDispatched(tree, intentId, itemId, lenses) {
  const file = dispatchRecord(tree, intentId, itemId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ lenses })}\n`, 'utf8');
}

/**
 * The lenses the last review dispatch of the item printed. Without a record, as for a review
 * dispatched by the released flow, the contract lens alone.
 */
function dispatchedLenses(tree, intentId, itemId) {
  const file = dispatchRecord(tree, intentId, itemId);
  const { lenses } = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { lenses: [] };
  return LENSES.filter((lens) => lens === 'contract' || lenses.includes(lens));
}

/**
 * The refusal of a record that waits on a lens, or null when every lens the dispatch printed
 * (`context.dispatched`) has written its file since. Nothing reaches the ledger before. The
 * refusal names each missing file and its dispatch again, through `dispatch(lens, span)`, over the
 * range that dispatch read: the fix since the review on record, else the item from `fork()`.
 */
function lensesWaiting(tree, context, { fork, dispatch }) {
  const { item, rel, qualityRel, dispatched } = context;
  const fileOf = (lens) => (lens === 'quality' ? qualityRel : rel);
  const missing = dispatched.filter((lens) => !context.isPending(fileOf(lens)));
  if (missing.length === 0) return null;
  const recorded = item.review ? [rel, qualityRel].map((file) => previousReview(tree, file)).filter(Boolean) : [];
  let span = { from: fork(), paths: context.editable };
  if (recorded.length > 0) {
    const from = recorded[0].commit.trim();
    const listed = recorded.flatMap((doc) => (Array.isArray(doc.files) ? doc.files : []));
    const since = lib.gitLines(tree, ['diff', '--name-only', `${from}..HEAD`], { tolerate: true })
      .filter((file) => lib.ownedBy(file, context.editable) || listed.includes(file));
    span = { from, paths: [...new Set([...listed, ...since])] };
  }
  const files = missing.map(fileOf);
  return {
    exit: 3,
    payload: { ok: false, item: item.id, owed: 'lens', missing: files },
    out: [
      `refusing to record the review of ${item.id}: ${files.join(' and ')} ${files.length > 1 ? 'are' : 'is'} not written, and nothing is ` +
        'recorded before every lens dispatched has written its file. Send this dispatch again',
      ...missing.flatMap((lens) => dispatch(lens, span)),
      `then ${itemRecordCall(tree, item.id, null, dispatched.includes('quality'))} records ${dispatched.length > 1 ? 'both files' : 'it'}`,
    ],
  };
}

/** The agent id the quality review is recorded under, the quality reviewer that wrote it. */
function qualityReviewerId(value, call) {
  if (typeof value === 'string' && /^[\w./:-]+$/.test(value)) return value;
  throw new RunError(`refusing to record the review without the agent id of the quality reviewer that wrote its file` +
    `${value ? `, and ${value} is none` : ''}: run ${call} with <quality-agent-id> replaced by the id the host returned ` +
    'when it spawned the quality reviewer.', 'NO_REVIEWER', 2);
}

// --- the file -------------------------------------------------------------------------------

/**
 * Read and validate one quality review. `recorded` is true for a file run.cjs already recorded,
 * which may carry the tree, commit and reviewer it added; a file being recorded is held to the
 * delta rule of run-review-delta.cjs against its own previous version.
 */
function parseQualityReview(tree, rel, itemId, { recorded }) {
  const doc = readDoc(tree, rel);
  if (!isMap(doc)) throw bad(rel, `a quality review is a map of ${QUALITY_KEYS.join(', ')}`);
  for (const key of Object.keys(doc)) {
    if (QUALITY_KEYS.includes(key) || (recorded && RECORDED_KEYS.includes(key))) continue;
    if (RECORDED_KEYS.includes(key)) throw bad(rel, `${key} is written when the review is recorded, so drop it`);
    throw bad(rel, `unknown key ${key}: a quality review holds ${QUALITY_KEYS.join(', ')} only`);
  }
  if (doc.item !== itemId) throw bad(rel, `item reads ${doc.item || 'nothing'}, and this is the review of ${itemId}`);
  if (doc.verdict !== 'clean' && doc.verdict !== 'fix') throw bad(rel, 'verdict must be clean or fix');
  const files = boundFiles(tree, rel, doc, { recorded });
  const { findings } = verdictParts(rel, doc, QUALITY_FINDING_KEYS, QUALITY_OPTIONAL);
  const ids = new Set();
  for (const [index, finding] of findings.entries()) {
    const at = `findings entry ${index + 1}`;
    if (finding.mutant !== undefined) throw bad(rel, `${at} names a mutant; the quality lens proposes none, the contract lens does`);
    if (!/^Q\d+$/.test(finding.id)) throw bad(rel, `${at} id reads ${finding.id}; quality finding ids run Q1, Q2 and on`);
    if (ids.has(finding.id)) throw bad(rel, `${at} repeats the id ${finding.id}`);
    ids.add(finding.id);
    if (!CHECKS.includes(finding.check)) throw bad(rel, `${at} check reads ${finding.check}; it must be one of ${CHECKS.join(', ')}`);
    for (const flag of ['repeat', 'oracle']) {
      if (finding[flag] !== undefined && finding[flag] !== 'true') throw bad(rel, `${at} ${flag} reads ${finding[flag]}; write ${flag}: true or leave it out`);
    }
    if (finding.check === 'rule' && (typeof finding.rule !== 'string' || finding.rule.trim() === '')) throw bad(rel, `${at} is a rule finding and names no rule: write the standards file and the heading`);
    if (finding.check !== 'rule' && (finding.rule !== undefined || finding.oracle !== undefined)) {
      throw bad(rel, `${at} carries rule or oracle, which stand only on a rule finding`);
    }
  }
  const lint = lintEntries(rel, doc, ids);
  const delta = recorded ? null : deltaProblem(tree, rel, findings, SAME_QUALITY);
  if (delta) throw bad(rel, delta);
  return { item: itemId, verdict: doc.verdict, files, findings, lint, reviewer: recorded ? recordedReviewer(doc) : null };
}

/** The lint commands the reviewer ran: each with its exit code and the ids of the findings it gave. */
function lintEntries(rel, doc, ids) {
  return entries(rel, doc, 'lint', ['command', 'exit'], ['taken'], ['taken']).map((entry, index) => {
    const at = `lint entry ${index + 1}`;
    if (!/^-?\d+$/.test(entry.exit)) throw bad(rel, `${at} exit must be the command's exit code, not ${entry.exit}`);
    const taken = entry.taken === undefined || entry.taken === '' ? [] : entry.taken;
    if (!Array.isArray(taken)) throw bad(rel, `${at} taken must be a list of finding ids`);
    const unknown = taken.find((id) => !ids.has(id));
    if (unknown !== undefined) throw bad(rel, `${at} taken names ${unknown}, which no finding of this file carries`);
    return { command: entry.command, exit: entry.exit, taken };
  });
}

/** The quality review of an item, or null when the lens never wrote one. */
function readQuality(tree, rel, itemId, options) {
  return fs.existsSync(path.join(tree, rel)) ? parseQualityReview(tree, rel, itemId, options) : null;
}

// --- one reading of both -------------------------------------------------------------------------

const where = (finding) => `${path.posix.normalize(finding.file)}:${finding.line}`;

/**
 * The two files as one review. `fix` when either says so; the files of both; the contract
 * lens's findings, mutants, survivors and pins, then the quality lens's findings, a finding on
 * the same file and line as one of the contract lens's going out once, at the higher severity,
 * marked a repeat when either was. Without a quality file it is the contract review itself.
 */
function mergeReviews(contract, quality) {
  if (!quality) return contract;
  const findings = [...contract.findings];
  for (const finding of quality.findings) {
    const index = findings.findIndex((one) => where(one) === where(finding));
    if (index === -1) {
      findings.push(finding);
      continue;
    }
    const kept = RANK[finding.severity] > RANK[findings[index].severity] ? finding : findings[index];
    const repeat = findings[index].repeat === 'true' || finding.repeat === 'true';
    findings[index] = repeat ? { ...kept, repeat: 'true' } : kept;
  }
  return {
    ...contract,
    verdict: contract.verdict === 'fix' || quality.verdict === 'fix' ? 'fix' : 'clean',
    files: [...new Set([...contract.files, ...quality.files])],
    findings,
  };
}

/** The one reading of an item's review, both lenses, as every reader of it takes it. */
function readItemReview(tree, intentId, itemId, options) {
  const contract = parseItemReview(tree, reviewPath(intentId, itemId), itemId, options);
  return mergeReviews(contract, readQuality(tree, qualityPath(intentId, itemId), itemId, options));
}

/** How a finding of either lens names itself to the builder. */
function findingLabel(finding) {
  if (finding.criterion !== undefined) return finding.criterion;
  return `${finding.id} ${finding.check}${finding.rule ? ` (${finding.rule})` : ''}`;
}

module.exports = {
  CHECKS, ONE_MESSAGE, QUALITY_FINDING_KEYS, QUALITY_KEYS, SAME_QUALITY, changedPaths, dispatchedLenses, findingLabel, isConfig, isDoc,
  lensesWaiting, lintCommands, mergeReviews, noteDispatched, parseQualityReview, qualityBody, qualityLens, qualityOwed, qualityPath,
  qualityReviewerId, readItemReview, readQuality,
};
