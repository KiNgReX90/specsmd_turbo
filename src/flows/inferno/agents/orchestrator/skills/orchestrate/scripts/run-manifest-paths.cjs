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
 * `run.cjs frontier` (run-frontier.cjs contractErrors) and plan-lint make the same check here.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { isComplete, isDeferred } = require('./state-transition.cjs');

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
 * An item's ownership.editable: `known` holds the open items' lists, and any other item's spec
 * is read once, as the tree holds it. A spec that is gone owns nothing.
 */
function editableReader(tree, intentId, known) {
  const read = new Map(known);
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

module.exports = { dependencies, editableReader, pathErrors };
