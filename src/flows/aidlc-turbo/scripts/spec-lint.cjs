#!/usr/bin/env node

/**
 * specsmd AI-DLC Turbo - spec lint, the hard gate before the approval.
 *
 * Checks one intent's brief and stories for form and coverage, and prints one
 * finding per line as "file: message" (paths relative to the intent folder).
 *
 * Form:
 *   - brief and story frontmatter: required fields and their values
 *   - story file names ({SSS}-{slug}.md), ids unique and matching the name
 *   - depends_on: every target exists, no cycle
 *   - the brief's Story map matches the story files
 *   - every requirement is delivered by a story, every story names a known one
 *   - the fixed headings are there, in the record's language (intent.language,
 *     ./lib/lang.cjs), no heading is empty, no TBD or TODO
 *   - lane quick: at most 2 stories, none hard
 *   - every story has `touches`; two stories that can build at the same time
 *     (no depends_on path between them) never touch the same file
 *   - a story's frontmatter `observed_via` has one value per criterion bullet
 *   - the specs match record.yaml (render-specs.cjs --check)
 *
 * Testing, on the record's criteria:
 *   - criteria-via: every criterion is given, when and then with
 *     `observed_via` ui, api, db, log or none; none with exactly one of
 *     `why_none` or `covered_by`, and covered_by names another story of this
 *     intent with a criterion that is not none
 *   - tester-verifiable: a `tester_verifiable` the record still gives equals
 *     the one render derives from the criteria
 *   - break-test: break_test true needs a criterion observed via ui or api.
 *     A story whose criteria carry no observed_via at all (written before the
 *     field) keeps the old rule: a ui or api surface
 *   - twin-dir: no `touches` entry and no test plan names a path under
 *     aidlc-twins/, the folder the test writer owns at finish
 *
 * The overview data, on the record (all optional: a record without it is clean):
 *   - layers: every `overview.layers` entry has an id, no id twice
 *   - slice: every key of a story's `slice` is a layer id, every value
 *     new or used
 *   - integration: every entry names with `with` another story of this
 *     intent that the story reaches through depends_on, directly or through
 *     other stories, so it lands first; at most one entry per story; `test`
 *     filled
 *   - lifecycle: step ids unique, every step on a lane id, every arrow end a
 *     step id, every story a step or `under_all` names a story of this intent
 *   - short: a story's `short` at most 24 characters, a deliberately_not `short` at most 60
 *     (integration, lifecycle and short: lib/overview-lint.cjs)
 *   - drawing and c4: the Code Scaffold (lib/design-lint.cjs), the C4 model and plain texts (lib/c4-lint.cjs)
 *
 * In sandbox mode the config can switch the Code Scaffold off (story-start.cjs
 * readSettings): with `sandbox.code_scaffold: false` the drawing rule is
 * skipped. A part that is off is never checked and never demanded.
 *
 * Coverage, from docs/{inception}/register.yaml:
 *   - every current register id is cited by a requirement or a story
 *     (`sources`), or sits in the record's deliberately_not with a reason
 *   - every cited id exists and is not stale
 * Without a register (no docs synced) coverage is skipped with a note.
 *
 * Usage:
 *   node .specsmd/aidlc-turbo/scripts/spec-lint.cjs <intent> [--json] [--root .specs-aidlc-turbo]
 *
 * --json prints [{ file, rule, message }]. Exit 0 clean, 1 findings or
 * failure, 2 usage error.
 *
 * Node builtins only, plus ./frontmatter.cjs, ./lib/paths.cjs, ./lib/lang.cjs,
 * the checks in ./lib (overview-lint.cjs, design-lint.cjs, c4-lint.cjs), the
 * pure functions of ./render-specs.cjs and ./source-register.cjs, and the
 * config reader of ./story-start.cjs.
 */

const fs = require('fs');
const path = require('path');
const { extractFrontmatter } = require('./frontmatter.cjs');
const paths = require('./lib/paths.cjs');
const render = require('./render-specs.cjs');
const { readRegister } = require('./source-register.cjs');
const { lintDrawing, diskFsx } = require('./lib/design-lint.cjs');
const { lintC4 } = require('./lib/c4-lint.cjs');
const { lintOverview, reach, filled, asList } = require('./lib/overview-lint.cjs');
const { readSettings } = require('./story-start.cjs');
const lang = require('./lib/lang.cjs');

const BRIEF_STATUS = ['draft', 'approved', 'building', 'done'];
const STORY_STATUS = ['todo', 'building', 'review', 'done', 'blocked'];
const LANES = ['full', 'quick'];
const MODES = ['production', 'sandbox'];
const COMPLEXITY = ['low', 'medium', 'hard'];
const SURFACES = ['ui', 'api', 'job', 'data', 'none'];
const VIA = render.VIA;
const TWIN_PATH = /(?:^|[^\w.-])aidlc-twins\//;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQ_ID = /^(FR|NFR)-\d+$/;
const SOURCE_ID = /^S-\d+$/;

const BRIEF_SECTIONS = ['Intent', 'Requirements', 'Design decisions', 'Domain model', 'Technical design',
    'Codebase reading list', 'Standards deltas', 'Verification', 'Lessons', 'Story map'];
/** The fixed headings of a story, in order: the product half in the words of `table`, the agent half in English. */
const storyHeadings = (table) => [`## ${lang.text(table, 'md.product')}`, `### ${lang.text(table, 'md.criteria')}`, `### ${lang.text(table, 'md.outOfScope')}`,
    '## For the agent', '### Context to read', '### Design', '### Implementation notes', '### Edge cases and errors', '### Test plan', '### Build notes'];
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const PLACEHOLDER_CASED = /\bTBD\b|\bTODO\b/;

function readSpec(file) {
    const raw = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
    const m = /^---\n[\s\S]*?\n---\n?/.exec(raw);
    return { raw, fm: m ? (extractFrontmatter(raw) || {}) : null, body: m ? raw.slice(m[0].length) : raw };
}

const arr = (v) => (Array.isArray(v) ? v.map(String) : []);
const normPath = (p) => String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '');

/** Findings for headings with nothing under them before the next heading of the same or a higher level. */
function emptyHeadings(body) {
    const lines = body.split('\n');
    const out = [];
    let fence = false;
    const heads = [];
    lines.forEach((l, i) => {
        if (/^\s*(```|~~~)/.test(l)) fence = !fence;
        const m = !fence && /^(#{1,6})\s+(.+?)\s*$/.exec(l);
        if (m) heads.push({ i, level: m[1].length, text: m[2] });
    });
    heads.forEach((h, k) => {
        const next = heads[k + 1];
        const end = next ? next.i : lines.length;
        const hasText = lines.slice(h.i + 1, end).some((l) => l.trim() && !/^-{3,}$/.test(l.trim()));
        if (!hasText && (!next || next.level <= h.level)) out.push(h.text);
    });
    return out;
}

/** Placeholders outside the frontmatter's `status: todo`: TBD and TODO in capitals, "to be decided" in any case. */
function placeholders(raw) {
    return raw.split('\n').map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => PLACEHOLDER_CASED.test(l) || /\bto be decided\b/i.test(l)).map(({ n }) => n);
}

function sectionsOf(body, level) {
    const marker = '#'.repeat(level);
    const out = [];
    let cur = null;
    for (const line of body.split('\n')) {
        const m = new RegExp(`^${marker}\\s+(.+?)\\s*$`).exec(line);
        if (m && !line.startsWith(`${marker}#`)) { cur = { heading: m[1], text: '' }; out.push(cur); } else if (cur) cur.text += `${line}\n`;
    }
    return out;
}

function tableRows(text) {
    return text.split('\n').filter((l) => /^\s*\|/.test(l))
        .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|')))
        .filter((cells) => !cells.every((c) => /^:?-{3,}:?$/.test(c)))
        .slice(1);
}

const listCell = (c) => (c === '-' || c === '' ? [] : c.split(',').map((x) => x.trim()).filter(Boolean));

function findCycle(deps) {
    const state = new Map();
    const stack = [];
    let found = null;
    const visit = (id) => {
        if (found) return;
        state.set(id, 1);
        stack.push(id);
        for (const d of deps.get(id) || []) {
            if (!deps.has(d)) continue;
            if (state.get(d) === 1) { found = [...stack.slice(stack.indexOf(d)), d]; return; }
            if (!state.has(d)) visit(d);
            if (found) return;
        }
        stack.pop();
        state.set(id, 2);
    };
    for (const id of deps.keys()) if (!state.has(id) && !found) visit(id);
    return found;
}


/** Every string inside a record value, one per line. */
function textOf(v) {
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) return v.map(textOf).join('\n');
    if (typeof v === 'object') return Object.values(v).map(textOf).join('\n');
    return String(v);
}

/** True when the story has criteria and every one is observed via none. */
function allNone(story) {
    const criteria = asList(story.product && story.product.criteria);
    return criteria.length > 0 && criteria.every((c) => c && typeof c === 'object' && String(c.observed_via).trim() === 'none');
}

/**
 * The testing rules, on the record's criteria: where a tester checks each
 * criterion, the derived tester_verifiable, a break_test the criteria allow,
 * and no twin path in a story. Returns the ids of the stories whose criteria
 * carry observed_via at all; the others keep the old break_test rule.
 */
function lintTesting(record, add) {
    const withVia = new Set();
    const stories = asList(record.stories).filter((s) => s && typeof s === 'object' && filled(s.id));
    const byId = new Map(stories.map((s) => [render.storyId(s.id), s]));
    for (const s of stories) {
        const id = render.storyId(s.id);
        const file = filled(s.slug) ? `stories/${render.storyFile(s)}` : 'record.yaml';
        const note = (rule, message) => add(file, rule, file === 'record.yaml' ? `story ${id}: ${message}` : message);
        const criteria = asList(s.product && s.product.criteria);
        let reachable = false;
        criteria.forEach((c, j) => {
            const at = `criterion ${j + 1}`;
            if (!c || typeof c !== 'object' || Array.isArray(c)) {
                note('criteria-via', `${at} is a plain line: write it as given, when and then, with observed_via`);
                return;
            }
            if (!filled(c.observed_via)) {
                note('criteria-via', `${at} has no observed_via: say where a tester checks it, one of ${VIA.join(', ')}`);
                return;
            }
            withVia.add(id);
            const via = String(c.observed_via).trim();
            if (!VIA.includes(via)) {
                note('criteria-via', `${at}: observed_via is "${via}", expected one of ${VIA.join(', ')}`);
                return;
            }
            if (via === 'ui' || via === 'api') reachable = true;
            const why = filled(c.why_none);
            const cover = filled(c.covered_by);
            if (via !== 'none') {
                if (why || cover) note('criteria-via', `${at} is observed via ${via}: why_none and covered_by go only with none`);
                return;
            }
            if (!why && !cover) note('criteria-via', `${at} is observed via none without why_none or covered_by: give exactly one`);
            if (why && cover) note('criteria-via', `${at} has both why_none and covered_by: give exactly one`);
            if (why && /[()]/.test(String(c.why_none))) {
                note('criteria-via', `${at}: why_none holds a parenthesis, which ends the tester note on the overview page: write it without one`);
            }
            if (cover) {
                const target = render.storyId(c.covered_by);
                if (target === id) note('criteria-via', `${at}: covered_by names this story itself`);
                else if (!byId.has(target)) note('criteria-via', `${at}: covered_by names story ${target}, which is not a story of this intent`);
                else if (allNone(byId.get(target))) note('criteria-via', `${at}: covered_by names story ${target}, whose criteria are all none, so no test case of it covers this`);
            }
        });

        const given = s.tester_verifiable;
        if (render.observedVia(s) && given !== undefined && given !== null && given !== render.testerVerifiable(s)) {
            note('tester-verifiable', `tester_verifiable is ${JSON.stringify(given)} in the record but the criteria make it ${render.testerVerifiable(s)}: leave the key out, render-specs.cjs derives it`);
        }
        if (s.break_test === true && withVia.has(id) && !reachable) {
            note('break-test', 'break_test is true but no criterion is observed via ui or api: the breaker only attacks a screen or an API');
        }
        for (const t of asList(s.touches)) {
            const p = String(t).trim().replace(/\\/g, '/');
            if (p.split('/').includes('aidlc-twins')) {
                note('twin-dir', `touches names ${p}: aidlc-twins/ belongs to the test writer at finish, a story's Playwright spec goes next to the project's own specs`);
            }
        }
        if (TWIN_PATH.test(textOf(s.agent && s.agent.test_plan).replace(/\\/g, '/'))) {
            note('twin-dir', 'the test plan names a path under aidlc-twins/: that folder belongs to the test writer at finish, a story\'s Playwright spec goes next to the project\'s own specs');
        }
    }
    return withVia;
}

/**
 * Lint one intent. Returns { findings: [{file, rule, message}], notes: [] }.
 * Pure over the files on disk: nothing is written.
 */
function lintIntent(intent, root) {
    const findings = [];
    const notes = [];
    const add = (file, rule, message) => findings.push({ file, rule, message });

    // --- the record, and render --check -----------------------------------
    let record = null;
    try {
        record = render.readRecord(intent);
    } catch (error) {
        add('record.yaml', 'record', error.message.replace(`${intent.record}: `, ''));
    }
    if (record) {
        try {
            for (const d of render.checkPlan(render.planRender(intent, record))) {
                add(d.file, 'render-check', `${d.problem}: the specs differ from record.yaml, fix the record and run render-specs.cjs ${intent.slug}`);
            }
        } catch (error) {
            add('record.yaml', 'record', error.message.replace(`${intent.record}: `, ''));
        }
    }

    // --- where a tester checks each criterion, on the record ---------------
    const withVia = record && typeof record === 'object' ? lintTesting(record, add) : new Set();

    // --- the overview data and the Code Scaffold, on the record -----------
    // a part a sandbox switched off is neither checked nor demanded
    const settings = readSettings(root, fs.existsSync(intent.brief) ? readSpec(intent.brief).fm || {} : {});
    if (record && typeof record === 'object') {
        lintOverview(record, add);
        if (settings.codeScaffold) lintDrawing(record, add, diskFsx(process.cwd()));
        lintC4(record, add);
    }

    // --- the brief ---------------------------------------------------------
    const requirementIds = [];
    const cited = [];
    let mapRows = null;
    let lane = null;
    if (!fs.existsSync(intent.brief)) {
        add('brief.md', 'missing', `missing, run render-specs.cjs ${intent.slug}`);
    } else {
        const brief = readSpec(intent.brief);
        const fm = brief.fm;
        if (!fm) add('brief.md', 'frontmatter', 'no frontmatter');
        else {
            if (fm.id !== intent.slug) add('brief.md', 'frontmatter', `id is "${fm.id}", expected "${intent.slug}"`);
            if (!fm.title) add('brief.md', 'frontmatter', 'title is missing');
            if (!BRIEF_STATUS.includes(fm.status)) add('brief.md', 'frontmatter', `status must be one of ${BRIEF_STATUS.join(', ')}`);
            if (!LANES.includes(fm.lane)) add('brief.md', 'frontmatter', `lane must be one of ${LANES.join(', ')}`);
            lane = fm.lane;
            if (!DATE.test(String(fm.created))) add('brief.md', 'frontmatter', 'created must be a YYYY-MM-DD date');
            if (fm.mode !== null && fm.mode !== undefined && !MODES.includes(fm.mode)) add('brief.md', 'frontmatter', `mode must be null or one of ${MODES.join(', ')}`);
            for (const k of ['approved', 'completed']) {
                if (fm[k] !== null && fm[k] !== undefined && !DATE.test(String(fm[k]))) add('brief.md', 'frontmatter', `${k} must be null or a YYYY-MM-DD date`);
            }
        }
        const top = sectionsOf(brief.body, 2);
        const headings = top.map((s) => s.heading);
        const missing = BRIEF_SECTIONS.filter((h) => !headings.includes(h));
        missing.forEach((h) => add('brief.md', 'heading', `section "## ${h}" is missing`));
        if (!missing.length && BRIEF_SECTIONS.some((h, i) => headings.indexOf(h) < headings.indexOf(BRIEF_SECTIONS[Math.max(0, i - 1)]))) {
            add('brief.md', 'heading', `sections out of order, expected: ${BRIEF_SECTIONS.join(', ')}`);
        }
        const reqSection = top.find((s) => s.heading === 'Requirements');
        for (const line of (reqSection ? reqSection.text : '').split('\n').filter((l) => /^\s*-\s/.test(l))) {
            const m = /^\s*-\s+\*\*([^*]+?)\*\*:?\s*(.*)$/.exec(line);
            if (!m) { add('brief.md', 'requirement', `requirement line without a bold id: "${line.trim()}"`); continue; }
            const id = m[1].replace(/:$/, '');
            if (!REQ_ID.test(id)) add('brief.md', 'requirement', `${id}: ids are FR-n or NFR-n`);
            if (requirementIds.includes(id)) add('brief.md', 'requirement', `${id} appears twice`);
            requirementIds.push(id);
            const src = /\bSources?:\s*(.+)$/.exec(m[2]);
            const sources = src ? src[1].split(',').map((x) => x.trim()).filter(Boolean) : [];
            if (!sources.length) add('brief.md', 'requirement', `${id} has no Sources`);
            sources.filter((s) => SOURCE_ID.test(s)).forEach((s) => cited.push({ id: s, file: 'brief.md', by: id }));
        }
        if (reqSection && !requirementIds.length) add('brief.md', 'requirement', 'no requirements');
        const ver = top.find((s) => s.heading === 'Verification');
        if (ver && !/`[^`]+`/.test(ver.text)) add('brief.md', 'verification', 'no verification command');
        const map = top.find((s) => s.heading === 'Story map');
        mapRows = map ? tableRows(map.text) : [];
        emptyHeadings(brief.body).forEach((h) => add('brief.md', 'empty-heading', `"${h}" is empty, write None.`));
        placeholders(brief.raw).forEach((n) => add('brief.md', 'placeholder', `line ${n}: TBD, TODO or "to be decided"`));
    }

    // --- the stories, their product half in the words of the record's language
    const table = lang.forRecord(record, root);
    const headings = storyHeadings(table);
    const criteriaHeading = lang.text(table, 'md.criteria');
    const [asA, iWant, soThat] = ['md.asA', 'md.iWant', 'md.soThat'].map((k) => lang.text(table, k));
    const storyLine = new RegExp(`\\*\\*${reEsc(asA)}\\*\\*.+\\*\\*${reEsc(iWant)}\\*\\*.+\\*\\*${reEsc(soThat)}\\*\\*`);
    const stories = [];
    const files = fs.existsSync(intent.stories) ? fs.readdirSync(intent.stories).filter((f) => f.endsWith('.md')).sort() : [];
    if (!files.length) add('stories/', 'missing', 'no story files');
    for (const name of files) {
        const rel = `stories/${name}`;
        const nm = /^(\d{3})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(name);
        if (!nm) add(rel, 'file-name', 'file name must be {SSS}-{slug}.md: three digits, a lowercase hyphenated slug');
        const spec = readSpec(path.join(intent.stories, name));
        const fm = spec.fm;
        if (!fm) { add(rel, 'frontmatter', 'no frontmatter'); continue; }
        const id = fm.id === undefined || fm.id === null ? null : render.storyId(fm.id);
        if (!id || !/^\d{3}$/.test(id)) add(rel, 'frontmatter', 'id must be a 3-digit string');
        else if (nm && nm[1] !== id) add(rel, 'id', `id "${id}" does not match the file name`);
        if (!fm.title) add(rel, 'frontmatter', 'title is missing');
        if (fm.intent !== intent.slug) add(rel, 'frontmatter', `intent is "${fm.intent}", expected "${intent.slug}"`);
        if (!STORY_STATUS.includes(fm.status)) add(rel, 'frontmatter', `status must be one of ${STORY_STATUS.join(', ')}`);
        if (!COMPLEXITY.includes(fm.complexity)) add(rel, 'frontmatter', `complexity must be one of ${COMPLEXITY.join(', ')}`);
        if (!SURFACES.includes(fm.surface)) add(rel, 'frontmatter', `surface must be one of ${SURFACES.join(', ')}`);
        if (typeof fm.tester_verifiable !== 'boolean') add(rel, 'frontmatter', 'tester_verifiable must be true or false');
        if (fm.break_test !== undefined && typeof fm.break_test !== 'boolean') add(rel, 'frontmatter', 'break_test must be true or false');
        else if (fm.break_test === true && !['ui', 'api'].includes(fm.surface) && !withVia.has(id) && !Array.isArray(fm.observed_via)) {
            // A story from before observed_via: the old rule, on the surface.
            add(rel, 'break-test', `break_test is true but the surface is ${fm.surface}: the breaker only reaches a ui or an api`);
        }
        if (fm.observed_via !== undefined && fm.observed_via !== null && !Array.isArray(fm.observed_via)) add(rel, 'frontmatter', 'observed_via must be a list, one value per criterion');
        for (const k of ['depends_on', 'requirements', 'sources', 'touches', 'db_tables']) {
            if (!Array.isArray(fm[k])) add(rel, 'frontmatter', `${k} must be a list`);
        }
        if (!Array.isArray(fm.test_data) && typeof fm.test_data !== 'string') add(rel, 'frontmatter', 'test_data must be a list');
        if (!DATE.test(String(fm.created))) add(rel, 'frontmatter', 'created must be a YYYY-MM-DD date');
        const touches = arr(fm.touches).map(normPath).filter(Boolean);
        if (Array.isArray(fm.touches) && !touches.length) add(rel, 'touches', 'touches is empty: name the files this story changes or creates');
        const reqs = arr(fm.requirements);
        if (Array.isArray(fm.requirements) && !reqs.length) add(rel, 'story-requirement', 'names no requirement');
        arr(fm.sources).filter((s) => SOURCE_ID.test(s)).forEach((s) => cited.push({ id: s, file: rel, by: `story ${id}` }));
        arr(fm.sources).filter((s) => !SOURCE_ID.test(s)).forEach((s) => add(rel, 'sources', `"${s}" is not a register id (S-nnn)`));

        const lines = spec.body.split('\n').map((l) => l.trim());
        const at = headings.map((h) => lines.indexOf(h));
        headings.forEach((h, i) => { if (at[i] < 0) add(rel, 'heading', `"${h}" is missing`); });
        if (at.every((i) => i >= 0) && at.some((v, i) => i > 0 && v < at[i - 1])) add(rel, 'heading', 'headings out of order');
        if (!storyLine.test(spec.body)) add(rel, 'heading', `the "**${asA}** ... **${iWant}** ... **${soThat}** ..." line is missing`);
        const product = spec.body.split(/^## For the agent\s*$/m)[0];
        const crit = sectionsOf(product, 3).find((s) => s.heading === criteriaHeading);
        if (crit && !crit.text.split('\n').some((l) => /^\s*-\s+\S/.test(l))) add(rel, 'criteria', 'no acceptance criterion');
        if (crit && crit.text.split('\n').some((l) => /^\s*\d+[.)]\s/.test(l))) add(rel, 'criteria', 'acceptance criteria are bullets, not numbered');
        if (crit && Array.isArray(fm.observed_via)) {
            const bullets = crit.text.split('\n').filter((l) => /^-\s+\S/.test(l)).length;
            if (fm.observed_via.length !== bullets) {
                add(rel, 'criteria-via', `observed_via has ${fm.observed_via.length} value${fm.observed_via.length === 1 ? '' : 's'} but there ${bullets === 1 ? 'is 1 criterion' : `are ${bullets} criteria`}: one value per criterion, in order`);
            }
        }
        emptyHeadings(spec.body).forEach((h) => add(rel, 'empty-heading', `"${h}" is empty, write None.`));
        placeholders(spec.raw).forEach((n) => add(rel, 'placeholder', `line ${n}: TBD, TODO or "to be decided"`));

        stories.push({
            rel,
            id,
            complexity: fm.complexity,
            title: String(fm.title || ''),
            depends_on: arr(fm.depends_on).map(render.storyId),
            requirements: reqs,
            tester_verifiable: fm.tester_verifiable === true,
            db_tables: arr(fm.db_tables),
            touches,
        });
    }

    // --- ids, dependencies, requirements -----------------------------------
    const byId = new Map();
    for (const s of stories.filter((x) => x.id)) {
        if (byId.has(s.id)) add(s.rel, 'id', `id ${s.id} is also used by ${byId.get(s.id).rel}`);
        else byId.set(s.id, s);
    }
    const deps = new Map([...byId.values()].map((s) => [s.id, s.depends_on]));
    for (const s of byId.values()) {
        for (const d of s.depends_on) {
            if (d === s.id) add(s.rel, 'depends-on', 'depends on itself');
            else if (!byId.has(d)) add(s.rel, 'depends-on', `depends on ${d}, which does not exist`);
        }
    }
    const cycle = findCycle(deps);
    if (cycle) add(byId.get(cycle[0]).rel, 'cycle', `depends_on has a cycle: ${cycle.join(' -> ')}`);
    if (fs.existsSync(intent.brief)) {
        for (const s of byId.values()) {
            s.requirements.filter((r) => !requirementIds.includes(r)).forEach((r) => add(s.rel, 'story-requirement', `requirement ${r} is not in the brief`));
        }
        const delivered = new Set([...byId.values()].flatMap((s) => s.requirements));
        requirementIds.filter((r) => !delivered.has(r)).forEach((r) => add('brief.md', 'requirement-coverage', `${r} is delivered by no story`));
    }

    if (lane === 'quick' && (stories.length > 2 || stories.some((s) => s.complexity === 'hard'))) {
        add('brief.md', 'lane', 'lane quick allows at most 2 stories and none hard: use lane full');
    }

    // --- the story map against the files -----------------------------------
    if (mapRows) {
        const rows = new Map();
        for (const r of mapRows) {
            const id = render.storyId(r[0] || '');
            if (rows.has(id)) add('brief.md', 'story-map', `story ${id} has two rows`);
            rows.set(id, r);
        }
        for (const s of byId.values()) {
            const r = rows.get(s.id);
            if (!r) { add('brief.md', 'story-map', `story ${s.id} has no row`); continue; }
            const same = (a, b) => a.join(',') === b.join(',');
            const diffs = [];
            if ((r[1] || '') !== s.title) diffs.push('title');
            if (!same(listCell(r[2] || '').map(render.storyId), s.depends_on)) diffs.push('depends on');
            if (!same(listCell(r[3] || ''), s.requirements)) diffs.push('requirements');
            if ((r[4] || '').toLowerCase() !== (s.tester_verifiable ? 'yes' : 'no')) diffs.push('tester verifiable');
            if (!same(listCell(r[5] || ''), s.db_tables)) diffs.push('db tables');
            if (diffs.length) add('brief.md', 'story-map', `story ${s.id} row differs from ${s.rel} in: ${diffs.join(', ')}`);
        }
        [...rows.keys()].filter((id) => !byId.has(id)).forEach((id) => add('brief.md', 'story-map', `row ${id} has no story file`));
    }

    // --- parallel stories never share a file -------------------------------
    const list = [...byId.values()];
    const reachOf = new Map(list.map((s) => [s.id, reach(s.id, deps)]));
    for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
            const a = list[i];
            const b = list[j];
            if (reachOf.get(a.id).has(b.id) || reachOf.get(b.id).has(a.id)) continue;
            const shared = a.touches.filter((f) => b.touches.includes(f));
            if (shared.length) {
                add(b.rel, 'parallel-touches', `can build at the same time as story ${a.id} and both touch ${shared.join(', ')}: add a depends_on or split the files`);
            }
        }
    }

    // --- coverage against the register -------------------------------------
    const reg = paths.layout(root).inception(intent.inception).register;
    if (!fs.existsSync(reg)) {
        notes.push(`coverage skipped: no ${path.relative(root, reg)} (no docs synced for this inception)`);
    } else {
        let register;
        try {
            register = readRegister(reg);
        } catch (error) {
            add('register.yaml', 'register', error.message);
            register = null;
        }
        if (register) {
            const items = new Map(register.items.map((it) => [String(it.id), it]));
            const not = record && Array.isArray(record.deliberately_not) ? record.deliberately_not : [];
            const excused = new Set();
            not.forEach((n, i) => {
                const nid = n && n.id !== undefined && n.id !== null ? String(n.id).trim() : '';
                if (!nid) add('record.yaml', 'deliberately-not', `deliberately_not[${i}] has no id`);
                if (!n || !String(n.reason || '').trim()) add('record.yaml', 'deliberately-not', `deliberately_not ${nid || `[${i}]`} has no reason`);
                if (SOURCE_ID.test(nid)) {
                    if (!items.has(nid)) add('record.yaml', 'unknown-source', `deliberately_not names ${nid}, which is not in the register`);
                    excused.add(nid);
                }
            });
            for (const c of cited) {
                const it = items.get(c.id);
                if (!it) add(c.file, 'unknown-source', `${c.by} cites ${c.id}, which is not in the register`);
                else if (it.status === 'stale') add(c.file, 'stale-source', `${c.by} cites ${c.id}, which is stale: its page changed, cite the current statement`);
            }
            const citedIds = new Set(cited.map((c) => c.id));
            for (const it of register.items) {
                if (it.status === 'stale' || citedIds.has(String(it.id)) || excused.has(String(it.id))) continue;
                const quote = String(it.quote || '');
                add('register.yaml', 'source-coverage', `${it.id} (${it.kind}, page ${it.page}) is cited by no requirement or story and is not in deliberately_not: "${quote.length > 80 ? `${quote.slice(0, 77)}...` : quote}"`);
            }
        }
    }
    return { findings, notes };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = 'Usage: node .specsmd/aidlc-turbo/scripts/spec-lint.cjs <intent> [--json] [--root .specs-aidlc-turbo]';

function parseArgs(argv) {
    const out = { positional: [], json: false, root: paths.ARTIFACT_DIR };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--json') out.json = true;
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
    try {
        intent = paths.findIntent(args.root, slug);
    } catch (error) {
        console.error(error.message);
        return 1;
    }
    if (!intent) { console.error(`No intent "${slug}" under ${paths.layout(args.root).docs}`); return 1; }
    const { findings, notes } = lintIntent(intent, args.root);
    if (args.json) {
        notes.forEach((n) => console.error(n));
        console.log(JSON.stringify(findings, null, 2));
    } else {
        findings.forEach((f) => console.log(`${f.file}: ${f.message}`));
        notes.forEach((n) => console.log(`note: ${n}`));
        console.log(findings.length ? `spec-lint ${slug}: ${findings.length} finding${findings.length === 1 ? '' : 's'}` : `spec-lint ${slug}: clean`);
    }
    return findings.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { lintIntent, lintTesting, lintOverview, emptyHeadings, findCycle, main };
