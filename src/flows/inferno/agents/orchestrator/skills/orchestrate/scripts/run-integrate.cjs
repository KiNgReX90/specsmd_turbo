'use strict';

/**
 * `run.cjs integrate`: the step that lands one item, or one explicitly batched chain.
 *
 * It folds the base branch in, runs the cheap checks on the committed tree, and only then
 * completes the item in the ledger with the sha it proved. Completion used to come first, so
 * a run that died between the mark and the checks left a ledger claiming verified about a
 * tree nothing had verified, and the next run released the successor on top of it (measured
 * 2026-09-09).
 *
 * A browser step runs here only for a project that configures `verification.integrate_e2e`.
 * DossierForge configures none since 2026-09-11: a selection cost as much as the whole suite
 * and the finalize gate ran the whole suite again anyway, because a proof is keyed on the
 * command string. Its browser suite is in `verification.finalize` and runs once per intent.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const gate = require('./run-gate.cjs');
const proofs = require('./run-proofs.cjs');
const writer = require('./state-transition.cjs');
const impact = require('./run-e2e-impact.cjs');
const { resolveBase } = require('./run-intents.cjs');
const { checkDoubles } = require('./check-doubles.cjs');
const cases = require('./run-cases.cjs');
const { owedReviews } = require('./run-review.cjs');
const { afterRecovery, recoverInterrupted } = require('./run-mutate.cjs');
const { landingSince, sinceCommit } = require('./run-since.cjs');
const dirt = require('./run-dirt.cjs');

const { RunError } = lib;

/** The items this call lands: one `--item`, or the explicit chain in `--items a,b`. */
function itemIds(options) {
  const listed = options.items ? String(options.items).split(',') : [];
  const ids = [...listed, options.item]
    .map((id) => (id ? String(id).trim() : ''))
    .filter((id) => id.length > 0);
  return [...new Set(ids)];
}

function intentOf(ledger, itemId, options) {
  const intent = options.intent
    ? lib.findIntent(ledger, options.intent)
    : ledger.intents.find((entry) => entry.items.some((item) => item.id === itemId));
  if (!intent) throw new RunError(`work item not found in the live ledger: ${itemId}`, 'ITEM_NOT_FOUND');
  return intent;
}

/**
 * Commit the files the completion wrote: the ledger and each work-item file it rewrote. The
 * list is exact and goes through a pathspec, so a review another reviewer writes while
 * integrate runs, or a file staged beside it, stays out of the commit.
 */
function commitLedger(tree, written, message) {
  const paths = [path.join(lib.SPECS_DIR, 'state.yaml'), ...written]
    .filter((rel) => fs.existsSync(path.join(tree, rel)));
  if (paths.length === 0) return [];
  lib.git(tree, ['add', '--', ...paths]);
  if (lib.gitLines(tree, ['diff', '--cached', '--name-only', '--', ...paths], { tolerate: true }).length === 0) return [];
  lib.git(tree, ['commit', '-q', '-m', message, '--', ...paths]);
  return [`ledger commit ${lib.git(tree, ['rev-parse', '--short', 'HEAD'])}`];
}

/**
 * Mark every item of this landing completed, each carrying the sha the checks ran on. The
 * proof is what `state-transition.cjs complete-item` refuses to be marked without. The tree
 * goes along and the host config comes from the caller record, so a refusal the writer raises
 * prints integrate's own calls.
 */
function completeItems(tree, ids, options) {
  const ledger = lib.readLedger(tree);
  const proof = lib.git(tree, ['rev-parse', '--short', 'HEAD']);
  const intentIds = new Set();
  const written = [];
  const out = [];
  for (const id of ids) {
    const intent = intentOf(ledger, id, options);
    intentIds.add(intent.id);
    const result = writer.completeItem({ file: ledger.file, intent: intent.id, item: id, proof, tree });
    if (result.markdown) written.push(result.markdown);
    out.push(result.changed ? `completed ${id} at ${proof}` : `${id} ${result.note}`);
  }
  const label = ids.length === 1 ? ids[0] : ids.join(', ');
  out.push(...commitLedger(tree, written, `specsmd(${[...intentIds].join(', ')}): complete ${label} integrated at ${proof}`));
  return { proof, out };
}

/** The live ledger, or an empty one where a tree carries none. */
function ledgerOf(tree) {
  try {
    return lib.readLedger(tree);
  } catch (error) {
    return { intents: [], file: null };
  }
}

/**
 * The browser journeys this landing can break: the item's own spec targets, the specs the
 * changed sources map to, and the whole suite when a changed source no entry covers leaves the
 * question open. Returns null when the project configures no e2e at integrate.
 */
function e2eSelection(tree, config, ids, options, anchor) {
  if (!impact.section(config)) return null;
  const ledger = ledgerOf(tree);
  const manifests = [];
  for (const id of ids) {
    try {
      const intent = intentOf(ledger, id, options);
      manifests.push(lib.readItemSpec(tree, intent.id, id).manifest);
    } catch (error) {
      continue;
    }
  }
  const since = impact.sinceRef(tree, ledger, { items: ids, anchor });
  const changed = since ? impact.changedSince(tree, since) : [];
  return impact.select({ changed, manifests, config });
}

/**
 * What a landing owns or commits: every file of its items' `ownership.editable`, and, when it
 * lands an item, the ledger and each item's work-item file, which the completion rewrites and
 * the ledger commit stages. An id the live ledger lacks owns nothing here; integrate refuses it
 * once a dead mutant is back.
 */
function landingFiles(tree, ids, options) {
  if (ids.length === 0) return () => false;
  const ledger = ledgerOf(tree);
  const written = new Set([path.posix.join(lib.SPECS_DIR, 'state.yaml')]);
  const editable = [];
  for (const id of ids) {
    const intent = ledger.intents.find((entry) =>
      (!options.intent || entry.id === options.intent) && entry.items.some((item) => item.id === id));
    if (!intent) continue;
    written.add(path.posix.join(lib.SPECS_DIR, 'intents', intent.id, 'work-items', `${id}.md`));
    const manifest = lib.readItemSpec(tree, intent.id, id).manifest || {};
    editable.push(...((manifest.ownership && manifest.ownership.editable) || []));
  }
  return (file) => written.has(file) || lib.ownedBy(file, editable, tree);
}

/**
 * What the integrate checks of `config` read: those `runs` keeps, the browser step whole when it
 * runs. Before the fold nothing says which run, so every configured one counts.
 */
function checksRead(config, runs = () => true, e2e = Boolean(impact.section(config))) {
  const verification = config.verification || {};
  const scopes = verification.finalize_scopes || {};
  const commands = (verification.integrate || []).filter(runs);
  return dirt.scopeOf([...commands.map((command) => scopes[command] || null), ...(e2e ? [null] : [])]);
}

/**
 * Integrate runs the selected checks and retains each successful command's proof. A leftover
 * of a killed mutate is put back first, and every way out says so, a refusal included.
 *
 * Sibling builders and reviewers work in the same tree, so integrate refuses only the
 * uncommitted files it would read or commit: here what the landing owns or commits, after the
 * fold what a check it runs reads. One sibling file anywhere used to hold every landing
 * (2026-11-09). A live mutant holds it only in such a file, or inside any configured check's
 * scope, since the running set is known only after the fold.
 */
function integrate(options) {
  const tree = gate.treeOf(options);
  const initial = lib.readConfig(tree, options.config);
  const landing = landingFiles(tree, itemIds(options), options);
  const configured = checksRead(initial);
  const restored = recoverInterrupted(tree, { keepLive: (file) => !landing(file) && !dirt.reads(configured, file) });
  try {
    dirt.refuseDirt(dirt.dirtyFiles(tree).filter(landing), 'refusing to integrate over uncommitted files this landing owns or commits',
      'Commit or discard them, then run integrate again.');
    const result = checkAndLand(tree, options, initial);
    return { ...result, out: [...restored, ...result.out] };
  } catch (error) {
    if (error instanceof RunError) error.message = afterRecovery(restored, error.message);
    throw error;
  }
}

function checkAndLand(tree, options, initial) {
  const base = options.base || resolveBase(initial, null, tree);
  const ids = itemIds(options);
  // Every id first, before the fold and before any write: an item lands only over a clean
  // review of the files as they stand, and a batch never lands half.
  const owed = ids.length > 0 ? owedReviews(tree, lib.readLedger(tree), ids, options) : [];
  if (owed.length > 0) {
    throw new RunError(`item review owed, nothing integrated: ${owed.join('; ')}`, 'ITEM_REVIEW_OWED', 3);
  }
  // A --since is read before the fold moves HEAD, so `HEAD~1` names the commit before the edit
  // and a typo is refused before anything merges.
  const named = options.since ? sinceCommit(tree, options.since) : null;
  // Preserve the branch position before folding the base. Only the browser selection reads it,
  // so a project that configures none reads no git history for it.
  const anchor = impact.section(initial) ? impact.anchorFor(tree, base) : null;
  const folded = gate.foldBase(tree, base);
  // origin/<base> is read after the fold, which merged it: on the base branch the diff from it
  // is then exactly the unpushed commits. Off the base the merge base stays the anchor.
  const landing = landingSince(tree, base, named);
  const since = landing ? landing.ref : gate.mergeBase(tree, base);
  const lead = [...folded, ...(landing ? landing.out : [])];
  const config = lib.readConfig(tree, options.config);
  const commands = (config.verification && config.verification.integrate) || [];
  const definition = JSON.stringify(config.verification);
  const branch = lib.currentBranch(tree);
  const dir = path.join(lib.cacheDir(tree), branch, `integrate-${lib.stamp()}`);
  const results = [];
  // A command with a `finalize_scopes` entry runs here only when the branch touched one of its
  // globs. Without it the cargo tree was left out of this list
  // for cost, and an item merged eight broken Rust cases through a green integrate that the
  // next builder found (2026-09-10). On the base branch the merge base is HEAD, so a direct
  // build skipped every scoped check after a commit inside its scope (2026-11-09); with no diff
  // to read there, `changed` is null and every scoped command runs. Only committed paths count,
  // so a sibling's uncommitted file never selects a check.
  const scopes = (config.verification && config.verification.finalize_scopes) || {};
  const changed = landing && landing.all ? null : lib.gitLines(tree, ['diff', '--name-only', '--no-renames', since, 'HEAD'], { tolerate: true });
  const runs = (command) => !scopes[command] || !changed || changed.some((file) => lib.matchesAny(file, scopes[command]));
  const selection = e2eSelection(tree, config, ids, options, anchor);
  // A check reads the tree it runs in, a sibling's uncommitted bytes included, and a remote run
  // mirrors them, so such a file is refused before any check runs. The same scopes are what the
  // landing must not move under: a sibling writing outside them leaves the landing standing.
  const read = checksRead(config, runs, Boolean(selection && selection.command));
  dirt.refuseDirt(dirt.dirtyFiles(tree).filter((file) => dirt.reads(read, file)),
    'refusing to integrate over uncommitted files a check this landing runs reads',
    'Commit or discard them, or wait until the work that writes them is committed, then run integrate again.');
  const started = proofs.scopeHash(tree, read);

  const red = (out) => ({ exit: 2, payload: { ok: false, tree, branch, items: ids, folded: folded.length > 0, results }, out });

  // The double ratchet runs first: a branch that fakes more of the app is refused before any
  // command spends time proving it.
  const doubles = config.doubles === undefined ? null : checkDoubles({ ...options, tree, base, since: landing ? landing.ref : undefined }, config);
  if (doubles && doubles.exit !== 0) return red([...lead, ...doubles.out]);
  // The tester cases the branch changes the truth of are edited or answered before any command runs.
  const stale = cases.refusal(tree, config, `${since || gate.mergeBase(tree, base)}..HEAD`);
  if (stale) return red([...lead, ...stale.out]);

  // Every command runs, red or not, and one red result names every failure. Stopping at the
  // first failure cost one orchestrator round trip and one builder correction per failing
  // command: an item that broke check, definitions and cargo paid three integrate runs and
  // three followups to learn what one run could have said.
  for (const [index, command] of commands.entries()) {
    if (!runs(command)) {
      results.push({ command, result: 'skip' });
      continue;
    }
    results.push(proofs.runCommand(tree, config, options.config, command, path.join(dir, `${index}.log`)));
  }
  const failures = results.filter((entry) => entry.result === 'fail');
  if (failures.length > 0) {
    return red([
      ...lead,
      ...gate.describe(results),
      `${failures.length} of ${commands.length} integrate command(s) failed; send every failure above to the builder in one correction.`,
    ]);
  }

  const out = [...lead, ...(doubles ? doubles.out : [])];
  if (commands.length === 0) {
    out.push(`no verification.integrate list in ${lib.SPECS_DIR}/config.yaml: folded ${base} only`);
  } else {
    out.push(...gate.describe(results));
  }

  if (selection && selection.command) {
    const result = proofs.runCommand(tree, config, options.config, selection.command, path.join(dir, 'e2e.log'));
    results.push(result);
    out.push(...gate.describe(results.slice(-1)));
    if (result.result === 'fail') return red(out);
  } else if (selection) {
    out.push(`SKIP e2e (${selection.reason})`);
  }

  if (proofs.scopeHash(tree, read) !== started ||
      JSON.stringify(lib.readConfig(tree, options.config).verification) !== definition) {
    return red([...out, 'the code changed while integrate ran. Re-run integrate.']);
  }

  if (ids.length === 0) {
    return { exit: 0, payload: { ok: true, tree, branch, items: [], folded: folded.length > 0, results }, out };
  }
  const completion = completeItems(tree, ids, options);
  return {
    exit: 0,
    payload: { ok: true, tree, branch, items: ids, proof: completion.proof, folded: folded.length > 0, results },
    out: [...out, ...completion.out],
  };
}

module.exports = { integrate, itemIds };
