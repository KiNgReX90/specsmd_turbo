#!/usr/bin/env node
'use strict';

/**
 * specsmd AI-DLC Turbo - read and write a merge request's description.
 *
 * push-branch.cjs opens every merge request in the push itself, and a push
 * option carries one line. The construction agent then writes the full
 * reviewer description with the mr-description skill
 * (skills/construction/mr-description.md) and sends it through this script.
 * A later push leaves that description alone.
 *
 *   read   prints { ok, url, title, description, state } of the merge
 *          request. `state` is GitLab's: opened, merged, closed or locked.
 *          push-branch.cjs reads it to know whether a merge request is open.
 *   write  replaces the whole description with the file's text: a new
 *          description, or the missing sections of a hand-written one.
 *   patch  replaces the text of one `## {section}`, from the line after its
 *          heading up to the next `## ` heading, the state marker
 *          (`<!-- turbo-mr-desc ... -->`) or the end, with the file's text.
 *          Every other byte stays as it was: the other sections, the link
 *          lines at the top, and what a person added anywhere. A section the
 *          description lacks is added before the marker, or at the end.
 *          With `--line` and `--text` instead it replaces only the value
 *          after `**{line}:**` on one top line (Link to the world or
 *          Documentation). A missing one goes in at the top, Link to the
 *          world first, before the first `## ` heading.
 *          `--synced {sha}` sets only the `synced:` sha in the marker, and
 *          `--jira ok|pending|none` only its `jira:` field. The update flow
 *          uses patch, never write.
 *
 * write and patch read the live description first. When the new text equals
 * it (line endings and trailing whitespace aside), nothing is sent and they
 * print `written: false, unchanged: true`. They send the description only:
 * never the title, labels or assignees.
 *
 * GitLab only: the API address comes from the merge request link itself, so a
 * remote behind an SSH alias needs nothing extra. The key is the user's
 * GITLAB_TOKEN, looked up as the Atlassian keys are: the environment, then `.env` in
 * the project root, then ~/.claude/.env. It is sent only as a request header
 * and never printed.
 *
 * Prints one JSON object. Exit 0 on success, 1 when GitLab or the key failed,
 * 2 on a usage error.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/mr-describe.cjs read --url <merge request link>
 *   node .specsmd/aidlc-turbo/scripts/mr-describe.cjs write --url <merge request link> --body-file <file>
 *   node .specsmd/aidlc-turbo/scripts/mr-describe.cjs patch --url <merge request link> --section "<heading>" --body-file <file> [--synced <sha>] [--jira <state>]
 *   node .specsmd/aidlc-turbo/scripts/mr-describe.cjs patch --url <merge request link> --line "Link to the world" --text "<value>" [--jira <state>] [--synced <sha>]
 *
 * Node builtins only, plus ./confluence-attach.cjs for the key lookup and the
 * HTTP layer.
 */

const fs = require('fs');
const { envLookup, httpsTransport } = require('./confluence-attach.cjs');

const MR_PARTS = /^(https?:\/\/[^/\s]+)\/(.+?)\/-\/merge_requests\/(\d+)/;
const NO_TOKEN = 'no GITLAB_TOKEN in the environment, the project .env or ~/.claude/.env';
const USAGE = 'Usage: mr-describe.cjs read --url <merge request link>'
    + ' | write --url <merge request link> --body-file <file>'
    + ' | patch --url <merge request link> (--section "<heading>" --body-file <file> | --line "<top line>" --text "<value>")'
    + ' [--synced <sha>] [--jira ok|pending|none]';
const MARKER = /<!--\s*turbo-mr-desc\b.*?-->/;
const FENCE = /^\s*(```|~~~)/;
const H2 = /^##[ \t]+(.+?)[ \t]*$/;
const SHA = /^[0-9a-f]{7,64}$/i;
const TOP_LINES = ['Link to the world', 'Documentation'];
const JIRA = ['ok', 'pending', 'none'];
const PATCH_ONLY = ['section', 'line', 'text', 'synced', 'jira'];

/** { api, project, iid } of a GitLab merge request link, or null. Pure. */
function mrParts(url) {
    const match = String(url || '').match(MR_PARTS);
    return match ? { api: `${match[1]}/api/v4`, project: match[2], iid: match[3] } : null;
}

/** What patch needs on top of --url, or an error. Pure. */
function patchError(out) {
    if (out.section && out.line) return '--section and --line are exclusive in one call';
    if (!out.section && !out.line) return 'patch needs --section or --line';
    if (out.section && !out.bodyFile) return 'patch --section needs --body-file';
    if (out.section && out.text) return '--text goes with --line, not with --section';
    if (out.line && !out.text) return 'patch --line needs --text';
    if (out.line && out.bodyFile) return '--body-file goes with --section, not with --line';
    if (out.line && !TOP_LINES.some((l) => l.toLowerCase() === out.line.toLowerCase())) return `--line is one of: ${TOP_LINES.join(', ')}`;
    if (out.text && /[\r\n]/.test(out.text)) return '--text is one line';
    if (out.jira && !JIRA.includes(out.jira)) return `--jira is one of: ${JIRA.join(', ')}`;
    return null;
}

/** argv into { cmd, url, bodyFile, section, line, text, synced, jira }, or { error }. Pure. */
function parseArgs(argv) {
    const [cmd, ...rest] = argv;
    if (cmd === '--help' || cmd === '-h') return { help: true };
    if (!['read', 'write', 'patch'].includes(cmd)) return { error: `unknown command ${JSON.stringify(cmd || '')}` };
    const out = { cmd, url: null, bodyFile: null, section: null, line: null, text: null, synced: null, jira: null };
    const flags = {
        '--url': 'url', '--body-file': 'bodyFile', '--section': 'section', '--line': 'line', '--text': 'text', '--synced': 'synced', '--jira': 'jira',
    };
    for (let i = 0; i < rest.length; i += 1) {
        const key = flags[rest[i]];
        if (!key || (cmd !== 'patch' && PATCH_ONLY.includes(key))) return { error: `unknown flag ${rest[i]}` };
        out[key] = rest[i + 1] || null;
        i += 1;
    }
    if (!out.url) return { error: `${cmd} needs --url` };
    if (cmd === 'write' && !out.bodyFile) return { error: 'write needs --body-file' };
    const patch = cmd === 'patch' ? patchError(out) : null;
    if (patch) return { error: patch };
    if (out.line) out.line = TOP_LINES.find((l) => l.toLowerCase() === out.line.toLowerCase());
    if (out.synced && !SHA.test(out.synced)) return { error: `--synced is not a commit sha: ${out.synced}` };
    if (!mrParts(out.url)) return { error: `not a GitLab merge request link: ${out.url}` };
    return out;
}

/**
 * The lines of `text` with their offsets: `end` stops before the line ending.
 * A `## ` heading or the marker inside a code fence is no boundary. Pure.
 */
function outline(text) {
    const lines = [];
    let start = 0;
    let fenced = false;
    for (const raw of text.split('\n')) {
        const line = raw.replace(/\r$/, '');
        const fence = FENCE.test(line);
        const h2 = !fenced && !fence ? line.match(H2) : null;
        lines.push({ start, end: start + line.length, heading: h2 ? h2[1] : null, marker: !fenced && MARKER.test(line) });
        if (fence) fenced = !fenced;
        start += raw.length + 1;
    }
    return lines;
}

/**
 * `description` with the text of its `## {heading}` section replaced by
 * `body`, and with `synced` the marker's sha set. Returns { text } or
 * { error }. Every byte outside that section and that sha stays. Pure.
 */
function patchSection(description, heading, body, synced = null) {
    const text = String(description || '');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const name = String(heading || '').replace(/^#+\s*/, '').trim();
    const content = String(body || '').replace(/\r\n/g, '\n').replace(/^\s*\n/, '').trimEnd().split('\n').join(eol);
    if (!name) return { error: 'no section heading' };
    if (!content.trim()) return { error: 'the section text is empty' };
    const lines = outline(text);
    const at = lines.findIndex((l) => l.heading && l.heading.toLowerCase() === name.toLowerCase());
    let next;
    if (at >= 0) {
        const from = lines[at].end;
        const stop = lines.slice(at + 1).find((l) => l.heading || l.marker);
        const to = stop ? stop.start : text.length;
        const old = text.slice(from, to);
        const region = old.trim()
            ? (old.match(/^\s*\n/) || [eol])[0] + content + old.slice(old.trimEnd().length)
            : eol + eol + content + eol + (stop ? eol : '');
        next = text.slice(0, from) + region + text.slice(to);
    } else {
        const marker = lines.find((l) => l.marker);
        const pos = marker ? marker.start : text.length;
        const before = text.slice(0, pos);
        let gap = eol + eol;
        if (!before.trim() || before.endsWith(eol + eol)) gap = '';
        else if (before.endsWith(eol)) gap = eol;
        next = `${before}${gap}## ${name}${eol}${eol}${content}${eol}${marker ? eol : ''}${text.slice(pos)}`;
    }
    return setMarker(next, { synced });
}

/**
 * `description` with the value after `**{name}:**` on its top line replaced
 * by `value`. A missing line goes in at the top: Link to the world first, then
 * Documentation, before the first `## ` heading. Returns { text } or
 * { error }; every other byte stays. Pure.
 */
function patchLine(description, name, value) {
    const text = String(description || '');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const want = String(value || '').trim();
    if (!want || /[\r\n]/.test(want)) return { error: 'the line text is empty or more than one line' };
    const lines = outline(text);
    const stop = lines.findIndex((l) => l.heading || l.marker);
    const top = stop < 0 ? lines : lines.slice(0, stop);
    const label = (n) => `**${n}:**`;
    const find = (n) => top.find((l) => text.slice(l.start, l.end).toLowerCase().startsWith(label(n).toLowerCase()));
    const own = find(name);
    if (own) {
        const from = own.start + label(name).length;
        const rest = text.slice(from, own.end);
        const lead = rest.trim() ? rest.match(/^\s*/)[0] : ' ';
        const trail = rest.trim() ? rest.slice(rest.trimEnd().length) : '';
        return { text: text.slice(0, from) + lead + want + trail + text.slice(own.end) };
    }
    const added = `${label(name)} ${want}`;
    const link = name === 'Documentation' ? find('Link to the world') : null;
    if (link) return { text: text.slice(0, link.end) + eol + added + text.slice(link.end) };
    const first = top.length ? text.slice(top[0].start, top[0].end) : '';
    const adjacent = TOP_LINES.some((n) => first.toLowerCase().startsWith(label(n).toLowerCase()));
    let gap = eol + eol;
    if (!text.trim()) gap = eol;
    else if (adjacent) gap = eol;
    return { text: added + gap + text };
}

/** The marker with only its `synced:` sha and `jira:` field set as asked. Returns { text } or { error }. Pure. */
function setMarker(description, { synced = null, jira = null } = {}) {
    let text = String(description || '');
    if (!synced && !jira) return { text };
    const marker = outline(text).find((l) => l.marker);
    if (!marker) return { error: 'the description has no turbo-mr-desc marker to set --synced or --jira in' };
    let line = text.slice(marker.start, marker.end);
    if (synced) {
        line = /\bsynced:/.test(line)
            ? line.replace(/\bsynced:\S*?(?=\s|-->)/, `synced:${synced}`)
            : line.replace(/turbo-mr-desc\b/, `turbo-mr-desc synced:${synced}`);
    }
    if (jira) {
        line = /\bjira:/.test(line)
            ? line.replace(/\bjira:\S*?(?=\s|-->)/, `jira:${jira}`)
            : line.replace(/(\s*)-->/, ` jira:${jira}$1-->`);
    }
    text = text.slice(0, marker.start) + line + text.slice(marker.end);
    return { text };
}

/** The new description of patch: one section or one top line, then the marker. Pure. */
function patchDescription(live, args, body) {
    const base = args.line ? patchLine(live, args.line, body) : patchSection(live, args.section, body);
    return base.error ? base : setMarker(base.text, { synced: args.synced, jira: args.jira });
}

/** true when two descriptions read the same: line endings and trailing whitespace aside. Pure. */
const same = (a, b) => String(a || '').replace(/\r\n/g, '\n').trimEnd() === String(b || '').replace(/\r\n/g, '\n').trimEnd();

/** The merge request as GitLab answers it, or { error }. */
async function fetchRequest(transport, endpoint, token) {
    const res = await transport({ method: 'GET', url: endpoint, headers: { 'PRIVATE-TOKEN': token } });
    if (res.status < 200 || res.status >= 300) return { error: `GitLab answered HTTP ${res.status}` };
    return { mr: JSON.parse(String(res.body || '{}')) };
}

/** The command's result. Never throws: every failure becomes ok false. */
async function run(args, { lookup = envLookup(), transport = httpsTransport } = {}) {
    const token = lookup('GITLAB_TOKEN');
    if (!token) return { ok: false, url: args.url, detail: NO_TOKEN };
    const parts = mrParts(args.url);
    const endpoint = `${parts.api}/projects/${encodeURIComponent(parts.project)}/merge_requests/${parts.iid}`;
    const failed = (detail) => ({ ok: false, url: args.url, detail });
    try {
        let body = null;
        if (args.cmd !== 'read') body = args.line ? args.text : fs.readFileSync(args.bodyFile, 'utf8');
        const what = args.line ? 'line text' : `${args.cmd === 'patch' ? 'section' : 'description'} file`;
        if (body !== null && !body.trim()) return failed(`the ${what} is empty`);
        const got = await fetchRequest(transport, endpoint, token);
        if (got.error) return failed(got.error);
        const live = got.mr.description || '';
        if (args.cmd === 'read') {
            return { ok: true, url: args.url, title: got.mr.title || '', description: live, state: got.mr.state || null };
        }
        const next = args.cmd === 'patch' ? patchDescription(live, args, body) : { text: body };
        if (next.error) return failed(next.error);
        if (same(next.text, live)) return { ok: true, url: args.url, written: false, unchanged: true };
        const res = await transport({
            method: 'PUT',
            url: endpoint,
            headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify({ description: next.text })),
        });
        if (res.status < 200 || res.status >= 300) return failed(`GitLab answered HTTP ${res.status}`);
        return { ok: true, url: args.url, written: true };
    } catch (error) {
        return failed(String(error.message || error).split(token).join('***'));
    }
}

/** Prints one JSON object and resolves the exit code. `deps` is for tests. */
async function main(argv, deps = {}) {
    const print = deps.print || ((text) => process.stdout.write(`${text}\n`));
    const args = parseArgs(argv);
    if (args.help) { print(JSON.stringify({ ok: true, detail: USAGE })); return 0; }
    if (args.error) { print(JSON.stringify({ ok: false, detail: `${args.error}\n${USAGE}` })); return 2; }
    const result = await run(args, { lookup: deps.lookup || envLookup(), transport: deps.transport || httpsTransport });
    print(JSON.stringify(result));
    return result.ok ? 0 : 1;
}

module.exports = { mrParts, parseArgs, patchSection, patchLine, setMarker, run, main };

if (require.main === module) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
