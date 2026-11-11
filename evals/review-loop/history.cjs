'use strict';

/**
 * The git side of the readout, read-only: every version of the item review files (both lenses)
 * and the item specs between two refs, in commit order, keyed by intent and item so a move into
 * the archive stays the same file.
 */

const { spawnSync } = require('node:child_process');

class UsageError extends Error {}

function git(tree, args) {
  const result = spawnSync('git', args, { cwd: tree, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new UsageError(`git ${args.join(' ')} failed in ${tree}: ${(result.stderr || '').trim()}`);
  return result.stdout;
}

/** A ref as the commit it names, or a refusal that names the ref. */
function commitOf(tree, ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: tree, encoding: 'utf8' });
  if (result.status !== 0) throw new UsageError(`${ref} names no commit in ${tree}`);
  return result.stdout.trim();
}

/**
 * Where a kind of file lives: an intent's own folder, or the archive once the intent is done.
 * `reviews` holds two lenses: the contract file `reviews/<item>.yaml` and the quality file
 * `reviews/quality/<item>.yaml`, which the quality reviewer writes for an item with production code.
 */
const lensOf = (dir, ext, lens) => ({
  lens, dir, ext,
  key: new RegExp(`^\\.specs-inferno\\/(?:archive\\/)?intents\\/([^/]+)\\/${dir}\\/([^/]+)\\.${ext}$`),
});
const KINDS = {
  reviews: [lensOf('reviews', 'yaml', 'contract'), lensOf('reviews/quality', 'yaml', 'quality')],
  'work-items': [lensOf('work-items', 'md', 'spec')],
};

/** The two places a file of one lens can live, its own folder first. */
const pathsOf = ({ dir, ext }, intent, item) =>
  [`.specs-inferno/intents/${intent}/${dir}/${item}.${ext}`, `.specs-inferno/archive/intents/${intent}/${dir}/${item}.${ext}`];

/** The key a version is compared under: the item, and the lens when the kind holds more than one. */
const keyOf = (kind, change) => `${change.intent}/${change.item}${KINDS[kind].length > 1 ? `#${change.lens}` : ''}`;

/** Blob contents for `<commit>:<path>` refs, in one git call; null for a ref with no blob. */
function readBlobs(tree, refs) {
  const blobs = new Map();
  const wanted = [...new Set(refs)];
  if (wanted.length === 0) return blobs;
  const result = spawnSync('git', ['cat-file', '--batch'], { cwd: tree, input: `${wanted.join('\n')}\n`, maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new UsageError(`git cat-file failed in ${tree}: ${String(result.stderr).trim()}`);
  const out = result.stdout;
  let at = 0;
  for (const ref of wanted) {
    const end = out.indexOf(10, at);
    const header = out.toString('utf8', at, end).split(' ');
    at = end + 1;
    if (header[1] !== 'blob') {
      blobs.set(ref, null);
      continue;
    }
    const size = Number(header[2]);
    blobs.set(ref, out.toString('utf8', at, at + size));
    at += size + 1;
  }
  return blobs;
}

/**
 * Every change to a kind of file in base..head, oldest first, each with its intent, item, lens
 * and content (null for a deletion), plus the content each key had at base. One git walk reads
 * every lens of the kind, so the changes of one commit stay together. A key is `<intent>/<item>`,
 * with `#<lens>` after it for a kind of more than one lens.
 */
function versions(tree, base, head, kind) {
  const lenses = KINDS[kind];
  const specs = lenses.flatMap(({ dir, ext }) =>
    [`:(glob).specs-inferno/intents/*/${dir}/*.${ext}`, `:(glob).specs-inferno/archive/intents/*/${dir}/*.${ext}`]);
  const log = git(tree, ['log', '--reverse', '--topo-order', '--no-renames', '--format=%x00%H', '--name-status', `${base}..${head}`, '--', ...specs]);
  const changes = [];
  for (const chunk of log.split('\0').filter((part) => part.trim() !== '')) {
    const [sha, ...lines] = chunk.trim().split('\n');
    for (const line of lines.filter(Boolean)) {
      const [status, file] = line.split('\t');
      for (const one of lenses) {
        const match = one.key.exec(file || '');
        if (match) changes.push({ sha, file, deleted: status === 'D', intent: match[1], item: match[2], lens: one.lens });
      }
    }
  }
  const lensBy = new Map(lenses.map((one) => [one.lens, one]));
  const keys = [...new Map(changes.map((change) => [keyOf(kind, change), change])).values()];
  const placesOf = (change) => pathsOf(lensBy.get(change.lens), change.intent, change.item);
  const baseRefs = keys.flatMap((change) => placesOf(change).map((file) => `${base}:${file}`));
  const blobs = readBlobs(tree, [...changes.filter((change) => !change.deleted).map((change) => `${change.sha}:${change.file}`), ...baseRefs]);
  const atBase = new Map(keys.map((change) => {
    const found = placesOf(change).map((file) => blobs.get(`${base}:${file}`)).find((text) => text != null);
    return [keyOf(kind, change), found === undefined ? null : found];
  }));
  for (const change of changes) change.text = change.deleted ? null : blobs.get(`${change.sha}:${change.file}`);
  return { changes, atBase };
}

/** The content of each item's spec at a commit, wherever it lives: its own folder or the archive. */
function specsAt(tree, head, keys) {
  const [where] = KINDS['work-items'];
  const refs = keys.flatMap(({ intent, item }) => pathsOf(where, intent, item).map((file) => `${head}:${file}`));
  const blobs = readBlobs(tree, refs);
  return new Map(keys.map(({ intent, item }) => {
    const text = pathsOf(where, intent, item).map((file) => blobs.get(`${head}:${file}`)).find((found) => found != null);
    return [`${intent}/${item}`, text === undefined ? null : text];
  }));
}

module.exports = { UsageError, commitOf, git, keyOf, specsAt, versions };
