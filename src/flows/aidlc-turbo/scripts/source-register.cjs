#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - source register.
 *
 * Keeps docs/{inception}/register.yaml: every statement the docs-reader found
 * in the pulled pages, numbered S-001, S-002, ... Spec-lint checks that every
 * current statement is cited by a requirement or a story, or sits in the
 * record's `deliberately_not` with a reason.
 *
 *   --status             which pages need reading: new, or a version the
 *                        register has not read. Unchanged pages are "skip".
 *   --merge <file|dir>   merge docs-reader candidates (one file per page, or a
 *                        folder of them) into the register.
 *
 * Ids are stable across runs. A statement's key is its page id plus a hash of
 * the quote with its whitespace normalised; the same key keeps the same id.
 * When a page is merged again, its statements that did not come back turn
 * `stale`; one that comes back later keeps its id and is `current` again.
 * Statements of a page that is no longer synced turn stale too. Ids are never
 * reused.
 *
 * Pages come from sync.yaml (`confluence.pages`: path, page_id, title,
 * version; paths relative to the artifact root), the inception's and the
 * project's. A file under docs/{inception}/pages/ without a sync row counts as
 * a page with id `file-{path}` and the hash of its text as version. A project
 * page whose digest (project/digests/{page-id}.yaml) has the same version is
 * "skip" too. Every `file` printed is relative to the project root.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/source-register.cjs <inception> --status [--json] [--root .specs-aidlc-turbo]
 *   node .specsmd/aidlc-turbo/scripts/source-register.cjs <inception> --merge <file|dir> [--json] [--root .specs-aidlc-turbo]
 *
 * Exit 0 ok, 1 failure, 2 usage error.
 *
 * Node builtins only, plus ./lib/yaml-subset.cjs (the shared YAML reader and
 * writer) and ./lib/paths.cjs: the target project often has no node_modules.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('./lib/paths.cjs');
const { parseYaml, dumpYaml } = require('./lib/yaml-subset.cjs');

const KINDS = ['requirement', 'rule', 'decision', 'question', 'example'];

const normaliseQuote = (quote) => String(quote).replace(/\s+/g, ' ').trim();
const quoteKey = (pageId, quote) => `${pageId}:${crypto.createHash('sha256').update(normaliseQuote(quote)).digest('hex').slice(0, 12)}`;
const idNumber = (id) => Number((/^S-(\d+)$/.exec(String(id)) || [0, 0])[1]);
const formatId = (n) => `S-${String(n).padStart(3, '0')}`;
const sameVersion = (a, b) => a !== null && a !== undefined && String(a) === String(b);

function readYamlFile(file) {
    try {
        return parseYaml(fs.readFileSync(file, 'utf8')) || {};
    } catch (error) {
        throw new Error(`${file}: ${error.message}`);
    }
}

/** The register on disk, or an empty one. */
function readRegister(file) {
    if (!fs.existsSync(file)) return { pages: {}, items: [] };
    const data = readYamlFile(file);
    return {
        pages: data.pages && typeof data.pages === 'object' ? data.pages : {},
        items: Array.isArray(data.items) ? data.items : [],
    };
}

function writeRegister(file, register) {
    const pages = Object.fromEntries(Object.keys(register.pages).sort().map((id) => [id, register.pages[id]]));
    const items = register.items.slice().sort((a, b) => idNumber(a.id) - idNumber(b.id));
    const header = '# Source register, written by source-register.cjs. Never edit by hand.\n';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, header + dumpYaml({ pages, items }));
}

function walk(dir, base = dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((d) => {
        const full = path.join(dir, d.name);
        if (d.isDirectory()) return walk(full, base);
        return d.name.endsWith('.md') ? [path.relative(base, full)] : [];
    });
}

const slash = (p) => p.split(path.sep).join('/');

/** Every page of one inception, with the version it has now. */
function listPages(root, inception) {
    const inc = paths.layout(root).inception(inception);
    const pages = [];
    const covered = new Set();
    if (fs.existsSync(inc.sync)) {
        const sync = readYamlFile(inc.sync);
        const rows = (sync && sync.confluence && Array.isArray(sync.confluence.pages)) ? sync.confluence.pages : [];
        for (const row of rows) {
            if (!row || row.page_id === undefined || row.page_id === null) continue;
            const rel = row.path ? String(row.path) : null;
            if (rel) covered.add(path.resolve(root, rel));
            pages.push({
                id: String(row.page_id),
                title: row.title ? String(row.title) : (rel ? path.basename(rel, '.md') : String(row.page_id)),
                version: row.version === undefined ? null : row.version,
                file: rel ? slash(path.join(root, rel)) : null,
                scope: rel && rel.startsWith('project/') ? 'project' : 'inception',
            });
        }
    }
    for (const rel of walk(inc.pages)) {
        const full = path.join(inc.pages, rel);
        if (covered.has(path.resolve(full))) continue;
        pages.push({
            id: `file-${slash(rel).replace(/\.md$/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}`,
            title: path.basename(rel, '.md'),
            version: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 12),
            file: slash(full),
            scope: 'inception',
        });
    }
    return pages;
}

/** Page id to digest version, from project/digests/{page-id}.yaml. */
function digestVersions(root) {
    const dir = paths.layout(root).digests;
    const out = new Map();
    if (!fs.existsSync(dir)) return out;
    for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
        try {
            const d = parseYaml(fs.readFileSync(path.join(dir, f), 'utf8')) || {};
            if (d.source && d.source.page !== undefined) out.set(String(d.source.page), d.source.version);
        } catch {
            // An unreadable digest is simply not reused.
        }
    }
    return out;
}

/** Per page: read (new or changed) or skip; plus the register pages that are gone. */
function pageStatus(register, pages, digests = new Map()) {
    const rows = pages.map((p) => {
        const known = register.pages[p.id];
        if (p.scope === 'project' && digests.has(p.id) && sameVersion(digests.get(p.id), p.version)) {
            return { ...p, read_version: digests.get(p.id), action: 'skip', reason: 'digest' };
        }
        if (!known) return { ...p, read_version: null, action: 'read', reason: 'new' };
        if (!sameVersion(known.read_version, p.version)) return { ...p, read_version: known.read_version, action: 'read', reason: 'changed' };
        return { ...p, read_version: known.read_version, action: 'skip', reason: 'unchanged' };
    });
    // With no pages at all nothing was synced; that says nothing about the register.
    const current = new Set(pages.map((p) => p.id));
    const gone = pages.length ? Object.keys(register.pages).sort().filter((id) => !current.has(id)).map((id) => ({ id, ...register.pages[id], action: 'gone' })) : [];
    return { pages: rows, gone };
}

/** Check one candidates file; returns a list of problems. */
function candidateProblems(c) {
    const problems = [];
    if (!c || typeof c !== 'object') return ['not a YAML map'];
    const page = c.page || {};
    if (page.id === undefined || page.id === null || String(page.id).trim() === '') problems.push('page.id is missing');
    if (page.version === undefined || page.version === null || String(page.version).trim() === '') problems.push('page.version is missing');
    if (!Array.isArray(c.statements)) problems.push('statements must be a list (empty when the page states nothing)');
    else {
        c.statements.forEach((s, i) => {
            if (!s || typeof s !== 'object' || !normaliseQuote(s.quote || '')) problems.push(`statements[${i}].quote is missing`);
            else if (!KINDS.includes(String(s.kind))) problems.push(`statements[${i}].kind must be one of ${KINDS.join(', ')}`);
        });
    }
    return problems;
}

/**
 * Merge one page's candidates into the register, in place. Returns what
 * happened: new ids, kept ids, ids that came back, ids that went stale.
 */
function mergeCandidates(register, candidates) {
    const page = candidates.page;
    const pageId = String(page.id);
    const version = page.version;
    const stats = { page: pageId, version, added: [], kept: [], revived: [], stale: [] };
    const byKey = new Map(register.items.map((it) => [String(it.key), it]));
    let next = register.items.reduce((m, it) => Math.max(m, idNumber(it.id)), 0) + 1;
    const seen = new Set();
    for (const s of candidates.statements) {
        const quote = normaliseQuote(s.quote);
        const key = quoteKey(pageId, quote);
        if (seen.has(key)) continue;
        seen.add(key);
        const line = s.line === undefined ? null : s.line;
        const existing = byKey.get(key);
        if (existing) {
            (existing.status === 'stale' ? stats.revived : stats.kept).push(existing.id);
            Object.assign(existing, { page: pageId, version, line, kind: String(s.kind), quote, key, status: 'current' });
            continue;
        }
        const item = { id: formatId(next), page: pageId, version, line, kind: String(s.kind), quote, key, status: 'current' };
        next += 1;
        register.items.push(item);
        stats.added.push(item.id);
    }
    for (const it of register.items) {
        if (String(it.page) === pageId && !seen.has(String(it.key)) && it.status !== 'stale') {
            it.status = 'stale';
            stats.stale.push(it.id);
        }
    }
    const known = register.pages[pageId] || {};
    register.pages[pageId] = {
        title: page.title !== undefined && page.title !== null ? String(page.title) : (known.title || pageId),
        version,
        file: page.file !== undefined && page.file !== null ? String(page.file) : (known.file || null),
        read_version: version,
    };
    return stats;
}

/** Statements of pages that are no longer synced turn stale. */
function staleGone(register, pages) {
    if (!pages.length) return [];
    const current = new Set(pages.map((p) => p.id));
    const out = [];
    for (const it of register.items) {
        if (!current.has(String(it.page)) && it.status !== 'stale') {
            it.status = 'stale';
            out.push(it.id);
        }
    }
    return out;
}

function candidateFiles(target) {
    if (!fs.existsSync(target)) throw new Error(`${target}: not found`);
    if (fs.statSync(target).isDirectory()) {
        return fs.readdirSync(target).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => path.join(target, f));
    }
    return [target];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
    'Usage:',
    '  node .specsmd/aidlc-turbo/scripts/source-register.cjs <inception> --status [--json] [--root .specs-aidlc-turbo]',
    '  node .specsmd/aidlc-turbo/scripts/source-register.cjs <inception> --merge <file|dir> [--json] [--root .specs-aidlc-turbo]',
].join('\n');

function parseArgs(argv) {
    const out = { positional: [], status: false, merge: null, json: false, root: paths.ARTIFACT_DIR };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--status') out.status = true;
        else if (arg === '--merge') { out.merge = argv[i + 1] || ''; i += 1; }
        else if (arg === '--json') out.json = true;
        else if (arg === '--root') { out.root = argv[i + 1] || paths.ARTIFACT_DIR; i += 1; }
        else if (arg === '--help' || arg === '-h') out.help = true;
        else if (arg.startsWith('--')) out.bad = arg;
        else out.positional.push(arg);
    }
    return out;
}

const counts = (register) => {
    const stale = register.items.filter((it) => it.status === 'stale').length;
    return { total: register.items.length, current: register.items.length - stale, stale };
};

function status(root, inception, json) {
    const inc = paths.layout(root).inception(inception);
    const register = readRegister(inc.register);
    const { pages, gone } = pageStatus(register, listPages(root, inception), digestVersions(root));
    const read = pages.filter((p) => p.action === 'read');
    if (json) {
        console.log(JSON.stringify({ inception, register: inc.register, read: read.length, skip: pages.length - read.length, pages, gone }, null, 2));
        return 0;
    }
    if (!pages.length && !gone.length) {
        console.log(`register ${inception}: no pages synced, nothing to read`);
        return 0;
    }
    console.log(`register ${inception}: ${read.length} to read, ${pages.length - read.length} skip${gone.length ? `, ${gone.length} gone` : ''}`);
    for (const p of pages) {
        const why = p.reason === 'changed' ? `changed (read ${p.read_version})` : p.reason;
        console.log(`${p.action.padEnd(5)} ${p.id}  v${p.version}  ${p.file || '-'}  ${why}`);
    }
    for (const g of gone) console.log(`gone  ${g.id}  ${g.file || '-'}  no longer synced, its statements turn stale on the next merge`);
    return 0;
}

function merge(root, inception, target, json) {
    const inc = paths.layout(root).inception(inception);
    const files = candidateFiles(target);
    if (!files.length) throw new Error(`${target}: no candidate files`);
    const parsed = files.map((file) => {
        const data = readYamlFile(file);
        const problems = candidateProblems(data);
        if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
        return data;
    });
    const register = readRegister(inc.register);
    const results = parsed.map((c) => mergeCandidates(register, c));
    const gone = staleGone(register, listPages(root, inception));
    writeRegister(inc.register, register);
    const total = counts(register);
    if (json) {
        console.log(JSON.stringify({ inception, register: inc.register, pages: results, gone_stale: gone, ...total }, null, 2));
        return 0;
    }
    for (const r of results) {
        console.log(`page ${r.page} v${r.version}: ${r.added.length} new, ${r.kept.length} kept, ${r.revived.length} back, ${r.stale.length} stale`);
    }
    if (gone.length) console.log(`pages no longer synced: ${gone.length} statements stale`);
    console.log(`register ${inception}: ${total.total} statements (${total.current} current, ${total.stale} stale)`);
    return 0;
}

function main(argv) {
    const args = parseArgs(argv);
    if (args.help) { console.log(USAGE); return 0; }
    if (args.bad || args.positional.length !== 1 || args.status === (args.merge !== null) || args.merge === '') {
        console.error(args.bad ? `Unknown option ${args.bad}\n${USAGE}` : USAGE);
        return 2;
    }
    if (paths.isLegacy(args.root)) { console.error(paths.legacyMessage(args.root)); return 1; }
    const inception = args.positional[0];
    if (paths.isReservedSlug(inception)) { console.error(`"${inception}" is a folder of the layout, not an inception`); return 2; }
    try {
        return args.status ? status(args.root, inception, args.json) : merge(args.root, inception, args.merge, args.json);
    } catch (error) {
        console.error(error.message);
        return 1;
    }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
    KINDS,
    normaliseQuote,
    quoteKey,
    readRegister,
    writeRegister,
    listPages,
    digestVersions,
    pageStatus,
    candidateProblems,
    mergeCandidates,
    staleGone,
    main,
};
