'use strict';

/**
 * A test file an item moves keeps the switch-offs it already had: how verify-item reads the
 * switch-off lines of a moved test file (run-item-proof.cjs). The item's diff lists a move as its
 * old path deleted and its new one added (`--no-renames`), so every line at the new path reads as
 * added. For a test file that is the destination of a move from the diff's start `from` to the
 * item's tree, a switch-off line is the item's only when the source did not already switch the same
 * test off: as `from` held it, with what a fold of the base (run-fold.cjs) changed at the source
 * since, from `held` to `tip`, counted in. A copy whose source still stands is no move, and a pair
 * git does not find reads as before: every switch-off new.
 *
 * Git pairs the move as it does by default, 50% alike, so a move that also edits a few lines is a
 * move; its flags stand on the command line, so no host config turns the pairing off or lowers its
 * limit below git's own. A source that was no test file is read all the same: what it held at
 * `from` is older than the item. A wrong pair can raise an alarm, never hide one: a marker counts
 * as carried only when the source held the same marker on the same test.
 *
 * A test is named by the marker's own line, by what it stands above when it is an attribute
 * (`#[ignore]` above a `fn`, `@Disabled` above a method, a decorator above a `def`: the next line
 * as deep or less with a word on it that is no attribute and no comment), and by every line that
 * encloses it (each nearest line above at a smaller indent). Switch-offs are counted per test, so a
 * second one of the same kind on the same test is new, and so is one moved to another test.
 */

const { isSwitchOff } = require('./run-test-files.cjs');

// Every rename from `from` to the item's tree, never a copy, at git's default similarity and its default limit for a diff.
const MOVES = ['diff', '--cached', '--name-status', '-z', '--find-renames', '-l1000', '--diff-filter=R'];
const ATTRIBUTE = /^\s*(?:#\[|@)/;
const COMMENT = /^\s*(?:\/\/|\/\*|#)/;
const literal = (file) => `:(literal)${file}`;
const depth = (text) => /^\s*/.exec(text)[0].length;

/** What names the test the switch-off at `lines[at]` mutes, as one string. */
function testOf(lines, at) {
  const own = lines[at];
  const names = [own.trim()];
  if (ATTRIBUTE.test(own)) {
    const marked = lines.slice(at + 1).find((text) => /\w/.test(text) && depth(text) <= depth(own) && !ATTRIBUTE.test(text) && !COMMENT.test(text));
    names.push((marked || '').trim());
  }
  for (let i = at - 1, inner = depth(own); i >= 0; i -= 1) {
    if (/\S/.test(lines[i]) && depth(lines[i]) < inner) {
      names.push(lines[i].trim());
      inner = depth(lines[i]);
    }
  }
  return names.join('\n');
}

/** How many times `content`, read as the test file `file`, switches each of its tests off. */
function switchOffCounts(content, file) {
  const lines = content.split('\n');
  const counts = new Map();
  lines.forEach((text, at) => {
    if (!isSwitchOff(text, file)) return;
    const name = testOf(lines, at);
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return counts;
}

/** The entries of `off`, switch-off lines of `content` as { line, text }, that the counts in `carried` leave new. Spends `carried`. */
function uncarried(off, content, carried) {
  const lines = content.split('\n');
  return off.filter((entry) => {
    const name = testOf(lines, entry.line - 1);
    carried.set(name, (carried.get(name) || 0) - 1);
    return carried.get(name) < 0;
  });
}

/** Adds the counts of `more`, times `sign`, to `counts`. */
function add(counts, more, sign = 1) {
  for (const [name, count] of more) counts.set(name, (counts.get(name) || 0) + sign * count);
}

/** The content of `file` at `rev`, or '' where `rev` holds none: a base that never had the file. */
function blobAt(git, rev, file) {
  try {
    return git(['cat-file', 'blob', `${rev}:${file}`]);
  } catch (error) {
    return '';
  }
}

/**
 * The switch-off reading of moved test files through `git`, the item's scratch index
 * (run-item-proof.cjs), over the item's `files` from `from`, with the fold `ranges` since: gives
 * `(file, off)`, which returns the entries of `off`, the switch-off lines the diff adds to `file`,
 * that the source of its move did not already hold on the same test, and `off` itself for a file
 * no move took.
 */
function movedSwitchOffs(git, from, files, ranges) {
  const fields = git([...MOVES, from, '--', ...files.map(literal)]).split('\0');
  const sources = new Map();
  for (let i = 2; i < fields.length; i += 3) sources.set(fields[i], fields[i - 1]);
  return (file, off) => {
    const source = sources.get(file);
    if (!source) return off;
    // The source exists at `from`: git paired it there.
    const carried = switchOffCounts(git(['cat-file', 'blob', `${from}:${source}`]), file);
    for (const { held, tip } of ranges) {
      add(carried, switchOffCounts(blobAt(git, tip, source), file));
      add(carried, switchOffCounts(blobAt(git, held, source), file), -1);
    }
    return uncarried(off, git(['cat-file', 'blob', `:0:${file}`]), carried);
  };
}

module.exports = { movedSwitchOffs, switchOffCounts, uncarried };
