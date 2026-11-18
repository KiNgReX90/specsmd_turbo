'use strict';

/**
 * What a fold of the base brought into an item's window, as verify-item reads it. A fold is the
 * base range HEAD took in since a baseline: from the last base commit the baseline held to the
 * base tip HEAD holds now, merged or fast-forwarded, one range per base ref, however many folds
 * it took, and one per fold of a base rewritten since, read from what HEAD merged. In a file the
 * item also changed, a line those ranges added is the base's (`baseLines`), and a path an
 * accepted dispatch recorded that changed since by their change alone is the base's too
 * (`foldedAlone`).
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
 * The fold ranges `{ held, tip }` since the baseline at `head`, each a part of the base `at` holds
 * that `head` did not. First per ref of `base`, the base tip `at` holds. Then per two-parent merge
 * on `at`'s own line since `head` whose second parent no base ref holds but was the base: every
 * commit it holds beyond a ref has a commit of the same patch on that ref, git's own test, so a
 * base rebased or amended since the fold (`merge` names that merge). A range holds no commit
 * `head` or an earlier range holds, so no reader sees a commit twice, and one they cover is
 * dropped. On the base branch itself nothing is a fold.
 */
function foldRanges(tree, head, base, at = 'HEAD') {
  if (!base || !head || lib.currentBranch(tree) === base) return [];
  const ranges = [];
  const refs = [];
  const holds = [head];
  const take = (tip, merge) => {
    const held = lib.git(tree, ['merge-base', tip, ...holds], { tolerate: true });
    if (!held || held === tip || (merge && !refs.some((ref) => samePatches(tree, ref, tip)))) return;
    ranges.push(merge ? { held, tip, merge } : { held, tip });
    holds.push(tip);
  };
  for (const ref of [base, `origin/${base}`]) {
    const tip = lib.git(tree, ['merge-base', at, ref], { tolerate: true });
    if (!tip) continue;
    refs.push(ref);
    take(tip);
  }
  // An octopus merge, a merge off `at`'s own line, and a second parent a base ref holds are read as above.
  const merges = lib.gitLines(tree, ['rev-list', '--first-parent', '--min-parents=2', '--max-parents=2', '--parents', `${head}..${at}`],
    { tolerate: true }).map((row) => row.split(' '));
  const beyond = new Set(merges.length > 0 ? lib.gitLines(tree, ['rev-list', ...merges.map((row) => row[2]), '--not', ...refs]) : []);
  for (const [merge, , second] of merges) if (beyond.has(second)) take(second, merge);
  return ranges;
}

/** Whether every commit `commit` holds beyond `ref` has a commit of the same patch on `ref`. */
function samePatches(tree, ref, commit) {
  return lib.git(tree, ['rev-list', '--count', '--cherry-pick', '--right-only', '--no-merges', `${ref}...${commit}`]) === '0';
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

/** The clean three-way merge of the bytes `ours` with the base's change from `held` to `tip`, as bytes, or null on a conflict. */
function mergeBytes(tree, ours, held, tip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-fold-'));
  try {
    const files = [['ours', ours], ['held', bytesOf(tree, held)], ['tip', bytesOf(tree, tip)]].map(([name, bytes]) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, bytes);
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
 * the base changed in that file since that commit, range by range, give the bytes the tree holds
 * now. No commit is in two ranges, so each change is merged once. Anyone else's change since, a
 * merge resolved by hand included, is not.
 */
function foldedAlone(tree, base, accepted, now, file) {
  const before = accepted.files[file];
  const after = now.files[file];
  if (!before || !after || before.kind !== 'file' || after.kind !== 'file' || before.executable !== after.executable) return false;
  const holder = commitHolding(tree, accepted.head_sha, file, before.hash);
  if (!holder) return false;
  let merged = bytesOf(tree, blob(tree, holder, file));
  for (const { held, tip } of foldRanges(tree, holder, base)) {
    const [from, to] = [blob(tree, held, file), blob(tree, tip, file)];
    if (!from || !to || from === to) continue;
    // Bytes the range starts from take its end whole, which a binary file needs: git merges none.
    merged = merged.equals(bytesOf(tree, from)) ? bytesOf(tree, to) : mergeBytes(tree, merged, from, to);
    if (merged === null) return false;
  }
  return sha256(merged) === after.hash;
}

module.exports = { baseLines, carried, foldRanges, foldedAlone, hunksOf };
