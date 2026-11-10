'use strict';

/**
 * Taking one work item out of its intent for a later plan: the `defer-item` transition.
 *
 * Its own module beside state-transition.cjs, the way state-block.cjs is. An intent's owner can
 * decide that an item waits for a later plan. The writer had no transition for that, and
 * close-intent refuses while an item is open, so such an intent closed only by a hand edit of
 * the ledger, which the flow forbids. This writes `status: deferred` with `deferred_at` and
 * `deferred_reason` on the item and on its spec. close-intent and check read it as closed for
 * this intent (state-ledger.cjs isClosed); nothing builds, reviews or integrates it; the archive
 * keeps it, reason and all, for the next plan.
 *
 * Three refusals keep the intent honest:
 *   - work on the item has started (state-defer-work.cjs draws that line);
 *   - an open item still depends on it and no `--rewire <item>=<new-dep>` names it. A rewire
 *     replaces that edge, in the ledger the frontier reads and in the spec front matter the
 *     plan-time scan reads, by an edge on another item, or drops it when the new dep is `none`.
 *     The spec's prose (its Dependencies and Test Plan sections) is the planner's, and the plan
 *     lint names a Test Plan line that still integrates with the deferred item;
 *   - every other item is deferred already, so the intent would close having built nothing.
 *     That intent waits as a whole: release it and block it.
 *
 * Every refusal comes before any write, and the ledger and the specs change together: the
 * specs are written first and put back when the ledger write is refused. A process that dies
 * between the two leaves the ledger as it was, and running the same call again finishes it.
 */

const fs = require('fs');
const path = require('path');
const {
  TransitionError, findKeyLine, unquote, stripInlineComment, loadState, locateIntents, locateWorkItems, getIntent,
  statusOf, isComplete, isDeferred, isClosed, setField, nowIso, writeState,
} = require('./state-ledger.cjs');
const { readList, listValues, removeListValues } = require('./state-lists.cjs');
const { atomicWrite } = require('./state-store.cjs');
const { quotedScalar } = require('./state-block.cjs');
const { archivePaths } = require('./state-archive.cjs');
const { blockIntentCall, deferItemCall, unclaimIntentCall } = require('./run-call.cjs');
const { workOn } = require('./state-defer-work.cjs');

const DEFAULT_STATE_PATH = '.specs-inferno/state.yaml';

/** The new dep that drops a dependent's edge on the deferred item and puts nothing in its place. */
const NONE = 'none';

/** What an item may be deferred from: waiting, with nothing of it built. */
const DEFERRABLE = new Set([null, 'pending', 'on_hold', 'blocked']);

function field(lines, entry, key) {
  const idx = findKeyLine(lines, entry.start, entry.end, entry.keyIndent, key);
  return idx === -1 ? null : unquote(lines[idx].slice(entry.keyIndent + key.length + 1));
}

/** `--rewire <item>=<new-dep>`, once per dependent, as a map to the new dep or null for none. */
function parseRewires(raw) {
  const rewires = new Map();
  for (const entry of raw === undefined ? [] : [].concat(raw)) {
    const match = /^([^=]+)=([^=]+)$/.exec(String(entry));
    if (!match) {
      throw new TransitionError(
        `refusing --rewire ${entry}: write it <item>=<new-dep>, or <item>=${NONE} to drop the edge with no replacement.`,
        'REWIRE_FORM'
      );
    }
    const [, dependent, target] = match;
    if (rewires.has(dependent)) {
      throw new TransitionError(`refusing --rewire: ${dependent} is named twice. Give each dependent one new edge.`, 'REWIRE_TWICE');
    }
    rewires.set(dependent, target === NONE ? null : target);
  }
  return rewires;
}

/** The path of depends_on edges from `from` to `to`, both ends included, or null. */
function pathTo(graph, from, to, seen = new Set()) {
  if (from === to) return [to];
  if (seen.has(from)) return null;
  seen.add(from);
  for (const next of graph.get(from) || []) {
    const rest = pathTo(graph, next, to, seen);
    if (rest) return [from, ...rest];
  }
  return null;
}

/** Every refusal a rewire can earn, against the intent's items as the ledger has them. */
function refuseRewires(context) {
  const { intent, item, items, rewires } = context;
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  const dependents = items.filter((entry) => entry !== item && !isClosed(entry.status) && entry.depends.includes(item.id));
  for (const [dependent, target] of rewires) {
    if (!byId.has(dependent)) {
      throw new TransitionError(`refusing --rewire ${dependent}=...: ${dependent} is no item of ${intent}.`, 'REWIRE_UNKNOWN');
    }
    if (!dependents.includes(byId.get(dependent))) {
      throw new TransitionError(
        `refusing --rewire ${dependent}=...: ${dependent} is no open item that depends on ${item.id}.`,
        'REWIRE_NOT_DEPENDENT'
      );
    }
    if (target === null) continue;
    if (!byId.has(target)) {
      throw new TransitionError(`refusing --rewire ${dependent}=${target}: ${target} is no item of ${intent}.`, 'REWIRE_UNKNOWN');
    }
    if (target === item.id || isDeferred(byId.get(target).status)) {
      throw new TransitionError(
        `refusing --rewire ${dependent}=${target}: ${target} is deferred, so it would hold ${dependent} for good.`,
        'REWIRE_DEFERRED'
      );
    }
  }
  const unnamed = dependents.filter((entry) => !rewires.has(entry.id)).map((entry) => entry.id);
  if (unnamed.length > 0) {
    throw new TransitionError(
      `refusing to defer ${item.id}: open item(s) ${unnamed.join(', ')} depend on it and would wait for good. ` +
        `Give each a new edge, or ${NONE} to drop it: ${deferItemCall(intent, item.id, unnamed)}.`,
      'REWIRE_OWED'
    );
  }
  const after = new Map(items.map((entry) => [entry.id, rewires.has(entry.id)
    ? [...entry.depends.filter((id) => id !== item.id), ...[rewires.get(entry.id)].filter(Boolean)]
    : entry.depends]));
  for (const [dependent, target] of rewires) {
    const loop = target === null ? null : pathTo(after, target, dependent);
    if (loop) {
      throw new TransitionError(
        `refusing --rewire ${dependent}=${target}: it closes the cycle ${[dependent, ...loop].join(' -> ')}.`,
        'REWIRE_CYCLE'
      );
    }
  }
}

/** An id as a list member: plain when it can be, else double-quoted so the list still parses. */
const scalar = (id) => (/^[a-zA-Z0-9_./-]+$/.test(id) ? id : JSON.stringify(id));

/**
 * Replace `from` by `to` in one entry's list, keeping its form and its comments, or drop `from`
 * when `to` is null or already a member. True when the list changed.
 */
function rewireList(lines, entry, key, from, to) {
  const list = readList(lines, entry, key);
  const member = list.members.find((candidate) => candidate.value === from);
  if (!member) return false;
  if (to === null || list.members.some((candidate) => candidate.value === to)) {
    removeListValues(lines, entry, key, new Set([from]));
    return true;
  }
  if (list.form === 'inline') {
    const header = lines[list.index];
    const comment = header.slice(stripInlineComment(header).length);
    const members = list.members.map((candidate) => (candidate === member ? scalar(to) : candidate.source));
    lines[list.index] = `${' '.repeat(entry.keyIndent)}${key}: [${members.join(', ')}]${comment ? ` ${comment}` : ''}`;
  } else {
    const line = lines[member.line];
    const at = line.indexOf(member.source, line.indexOf('-') + 1);
    lines[member.line] = `${line.slice(0, at)}${scalar(to)}${line.slice(at + member.source.length)}`;
  }
  return true;
}

/** A spec's front matter as a ledger-shaped entry over its lines, or null when it has none. */
function frontMatter(lines, id) {
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  return end === -1 ? null : { id, start: 0, end, keyIndent: 0 };
}

/** Set fields on an entry, keeping its line range in step with the inserts. */
function setFields(lines, entry, pairs) {
  for (const [key, value] of pairs) {
    const before = lines.length;
    setField(lines, entry, key, value);
    entry.end += lines.length - before;
  }
}

/** The new text of every spec the deferral changes, by path, with the text it had. */
function specEdits(specsDir, context, pairs) {
  const { intent, item, rewires } = context;
  const edits = new Map();
  const edit = (id, change) => {
    const file = path.join(specsDir, 'intents', intent, 'work-items', `${id}.md`);
    if (!fs.existsSync(file)) return;
    const before = fs.readFileSync(file, 'utf8');
    const lines = before.split('\n');
    const head = frontMatter(lines, id);
    if (head && change(lines, head)) edits.set(file, { before, after: lines.join('\n') });
  };
  edit(item.id, (lines, head) => {
    setFields(lines, head, pairs);
    return true;
  });
  for (const [dependent, target] of rewires) edit(dependent, (lines, head) => rewireList(lines, head, 'depends_on', item.id, target));
  return edits;
}

/**
 * Defer one work item out of its intent. `options.rewire` is one `<item>=<new-dep>` or a list
 * of them; `options.config` is the host config the work check reads the base branch from.
 */
function deferItem(options) {
  const file = options.file || DEFAULT_STATE_PATH;
  // Free text a person types, folded to one line, as block-intent folds its reason.
  const reason = String(options.reason || '').replace(/\s+/g, ' ').trim();
  if (!reason) {
    throw new TransitionError(
      `refusing to defer ${options.item} with no reason: the next plan reads why it waits. ` +
        `Say what it waits for: ${deferItemCall(options.intent, options.item)}.`,
      'NO_REASON'
    );
  }
  const rewires = parseRewires(options.rewire);
  const lines = loadState(file);
  const intent = getIntent(lines, options.intent);
  const items = locateWorkItems(lines, intent).map((entry) => ({
    ...entry, status: statusOf(lines, entry), depends: listValues(lines, entry, 'depends_on'),
  }));
  const item = items.find((entry) => entry.id === options.item);
  if (!item) {
    const known = items.map((entry) => entry.id).join(', ') || '(none)';
    throw new TransitionError(`work item not found: ${options.item} in intent ${options.intent}. Known items: ${known}`, 'ITEM_NOT_FOUND');
  }
  if (isDeferred(item.status)) return { changed: false, item: item.id, status: 'deferred', note: 'already deferred' };
  if (isComplete(item.status)) {
    throw new TransitionError(
      `refusing to defer ${item.id}: it is ${item.status}. A completed item is on the intent branch and ships with it.`,
      'ITEM_COMPLETE'
    );
  }
  if (!DEFERRABLE.has(item.status)) {
    throw new TransitionError(
      `refusing to defer ${item.id}: status is ${item.status}, not pending. A run has it in hand, so it lands or it stays.`,
      'NOT_PENDING'
    );
  }
  const work = workOn({
    file, intent: intent.id, item: item.id, review: field(lines, item, 'review'),
    siblings: items.filter((entry) => entry !== item).map((entry) => entry.id),
    baseBranch: field(lines, intent, 'base_branch'), config: options.config,
  });
  if (work.length > 0) {
    throw new TransitionError(
      `refusing to defer ${item.id}: work on it has started, ${work.join('; ')}. A deferred item ships nothing and owes ` +
        'no review, so that work would reach the base unreviewed: build the item to the end instead.',
      'ITEM_IN_FLIGHT'
    );
  }
  if (items.every((entry) => entry === item || isDeferred(entry.status))) {
    throw new TransitionError(
      `refusing to defer ${item.id}: every other item of ${intent.id} is deferred, so the intent would close having ` +
        `built nothing. Leave the whole intent for later: ${unclaimIntentCall(intent.id)} if a run holds it, then ` +
        `${blockIntentCall(intent.id)}.`,
      'NOTHING_BUILT'
    );
  }
  const context = { intent: intent.id, item, items, rewires };
  refuseRewires(context);

  const deferredAt = nowIso(options.now);
  // Each insert lands directly under `status:`, so write back to front to leave the order
  // status, deferred_at, deferred_reason.
  const pairs = [['status', 'deferred'], ['deferred_reason', quotedScalar(reason)], ['deferred_at', deferredAt]];
  const specsDir = path.dirname(path.resolve(file));
  const specs = specEdits(specsDir, context, pairs);
  // Back to front by entry, so an earlier entry's lines keep their place while a later one grows.
  const rewired = items.filter((entry) => rewires.has(entry.id));
  for (const entry of [item, ...rewired].sort((a, b) => b.start - a.start)) {
    if (entry === item) setFields(lines, entry, pairs);
    else rewireList(lines, entry, 'depends_on', item.id, rewires.get(entry.id));
  }

  const written = [];
  try {
    for (const [spec, { after }] of specs) {
      atomicWrite(spec, after);
      written.push(spec);
    }
    writeState(file, lines);
  } catch (error) {
    for (const spec of written) atomicWrite(spec, specs.get(spec).before);
    throw error;
  }

  return {
    changed: true,
    item: item.id,
    status: 'deferred',
    previous: item.status,
    deferred_at: deferredAt,
    reason,
    rewired: [...rewires].map(([dependent, target]) => ({ item: dependent, from: item.id, to: target })),
    markdown: written.map((spec) => path.relative(path.dirname(specsDir), spec)),
  };
}

/**
 * The deferred items of an intent with their reasons, from the live ledger or, once the intent
 * is archived, from the archive. Empty when neither holds the intent. A ledger with no
 * `intents:` key holds none: the gate, which reads the items from the spec files, never failed
 * on the ledger's form before it asked this, and must not now.
 */
function deferredItems(stateFile, intentId) {
  for (const file of [stateFile, archivePaths(stateFile).archiveFile]) {
    if (!fs.existsSync(file)) continue;
    const lines = loadState(file);
    let intents;
    try {
      intents = locateIntents(lines);
    } catch (error) {
      if (error.code === 'NO_INTENTS') continue;
      throw error;
    }
    const intent = intents.find((entry) => entry.id === intentId);
    if (!intent) continue;
    return new Map(locateWorkItems(lines, intent)
      .filter((entry) => isDeferred(statusOf(lines, entry)))
      .map((entry) => [entry.id, field(lines, entry, 'deferred_reason') || 'no reason recorded']));
  }
  return new Map();
}

module.exports = { NONE, deferItem, deferredItems };
