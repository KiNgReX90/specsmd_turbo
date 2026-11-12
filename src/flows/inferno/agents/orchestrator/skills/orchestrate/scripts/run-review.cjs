'use strict';

/**
 * `run.cjs review --item`: the cold review every item gets before it lands, and the ladder
 * that says who builds the item next.
 *
 * The order per item: the builder returns, the orchestrator commits the item, this step
 * prints the reviewer dispatch lines, one per lens (the contract lens, and the quality lens of
 * run-review-quality.cjs for an item with production code), each reviewer writes its file, and
 * the same step validates them, runs the contract lens's mutants (run-review-mutants.cjs), and
 * records and commits both as one review. A clean review lets `integrate --item` land the
 * item. A fix review goes back to the builder the ladder names (run-review-ladder.cjs), and the
 * next review reads only what changed since. A fix review whose findings are all minor gets no
 * second review: once the warm builder's correction stays inside the files it lists and
 * verify-item proved it, this step records the item `settled` and integrate lands it.
 *
 * The review binds the files it lists, never the whole tree: items build in parallel in one
 * worktree, and another item's commit must not void this one's review.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const writer = require('./state-transition.cjs');
const { afterRecovery, recoverInterrupted } = require('./run-mutate.cjs');
const { bad, parseItemReview, reviewPath, reviewerId } = require('./run-review-file.cjs');
const { REINSTALL, completedBeforeReviewRule, reviewLands, reviewRuleSince } = require('./state-review.cjs');
const { integrateCall, itemRecordCall, itemReviewCall, realAppCall, verifyItemCall } = require('./run-call.cjs');
const { realAppPaths } = require('./run-real-app.cjs');
const { filesHash, itemReviewCurrent } = require('./run-review-hash.cjs');
const { itemMutants } = require('./run-review-mutants.cjs');
const { acceptanceCriteria } = require('./run-mutant-coverage.cjs');
const { criteriaLines } = require('./run-criterion-says.cjs');
const { dirtyFiles } = require('./run-dirt.cjs');
const { previousReview } = require('./run-review-delta.cjs');
const ladder = require('./run-review-ladder.cjs');
const lens = require('./run-review-quality.cjs');
const { changedSince, dispatchClaims, goneFiles, goneLine, itemFiles, rangeLines } = require('./run-review-span.cjs');

const { builtBy, hostActor, nextActor, nextLine } = ladder;

const { RunError } = lib;

/**
 * The lines that reach the reviewer of a review owed, `subject` naming the item or the intent.
 * Every review is a fresh dispatch: a resumed reviewer carries the context of every round before
 * into the next, and a delta review reads the fix and nothing else. `previous` is the review file
 * a delta review answers, the one at `write`, named so the reviewer reads its findings first; a
 * first review has none. `actor` is `quality` for the quality lens.
 */
function reviewerLines(config, subject, previous, body, actor = 'reviewer') {
  const { agent, model } = hostActor(actor, config);
  return [`dispatch ${agent}${model ? ` model ${model}` : ''} ${subject}`, ...(previous ? [`  previous ${previous}`] : []), ...body];
}

function itemOf(ledger, id, options) {
  const intent = options.intent
    ? lib.findIntent(ledger, options.intent)
    : ledger.intents.find((entry) => entry.items.some((item) => item.id === id));
  const item = intent && intent.items.find((entry) => entry.id === id);
  if (!item) throw new RunError(`work item not found in the live ledger: ${id}`, 'ITEM_NOT_FOUND');
  if (writer.isDeferred(item.status)) {
    throw new RunError(`${id} is deferred out of ${intent.id}: it owes no review and no integrate, and nothing lands for it`, 'ITEM_DEFERRED');
  }
  return { intent, item };
}

const short = (tree, ref) => lib.git(tree, ['rev-parse', '--short', ref]);

/** Where the item's work starts: the merge base with the base branch. */
function forkPoint(tree, config, intent) {
  // Required here, not at the top: run-intents loads run-frontier, which loads this file.
  const { resolveBase } = require('./run-intents.cjs');
  const base = resolveBase(config, intent, tree);
  return lib.git(tree, ['merge-base', 'HEAD', base], { tolerate: true }) || 'HEAD';
}

/** The real-app check a reviewer runs, on a host that names its real-app helpers. */
function realAppLine(tree, config, range, id = null) {
  return realAppPaths(config, path.join(lib.SPECS_DIR, 'config.yaml')).length > 0 ? [`  real-app ${realAppCall(tree, range, id)}`] : [];
}

/**
 * The review owed, from `from` to HEAD. After a recorded review `from` is the commit it read, so
 * the range is the fix, and the dispatch names that review as the previous one.
 *
 * The dispatch names the proof verify-item wrote only when it was taken over the item as HEAD
 * holds it (run-item-proof.cjs), and a first review then reads the range and paths of the proof's
 * own diff. A proof of an older state is never named: the review waits on the verify-item call
 * that writes a current one. With no proof, as on a tree the released flow verified, the
 * dispatch goes out without the line and its reviewer runs the item's tests itself.
 *
 * An item with production code gets the quality lens's dispatch beside the contract lens's,
 * both to go out in one message, and the lenses printed are noted so the record waits for each.
 */
function owed(tree, context, reason, from, paths) {
  const { intent, item } = context;
  const proof = itemProof(tree, context);
  const verify = verifyItemCall(tree, proof.items);
  if (proof.state === 'stale') {
    return {
      exit: 3,
      payload: { ok: false, item: item.id, owed: 'verify-item', proof: null, stale: proof.file, verify },
      out: [
        `verify-item owed for ${item.id} before its review: ${proof.why || `its proof ${proof.file} was taken over an older state of its paths, ` +
          'so no reviewer may read it'}`,
        `then ${verify}, then ${itemReviewCall(tree, item.id)}`,
      ],
    };
  }
  const lenses = ['contract', ...(lens.qualityOwed(tree, context, forkPoint(tree, context.config, intent)) ? ['quality'] : [])];
  const [contract, quality] = lenses.map((one) => lensDispatch(tree, context, one, { from, paths }, proof));
  lens.noteDispatched(tree, intent.id, item.id, lenses);
  const named = contract.payload.proof;
  return {
    exit: 3,
    payload: { ok: false, item: item.id, owed: reason, ...contract.payload, quality: quality ? quality.payload : null },
    out: [
      `review owed for ${item.id}: ${reason}`,
      ...contract.lines,
      ...(quality ? [...quality.lines, lens.ONE_MESSAGE] : []),
      `then ${itemRecordCall(tree, item.id, null, Boolean(quality))} records ${quality ? 'both files' : 'it'}; ` +
        'it runs the review\'s mutants first, so give it the time those tests take',
      ...(named ? [] : [`no proof for ${item.id}, so its reviewer runs the item's tests itself: ${verify} writes one, and review again names it`]),
    ],
  };
}

function itemProof(tree, context) {
  // Required here, not at the top: run-item-proof loads run-intents, which loads this file.
  const { proofAtHead } = require('./run-item-proof.cjs');
  return proofAtHead(tree, context.intent.id, context.item.id, context.config);
}

/**
 * The dispatch of one lens and its payload. A lens with a file on record reads `span`, the fix,
 * and names that file as its previous one. A first review reads the proof's own diff when one is
 * current, else `span`; the quality lens reading an item for the first time beside a contract
 * delta, as after a review the released flow recorded, reads the whole item from its fork point.
 */
function lensDispatch(tree, context, which, span, proof) {
  const { intent, item, config } = context;
  const quality = which === 'quality';
  const rel = quality ? context.qualityRel : context.rel;
  const { agent, model } = hostActor(quality ? 'quality' : 'reviewer', config);
  const named = proof.state === 'current' ? proof.file : null;
  const previous = item.review && fs.existsSync(path.join(tree, rel)) ? rel : null;
  const own = named && !previous && proof.paths.length > 0;
  const whole = quality && !previous && Boolean(item.review);
  const start = own ? proof.from : whole ? forkPoint(tree, config, intent) : span.from;
  const read = own ? proof.paths : whole ? itemFiles(context) : span.paths;
  const range = `${short(tree, start)}..${short(tree, 'HEAD')}`;
  const specFile = lib.readItemSpec(tree, intent.id, item.id).file;
  const spec = path.relative(tree, specFile);
  const brief = path.join(lib.SPECS_DIR, 'intents', intent.id, 'brief.md');
  const ranged = rangeLines(tree, context, which, range, read);
  const gone = previous ? goneFiles(tree, read) : [];
  const lines = [...ranged.lines, ...goneLine(gone)];
  const payload = { agent, model, range, previous, paths: read, paths_file: ranged.file, gone, spec, brief, write: rel };
  if (quality) {
    const body = lens.qualityBody(tree, context, { ranged: lines, read, spec, brief });
    return { payload: { ...payload, standards: body.standards, lint: body.lint }, lines: reviewerLines(config, `item ${item.id}`, previous, body.lines, 'quality') };
  }
  return {
    payload: { ...payload, proof: named },
    lines: reviewerLines(config, `item ${item.id}`, previous, [
      ...lines,
      ...(named ? [`  proof ${named}`] : []),
      ...realAppLine(tree, config, range, item.id),
      `  spec ${spec}`,
      // A first review numbers its mutants and pins by these, and repeats their words (run-criterion-says.cjs).
      ...(item.review ? [] : criteriaLines(acceptanceCriteria(fs.readFileSync(specFile, 'utf8')))),
      `  brief ${brief}`,
      `  write ${rel}`,
    ]),
  };
}

function verdictResult(tree, context, review, head) {
  const { item, config } = context;
  const out = [head];
  if (review.verdict === 'clean') {
    out.push(`then ${integrateCall(tree, item.id)}`);
    return { exit: 0, payload: { ok: true, item: item.id, verdict: 'clean' }, out };
  }
  for (const finding of review.findings) {
    out.push(`FINDING ${lens.findingLabel(finding)} ${finding.file}:${finding.line}: ${finding.evidence}. fix: ${finding.fix}`);
    if (finding.oracle === 'true') {
      out.push(`ORACLE ${finding.id}: the item's own criterion asks to break ${finding.rule}, so the oracle decides it before the builder takes it`);
    }
  }
  // A survivor the runner ran is told once, as its finding; a released flow's survivor has none.
  const told = (mutant) => review.findings.some((finding) => finding.mutant === mutant.criterion);
  for (const mutant of review.survivors.filter((one) => !told(one))) out.push(`MUTANT ${mutant.criterion} survived: ${mutant.test}`);
  const next = nextActor(item, config);
  out.push(nextLine(item.id, item, config));
  return {
    exit: 2,
    payload: { ok: false, item: item.id, verdict: 'fix', findings: review.findings, survivors: review.survivors, next },
    out,
  };
}

/**
 * Record the review the lenses wrote, once every lens the dispatch printed has written its file:
 * the contract file under `--reviewer`, the quality file under `--quality-reviewer`. Both are
 * validated before the contract lens's mutants run, and the ledger records their one reading.
 */
async function record(tree, context, ledger) {
  const { intent, item, rel, qualityRel } = context;
  const lenses = context.dispatched;
  const waiting = lens.lensesWaiting(tree, context, {
    fork: () => forkPoint(tree, context.config, intent),
    dispatch: (which, span) => lensDispatch(tree, context, which, span, itemProof(tree, context)).lines,
  });
  if (waiting) return waiting;
  const both = lenses.includes('quality');
  const call = itemRecordCall(tree, item.id, null, both);
  const reviewer = reviewerId(context.reviewer, call);
  const qualityReviewer = both ? lens.qualityReviewerId(context.qualityReviewer, call) : null;
  const written = parseItemReview(tree, rel, item.id, { recorded: false });
  const quality = both ? lens.parseQualityReview(tree, qualityRel, item.id, { recorded: false }) : null;
  for (const [file, read] of [[rel, written], [qualityRel, quality]]) {
    if (!item.review && read && read.findings.some((finding) => finding.repeat === 'true')) {
      throw bad(file, 'repeat: true marks a kind an earlier round of this item reported, and this is its first review, so drop repeat: true');
    }
  }
  // The runner runs the review's mutants and writes what they said into the file (run-review-mutants.cjs),
  // beside every file this record signs.
  const signed = [[rel, reviewer], ...(both ? [[qualityRel, qualityReviewer]] : [])];
  const ran = await itemMutants(tree, { ...context, signs: signed.map(([file]) => file) });
  const review = lens.mergeReviews(parseItemReview(tree, rel, item.id, { recorded: false }),
    quality || lens.readQuality(tree, qualityRel, item.id, { recorded: true }));
  const commit = lib.git(tree, ['rev-parse', 'HEAD']);
  const hash = filesHash(tree, review.files);
  const result = writer.reviewItem({
    file: ledger.file, intent: intent.id, item: item.id, verdict: review.verdict,
    files_hash: hash, tier: builtBy(item), commit,
  });
  for (const [file, id] of signed) {
    const abs = path.join(tree, file);
    const text = fs.readFileSync(abs, 'utf8');
    fs.appendFileSync(abs, `${text.endsWith('\n') ? '' : '\n'}tree: ${hash}\ncommit: ${commit}\nreviewer: ${id}\n`);
  }
  const paths = [path.join(lib.SPECS_DIR, 'state.yaml'), ...signed.map(([file]) => file)];
  lib.git(tree, ['add', '--', ...paths]);
  lib.git(tree, ['commit', '-q', '-m', `specsmd(${intent.id}): review ${item.id} ${review.verdict}`, '--', ...paths]);
  const updated = itemOf(lib.readLedger(tree), item.id, { intent: intent.id }).item;
  const head = `review ${item.id} ${review.verdict}, recorded at ${short(tree, commit)} ` +
    `(${result.tier}, ${result.misses} miss${result.misses === 1 ? '' : 'es'})`;
  const verdict = verdictResult(tree, { ...context, item: updated }, review, head);
  return { ...verdict, out: [...ran, ...verdict.out] };
}

/**
 * The files the pending lens files list. A file that does not parse lists none here; its record
 * reports why.
 */
function pendingFiles(tree, context) {
  const reads = [[context.rel, parseItemReview], [context.qualityRel, lens.parseQualityReview]];
  return [...new Set(reads.filter(([rel]) => context.isPending(rel)).flatMap(([rel, parse]) => {
    try {
      return parse(tree, rel, context.item.id, { recorded: false }).files;
    } catch (error) {
      if (error instanceof RunError) return [];
      throw error;
    }
  }))];
}

/** The step itself. Every call first puts back a killed mutate's leftover and refuses this item's uncommitted work. */
function review(options) {
  if (!options.item) {
    throw new RunError('usage: node run.cjs review --item <id> --tree <dir> [--intent <id>] [--reviewer <agent-id>] ' +
      '[--quality-reviewer <agent-id>]', 'BAD_ARGS', 1);
  }
  const tree = options.tree || lib.repoRoot(options.cwd);
  const ledger = lib.readLedger(tree);
  const { intent, item } = itemOf(ledger, options.item, options);
  const rel = reviewPath(intent.id, item.id);
  const qualityRel = lens.qualityPath(intent.id, item.id);
  const config = lib.readConfig(tree, options.config);
  const manifest = lib.readItemSpec(tree, intent.id, item.id).manifest || {};
  const editable = (manifest.ownership && manifest.ownership.editable) || [];
  // A lens file is pending once its reviewer wrote it and before the record commits it.
  const isPending = (file) => fs.existsSync(path.join(tree, file)) && lib.gitLines(tree, ['status', '--porcelain', '--', file]).length > 0;
  // The lenses this round waits for: those the dispatch printed, and a quality file written all the same.
  const dispatched = lens.dispatchedLenses(tree, intent.id, item.id);
  if (isPending(qualityRel) && !dispatched.includes('quality')) dispatched.push('quality');
  const context = {
    intent, item, config, rel, qualityRel, editable, claimed: dispatchClaims(tree, intent.id, item.id), isPending, dispatched,
    reviewer: options.reviewer, qualityReviewer: options.quality_reviewer, configFile: options.config,
  };

  const exists = fs.existsSync(path.join(tree, rel)) || isPending(qualityRel);
  const pending = isPending(rel) || isPending(qualityRel);
  const current = exists && !pending ? lens.readItemReview(tree, intent.id, item.id, { recorded: true }) : null;

  // Only this item's work has to be committed: another builder may be editing beside it, and
  // another item's reviewer may be running a mutant beside it. A dead run's mutant goes back
  // first, so it never reads as this item's work. A pending review binds every file it lists.
  const listed = pending ? pendingFiles(tree, context) : current ? current.files : [];
  const owned = itemFiles(context);
  const mine = (file) => lib.ownedBy(file, owned) || listed.includes(file);
  const restored = recoverInterrupted(tree, { keepLive: (file) => !mine(file) });
  const dirty = dirtyFiles(tree).filter(mine);
  if (dirty.length > 0) {
    throw new RunError(afterRecovery(restored,
      `refusing to review ${item.id} over uncommitted work in ${dirty.slice(0, 5).join(', ')}: ` +
        'commit the item first, then run this command again.'), 'DIRTY');
  }

  const result = step(tree, context, { ledger, exists, pending, current });
  const done = (value) => ({ ...value, out: [...restored, ...value.out] });
  return result && typeof result.then === 'function' ? result.then(done) : done(result);
}

/**
 * Dispatch line when no review exists, record when one is written, the verdict when current, and
 * the settle of a minor-only fix whose correction stayed inside the files that review lists.
 */
function step(tree, context, { ledger, exists, pending, current }) {
  const { intent, item, config } = context;
  if (!exists) return owed(tree, context, 'no review yet', forkPoint(tree, config, intent), itemFiles(context));
  if (pending) return record(tree, context, ledger);
  // A fix review is owed again by any commit on the item's own paths, a granted one too, not only
  // on the files it listed: the usual answer to "this criterion has no test" is a new file.
  const since = (from) => changedSince(tree, context, from, current.files);
  const holds = Boolean(item.review) && itemReviewCurrent(tree, { intent, item, files: current.files, config });
  if (item.review === 'settled') {
    if (holds) return settledResult(tree, context, `review ${item.id} settled for the current files (settled at ${short(tree, item.review_commit)})`);
    // The delta reads from the commit the settled review read, so the correction nobody re-read is in it.
    const recorded = previousReview(tree, context.rel);
    const from = recorded ? recorded.commit.trim() : item.review_commit;
    return owed(tree, context, 'a file the settled review lists changed since it settled', from, [...new Set([...current.files, ...since(from)])]);
  }
  const touched = item.review === 'fix' && item.review_commit ? since(item.review_commit) : [];
  if (holds && touched.length === 0) {
    const head = `review ${item.id} ${current.verdict} for the current files (read at ${short(tree, item.review_commit)})`;
    return verdictResult(tree, context, current, head);
  }
  const paths = [...new Set([...current.files, ...touched])];
  const from = item.review_commit || forkPoint(tree, config, intent);
  if (item.review === 'fix' && item.review_weight === 'minor' && touched.length > 0) {
    const unlisted = touched.filter((file) => !current.files.includes(file));
    if (unlisted.length === 0) return settle(tree, context, ledger, current, touched);
    return owed(tree, context, `the correction of the minor findings touches ${unlisted.join(', ')}, which the review does not list`, from, paths);
  }
  return owed(tree, context, 'the item changed since the last review', from, paths);
}

function settledResult(tree, context, head) {
  const { item } = context;
  return { exit: 0, payload: { ok: true, item: item.id, verdict: 'settled' }, out: [head, `then ${integrateCall(tree, item.id)}`] };
}

/**
 * Why the item's verify-item proof does not prove its corrected state, or null when it does: it
 * passed, it was written on a commit after the one the fix review read, and proofAtHead finds it
 * taken over the item's paths as HEAD holds them.
 */
function proofProblem(tree, intentId, item, config) {
  // Required here, not at the top: run-item-proof loads run-intents, which loads run-frontier, which loads this file.
  const { proofAtHead, readItemProof } = require('./run-item-proof.cjs');
  const proof = readItemProof(tree, intentId, item.id);
  if (!proof) return 'no verify-item proof of the correction is on record';
  const head = typeof proof.head === 'string' ? proof.head : '';
  const after = head !== '' && head !== item.review_commit &&
    lib.git(tree, ['merge-base', '--is-ancestor', item.review_commit, head], { tolerate: true }) !== null;
  if (!after) return 'its verify-item proof predates the fix review';
  if (proof.passed !== true) return 'its verify-item proof failed';
  if (proofAtHead(tree, intentId, item.id, config).state === 'stale') return 'the item changed since its verify-item proof';
  return null;
}

/**
 * Settle a minor-only fix: the correction stayed inside the files the review lists, so no second
 * review reads it. It needs verify-item's proof of the corrected state. The ledger records
 * `settled` at HEAD under the hash of those files, and the intent review is told the range.
 */
function settle(tree, context, ledger, current, touched) {
  const { intent, item } = context;
  const problem = proofProblem(tree, intent.id, item, context.config);
  if (problem) {
    return {
      exit: 3,
      payload: { ok: false, item: item.id, owed: 'proof', problem },
      out: [
        `settle owed for ${item.id}: every finding was minor and the correction stays inside the files the review lists, but ${problem}`,
        `run ${verifyItemCall(tree, [item.id])}, then ${itemReviewCall(tree, item.id)} again`,
      ],
    };
  }
  const commit = lib.git(tree, ['rev-parse', 'HEAD']);
  writer.reviewItem({
    file: ledger.file, intent: intent.id, item: item.id, verdict: 'settled', files_hash: filesHash(tree, current.files), tier: builtBy(item), commit,
  });
  const state = path.join(lib.SPECS_DIR, 'state.yaml');
  lib.git(tree, ['add', '--', state]);
  lib.git(tree, ['commit', '-q', '-m', `specsmd(${intent.id}): review ${item.id} settled`, '--', state]);
  const head = `review ${item.id} settled at ${short(tree, commit)}: the warm builder corrected every minor finding inside ` +
    `${touched.join(', ')}, the files the review lists, so no second review reads it`;
  return settledResult(tree, context, head);
}

/**
 * The items of one landing whose review is neither clean nor settled for their files as they
 * stand. integrate checks every id with this before it folds or writes anything.
 */
function owedReviews(tree, ledger, ids, options) {
  const lines = [];
  const since = reviewRuleSince(tree);
  for (const id of ids) {
    const { intent, item } = itemOf(ledger, id, options);
    const complete = writer.isComplete(item.status);
    if (complete && completedBeforeReviewRule(item.completed_at, since)) continue;
    const command = `${itemReviewCall(tree, id)}${complete && since === null ? `. ${REINSTALL}` : ''}`;
    if (!reviewLands(item.review)) {
      lines.push(`${id} ${item.review === 'fix' ? 'has a fix review' : 'has no clean review'}, run ${command}`);
      continue;
    }
    let reviewed;
    try {
      // A recorded review keeps a path that left the tree, which reads as stale below.
      reviewed = lens.readItemReview(tree, intent.id, id, { recorded: true });
    } catch (error) {
      lines.push(`${id} has no readable review file, run ${command}`);
      continue;
    }
    if (!itemReviewCurrent(tree, { intent, item, files: reviewed.files, configFile: options.config })) {
      lines.push(`${id}: a file it lists changed since its review, run ${command}`);
    }
  }
  return lines;
}

module.exports = { ...ladder, owedReviews, realAppLine, review, reviewerLines };
