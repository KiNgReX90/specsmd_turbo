'use strict';

/**
 * A finalize command red on one gate and run again by the next gate on the same code. The second
 * gate used to be a new run nothing tied to the red one, and why it ran lived only in what the gate
 * agent reported; the red run's log went with the branch's cache folder at ship.
 *
 * Every gate whose finalize commands reached a verdict writes it into the branch's cache folder
 * (`gate-verdict.json`): green, or red on a command, with the code tree hash taken past its fold and
 * the red command's log. A gate killed mid-run, refused before a command ran, given no verdict by
 * the host's wrapper (run-check-refused.cjs) or whose code moved while it ran writes none, so the
 * verdict before it stands; a red lane has its own accept (run-lanes-intermittent.cjs). The next
 * gate is a rerun when that verdict is red on the hash it has now: a fix, or a fold that brought a
 * change, makes the code new and the gate no rerun.
 *
 * A rerun takes `--cause "<why>" --by <who>`; any other gate refuses them, and the cap a lane accept
 * has refuses them once the base holds two of the command since a commit named its fix. Without
 * them it runs and says what its green loses. A red rerun keeps the red verdict, adding its own red,
 * so the gate after it is a rerun again. A green one writes its cause beside the proof each red
 * command's green minted (`<proof>.rerun`), bound to that proof and the branch: it lives as long as
 * that green, which a commit outside a scoped command's scope keeps and one inside it replaces. Every
 * gate that reads that green shows the cause, and ship reads it from there, never from the operator's
 * words at ship time. Whether a gate is a rerun stays decided by the code tree hash.
 *
 * No reader of the flow takes a test name from a log, so the command stands in for the tests its
 * red log names, and `Fixes-intermittent: <command>` lifts its cap. Ship writes one line per cause
 * and first copies the red log, that one file, to `<cache>/rerun-evidence/`, which no branch cleanup
 * owns; the line names the copy relative to the cache, so the base's history holds no machine path.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const jobs = require('./run-jobs.cjs');
const proofs = require('./run-proofs.cjs');
const slot = require('./run-slot.cjs');
const { atomicWrite } = require('./state-store.cjs');
const { resolveBase } = require('./run-intents.cjs');
const { repeats, rerunLine } = require('./run-lanes-intermittent.cjs');
const { gateCauseCall, gateStartCall } = require('./run-call.cjs');

const { RunError } = lib;
const VERDICT = 'gate-verdict.json';
const PENDING = 'gate-cause.json';
const RECORD = '.rerun';
const EVIDENCE = 'rerun-evidence';
const NOT_KEPT = 'not kept: gone before ship';
const GATE_USAGE = 'usage: node run.cjs gate [--detach] [--supersede] --cause "<why>" --by <who> [--tree <dir>] [--config <file>]: ' +
  'both filled, on a gate run again on the code a finalize command was red on; never with --wait, --lane, --lanes-only or --test, ' +
  'since the cap counts the command';

const filled = (text) => typeof text === 'string' && text.trim().length > 0;
const branchFile = (tree, name) => path.join(lib.cacheDir(tree), lib.currentBranch(tree), name);
const save = (file, value) => atomicWrite(file, `${JSON.stringify(value)}\n`);

/** Refuse a cause on any step but the gate, and a gate's cause without its signer or beside a call that runs no finalize command. */
function causeUsage(command, options) {
  if (command !== 'gate') {
    if (options.cause === undefined) return;
    throw new RunError(`${command} takes no --cause: only a gate run again on the code a finalize command was red on records one`, 'BAD_ARGS', 1);
  }
  if (options.cause === undefined && options.by === undefined) return;
  if (filled(options.cause) && filled(options.by) && !options.wait && !options.lane && !options.lanes_only && !options.tests) return;
  throw new RunError(GATE_USAGE, 'BAD_ARGS', 1);
}

/** The last verdict of this branch when it is red on a finalize command of the code `hash` names, else null. */
function redOn(tree, hash) {
  const last = jobs.readJson(branchFile(tree, VERDICT));
  return last && last.hash === hash && Array.isArray(last.reds) ? last : null;
}

/**
 * Past the fold and before any command runs: whether this gate runs the last verdict's red again,
 * with the cause it records or the line that says it records none. A cause on a gate that is no
 * rerun is refused, and so is one the base holds the limit for, since its run would be wasted.
 */
function rerunOf(tree, config, options, hash) {
  const last = redOn(tree, hash);
  if (!last && options.cause !== undefined) {
    throw new RunError(`no finalize command was red on the last gate of ${lib.currentBranch(tree)} on this code, so there is no cause to record: ` +
      `run the gate without --cause, ${gateStartCall(tree)}`, 'NO_RERUN');
  }
  if (!last) return { out: [] };
  const commands = last.reds.map((red) => red.command);
  if (options.cause === undefined) {
    return { out: [`no --cause on a rerun of the red ${commands.join(', ')} on unchanged code: its green records no cause, and ship writes no exception line`] };
  }
  const cause = options.cause.trim();
  const by = options.by.trim();
  const earlier = repeats(tree, resolveBase(config, null, tree), commands, 'run the gate again with its cause');
  const said = commands.map((command) => `rerun of the red ${command} on unchanged code, cause by ${by}: ${JSON.stringify(cause)}`);
  return { reds: last.reds, cause, by, out: [...said, ...earlier] };
}

/** A queued gate --detach leaves its cause, or none, for the start at the head, which a --wait makes. */
function pend(tree, options) {
  save(branchFile(tree, PENDING), { cause: options.cause, by: options.by });
}

/**
 * gate --detach: `rerunOf` on the code past its fold, with the cause a queued detach left when a
 * --wait starts it at the head; a refusal gives the merge slot ticket back, as a red cases check does.
 */
function detachRerun(tree, config, options) {
  const left = options.wait ? jobs.readJson(branchFile(tree, PENDING)) : null;
  try {
    return rerunOf(tree, config, { ...options, ...left }, lib.codeTreeHash(tree));
  } catch (error) {
    slot.release(tree);
    throw error;
  }
}

/** Each finalize command's rerun record beside its proof as it stands, from this branch: the causes the greens it reads hold. */
function heldReruns(tree, config, selected) {
  const branch = lib.currentBranch(tree);
  return config.verification.finalize
    .map((command) => jobs.readJson(`${proofs.commandProof(tree, config, selected, command).file}${RECORD}`))
    .filter((record) => record && record.branch === branch);
}

/**
 * After the commands: write the verdict this gate reached, a red one keeping the reds the verdict
 * before it held on the same code, and for a green rerun with a cause its record beside each red
 * command's proof. Returns the lines that ride in the result and what a green result carries.
 */
function settle(tree, config, selected, again, { hash, dir, failed, green }) {
  const file = branchFile(tree, VERDICT);
  if (failed && !failed.moved) {
    const before = redOn(tree, hash);
    const kept = before ? before.reds.filter((red) => red.command !== failed.command) : [];
    save(file, { hash, reds: [...kept, { command: failed.command, dir, log: failed.log }] });
    return { notes: [`if this red is not this branch's work, gate the same code again with its cause: ${gateCauseCall(tree)}`], payload: {} };
  }
  if (!green) return { notes: [], payload: {} };
  const branch = lib.currentBranch(tree);
  for (const red of again.reds || []) {
    save(`${proofs.commandProof(tree, config, selected, red.command).file}${RECORD}`, {
      hash, branch, command: red.command, tests: [red.command], cause: again.cause, by: again.by, run: path.basename(red.dir), dir: red.dir, log: red.log, stamp: new Date().toISOString(),
    });
  }
  save(file, { hash });
  const held = heldReruns(tree, config, selected);
  return {
    notes: held.map((record) => `RERUN ${record.command}: red in ${record.run}, cause by ${record.by}: ${JSON.stringify(record.cause)}`),
    payload: held.length > 0 ? { rerun: held } : {},
  };
}

/** Copy one red log out of the branch's folder into the cache's evidence folder; returns its path relative to the cache, or why there is none. */
function keep(primary, branch, record, out) {
  if (!fs.existsSync(record.log)) {
    out.push(`the red log of ${record.command} was gone before ship, so its exception line keeps none: ${record.log}`);
    return NOT_KEPT;
  }
  // A branch name holds slashes: encoded it names one folder, and no two branches the same one.
  const kept = path.posix.join(EVIDENCE, `${encodeURIComponent(branch)}-${record.run}`, path.basename(record.log));
  const to = path.join(lib.cacheDir(primary), kept);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(record.log, to);
  out.push(`kept the red log of ${record.command} at ${to}`);
  return kept;
}

/**
 * Ship, before the merge commit is written and before any cleanup runs: the exception line of each
 * cause the shipped greens hold, every one refused first once the base holds its limit, then each
 * red log kept where the line names it.
 */
function shipReruns(primary, base, tree, selected, out) {
  const config = lib.readConfig(tree, selected);
  const held = heldReruns(tree, config, selected);
  for (const record of held) repeats(primary, base, record.tests, 'ship again');
  const branch = lib.currentBranch(tree);
  return held.map((record) => rerunLine({
    command: record.command, tests: record.tests, cause: record.cause, by: record.by, run: record.run, log: keep(primary, branch, record, out),
  }));
}

module.exports = { causeUsage, detachRerun, pend, rerunOf, settle, shipReruns };
