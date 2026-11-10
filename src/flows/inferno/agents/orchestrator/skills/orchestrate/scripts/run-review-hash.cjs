'use strict';

/**
 * Whether an item's recorded review still binds the files it lists.
 *
 * A review is recorded under the hash of every file it lists, whole, the rule the released flow
 * recorded by, so a review on record reads the same after an upgrade. While that hash holds, the
 * review is current. When it does not, the review stays current only when every commit since
 * the review commit that changed a listed file did so in one of two ways:
 * - a fold of the base, whose merge holds that file exactly as the clean merge of both sides, so
 *   every hunk it changed came from the base and none from a resolution;
 * - a change to a case registry (config `cases.files`) confined to case blocks a sibling item of
 *   the intent names in its spec and this item does not, or to blocks a fold brought in.
 * Every other change re-owes the review: the branch's own change to a listed file, a fold that
 * conflicted in it, a change to a case block the item's spec names, and a change to a registry
 * block or line no item names, since the item itself may have made it: a builder edits a case its
 * change made untrue whether or not the spec named that case.
 *
 * Measured 2026-11-10: a fold that only added another intent's reservation to the shared case
 * registry re-owed the review of every item that listed the registry.
 */

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { spawnSync } = require('child_process');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const { blobs } = require('./run-real-app.cjs');
const { casesConfig } = require('./run-cases.cjs');
const { caseBlocks, namesId } = require('./run-cases-blocks.cjs');

/** The largest text read from history. A larger registry reads as unreadable, which re-owes. */
const MAX_TEXT = 64 * 1024 * 1024;

/** The hash a review is recorded under: every file it lists, whole, as the tree holds it. */
const filesHash = (tree, files) => proofs.scopeHash(tree, files, { exact: true });

function gitOut(tree, args) {
  const result = spawnSync('git', args, { cwd: tree, encoding: 'utf8', maxBuffer: MAX_TEXT });
  return result.status === 0 ? result.stdout : null;
}

const commitOf = (tree, ref) => (ref ? lib.git(tree, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { tolerate: true }) : null);
const isAncestor = (tree, older, newer) => lib.git(tree, ['merge-base', '--is-ancestor', older, newer], { tolerate: true }) !== null;

/** Each listed file's tree entry at `rev` (mode, type and object, as `ls-tree` prints them), or null when git cannot read it. */
function entriesAt(tree, rev, files) {
  const out = gitOut(tree, ['--literal-pathspecs', 'ls-tree', '-rz', rev, '--', ...files]);
  if (out === null) return null;
  const wanted = new Set(files);
  const entries = new Map();
  for (const row of out.split('\0').filter(Boolean)) {
    const tab = row.indexOf('\t');
    if (wanted.has(row.slice(tab + 1))) entries.set(row.slice(tab + 1), row.slice(0, tab));
  }
  return entries;
}

/** filesHash over the files as commit `rev` holds them, built the way proofs.scopeHash builds it. */
function filesHashAt(tree, rev, files) {
  const entries = entriesAt(tree, rev, files);
  if (entries === null) return null;
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(JSON.stringify([[...files].sort(), sorted])).digest('hex');
}

/** The text of `file` at each rev, by rev, with null where it is missing or no text. */
function textsAt(tree, revs, file) {
  return revs.map((rev) => {
    const found = blobs(tree, [`${rev}:${file}`], MAX_TEXT);
    return found.length > 0 ? found[0].text : null;
  });
}

/**
 * A registry text as its case blocks, by id, and the lines outside every block. Trailing blank
 * lines of a block and blank lines outside the blocks are layout: a block a fold adds after
 * another moves the blank line between them, and the case it follows reads the same.
 */
function registryView(text, opener) {
  const lines = text.split('\n');
  const inside = new Array(lines.length).fill(false);
  const blocks = new Map();
  for (const block of caseBlocks(text, opener)) {
    for (let index = block.start - 1; index < block.end; index += 1) inside[index] = true;
    const body = block.text.replace(/(\n[ \t\r]*)+$/, '');
    blocks.set(block.id, blocks.has(block.id) ? `${blocks.get(block.id)}\n${body}` : body);
  }
  const outside = lines.filter((line, index) => !inside[index] && line.trim() !== '').join('\n');
  return { blocks, outside };
}

/**
 * Who names a case id: the item itself, or a sibling item of its intent, in its spec as the
 * tree holds it now or as any of `revs` held it. A spec renamed by the commit itself, such as a
 * case a fold renumbered, is read on both sides of it.
 */
function namers(scope, revs) {
  const { intent, item, tree } = scope;
  const rel = (id) => path.posix.join(lib.SPECS_DIR, 'intents', intent.id, 'work-items', `${id}.md`);
  const texts = new Map(intent.items.map((entry) => [entry.id, [nowSpec(tree, intent.id, entry.id)]]));
  for (const rev of revs) {
    for (const { file, text } of blobs(tree, intent.items.map((entry) => `${rev}:${rel(entry.id)}`), MAX_TEXT)) {
      texts.get(path.posix.basename(file, '.md')).push(text);
    }
  }
  const names = (ids, id) => ids.some((entry) => texts.get(entry).some((text) => namesId(text, id)));
  const siblings = intent.items.map((entry) => entry.id).filter((id) => id !== item.id);
  return { own: (id) => names([item.id], id), sibling: (id) => names(siblings, id) };
}

function nowSpec(tree, intentId, itemId) {
  try {
    return fs.readFileSync(lib.readItemSpec(tree, intentId, itemId).file, 'utf8');
  } catch (error) {
    if (error instanceof lib.RunError) return '';
    throw error;
  }
}

/**
 * Whether a commit's change to one registry leaves the item's cases alone: every case block it
 * changed is named by a sibling and not by the item, or took the base's side where only the base
 * had changed it. `base` is the merge base of a fold's two sides, null for any other commit.
 */
function registryForeign(scope, registry, commit, [ours, theirs], base) {
  const revs = base ? [ours, commit, theirs, base] : [ours, commit];
  const texts = textsAt(scope.tree, revs, registry.path);
  if (texts.some((text) => text === null)) return false;
  const [before, after, side, common] = texts.map((text) => registryView(text, registry.opener));
  const brought = (part) => base !== null && part(before) === part(common) && part(after) === part(side);
  if (after.outside !== before.outside && !brought((view) => view.outside)) return false;
  let names = null;
  for (const id of new Set([...before.blocks.keys(), ...after.blocks.keys()])) {
    const part = (view) => (view.blocks.has(id) ? view.blocks.get(id) : null);
    if (part(after) === part(before) || brought(part)) continue;
    names = names || namers(scope, [ours, commit]);
    if (names.own(id) || !names.sibling(id)) return false;
  }
  return true;
}

/**
 * Whether `commit` is a commit of the base's own line: a fold merges in the base's tip as it
 * stood, while an item branch a merge request lands never sits on the base's first-parent line,
 * not even once the base itself merged it.
 */
function onBaseLine(scope, commit) {
  return scope.lines.some((ref) => isAncestor(scope.tree, commit, ref) &&
    lib.gitLines(scope.tree, ['rev-list', '--first-parent', ref, '--not', `${commit}^@`], { tolerate: true }).includes(commit));
}

/** The tree a clean merge of both sides writes, and the paths it could not merge. */
function autoMerge(tree, ours, theirs) {
  const result = spawnSync('git', ['merge-tree', '-z', '--write-tree', '--name-only', '--no-messages', ours, theirs], { cwd: tree, encoding: 'utf8' });
  if (result.status !== 0 && result.status !== 1) return null;
  const [merged, ...conflicted] = result.stdout.split('\0').filter(Boolean);
  return merged ? { merged, conflicted: new Set(conflicted) } : null;
}

/** Whether every change `commit` made to the listed files `changed` leaves the item's review standing. */
function foreign(scope, commit, parents, changed) {
  const fold = parents.length === 2 && onBaseLine(scope, parents[1]);
  let rest = changed;
  const merge = fold ? autoMerge(scope.tree, parents[0], parents[1]) : null;
  if (merge) {
    const held = entriesAt(scope.tree, commit, changed);
    const clean = entriesAt(scope.tree, merge.merged, changed);
    rest = changed.filter((file) => !held || !clean || merge.conflicted.has(file) || held.get(file) !== clean.get(file));
  }
  const base = fold ? lib.git(scope.tree, ['merge-base', parents[0], parents[1]], { tolerate: true }) : null;
  return rest.every((file) => {
    const registry = scope.registries.find((entry) => entry.path === file);
    return Boolean(registry) && registryForeign(scope, registry, commit, parents, base || null);
  });
}

/** The registries the host configures, none when it configures none or a cases section that does not parse. */
function registriesOf(config) {
  try {
    const cases = casesConfig(config, 'the host config');
    return cases ? cases.files : [];
  } catch (error) {
    if (error instanceof lib.RunError) return [];
    throw error;
  }
}

/** What the walk reads besides the commits: the registries, the base's refs, the intent and item. */
function scopeOf(tree, context) {
  const config = context.config || lib.readConfig(tree, context.configFile);
  // Required here, not at the top: run-intents loads run-frontier, which loads run-review and so this file.
  const { resolveBase } = require('./run-intents.cjs');
  const base = resolveBase(config, context.intent, tree);
  const lines = [base, `origin/${base}`].filter((ref) => commitOf(tree, ref));
  return { tree, intent: context.intent, item: context.item, registries: registriesOf(config), lines };
}

/**
 * The walk behind a hash that no longer holds: from the review commit along HEAD's first-parent
 * line, every commit that changed a listed file must leave the review standing. The record must
 * bind the review commit's files, and the listed files must be committed.
 */
function standsSince(tree, context) {
  const { item, files } = context;
  const from = commitOf(tree, item.review_commit);
  if (!from || !isAncestor(tree, from, 'HEAD') || filesHashAt(tree, from, files) !== item.review_hash) return false;
  if (lib.gitLines(tree, ['--literal-pathspecs', 'status', '--porcelain', '--', ...files]).length > 0) return false;
  const chain = lib.gitLines(tree, ['rev-list', '--first-parent', '--parents', `${from}..HEAD`]).map((row) => row.split(' '));
  if (chain.length === 0 || chain[chain.length - 1][1] !== from) return false;
  let scope = null;
  for (const [commit, ...parents] of chain.reverse()) {
    const named = gitOut(tree, ['--literal-pathspecs', 'diff', '-z', '--name-only', '--no-renames', parents[0], commit, '--', ...files]);
    if (named === null) return false;
    const changed = named.split('\0').filter(Boolean);
    if (changed.length === 0) continue;
    scope = scope || scopeOf(tree, context);
    if (!foreign(scope, commit, parents, changed)) return false;
  }
  return true;
}

/**
 * Whether the item's recorded review binds the files it lists as they stand. `context` holds
 * the intent and the item as the ledger reads them, the files the review lists, and the host
 * config, or `configFile` to read it from when the walk needs it.
 */
function itemReviewCurrent(tree, context) {
  const { item, files } = context;
  if (!item.review_hash) return false;
  return filesHash(tree, files) === item.review_hash || standsSince(tree, context);
}

module.exports = { filesHash, itemReviewCurrent };
