#!/usr/bin/env node
'use strict';

/**
 * Tokens, rounds and context per round by agent type, read-only, from session transcripts.
 *
 * A session is `<dir>/<session-id>.jsonl`, the orchestrator's own thread, plus
 * `<dir>/<session-id>/subagents/agent-<id>.jsonl` with `agent-<id>.meta.json` beside each,
 * which names its `agentType`. Every line is one JSON object. An assistant line carries
 * `message.id`, `message.model` and `message.usage`; one API message id repeats over several
 * lines and counts once, each usage field at the largest value its lines carry. A round is one
 * API message, and its context is input plus cache-read plus cache-creation tokens.
 *
 * The reviewers of both lenses are two agent types: the contract reviewer (`...-reviewer`) and
 * the quality reviewer (`...-reviewer-quality`). Their sum over a session is the `reviewers` line.
 * Per item, the review files name the agent id of each lens's reviewer on their `reviewer:` line,
 * and a subagent's thread is `agent-<that id>.jsonl`: with `--tree` and `--base` the readout sums
 * the threads of both reviewers of each item, a thread named by both lenses once.
 *
 *   node evals/review-loop/tokens.cjs --session <transcript dir> [--json]
 *     [--tree <intent worktree> --base <ref> [--head <ref>] [--intent <id>]]
 *
 * `<transcript dir>` is the folder that holds sessions, one session folder, or a session file.
 */

const fs = require('node:fs');
const path = require('node:path');

const { UsageError, commitOf } = require('./history.cjs');
const { roundsByItem } = require('./item-rounds.cjs');

const USAGE = 'usage: node tokens.cjs --session <transcript dir> [--json] [--tree <intent worktree> --base <ref> [--head <ref>] [--intent <id>]]';
const MAIN = 'orchestrator';
/** The agent types of the two reviewer lenses, as the host names them on either platform. */
const REVIEWER_TYPE = /[-_]reviewer(?:[-_]quality)?$/;
const FIELDS = { input: 'input_tokens', cacheRead: 'cache_read_input_tokens', cacheCreation: 'cache_creation_input_tokens', output: 'output_tokens' };

/** The sessions a path names: each with its id, its main thread file and its subagents folder. */
function sessionsAt(target) {
  const at = path.resolve(target);
  if (!fs.existsSync(at)) throw new UsageError(`${target} does not exist`);
  const one = (id, folder) => ({ id, main: `${folder}.jsonl`, subagents: path.join(folder, 'subagents') });
  if (fs.statSync(at).isFile()) return [one(path.basename(at, '.jsonl'), at.replace(/\.jsonl$/, ''))];
  if (fs.existsSync(path.join(at, 'subagents'))) return [one(path.basename(at), at)];
  const found = fs.readdirSync(at).filter((name) => name.endsWith('.jsonl')).sort()
    .map((name) => one(name.replace(/\.jsonl$/, ''), path.join(at, name.replace(/\.jsonl$/, ''))));
  if (found.length === 0) throw new UsageError(`no session under ${target}: name the folder that holds <session-id>.jsonl, or one session folder`);
  return found;
}

/** The threads of a session: the main one as the orchestrator, each subagent by its meta's agentType. */
function threadsOf(session) {
  const threads = fs.existsSync(session.main) ? [{ type: MAIN, file: session.main }] : [];
  if (!fs.existsSync(session.subagents)) return threads;
  for (const name of fs.readdirSync(session.subagents).filter((file) => /^agent-.+\.jsonl$/.test(file)).sort()) {
    const file = path.join(session.subagents, name);
    let type = 'unknown';
    try {
      const meta = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
      if (meta && typeof meta.agentType === 'string' && meta.agentType.trim()) type = meta.agentType.trim();
    } catch (error) {
      // No meta or one that does not read: the thread counts under unknown.
    }
    threads.push({ type, file, id: name.replace(/^agent-/, '').replace(/\.jsonl$/, '') });
  }
  return threads;
}

/** The API messages of one thread file, by id, plus the number of lines that were no JSON. */
function messagesOf(file) {
  const messages = new Map();
  let skipped = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      skipped += 1;
      continue;
    }
    const message = entry && entry.type === 'assistant' ? entry.message : null;
    if (!message || !message.id || !message.usage) continue;
    const known = messages.get(message.id) || { id: message.id, model: message.model || null };
    for (const [key, field] of Object.entries(FIELDS)) known[key] = Math.max(known[key] || 0, Number(message.usage[field]) || 0);
    messages.set(message.id, known);
  }
  return { messages, skipped };
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** One group of threads: threads, rounds, the four token fields, their sum, context per round and models. */
function tallyOne({ threads, messages }) {
  const sum = (key) => messages.reduce((total, message) => total + message[key], 0);
  const contexts = messages.map((message) => message.input + message.cacheRead + message.cacheCreation);
  const counts = Object.fromEntries(Object.keys(FIELDS).map((key) => [key, sum(key)]));
  return {
    threads,
    rounds: messages.length,
    ...counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    contextMedian: median(contexts),
    contextMax: Math.max(0, ...contexts),
    models: [...new Set(messages.map((message) => message.model).filter(Boolean))].sort(),
  };
}

/** Per agent type, the orchestrator first. */
function tally(groups) {
  const names = Object.keys(groups).sort((a, b) => (a === MAIN ? -1 : b === MAIN ? 1 : a.localeCompare(b)));
  return Object.fromEntries(names.map((type) => [type, tallyOne(groups[type])]));
}

/** The reviewer types of both lenses as one group. */
function reviewersOf(groups) {
  const types = Object.keys(groups).filter((type) => REVIEWER_TYPE.test(type));
  return tallyOne({ threads: types.reduce((total, type) => total + groups[type].threads, 0), messages: types.flatMap((type) => groups[type].messages) });
}

/** Read one session: every message id counts once across all its threads, the main thread first. */
function readSession(session) {
  const groups = {};
  const seen = new Set();
  const byThread = new Map();
  let skipped = 0;
  for (const thread of threadsOf(session)) {
    const read = messagesOf(thread.file);
    skipped += read.skipped;
    if (!groups[thread.type]) groups[thread.type] = { threads: 0, messages: [] };
    groups[thread.type].threads += 1;
    const own = [];
    for (const [id, message] of read.messages) {
      if (seen.has(id)) continue;
      seen.add(id);
      groups[thread.type].messages.push(message);
      own.push(message);
    }
    if (thread.id) byThread.set(thread.id, own);
  }
  return { id: session.id, groups, byThread, skipped };
}

/**
 * Each item's reviewer tokens: the threads its review files name, per lens and both together. A
 * thread named by both lenses, or found in two sessions, counts once; `missing` names the ids no
 * transcript holds.
 */
function itemTokens(read, items) {
  const threadsOf = (id) => read.filter((session) => session.byThread.has(id)).map((session) => session.byThread.get(id));
  const group = (ids) => {
    const found = ids.flatMap(threadsOf);
    const messages = new Map(found.flat().map((message) => [message.id, message]));
    return tallyOne({ threads: found.length, messages: [...messages.values()] });
  };
  return items.map(({ intent, item, reviewers }) => {
    const both = [...new Set([...reviewers.contract, ...reviewers.quality])];
    return {
      intent, item, reviewers,
      contract: group(reviewers.contract),
      quality: group(reviewers.quality),
      both: group(both),
      missing: both.filter((id) => threadsOf(id).length === 0),
    };
  });
}

function readout(target, review) {
  const read = sessionsAt(target).map(readSession);
  const all = {};
  for (const session of read) {
    for (const [type, group] of Object.entries(session.groups)) {
      if (!all[type]) all[type] = { threads: 0, messages: [] };
      all[type].threads += group.threads;
      all[type].messages.push(...group.messages);
    }
  }
  const result = {
    sessions: read.map((session) => ({ id: session.id, types: tally(session.groups), reviewers: reviewersOf(session.groups), skipped: session.skipped })),
    total: { types: tally(all), reviewers: reviewersOf(all), skipped: read.reduce((total, session) => total + session.skipped, 0) },
  };
  if (!review) return result;
  const wanted = (intent) => !review.intent || intent === review.intent;
  const items = itemTokens(read, [...roundsByItem(review.tree, review.base, review.head, wanted).values()]);
  const total = items.reduce((sum, entry) => sum + entry.both.total, 0);
  return { ...result, items, perItem: { items: items.length, total, mean: items.length ? Math.round(total / items.length) : 0 } };
}

/** A count as section 1 writes it: 513M, 174k, or the number itself below a thousand. */
function size(value) {
  if (value >= 1e6) return `${value >= 1e8 ? Math.round(value / 1e6) : (value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`;
  return `${Math.round(value)}`;
}

const fields = (t) => [
  `threads ${t.threads}`, `rounds ${t.rounds}`, `input ${size(t.input)}`, `cache read ${size(t.cacheRead)}`,
  `cache write ${size(t.cacheCreation)}`, `output ${size(t.output)}`, `total ${size(t.total)}`,
  `context per round median ${size(t.contextMedian)}, max ${size(t.contextMax)}`, `models ${t.models.join(', ') || 'none'}`,
].join('  ');

function lines(types, reviewers) {
  const width = Math.max(12, ...Object.keys(types).map((type) => type.length));
  const out = Object.entries(types).map(([type, t]) => `  ${type.padEnd(width)}  ${fields(t)}`);
  return reviewers.threads > 0 ? [...out, `  reviewers, both lenses  ${fields(reviewers)}`] : out;
}

const rounds = (count) => `${count} round${count === 1 ? '' : 's'}`;

function itemLines(result) {
  const width = Math.max(4, ...result.items.map((entry) => entry.item.length));
  const out = ['reviewer tokens per item, both lenses'];
  for (const entry of result.items) {
    out.push(`  ${entry.item.padEnd(width)}  contract ${size(entry.contract.total)} in ${rounds(entry.contract.rounds)}  ` +
      `quality ${size(entry.quality.total)} in ${rounds(entry.quality.rounds)}  both ${size(entry.both.total)}, ` +
      `context per round median ${size(entry.both.contextMedian)}` +
      (entry.missing.length ? `  no transcript for ${entry.missing.join(', ')}` : ''));
  }
  if (result.items.length === 0) out.push('  no item review was recorded in this range');
  out.push(`  ${result.perItem.items} items, ${size(result.perItem.total)} in all, so ${size(result.perItem.mean)} per item`, '');
  return out;
}

function text(result) {
  const out = [];
  for (const session of result.sessions) {
    out.push(`session ${session.id}`, ...lines(session.types, session.reviewers));
    if (session.skipped) out.push(`  ${session.skipped} line(s) were no JSON and were skipped`);
    out.push('');
  }
  if (result.sessions.length > 1) out.push('all sessions', ...lines(result.total.types, result.total.reviewers), '');
  if (result.items) out.push(...itemLines(result));
  return `${out.join('\n')}`;
}

const VALUED = ['--session', '--tree', '--base', '--head', '--intent'];

function parseArgs(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--json') options.json = true;
    else if (VALUED.includes(flag) && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) {
      options[flag.slice(2)] = argv[index + 1];
      index += 1;
    } else if (VALUED.includes(flag)) throw new UsageError(`${flag} needs a value`);
    else throw new UsageError(`${flag} is no option here`);
  }
  if (!options.session) throw new UsageError('--session is required');
  if (Boolean(options.tree) !== Boolean(options.base)) throw new UsageError('--tree and --base go together');
  if ((options.head || options.intent) && !options.tree) throw new UsageError('--head and --intent read review files, so they need --tree and --base');
  return options;
}

/** The review range of --tree, --base, --head and --intent, or null without them. */
function reviewOf(options) {
  if (!options.tree) return null;
  const tree = path.resolve(options.tree);
  if (!fs.existsSync(tree)) throw new UsageError(`${options.tree} does not exist`);
  return { tree, base: commitOf(tree, options.base), head: commitOf(tree, options.head || 'HEAD'), intent: options.intent };
}

function main(argv) {
  try {
    const options = parseArgs(argv);
    const result = readout(options.session, reviewOf(options));
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : text(result));
    return 0;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, readout };
