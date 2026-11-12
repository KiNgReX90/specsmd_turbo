'use strict';

/**
 * What a fold of the base brought into an item's window, as verify-item reads it. A fold is the
 * base range HEAD took in since a baseline: from the last base commit the baseline held to the
 * base tip HEAD holds now, merged or fast-forwarded, one range per base ref, however many folds
 * it took. In a file the item also changed, a line that range added is the base's
 * (`baseLines`), and a path an accepted dispatch recorded that changed since by that range's
 * change alone is the base's too (`foldedAlone`).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { spawnSync } = require('child_process');

const lib = require('./run-lib.cjs');
const { parseAddedLines } = require('./run-test-files.cjs');

const DIFF_FLAGS = ['--full-index', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', '-U0'];
const literal = (file) => `:(literal)${file}`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The fold ranges `{ held, tip }` since the baseline at `head`: per ref of `base`, the base tip
 * HEAD holds and the last base commit `head` held, when HEAD holds more of the base. On the base
 * branch itself nothing is a fold.
 */
function foldRanges(tree, head, base) {
  if (!base || !head || lib.currentBranch(tree) === base) return [];
  const ranges = [];
  for (const ref of [base, `origin/${base}`]) {
    const tip = lib.git(tree, ['merge-base', 'HEAD', ref], { tolerate: true });
    const held = tip && lib.git(tree, ['merge-base', head, tip], { tolerate: true });
    if (!held || held === tip || ranges.some((range) => range.held === held && range.tip === tip)) continue;
    ranges.push({ held, tip });
  }
  return ranges;
}

/** The hunks of a `-U0` diff as { from, removed, added }: `from` the first old line, or the line an insertion follows. */
function hunksOf(diff) {
  const hunks = [];
  for (const raw of String(diff).split('\n')) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(raw);
    if (hunk) hunks.push({ from: Number(hunk[1]), removed: hunk[2] === undefined ? 1 : Number(hunk[2]), added: hunk[3] === undefined ? 1 : Number(hunk[3]) });
  }
  return hunks;
}

/** Where old line `line` stands in the new file after `hunks`, or null when the diff changed it. */
function carried(hunks, line) {
  let shift = 0;
  for (const hunk of hunks) {
    if (hunk.removed === 0 ? line <= hunk.from : line < hunk.from) break;
    if (hunk.removed > 0 && line < hunk.from + hunk.removed) return null;
    shift += hunk.added - hunk.removed;
  }
  return line + shift;
}

/**
 * The lines of `file` as `git` reads the item's tree (a scratch index holding it, `--cached`)
 * that a fold range added and nothing changed since, by their 1-based number in the tree: each
 * line the range added at the base tip, followed into the tree by the diff from that tip. A line
 * the item wrote itself, the same text included, is a change of that diff and never one of these.
 */
function baseLines(git, ranges, file) {
  const lines = new Set();
  for (const { held, tip } of ranges) {
    const added = parseAddedLines(git(['diff', ...DIFF_FLAGS, held, tip, '--', literal(file)]));
    if (added.length === 0) continue;
    const hunks = hunksOf(git(['diff', '--cached', ...DIFF_FLAGS, tip, '--', literal(file)]));
    for (const entry of added) {
      const line = carried(hunks, entry.line);
      if (line !== null) lines.add(line);
    }
  }
  return lines;
}

function blob(tree, commit, file) {
  return lib.git(tree, ['rev-parse', '--verify', '--quiet', `${commit}:${file}`], { tolerate: true });
}

function bytesOf(tree, id) {
  const result = spawnSync('git', ['cat-file', 'blob', id], { cwd: tree, maxBuffer: 256 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
}

/** The newest commit of HEAD's own line since `since`, `since` included, whose `file` hashes to `hash`. */
function commitHolding(tree, since, file, hash) {
  const commits = [...lib.gitLines(tree, ['rev-list', '--first-parent', `${since}..HEAD`], { tolerate: true }), since];
  const seen = new Map();
  for (const commit of commits) {
    const id = blob(tree, commit, file);
    if (!id) continue;
    if (!seen.has(id)) {
      const bytes = bytesOf(tree, id);
      seen.set(id, bytes !== null && sha256(bytes) === hash);
    }
    if (seen.get(id)) return commit;
  }
  return null;
}

/** The clean three-way merge of `ours` with the base's change from `held` to `tip`, as bytes, or null on a conflict. */
function mergeBytes(tree, ours, held, tip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-fold-'));
  try {
    const files = [['ours', ours], ['held', held], ['tip', tip]].map(([name, id]) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, bytesOf(tree, id));
      return file;
    });
    const result = spawnSync('git', ['merge-file', '-p', ...files], { cwd: tree, maxBuffer: 256 * 1024 * 1024 });
    return result.status === 0 ? result.stdout : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Whether the change of `file` from the accepted snapshot `accepted` to the tree `now` is the
 * base's alone: the item's accepted bytes, committed on HEAD's own line, merged cleanly with what
 * the base changed in that file since that commit up to the base tip HEAD holds, give the bytes
 * the tree holds now. Anyone else's change since, a merge resolved by hand included, is not.
 */
function foldedAlone(tree, base, accepted, now, file) {
  const before = accepted.files[file];
  const after = now.files[file];
  if (!before || !after || before.kind !== 'file' || after.kind !== 'file' || before.executable !== after.executable) return false;
  const holder = commitHolding(tree, accepted.head_sha, file, before.hash);
  if (!holder) return false;
  const ours = blob(tree, holder, file);
  for (const { held, tip } of foldRanges(tree, holder, base)) {
    const [from, to] = [blob(tree, held, file), blob(tree, tip, file)];
    if (!from || !to || from === to) continue;
    const merged = from === ours ? bytesOf(tree, to) : mergeBytes(tree, ours, from, to);
    if (merged !== null && sha256(merged) === after.hash) return true;
  }
  return false;
}

module.exports = { baseLines, carried, foldRanges, foldedAlone, hunksOf };
