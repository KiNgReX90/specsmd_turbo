'use strict';

/**
 * The third proof of an acceptance criterion, beside a caught mutant and a checked pin: a gate
 * mark. Some criteria no mutant in the tree can turn red: the code compiles on the Windows lane,
 * a lint passes, no file passes the size cap. The planner ends such a criterion's own line with
 * `(gate: <name>)`, so no criterion is renumbered and a recorded mutant keeps naming the one it
 * named. The criterion then owes no mutant (run-mutant-coverage.cjs), and the gate prints it
 * beside the verdict of what it names (run-gate-marks.cjs).
 *
 * A name is one of the things the gate runs: a command of `verification.finalize`, verbatim, or a
 * lane the config sets, as `verification.<lane>` (`verification.smoke`, `verification.windows`).
 * One pair of backticks around the name is read past. The plan lint refuses any other name.
 *
 * The reviewer never adds a mark: a criterion that turns out unreachable goes to the
 * orchestrator, which amends the spec in one commit that changes that spec alone. So once the
 * item's first review is committed, a mark counts only when the commit that last changed its
 * criterion's text came before that review, or changed nothing but the spec. A mark that is not
 * committed, or that came with the review or beside other work, counts for nothing. The text,
 * not the mark alone, is what is looked for: two criteria may carry the same mark.
 *
 * The spec's history is read over both its homes, live and archived. The commit that closes and
 * archives the intent moves the spec, ticks its checkboxes and moves the intent's other files
 * beside it: the text stands in the spec as often after it as before, so it changes no criterion's
 * text and the commit before it decides. A mark that arrives with the archive, or after it beside
 * other work, is late as before.
 */

const path = require('path');

const lib = require('./run-lib.cjs');
const { configuredLanes } = require('./run-lane-config.cjs');

const MARK = /(?:^|\s)\(gate:\s*(.*?)\s*\)$/;

/** The name a criterion's gate mark gives, or null when its line ends in none. */
function gateMark(text) {
  const match = MARK.exec(text);
  return match && match[1] ? match[1].replace(/^`(.+)`$/, '$1') : null;
}

/** Every name a mark may give under this config: its finalize commands, then its lanes. */
function gateNames(config) {
  const verification = config.verification || {};
  const commands = Array.isArray(verification.finalize) ? verification.finalize : [];
  return [...commands, ...configuredLanes(config).map((lane) => `verification.${lane.name}`)];
}

/** The two homes of a spec, live and archived, from its path in either. */
function homes(rel) {
  const archive = `${lib.SPECS_DIR}/archive/`;
  const live = rel.startsWith(archive) ? `${lib.SPECS_DIR}/${rel.slice(archive.length)}` : rel;
  return [live, `${archive}${live.slice(lib.SPECS_DIR.length + 1)}`];
}

/**
 * The oldest commit of the item's review file, the one that recorded its first review, or null when
 * none is committed. A review is only ever recorded at the live path, and the archive's move keeps
 * that path's history, so the live path alone holds it.
 */
function firstReview(tree, intentId, itemId) {
  const rel = path.posix.join(lib.SPECS_DIR, 'intents', intentId, 'reviews', `${itemId}.yaml`);
  const commits = lib.gitLines(tree, ['log', '--format=%H', '--', rel]);
  return commits.length > 0 ? commits[commits.length - 1] : null;
}

/** How often `text` stands in the spec at `ref`, in whichever of its homes it has there. */
function occurrences(tree, specs, text, ref) {
  return specs.reduce((sum, spec) => {
    const body = lib.git(tree, ['show', `${ref}:${spec}`], { tolerate: true });
    return sum + (body === null ? 0 : body.split(text).length - 1);
  }, 0);
}

/**
 * The last commit that changed how often the criterion's text stands in the spec, over both homes,
 * or null. The pickaxe never lists a merge, which shows no diff of its own, so the commit found
 * always changed a file: a mark that came through a merge is found on the side that wrote it.
 */
function lastChange(tree, specs, text) {
  const commits = lib.gitLines(tree, ['log', '--no-renames', '--format=%H', `-S${text}`, '--', ...specs]);
  return commits.find((commit) => occurrences(tree, specs, text, commit) !== occurrences(tree, specs, text, `${commit}^`)) || null;
}

/** Whether a marked criterion's text came before the review, or in a commit that changed its spec alone. */
function planned(tree, specs, text, review) {
  const commit = lastChange(tree, specs, text);
  if (!commit) return false;
  if (commit !== review && lib.git(tree, ['merge-base', '--is-ancestor', commit, review], { tolerate: true }) !== null) return true;
  const changed = lib.gitLines(tree, ['show', '--no-renames', '--name-only', '--format=', commit]);
  return changed.every((file) => specs.includes(file));
}

/**
 * The 0-based indexes of the criteria whose mark counts for nothing, as the header says. An item
 * with no mark reads no history at all, so it is counted exactly as before the marks.
 */
function lateMarks(tree, intentId, itemId, specFile, criteria) {
  const marked = criteria.map((text, index) => ({ index, text })).filter((entry) => gateMark(entry.text) !== null);
  if (marked.length === 0) return [];
  const review = firstReview(tree, intentId, itemId);
  if (!review) return [];
  const specs = homes(path.relative(tree, specFile).split(path.sep).join('/'));
  return marked.filter((entry) => !planned(tree, specs, entry.text, review)).map((entry) => entry.index);
}

module.exports = { gateMark, gateNames, lateMarks };
