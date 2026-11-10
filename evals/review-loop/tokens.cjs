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
 *   node evals/review-loop/tokens.cjs --session <transcript dir> [--json]
 *
 * `<transcript dir>` is the folder that holds sessions, one session folder, or a session file.
 */

const fs = require('node:fs');
const path = require('node:path');

const USAGE = 'usage: node tokens.cjs --session <transcript dir> [--json]';
const MAIN = 'orchestrator';
const FIELDS = { input: 'input_tokens', cacheRead: 'cache_read_input_tokens', cacheCreation: 'cache_creation_input_tokens', output: 'output_tokens' };

class UsageError extends Error {}

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
    threads.push({ type, file });
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
    const known = messages.get(message.id) || { model: message.model || null };
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

/** Per agent type: threads, rounds, the four token fields, their sum, context per round and models. */
function tally(groups) {
  const types = {};
  const names = Object.keys(groups).sort((a, b) => (a === MAIN ? -1 : b === MAIN ? 1 : a.localeCompare(b)));
  for (const type of names) {
    const { threads, messages } = groups[type];
    const sum = (key) => messages.reduce((total, message) => total + message[key], 0);
    const contexts = messages.map((message) => message.input + message.cacheRead + message.cacheCreation);
    const counts = Object.fromEntries(Object.keys(FIELDS).map((key) => [key, sum(key)]));
    types[type] = {
      threads,
      rounds: messages.length,
      ...counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      contextMedian: median(contexts),
      contextMax: Math.max(0, ...contexts),
      models: [...new Set(messages.map((message) => message.model).filter(Boolean))].sort(),
    };
  }
  return types;
}

/** Read one session: every message id counts once across all its threads, the main thread first. */
function readSession(session) {
  const groups = {};
  const seen = new Set();
  let skipped = 0;
  for (const thread of threadsOf(session)) {
    const read = messagesOf(thread.file);
    skipped += read.skipped;
    if (!groups[thread.type]) groups[thread.type] = { threads: 0, messages: [] };
    groups[thread.type].threads += 1;
    for (const [id, message] of read.messages) {
      if (seen.has(id)) continue;
      seen.add(id);
      groups[thread.type].messages.push(message);
    }
  }
  return { id: session.id, groups, skipped };
}

function readout(target) {
  const read = sessionsAt(target).map(readSession);
  const all = {};
  for (const session of read) {
    for (const [type, group] of Object.entries(session.groups)) {
      if (!all[type]) all[type] = { threads: 0, messages: [] };
      all[type].threads += group.threads;
      all[type].messages.push(...group.messages);
    }
  }
  return {
    sessions: read.map((session) => ({ id: session.id, types: tally(session.groups), skipped: session.skipped })),
    total: { types: tally(all), skipped: read.reduce((total, session) => total + session.skipped, 0) },
  };
}

/** A count as section 1 writes it: 513M, 174k, or the number itself below a thousand. */
function size(value) {
  if (value >= 1e6) return `${value >= 1e8 ? Math.round(value / 1e6) : (value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`;
  return `${Math.round(value)}`;
}

function lines(types) {
  const width = Math.max(12, ...Object.keys(types).map((type) => type.length));
  return Object.entries(types).map(([type, t]) => `  ${type.padEnd(width)}  ${[
    `threads ${t.threads}`, `rounds ${t.rounds}`, `input ${size(t.input)}`, `cache read ${size(t.cacheRead)}`,
    `cache write ${size(t.cacheCreation)}`, `output ${size(t.output)}`, `total ${size(t.total)}`,
    `context per round median ${size(t.contextMedian)}, max ${size(t.contextMax)}`, `models ${t.models.join(', ') || 'none'}`,
  ].join('  ')}`);
}

function text(result) {
  const out = [];
  for (const session of result.sessions) {
    out.push(`session ${session.id}`, ...lines(session.types));
    if (session.skipped) out.push(`  ${session.skipped} line(s) were no JSON and were skipped`);
    out.push('');
  }
  if (result.sessions.length > 1) out.push('all sessions', ...lines(result.total.types), '');
  return `${out.join('\n')}`;
}

function main(argv) {
  try {
    const at = argv.indexOf('--session');
    const target = at >= 0 ? argv[at + 1] : undefined;
    const unknown = argv.filter((arg, index) => arg.startsWith('--') && !['--session', '--json'].includes(arg) && index !== at + 1);
    if (!target || target.startsWith('--')) throw new UsageError('--session is required');
    if (unknown.length) throw new UsageError(`${unknown[0]} is no option here`);
    const result = readout(target);
    process.stdout.write(argv.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : text(result));
    return 0;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, readout };
