'use strict';

/**
 * The Claude Code count of one planner run, from the stream `claude -p --output-format
 * stream-json --verbose` writes: one JSON object per line.
 *
 * Usage sits on each API message, and one message spans several lines, one content block each,
 * every one with the message's id and usage. So each message id counts once, each usage field at
 * the largest value its lines carry (a later line of the same message never carries less). A
 * model round is one API message; one with a `parent_tool_use_id` came from a subagent and also
 * counts as a subagent round. A shell call is a Bash tool_use, once per tool_use id, and the
 * subcommands of its command are counted as well (a command the shell could not read counts as
 * one, and as unread). The host's own wall time is the result line's
 * `duration_ms`.
 *
 * A line of a type this counter does not know, an assistant line without its id or usage, and a
 * content block it does not know fail loudly with their line number: a count never skips what it
 * cannot read.
 */

const fs = require('node:fs');
const path = require('node:path');

const { subcommandCount } = require('./shell-split.cjs');

class TranscriptError extends Error {}

/** The line types of the stream. Only assistant, system and result lines carry what is counted. */
const TYPES = new Set(['system', 'assistant', 'user', 'result', 'rate_limit_event', 'stream_event', 'tool_progress', 'auth_status']);
const BLOCKS = new Set(['text', 'thinking', 'redacted_thinking', 'tool_use', 'server_tool_use', 'web_search_tool_result', 'mcp_tool_use', 'mcp_tool_result']);
const FIELDS = { input: 'input_tokens', cacheRead: 'cache_read_input_tokens', cacheCreation: 'cache_creation_input_tokens', output: 'output_tokens' };

function countClaude(file) {
  const where = (n) => `${path.basename(file)} line ${n}`;
  const messages = new Map();
  const calls = new Map();
  const subagent = new Set();
  let hostWallMs = null;
  let finished = false;
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
    if (type === 'result') {
      finished = true;
      if (Number.isFinite(entry.duration_ms)) hostWallMs = entry.duration_ms;
    }
    if (type !== 'assistant') return;
    const message = entry.message;
    if (!message || typeof message.id !== 'string' || message.id === '') throw new TranscriptError(`${where(n)}: an assistant line with no message.id`);
    if (!message.usage || typeof message.usage !== 'object') throw new TranscriptError(`${where(n)}: message ${message.id} carries no usage`);
    const known = messages.get(message.id) || { id: message.id, model: message.model || null, input: 0, cacheRead: 0, cacheCreation: 0, output: 0 };
    for (const [key, field] of Object.entries(FIELDS)) known[key] = Math.max(known[key], Number(message.usage[field]) || 0);
    messages.set(message.id, known);
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
  const sum = (key) => all.reduce((total, message) => total + message[key], 0);
  const shells = [...calls.values()].filter((call) => call.name === 'Bash');
  const tools = {};
  for (const call of calls.values()) tools[call.name] = (tools[call.name] || 0) + 1;
  return {
    rounds: messages.size,
    subagentRounds: subagent.size,
    input: sum('input'),
    cacheRead: sum('cacheRead'),
    cacheCreation: sum('cacheCreation'),
    output: sum('output'),
    shellCalls: shells.length,
    shellSubcommands: shells.reduce((total, call) => total + subcommandCount(call.command).count, 0),
    unreadCommands: shells.filter((call) => subcommandCount(call.command).unread).length,
    tools,
    models: [...new Set(all.map((message) => message.model).filter(Boolean))].sort(),
    hostWallMs,
    compactions,
    finished,
  };
}

module.exports = { TranscriptError, countClaude };
