'use strict';

/**
 * The cross-check's cuts: the work items of a plan, split into the batches one cross-checker
 * each reads whole before it judges any part of it.
 *
 * One reader takes the brief and every item when they fit its budget of words, because a
 * conflict sits between two items and only a reader that holds both sees it. A plan too large
 * for one reader is cut along its dependency chains: the items `depends_on` links, directly or
 * through others. A chain that fits one reader is never split, so a producer and its consumer
 * are read together, and small chains share a reader. A chain too large for one reader alone is
 * cut in its dependency order. Items in two chains share no file once the plan lint is clean,
 * which prints every pair that shares an editable file with no `depends_on` path between them.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');

/**
 * The words one cross-checker is handed, the brief included: about sixteen thousand tokens of
 * plan, which a reader holds whole beside the code it greps. Past it the plan is cut.
 */
const READER_WORDS = 12000;

const words = (text) => text.split(/\s+/).filter(Boolean).length;

const planDir = (tree, intent) => path.join(tree, lib.SPECS_DIR, 'intents', intent);

/** The plan's work items in file order, each with its word count and the items it depends on. */
function planItems(tree, intent) {
  const dir = path.join(planDir(tree, intent), 'work-items');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith('.md')).sort().map((file) => {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const front = /^---\n([\s\S]*?)\n---/.exec(text);
    let depends = [];
    try {
      const doc = front ? lib.parseYaml(front[1]) : {};
      if (doc && Array.isArray(doc.depends_on)) depends = doc.depends_on.map(String);
    } catch (error) {
      if (!(error instanceof lib.RunError)) throw error;
    }
    return { id: file.slice(0, -3), words: words(text), depends };
  });
}

/** The brief's words, which every reader reads beside its cut. */
function briefWords(tree, intent) {
  const file = path.join(planDir(tree, intent), 'brief.md');
  return fs.existsSync(file) ? words(fs.readFileSync(file, 'utf8')) : 0;
}

/** Each item after the items it depends on, so a chain's neighbours sit next to each other. */
function chainOrder(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const placed = new Set();
  const order = [];
  const place = (item, seen) => {
    if (placed.has(item.id) || seen.has(item.id)) return;
    seen.add(item.id);
    for (const id of item.depends) if (byId.has(id)) place(byId.get(id), seen);
    placed.add(item.id);
    order.push(item);
  };
  for (const item of items) place(item, new Set());
  return order;
}

/** The plan's dependency chains in chain order: the items `depends_on` links either way. */
function chains(items) {
  const ids = new Set(items.map((item) => item.id));
  const root = new Map(items.map((item) => [item.id, item.id]));
  const find = (id) => (root.get(id) === id ? id : find(root.get(id)));
  for (const item of items) {
    for (const id of item.depends) if (ids.has(id)) root.set(find(item.id), find(id));
  }
  const groups = new Map();
  for (const item of chainOrder(items)) {
    const key = find(item.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()];
}

const total = (items) => items.reduce((sum, item) => sum + item.words, 0);

/** A chain too large for one reader, cut in its order into parts of at most `room` words. */
function cutChain(chain, room) {
  const parts = [];
  let current = null;
  for (const item of chain) {
    if (!current || total(current) + item.words > room) {
      current = [];
      parts.push(current);
    }
    current.push(item);
  }
  return parts;
}

/**
 * The plan's cuts, each `{ items, words }`: one with every item when the brief and the items fit
 * `budget` words, else one per chain, small chains packed together first fit. Every item lands
 * in exactly one cut.
 */
function planCuts(tree, intent, budget = READER_WORDS) {
  const items = planItems(tree, intent);
  const room = Math.max(budget - briefWords(tree, intent), 1);
  const shape = (cut) => ({ items: cut.map((item) => item.id), words: total(cut) });
  if (total(items) <= room) return [shape(chainOrder(items))];
  const cuts = [];
  for (const chain of chains(items)) {
    if (total(chain) > room) {
      cuts.push(...cutChain(chain, room));
      continue;
    }
    const fits = cuts.find((cut) => total(cut) + total(chain) <= room);
    if (fits) fits.push(...chain);
    else cuts.push([...chain]);
  }
  return cuts.map(shape);
}

module.exports = { READER_WORDS, planCuts, planItems };
