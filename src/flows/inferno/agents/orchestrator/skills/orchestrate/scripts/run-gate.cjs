'use strict';

/** Verification commands retain a proof for each unchanged scope. */

const path = require('path');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const { resolveBase } = require('./run-intents.cjs');
const jobs = require('./run-jobs.cjs');
const lanes = require('./run-lanes.cjs');
const intentReview = require('./run-intent-owed.cjs');
const { gateStartCall, gateWaitCall } = require('./run-call.cjs');
const { afterRecovery, recoverInterrupted } = require('./run-mutate.cjs');
const cases = require('./run-cases.cjs');
const slot = require('./run-slot.cjs');
const { mergeSlot } = require('./run-config-gates.cjs');
const { lanesSince, startLanesOnly } = require('./run-lanes-only.cjs');
const supersede = require('./run-supersede.cjs');
const { foldBlockers, refuseDirt } = require('./run-dirt.cjs');

const { RunError } = lib;

function treeOf(options) {
  return options.tree || lib.repoRoot(options.cwd);
}

/** Refuse a dirty tree, after restoring a mutant a killed `mutate` left; returns that restore's lines. */
function refuseDirty(tree) {
  const restored = recoverInterrupted(tree);
  const dirty = lib.dirtyPaths(tree);
  if (dirty.length > 0) {
    throw new RunError(afterRecovery(restored,
      `refusing to verify a dirty tree: ${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? ` and ${dirty.length - 5} more` : ''}. Commit or discard first.`),
    'DIRTY');
  }
  return restored;
}

/** Paths changed since a ref (the branch against its base, or the tree against HEAD), and what is uncommitted on top. */
function changedPaths(tree, since) {
  const tracked = lib.gitLines(tree, ['diff', '--name-only', since], { tolerate: true });
  const untracked = lib.gitLines(tree, ['ls-files', '--others', '--exclude-standard'], { tolerate: true });
  return [...new Set([...tracked, ...untracked])];
}

function mergeBase(tree, base) {
  return lib.git(tree, ['merge-base', 'HEAD', base], { tolerate: true }) || base;
}

/**
 * Fold the base branch into the worktree before the gate runs, so the tree the gate proves is
 * the tree ship merges. Without it every intent whose base moved while it was open paid two
 * gates: one here, one after ship folded the base in and found the marker stale (2026-09-03).
 * Commits that reached origin but not the local base are folded too. A conflict stops here with
 * the files named and the merge left in the worktree to resolve. A merge git refuses before it
 * starts, over an uncommitted file the incoming commits change, names that file instead.
 */
function foldBase(tree, base) {
  const branch = lib.currentBranch(tree);
  const before = lib.git(tree, ['rev-parse', 'HEAD']);
  const refs = [base];
  if (lib.git(tree, ['remote'], { tolerate: true })) {
    lib.git(tree, ['fetch', '--quiet', 'origin', base], { tolerate: true });
    if (lib.git(tree, ['rev-parse', '--verify', '--quiet', `origin/${base}`], { tolerate: true })) refs.push(`origin/${base}`);
  }
  for (const ref of refs) {
    if (lib.git(tree, ['merge', '--no-edit', ref], { tolerate: true }) === null) {
      const conflicts = lib.gitLines(tree, ['diff', '--name-only', '--diff-filter=U'], { tolerate: true });
      if (conflicts.length === 0) {
        refuseDirt(foldBlockers(tree, ref), `refusing to fold ${ref} into ${branch} over uncommitted files its commits change`,
          'Commit or discard them, or wait until the work that writes them is committed, then run the step again.');
      }
      throw new RunError(
        `conflict folding ${ref} into ${branch}: ${conflicts.slice(0, 10).join(', ')}. ` +
          'Resolve them in the worktree so both sides\' goals survive, commit, then run the step again.',
        'FOLD_CONFLICT'
      );
    }
  }
  return lib.git(tree, ['rev-parse', 'HEAD']) === before ? [] : [`folded ${base} into ${branch}`];
}

// ---------------------------------------------------------------------------
// gate
// ---------------------------------------------------------------------------

/** The human lines for a gate's results, the same whether run here or read from a finished job. */
function describe(results) {
  const out = [];
  for (const entry of results) {
    if (entry.result === 'skip') out.push(`SKIP ${entry.command} (no path in scope changed)`);
    else if (entry.result === 'green') out.push(`GREEN ${entry.seconds}s ${entry.command} (unchanged since ${entry.stamp})`);
    else if (entry.result === 'pass') out.push(`PASS ${entry.seconds}s ${entry.command}`);
    else {
      out.push(`FAIL ${entry.seconds}s ${entry.command} -> ${entry.log}`);
      out.push(...lib.tail(entry.log, 5));
    }
  }
  return out;
}

function gateCommands(tree, selected) {
  const config = lib.readConfig(tree, selected);
  const commands = (config.verification && config.verification.finalize) || [];
  if (commands.length === 0) {
    throw new RunError(
      `no verification.finalize list in ${selected || `${lib.SPECS_DIR}/config.yaml`}: the gate has nothing to run`,
      'NO_GATE'
    );
  }
  return { config, commands };
}

/** A leftover flake_rerun key from a running session's config is read and ignored, never refused. */
function ignoredKeys(config) {
  return config.verification && config.verification.flake_rerun !== undefined
    ? ['IGNORED verification.flake_rerun: a red command stays red'] : [];
}

/** Run the finalize commands in this process. `gate` below dispatches between this, --detach and --wait. */
function gateNow(options) {
  const tree = treeOf(options);
  const restored = refuseDirty(tree);
  const initial = gateCommands(tree, options.config);
  const base = options.base || resolveBase(initial.config, null, tree);
  const intent = intentReview.intentFor(tree, options);
  const before = lib.git(tree, ['rev-parse', 'HEAD']);
  const folded = foldBase(tree, base);
  const { config, commands } = gateCommands(tree, options.config);
  const shown = [...restored, ...folded, ...ignoredKeys(config)];
  // The whole branch answers for its tester cases, and for each case its brief says the tester proves.
  const brief = path.join(tree, lib.SPECS_DIR, 'intents', intent, 'brief.md');
  const stale = cases.refusal(tree, config, `${mergeBase(tree, base)}..HEAD`, brief);
  if (stale) {
    return { exit: 2, payload: { ok: false, tree, branch: lib.currentBranch(tree), folded: folded.length > 0, results: [], cases: stale.payload }, out: [...shown, ...stale.out] };
  }
  const unreviewed = intentReview.gateRefusal(tree, config, intent, before, shown);
  if (unreviewed) return unreviewed;
  // Reject a verdict if the inputs change while the gate runs.
  const codeHash = lib.codeTreeHash(tree);
  const started = proofs.scopeHash(tree);
  const definition = JSON.stringify(config.verification);
  const branch = lib.currentBranch(tree);
  const dir = path.join(lib.cacheDir(tree), branch, `gate-${lib.stamp()}`);

  const results = [];
  // A failed command is red on its first failure: no rerun mints a proof.
  for (const [index, command] of commands.entries()) {
    const result = proofs.runCommand(tree, config, options.config, command, path.join(dir, `${index}.log`), Boolean(options.force));
    results.push(result);
    if (result.result === 'fail') {
      const out = [...shown, ...describe(results)];
      if (result.moved) out.push('the code changed while the gate ran. Re-run the gate.');
      return { exit: 2, payload: { ok: false, tree, branch, folded: folded.length > 0, results }, out };
    }
  }

  if (proofs.scopeHash(tree) !== started ||
      JSON.stringify(lib.readConfig(tree, options.config).verification) !== definition) {
    const out = [...shown, ...describe(results), 'the code changed while the gate ran. Re-run the gate.'];
    return { exit: 2, payload: { ok: false, tree, branch, folded: folded.length > 0, results, moved: true }, out };
  }

  return {
    exit: 0,
    payload: { ok: true, tree, branch, folded: folded.length > 0, results, hash: codeHash },
    out: [...shown, ...describe(results), `green ${codeHash}`],
  };
}

// ---------------------------------------------------------------------------
// gate --detach / gate --wait
//
// The gate outruns the ten-minute cap a host puts on one tool call, and a background tool
// call is orphaned the moment a headless run ends its turn (2026-09-03: the orchestrator
// wrote "I'll continue when it exits" and the process exited with it, gate and all). So the
// gate runs as its own detached process and the orchestrator blocks on it in slices that fit
// the cap: `--wait` exits 0 green, 2 red, 4 still running, and 4 means call it again.
//
// With `verification.merge_slot` on, a gate folds and starts only at the head of the merge
// slot (run-slot.cjs), so an intent behind another folds a base that no longer moves under it.
// A queued detach exits 4 too, and its `--wait` starts the gate once the ticket is at the head.
// ---------------------------------------------------------------------------

const QUEUE_POLL_MS = 5000;

const queuedLine = (ahead) => `queued behind ${ahead[0]} (${ahead.length} ahead); nothing folded`;

function queued(tree, ahead, out, next) {
  return { exit: 4, payload: { queued: true, tree, ahead }, out: [...out, queuedLine(ahead), next] };
}

function gateDetach(options) {
  const tree = treeOf(options);
  const restored = refuseDirty(tree);
  const { config } = gateCommands(tree, options.config);
  const paths = jobs.jobPaths(tree);
  // A supersede stops the tree's running lanes first and leads the detach with what it proved.
  if (options.supersede) restored.push(...supersede.supersede(tree, config, options.config, { lanesOnly: Boolean(options.lanes_only) }));
  else supersede.refusePlain(tree);

  if (options.lanes_only) {
    const base = options.base || resolveBase(config, null, tree);
    const since = lanesSince(tree, options.since, base) || mergeBase(tree, base);
    return startLanesOnly(tree, options, config, restored, changedPaths(tree, since));
  }
  const intent = intentReview.intentFor(tree, options);
  if (mergeSlot(config)) {
    const turn = slot.take(tree, { intent });
    if (!turn.head) return queued(tree, turn.ahead, [...restored, ...turn.out], `wait with: ${gateWaitCall(tree)}`);
  }
  const before = lib.git(tree, ['rev-parse', 'HEAD']);
  const base = options.base || resolveBase(config, null, tree);
  const foldLines = foldBase(tree, base);
  const current = gateCommands(tree, options.config).config;
  const folded = [...restored, ...foldLines, ...ignoredKeys(current)];
  // Refused here too, or the child dies refusing and --wait reports a gate with no result.
  const unreviewed = intentReview.gateRefusal(tree, current, intent, before, folded);
  if (unreviewed) return unreviewed;
  const laneStart = lanes.startLanes(tree, options, current, changedPaths(tree, mergeBase(tree, base)));
  const args = ['gate', '--tree', tree, '--json'];
  if (options.base) args.push('--base', options.base);
  if (options.intent) args.push('--intent', options.intent);
  if (options.config) args.push('--config', options.config);
  if (options.force) args.push('--force');
  // The gate is a process the run launched in its worktree, so teardown may stop it.
  const job = jobs.detach(tree, args, paths, {
    config: options.config || `${lib.SPECS_DIR}/config.yaml`, lanes: laneStart.started, head: lib.git(tree, ['rev-parse', 'HEAD']),
  });
  return {
    exit: 0,
    payload: { started: true, folded: foldLines.length > 0, ...job },
    out: [...folded, `gate started pid ${job.pid}`, `log ${paths.log}`, `result ${paths.result}`, ...laneStart.out,
      `wait with: ${gateWaitCall(tree)}`],
  };
}

function finished(job) {
  const result = jobs.readJson(job.result);
  if (result && Array.isArray(result.results)) {
    const out = describe(result.results);
    if (result.ok) out.push(`green ${result.hash}`);
    return { exit: result.ok ? 0 : 2, payload: result, out };
  }
  return {
    exit: 2,
    payload: { ok: false, tree: job.tree, branch: job.branch, results: [], died: true },
    out: [`gate process ${job.pid} ended without a result -> ${job.log}`, ...lib.tail(job.log, 5)],
  };
}

/**
 * gate --wait under the merge slot: block while the tree's ticket waits behind the head, then
 * start the gate at the head unless one started since the ticket was taken. Returns the result
 * to print instead of the wait, or the lines that lead the wait; a tree with no ticket waits as today.
 */
function slotWait(tree, options, deadline) {
  slot.renew(tree);
  const out = [];
  let turn = slot.standing(tree);
  for (; turn.ticket && turn.ahead.length > 0; turn = slot.standing(tree)) {
    out.push(...turn.out);
    if (Date.now() >= deadline) return { result: queued(tree, turn.ahead, out, `call ${gateWaitCall(tree)} again`) };
    jobs.sleepSync(Math.min(QUEUE_POLL_MS, Math.max(1, deadline - Date.now())));
  }
  out.push(...turn.out);
  if (!turn.ticket) return { lead: out };
  const job = jobs.readJson(jobs.jobPaths(tree).job);
  if (job && Date.parse(job.started) >= Date.parse(turn.ticket.taken)) return { lead: out };
  const started = gateDetach(options);
  if (started.exit !== 0) return { result: { ...started, out: [...out, ...started.out] } };
  return { lead: [...out, ...started.out.filter((line) => !line.startsWith('wait with: '))] };
}

function gateWait(options) {
  const tree = treeOf(options);
  const deadline = Date.now() + Number(options.minutes || 9) * 60000;
  const turn = mergeSlot(lib.readConfig(tree, options.config)) ? slotWait(tree, options, deadline) : { lead: [] };
  if (turn.result) return turn.result;
  const job = jobs.readJson(jobs.jobPaths(tree).job);
  if (!job) {
    throw new RunError(`no gate has been started for this tree; start one with ${gateStartCall(tree)}`, 'NO_GATE_JOB');
  }
  const selected = path.resolve(tree, options.config || `${lib.SPECS_DIR}/config.yaml`);
  const configured = path.resolve(tree, job.config || `${lib.SPECS_DIR}/config.yaml`);
  if (selected !== configured) {
    throw new RunError(`the started gate uses config ${job.config}. Wait with the same --config file.`, 'GATE_CONFIG');
  }
  return lanes.waitAll(job, options, deadline, () => finished(job), turn.lead);
}

function gate(options) {
  if (options.detach && options.wait) throw new RunError('gate takes --detach or --wait, not both', 'BAD_ARGS', 1);
  if (options.lanes_only && !options.detach) throw new RunError('gate takes --lanes-only only with --detach', 'BAD_ARGS', 1);
  if (options.since && !options.lanes_only) throw new RunError('gate takes --since only with --detach --lanes-only', 'BAD_ARGS', 1);
  if (options.holder && !options.lanes_only) throw new RunError('gate takes --holder only with --detach --lanes-only', 'BAD_ARGS', 1);
  if (options.supersede && !options.detach) throw new RunError('gate takes --supersede only with --detach', 'BAD_ARGS', 1);
  if (options.lane) return lanes.laneNow(options);
  if (options.detach) return gateDetach(options);
  if (options.wait) return gateWait(options);
  return gateNow(options);
}

// ---------------------------------------------------------------------------
// green
// ---------------------------------------------------------------------------

function green(options) {
  const tree = treeOf(options);
  const restored = refuseDirty(tree);
  const { config, commands } = gateCommands(tree, options.config);
  const hash = lib.codeTreeHash(tree);
  const missing = commands.filter((command) => !proofs.readProof(proofs.commandProof(tree, config, options.config, command)));
  const merge = intentReview.mergeOwed(tree, config, intentReview.intentFor(tree, options));
  const base = options.base || resolveBase(config, null, tree);
  const smoke = lanes.smokeOwed(tree, config, options.config, changedPaths(tree, mergeBase(tree, base)));
  const owed = [...merge.owed, ...smoke.owed];
  const out = [...restored, ...merge.out, ...smoke.out];
  if (missing.length === 0 && owed.length === 0) return { exit: 0, payload: { green: true, hash }, out: [...restored, ...smoke.out, `green ${hash}`] };
  if (missing.length > 0) out.push(`no green marker for ${hash}`, 'run gate first');
  return { exit: 3, payload: { green: false, hash, missing, owed }, out };
}

module.exports = {
  changedPaths,
  describe,
  foldBase,
  gate,
  green,
  mergeBase,
  refuseDirty,
  treeOf,
};
