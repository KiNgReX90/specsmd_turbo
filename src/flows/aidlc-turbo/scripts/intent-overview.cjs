#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - intent overview.
 *
 * Renders one intent into a single HTML page the user reads in a browser, in
 * the language the record is written in (intent.language): every fixed text
 * of the page comes from the string table of that language (./lib/lang.cjs),
 * filled into the page's HTML and handed to its scripts as
 * <script id="turbo-text">. It writes the page into the intent folder:
 *
 *   .specs-aidlc-turbo/docs/{inception}/{intent}/overview.html
 *
 * The page is the one of templates/overview: buildData() below reads the
 * intent (record.yaml, the brief, the story files and the test cases) into the
 * data of that page, and lib/overview-page.cjs render() fills the template
 * with it, the drawing of templates/design inlined. Before the build its tabs
 * are Functional and Code Scaffold, after it Functional, Code and Review. A
 * section without data is left out.
 *
 * The C4 model of the v5 kit rides along inside it as a tab of its own: the
 * script builds the v5 model of lib/v5-model.cjs as well and
 * lib/overview-page.cjs withEmbed() stores its whole page, in the record's
 * language, in the old one as a JSON string, only when the model has a C4
 * context view.
 * Nothing on the page loads over the network but the fonts.
 *
 * Before the build (inception) the script then prints, one line each, what
 * lib/v5-missing.cjs finds missing of the new data (the C4 block
 * technical_design.c4 and the plain texts intent.plain and stories[].plain),
 * by its record path and its element, so an agent can write it. It never
 * fills a gap in and never changes the record: the page shows what the
 * records hold.
 *
 * After the build (construction) the page carries the build: the build block
 * of the Review tab (the deviations, the diffs, the merge requests), each
 * part's build and what changed in it. The script then prints only where the
 * build deviated from the Code Scaffold, as one line in the record's language
 * (lib/design-build.cjs buildLine), the line finish relays verbatim.
 *
 * With --plan (construction only) a change the user asked for at finish is
 * open: planned into the record, not built yet. The page stays the page after
 * the build, Review included, but the drawings show the plan with that change,
 * without the marks of the build over them (page.plan, model.plan): a part the
 * build added stands apart in design.build.parts, where only Review reads it.
 * The script prints no build line then.
 *
 * --scaffold writes the Code Scaffold page instead: the same page, opening on
 * the drawing, saved next to the specs as code-scaffold.html in the inception
 * phase and code-scaffold-built.html in construction, so the inception one is
 * never written over after the build. overview.html is left alone. Nothing is
 * written without a Code Scaffold: none drawn, a sandbox that switched it off
 * (`sandbox.code_scaffold: false`), or, after the build, one without its
 * update (`sandbox.scaffold_after_build: false`).
 *
 * In sandbox mode the config's `sandbox` block is read through story-start.cjs
 * readSettings: without the Code Scaffold the page has no drawing, and
 * without its update after the build the drawing stays as approved and no
 * build line is printed.
 *
 * Then it opens the page in the default browser, unless --no-open is given.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/intent-overview.cjs <intent> [--phase inception|construction] [--plan] [--scaffold] [--no-open] [--root .specs-aidlc-turbo]
 *
 * The phase is construction once the brief is building or done, unless
 * --phase says. Exit 0 ok (also with data missing: the page is written), 1
 * failure, 2 usage error (also --plan on the page before the build).
 *
 * Node builtins only, plus ./lib/paths.cjs and the libraries in ./lib (the
 * text helpers in overview-text.cjs, the reading of the intent in
 * overview-read.cjs, which uses ./frontmatter.cjs and the YAML reader of
 * ./render-specs.cjs): the target project often has no node_modules.
 * Git (run in the current directory) decides whether a file is new or
 * changed (the slices' roles new or changes); without git, the Code Scaffold
 * does for a file it draws, existence on disk for the rest.
 */

const fs = require('fs');
const path = require('path');
const paths = require('./lib/paths.cjs');
const lang = require('./lib/lang.cjs');
const { readSettings } = require('./story-start.cjs');
const { designModel } = require('./lib/design-model.cjs');
const { applyBuild, buildLine, buildNotesOf } = require('./lib/design-build.cjs');
const { addDiffs } = require('./lib/design-diffs.cjs');
const { addLinks } = require('./lib/review-links.cjs');
const { v5Model } = require('./lib/v5-model.cjs');
const { addBuild } = require('./lib/v5-model-build.cjs');
const { render, withEmbed } = require('./lib/overview-page.cjs');
const { missing, missingLines } = require('./lib/v5-missing.cjs');
const { openInBrowser } = require('./lib/open-browser.cjs');
const { present, list, storyId, plain, splitSummary, slug, inline, blocks } = require('./lib/overview-text.cjs');
const {
    readConfig, readYaml, readBrief, markdownWords, readStoryMarkdown, recordStory, recordCriteria,
    isTestFile, moduleOf, codeName, existedBefore, drawnFiles, readStories,
    field, storyFiles, readTestCases, readOutOfScope,
} = require('./lib/overview-read.cjs');

// The page's labels come from overview.labels of the string table; after the build the page says what happened,
// not what will: overview.labelsBuilt replaces its labels in construction.
const LABEL_GROUPS = ['phase', 'explain', 'cell', 'storyStatus', 'twinResult'];

/** Parse argv into positionals and flags. */
function parseArgs(argv) {
    const out = { positional: [], open: true, phase: null, plan: false, scaffold: false, root: paths.ARTIFACT_DIR };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--no-open') out.open = false;
        else if (arg === '--plan') out.plan = true;
        else if (arg === '--scaffold') out.scaffold = true;
        else if (arg === '--phase') { out.phase = argv[i + 1] || null; i += 1; }
        else if (arg === '--root') { out.root = argv[i + 1] || paths.ARTIFACT_DIR; i += 1; }
        else if (arg === '--help' || arg === '-h') out.help = true;
        else if (arg.startsWith('--')) out.bad = arg;
        else out.positional.push(arg);
    }
    return out;
}

const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The end word of the status band as the page shows it: a capital first, and every
 * end state written as its step writes it ("processed or failed" -> "Processed or Failed").
 */
function endWord(end, steps) {
    let text = plain(end);
    for (const s of steps) {
        const name = s.shape === 'state' ? plain(s.label) : '';
        if (name) text = text.replace(new RegExp(`(^|[^\\p{L}\\d])${reEsc(name)}(?![\\p{L}\\d])`, 'giu'), (m, pre) => pre + name);
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** record.overview.lifecycle, ready for the page data; null without steps. `statusLabel` names the lane of the status band. */
function mapLifecycle(lc, statusLabel = 'Status') {
    if (!lc || typeof lc !== 'object' || !list(lc.steps).length) return null;
    const steps = list(lc.steps).filter((s) => s && typeof s === 'object' && present(s.id));
    const states = list(lc.states).filter((s) => s && typeof s === 'object');
    const lanes = list(lc.lanes).filter((l) => l && typeof l === 'object' && present(l.id)).map((l) => {
        const id = String(l.id);
        const lane = { id, label: plain(l.label) || id };
        const rows = steps.filter((s) => String(s.lane) === id && present(s.row)).map((s) => Number(s.row));
        if (rows.length) lane.rows = Math.max(...rows) + 1;
        if (present(l.tone)) lane.tone = String(l.tone);
        return lane;
    });
    if (states.length) lanes.unshift({ id: 'status', label: statusLabel, bandOnly: true });
    const band = states.map((s, i) => {
        const last = i === states.length - 1;
        const tone = i === 0 ? 'a' : (last && (states.length >= 3 || present(s.end)) ? 'c' : 'b');
        const out = { from: Number(s.from) || 0, to: Number(s.to) || 0, label: plain(s.label), tone };
        if (present(s.tip)) out.tip = plain(s.tip);
        if (present(s.end)) out.end = endWord(s.end, steps);
        return out;
    });
    const nodes = steps.map((s) => ({
        id: String(s.id),
        lane: String(s.lane),
        row: present(s.row) ? Number(s.row) : 0,
        col: Number(s.col) || 0,
        label: plain(s.label),
        sub: plain(s.sub),
        stories: list(s.stories).map(storyId),
        shape: present(s.shape) ? String(s.shape) : 'process',
    }));
    const edges = list(lc.arrows).filter((a) => a && typeof a === 'object' && present(a.from) && present(a.to)).map((a) => ({
        from: String(a.from),
        to: String(a.to),
        kind: present(a.kind) ? String(a.kind) : 'main',
        label: present(a.label) ? plain(a.label) : null,
        fromSide: present(a.from_side) ? String(a.from_side) : null,
        toSide: present(a.to_side) ? String(a.to_side) : null,
        route: present(a.route) ? String(a.route) : null,
        fromOff: Number(a.from_offset) || 0,
        toOff: Number(a.to_offset) || 0,
    }));
    const u = lc.under_all;
    const wrap = u && typeof u === 'object' && present(u.story)
        ? { story: storyId(u.story), label: plain(u.label), tip: plain(u.tip) }
        : null;
    return { subject: plain(lc.subject), lanes, band, nodes, edges, wrap };
}

/** What a story delivers, in one plain line: its drawing's summary. */
const sliceDelivers = (s) => plain(s.rec && s.rec.drawing && s.rec.drawing.summary);

/** The record's slice values, new | used: the story makes the layer, or uses (or changes) it. */
const SLICE_VALUES = new Set(['new', 'used']);

/** The code names a layer's tip mentions (CamelCase, snake_case or with digits), lower case. */
const layerNames = (tip) => String(tip || '').split(/[\s,;]+/)
    .filter((t) => /[a-z][A-Z]|_|\d/.test(t)).map((t) => t.toLowerCase());

/** A file's own name without extensions, and its folder's name, lower case. */
const fileNames = (file) => {
    const p = String(file || '').split('/').filter(Boolean);
    return p.slice(-2).map((x, i, a) => (i === a.length - 1 ? x.replace(/\..*$/, '') : x).toLowerCase());
};

/**
 * Groups, layers and slices from record.overview.layers and the stories' slice. A slice cell is
 * { role: new | changes | uses, note }: a layer the slice calls `used` changes when the story touches one of
 * its files or its drawing builds one of its parts; the note is what it builds there. `other` names the group
 * of a layer without one.
 */
function recordLayers(layerList, stories, record, other = 'Other') {
    const groups = [];
    const layers = layerList.filter((l) => l && typeof l === 'object' && present(l.id)).map((l) => {
        const label = plain(l.group) || other;
        const group = slug(label);
        if (!groups.some((g) => g.id === group)) groups.push({ id: group, label });
        return { id: String(l.id), group, label: plain(l.label) || String(l.id), tip: plain(l.tip) };
    });
    const tipOf = new Map(layerList.filter((l) => l && present(l.id)).map((l) => [String(l.id), layerNames(l.tip)]));
    const td = record && record.technical_design && record.technical_design.drawing;
    const parts = new Map(list(td && td.parts).filter((p) => p && present(p.id)).map((p) => [String(p.id), p]));
    const hits = (names, file, name) => names.length
        && (fileNames(file).some((n) => names.includes(n)) || (present(name) && names.includes(String(name).toLowerCase())));
    const slices = {};
    for (const s of stories) {
        const slice = s.rec && s.rec.slice && typeof s.rec.slice === 'object' ? s.rec.slice : {};
        const builds = s.rec && s.rec.drawing && s.rec.drawing.builds && typeof s.rec.drawing.builds === 'object' ? s.rec.drawing.builds : {};
        const files = storyFiles(s).filter((f) => !isTestFile(f));
        const cells = {};
        for (const [layer, value] of Object.entries(slice)) {
            const v = String(value).trim();
            if (!SLICE_VALUES.has(v)) continue;
            const names = tipOf.get(layer) || [];
            const notes = [];
            for (const [pid, what] of Object.entries(builds)) {
                const p = parts.get(pid);
                if (p && hits(names, p.path, p.name) && present(what) && !notes.includes(plain(what))) notes.push(plain(what));
            }
            const touched = notes.length || files.some((f) => hits(names, f));
            cells[layer] = { role: v === 'new' ? 'new' : touched ? 'changes' : 'uses', note: notes.join('; ') };
        }
        if (Object.keys(cells).length) slices[s.id] = { delivers: sliceDelivers(s), cells };
    }
    return { groups, layers, slices };
}

/** Layers derived for a record without overview.layers: one per table, one per code module, the groups named by `names`. */
function derivedLayers(stories, names = { tables: 'Tables', code: 'Code' }) {
    const tables = [];
    const modules = [];
    const slices = {};
    const RANK = { uses: 1, changes: 2, new: 3 };
    const cell = (s, layer, role) => {
        slices[s.id] = slices[s.id] || { delivers: sliceDelivers(s), cells: {} };
        const had = slices[s.id].cells[layer];
        if (!had || RANK[role] > RANK[had.role]) slices[s.id].cells[layer] = { role, note: '' };
    };
    for (const s of stories) {
        for (const table of s.tables) {
            const id = `t-${slug(table)}`;
            if (!tables.some((l) => l.id === id)) tables.push({ id, group: 'tables', label: table, tip: '' });
            cell(s, id, 'uses');
        }
        for (const c of s.page.code) {
            const id = `c-${slug(c.module)}`;
            if (!modules.some((l) => l.id === id)) modules.push({ id, group: 'code', label: c.module, tip: '' });
            cell(s, id, c.kind === 'new' ? 'new' : 'changes');
        }
    }
    const groups = [];
    if (tables.length) groups.push({ id: 'tables', label: names.tables });
    if (modules.length) groups.push({ id: 'code', label: names.code });
    return { groups, layers: [...tables, ...modules], slices };
}

function now() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * While a change is open (--plan) the drawing is the plan: a part the build added is no part of it. It leaves
 * design.parts for design.build.parts, an object by id, where only the Review tab reads it. The same rule as on
 * the v5 model (lib/v5-model-build.cjs partsBuilt).
 */
function partsApart(design) {
    if (!design || !design.build || !Array.isArray(design.parts)) return;
    const apart = (design.build.parts = {});
    design.parts = design.parts.filter((p) => {
        if (!p || !p.build || p.build.state !== 'added') return true;
        if (p.id) apart[p.id] = p;
        return false;
    });
}

/**
 * Build the data of the page, for one intent from paths.findIntent. Returns { page, settings, table }:
 * settings as story-start.cjs readSettings gives them for this intent, table the string table of the record's
 * language. opts.plan: a change the user asked for is open, the drawing shows the plan (page.plan).
 */
function buildData(root, intent, phaseArg, opts = {}) {
    const { testerEnabled } = readConfig(root);
    const record = readYaml(intent.record) || {};
    const table = lang.forRecord(record, root);
    const T = (key, vars) => lang.text(table, key, vars);
    const words = markdownWords(table);
    const brief = readBrief(intent);
    const settings = readSettings(root, brief.data);
    const status = String(brief.data.status || 'draft');
    const phase = phaseArg || (status === 'done' || status === 'building' ? 'construction' : 'inception');
    const recIntent = record.intent && typeof record.intent === 'object' ? record.intent : {};
    const title = plain(brief.data.title || recIntent.title || intent.slug);

    const raw = readStories(intent, record);
    const allFiles = raw.map((s) => ({ s, files: storyFiles(s) }));
    const existed = existedBefore(intent.record, [...new Set(allFiles.flatMap((x) => x.files.filter((f) => !isTestFile(f))))], drawnFiles(record));
    const tests = phase === 'construction' && testerEnabled ? readTestCases(intent) : [];

    for (const { s, files } of allFiles) {
        const product = s.rec && s.rec.product;
        const fromMd = s.body ? readStoryMarkdown(s.body, table) : { story: null, why: null, criteria: [] };
        const storyTitle = plain(field(s, 'title') || s.slug);
        s.tables = list(field(s, 'db_tables')).filter(present).map((t) => plain(t));
        s.page = {
            id: s.id,
            slug: s.slug,
            title: storyTitle,
            short: plain(s.rec && s.rec.short) || storyTitle,
            status: String(s.data.status || 'todo'),
            depends_on: list(field(s, 'depends_on')).map(storyId),
            story: recordStory(product) || fromMd.story,
            why: plain(product && product.why) || fromMd.why,
            criteria: recordCriteria(product, words) || fromMd.criteria,
            code: files.filter((f) => !isTestFile(f)).map((f) => ({
                module: moduleOf(f, T('overview.rootFolder')),
                name: codeName(f),
                path: f,
                kind: existed.has(f) ? 'changes' : 'new',
            })),
            testFiles: files.filter(isTestFile).length,
            tests: tests.filter((tc) => tc.story === s.slug || tc.testId === `US-${s.id}`)
                .map(({ story, ...tc }) => tc),
            // the story in plain words, for the page's Details
            ...(present(s.rec && s.rec.plain) ? { plain: plain(s.rec.plain) } : {}),
        };
    }

    const lifecycle = mapLifecycle(record.overview && record.overview.lifecycle, T('overview.status'));
    const layerList = list(record.overview && record.overview.layers);
    const { groups, layers, slices } = layerList.length ? recordLayers(layerList, raw, record, T('overview.other'))
        : derivedLayers(raw, { tables: T('overview.tables'), code: T('overview.code') });
    const integration = require('./lib/integration-tests.cjs').integrationTests(raw, record, { plain, storyId, present, table });
    const intentText = present(record.purpose) ? record.purpose : brief.intentText;
    // after the build the drawing stays as approved, its reasons told in the past; where the build deviated is computed next to it,
    // unless a sandbox switched the update after the build off; a sandbox without the Code Scaffold has no drawing at all
    const asBuilt = phase === 'construction' && settings.scaffoldAfterBuild;
    const design = settings.codeScaffold ? designModel(record, { built: asBuilt, table }) : null;
    const plan = !!opts.plan && phase === 'construction';
    if (design && asBuilt) {
        applyBuild(design, raw.filter((s) => list(field(s, 'changed_files')).length)
            .map((s) => ({ id: s.id, files: storyFiles(s).filter((f) => !isTestFile(f)), notes: s.body })), table);
        // what the build changed in each part's file, for its details on the page
        addDiffs(design, { root, brief: brief.data });
        addLinks(design, { brief: brief.data, stories: raw });
        // the drawing reads the flag on the design it is handed (design-panel.js, design-engine.js)
        if (plan) { partsApart(design); design.plan = true; }
    }
    // after the build every story says in its builder's words what it built (the Built line of its notes)
    if (phase === 'construction') for (const s of raw) s.page.built = buildNotesOf(s.body).built;
    const groupsOf = (key) => (table.overview && table.overview[key]) || {};
    const labels = JSON.parse(JSON.stringify(Object.fromEntries(LABEL_GROUPS.map((k) => [k, groupsOf('labels')[k] || {}]))));
    labels.more = T('overview.more');
    if (phase === 'construction') for (const k of LABEL_GROUPS) Object.assign(labels[k], groupsOf('labelsBuilt')[k] || {});
    labels.explain.flow = String(labels.explain.flow || '').replace('{subject}', (lifecycle && lifecycle.subject) || title);
    // built only once it is: the brief closed at finish, or every story done; else the masthead says it is being built
    if (phase === 'construction' && status !== 'done' && raw.some((s) => s.page.status !== 'done')) labels.phase.construction = labels.storyStatus.building;

    return {
        page: {
            lang: table.lang,
            phase,
            ...(plan ? { plan: true } : {}),
            generated: now(),
            source: path.relative(process.cwd(), intent.dir) || intent.dir,
            labels,
            intent: {
                id: intent.slug,
                title,
                status,
                branch: present(brief.data.branch) ? String(brief.data.branch) : null,
                ...splitSummary(intentText),
                // the intent in plain words, for the page's Details
                ...(present(recIntent.plain) ? { plain: plain(recIntent.plain) } : {}),
                // what the intent built, in the words finish wrote into the brief when it closed it
                ...(phase === 'construction' && present(brief.data.built) ? { built: plain(brief.data.built) } : {}),
            },
            stories: raw.map((s) => s.page),
            lifecycle,
            groups,
            layers,
            slices,
            integration,
            outOfScope: readOutOfScope(root, intent, record),
            design,
        },
        settings,
        table,
    };
}

const USAGE = 'Usage: node .specsmd/aidlc-turbo/scripts/intent-overview.cjs <intent> [--phase inception|construction] [--plan] [--scaffold] [--no-open] [--root .specs-aidlc-turbo]';

/** The phase the page is made for: --phase, else construction once the brief is building or done. */
function phaseOf(intent, phaseArg) {
    if (phaseArg) return phaseArg;
    const status = String(readBrief(intent).data.status || 'draft');
    return status === 'done' || status === 'building' ? 'construction' : 'inception';
}

/**
 * The Code Scaffold page for this page's phase: { file } to write, or
 * { none } saying why nothing is written. Never the inception file after the
 * build.
 */
function scaffoldTarget(intent, page, settings) {
    if (!settings.codeScaffold) return { none: 'the Code Scaffold is off in this sandbox (sandbox.code_scaffold: false)' };
    if (!page.design) return { none: 'the intent has no Code Scaffold' };
    if (page.phase !== 'construction') return { file: intent.scaffold };
    if (!settings.scaffoldAfterBuild) return { none: 'the Code Scaffold is not updated after the build in this sandbox (sandbox.scaffold_after_build: false)' };
    return { file: intent.scaffoldBuilt };
}

/** The v5 model of the phase, for the two embedded tabs. */
function modelOf(root, intent, phase, plan) {
    return phase === 'inception' ? v5Model(root, intent, 'inception') : v5Model(root, intent, 'construction', { afterBuild: addBuild, plan });
}

/** The page before the build, with the embedded C4 model, and one line per piece of new data the record lacks. */
function writeBefore(root, intent) {
    const { page, table } = buildData(root, intent, 'inception');
    fs.writeFileSync(intent.overview, withEmbed(render(page, table), modelOf(root, intent, 'inception'), table));
    const gaps = missing(readYaml(intent.record) || {}, { intent: intent.slug });
    return { file: intent.overview, lines: missingLines(gaps).map((line) => `Missing: record.yaml ${line}`) };
}

/**
 * The page after the build, with the embedded C4 model, and the one line of where the build deviated.
 * `plan`: a change is open, the drawings show the plan and no line is printed; nor is it when a sandbox keeps the
 * Code Scaffold as approved.
 */
function writeAfter(root, intent, plan) {
    const model = modelOf(root, intent, 'construction', plan);
    const { page, settings, table } = buildData(root, intent, 'construction', { plan });
    fs.writeFileSync(intent.overview, withEmbed(render(page, table), model, table));
    const built = !plan && settings.scaffoldAfterBuild && page.design && model.build;
    return { file: intent.overview, lines: built ? [buildLine(model.build, table)] : [] };
}

/** The Code Scaffold page of the phase: the same page opening on the drawing, or why none is written. */
function writeScaffold(root, intent, phase, plan) {
    const { page, settings, table } = buildData(root, intent, phase, { plan });
    const target = scaffoldTarget(intent, page, settings);
    if (target.none) return { none: target.none };
    fs.writeFileSync(target.file, withEmbed(render({ ...page, scaffold: true }, table), modelOf(root, intent, phase, plan), table));
    return { file: target.file, lines: [] };
}

function main(argv) {
    const args = parseArgs(argv);
    if (args.help) { console.log(USAGE); return 0; }
    if (args.bad || args.positional.length !== 1 || (args.phase && !['inception', 'construction'].includes(args.phase))) {
        console.error(args.bad ? `Unknown option ${args.bad}\n${USAGE}` : USAGE);
        return 2;
    }
    if (paths.isLegacy(args.root)) { console.error(paths.legacyMessage(args.root)); return 1; }
    const slugArg = args.positional[0];
    let intent;
    try {
        intent = paths.findIntent(args.root, slugArg);
    } catch (error) {
        console.error(error.message);
        return 1;
    }
    if (!intent || !fs.existsSync(intent.brief)) {
        console.error(`No brief found for intent "${slugArg}" under ${paths.layout(args.root).docs}`);
        return 1;
    }
    const phase = phaseOf(intent, args.phase);
    if (args.plan && phase !== 'construction') {
        console.error(`--plan draws the plan on the page after the build: it needs the construction phase\n${USAGE}`);
        return 2;
    }
    let done;
    try {
        if (args.scaffold) done = writeScaffold(args.root, intent, phase, args.plan);
        else done = phase === 'inception' ? writeBefore(args.root, intent) : writeAfter(args.root, intent, args.plan);
    } catch (error) {
        console.error(`No ${args.scaffold ? 'Code Scaffold page' : 'overview'} written for "${intent.slug}": ${error.message}`);
        return 1;
    }
    if (done.none) { console.log(`Code Scaffold page: not written, ${done.none}`); return 0; }
    const opened = args.open && openInBrowser(done.file);
    console.log(`${args.scaffold ? 'Code Scaffold page' : 'Overview'}: ${done.file}${opened ? ' (opened in the browser)' : ''}`);
    for (const line of done.lines) console.log(line);
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { buildData, render, scaffoldTarget, readStoryMarkdown, blocks, inline, plain, main };
