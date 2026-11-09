/**
 * specsmd AI-DLC Turbo - reading an intent for its overview
 * (intent-overview.cjs): the brief, the stories (their files merged with the
 * record), the test cases, what is left out on purpose, and whether a file
 * existed before the intent (git, else the Code Scaffold and the disk).
 *
 * The product half of a story file is read in the headings of the record's
 * language (the md section of its string table, ./lang.cjs); English is
 * always understood too.
 *
 * Node builtins only, plus ../frontmatter.cjs, ./paths.cjs, ./lang.cjs, the
 * YAML reader of ../render-specs.cjs and ./overview-text.cjs.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { extractFrontmatter } = require('../frontmatter.cjs');
const paths = require('./paths.cjs');
const lang = require('./lang.cjs');
const { parseYaml } = require('../render-specs.cjs');
const { present, list, sentence, storyId, plain, blocks, listItems, sections, find } = require('./overview-text.cjs');

// ---------------------------------------------------------------------------
// Reading the intent
// ---------------------------------------------------------------------------

function readDoc(file) {
    const raw = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
    return { data: extractFrontmatter(raw) || {}, body };
}

function readConfig(root) {
    try {
        const text = fs.readFileSync(paths.layout(root).config, 'utf8');
        const tester = /^tester:\s*\n((?:[ \t]+.*\n?)*)/m.exec(text);
        return { testerEnabled: /^\s+enabled:\s*true\b/m.test(tester ? tester[1] : '') };
    } catch {
        return { testerEnabled: false };
    }
}

/** A YAML file as data, or null when it is missing or does not parse. */
function readYaml(file) {
    try {
        return parseYaml(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

/** The brief's frontmatter and its ## Intent text. */
function readBrief(intent) {
    if (!fs.existsSync(intent.brief)) return { data: {}, intentText: '' };
    const { data, body } = readDoc(intent.brief);
    const section = find(sections(body, 2), /^intent$/i);
    return { data, intentText: section ? section.text : '' };
}

/**
 * How the product half of a rendered story reads in the record's language
 * (md in the string table): the words of its headings, its user story, its
 * criteria and its tester note, as patterns. English is always understood too.
 */
function markdownWords(table) {
    const en = lang.load(lang.FALLBACK);
    const say = (t, key, fallback) => {
        const v = lang.text(t, key);
        return v === key ? fallback : v;
    };
    const words = (key, cut = /$^/, fallback = '') => [...new Set([say(table, key, fallback), say(en, key, fallback)])]
        .filter((w) => String(w).trim())
        .map((w) => String(w).trim().replace(cut, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|');
    const tester = words('md.tester');
    const given = words('md.given');
    const when = words('md.when');
    const then = words('md.then');
    return {
        product: new RegExp(`^(?:${words('md.product')})$`, 'i'),
        why: new RegExp(`^(?:${words('md.why', /$^/, 'Why this story')})$`, 'i'),
        criteria: new RegExp(`^(?:${words('md.criteria')})$`, 'i'),
        none: new RegExp(`^(?:${words('md.none', /\.$/)})\\.?$`, 'i'),
        // the note render-specs.cjs puts at the end of a criterion line: where a tester checks it,
        // " *(tester: screen)*". The page does not show it.
        testerNote: new RegExp(`\\s\\*\\((?:${tester}): [^)]*\\)\\*\\s*$`, 'i'),
        gwdBold: new RegExp(`^\\*\\*(?:${given})\\*\\*\\s*([\\s\\S]*?)\\s*,?\\s*\\*\\*(?:${when})\\*\\*\\s*([\\s\\S]*?)\\s*,?\\s*\\*\\*(?:${then})\\*\\*\\s*([\\s\\S]*)$`, 'i'),
        gwdPlain: new RegExp(`^(?:${given})\\s+(.+?),?\\s+(?:${when})\\s+(.+?),?\\s+(?:${then})\\s+(.+)$`, 'i'),
        storyBold: new RegExp(`\\*\\*(?:${words('md.asA')})\\*\\*\\s*([\\s\\S]*?)\\s*,?\\s*\\*\\*(?:${words('md.iWant')})\\*\\*\\s*([\\s\\S]*?)\\s*,?\\s*\\*\\*(?:${words('md.soThat')})\\*\\*\\s*([\\s\\S]*)$`, 'i'),
    };
}

/** One criterion as { given, when, then }, from markdown or plain text; a free line goes into then. */
function parseCriterion(md, w = markdownWords(lang.load(lang.FALLBACK))) {
    const text = String(md).trim();
    const bold = w.gwdBold.exec(text);
    if (bold) return { given: plain(bold[1]), when: plain(bold[2]), then: plain(bold[3]) };
    const flat = w.gwdPlain.exec(plain(text));
    if (flat) return { given: flat[1], when: flat[2], then: flat[3] };
    return { given: '', when: '', then: plain(text) };
}

/**
 * The product-team half of a story file: the user story, why the story exists and the criteria, plain text,
 * in the headings of `table`.
 */
function readStoryMarkdown(body, table = lang.load(lang.FALLBACK)) {
    const w = markdownWords(table);
    const product = find(sections(body, 2), w.product);
    const productText = product ? product.text : body.split(/^##\s+for the agent/im)[0];
    const lead = productText.split(/^###\s/m)[0]
        .split('\n').map((l) => l.trim()).filter((l) => l && !/^-{3,}$|^#/.test(l)).join(' ');
    const m = w.storyBold.exec(lead);
    const story = m ? { asA: plain(m[1]), iWant: plain(m[2]), soThat: plain(m[3]) } : null;
    const why = find(sections(productText, 3), w.why);
    const section = find(sections(productText, 3), w.criteria);
    const criteria = listItems(section ? section.text : '', w.none).map((item) => {
        const [head, ...subs] = item.split('\n');
        return parseCriterion([head.replace(w.testerNote, ''), ...subs].join(' '), w);
    });
    return { story, why: why ? plain(why.text) || null : null, criteria };
}

/** The user story from the record's product half, or null when it is not complete. */
function recordStory(product) {
    if (!product || typeof product !== 'object' || !present(product.as_a) || !present(product.i_want) || !present(product.so_that)) return null;
    return { asA: plain(product.as_a), iWant: plain(product.i_want), soThat: sentence(plain(product.so_that)) };
}

/** The criteria from the record's product half, or null when it has none. */
function recordCriteria(product, w) {
    const items = list(product && product.criteria).filter((c) => c && (typeof c === 'string' || typeof c === 'object'));
    if (!items.length) return null;
    return items.map((c) => (typeof c === 'string'
        ? parseCriterion(c, w)
        : { given: plain(c.given), when: plain(c.when), then: plain(c.then) }));
}

// A test file only counts: a test folder in its path, or a test file name.
const TEST_DIR = new Set(['test', 'tests', '__tests__', 'e2e']);
const TEST_NAME = /\.(?:test|spec)\.[^/]+$|\wTests?\.java$|[a-z0-9]IT\.java$|_test\.go$|^test_[^/]*\.py$/;

function isTestFile(file) {
    const parts = file.split('/');
    const name = parts[parts.length - 1];
    return parts.slice(0, -1).some((p) => TEST_DIR.has(p.toLowerCase())) || TEST_NAME.test(name);
}

/** Module of a file: its first folder, or the first two when the first is src, lib, app or packages; `rootName` for a file at the top. */
function moduleOf(file, rootName = '/') {
    const dirs = file.split('/').slice(0, -1);
    if (!dirs.length) return rootName;
    return ['src', 'lib', 'app', 'packages'].includes(dirs[0]) && dirs.length > 1 ? `${dirs[0]}/${dirs[1]}` : dirs[0];
}

// A source file shows as its class or module name; any other file keeps its full name (pom.xml).
const SOURCE_EXT = /\.(?:java|kt|scala|groovy|cs|go|py|rb|php|rs|swift|c|cc|cpp|h|hpp|m|js|cjs|mjs|jsx|ts|tsx|vue|svelte)$/i;
const codeName = (file) => {
    const name = path.posix.basename(file);
    return SOURCE_EXT.test(name) ? name.replace(SOURCE_EXT, '') : name;
};

const normalizePath = (p) => String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '');

/** Run git in the current directory. Its stdout, or null when git is missing or fails. */
function git(args) {
    try {
        const r = spawnSync('git', args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
        return r.error || r.status !== 0 ? null : r.stdout;
    } catch {
        return null;
    }
}

/**
 * The files of `files` that existed before the intent. The base is the parent
 * of the commit that first added the intent's record.yaml, or HEAD when the
 * record is not committed; one ls-tree call decides. Without git: the status
 * the Code Scaffold gives a file it draws (`drawn`: path -> new | changed |
 * existing), existence on disk for the rest.
 */
function existedBefore(recordFile, files, drawn = new Map()) {
    if (!files.length) return new Set();
    const onDisk = () => new Set(files.filter((f) => (drawn.has(f) ? drawn.get(f) !== 'new' : fs.existsSync(path.resolve(f)))));
    if (git(['rev-parse', '--is-inside-work-tree']) === null) return onDisk();
    const added = (git(['log', '--diff-filter=A', '--format=%H', '-1', '--', recordFile]) || '').trim();
    let base = 'HEAD';
    if (added) {
        // The record came with the very first commit: nothing existed before it.
        if (git(['rev-parse', '--verify', '-q', `${added}^`]) === null) return new Set();
        base = `${added}^`;
    }
    const out = git(['ls-tree', '-r', '-z', '--name-only', base, '--', ...files]);
    if (out === null) return onDisk();
    const listed = new Set(out.split('\0').filter(Boolean));
    const all = [...listed];
    return new Set(files.filter((f) => listed.has(f) || all.some((l) => l.startsWith(`${f.replace(/\/$/, '')}/`))));
}

/** The status of every file the Code Scaffold draws: normalized path -> new | changed | existing. */
function drawnFiles(record) {
    const td = record && record.technical_design && record.technical_design.drawing;
    return new Map(list(td && td.parts).filter((p) => p && typeof p === 'object' && present(p.path))
        .map((p) => [normalizePath(p.path), String(p.status || '')]));
}

/** The story files on disk, merged with the record's stories by id, in id order. */
function readStories(intent, record) {
    const byId = new Map();
    const files = fs.existsSync(intent.stories)
        ? fs.readdirSync(intent.stories).filter((f) => /^\d+-.*\.md$/.test(f))
        : [];
    for (const f of files) {
        const { data, body } = readDoc(path.join(intent.stories, f));
        const id = data.id != null ? storyId(data.id) : f.split('-')[0];
        byId.set(id, { id, slug: path.basename(f, '.md'), data, body, rec: null });
    }
    for (const rec of list(record.stories)) {
        if (!rec || typeof rec !== 'object' || !present(rec.id)) continue;
        const id = storyId(rec.id);
        if (byId.has(id)) byId.get(id).rec = rec;
        else byId.set(id, { id, slug: `${id}-${rec.slug || 'story'}`, data: {}, body: '', rec });
    }
    return [...byId.values()].sort((a, b) => (parseInt(a.id, 10) - parseInt(b.id, 10)) || a.id.localeCompare(b.id));
}

/** A story field from its frontmatter, or from the record when the frontmatter does not have it. */
function field(s, key) {
    if (s.data[key] !== undefined && s.data[key] !== null) return s.data[key];
    return s.rec ? s.rec[key] : undefined;
}

/** The files a story touches: changed_files once built, else touches. */
function storyFiles(s) {
    const changed = list(field(s, 'changed_files'));
    return [...new Set((changed.length ? changed : list(field(s, 'touches'))).filter(present).map(normalizePath))];
}

/** The manual test cases in the intent's tests/ folder, shown as they were written. */
function readTestCases(intent) {
    if (!fs.existsSync(intent.tests)) return [];
    return fs.readdirSync(intent.tests).filter((f) => f.endsWith('.md')).sort().map((f) => {
        const { data, body } = readDoc(path.join(intent.tests, f));
        const testId = String(data.test_id || f.replace(/\.md$/, ''));
        const title = (/^#\s+(.+)$/m.exec(body) || [null, f.replace(/\.md$/, '')])[1];
        const parts = sections(body, 2)
            .filter((s) => !/agent/i.test(s.heading))
            .map((s) => ({ heading: plain(s.heading), html: blocks(s.text.trim()) }));
        return {
            story: String(data.story || ''),
            testId,
            title: plain(title),
            twin: data.twin ? String(data.twin) : null,
            twinResult: data.twin_result ? String(data.twin_result) : 'not_run',
            sections: parts,
        };
    });
}

const SCOPE_MAX = 60;

/**
 * What the intent leaves out on purpose, one chip each. The chip is its short
 * name; without one, the register quote behind an S-id (or the id text) when that is
 * short, else the reason with the quote in the tip. The reason is the tip. Chips with
 * the same text show once, with all their tips.
 */
function readOutOfScope(root, intent, record) {
    const items = list(record.deliberately_not).filter((n) => n && typeof n === 'object' && present(n.id));
    if (!items.length) return [];
    const register = readYaml(paths.layout(root).inception(intent.inception).register) || {};
    const quotes = new Map(list(register.items).filter(Boolean).map((it) => [String(it.id), String(it.quote || '')]));
    const chips = new Map();
    for (const n of items) {
        const id = String(n.id).trim();
        const reason = plain(n.reason);
        const full = plain((/^S-\d+$/.test(id) && quotes.get(id)) || id);
        const short = plain(n.short);
        const [text, tip] = short ? [short, reason]
            : full.length <= SCOPE_MAX || !reason ? [full, reason]
                : [reason.replace(/\s*\((?:D-\d+[,\s]*)+\)\s*$/, ''), full];
        if (!chips.has(text)) chips.set(text, []);
        if (tip && !chips.get(text).includes(tip)) chips.get(text).push(tip);
    }
    return [...chips].map(([text, tips]) => ({ text, tip: tips.join('\n') }));
}

module.exports = {
    readDoc, readConfig, readYaml, readBrief, markdownWords, parseCriterion, readStoryMarkdown,
    recordStory, recordCriteria, isTestFile, moduleOf, codeName, normalizePath,
    git, existedBefore, drawnFiles, readStories, field, storyFiles,
    readTestCases, readOutOfScope,
};
