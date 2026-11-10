#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - every intent its own Confluence page.
 *
 * The gate the inception runs after the pull, before the approval and before
 * the push and the overview upload. It reads the inception's sync.yaml, its
 * intent records and its register, and says whether every intent has its own
 * page (lib/intent-tree.cjs has the rule). When not, it prints the plan the
 * sync agent carries out in mode `intent-pages` once the user said yes: the
 * pages to create, each story page to move under its own intent's stories
 * page, and the story pages it could not place, with what was found. The
 * titles of new pages follow the project's page names (lib/page-names.cjs).
 *
 *   check --inception SLUG [--map PAGE=INTENT ...]
 *       --map: the user's own mapping of a story page to an intent; it wins
 *       over the records. Repeat it per page.
 *
 * pageOf(root, intent) is the one place a writer asks where an intent's files
 * go: the intent's own page, the inception's page for an inception of one
 * intent, never the shared page of an inception with several
 * (confluence-attach.cjs --intent uses it).
 *
 * Prints ONE JSON object on one line: { ok, inception, intents, problems,
 * plan, lines }. Exit 0 passes (also without Confluence: skipped, or no page),
 * 1 fails, 2 usage error ({ ok: false, detail }).
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/intent-pages.cjs check --inception SLUG [--map PAGE=INTENT ...] [--root .specs-aidlc-turbo]
 *
 * Node builtins only, plus ./lib/paths.cjs, ./lib/intent-tree.cjs,
 * ./lib/page-names.cjs, ./lib/yaml-subset.cjs and the story reader of
 * ./intent-status.cjs: the target project often has no node_modules.
 */

const fs = require('fs');
const paths = require('./lib/paths.cjs');
const { checkTree, PAGE_PROBLEMS } = require('./lib/intent-tree.cjs');
const { pageNames } = require('./lib/page-names.cjs');
const { parseYaml } = require('./lib/yaml-subset.cjs');
const { readStories } = require('./intent-status.cjs');

const USAGE = 'usage: intent-pages.cjs check --inception SLUG [--map PAGE=INTENT ...] [--root .specs-aidlc-turbo]';
const isMap = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const present = (v) => v !== undefined && v !== null && String(v).trim() !== '';
/** Story ids are 3-digit strings; an unquoted `001` reads as the number 1. */
const storyId = (v) => (/^\d+$/.test(String(v).trim()) ? String(v).trim().padStart(3, '0') : String(v).trim());

/** A wrong argument: exit 2. */
class UsageError extends Error {}

function readYaml(file) {
    if (!fs.existsSync(file)) return null;
    return parseYaml(fs.readFileSync(file, 'utf8'));
}

/** One intent folder: its title and purpose, and its stories by number and title. */
function readFolder(intent) {
    let record = null;
    try { record = readYaml(intent.record); } catch { record = null; }
    if (isMap(record)) {
        const head = isMap(record.intent) ? record.intent : {};
        return {
            slug: intent.slug,
            title: head.title ?? null,
            purpose: record.purpose ?? null,
            stories: (Array.isArray(record.stories) ? record.stories : []).filter(isMap)
                .map((s) => ({ id: storyId(s.id), title: s.title ?? '', sources: Array.isArray(s.sources) ? s.sources.map(String) : [] })),
        };
    }
    // A migrated intent has no record yet: its story files say the same.
    const stories = readStories(intent).map((s) => ({
        id: s.id, title: s.frontmatter.title ?? s.title, sources: Array.isArray(s.frontmatter.sources) ? s.frontmatter.sources.map(String) : [],
    }));
    return { slug: intent.slug, title: null, purpose: null, stories };
}

/** Page id -> the record stories whose sources cite a register statement of that page. */
function readCitations(registerFile, folders) {
    let register = null;
    try { register = readYaml(registerFile); } catch { register = null; }
    const pageOfItem = new Map((isMap(register) && Array.isArray(register.items) ? register.items : [])
        .filter(isMap).map((it) => [String(it.id), String(it.page)]));
    const out = new Map();
    for (const f of folders) {
        for (const s of f.stories) {
            for (const id of s.sources) {
                const page = pageOfItem.get(id);
                if (page) out.set(page, [...(out.get(page) || []), { intent: f.slug, story: s.id }]);
            }
        }
    }
    return out;
}

/** Everything the rule needs, read from disk. */
function readTree(root, inception) {
    const inc = paths.layout(root).inception(inception);
    if (!fs.existsSync(inc.dir)) throw new UsageError(`no inception "${inception}" under ${paths.layout(root).docs}`);
    const sync = readYaml(inc.sync) || {};
    const c = isMap(sync.confluence) ? sync.confluence : {};
    const folders = paths.listIntents(root).filter((i) => i.inception === inception).map(readFolder);
    return {
        inception,
        skipped: c.skipped === true,
        documentation: isMap(c.documentation) ? c.documentation : null,
        entries: isMap(c.intents) ? c.intents : {},
        rows: Array.isArray(c.pages) ? c.pages : [],
        folders,
        citations: readCitations(inc.register, folders),
        names: pageNames(root),
    };
}

/** The gate for one inception. `map`: page id -> intent slug, the user's own mapping. */
function checkInception(root, inception, { map = {} } = {}) {
    const tree = readTree(root, inception);
    const slugs = new Set(tree.folders.map((f) => f.slug));
    const prefix = `docs/${inception}/pages/`;
    const storyPages = new Set(tree.rows.filter((r) => isMap(r) && typeof r.path === 'string' && r.path.startsWith(prefix)
        && /\/stories\/[^/]+(\.md|\/index\.md)$/.test(`/${r.path.slice(prefix.length)}`)
        && !/(^|\/)stories\/index\.md$/.test(r.path.slice(prefix.length))).map((r) => String(r.page_id)));
    for (const [page, slug] of Object.entries(map)) {
        if (!slugs.has(String(slug))) throw new UsageError(`--map ${page}=${slug}: ${slug} is no intent of ${inception}`);
        if (!storyPages.has(String(page))) throw new UsageError(`--map ${page}=${slug}: page ${page} is no story page of ${inception}`);
    }
    return checkTree(tree, map);
}

/**
 * Where an intent's files go on Confluence: { ok, intent, inception, page_id,
 * url, name, own }, or { ok: false, detail }. Never the shared page of an
 * inception with several intents.
 */
function pageOf(root, slug) {
    let intent;
    try { intent = paths.findIntent(root, slug); } catch (error) { return { ok: false, detail: error.message }; }
    if (!intent) return { ok: false, detail: `no intent "${slug}" under ${paths.layout(root).docs}` };
    const tree = readTree(root, intent.inception);
    const base = { intent: slug, inception: intent.inception };
    if (tree.skipped) return { ok: false, ...base, detail: `Confluence is skipped for ${intent.inception}` };
    const wrong = checkTree(tree).problems.find((p) => p.intent === slug && PAGE_PROBLEMS.has(p.kind));
    if (wrong) {
        return { ok: false, ...base, detail: `${wrong.detail}: nothing goes on the shared page. Run intent-pages.cjs check --inception ${intent.inception} first.` };
    }
    const own = isMap(tree.entries[slug]) && present(tree.entries[slug].page_id) ? tree.entries[slug] : null;
    const page = own || (tree.documentation && present(tree.documentation.page_id) ? tree.documentation : null);
    if (!page) return { ok: false, ...base, detail: `no documentation page for ${slug} in ${paths.layout(root).inception(intent.inception).sync}` };
    return { ok: true, ...base, page_id: String(page.page_id), url: page.url ?? null, name: page.name ?? null, own: Boolean(own) };
}

/** argv into { cmd, inception, map, root }; throws UsageError. */
function parseArgs(argv) {
    const out = { cmd: null, inception: null, map: {}, root: paths.ARTIFACT_DIR };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const value = () => {
            const v = argv[i + 1];
            if (v === undefined || v.startsWith('--')) throw new UsageError(`${arg} needs a value`);
            i += 1;
            return v;
        };
        if (arg === '--inception') out.inception = value();
        else if (arg === '--root') out.root = value();
        else if (arg === '--map') {
            const m = /^([^=]+)=(.+)$/.exec(value());
            if (!m) throw new UsageError('--map takes PAGE=INTENT');
            out.map[m[1].trim()] = m[2].trim();
        } else if (arg.startsWith('--')) throw new UsageError(`unknown option ${arg}`);
        else if (out.cmd === null) out.cmd = arg;
        else throw new UsageError(`unexpected argument ${JSON.stringify(arg)}`);
    }
    if (out.cmd !== 'check') throw new UsageError(out.cmd ? `unknown command ${JSON.stringify(out.cmd)}` : 'no command given');
    if (!out.inception) throw new UsageError('check needs --inception');
    return out;
}

/** Prints one JSON object and returns the exit code. */
function main(argv, print = (text) => process.stdout.write(`${text}\n`)) {
    let args;
    try {
        args = parseArgs(argv);
        if (paths.isLegacy(args.root)) { print(JSON.stringify({ ok: false, detail: paths.legacyMessage(args.root) })); return 1; }
        const result = checkInception(args.root, args.inception, { map: args.map });
        print(JSON.stringify(result));
        return result.ok ? 0 : 1;
    } catch (error) {
        const usage = error instanceof UsageError;
        print(JSON.stringify({ ok: false, detail: usage ? `${error.message}\n${USAGE}` : error.message }));
        return usage ? 2 : 1;
    }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { checkInception, pageOf, readTree, parseArgs, main, UsageError };
