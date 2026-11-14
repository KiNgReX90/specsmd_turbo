'use strict';

/**
 * Whether work on a work item has started: the line defer-item does not cross.
 *
 * The line is the item's first builder dispatch. Before it the item is a plan: probed, asked
 * about, waiting on a dependency, and nothing of it is on the intent branch. From it on a
 * builder has touched the tree. A deferred item ships nothing, owes no review and is never
 * integrated, so work already on the branch would reach the base unreviewed. Besides a run
 * holding the item (its ledger status, which defer-item reads itself), three marks show the line
 * was crossed:
 *   - a builder line for the item in the intent's dispatch log. An oracle ask is no dispatch:
 *     an oracle edits nothing, and its answer is often what leads the owner to defer;
 *   - its review, recorded on the ledger or written to its file;
 *   - a commit on the intent branch, since its merge base with the base branch, that changed a
 *     file only this item owns. A file another item owns too proves nothing about this one; the
 *     dispatch log is what catches a builder that touched shared files only.
 *
 * The log and the branch are read through run-lib, required inside the functions: run-lib
 * loads the writer, which loads this file. A tree outside git has neither, so only the ledger
 * and the review file speak there.
 */

const fs = require('fs');
const path = require('path');

/** The dispatch ids of every builder line the intent's log holds for the item. */
function dispatches(lib, tree, intentId, itemId) {
  let log;
  try {
    log = path.join(lib.cacheDir(tree), 'dispatch', `${intentId}.log`);
  } catch (error) {
    if (error.code === 'NO_REPO') return [];
    throw error;
  }
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').map((line) => line.split('\t'))
    .filter((fields) => fields[2] === itemId && fields[3] !== 'oracle')
    // A line the runner before signed records wrote ends before the dispatch id: its moment names it.
    .map((fields) => fields[6] || fields[0]);
}

/** What an item may edit, by its spec; nothing when the spec is gone. */
function editable(lib, tree, intentId, itemId) {
  try {
    const manifest = lib.readItemSpec(tree, intentId, itemId).manifest || {};
    return (manifest.ownership && manifest.ownership.editable) || [];
  } catch (error) {
    if (error.code === 'SPEC_MISSING') return [];
    throw error;
  }
}

/** Each commit on the intent branch that changed a file only this item owns, as `<sha> <file>`. */
function commits(lib, tree, scope) {
  if (lib.git(tree, ['rev-parse', '--show-toplevel'], { tolerate: true }) === null) return [];
  const { resolveBase } = require('./run-intents.cjs');
  const base = resolveBase(lib.readConfig(tree, scope.config), { base_branch: scope.baseBranch }, tree);
  const fork = lib.git(tree, ['merge-base', 'HEAD', base], { tolerate: true });
  if (!fork) return [];
  const own = editable(lib, tree, scope.intent, scope.item);
  const others = scope.siblings.flatMap((id) => editable(lib, tree, scope.intent, id));
  const found = [];
  let sha = null;
  for (const line of lib.gitLines(tree, ['log', '--format=%x00%h', '--name-only', `${fork}..HEAD`])) {
    if (line.startsWith('\0')) sha = line.slice(1);
    else if (lib.ownedBy(line, own, tree) && !lib.ownedBy(line, others, tree)) found.push(`${sha} ${line}`);
  }
  return found;
}

/**
 * Every mark of work on the item, one phrase each; empty when none. `scope` names the ledger
 * file, the intent, the item, its recorded review, its siblings' ids, the intent's base branch
 * and the host config.
 */
function workOn(scope) {
  const specsDir = path.dirname(path.resolve(scope.file));
  const tree = path.dirname(specsDir);
  const lib = require('./run-lib.cjs');
  const marks = [];
  const logged = dispatches(lib, tree, scope.intent, scope.item);
  if (logged.length > 0) marks.push(`a builder was dispatched on it (dispatch ${logged.join(', ')})`);
  if (scope.review) marks.push(`its review is recorded (${scope.review})`);
  const file = path.join(specsDir, 'intents', scope.intent, 'reviews', `${scope.item}.yaml`);
  if (fs.existsSync(file)) marks.push(`its review file ${path.relative(tree, file)} is written`);
  const changed = commits(lib, tree, scope);
  if (changed.length > 0) marks.push(`the intent branch holds commits on files only it owns: ${changed.slice(0, 3).join(', ')}`);
  return marks;
}

module.exports = { workOn };
