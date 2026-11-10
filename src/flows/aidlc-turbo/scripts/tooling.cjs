#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - the code tooling of a project.
 *
 * The tools the Turbo agents use to find existing code and to catch errors
 * early: a language server per language (on Claude Code: a plugin, which the
 * LSP tool talks to), analysis and lint tools. Which ones fit differs per
 * project, so Turbo keeps no list: the agent proposes from `facts` and the
 * user chooses (skills/master/tooling.md). The choice, a "no" included, lives
 * in .specs-aidlc-turbo/repo/tooling.yaml, committed with the repo, so it is
 * asked once per repo. Every machine that checks it out still needs the
 * tools themselves: `check` looks for them at every Turbo start.
 *
 * Run from the project root:
 *   node tooling.cjs facts                 what the project has, as JSON, to propose from
 *   node tooling.cjs check                 {"tooling": "missing"|"declined"|"ok"|"incomplete"|"invalid", ...}
 *   node tooling.cjs write '<json>'        write tooling.yaml from {status, tools, declined}
 *   node tooling.cjs brief                 the short text every subagent gets
 *   node tooling.cjs run [--code-root <dir>] [--base <ref>] [--tool <name>]
 *                                          run the analysis and lint tools on a change
 * Options: --project <dir> (default the current directory).
 * Exit 0, 1 on a failure, 2 on bad input. `check` never runs a tool: it only
 * looks whether a program and a plugin exist.
 *
 * A tool in the file:
 *   name      the tool's name
 *   kind      language-server | analysis | lint
 *   purpose   what it gives the agents, one line
 *   needs     the programs it needs on the PATH
 *   plugin    language-server: the Claude Code plugin, name@marketplace
 *   extensions  language-server: the file extensions it answers for
 *   run       analysis/lint: the command, from the code root; {files} or
 *             {files_comma} is replaced by the changed files it judges
 *   files     analysis/lint: globs of the files it judges
 *   source    project (the project configures it already) or added
 *   install   optional: how to install it, a hint for the next machine
 *   timeout   optional: seconds a run may take (default 300)
 *
 * Node builtins only: the target project often has no node_modules at all.
 */

const fs = require('fs');
const path = require('path');
const { parseYaml, dumpYaml } = require('./lib/yaml-subset.cjs');
const { ARTIFACT_DIR } = require('./lib/paths.cjs');
const env = require('./lib/tooling-env.cjs');
const { facts, isGitRepo } = require('./lib/tooling-facts.cjs');
const { runTools } = require('./lib/tooling-run.cjs');

const FILE = 'tooling.yaml';
const KINDS = ['language-server', 'analysis', 'lint'];
const STATUSES = ['configured', 'declined'];
const HEADER = [
    '# Code tooling of this repo for the AI-DLC Turbo agents: language servers, analysis, lint.',
    '# Written by tooling.cjs after the user chose; change it with the Turbo config command.',
    '# Committed with the repo, so it is asked once. Every machine still needs the tools: Turbo checks at each start.',
].join('\n');

function toolingPath(project) {
    return path.join(project, ARTIFACT_DIR, 'repo', FILE);
}

const list = (v) => [].concat(v === undefined || v === null ? [] : v).map(String).filter(Boolean);

/** The problems of one tooling object, [] when it is fine. */
function problems(data) {
    const out = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return ['the tooling must be one object'];
    if (!STATUSES.includes(data.status)) out.push(`status must be ${STATUSES.join(' or ')}`);
    const tools = data.tools === undefined || data.tools === null ? [] : data.tools;
    if (!Array.isArray(tools)) return [...out, 'tools must be a list'];
    if (data.status === 'declined' && tools.length > 0) out.push('a declined tooling has no tools');
    if (data.status === 'configured' && tools.length === 0) out.push('a configured tooling has at least one tool; none at all is status declined');
    const names = new Set();
    tools.forEach((t, i) => {
        const at = `tools[${i}]${t && t.name ? ` (${t.name})` : ''}`;
        if (!t || typeof t !== 'object') { out.push(`${at} must be an object`); return; }
        if (!t.name) out.push(`${at} has no name`);
        if (names.has(t.name)) out.push(`${at} is named twice`);
        names.add(t.name);
        if (!KINDS.includes(t.kind)) out.push(`${at} kind must be one of ${KINDS.join(', ')}`);
        if (t.kind === 'language-server' && !t.plugin) out.push(`${at} needs plugin: the Claude Code plugin, name@marketplace`);
        if (t.kind === 'language-server' && list(t.extensions).length === 0) out.push(`${at} needs extensions: the file types it answers for`);
        if ((t.kind === 'analysis' || t.kind === 'lint') && !t.run) out.push(`${at} needs run: the command the agents run`);
        if (list(t.needs).length === 0) out.push(`${at} needs needs: the programs it needs on the PATH`);
    });
    if (data.declined !== undefined && data.declined !== null && !Array.isArray(data.declined)) out.push('declined must be a list');
    return out;
}

function load(project) {
    const file = toolingPath(project);
    if (!fs.existsSync(file)) return { state: 'missing' };
    let data;
    try {
        data = parseYaml(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return { state: 'invalid', error: e.message };
    }
    const bad = problems(data);
    if (bad.length > 0) return { state: 'invalid', error: bad.join('; ') };
    return { state: data.status, data };
}

/** What this machine misses of one tool: null when nothing. */
function missingOf(tool, project, environment) {
    const programs = list(tool.needs).filter((p) => !env.onPath(p, environment));
    const pluginState = tool.kind === 'language-server' ? env.pluginState(tool.plugin, project, environment) : 'on';
    if (programs.length === 0 && pluginState === 'on') return null;
    const out = { name: tool.name, kind: tool.kind };
    if (programs.length > 0) out.programs = programs;
    if (pluginState !== 'on') { out.plugin = tool.plugin; out.plugin_state = pluginState; }
    if (tool.install) out.install = tool.install;
    return out;
}

function check(project, environment = process.env) {
    const loaded = load(project);
    if (loaded.state === 'missing') return { tooling: 'missing', path: path.relative(project, toolingPath(project)) };
    if (loaded.state === 'invalid') return { tooling: 'invalid', error: loaded.error };
    if (loaded.state === 'declined') return { tooling: 'declined' };
    const tools = loaded.data.tools;
    const missing = tools.map((t) => missingOf(t, project, environment)).filter(Boolean);
    const here = tools.filter((t) => !missing.some((m) => m.name === t.name));
    // The language servers this machine has: a phase starts them early, because a server loads
    // the project on its first request and a big repo makes that first request time out.
    const servers = here.filter((t) => t.kind === 'language-server').map((t) => ({ name: t.name, extensions: list(t.extensions) }));
    const extra = servers.length > 0 ? { language_servers: servers } : {};
    if (missing.length === 0) return { tooling: 'ok', tools: tools.map((t) => t.name), ...extra };
    return { tooling: 'incomplete', missing, ok: here.map((t) => t.name), ...extra };
}

const KEYS = ['name', 'kind', 'purpose', 'languages', 'extensions', 'plugin', 'needs', 'run', 'files', 'source', 'install', 'timeout'];

function clean(tool) {
    const out = {};
    for (const key of KEYS) {
        if (tool[key] === undefined || tool[key] === null || tool[key] === '') continue;
        out[key] = ['languages', 'extensions', 'needs', 'files'].includes(key) ? list(tool[key]) : tool[key];
    }
    return out;
}

function write(project, data, now = new Date()) {
    const bad = problems(data);
    if (bad.length > 0) return { written: false, errors: bad };
    const doc = {
        status: data.status,
        decided_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        tools: (data.tools || []).map(clean),
        declined: (data.declined || []).map((d) => (typeof d === 'string' ? { name: d } : { name: d.name, ...(d.reason ? { reason: d.reason } : {}) })).filter((d) => d.name),
    };
    const file = toolingPath(project);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = `${HEADER}\n${dumpYaml(doc)}`;
    fs.writeFileSync(file, text, 'utf8');
    return { written: true, path: path.relative(project, file), tooling: text };
}

const GIT_LINE = '- Git history, read-only: `git log -S\'<name>\' --oneline -- <path>` (when a name came or went), `git log -L<from>,<to>:<file>` (how these lines grew), `git blame -L<from>,<to> -- <file>`.';

/** The short text every Turbo subagent starts with: what it may use, and what this machine lacks. */
function brief(project, environment = process.env) {
    const loaded = load(project);
    const git = isGitRepo(project) ? [GIT_LINE] : [];
    const lines = ['## Code tooling', ''];
    if (loaded.state === 'missing' || loaded.state === 'invalid') {
        lines.push(`- Not set up for this project yet${loaded.state === 'invalid' ? ' (its tooling.yaml is broken)' : ''}: no language server, analysis or lint tool. Grep and read.`);
        return [...lines, ...git, ''].join('\n');
    }
    if (loaded.state === 'declined') {
        lines.push('- No language server, analysis or lint tool: this project chose none. Grep and read as before.');
        return [...lines, ...git, ''].join('\n');
    }
    const here = (t) => !missingOf(t, project, environment);
    const servers = loaded.data.tools.filter((t) => t.kind === 'language-server');
    const checks = loaded.data.tools.filter((t) => t.kind !== 'language-server');
    for (const t of servers) {
        const exts = list(t.extensions).join(' ');
        lines.push(here(t)
            ? `- Language server ${t.name} for ${exts}: the LSP tool answers for these files. Find existing code with it before you grep: \`workspaceSymbol\` with a name finds the definition, then \`findReferences\`, \`goToImplementation\`, \`incomingCalls\` or \`outgoingCalls\` on it. An error means the server is not up: grep instead, never retry in a loop.`
            : `- Language server ${t.name} for ${exts}: not installed on this machine. Grep and read instead.`);
    }
    for (const t of checks) {
        const files = list(t.files).join(' ') || 'every changed file';
        lines.push(here(t)
            ? `- ${t.kind === 'lint' ? 'Lint' : 'Analysis'} ${t.name} (${files}): \`${t.run}\`${t.purpose ? `. ${t.purpose}` : ''}`
            : `- ${t.kind === 'lint' ? 'Lint' : 'Analysis'} ${t.name}: not installed on this machine, skip it.`);
    }
    if (checks.some(here)) {
        lines.push(`- Run the analysis and lint tools on a change with \`node "${__filename}" run --project "${path.resolve(project)}" --code-root <code root>\` (add \`--base <ref>\` for a committed change). It runs them on the changed files and keeps only the findings on lines the change adds (\`touched\`): older findings are not the change's.`);
    }
    return [...lines, ...git, ''].join('\n');
}

function parseArgs(argv) {
    const opts = { command: argv[0], json: null, project: process.cwd(), codeRoot: null, base: 'HEAD', tool: null };
    for (let i = 1; i < argv.length; i++) {
        const arg = argv[i];
        const value = argv[i + 1];
        if (arg === '--project' && value) { opts.project = path.resolve(value); i += 1; }
        else if (arg === '--code-root' && value) { opts.codeRoot = path.resolve(value); i += 1; }
        else if (arg === '--base' && value) { opts.base = value; i += 1; }
        else if (arg === '--tool' && value) { opts.tool = value; i += 1; }
        else if (opts.json === null && !arg.startsWith('--')) opts.json = arg;
        else return { error: `unknown or incomplete argument: ${arg}` };
    }
    return opts;
}

const USAGE = "usage: tooling.cjs facts | check | write '<json>' | brief | run [--code-root <dir>] [--base <ref>] [--tool <name>]  [--project <dir>]";

function main(argv, environment = process.env) {
    const opts = parseArgs(argv);
    const out = (value) => process.stdout.write(typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
    if (opts.error) { out({ error: opts.error, usage: USAGE }); return 2; }
    switch (opts.command) {
        case 'facts': out(facts(opts.project, environment)); return 0;
        case 'check': out(check(opts.project, environment)); return 0;
        case 'brief': out(brief(opts.project, environment)); return 0;
        case 'write': {
            let data;
            try { data = JSON.parse(opts.json || ''); } catch (e) { out({ error: `the tooling must be JSON: ${e.message}` }); return 2; }
            const result = write(opts.project, data);
            out(result);
            return result.written ? 0 : 2;
        }
        case 'run': {
            const loaded = load(opts.project);
            if (loaded.state !== 'configured') { out({ results: [], note: `no tools to run: the tooling is ${loaded.state}` }); return 0; }
            const result = runTools(loaded.data, opts.codeRoot || opts.project, { base: opts.base, only: opts.tool, environment });
            out(result);
            return result.error ? 1 : 0;
        }
        default: out({ error: USAGE }); return 2;
    }
}

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

module.exports = { check, write, brief, load, problems, toolingPath, main };
