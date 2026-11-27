'use strict';

/**
 * The Codex count of one planner run, from the session rollout Codex keeps for a `codex exec`
 * run: one JSON object per line, each with a `timestamp`, a `type` and a `payload`.
 *
 * A model round ends in an `event_msg` of type `token_count`. Codex repeats that event when only
 * its rate limits moved, so a round is a token count whose `total_token_usage` moved, and its
 * tokens are that event's `last_token_usage`. That value is the round's own, and the running total
 * is a field of its own beside it, so summing it over the rounds reads no per-event value as a
 * total: the mistake the Claude stream invites, where each line carries a message's start value,
 * has no counterpart in these events. A shell call is a `function_call` of a shell tool
 * or a `local_shell_call`, once per call id. Codex batches several commands into one call, so
 * the subcommands of each are counted as well. The host's own wall time runs from the first
 * timestamp to the last.
 *
 * A line type, a response item, a function or a custom tool this counter does not know, and a
 * call or a token count without the field it is counted by, fail loudly with their line number.
 * A function whose name holds `__` is an MCP tool and counts as a tool call.
 */

const fs = require('node:fs');
const path = require('node:path');

const { scriptOf, subcommandCount } = require('./shell-split.cjs');
const { TranscriptError } = require('./count-claude.cjs');

const TYPES = new Set(['session_meta', 'response_item', 'event_msg', 'turn_context', 'compacted']);
const ITEMS = new Set(['message', 'reasoning', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output',
  'local_shell_call', 'web_search_call', 'ghost_snapshot', 'compaction']);
/** Each shell function with the argument that holds its command. */
const SHELL_FUNCTIONS = { shell: 'command', 'container.exec': 'command', local_shell: 'command', shell_command: 'command', exec_command: 'cmd' };
const OTHER_FUNCTIONS = new Set(['apply_patch', 'update_plan', 'view_image', 'write_stdin', 'web_search', 'spawn_agent', 'send_input',
  'wait', 'wait_agent', 'close_agent', 'resume_agent', 'request_user_input', 'list_mcp_resources', 'list_mcp_resource_templates',
  'read_mcp_resource']);
const CUSTOM_TOOLS = new Set(['apply_patch']);

function countCodex(file) {
  const where = (n) => `${path.basename(file)} line ${n}`;
  const calls = new Map();
  const models = new Set();
  const sums = { input: 0, cacheRead: 0, output: 0, reasoning: 0 };
  let rounds = 0;
  let previous = null;
  let first = null;
  let last = null;
  let compacted = 0;
  let compactedEvents = 0;
  let finished = false;
  let lastAnswered = false;
  const shell = (n, id, name, command) => {
    if (command === undefined || command === null) throw new TranscriptError(`${where(n)}: shell call ${id} has no command`);
    let script;
    try {
      script = scriptOf(command);
    } catch (error) {
      throw new TranscriptError(`${where(n)}: shell call ${id}: ${error.message}`);
    }
    calls.set(id, { name, shell: true, script });
  };
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
      throw new TranscriptError(`${where(n)}: type ${JSON.stringify(type)} is no line this counter knows; read its fields, then add it to TYPES in count-codex.cjs`);
    }
    const at = Date.parse(entry.timestamp);
    if (Number.isFinite(at)) {
      if (first === null) first = at;
      last = at;
    }
    const payload = entry.payload || {};
    if (type === 'compacted') compacted += 1;
    if (type === 'turn_context' && payload.model) models.add(payload.model);
    if (type === 'event_msg') {
      if (payload.type === 'context_compacted') compactedEvents += 1;
      if (payload.type === 'task_complete') finished = true;
      if (payload.type !== 'token_count' || payload.info === null || payload.info === undefined) return;
      const { total_token_usage: total, last_token_usage: own } = payload.info;
      if (!total || typeof total !== 'object') throw new TranscriptError(`${where(n)}: a token_count with no total_token_usage`);
      if (!own || typeof own !== 'object') throw new TranscriptError(`${where(n)}: a token_count with no last_token_usage`);
      const key = JSON.stringify(total);
      if (key === previous) return;
      previous = key;
      rounds += 1;
      sums.input += Number(own.input_tokens) || 0;
      sums.cacheRead += Number(own.cached_input_tokens) || 0;
      sums.output += Number(own.output_tokens) || 0;
      sums.reasoning += Number(own.reasoning_output_tokens) || 0;
      return;
    }
    if (type !== 'response_item') return;
    if (!ITEMS.has(payload.type)) throw new TranscriptError(`${where(n)}: response item ${payload.type} is none this counter knows`);
    // A run that ended on its own answered last: its last item is the assistant's message.
    lastAnswered = payload.type === 'message' && payload.role === 'assistant';
    const id = payload.call_id || payload.id || `line-${n}`;
    if (payload.type === 'local_shell_call') shell(n, id, 'local_shell_call', payload.action && payload.action.command);
    if (payload.type === 'custom_tool_call') {
      if (!CUSTOM_TOOLS.has(payload.name)) throw new TranscriptError(`${where(n)}: custom tool ${payload.name} is none this counter knows`);
      calls.set(id, { name: payload.name, shell: false });
    }
    if (payload.type !== 'function_call') return;
    const name = payload.name;
    const isMcp = typeof name === 'string' && name.includes('__');
    if (!(name in SHELL_FUNCTIONS) && !OTHER_FUNCTIONS.has(name) && !isMcp) {
      throw new TranscriptError(`${where(n)}: function ${name} is none this counter knows; say whether it runs a shell, then add it to count-codex.cjs`);
    }
    if (!(name in SHELL_FUNCTIONS)) {
      calls.set(id, { name, shell: false });
      return;
    }
    let args;
    try {
      args = JSON.parse(payload.arguments);
    } catch (error) {
      throw new TranscriptError(`${where(n)}: the arguments are not JSON in call ${id}`);
    }
    shell(n, id, name, args && args[SHELL_FUNCTIONS[name]]);
  });
  if (rounds === 0) throw new TranscriptError(`${path.basename(file)}: no model round, so the run planned nothing this counter can see`);
  const shells = [...calls.values()].filter((call) => call.shell);
  const counted = shells.map((call) => subcommandCount(call.script));
  const tools = {};
  for (const call of calls.values()) tools[call.name] = (tools[call.name] || 0) + 1;
  return {
    rounds,
    ...sums,
    shellCalls: shells.length,
    shellSubcommands: counted.reduce((total, entry) => total + entry.count, 0),
    unreadCommands: counted.filter((entry) => entry.unread).length,
    tools,
    models: [...models].sort(),
    hostWallMs: first === null ? null : last - first,
    compactions: Math.max(compacted, compactedEvents),
    finished: finished || lastAnswered,
  };
}

module.exports = { countCodex };
