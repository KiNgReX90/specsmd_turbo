'use strict';

/**
 * Every call a script prints for its caller to run next, and the only place a script file name
 * appears in one. Each kind of call has one named builder that owns its own flags, so a site
 * names the call it means and cannot drop or change a flag. A call carries the caller's tree,
 * intent and host config, so run as printed it reads the config the caller's call read and
 * dispatches that host's agents.
 *
 * The carried flags are the process's own. The runner and the writer record the flags they
 * were called with through `caller` once, when they parse them, and every call reads the host
 * config from that record, so no site can drop or replace it. A builder takes from its site
 * only what decides its line: the tree a runner call names, an item id, a lane, the plan of a
 * plan-time scan, the intent of a writer call, and the intent of a runner call where the site's
 * differs from the caller's.
 *
 * A leaf that loads no other script, so the ledger writer prints its calls through it too:
 * run-lib loads the writer, and the writer can load nothing that loads run-lib. The guard in
 * src/__tests__/unit/inferno/printed-calls.test.ts refuses a script name or a call anywhere else.
 */

const path = require('path');

/** The runner and the ledger writer by file name, and the runner by its own path. */
const RUNNER = 'run.cjs';
const RUNNER_PATH = path.join(__dirname, RUNNER);
const WRITER_SCRIPT = 'state-transition.cjs';

/** The flags this process was called with, recorded once by `caller`. */
const called = { config: null, intent: null, tree: null };

/** Record the flags the runner or the writer was called with, right after it parses them. */
function caller(options) {
  called.config = options.config || null;
  called.intent = options.intent || null;
  called.tree = options.tree || null;
}

const flag = (name, value) => (value ? ` --${name} ${value}` : '');

/**
 * A runner call: the step, its own flags, the tree it names, then the intent and the host
 * config. A site names an intent only where it differs from the caller's, as the frontier's
 * positional one does; else the call carries the caller's.
 */
function runCall(step, tree, intent, flags = []) {
  return `${RUNNER} ${[step, ...flags].join(' ')} --tree ${tree}${flag('intent', intent || called.intent)}${flag('config', called.config)}`;
}

/** The same call by the runner's own path, for a line the caller runs from anywhere. */
function nodeCall(step, tree, intent, flags = []) {
  return `node ${RUNNER_PATH}${runCall(step, tree, intent, flags).slice(RUNNER.length)}`;
}

/**
 * A ledger writer call: the command, its own flags, the intent of the writer call that prints
 * it, then the caller's tree and host config. A writer function also runs in the runner's
 * process, where the record holds the runner's flags, so its intent comes from the site alone.
 */
function writerCall(command, intent, flags = []) {
  return `${WRITER_SCRIPT} ${[command, ...flags].join(' ')}${flag('intent', intent)}${flag('tree', called.tree)}${flag('config', called.config)}`;
}

/** Start the gate as its own process. */
const gateStartCall = (tree) => runCall('gate', tree, null, ['--detach']);

/** Start the gate after the tree's running lanes are proven stopped. */
const gateSupersedeCall = (tree) => runCall('gate', tree, null, ['--detach', '--supersede']);

/** Wait on the started gate and its lanes, by the runner's own path. */
const gateWaitCall = (tree) => nodeCall('gate', tree, null, ['--wait']);

/** The cold review of one item, of `intent` when it is not the caller's. */
const itemReviewCall = (tree, id, intent = null) => runCall('review', tree, intent, ['--item', id]);

/**
 * Record the item review its reviewer wrote, under that reviewer's agent id, which only the
 * host knows; of `intent` when it is not the caller's. With `quality` the quality lens wrote
 * its own file beside it, recorded under its own reviewer's id.
 */
const itemRecordCall = (tree, id, intent = null, quality = false) => runCall('review', tree, intent,
  ['--item', id, '--reviewer', '<agent-id>', ...(quality ? ['--quality-reviewer', '<quality-agent-id>'] : [])]);

/** The check and the proof of one item, or of the batch `ids` names, as verify-item checks it. */
const verifyItemCall = (tree, ids) => runCall('verify-item', tree, null, ids.length > 1 ? ['--items', ids.join(',')] : [ids[0]]);

/** Land one item: fold, the cheap checks, then its completion; of `intent` when it is not the caller's. */
const integrateCall = (tree, id, intent = null) => runCall('integrate', tree, intent, ['--item', id]);

/** The cold review of the whole intent. */
const intentReviewCall = (tree) => runCall('review', tree, null);

/** Record the intent review its reviewer wrote, under that reviewer's agent id. */
const intentRecordCall = (tree) => runCall('review', tree, null, ['--reviewer', '<agent-id>']);

/**
 * The scan before the intent review, or its collect. Given the plan's intent it is the
 * plan-time cross-check.
 */
function scanCall(tree, plan = null, collect = false) {
  return runCall('scan', tree, null, [...(collect ? ['--collect'] : []), ...(plan ? ['--plan', plan] : [])]);
}

/** The slice check of one item just before its dispatch, or its collect. */
function itemScanCall(tree, id, collect = false) {
  return runCall('scan', tree, null, [...(collect ? ['--collect'] : []), '--item', id]);
}

/**
 * The oracle ask of a cross-check finding still open after both fix rounds: complexity high
 * earlier by the rubric, the impact the asker grades. The plan's intent is the positional one,
 * so the call carries no other.
 */
function planOracleCall(tree, plan) {
  const complexity = '"high earlier: <GAP id> stayed open through both fix rounds of the cross-check"';
  return `${RUNNER} dispatch-log ${plan} --tier oracle --impact "<grade>: <line>" --complexity ${complexity} --tree ${tree}` +
    flag('config', called.config);
}

/** The real-app check over a review's range, read from the item's own paths when one is named. */
const realAppCall = (tree, range, id = null) => runCall('real-app', tree, null, ['--range', range, ...(id ? ['--item', id] : [])]);

/** Remove a worktree and branch the base already holds. */
const teardownCall = (tree) => runCall('teardown', tree, null);

/** Accept a lane's instrument red against a harness fix, by the runner's own path. */
const laneAcceptCall = (lane, tree) => nodeCall(lane, tree, null, ['--accept', '--harness-fix', '<sha>']);

/** One word for a POSIX shell, whatever quotes or dollar signs a test name carries. */
const shellWord = (text) => `'${text.replace(/'/g, "'\\''")}'`;

/** Accept a lane's product red its verdicts proved intermittent, naming each red test, by the runner's own path. */
const laneIntermittentCall = (lane, tree, tests) => nodeCall(lane, tree, null,
  ['--accept-intermittent', ...tests.flatMap((test) => ['--test', shellWord(test)]), '--reason', '"<why>"', '--by', '<who>']);

/**
 * A merge slot call for a holder by the runner's own path, for a driver that holds its own
 * ticket: `take`, `renew` or `release`, or the queue itself when `verb` is null.
 */
const slotCall = (tree, verb, holder) => nodeCall('slot', tree, null, verb ? [`--${verb}`, '--holder', holder] : []);

/** Close an intent whose items are all completed. */
const closeIntentCall = (intent) => writerCall('close-intent', intent);

/** Park a pending intent with the reason it waits on. */
const blockIntentCall = (intent) => writerCall('block-intent', intent, ['--reason', '"<why it cannot be built yet>"']);

/** Give back a claim nothing was built on. */
const unclaimIntentCall = (intent) => writerCall('unclaim-intent', intent);

/** Defer an item out of its intent, with a new edge to name for each dependent it leaves. */
const deferItemCall = (intent, item, dependents = []) => writerCall('defer-item', intent,
  ['--item', item, '--reason', '"<why it waits for a later plan>"', ...dependents.map((id) => `--rewire ${id}=<new-dep>`)]);

module.exports = {
  RUNNER, RUNNER_PATH, caller, blockIntentCall, closeIntentCall, deferItemCall, gateStartCall, gateSupersedeCall, gateWaitCall, integrateCall, intentRecordCall,
  intentReviewCall, itemRecordCall, itemReviewCall, itemScanCall, laneAcceptCall, laneIntermittentCall, planOracleCall, realAppCall, scanCall, slotCall, teardownCall, unclaimIntentCall,
  verifyItemCall,
};
