'use strict';

/**
 * The real-app proof of an item, on a host whose config sets `real_app.prove`: one shell command
 * that runs, on the real app binary, the journeys an item changed. A test of what only the real
 * binary shows then runs in the item that wrote it, and a wrong one goes back to its warm builder
 * instead of reaching the final gate's lanes first.
 *
 * The journeys are the paths of the item's diff under `real_app.paths` that the tree still
 * holds. verify-item runs the command when there is one, in the tree under bash, with
 * INFERNO_TREE, the tree, and INFERNO_JOURNEYS, a file outside the tree listing those paths one
 * per line, relative to the tree, the way a lane's accept_check gets its log in INFERNO_LANE_LOG.
 * It records the run in the item's proof as `real_app`, beside the item's checks, and a red fails
 * verify-item as a failing check does. A diff with no journey records `real_app: null`.
 *
 * On such a host the review waits for that record: `owedProof` names why a proof does not hold
 * the run of the journeys as the host proves them now, and proofAtHead then calls the proof one
 * of an older state. Without the key nothing here runs and a proof has no `real_app` field.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { realAppPaths, realAppProve } = require('./run-real-app.cjs');

/** The command and globs of `config`, or null without `real_app.prove`. */
function proving(config, label = path.join(lib.SPECS_DIR, 'config.yaml')) {
  const command = realAppProve(config, label);
  return command ? { command, globs: realAppPaths(config, label) } : null;
}

const present = (tree, file) => {
  try {
    fs.lstatSync(path.join(tree, file));
    return true;
  } catch (error) {
    return false;
  }
};

/** The journeys of a diff over `paths`: those under the globs the tree still holds, in order. */
function journeysOf(tree, paths, globs) {
  return paths.filter((file) => lib.matchesAny(file, globs) && present(tree, file));
}

/**
 * Run the proof over the item's diff `paths`. Returns undefined without the key, `{ record: null }`
 * when the diff changed no journey, else `{ record, out }`. `summarize(output)` gives the
 * `counts` and `tail` the item's checks record. `name` names the log and the journeys file.
 */
function proveItem(tree, config, label, paths, name, summarize) {
  const host = proving(config, label);
  if (!host) return undefined;
  const journeys = journeysOf(tree, paths, host.globs);
  if (journeys.length === 0) return { record: null, out: [] };
  const base = path.join(lib.cacheDir(tree), lib.currentBranch(tree), `real-app-${name}-${lib.stamp()}`);
  const list = `${base}.txt`;
  fs.mkdirSync(path.dirname(list), { recursive: true });
  fs.writeFileSync(list, `${journeys.join('\n')}\n`);
  // A second run in the same second writes the same log, and its record reads only its own lines.
  fs.rmSync(`${base}.log`, { force: true });
  const run = lib.runShell(host.command, tree, `${base}.log`, { env: { INFERNO_TREE: path.resolve(tree), INFERNO_JOURNEYS: list } });
  let output = '';
  try {
    output = fs.readFileSync(run.log, 'utf8');
  } catch (error) {
    output = '';
  }
  const record = { command: host.command, journeys, exit: run.code, seconds: run.seconds, ...summarize(output), log: run.log };
  const files = `${journeys.length} journey file${journeys.length === 1 ? '' : 's'}`;
  const out = run.code === 0
    ? [`PASS ${run.seconds}s real_app.prove ${host.command} over ${files}`]
    : [`FAIL ${run.seconds}s real_app.prove ${host.command} -> ${run.log}`, ...lib.tail(run.log, 5)];
  return { record, out };
}

/** The journeys a refusal names before it counts the rest. */
const SHOWN = 5;
const sameList = (left, right) => left.length === right.length && left.every((entry, index) => entry === right[index]);

/**
 * Why `proof` does not hold the run of the journeys the host proves now, or null when it does or
 * no run is owed. `proof` is the item's proof file, read; with none, `owned()`, the item's
 * editable list, decides: an item owning a journey the tree holds may have changed it, and only
 * verify-item reads its diff.
 */
function owedProof(tree, config, proof, file, owned) {
  const host = proving(config);
  if (!host) return null;
  if (!proof) {
    const editable = owned();
    const holds = lib.gitLines(tree, ['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', 'HEAD'], { tolerate: true })
      .some((entry) => lib.matchesAny(entry, host.globs) && lib.ownedBy(entry, editable, tree));
    return holds ? 'no proof is on record, and the item owns journeys under real_app.paths that real_app.prove runs before its review' : null;
  }
  const journeys = journeysOf(tree, (proof.diff && proof.diff.paths) || [], host.globs);
  if (journeys.length === 0) return null;
  const run = proof.real_app;
  const named = `${journeys.slice(0, SHOWN).join(', ')}${journeys.length > SHOWN ? ` and ${journeys.length - SHOWN} more` : ''}`;
  if (run === undefined || run === null) return `its proof ${file} holds no run of real_app.prove over ${named}`;
  if (run.command !== host.command || !Array.isArray(run.journeys) || !sameList(run.journeys, journeys)) {
    return `its proof ${file} ran real_app.prove as another command or over other journeys than its diff changes now`;
  }
  return null;
}

module.exports = { journeysOf, owedProof, proveItem, proving };
