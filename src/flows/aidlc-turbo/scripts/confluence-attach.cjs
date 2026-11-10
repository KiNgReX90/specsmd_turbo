#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - attach a file to a Confluence page.
 *
 * Used for the intent overview on the intent's documentation page (the page
 * named by `sync.page_names.intent` of .specs-aidlc-turbo/repo/config.yaml,
 * default `{name} - Documentation`, lib/page-names.cjs): after the approval
 * the inception attaches the intent's own overview page (`overview.html`) as
 * `sync.page_names.overview_file`, default `overview-{intent-slug}.html`. The
 * Atlassian MCP has no attachment tools, so this calls the REST API with
 * basic auth.
 *
 *   check --page ID                        reads the page's attachment list
 *                                          only: proves the credentials reach
 *                                          the page before anything is made.
 *   upload --page ID --file PATH [--name NAME] [--if-missing]
 *                                          creates the attachment, or adds a
 *                                          new version when the page already
 *                                          has one with that name (one PUT,
 *                                          never retried), then reads it back.
 *                                          Then splices the links, as `links`.
 *                                          --if-missing: a page that already
 *                                          has the name gets nothing at all.
 *   links --page ID                        keeps the overview section
 *                                          (`sync.page_names.overview_section`,
 *                                          default `Interactive overview`) at
 *                                          the top of the page body: a link
 *                                          per .html attachment
 *                                          (lib/overview-section.cjs). The rest
 *                                          of the body stays byte for byte, and
 *                                          an identical section writes nothing.
 *                                          Confluence hides the attachments of
 *                                          a page behind a menu, so the body is
 *                                          how people find them.
 *
 * upload and links take --intent SLUG [--root DIR] instead of --page: the
 * page comes from the inception's sync.yaml through intent-pages.cjs, the
 * intent's own page, or the inception's page for an inception of one intent.
 * The shared page of an inception with several intents is refused before any
 * call, and the result names the `page` it used. upload --intent without
 * --name names the file by `sync.page_names.overview_file`.
 *
 * Credentials, per key, the first non-empty value wins: the environment, then
 * `.env` in the project root (CLAUDE_PROJECT_DIR, else the working directory),
 * then ~/.claude/.env (KEY=value lines; `export `, quotes and comment lines
 * handled). ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN are needed. There is no
 * default site: ATLASSIAN_SITE names it, else the host of the first link the
 * project gave (siteFromLinks), and without either nothing is called and the
 * result says so.
 *
 * Prints ONE JSON object with `ok` and `detail`. Exit 0 done and verified,
 * 1 failed (`detail` says why), 2 usage error.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs check --page ID
 *   node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs upload --page ID --file PATH [--name NAME] [--if-missing]
 *   node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs upload --intent SLUG --file PATH [--name NAME] [--if-missing] [--root DIR]
 *   node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs links --page ID | --intent SLUG [--root DIR]
 *
 * Node builtins only, plus ./lib/overview-section.cjs, ./lib/paths.cjs,
 * ./lib/page-names.cjs, and ./intent-pages.cjs for --intent: the target
 * project often has no node_modules at all. The HTTP layer is one function
 * (`transport`) so tests run without a network.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { section, splice, ordered } = require('./lib/overview-section.cjs');
const paths = require('./lib/paths.cjs');
const pageNamesLib = require('./lib/page-names.cjs');

const HTTP_TIMEOUT_MS = 60000;
const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const NO_CREDENTIALS = 'no ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN available: set both in the environment, '
    + "in the project's .env (git-ignored) or in ~/.claude/.env";
const NO_SITE = 'no Atlassian site known: give the Jira board link (sync.jira_project_url in '
    + '.specs-aidlc-turbo/repo/config.yaml) or the Confluence page link, or set ATLASSIAN_SITE '
    + 'to the host of your Atlassian site';

const MIME = {
    '.html': 'text/html', '.htm': 'text/html', '.json': 'application/json', '.txt': 'text/plain',
    '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf',
};

const USAGE = [
    'usage: confluence-attach.cjs check --page ID',
    '       confluence-attach.cjs upload --page ID | --intent SLUG [--root DIR] --file PATH [--name NAME] [--if-missing]',
    '       confluence-attach.cjs links --page ID | --intent SLUG [--root DIR]',
].join('\n');

/** `target`: the page is --page or --intent (with --root), exactly one of them. */
const COMMANDS = {
    check: { required: ['page'], optional: [] },
    upload: { required: ['file'], optional: ['name', 'page', 'intent', 'root'], flags: ['if-missing'], target: true },
    links: { required: [], optional: ['page', 'intent', 'root'], target: true },
};

/** A non-2xx answer from Confluence. */
class HttpError extends Error {
    constructor(status) {
        super(`HTTP ${status}`);
        this.status = status;
    }
}

/** A multipart body with one `file` part and `minorEdit=true`, plus its content type. */
function multipart(name, data) {
    const boundary = `----confluence-attach-${crypto.randomUUID().replace(/-/g, '')}`;
    const ctype = MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
    const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from(`Content-Disposition: form-data; name="file"; filename="${name}"\r\n`),
        Buffer.from(`Content-Type: ${ctype}\r\n\r\n`),
        Buffer.from(data),
        Buffer.from(`\r\n--${boundary}\r\n`),
        Buffer.from('Content-Disposition: form-data; name="minorEdit"\r\n\r\ntrue'),
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return { body, ctype: `multipart/form-data; boundary=${boundary}` };
}

/** True when the name is a plain file name: no folder part, never '.' or '..'. */
function safeName(name) {
    return Boolean(name) && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\');
}

/** What the caller reports about one attachment from a listing. Pure. */
function attachmentRow(att) {
    return {
        id: att.id ?? null,
        name: att.title ?? null,
        size: parseInt((att.extensions || {}).fileSize || 0, 10) || 0,
        version: (att.version || {}).number ?? null,
    };
}

/** The real HTTP layer: one request, no redirects followed. Resolves { status, headers, body }. */
function httpsTransport({ method, url, headers, body }) {
    return new Promise((resolve, reject) => {
        const sent = body ? { ...headers, 'Content-Length': body.length } : headers;
        const req = https.request(url, { method, headers: sent, timeout: HTTP_TIMEOUT_MS }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
            res.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error(`no answer from ${new URL(url).host} in ${HTTP_TIMEOUT_MS / 1000}s`)));
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

/** The REST calls this script makes. `transport` is the test seam. */
class Client {
    constructor(creds, site, transport = httpsTransport) {
        this.auth = `Basic ${Buffer.from(`${creds[0]}:${creds[1]}`).toString('base64')}`;
        this.site = site;
        this.base = `https://${site}/wiki`;
        this.transport = transport;
    }

    /** One call; a GET follows redirects, without the credentials once it leaves the site. */
    async call(url, method = 'GET', data = null, ctype = '') {
        let headers = { Authorization: this.auth, Accept: 'application/json' };
        if (data !== null) headers = { ...headers, 'X-Atlassian-Token': 'no-check', 'Content-Type': ctype };
        let target = url;
        for (let hop = 0; ; hop += 1) {
            const res = await this.transport({ method, url: target, headers, body: data });
            const location = (res.headers || {}).location;
            if (method === 'GET' && REDIRECTS.has(res.status) && location && hop < MAX_REDIRECTS) {
                const next = new URL(location, target);
                if (next.host !== new URL(target).host) {
                    headers = { ...headers };
                    delete headers.Authorization;
                }
                target = next.href;
                continue;
            }
            if (res.status < 200 || res.status >= 300) throw new HttpError(res.status);
            return Buffer.from(res.body || '');
        }
    }

    async json(url) {
        return JSON.parse((await this.call(url)).toString('utf8') || '{}');
    }

    async listing(page, name = null) {
        const query = new URLSearchParams({ limit: '200', expand: 'version' });
        if (name) query.set('filename', name);
        const data = await this.json(`${this.base}/rest/api/content/${encodeURIComponent(page)}/child/attachment?${query}`);
        return (data && data.results) || [];
    }

    async put(page, name, data) {
        const { body, ctype } = multipart(name, data);
        await this.call(`${this.base}/rest/api/content/${encodeURIComponent(page)}/child/attachment`, 'PUT', body, ctype);
    }

    /** The page with its title, its version and its body in storage format. */
    async page(page) {
        return (await this.json(`${this.base}/rest/api/content/${encodeURIComponent(page)}?expand=body.storage,version`)) || {};
    }

    async writeBody(page, title, version, body) {
        const data = Buffer.from(JSON.stringify({
            id: page, type: 'page', title,
            version: { number: version, minorEdit: true },
            body: { storage: { value: body, representation: 'storage' } },
        }));
        await this.call(`${this.base}/rest/api/content/${encodeURIComponent(page)}`, 'PUT', data, 'application/json');
    }
}

/** A short reason for a failed call. */
function why(error) {
    return String((error && error.message) || error).slice(0, 200);
}

/**
 * The options lib/overview-section.cjs takes from the project's page names:
 * the section's heading and the name an intent's overview page is attached by.
 */
function sectionOptions(names = pageNamesLib.DEFAULTS) {
    return { heading: names.overview_section, overviewFile: names.overview_file };
}

/**
 * Splice the overview section into the live body, from the page's current
 * attachments. Resolves the names it links and whether it wrote: an identical
 * section writes nothing. A page that comes back without its body is never
 * written, so nothing of it can be lost. `names` are the project's page names.
 */
async function linkAttachments(client, page, names = pageNamesLib.DEFAULTS) {
    const info = await client.page(page);
    const body = ((info.body || {}).storage || {}).value;
    if (typeof body !== 'string') throw new Error(`page ${page} came back without its body, nothing written`);
    const files = (await client.listing(page)).map((a) => a.title);
    const options = sectionOptions(names);
    const next = splice(body, section(client.site, page, files, options), options);
    if (next !== null) {
        const version = (parseInt((info.version || {}).number || 0, 10) || 0) + 1;
        await client.writeBody(page, info.title || '', version, next);
    }
    return { attachments: ordered(files, sectionOptions(names)), wrote: next !== null };
}

async function links(client, page, { names } = {}) {
    const { attachments, wrote } = await linkAttachments(client, page, names);
    return { ok: true, detail: wrote ? 'page links updated' : 'page links already up to date', attachments };
}

async function check(client, page) {
    const names = (await client.listing(page)).map((a) => a.title ?? null);
    return { ok: true, detail: `page ${page} reachable`, attachments: names };
}

async function upload(client, page, file, name, { ifMissing = false, names } = {}) {
    const data = fs.readFileSync(file);
    if (!data.length) return { ok: false, detail: `${file} is empty` };
    if (ifMissing) {
        const there = (await client.listing(page, name)).find((a) => a.title === name);
        if (there) return { ok: true, detail: 'already on the page, not uploaded', ...attachmentRow(there) };
    }
    await client.put(page, name, data);
    const found = (await client.listing(page, name)).find((a) => a.title === name);
    if (!found || attachmentRow(found).size <= 0) {
        return { ok: false, detail: `${name} is not on page ${page} after the upload` };
    }
    const row = attachmentRow(found);
    let wrote;
    try {
        ({ wrote } = await linkAttachments(client, page, names));
    } catch (error) {
        return { ok: false, detail: `uploaded, but the links on the page were not updated (${why(error)})`, ...row };
    }
    return { ok: true, detail: `uploaded, page links ${wrote ? 'updated' : 'already up to date'}`, ...row };
}

/**
 * KEY=value lines of a dotenv file: blanks and
 * comment lines skipped, `export ` dropped, then every `"` and after that every
 * `'` stripped from both ends of the value. Pure.
 */
function parseEnvFile(text) {
    const values = {};
    for (const raw of String(text).split(/\r?\n/)) {
        let line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        if (line.startsWith('export ')) line = line.slice('export '.length).trim();
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '');
    }
    return values;
}

function readEnvFile(file) {
    try { return parseEnvFile(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

/** The project root: CLAUDE_PROJECT_DIR, else the working directory. */
function projectRoot({ env = process.env, cwd = process.cwd() } = {}) {
    return path.resolve(env.CLAUDE_PROJECT_DIR || cwd);
}

/**
 * Where a setting comes from, per key: the environment, then `.env` in the
 * project root, then ~/.claude/.env. The first non-empty value wins. Never
 * throws.
 */
function envLookup({ env = process.env, home = os.homedir(), cwd = process.cwd() } = {}) {
    const sources = [
        env,
        readEnvFile(path.join(projectRoot({ env, cwd }), '.env')),
        readEnvFile(path.join(home, '.claude', '.env')),
    ];
    return (key) => sources.map((s) => s[key]).find((v) => v) || null;
}

/**
 * The Atlassian site the project's own links name: the host of the first
 * https link in project/project.yaml (jira_project_url, project_docs_url), in
 * the config's sync.jira_project_url, then in a `url:` of an inception's
 * sync.yaml (its Confluence pages), in block or flow style. `root` is the project root, or, with
 * `artifacts` true, the artifact root itself. null when none names one. Never
 * throws.
 */
function siteFromLinks(root, { artifacts = false } = {}) {
    const L = paths.layout(artifacts ? root : path.join(root, paths.ARTIFACT_DIR));
    const files = [L.projectYaml, L.config, ...paths.listInceptions(L.root).map((i) => L.inception(i).sync)];
    for (const file of files) {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        for (const m of text.matchAll(/(?:^|[\s{,])(?:jira_project_url|project_docs_url|url):\s*["']?(https:\/\/[^\s"',}]+)/gm)) {
            try { return new URL(m[1]).host; } catch { /* not a link */ }
        }
    }
    return null;
}

/**
 * The site: ATLASSIAN_SITE, else the links under the artifact root `artifacts`
 * (--root, when given), else the project's links under `root` (when given),
 * else null.
 */
function siteOf(lookup, root, artifacts) {
    return lookup('ATLASSIAN_SITE')
        || (artifacts ? siteFromLinks(artifacts, { artifacts: true }) : null)
        || (root ? siteFromLinks(root) : null);
}

/** [email, token], or null when either is missing. */
function credentials(lookup) {
    const email = lookup('ATLASSIAN_EMAIL');
    const token = lookup('ATLASSIAN_API_TOKEN');
    return email && token ? [email, token] : null;
}

/** argv into { cmd, page or intent and root, file, name, 'if-missing' }, or { error } on a usage error. Pure. */
function parseArgs(argv) {
    const [cmd, ...rest] = argv;
    if (cmd === '--help' || cmd === '-h') return { help: true };
    const spec = COMMANDS[cmd];
    if (!spec) return { error: cmd ? `unknown command ${JSON.stringify(cmd)}` : 'no command given' };
    const flags = spec.flags || [];
    const allowed = [...spec.required, ...spec.optional, ...flags];
    const out = { cmd };
    for (let i = 0; i < rest.length; i += 1) {
        const arg = rest[i];
        if (arg === '--help' || arg === '-h') return { help: true };
        if (!arg.startsWith('--')) return { error: `unexpected argument ${JSON.stringify(arg)}` };
        const eq = arg.indexOf('=');
        const key = arg.slice(2, eq === -1 ? undefined : eq);
        if (!allowed.includes(key)) return { error: `${cmd} takes no --${key}` };
        if (flags.includes(key)) {
            if (eq !== -1) return { error: `--${key} takes no value` };
            out[key] = true;
            continue;
        }
        let value = arg.slice(eq + 1);
        if (eq === -1) {
            value = rest[i + 1];
            i += 1;
        }
        if (!value || value.startsWith('--')) return { error: `--${key} needs a value` };
        out[key] = value;
    }
    const missing = spec.required.filter((k) => !out[k]);
    if (missing.length) return { error: `${cmd} needs ${missing.map((k) => `--${k}`).join(' and ')}` };
    if (spec.target && Boolean(out.page) === Boolean(out.intent)) return { error: `${cmd} needs --page or --intent${out.page ? ', not both' : ''}` };
    if (spec.target && out.root && !out.intent) return { error: `${cmd} takes --root only with --intent` };
    return out;
}

/**
 * The command's result object. Never throws: every failure becomes ok false.
 * `root` is the project root: its artifact root (or --root) gives the page
 * names, and its links name the site when ATLASSIAN_SITE does not.
 */
async function run(args, { lookup = envLookup(), transport, root } = {}) {
    const artifacts = args.root || (root ? path.join(root, paths.ARTIFACT_DIR) : paths.ARTIFACT_DIR);
    const names = pageNamesLib.pageNames(artifacts);
    let page = args.page;
    if (args.intent) {
        const target = require('./intent-pages.cjs').pageOf(artifacts, args.intent);
        if (!target.ok) return { ok: false, detail: target.detail };
        page = target.page_id;
    }
    const named = (result) => (args.intent ? { ...result, page } : result);
    const creds = credentials(lookup);
    if (!creds) return { ok: false, detail: NO_CREDENTIALS };
    const site = siteOf(lookup, root, args.root);
    if (!site) return { ok: false, detail: NO_SITE };
    const client = new Client(creds, site, transport);
    try {
        if (args.cmd === 'check') return await check(client, page);
        if (args.cmd === 'links') return named(await links(client, page, { names }));
        const name = args.name || (args.intent ? pageNamesLib.fill(names.overview_file, { slug: args.intent }) : path.basename(args.file));
        if (!safeName(name)) return { ok: false, detail: `refused attachment name ${JSON.stringify(name)}` };
        return named(await upload(client, page, args.file, name, { ifMissing: Boolean(args['if-missing']), names }));
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

module.exports = {
    NO_SITE,
    HttpError,
    Client,
    multipart,
    safeName,
    attachmentRow,
    section,
    splice,
    parseEnvFile,
    projectRoot,
    envLookup,
    siteFromLinks,
    siteOf,
    httpsTransport,
    credentials,
    parseArgs,
    check,
    upload,
    links,
    sectionOptions,
    run,
    main,
};
