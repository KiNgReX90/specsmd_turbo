'use strict';

/**
 * The count of one build of a kept plan: what the plan then cost the builder. A build folder is
 * what `planner-ab.cjs build` keeps:
 *
 *   meta.json         kind build, the run it built, the intent, the plan's item ids, the times and the exit
 *   transcript.jsonl  the orchestrator's stream-json
 *   subagents/        the transcripts the host stored of the session's subagents, when they were found
 *
 * The whole build: the wall time, and the cost and output tokens of the stream's result lines
 * (count-claude.cjs says which line holds the total), then the subagents by role. A subagent's
 * usage in the stream is its last message only, so its output tokens come from the transcript
 * the host stored of it: per message id the largest `output_tokens` seen, summed. A subagent
 * whose stored transcript is not there is "not counted", never zero.
 *
 * Per work item the builder's rounds, output tokens and wall time, split into the first build
 * and each correction. A correction reaches a builder as the orchestrator's SendMessage to that
 * agent id (the full id: every message of the sample builds named it so) and lands in its stored transcript as a plain user message; a skill body the host
 * injects lands the same way and is no correction, so a transcript splits only where a message
 * holds the text of one of the orchestrator's messages to it. A second builder the orchestrator
 * starts for the same item is a correction too. Which item a builder built is the plan's item id
 * that comes first in the prompt of its Agent call.
 *
 * A red integrate step is the orchestrator's own `run.cjs integrate` call that exited non-zero.
 * The orchestrator often runs it beside other calls and echoes each exit code itself, so the
 * tool result is not marked as an error: the exit is the echo that follows the call, read with
 * the echo's own wording; with no echo the call's exit is the tool result's when it is the last
 * subcommand, and otherwise the red lines integrate prints say it.
 */

const fs = require('node:fs');
const path = require('node:path');

const { TranscriptError, countClaude } = require('./count-claude.cjs');
const { ShellSplitError, subcommands } = require('./shell-split.cjs');
const { claudeHome } = require('./hosts.cjs');

/** A role per part of a subagent type, the more specific first. */
const ROLES = [['reviewer-quality', 'quality reviewer'], ['reviewer', 'reviewer'], ['builder', 'builder'], ['scanner', 'scanner']];
const INTEGRATE = /run\.cjs['"]?\s+integrate(?:\s|$)/;
/** What integrate prints when it comes back red (run-integrate.cjs), read only when no exit code says it. */
const RED_LINES = /integrate command\(s\) failed|the code changed while integrate ran|refusing to integrate|^ERROR \[/m;

function roleOf(type) {
  const name = String(type || '');
  const found = ROLES.find(([part]) => name.includes(part));
  return found ? found[1] : name || 'unnamed';
}

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').map((text, index) => ({ text, n: index + 1 })).filter(({ text }) => text.trim() !== '')
    .map(({ text, n }) => {
      try {
        return { ...JSON.parse(text), n };
      } catch (error) {
        throw new TranscriptError(`${path.basename(file)} line ${n}: not JSON`);
      }
    });
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => (block && typeof block.text === 'string' ? block.text : '')).join('\n');
}

/** The orchestrator's own Agent, SendMessage and Bash calls, and what came back from each. */
function orchestratorCalls(lines) {
  const agents = [];
  const sends = [];
  const shells = new Map();
  const results = new Map();
  for (const entry of lines) {
    if (entry.parent_tool_use_id) continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    if (entry.type === 'assistant') {
      for (const block of content) {
        if (!block || block.type !== 'tool_use') continue;
        const input = block.input || {};
        if (block.name === 'Agent' || block.name === 'Task') {
          agents.push({ toolUseId: block.id, type: input.subagent_type, prompt: String(input.prompt || ''), description: String(input.description || '') });
        } else if (block.name === 'SendMessage') {
          sends.push({ to: String(input.to || input.recipient || ''), text: typeof input.message === 'string' ? input.message : textOf(input.message) });
        } else if (block.name === 'Bash' && typeof input.command === 'string') shells.set(block.id, input.command);
      }
    }
    if (entry.type === 'user') {
      const answers = content.filter((block) => block && block.type === 'tool_result');
      const own = answers.length === 1 && entry.tool_use_result && typeof entry.tool_use_result === 'object' ? entry.tool_use_result.agentId : null;
      for (const block of answers) results.set(block.tool_use_id, { text: textOf(block.content), isError: block.is_error === true, agentId: own || null });
    }
  }
  return { agents, sends, shells, results };
}

/** The subagent folder the host stored of `sessionId`, matched by its name only, or null. */
function hostStored(sessionId, env = process.env) {
  const projects = path.join(claudeHome(env), 'projects');
  if (!sessionId || !fs.existsSync(projects)) return null;
  for (const name of fs.readdirSync(projects)) {
    const at = path.join(projects, name, sessionId, 'subagents');
    if (fs.existsSync(at)) return at;
  }
  return null;
}

/** The agent id each Agent call started, as the stored meta files name it. */
function storedAgents(dir) {
  const byCall = new Map();
  if (!dir) return byCall;
  for (const name of fs.readdirSync(dir)) {
    const match = /^agent-(.+)\.meta\.json$/.exec(name);
    if (!match) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    if (meta.toolUseId) byCall.set(meta.toolUseId, match[1]);
  }
  return byCall;
}

const flat = (text) => String(text).replace(/\s+/g, ' ').trim();

/**
 * One stored subagent transcript in steps: the first, then one per message of the orchestrator
 * found in it, in order. A message id belongs to the step it first appears in.
 */
function stepsOf(file, messages) {
  const keys = messages.map((text) => flat(text).slice(0, 160)).filter(Boolean);
  const steps = [{ start: null, end: null, outputs: new Map() }];
  const owner = new Map();
  let next = 0;
  for (const entry of readLines(file)) {
    const at = Date.parse(entry.timestamp);
    const content = entry.message && entry.message.content;
    const plain = entry.type === 'user' && (typeof content === 'string' ||
      (Array.isArray(content) && !content.some((block) => block && block.type === 'tool_result')));
    if (plain && next < keys.length && flat(textOf(content)).includes(keys[next])) {
      steps.push({ start: null, end: null, outputs: new Map() });
      next += 1;
    }
    const step = steps[steps.length - 1];
    if (Number.isFinite(at)) {
      if (step.start === null) step.start = at;
      step.end = at;
    }
    if (entry.type !== 'assistant') continue;
    const message = entry.message || {};
    if (typeof message.id !== 'string' || !message.usage) {
      throw new TranscriptError(`${path.basename(file)} line ${entry.n}: an assistant line with no message id or usage`);
    }
    if (!owner.has(message.id)) owner.set(message.id, step);
    const outputs = owner.get(message.id).outputs;
    outputs.set(message.id, Math.max(outputs.get(message.id) || 0, Number(message.usage.output_tokens) || 0));
  }
  return {
    steps: steps.map((step) => ({
      rounds: step.outputs.size,
      output: [...step.outputs.values()].reduce((sum, value) => sum + value, 0),
      wallMs: step.start === null ? null : step.end - step.start,
    })),
    unmatched: keys.length - next,
  };
}

/** The plan item a builder's prompt names first, or null. */
function itemOf(call, items) {
  let best = null;
  for (const id of items) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`).exec(call.prompt);
    if (match && (best === null || match.index < best.index)) best = { id, index: match.index };
  }
  return best && best.id;
}

/** The exit an echo of `$?` prints, as a pattern of its own wording. */
function echoPattern(echo) {
  const words = echo.replace(/^echo(?:\s+-[neE]+)*\s*/, '').replace(/["']/g, '');
  const parts = words.split('$?').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\$\w+|\\\$\\\{[^}]*\\\}/g, '.*'));
  return new RegExp(`^${parts.join('(\\d+)')}$`);
}

/** Each `run.cjs integrate` of one orchestrator shell call: the items it names and whether it came back red. */
function integrateSteps(command, result) {
  let subs;
  try {
    subs = subcommands(command);
  } catch (error) {
    if (!(error instanceof ShellSplitError)) throw error;
    subs = [command];
  }
  const output = result ? result.text : '';
  const lines = output.split('\n').map((line) => line.trim());
  const steps = [];
  subs.forEach((sub, index) => {
    if (!INTEGRATE.test(sub)) return;
    const named = /--items?\s+(\S+)/.exec(sub);
    const items = named ? named[1].replace(/["']/g, '').split(',').filter(Boolean) : [];
    const echo = subs[index + 1];
    let exit = null;
    if (echo && /^echo\b/.test(echo) && echo.includes('$?')) {
      const nth = subs.slice(0, index + 2).filter((other) => other === echo).length;
      const pattern = echoPattern(echo);
      const hit = lines.map((line) => pattern.exec(line)).filter(Boolean)[nth - 1];
      if (hit) exit = Number(hit[1]);
    }
    if (exit === null && index === subs.length - 1 && result) {
      const code = /^Exit code (\d+)/.exec(output);
      exit = result.isError ? (code ? Number(code[1]) : 1) : 0;
    }
    if (exit === null) exit = RED_LINES.test(output) ? 2 : 0;
    steps.push({ items, red: exit !== 0, exit });
  });
  return steps;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Every subagent the orchestrator started, with its role, its item and, when stored, its steps. */
function subagentsOf(calls, stored, items) {
  const byCall = storedAgents(stored);
  return calls.agents.map((call) => {
    const answer = calls.results.get(call.toolUseId);
    const agentId = (answer && answer.agentId) || byCall.get(call.toolUseId) || null;
    const role = roleOf(call.type);
    const file = stored && agentId ? path.join(stored, `agent-${agentId}.jsonl`) : null;
    const sends = agentId ? calls.sends.filter((send) => send.to === agentId) : [];
    const counted = file && fs.existsSync(file) ? stepsOf(file, sends.map((send) => send.text)) : null;
    return { role, type: call.type, agentId, item: role === 'builder' ? itemOf(call, items) : null, sends: sends.length, counted };
  });
}

function rolesOf(subagents) {
  const roles = new Map();
  for (const agent of subagents) {
    const role = roles.get(agent.role) || { role: agent.role, count: 0, stored: 0, output: 0 };
    role.count += 1;
    if (agent.counted) {
      role.stored += 1;
      role.output += agent.counted.steps.reduce((sum, step) => sum + step.output, 0);
    }
    roles.set(agent.role, role);
  }
  return [...roles.values()].map((role) => ({ ...role, output: role.stored === role.count ? role.output : null }));
}

function itemsOf(subagents, integrates, items) {
  const builders = subagents.filter((agent) => agent.role === 'builder');
  const ids = [...items, ...(builders.some((agent) => !agent.item) ? [null] : [])];
  return ids.map((id) => {
    const own = builders.filter((agent) => agent.item === id);
    const steps = [];
    for (const agent of own) {
      if (!agent.counted) steps.push({ step: steps.length === 0 ? 'first build' : `correction ${steps.length}`, counted: false });
      else for (const step of agent.counted.steps) steps.push({ step: steps.length === 0 ? 'first build' : `correction ${steps.length}`, counted: true, ...step });
    }
    return {
      item: id,
      builders: own.length,
      corrections: own.length ? own.length - 1 + own.reduce((sum, agent) => sum + agent.sends, 0) : 0,
      steps,
      redIntegrates: id === null ? 0 : integrates.filter((step) => step.red && step.items.includes(id)).length,
    };
  });
}

/** One kept build, counted. */
function countBuild(dir, env = process.env) {
  const meta = readJson(path.join(dir, 'meta.json'));
  const transcript = path.join(dir, 'transcript.jsonl');
  if (!fs.existsSync(transcript)) throw new TranscriptError(`${dir} kept no transcript.jsonl`);
  const whole = countClaude(transcript);
  const lines = readLines(transcript);
  const init = lines.find((entry) => entry.type === 'system' && entry.subtype === 'init');
  const sessionId = (init && init.session_id) || meta.sessionId || null;
  const kept = path.join(dir, 'subagents');
  const stored = fs.existsSync(kept) ? kept : hostStored(sessionId, env);
  const calls = orchestratorCalls(lines);
  const items = Array.isArray(meta.items) ? meta.items : [];
  const subagents = subagentsOf(calls, stored, items);
  const integrates = [...calls.shells].flatMap(([id, command]) => integrateSteps(command, calls.results.get(id)));
  const notes = [];
  if (meta.exit !== 0) notes.push(meta.exit === null || meta.exit === undefined ? 'the host was stopped' : `the host exited ${meta.exit}`);
  if (meta.error) notes.push(meta.error);
  if (!whole.finished) notes.push('unfinished: the stream has no result line, so the build has no totals');
  if (!stored) notes.push('the host\'s stored subagent transcripts are not there, so no subagent\'s output tokens are counted');
  for (const agent of subagents) {
    if (agent.counted && agent.counted.unmatched) notes.push(`${agent.counted.unmatched} message(s) to ${agent.agentId} not found in its stored transcript`);
  }
  return {
    kind: 'build',
    id: meta.id || path.basename(dir),
    arm: meta.arm || null,
    intent: meta.intent || null,
    exit: meta.exit === undefined ? null : meta.exit,
    items,
    whole: {
      wallMs: Number.isFinite(meta.wallMs) ? meta.wallMs : whole.hostWallMs,
      costUsd: whole.costUsd,
      output: whole.output,
      thinking: whole.thinking,
      orchestratorRounds: whole.rounds - whole.subagentRounds,
      resultLines: whole.resultLines,
      finished: whole.finished,
    },
    roles: rolesOf(subagents),
    perItem: itemsOf(subagents, integrates, items),
    integrates: { total: integrates.length, red: integrates.filter((step) => step.red).length },
    notes,
  };
}

const minutes = (ms) => (Number.isFinite(ms) ? `${(ms / 60000).toFixed(1)} min` : '-');
const cells = (values) => `| ${values.join(' | ')} |`;

function buildTable(result) {
  const { whole } = result;
  const head = whole.finished
    ? `${minutes(whole.wallMs)} wall, ${whole.costUsd === null ? 'no cost named' : `${whole.costUsd.toFixed(2)} USD`}, ${whole.output} output tokens` +
      `${Number.isFinite(whole.thinking) ? ` (${whole.thinking} thinking)` : ''}`
    : `${minutes(whole.wallMs)} wall, unfinished: the stream has no result line, so no cost and no output tokens`;
  const out = [
    `Build ${result.id}: intent ${result.intent || 'unknown'}${result.arm ? `, arm ${result.arm}` : ''}, ${result.items.length} items in the plan`,
    `Whole build: ${head}, ${whole.orchestratorRounds} orchestrator rounds, ${result.integrates.total} integrate steps (${result.integrates.red} red)`,
    '',
    cells(['Role', 'Subagents', 'Output tokens']),
    cells(Array(3).fill('---')),
    ...result.roles.map((role) => cells([role.role, role.count, role.output === null ? `not counted (${role.stored} of ${role.count} stored)` : role.output])),
    '',
    cells(['Item', 'Step', 'Rounds', 'Output tokens', 'Wall']),
    cells(Array(5).fill('---')),
  ];
  for (const item of result.perItem) {
    const name = item.item || 'no plan item named';
    if (item.steps.length === 0) out.push(cells([name, 'no builder', '', '', '']));
    for (const step of item.steps) {
      out.push(step.counted ? cells([name, step.step, step.rounds, step.output, minutes(step.wallMs)]) : cells([name, step.step, 'not counted', 'not counted', '-']));
    }
  }
  out.push('', cells(['Item', 'Builders', 'Corrections', 'Red integrate steps']), cells(Array(4).fill('---')));
  for (const item of result.perItem) out.push(cells([item.item || 'no plan item named', item.builders, item.corrections, item.redIntegrates]));
  if (result.notes.length) out.push('', ...result.notes.map((note) => `note: ${note}`));
  return `${out.join('\n')}\n`;
}

module.exports = { countBuild, buildTable, hostStored, integrateSteps, itemOf, roleOf };
