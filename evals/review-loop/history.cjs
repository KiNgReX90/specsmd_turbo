'use strict';

/**
 * The git side of the readout, read-only: every version of the item review files and the item
 * specs between two refs, in commit order, keyed by intent and item so a move into the archive
 * stays the same file.
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

/** Where a kind of file lives: an intent's own folder, or the archive once the intent is done. */
const KINDS = {
  reviews: { ext: 'yaml', key: /^\.specs-inferno\/(?:archive\/)?intents\/([^/]+)\/reviews\/([^/]+)\.yaml$/ },
  'work-items': { ext: 'md', key: /^\.specs-inferno\/(?:archive\/)?intents\/([^/]+)\/work-items\/([^/]+)\.md$/ },
};

const pathsOf = (kind, intent, item) => {
  const { ext } = KINDS[kind];
  return [`.specs-inferno/intents/${intent}/${kind}/${item}.${ext}`, `.specs-inferno/archive/intents/${intent}/${kind}/${item}.${ext}`];
};

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
 * Every change to a kind of file in base..head, oldest first, each with its intent, item and
 * content (null for a deletion), plus the content each key had at base.
 */
function versions(tree, base, head, kind) {
  const { ext, key } = KINDS[kind];
  const specs = [`:(glob).specs-inferno/intents/*/${kind}/*.${ext}`, `:(glob).specs-inferno/archive/intents/*/${kind}/*.${ext}`];
  const log = git(tree, ['log', '--reverse', '--topo-order', '--no-renames', '--format=%x00%H', '--name-status', `${base}..${head}`, '--', ...specs]);
  const changes = [];
  for (const chunk of log.split('\0').filter((part) => part.trim() !== '')) {
    const [sha, ...lines] = chunk.trim().split('\n');
    for (const line of lines.filter(Boolean)) {
      const [status, file] = line.split('\t');
      const match = key.exec(file || '');
      if (match) changes.push({ sha, file, deleted: status === 'D', intent: match[1], item: match[2] });
    }
  }
  const keys = [...new Map(changes.map((change) => [`${change.intent}/${change.item}`, change])).values()];
  const baseRefs = keys.flatMap((change) => pathsOf(kind, change.intent, change.item).map((file) => `${base}:${file}`));
  const blobs = readBlobs(tree, [...changes.filter((change) => !change.deleted).map((change) => `${change.sha}:${change.file}`), ...baseRefs]);
  const atBase = new Map(keys.map((change) => {
    const found = pathsOf(kind, change.intent, change.item).map((file) => blobs.get(`${base}:${file}`)).find((text) => text != null);
    return [`${change.intent}/${change.item}`, found === undefined ? null : found];
  }));
  for (const change of changes) change.text = change.deleted ? null : blobs.get(`${change.sha}:${change.file}`);
  return { changes, atBase };
}

/** The content of each item's spec at a commit, wherever it lives: its own folder or the archive. */
function specsAt(tree, head, keys) {
  const refs = keys.flatMap(({ intent, item }) => pathsOf('work-items', intent, item).map((file) => `${head}:${file}`));
  const blobs = readBlobs(tree, refs);
  return new Map(keys.map(({ intent, item }) => {
    const text = pathsOf('work-items', intent, item).map((file) => blobs.get(`${head}:${file}`)).find((found) => found != null);
    return [`${intent}/${item}`, text === undefined ? null : text];
  }));
}

module.exports = { UsageError, commitOf, git, specsAt, versions };
