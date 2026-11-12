'use strict';

/**
 * The Claude Code count of one planner run, from the stream `claude -p --output-format
 * stream-json --verbose` writes: one JSON object per line.
 *
 * One API message spans several lines, one content block each, every one with the message's id
 * and usage. So each message id counts once: a model round is one API message; one with a `parent_tool_use_id` came from a subagent and also
 * counts as a subagent round. A shell call is a Bash tool_use, once per tool_use id, and the
 * subcommands of its command are counted as well (a command the shell could not read counts as
 * one, and as unread).
 *
 * The usage on an assistant line is only what its message had reached when the line was written,
 * mostly the value it started with, so the run's totals never come from there: they come from
 * the result line. A stream holds one result line per turn of the session (a build writes one
 * each time a subagent reports back and the session takes another turn), all written when the
 * session ends, and each one's `modelUsage` and `total_cost_usd` are the session's running total
 * so far, subagents included, while its `usage`, `num_turns` and `duration_ms` are that turn's
 * own. So the output, input and cache tokens and the thinking share are the last result line's
 * `modelUsage` summed over its models, and the cost is that line's `total_cost_usd` (the models'
 * `costUSD` summed to it in every measured run, so it is the one source, and a line without it
 * names no cost); the turns and the host's own wall time are summed over the lines. A single
 * result line with no `modelUsage` gives its `usage` instead. A stream with no result line is an
 * unfinished run: it has no totals, which is null, never zero.
 *
 * A line of a type this counter does not know, an assistant line without its id or usage, and a
 * content block it does not know fail loudly with their line number: a count never skips what it
 * cannot read, and so does a result line that names no total.
 */

const fs = require('node:fs');
const path = require('node:path');

const { subcommandCount } = require('./shell-split.cjs');

class TranscriptError extends Error {}

/** The line types of the stream. Only assistant, system and result lines carry what is counted. */
const TYPES = new Set(['system', 'assistant', 'user', 'result', 'rate_limit_event', 'stream_event', 'tool_progress', 'auth_status']);
const BLOCKS = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use', 'server_tool_use', 'web_search_tool_result', 'mcp_tool_use', 'mcp_tool_result']);

/** What an unfinished run has: no totals at all. */
const NO_TOTALS = { input: null, cacheRead: null, cacheCreation: null, output: null, thinking: null, costUsd: null, turns: null, hostWallMs: null, models: [] };
/** Each total and the field of a `modelUsage` entry that holds it. */
const MODEL_FIELDS = { input: 'inputTokens', cacheRead: 'cacheReadInputTokens', cacheCreation: 'cacheCreationInputTokens', output: 'outputTokens' };

const finite = (value) => (Number.isFinite(value) ? value : null);
const summed = (values) => (values.some((value) => Number.isFinite(value)) ? values.reduce((total, value) => total + (Number(value) || 0), 0) : null);

/** The run's totals from its result lines: see the header for which line holds which. */
function totalsOf(results, where) {
  const { entry: last, n } = results[results.length - 1];
  const turns = summed(results.map(({ entry }) => entry.num_turns));
  const hostWallMs = summed(results.map(({ entry }) => entry.duration_ms));
  const models = last.modelUsage && typeof last.modelUsage === 'object' ? Object.entries(last.modelUsage) : [];
  if (models.length > 0) {
    const totals = { turns, hostWallMs, models: models.map(([name]) => name), thinking: 0 };
    for (const key of Object.keys(MODEL_FIELDS)) totals[key] = 0;
    for (const [name, use] of models) {
      if (!use || !Number.isFinite(use.outputTokens)) throw new TranscriptError(`${where(n)}: modelUsage of ${name} has no outputTokens`);
      for (const [key, field] of Object.entries(MODEL_FIELDS)) totals[key] += Number(use[field]) || 0;
      totals.thinking += Number(use.thinkingTokens) || 0;
    }
    totals.costUsd = finite(last.total_cost_usd);
    return totals;
  }
  if (results.length > 1) {
    throw new TranscriptError(`${where(n)}: ${results.length} result lines and the last has no modelUsage, so no line holds the session's total`);
  }
  const use = last.usage;
  if (!use || typeof use !== 'object' || !Number.isFinite(use.output_tokens)) throw new TranscriptError(`${where(n)}: the result line carries no usage`);
  const details = use.output_tokens_details || {};
  return {
    input: Number(use.input_tokens) || 0,
    cacheRead: Number(use.cache_read_input_tokens) || 0,
    cacheCreation: Number(use.cache_creation_input_tokens) || 0,
    output: use.output_tokens,
    thinking: finite(details.thinking_tokens),
    costUsd: finite(last.total_cost_usd),
    turns,
    hostWallMs,
    models: [],
  };
}

function countClaude(file) {
  const where = (n) => `${path.basename(file)} line ${n}`;
  const messages = new Map();
  const calls = new Map();
  const subagent = new Set();
  const results = [];
  let compactions = 0;
  fs.readFileSync(file, 'utf8').split('\n').forEach((text, index) => {
    const n = index + 1;
    if (text.trim() === '') return;
    let entry;
    try {
      entry = JSON.parse(text);
    } catch (error) {
      throw new TranscriptError(`${where(n)}: not JSON`);
    }
    const type = entry && entry.type;
    if (!TYPES.has(type)) {
      throw new TranscriptError(`${where(n)}: type ${JSON.stringify(type)} is no line this counter knows; read its fields, then add it to TYPES in count-claude.cjs`);
    }
    if (type === 'system' && entry.subtype === 'compact_boundary') compactions += 1;
    if (type === 'result') results.push({ entry, n });
    if (type !== 'assistant') return;
    const message = entry.message;
    if (!message || typeof message.id !== 'string' || message.id === '') throw new TranscriptError(`${where(n)}: an assistant line with no message.id`);
    if (!message.usage || typeof message.usage !== 'object') throw new TranscriptError(`${where(n)}: message ${message.id} carries no usage`);
    if (!messages.has(message.id)) messages.set(message.id, { id: message.id, model: message.model || null });
    if (entry.parent_tool_use_id) subagent.add(message.id);
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (!block || !BLOCKS.has(block.type)) throw new TranscriptError(`${where(n)}: content block ${block && block.type} is none this counter knows`);
      if (block.type !== 'tool_use') continue;
      const command = block.name === 'Bash' ? block.input && block.input.command : null;
      if (block.name === 'Bash' && typeof command !== 'string') throw new TranscriptError(`${where(n)}: Bash call ${block.id} has no command`);
      calls.set(block.id, { name: block.name, command });
    }
  });
  if (messages.size === 0) throw new TranscriptError(`${path.basename(file)}: no API message, so the run planned nothing this counter can see`);
  const all = [...messages.values()];
  const totals = results.length ? totalsOf(results, where) : NO_TOTALS;
  const shells = [...calls.values()].filter((call) => call.name === 'Bash');
  const tools = {};
  for (const call of calls.values()) tools[call.name] = (tools[call.name] || 0) + 1;
  return {
    rounds: messages.size,
    subagentRounds: subagent.size,
    input: totals.input,
    cacheRead: totals.cacheRead,
    cacheCreation: totals.cacheCreation,
    output: totals.output,
    thinking: totals.thinking,
    costUsd: totals.costUsd,
    turns: totals.turns,
    resultLines: results.length,
    shellCalls: shells.length,
    shellSubcommands: shells.reduce((total, call) => total + subcommandCount(call.command).count, 0),
    unreadCommands: shells.filter((call) => subcommandCount(call.command).unread).length,
    tools,
    models: [...new Set([...all.map((message) => message.model), ...totals.models].filter(Boolean))].sort(),
    hostWallMs: totals.hostWallMs,
    compactions,
    finished: results.length > 0,
  };
}

module.exports = { TranscriptError, countClaude };
