#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - attach a file to a Jira issue, with a web link next
 * to it.
 *
 * Used after the approval: the approved overview goes onto the intent's epic,
 * and the link to its artifact (the same page, published by the host) becomes
 * a web link on that epic. The Atlassian MCP has no attachment tools, so this
 * calls the REST API with basic auth, like confluence-attach.cjs, whose HTTP
 * client and credential lookup it shares.
 *
 *   upload --issue KEY --file PATH [--name NAME] [--link URL] [--title TEXT]
 *                         attaches the file, then removes the older
 *                         attachments with the same name, so the issue holds
 *                         one copy and is never without one. Reads it back.
 *                         --link adds a web link titled --title (default
 *                         `Interactive overview`); running it again updates
 *                         that link instead of adding a second one.
 *
 * Credentials and site: as confluence-attach.cjs (ATLASSIAN_EMAIL,
 * ATLASSIAN_API_TOKEN, ATLASSIAN_SITE; environment, project .env, then
 * ~/.claude/.env). No default site: without ATLASSIAN_SITE the project's own
 * Jira or Confluence link names it, and without one nothing is called.
 *
 * Prints ONE JSON object with `ok` and `detail`. Exit 0 done and verified,
 * 1 failed (`detail` says why), 2 usage error.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/jira-attach.cjs upload --issue SHOP-100 --file PATH [--name NAME] [--link URL] [--title TEXT]
 *
 * Node builtins only, plus ./confluence-attach.cjs. The HTTP layer is one
 * function (`transport`) so tests run without a network.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NO_SITE, Client, safeName, envLookup, credentials, siteOf, projectRoot } = require('./confluence-attach.cjs');

const DEFAULT_TITLE = 'Interactive overview';
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/;
const NO_CREDENTIALS = 'no ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN available: set both in the environment, '
    + "in the project's .env (git-ignored) or in ~/.claude/.env";

const USAGE = 'usage: jira-attach.cjs upload --issue KEY --file PATH [--name NAME] [--link URL] [--title TEXT]';
const OPTIONS = ['issue', 'file', 'name', 'link', 'title'];
const REQUIRED = ['issue', 'file'];

/** A multipart body with one `file` part, plus its content type. */
function multipart(name, data) {
    const boundary = `----jira-attach-${crypto.randomUUID().replace(/-/g, '')}`;
    const ctype = path.extname(name).toLowerCase() === '.html' ? 'text/html' : 'application/octet-stream';
    const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from(`Content-Disposition: form-data; name="file"; filename="${name}"\r\n`),
        Buffer.from(`Content-Type: ${ctype}\r\n\r\n`),
        Buffer.from(data),
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { body, ctype: `multipart/form-data; boundary=${boundary}` };
}

/** The web link's body. The global id makes a second run update the link, not add one. Pure. */
function remoteLink(name, url, title) {
    return { globalId: `aidlc-turbo:${name}`, object: { url, title } };
}

/** The REST calls this script makes, on the shared client. */
class Jira {
    constructor(client, site) {
        this.client = client;
        this.base = `https://${site}/rest/api/3`;
    }

    issueUrl(key) {
        return `${this.base}/issue/${encodeURIComponent(key)}`;
    }

    /** The issue's attachments: id, file name and size. */
    async attachments(key) {
        const data = await this.client.json(`${this.issueUrl(key)}?fields=attachment`);
        return ((data && data.fields && data.fields.attachment) || [])
            .map((a) => ({ id: String(a.id), name: a.filename ?? null, size: parseInt(a.size || 0, 10) || 0 }));
    }

    async attach(key, name, data) {
        const { body, ctype } = multipart(name, data);
        await this.client.call(`${this.issueUrl(key)}/attachments`, 'POST', body, ctype);
    }

    async remove(id) {
        await this.client.call(`${this.base}/attachment/${encodeURIComponent(id)}`, 'DELETE');
    }

    async link(key, body) {
        await this.client.call(`${this.issueUrl(key)}/remotelink`, 'POST', Buffer.from(JSON.stringify(body)), 'application/json');
    }
}

/** A short reason for a failed call. */
function why(error) {
    return String((error && error.message) || error).slice(0, 200);
}

async function upload(jira, { issue, file, name, link, title }) {
    const data = fs.readFileSync(file);
    if (!data.length) return { ok: false, detail: `${file} is empty` };
    const before = (await jira.attachments(issue)).filter((a) => a.name === name);
    await jira.attach(issue, name, data);
    const fresh = (await jira.attachments(issue)).find((a) => a.name === name && !before.some((b) => b.id === a.id));
    if (!fresh || fresh.size <= 0) return { ok: false, detail: `${name} is not on ${issue} after the upload` };
    const row = { issue, id: fresh.id, name, size: fresh.size };
    try {
        for (const old of before) await jira.remove(old.id);
    } catch (error) {
        return { ok: false, detail: `uploaded, but an older ${name} is still there (${why(error)})`, ...row };
    }
    if (!link) return { ok: true, detail: 'uploaded', ...row, link: null };
    try {
        await jira.link(issue, remoteLink(name, link, title || DEFAULT_TITLE));
    } catch (error) {
        return { ok: false, detail: `uploaded, but the link was not added (${why(error)})`, ...row, link: null };
    }
    return { ok: true, detail: 'uploaded, link added', ...row, link };
}

/** argv into { cmd, issue, file, name, link, title }, or { error } on a usage error. Pure. */
function parseArgs(argv) {
    const [cmd, ...rest] = argv;
    if (cmd === '--help' || cmd === '-h') return { help: true };
    if (cmd !== 'upload') return { error: cmd ? `unknown command ${JSON.stringify(cmd)}` : 'no command given' };
    const out = { cmd };
    for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        if (arg === '--help' || arg === '-h') return { help: true };
        if (!arg.startsWith('--')) return { error: `unexpected argument ${JSON.stringify(arg)}` };
        const eq = arg.indexOf('=');
        const key = arg.slice(2, eq === -1 ? undefined : eq);
        if (!OPTIONS.includes(key)) return { error: `upload takes no --${key}` };
        let value = arg.slice(eq + 1);
        if (eq === -1) {
            value = rest[i + 1];
            i += 1;
        }
        if (!value || value.startsWith('--')) return { error: `--${key} needs a value` };
        out[key] = value;
    }
    const missing = REQUIRED.filter((k) => !out[k]);
    if (missing.length) return { error: `upload needs ${missing.map((k) => `--${k}`).join(' and ')}` };
    if (!ISSUE_KEY.test(out.issue)) return { error: `--issue ${JSON.stringify(out.issue)} is not an issue key` };
    if (out.link && !/^https:\/\/\S+$/.test(out.link)) return { error: '--link needs an https URL' };
    if (out.title && !out.link) return { error: '--title needs --link' };
    out.name = out.name || path.basename(out.file);
    return out;
}

/** The command's result object. Never throws: every failure becomes ok false. */
async function run(args, { lookup = envLookup(), transport, root } = {}) {
    if (!safeName(args.name)) return { ok: false, detail: `refused attachment name ${JSON.stringify(args.name)}` };
    const creds = credentials(lookup);
    if (!creds) return { ok: false, detail: NO_CREDENTIALS };
    const site = siteOf(lookup, root);
    if (!site) return { ok: false, detail: NO_SITE };
    try {
        return await upload(new Jira(new Client(creds, site, transport), site), args);
    } catch (error) {
        return { ok: false, detail: why(error) };
    }
}

/** Prints one JSON object and resolves the exit code. `deps` is for tests. */
async function main(argv, deps = {}) {
    const print = deps.print || ((text) => process.stdout.write(`${text}\n`));
    const args = parseArgs(argv);
    if (args.help) { print(JSON.stringify({ ok: true, detail: USAGE })); return 0; }
    if (args.error) { print(JSON.stringify({ ok: false, detail: `${args.error}\n${USAGE}` })); return 2; }
    const result = await run(args, { lookup: deps.lookup || envLookup(deps), transport: deps.transport, root: projectRoot(deps) });
    print(JSON.stringify(result));
    return result.ok ? 0 : 1;
}

if (require.main === module) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { multipart, remoteLink, Jira, upload, parseArgs, run, main };
