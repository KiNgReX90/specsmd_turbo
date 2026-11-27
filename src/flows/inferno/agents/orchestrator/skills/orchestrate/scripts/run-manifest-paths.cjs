'use strict';

/**
 * The paths an item's manifest makes its builder read, `context.required` and `reads`, exist on
 * disk before the item is dispatched, with one exception: a path that an item this one depends
 * on, directly or through others, lists under `ownership.editable` while that item is not
 * completed. That item creates it, so a plan may cite a module its first item writes. Once the
 * owner completed the check holds again, so a file it never created is caught before the later
 * item starts. An item's own editable path is no exception: it reads what exists, and names the
 * nearest real directory and its pattern file for the rest.
 *
 * The check holds an item until a builder took it (startedItems). From its dispatch to its
 * integrate the item is pending and its tree is the tree after its own build: an item that empties
 * a file reads it first and owns it, so its plan names it, and once its commit deleted the file
 * that plan is still right. Checked then, it stopped every other ready item of the intent
 * (2026-11-18). Only the existence is lifted: the shape of the manifest is checked by its callers
 * for every open item, started or not.
 *
 * `run.cjs frontier` (run-frontier.cjs contractErrors) and plan-lint make the same check here, and
 * the frontier's probe replay asks the same startedItems.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { isComplete, isDeferred } = require('./state-transition.cjs');
const { reviewPath } = require('./run-review-file.cjs');

/** Every ledger item `id` depends on through depends_on, directly or through others. */
function dependencies(id, items, seen = new Set()) {
  const entry = items.find((one) => one.id === id);
  for (const dependency of (entry && entry.depends_on) || []) {
    if (seen.has(dependency)) continue;
    seen.add(dependency);
    dependencies(dependency, items, seen);
  }
  return seen;
}

/**
 * An item's ownership.editable, read once from its spec as the tree holds it, and only when a
 * cited path is missing. A spec that is gone owns nothing.
 */
function editableReader(tree, intentId) {
  const read = new Map();
  return (id) => {
    if (!read.has(id)) {
      let editable = [];
      try {
        const manifest = lib.readItemSpec(tree, intentId, id).manifest || {};
        editable = (manifest.ownership && manifest.ownership.editable) || [];
      } catch (error) {
        if (error.code !== 'SPEC_MISSING') throw error;
      }
      read.set(id, Array.isArray(editable) ? editable.map(String) : []);
    }
    return read.get(id);
  };
}

/**
 * The existence errors of one open item. `item` carries its id, `context` and `reads`;
 * `ledgerItems` are the intent's ledger items with their status and depends_on; `editableOf`
 * gives any item's ownership.editable (editableReader).
 */
function pathErrors(tree, item, ledgerItems, editableOf) {
  const errors = [];
  const upstream = [...dependencies(item.id, ledgerItems)]
    .map((id) => ledgerItems.find((entry) => entry.id === id))
    .filter(Boolean);
  const check = (target, label) => {
    if (!target || fs.existsSync(path.join(tree, target))) return;
    const owners = upstream.filter((entry) => lib.ownedBy(target, editableOf(entry.id), tree));
    if (owners.some((entry) => !isComplete(entry.status) && !isDeferred(entry.status))) return;
    const [first] = owners;
    const why = !first
      ? `no item ${item.id} depends on owns it`
      : `${first.id}, which owns it, ${isDeferred(first.status) ? 'is deferred, so nothing creates it' : 'completed without creating it'}`;
    errors.push(`${item.id}: ${label} path does not exist: ${target}, and ${why}`);
  };
  for (const entry of (item.context && item.context.required) || []) check(entry && entry.path, 'context.required');
  // A declared read names the module holding it, so the same existence check applies.
  for (const entry of Array.isArray(item.reads) ? item.reads : []) check(entry && entry.path, 'reads');
  return errors;
}

/**
 * The items a builder already took: a builder line in the intent's dispatch log, or a review,
 * recorded or only written. An oracle ask is no dispatch, as for defer-item (state-defer-work.cjs):
 * an oracle edits nothing. A tree outside git keeps no dispatch log, so there only the review counts.
 */
function startedItems(tree, intentId, items) {
  let logged = [];
  try {
    const log = path.join(lib.cacheDir(tree), 'dispatch', `${intentId}.log`);
    if (fs.existsSync(log)) {
      logged = fs.readFileSync(log, 'utf8').split('\n').map((line) => line.split('\t'))
        .filter((fields) => fields[3] !== 'oracle').map((fields) => fields[2]);
    }
  } catch (error) {
    if (error.code !== 'NO_REPO') throw error;
  }
  const started = (item) => Boolean(item.review) || logged.includes(item.id) ||
    fs.existsSync(path.join(tree, reviewPath(intentId, item.id)));
  return new Set(items.filter(started).map((item) => item.id));
}

/**
 * The existence check of one intent's open items, as plan-lint and the frontier make it: the
 * returned function gives one item's errors, none for an item a builder already took.
 */
function pathCheck(tree, intent) {
  const editableOf = editableReader(tree, intent.id);
  const started = startedItems(tree, intent.id, intent.items);
  return (item) => (started.has(item.id) ? [] : pathErrors(tree, item, intent.items, editableOf));
}

module.exports = { pathCheck, startedItems };
