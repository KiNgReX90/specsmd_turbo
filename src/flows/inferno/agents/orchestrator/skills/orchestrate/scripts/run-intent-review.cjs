'use strict';

/**
 * `run.cjs review` without --item: the cold review of the whole intent, before the gate.
 *
 * It folds the base in first, so the gate's own fold is a no-op unless the base moves again,
 * and prints the reviewer dispatch line. After the reviewer writes review.yaml, the same call
 * validates it, records the tree it read and commits that one file. A fix review sends each
 * finding to the item that owns it; the next intent review reads only what changed since. The
 * dispatch names each item that settled a minor-only fix with no second item review, with the
 * range of that correction.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const gate = require('./run-gate.cjs');
const { resolveBase } = require('./run-intents.cjs');
const { hostActor, realAppLine, reviewerLines } = require('./run-review.cjs');
const { reviewerId } = require('./run-review-file.cjs');
const owed = require('./run-intent-owed.cjs');
const { gateStartCall, intentRecordCall, intentReviewCall, itemReviewCall, scanCall } = require('./run-call.cjs');
const { afterRecovery, recoverInterrupted } = require('./run-mutate.cjs');
const { intentMutants } = require('./run-review-mutants.cjs');
const { mergeSlot } = require('./run-config-gates.cjs');
const slot = require('./run-slot.cjs');
const { deferredItems } = require('./state-defer.cjs');

const { RunError } = lib;

const short = (tree, ref) => lib.git(tree, ['rev-parse', '--short', ref]);

/**
 * The tree the reviewer was dispatched on. A record binds that tree, so a commit that lands
 * between the dispatch and the record is never recorded as read. The merge slot reads the same
 * file, so an open dispatch holds the tree's ticket.
 */
const dispatchPath = slot.reviewDispatchPath;

function readDispatch(tree, intent) {
  try {
    const entry = JSON.parse(fs.readFileSync(dispatchPath(tree), 'utf8'));
    return entry && entry.intent === intent ? entry : null;
  } catch (error) {
    return null;
  }
}

function scanRefusal(tree, context, folded) {
  return {
    exit: 3,
    payload: { ok: false, intent: context.intent, owed: 'scan' },
    out: [...folded, `the scan of ${context.intent} is owed: run ${scanCall(tree)}, ` +
      'spawn the dispatch lines it prints in one message per group it names, ' +
      `run ${scanCall(tree, null, true)}, then ${intentReviewCall(tree)} again`],
  };
}

/** The review owed, from `from` to HEAD; a delta names the recorded review it answers as `previous`. */
function dispatch(tree, context, reasons, from, folded, previous = null) {
  const { intent, config, rel } = context;
  const { agent, model } = hostActor('reviewer', config);
  const range = `${short(tree, from)}..${short(tree, 'HEAD')}`;
  const dir = path.dirname(rel);
  const brief = path.join(dir, 'brief.md');
  const items = owed.intentItems(tree, intent);
  const specs = path.join(dir, 'work-items');
  // A deferred item's criteria are out of this intent, and the brief still numbers them.
  const deferred = [...deferredItems(lib.statePath(tree), intent)]
    .map(([id, why]) => `  deferred ${id}: ${why}. It is out of this intent, so judge no criterion it alone delivers`);
  const scan = owed.scanPath(tree, intent);
  const scanned = fs.existsSync(path.join(tree, scan));
  // The corrections of minor findings no item review re-read, which this reviewer reads closely.
  const settled = owed.settledItems(tree, intent, from);
  fs.mkdirSync(path.dirname(dispatchPath(tree)), { recursive: true });
  const at = { intent, head: lib.git(tree, ['rev-parse', 'HEAD']), hash: proofs.scopeHash(tree) };
  fs.writeFileSync(dispatchPath(tree), `${JSON.stringify(at)}\n`);
  return {
    exit: 3,
    payload: {
      ok: false, intent, owed: reasons, agent, model, range, previous, brief,
      specs: items.map((id) => path.join(specs, `${id}.md`)), scan: scanned ? scan : null, settled, write: rel,
    },
    out: [
      ...folded,
      ...reasons.map((reason) => `intent review owed for ${intent}: ${reason}`),
      ...reviewerLines(config, `intent ${intent}`, previous, [
        `  range ${range}`,
        ...realAppLine(tree, config, range),
        `  brief ${brief}`,
        `  specs ${specs}: ${items.map((id) => `${id}.md`).join(' ') || '(none)'}`,
        ...deferred,
        ...(scanned ? [`  scan ${scan}`] : []),
        ...settled.map((entry) => `  settled ${entry.item} ${entry.range}`),
        `  write ${rel}`,
      ]),
      `then ${intentRecordCall(tree)} records it`,
    ],
  };
}

function verdict(tree, context, review, head) {
  const { intent } = context;
  if (review.verdict === 'clean') {
    return {
      exit: 0,
      payload: { ok: true, intent, verdict: 'clean' },
      out: [head, `then ${gateStartCall(tree)}`],
    };
  }
  const out = [head];
  const owners = [...new Set(review.findings.map((finding) => finding.owner))];
  for (const owner of owners) {
    for (const finding of review.findings.filter((entry) => entry.owner === owner)) {
      out.push(`FIX ${owner}: ${finding.criterion} ${finding.file}:${finding.line}: ${finding.evidence}. fix: ${finding.fix}`);
    }
  }
  for (const mutant of review.survivors) out.push(`MUTANT ${mutant.criterion} survived: ${mutant.test}`);
  out.push('send each item its findings as one correction to its warm builder, commit, ' +
    `${itemReviewCall(tree, '<id>')}, then ${intentReviewCall(tree)} again`);
  return {
    exit: 2,
    payload: { ok: false, intent, verdict: 'fix', owners, findings: review.findings, survivors: review.survivors },
    out,
  };
}

async function record(tree, context, commit, restored) {
  const { intent, rel } = context;
  const reviewer = reviewerId(context.reviewer, intentRecordCall(tree));
  // The runner runs the mutants owed here and writes what they said into the file (run-review-mutants.cjs).
  const ran = await intentMutants(tree, context);
  const review = owed.parseFor(tree, rel, intent, false);
  const abs = path.join(tree, rel);
  const text = fs.readFileSync(abs, 'utf8');
  const outside = owed.outsideHash(tree, context.config);
  const kept = outside === null ? '' : `tree_outside: ${outside}\n`;
  fs.appendFileSync(abs, `${text.endsWith('\n') ? '' : '\n'}tree: ${proofs.scopeHash(tree)}\n${kept}commit: ${commit}\nreviewer: ${reviewer}\n`);
  lib.git(tree, ['add', '--', rel]);
  lib.git(tree, ['commit', '-q', '-m', `specsmd(${intent}): intent review ${review.verdict}`, '--', rel]);
  const result = verdict(tree, context, review, `intent review ${review.verdict}, recorded at ${short(tree, commit)}`);
  return { ...result, out: [...restored, ...ran, ...result.out] };
}

function reviewIntent(options) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const intent = owed.intentFor(tree, options);
  const config = lib.readConfig(tree, options.config);
  // Every review call is activity of the tree's merge slot ticket.
  if (mergeSlot(config)) slot.renew(tree);
  const rel = owed.intentReviewPath(tree, intent);
  const context = { intent, config, rel, reviewer: options.reviewer, configFile: options.config };

  const pending = fs.existsSync(path.join(tree, rel)) && lib.gitLines(tree, ['status', '--porcelain', '--', rel]).length > 0;
  if (pending) {
    // The reviewer read this tree as it stands; folding now would bind content it never read.
    const restored = recoverInterrupted(tree);
    const dirty = lib.dirtyPaths(tree).filter((file) => file !== rel);
    if (dirty.length > 0) {
      throw new RunError(afterRecovery(restored,
        `refusing to record the intent review over uncommitted work in ${dirty.slice(0, 5).join(', ')}: ` +
          'commit or discard it, then run this command again.'), 'DIRTY');
    }
    if (owed.scanOwed(tree, intent)) return scanRefusal(tree, context, restored);
    const sent = readDispatch(tree, intent);
    if (!sent || sent.hash !== proofs.scopeHash(tree)) {
      const since = sent ? `moved since the dispatch at ${sent.head.slice(0, 7)}` : 'has no dispatch on record';
      return {
        exit: 3,
        payload: { ok: false, intent, owed: 'dispatch', dispatched: sent && sent.head },
        out: [...restored, `the code ${since}, so ${rel} reads another tree; nothing recorded`,
          `discard the unrecorded ${rel}, then run ${intentReviewCall(tree)} for a fresh dispatch of the delta`],
      };
    }
    return record(tree, context, sent.head, restored);
  }

  const restored = gate.refuseDirty(tree);
  const base = options.base || resolveBase(config, null, tree);
  const folded = [...restored, ...gate.foldBase(tree, base)];
  if (owed.scanOwed(tree, intent)) return scanRefusal(tree, context, folded);
  const state = owed.intentReviewState(tree, config, intent);
  const current = state.review && owed.reviewCurrent(tree, config, state.review);
  if (current) {
    const head = `intent review ${state.review.verdict} for the current tree (read at ${state.review.commit.slice(0, 7)})`;
    return verdict(tree, context, state.review, `${folded.length ? `${folded[0]}; ` : ''}${head}`);
  }
  const from = state.review && state.review.commit ? state.review.commit : gate.mergeBase(tree, base);
  return dispatch(tree, context, state.owed, from, folded, state.review ? rel : null);
}

module.exports = { reviewIntent };
