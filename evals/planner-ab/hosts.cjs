'use strict';

/**
 * How each host runs the planner headless, and where its transcript ends up.
 *
 * Both hosts run the installed planner as the session's own thread, on the pins its installed
 * agent file names, with the statement on stdin. The planner spawns nobody ("research runs
 * inline"), so the one thread is the whole planner.
 *
 * Claude Code: `claude -p` with the planner as `--agent`, its stream-json output kept as the
 * transcript, and nothing persisted as a session. What loads: the consumer's project settings
 * and its own CLAUDE.md, with the sign-in of this machine. `--setting-sources project` keeps this
 * machine's user settings out, and with them its hooks and plugins, but not the user's own
 * instructions file: a host loads that file whatever the setting sources say (a measured run
 * answered in the language it asks for). So the command also names that file in
 * `claudeMdExcludes`, through `--settings`, which keeps it out and leaves the project's
 * CLAUDE.md and the sign-in as they are (a probe answered without the file's language and still
 * read the project's file). The file is `$CLAUDE_CONFIG_DIR/CLAUDE.md`, or `~/.claude/CLAUDE.md`.
 *
 * The build of a kept plan runs the installed orchestrator the same way, headless and on the
 * same exclusion. The orchestrator is a command, not an agent, so `--agent` cannot start it: its
 * slash command goes to stdin. The session is persisted, since a subagent's own output tokens
 * are written only in the transcript the host stores of it.
 *
 * Codex: `codex exec --json` with the planner's model, effort and developer instructions from
 * its custom agent file. The JSON events carry no model round, so the transcript is the session
 * rollout Codex keeps under $CODEX_HOME/sessions, found by the thread id the events name. Only
 * that file is read: a file is matched by its name before it is opened.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOSTS = ['claude', 'codex'];
const CLAUDE_TOOLS = 'Bash,Read,Write,Edit,Grep,Glob,TodoWrite';
/** The tools a build calls: the orchestrator's (a subagent is an Agent call, its tool listed as Task) and its subagents'. */
const BUILD_TOOLS = 'Bash,Read,Write,Edit,Grep,Glob,Agent,Task,Skill';

/** The host config each host's frontier reads, as the planner texts name them. */
const CONFIG = { claude: '.specs-inferno/config.yaml', codex: '.specs-inferno/config.codex.yaml' };

/** The folder Claude Code keeps its user files in: its sessions and the user's own instructions. */
function claudeHome(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/** The settings that keep the user's own instructions file out of a headless run. */
function claudeSettings(env = process.env) {
  return JSON.stringify({ claudeMdExcludes: [path.join(claudeHome(env), 'CLAUDE.md')] });
}

function claudeArgv(pins, env) {
  return ['claude', '-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project', '--settings', claudeSettings(env),
    '--agent', pins.agent, '--model', pins.model, '--effort', pins.effort, '--permission-mode', 'acceptEdits',
    '--allowed-tools', CLAUDE_TOOLS, '--permission-prompts', 'none', '--no-session-persistence'];
}

/** The argv that builds a kept plan with the installed orchestrator, its slash command going to stdin. */
function buildArgv(model, env = process.env) {
  return ['claude', '-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project', '--settings', claudeSettings(env),
    '--model', model, '--permission-mode', 'acceptEdits', '--allowed-tools', BUILD_TOOLS, '--permission-prompts', 'none'];
}

function codexArgv(pins, tree) {
  // A JSON string is a TOML basic string, so -c reads the instructions back exactly.
  return ['codex', 'exec', '--json', '--cd', tree, '--sandbox', 'workspace-write', '-m', pins.model,
    '-c', `model_reasoning_effort=${JSON.stringify(pins.effort)}`, '-c', `developer_instructions=${JSON.stringify(pins.instructions)}`, '-'];
}

/** The argv that plans on `host` in `tree`, the statement going to its stdin. */
function hostArgv(host, pins, tree, env = process.env) {
  if (host === 'claude') return claudeArgv(pins.claude, env);
  if (host === 'codex') return codexArgv(pins.codex, tree);
  throw new Error(`no host ${host}: the hosts are ${HOSTS.join(', ')}`);
}

/** The frontier call of one planned intent, on the config of the host that planned it. */
function frontierArgv(host, intent) {
  return ['node', '.specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs', 'frontier', intent, '--config', CONFIG[host]];
}

/**
 * A stand-in for the `codex features list` the Codex frontier asks about its wait floor. The
 * floor guards an orchestrator's waits, which a plan never reaches, and a sandbox under a
 * scratch folder is a project Codex does not trust, so the real check would refuse every Codex
 * plan here. The flow's own fixtures stand in the same way (review-fixture.cjs, codexStub).
 */
const CODEX_HOLDS = [
  '#!/bin/sh',
  'case "$*" in *default_wait_timeout_ms=1199999*)',
  '  printf "Caused by:\\n    features.multi_agent_v2.default_wait_timeout_ms must be at least features.multi_agent_v2.min_wait_timeout_ms\\n" >&2',
  '  exit 1;;',
  'esac',
  'echo "multi_agent_v2                           stable             true"',
  '',
].join('\n');

/** The thread id `codex exec --json` names on its thread.started line. */
function threadIdOf(eventsFile) {
  if (!fs.existsSync(eventsFile)) return null;
  for (const line of fs.readFileSync(eventsFile, 'utf8').split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') return event.thread_id;
    } catch (error) {
      // A line that is no JSON names no thread.
    }
  }
  return null;
}

/** The day folders a run between `started` and `ended` may have written its rollout into. */
function dayFolders(sessions, started, ended) {
  const days = new Set();
  for (let at = new Date(started); at <= new Date(ended.getTime() + 86400000); at = new Date(at.getTime() + 86400000)) {
    const local = [at.getFullYear(), at.getMonth() + 1, at.getDate()];
    const utc = [at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate()];
    for (const [y, m, d] of [local, utc]) days.add(path.join(sessions, String(y), String(m).padStart(2, '0'), String(d).padStart(2, '0')));
  }
  return [...days].filter((dir) => fs.existsSync(dir));
}

/** The rollout of thread `id`, matched by its file name only, or null. */
function findRollout(id, started, ended, env = process.env) {
  const sessions = path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
  for (const dir of dayFolders(sessions, started, ended)) {
    const name = fs.readdirSync(dir).find((file) => file.startsWith('rollout-') && file.endsWith(`-${id}.jsonl`));
    if (name) return path.join(dir, name);
  }
  return null;
}

/** An argv as one line a shell runs as is. */
function quote(argv) {
  return argv.map((arg) => (/^[A-Za-z0-9_./:=,@%+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`)).join(' ');
}

module.exports = { HOSTS, CONFIG, CODEX_HOLDS, hostArgv, buildArgv, claudeHome, frontierArgv, threadIdOf, findRollout, quote };
