#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - render the specs from the decision record.
 *
 * Reads docs/{inception}/{intent}/record.yaml and writes brief.md and one
 * stories/{SSS}-{slug}.md per story. Deterministic: the same record and the
 * same files on disk give the same bytes, so a rerun is always safe.
 *
 * What construction writes is kept: the brief's status, created, approved,
 * completed, mode and branch, every story's status, created, completed,
 * commit and branch, any other frontmatter key a later step added, the
 * brief's `## Lessons` and every story's `### Build notes`. A story on disk
 * that the record no longer has is removed while it is `todo`, and refused
 * once it started.
 *
 * Every criterion says where a tester checks it (`observed_via`: ui, api, db,
 * log or none). The story's frontmatter lists those values in order, each
 * criterion line ends in its label, and `tester_verifiable` is derived:
 * true when one criterion is not `none`. A record whose criteria do not all
 * carry `observed_via` (written before the field) still renders, with its own
 * `tester_verifiable`; spec-lint.cjs reports the gap.
 *
 * Every `integration` entry of a story (a test with an earlier story it
 * overlaps) becomes a line of its `### Test plan`, after the record's own
 * test_plan lines: "- Integration with S003 {title of 003}: {test}". The rest
 * of the overview data (`overview`, `short`, `slice`) stays out
 * of the markdown: intent-overview.cjs reads it from the record. A record
 * without any of it renders as before.
 *
 * A decision with source `assumption` (it names or creates a code structure
 * that no code backs) ends in "Assumption: no code backs it." in the brief,
 * so the cross-checker checks it against the code before the approval.
 *
 * The Code Scaffold (./lib/design-render.cjs) closes the brief's
 * Technical design, and a story's own follows its `### Design`.
 *
 * The record is written in one language, `intent.language` (en when it has
 * none). The product half of a story, its headings and "None." there come
 * from the string table of that language (./lib/lang.cjs); the agent half
 * and the brief's headings stay English.
 *
 * --check writes nothing and exits 1 when a file on disk differs from what
 * the record renders, naming each file. spec-lint.cjs runs it too, so nobody
 * hand-edits the specs away from the record.
 *
 * This file also carries the small YAML reader and writer the inception
 * scripts share (parseYaml, dumpYaml): block maps and lists, flow `[..]` and
 * `{..}`, quoted and plain scalars, `|` and `>` blocks, comments. Anchors and
 * tags are not supported; the record never needs them.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/render-specs.cjs <intent> [--check] [--json] [--root .specs-aidlc-turbo]
 *
 * Exit 0 ok, 1 differences (--check) or failure, 2 usage error.
 *
 * Node builtins only, plus ./frontmatter.cjs, ./lib/paths.cjs,
 * ./lib/lang.cjs, ./lib/design-render.cjs and the YAML subset in
 * ./lib/yaml-subset.cjs: the target project often has no node_modules.
 */

const fs = require('fs');
const path = require('path');
const { extractFrontmatter } = require('./frontmatter.cjs');
const paths = require('./lib/paths.cjs');
const design = require('./lib/design-render.cjs');
const lang = require('./lib/lang.cjs');
const { parseYaml, dumpYaml, dumpScalar, flowOf } = require('./lib/yaml-subset.cjs');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const present = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
const list = (v) => (Array.isArray(v) ? v : (present(v) ? [v] : []));
const str = (v) => (present(v) ? String(v).replace(/[ \t]+$/gm, '').trim() : '');

/** Story ids are 3-digit strings; an unquoted `001` reads as the number 1. */
function storyId(v) {
    const s = String(v).trim();
    return /^\d+$/.test(s) ? s.padStart(3, '0') : s;
}

/** End a sentence with a full stop unless it already ends in punctuation. */
const sentence = (s) => (/[.!?:]$/.test(s) ? s : `${s}.`);

/** A record value as markdown: text as is, a list as bullets. */
function md(v) {
    if (!present(v) || (Array.isArray(v) && !v.length)) return '';
    if (Array.isArray(v)) {
        return v.filter(present).map((item) => {
            if (item && typeof item === 'object') return `- ${Object.entries(item).filter(([, x]) => present(x)).map(([k, x]) => `${k}: ${str(x)}`).join('; ')}`;
            return `- ${str(item).replace(/\n/g, '\n  ')}`;
        }).join('\n');
    }
    if (typeof v === 'object') return Object.entries(v).filter(([, x]) => present(x)).map(([k, x]) => `- **${k}**: ${str(x)}`).join('\n');
    return str(v);
}

const cell = (v) => (Array.isArray(v) ? v.map(str).join(', ') : str(v)).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ') || '-';

function mdTable(headers, rows) {
    return [
        `| ${headers.join(' | ')} |`,
        `| ${headers.map((h) => '-'.repeat(Math.max(3, h.length))).join(' | ')} |`,
        ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
    ].join('\n');
}

/** Inline code that survives a backtick inside the command. */
const code = (t) => (t.includes('`') ? `\`\` ${t} \`\`` : `\`${t}\``);

const orNone = (text, none = 'None.') => (text && text.trim() ? text.trim() : none);

/** The text of one section, from its heading to the next heading of the same or a higher level. */
function sectionText(body, heading) {
    const lines = String(body).replace(/\r\n?/g, '\n').split('\n');
    const level = /^#+/.exec(heading)[0].length;
    const start = lines.findIndex((l) => l.trim() === heading);
    if (start < 0) return null;
    const stop = new RegExp(`^#{1,${level}}\\s`);
    let end = start + 1;
    while (end < lines.length && !stop.test(lines[end])) end += 1;
    return lines.slice(start + 1, end).join('\n').trim();
}

/** Flat frontmatter: scalars and one-level lists, key order kept. */
function frontmatter(obj) {
    const lines = Object.entries(obj).map(([k, v]) => {
        if (Array.isArray(v)) return `${k}: [${v.map(dumpScalar).join(', ')}]`;
        if (v && typeof v === 'object') return `${k}: ${flowOf(v)}`;
        return `${k}: ${dumpScalar(v)}`;
    });
    return `---\n${lines.join('\n')}\n---\n`;
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** Where a tester checks a criterion; the story shows the label of the record's language (md.via). */
const VIA = ['ui', 'api', 'db', 'log', 'none'];

/**
 * The `observed_via` of every criterion of a story, in order. Null when one
 * criterion has none: a plain line, or a record written before the field.
 */
function observedVia(story) {
    const criteria = list(story && story.product && story.product.criteria);
    if (!criteria.length || !criteria.every((c) => c && typeof c === 'object' && present(c.observed_via))) return null;
    return criteria.map((c) => str(c.observed_via));
}

/** Derived from the criteria when they all carry observed_via: true when one is not none. Else the record's own value. */
function testerVerifiable(story) {
    const via = observedVia(story);
    if (via) return via.some((v) => v !== 'none');
    return Boolean(story) && story.tester_verifiable === true;
}

/** One line of text: a reason inside the tester note never breaks the criterion line. */
const oneLine = (v) => str(v).replace(/\s*\n\s*/g, ' ');

/** The tester note at the end of a criterion line: " *(tester: label)*", with ", reason" for none. */
function viaSuffix(criterion, stories, table = lang.load('en')) {
    if (!criterion || typeof criterion !== 'object' || !present(criterion.observed_via)) return '';
    const via = str(criterion.observed_via);
    const label = VIA.includes(via) ? lang.text(table, `md.via.${via}`) : via;
    let reason = '';
    if (via === 'none' && present(criterion.covered_by)) {
        const id = storyId(criterion.covered_by);
        const other = list(stories).find((x) => x && typeof x === 'object' && present(x.id) && storyId(x.id) === id);
        // The overview page reads the note up to the first `)`, so the title drops its parentheses.
        const title = other ? oneLine(other.title).replace(/[()]/g, '') : '';
        reason = `${lang.text(table, 'md.coveredBy', { id })}${title ? ` ${title}` : ''}`;
    } else if (via === 'none' && present(criterion.why_none)) reason = oneLine(criterion.why_none);
    return ` *(${lang.text(table, 'md.tester')}: ${label}${reason ? `, ${reason}` : ''})*`;
}

/**
 * The story's integration tests as test plan lines, in record order:
 * "- Integration with S003 {title of 003}: {test}". An entry without
 * `with` or `test` is left out; spec-lint.cjs reports it.
 */
function integrationLines(story, stories) {
    return list(story && story.integration)
        .filter((e) => e && typeof e === 'object' && !Array.isArray(e) && present(e.with) && present(e.test))
        .map((e) => {
            const id = storyId(e.with);
            const other = list(stories).find((x) => x && typeof x === 'object' && present(x.id) && storyId(x.id) === id);
            const title = other ? oneLine(other.title) : '';
            return `- Integration with S${id}${title ? ` ${title}` : ''}: ${oneLine(e.test)}`;
        });
}

/** Every key render needs, as a list of missing key paths. Empty means renderable. */
function missingKeys(record) {
    const miss = [];
    const need = (obj, key, at) => { if (!obj || !present(obj[key])) miss.push(at); };
    if (!record || typeof record !== 'object') return ['(the record is empty)'];
    const intent = record.intent || {};
    ['slug', 'inception', 'title', 'created'].forEach((k) => need(intent, k, `intent.${k}`));
    need(record, 'lane', 'lane');
    need(record, 'purpose', 'purpose');
    if (!Array.isArray(record.requirements) || !record.requirements.length) miss.push('requirements');
    else record.requirements.forEach((r, i) => ['id', 'text'].forEach((k) => need(r, k, `requirements[${i}].${k}`)));
    list(record.decisions).forEach((d, i) => ['id', 'answer'].forEach((k) => need(d, k, `decisions[${i}].${k}`)));
    if (!list(record.verification).filter(present).length) miss.push('verification');
    if (!Array.isArray(record.stories) || !record.stories.length) miss.push('stories');
    else {
        record.stories.forEach((s, i) => {
            const at = `stories[${i}]`;
            ['id', 'slug', 'title', 'complexity', 'surface'].forEach((k) => need(s, k, `${at}.${k}`));
            // Derived when every criterion says where a tester checks it; a record from before that gives it itself.
            if (!observedVia(s) && (!s || typeof s.tester_verifiable !== 'boolean')) miss.push(`${at}.tester_verifiable (or observed_via on every criterion)`);
            const product = (s && s.product) || {};
            ['as_a', 'i_want', 'so_that'].forEach((k) => need(product, k, `${at}.product.${k}`));
            if (!list(product.criteria).length) miss.push(`${at}.product.criteria`);
            list(product.criteria).forEach((c, j) => {
                if (typeof c === 'string') return;
                ['given', 'when', 'then'].forEach((k) => need(c, k, `${at}.product.criteria[${j}].${k}`));
            });
        });
    }
    return miss;
}

/** Read and parse record.yaml of one intent. Throws with the file name on a parse error. */
function readRecord(intent) {
    if (!fs.existsSync(intent.record)) throw new Error(`${intent.record}: missing. Inception writes it from intake on.`);
    try {
        return parseYaml(fs.readFileSync(intent.record, 'utf8')) || {};
    } catch (error) {
        throw new Error(`${intent.record}: ${error.message}`);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const BRIEF_KEPT = ['status', 'created', 'approved', 'completed', 'mode', 'branch'];
const STORY_KEPT = ['status', 'created', 'completed', 'commit', 'branch'];

/** Rendered frontmatter keys first, then any key a later step added on disk. */
function withDisk(rendered, disk, kept) {
    const out = { ...rendered };
    for (const key of kept) if (disk && disk[key] !== undefined && disk[key] !== null) out[key] = disk[key];
    for (const [key, value] of Object.entries(disk || {})) if (!(key in out)) out[key] = value;
    return out;
}

function storyFile(s) {
    return `${storyId(s.id)}-${str(s.slug)}.md`;
}

function renderBrief(record, disk, table = lang.forRecord(record)) {
    const intent = record.intent;
    const fm = withDisk({
        id: str(intent.slug),
        title: str(intent.title),
        inception: str(intent.inception),
        status: 'draft',
        lane: str(record.lane),
        created: str(intent.created),
        approved: null,
        completed: null,
        mode: null,
        branch: null,
        docs_input: list(record.docs_input).map(str),
    }, disk.frontmatter, BRIEF_KEPT);

    const requirements = record.requirements.map((r) => {
        const sources = list(r.sources).map(str).filter(Boolean);
        return `- **${str(r.id)}**: ${sentence(str(r.text))}${sources.length ? ` Sources: ${sources.join(', ')}` : ''}`;
    }).join('\n');

    const decisions = list(record.decisions).map((d) => {
        let line = `- **${str(d.id)}**: ${sentence(str(d.answer))}`;
        if (present(d.why)) line += ` Reason: ${sentence(str(d.why))}`;
        if (present(d.dropped)) line += ` Dropped: ${sentence(str(d.dropped))}`;
        if (list(d.source).some((v) => str(v).toLowerCase() === 'assumption')) line += ' Assumption: no code backs it.';
        return line;
    }).join('\n');

    const dm = record.domain_model;
    let domain = '';
    if (dm && typeof dm === 'object' && !Array.isArray(dm)) {
        const entities = list(dm.entities).filter((e) => e && typeof e === 'object');
        domain = [md(dm.text), entities.length ? mdTable(['Entity', 'Key fields', 'Invariant'], entities.map((e) => [e.name, e.key_fields, e.invariant])) : '']
            .filter(Boolean).join('\n\n');
    } else domain = md(dm);

    const td = record.technical_design;
    let technical = '';
    if (td && typeof td === 'object' && !Array.isArray(td)) {
        const rows = [
            ['Modules and layers touched', td.modules],
            ['APIs or endpoints', td.apis],
            ['Data changes and migrations', td.data_changes],
            ['Error handling', td.error_handling],
            ['Where new code goes', td.new_code],
            ['Integration points', td.integrations],
        ];
        if (rows.some(([, v]) => present(v) && !(Array.isArray(v) && !v.length))) {
            technical = rows.map(([label, v]) => `- **${label}**: ${list(v).map(str).filter(Boolean).join(', ') || 'None'}`).join('\n');
        }
    } else technical = md(td);

    const reading = list(record.reading_list).filter((r) => r && typeof r === 'object');
    const stories = record.stories;
    const storyMap = mdTable(
        ['Story', 'Title', 'Depends on', 'Requirements', 'Tester verifiable', 'DB tables'],
        stories.map((s) => [
            storyId(s.id),
            s.title,
            list(s.depends_on).map(storyId),
            list(s.requirements).map(str),
            testerVerifiable(s) ? 'yes' : 'no',
            list(s.db_tables).map(str),
        ]),
    );

    const body = [
        `# ${str(intent.title)}`,
        '## Intent', str(record.purpose),
        '## Requirements', requirements,
        '## Design decisions', orNone(decisions),
        '## Domain model', orNone(domain),
        '## Technical design', orNone([technical, design.briefSection(record, table)].filter(Boolean).join('\n\n')),
        '## Codebase reading list', reading.length ? mdTable(['File', 'Lines', 'Why'], reading.map((r) => [r.file, r.lines, r.why])) : 'None.',
        '## Standards deltas', orNone(md(record.standards_deltas)),
        '## Verification', list(record.verification).filter(present).map((c) => `- ${code(str(c))}`).join('\n'),
        '## Lessons', orNone(disk.lessons),
        '## Story map', storyMap,
    ].join('\n\n');
    return `${frontmatter(fm)}\n${body}\n`;
}

function renderStory(record, s, disk, table = lang.forRecord(record)) {
    const fm = {
        id: storyId(s.id),
        title: str(s.title),
    };
    Object.assign(fm, {
        intent: str(record.intent.slug),
        status: 'todo',
        depends_on: list(s.depends_on).map(storyId),
        requirements: list(s.requirements).map(str),
        sources: list(s.sources).map(str),
        touches: list(s.touches).map(str),
        tester_verifiable: testerVerifiable(s),
    });
    const via = observedVia(s);
    if (via) fm.observed_via = via;
    Object.assign(fm, {
        break_test: s.break_test === true,
        surface: str(s.surface),
        db_tables: list(s.db_tables).map(str),
        test_data: list(s.test_data).map(str).filter(Boolean),
        complexity: str(s.complexity),
        created: str(s.created) || str(record.intent.created),
        completed: null,
        commit: null,
        branch: null,
    });
    // The record owns observed_via: a list on disk that the record no longer gives is never kept.
    const diskFm = { ...(disk.frontmatter || {}) };
    delete diskFm.observed_via;
    const meta = withDisk(fm, diskFm, STORY_KEPT);

    const product = s.product;
    const t = (key) => lang.text(table, key);
    const criteria = list(product.criteria).map((c) => (typeof c === 'string'
        ? `- ${str(c)}`
        : `- **${t('md.given')}** ${str(c.given)} **${t('md.when')}** ${str(c.when)} **${t('md.then')}** ${str(c.then)}${viaSuffix(c, record.stories, table)}`)).join('\n');
    const agent = s.agent || {};
    const context = list(agent.context).filter((r) => r && typeof r === 'object');
    const edges = list(agent.edge_cases);
    const edgeText = edges.length && edges.every((e) => e && typeof e === 'object')
        ? mdTable(['Case', 'Expected behaviour'], edges.map((e) => [e.case, e.expected]))
        : md(agent.edge_cases);
    const testPlan = [md(agent.test_plan), ...integrationLines(s, record.stories)].filter(Boolean).join('\n');

    const body = [
        `# S${storyId(s.id)}: ${str(s.title)}`,
        `## ${t('md.product')}`,
        `**${t('md.asA')}** ${str(product.as_a)}, **${t('md.iWant')}** ${str(product.i_want)}, **${t('md.soThat')}** ${sentence(str(product.so_that))}`,
        ...(present(product.why) ? [`### ${t('md.why')}`, md(product.why)] : []),
        `### ${t('md.criteria')}`, criteria,
        `### ${t('md.outOfScope')}`, orNone(md(product.out_of_scope), t('md.none')),
        '---',
        '## For the agent',
        '### Context to read', context.length ? mdTable(['File', 'Lines', 'Why'], context.map((r) => [r.file, r.lines, r.why])) : 'None.',
        '### Design', orNone(md(agent.design)),
        ...[design.storySection(record, s, table)].filter(Boolean),
        '### Implementation notes', orNone(md(agent.implementation_notes)),
        '### Edge cases and errors', orNone(edgeText),
        '### Test plan', orNone(testPlan),
        '### Build notes', orNone(disk.buildNotes),
    ].join('\n\n');
    return `${frontmatter(meta)}\n${body}\n`;
}

function readDisk(file, heading) {
    if (!fs.existsSync(file)) return { exists: false, frontmatter: null, kept: null, text: null };
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
    const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
    return { exists: true, text, frontmatter: extractFrontmatter(text) || {}, kept: sectionText(body, heading) };
}

/** Existing story files by id (the filename prefix). */
function diskStories(dir) {
    if (!fs.existsSync(dir)) return new Map();
    const out = new Map();
    for (const name of fs.readdirSync(dir).filter((f) => /^\d+-.*\.md$/.test(f)).sort()) {
        const m = /^(\d+)-/.exec(name);
        const disk = readDisk(path.join(dir, name), '### Build notes');
        const id = disk.frontmatter && disk.frontmatter.id != null ? storyId(disk.frontmatter.id) : (m ? storyId(m[1]) : name);
        out.set(id, { name, file: path.join(dir, name), ...disk });
    }
    return out;
}

/**
 * Everything a render would do, without touching disk: the files it would
 * write (with what is on disk now) and the story files it would remove.
 * Throws when the record misses a key or does not belong to this folder.
 */
function planRender(intent, record = readRecord(intent)) {
    const missing = missingKeys(record);
    if (missing.length) throw new Error(`${intent.record}: missing required keys: ${missing.join(', ')}`);
    if (str(record.intent.slug) !== intent.slug) throw new Error(`${intent.record}: intent.slug is "${record.intent.slug}" but the folder is "${intent.slug}"`);
    if (str(record.intent.inception) !== intent.inception) throw new Error(`${intent.record}: intent.inception is "${record.intent.inception}" but the folder sits under "${intent.inception}"`);

    const table = lang.forRecord(record, lang.rootOfIntent(intent));
    const briefDisk = readDisk(intent.brief, '## Lessons');
    const files = [{
        file: intent.brief,
        rel: 'brief.md',
        content: renderBrief(record, { frontmatter: briefDisk.frontmatter, lessons: briefDisk.kept }, table),
        disk: briefDisk.text,
    }];
    const onDisk = diskStories(intent.stories);
    const seen = new Set();
    for (const s of record.stories) {
        const id = storyId(s.id);
        if (seen.has(id)) throw new Error(`${intent.record}: story id ${id} appears twice`);
        seen.add(id);
        const existing = onDisk.get(id);
        const name = storyFile(s);
        const content = renderStory(record, s, existing ? { frontmatter: existing.frontmatter, buildNotes: existing.kept } : {}, table);
        const file = path.join(intent.stories, name);
        files.push({ file, rel: `stories/${name}`, content, disk: existing && existing.name === name ? existing.text : (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null) });
    }
    const keep = new Set(files.map((f) => f.file));
    const remove = [...onDisk.values()]
        .filter((d) => !keep.has(d.file))
        .map((d) => {
            const id = d.frontmatter && d.frontmatter.id != null ? storyId(d.frontmatter.id) : null;
            const status = (d.frontmatter && d.frontmatter.status) || 'todo';
            // A renamed story carries its state to the new file, so the old one may go.
            const renamed = id !== null && seen.has(id);
            return { file: d.file, rel: `stories/${d.name}`, status, renamed, blocked: !renamed && status !== 'todo' };
        });
    return { files, remove };
}

/** Same frontmatter values (key order and quoting do not count) and the same body. */
function sameFile(a, b) {
    if (a === null || b === null) return a === b;
    const norm = (t) => String(t).replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    const split = (t) => {
        const n = norm(t);
        const m = /^---\n[\s\S]*?\n---\n?/.exec(n);
        return { fm: m ? extractFrontmatter(n) : null, body: m ? n.slice(m[0].length) : n };
    };
    const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
        ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
    const x = split(a);
    const y = split(b);
    return x.body === y.body && canon(x.fm) === canon(y.fm);
}

/** What --check reports: every rendered file that differs, is missing, or is extra. */
function checkPlan(plan) {
    const out = [];
    for (const f of plan.files) {
        if (f.disk === null) out.push({ file: f.rel, problem: 'missing' });
        else if (!sameFile(f.disk, f.content)) out.push({ file: f.rel, problem: 'differs' });
    }
    for (const r of plan.remove) out.push({ file: r.rel, problem: r.renamed ? 'renamed in the record' : 'not in the record' });
    return out;
}

/** Write the plan to disk. Returns what changed. Throws before writing anything when a started story would go. */
function applyPlan(intent, plan) {
    const blocked = plan.remove.filter((r) => r.blocked);
    if (blocked.length) {
        throw new Error(`the record drops stories that already started: ${blocked.map((b) => `${b.rel} (${b.status})`).join(', ')}. Put them back in the record, or set them to todo first.`);
    }
    fs.mkdirSync(intent.stories, { recursive: true });
    const result = { written: [], unchanged: [], removed: [] };
    for (const f of plan.files) {
        if (f.disk === f.content) { result.unchanged.push(f.rel); continue; }
        fs.writeFileSync(f.file, f.content);
        result.written.push(f.rel);
    }
    for (const r of plan.remove) {
        fs.rmSync(r.file);
        result.removed.push(r.rel);
    }
    return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = 'Usage: node .specsmd/aidlc-turbo/scripts/render-specs.cjs <intent> [--check] [--json] [--root .specs-aidlc-turbo]';

function parseArgs(argv) {
    const out = { positional: [], check: false, json: false, root: paths.ARTIFACT_DIR };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--check') out.check = true;
        else if (arg === '--json') out.json = true;
        else if (arg === '--root') { out.root = argv[i + 1] || paths.ARTIFACT_DIR; i += 1; }
        else if (arg === '--help' || arg === '-h') out.help = true;
        else if (arg.startsWith('--')) out.bad = arg;
        else out.positional.push(arg);
    }
    return out;
}

function main(argv) {
    const args = parseArgs(argv);
    if (args.help) { console.log(USAGE); return 0; }
    if (args.bad || args.positional.length !== 1) { console.error(args.bad ? `Unknown option ${args.bad}\n${USAGE}` : USAGE); return 2; }
    if (paths.isLegacy(args.root)) { console.error(paths.legacyMessage(args.root)); return 1; }
    const slug = args.positional[0];
    let intent;
    let plan;
    try {
        intent = paths.findIntent(args.root, slug);
        if (!intent) { console.error(`No intent "${slug}" under ${paths.layout(args.root).docs}`); return 1; }
        plan = planRender(intent);
    } catch (error) {
        console.error(error.message);
        return 1;
    }
    if (args.check) {
        const diffs = checkPlan(plan);
        if (args.json) console.log(JSON.stringify({ intent: slug, clean: diffs.length === 0, diffs }, null, 2));
        else if (diffs.length) {
            console.log(`${slug}: ${diffs.length} file(s) differ from record.yaml, run render-specs.cjs ${slug}`);
            diffs.forEach((d) => console.log(`  ${d.file}: ${d.problem}`));
        } else console.log(`${slug}: the specs match record.yaml`);
        return diffs.length ? 1 : 0;
    }
    let result;
    try {
        result = applyPlan(intent, plan);
    } catch (error) {
        console.error(`${slug}: ${error.message}`);
        return 1;
    }
    if (args.json) console.log(JSON.stringify({ intent: slug, dir: intent.dir, ...result }, null, 2));
    else {
        const stories = plan.files.length - 1;
        const parts = [`${result.written.length} written`, `${result.unchanged.length} unchanged`];
        if (result.removed.length) parts.push(`${result.removed.length} removed (${result.removed.join(', ')})`);
        console.log(`Rendered ${slug}: brief.md and ${stories} ${stories === 1 ? 'story' : 'stories'}, ${parts.join(', ')}`);
    }
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
    parseYaml,
    dumpYaml,
    storyId,
    storyFile,
    VIA,
    observedVia,
    testerVerifiable,
    viaSuffix,
    integrationLines,
    missingKeys,
    readRecord,
    renderBrief,
    renderStory,
    planRender,
    checkPlan,
    applyPlan,
    sameFile,
    sectionText,
    main,
};
