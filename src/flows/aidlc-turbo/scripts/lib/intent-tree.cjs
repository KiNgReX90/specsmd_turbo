/**
 * specsmd AI-DLC Turbo - which Confluence page belongs to which intent.
 *
 * Every intent has its own page. In an inception of one intent that is the
 * inception's own documentation page. When an inception holds more than one
 * intent folder, each intent gets a child page of its own under the
 * inception's page, with its own stories page under it, and its story pages
 * hang there. The inception's page keeps what the intents share. Story pages
 * of two intents never share a parent. The titles come from the project's
 * page names (lib/page-names.cjs): `intent`, default `{name} - Documentation`,
 * and `stories`, default `{name} - Stories`.
 *
 * Pure: intent-pages.cjs reads the disk and passes the tree in.
 *
 *   inception     the inception slug
 *   skipped       `skipped: true` under `confluence:` (no Confluence)
 *   documentation `confluence.documentation` of sync.yaml, or null
 *   entries       `confluence.intents` of sync.yaml: { slug: { url, page_id, name } }
 *   rows          `confluence.pages` of sync.yaml
 *   folders       [{ slug, title, purpose, stories: [{ id, title }] }]
 *   citations     Map page id -> [{ intent, story }]: the record stories whose
 *                 sources cite a register statement of that page
 *   names         the project's page names (lib/page-names.cjs); the defaults
 *                 when left out
 *
 * Local paths: everything under an intent's own page lives under
 * docs/{inception}/pages/{intent}/: the intent page is that folder's index.md,
 * its Stories page stories/index.md, a story page stories/{name}.md, or
 * stories/{name}/index.md when pages hang under it.
 *
 * A story page belongs to the intent whose record has a story with the same
 * number and title (the title without ` - {name}`, the number from
 * `Story NNN - `; a title without a number matches on the title alone). Case
 * and runs of spaces do not count. Anything else is no match: it is shown
 * with what was found, never moved on a guess. The user's mapping wins.
 *
 * Node builtins only, plus ./page-names.cjs.
 */

const { DEFAULTS, fill } = require('./page-names.cjs');

const isMap = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const present = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const storyNo = (v) => (/^\d+$/.test(String(v).trim()) ? String(v).trim().padStart(3, '0') : String(v).trim());

/** The problems a page of its own fixes: a writer never targets the shared page while one is left. */
const PAGE_PROBLEMS = new Set(['no_page', 'shared_page', 'inception_page']);

/** `Story 003 - Title - {suffix}` -> { number: '003', title: 'Title' }; without a number, number is null. */
function storyTitle(title, suffixes = []) {
    let t = String(title ?? '').trim();
    for (const s of suffixes.filter(present)) {
        const tail = ` - ${s}`;
        if (norm(t).endsWith(norm(tail)) && t.length > tail.length) { t = t.slice(0, t.length - tail.length).trim(); break; }
    }
    const m = /^story\s+(\d+)\s*-\s*(.+)$/i.exec(t);
    return m ? { number: storyNo(m[1]), title: m[2].trim() } : { number: null, title: t };
}

/** The titles of an intent's own pages; ` (intent)` when the slug is the inception page's own name. */
function titlesOf(slug, name, names = DEFAULTS) {
    const tail = norm(slug) === norm(name) ? ' (intent)' : '';
    return { page: fill(names.intent, { name: `${slug}${tail}` }), stories: fill(names.stories, { name: `${slug}${tail}` }) };
}

/** Where every row of the inception's tree sits: in an intent's folder (`place`) or in the shared tree. */
function placeRows(tree, prefix, folderSet, entryOf) {
    return (Array.isArray(tree.rows) ? tree.rows : [])
        .filter((r) => isMap(r) && typeof r.path === 'string' && r.path.startsWith(prefix) && present(r.page_id))
        .map((row) => {
            const segs = row.path.slice(prefix.length).split('/');
            const key = present(row.intent) ? String(row.intent) : null;
            const head = segs.length > 1 && folderSet.has(segs[0]) && (entryOf(segs[0]) || key === segs[0]) ? segs[0] : null;
            return { row, id: String(row.page_id), title: String(row.title ?? ''), segs, key, place: head, sub: head ? segs.slice(1) : segs };
        });
}

const isStoryPage = (sub) => sub[0] === 'stories'
    && ((sub.length === 2 && sub[1] !== 'index.md') || (sub.length === 3 && sub[2] === 'index.md'));
const isStoryChild = (sub) => sub[0] === 'stories' && sub.length >= 3 && !(sub.length === 3 && sub[2] === 'index.md');

/** Every story of every intent with this number and title. */
function matchesOf(parsed, folders) {
    const out = [];
    for (const f of folders) {
        for (const s of f.stories || []) {
            if (norm(s.title) === norm(parsed.title) && (parsed.number === null || storyNo(s.id) === parsed.number)) {
                out.push({ intent: f.slug, story: storyNo(s.id) });
            }
        }
    }
    return out;
}

/** What was found for a page that matches no story: the same title under another number, and the register. */
function hintsOf(page, parsed, folders, citations) {
    const titles = [];
    for (const f of folders) {
        for (const s of f.stories || []) {
            if (norm(s.title) === norm(parsed.title)) titles.push({ intent: f.slug, story: storyNo(s.id), why: 'title' });
        }
    }
    const seen = new Set();
    const sources = ((citations && citations.get(page.id)) || [])
        .map((c) => ({ intent: c.intent, story: storyNo(c.story), why: 'sources' }))
        .filter((h) => !seen.has(`${h.intent}/${h.story}`) && seen.add(`${h.intent}/${h.story}`));
    const order = (a, b) => a.intent.localeCompare(b.intent) || a.story.localeCompare(b.story);
    return [...titles.sort(order), ...sources.sort(order)];
}

/** The body of a new intent page: what it holds, what stays on the inception page, then the intent's purpose. */
function bodies(folder, parentTitle) {
    const title = present(folder.title) ? String(folder.title).trim() : folder.slug;
    const lead = `This page holds the stories and the overview of the intent ${title}. What the intents share is on ${parentTitle}.`;
    return {
        body: present(folder.purpose) ? `${lead}\n\n${String(folder.purpose).trim()}\n` : `${lead}\n`,
        stories_body: `The stories of the intent ${title}.\n`,
    };
}

/** What is wrong with the tree, and the plan that fixes what a script can know. */
function checkTree(tree, map = {}) {
    const inception = tree.inception;
    const folders = (tree.folders || []).slice().sort((a, b) => a.slug.localeCompare(b.slug));
    const intents = folders.map((f) => f.slug);
    if (tree.skipped) return { ok: true, inception, skipped: true, intents, problems: [], plan: null, lines: [] };
    const doc = isMap(tree.documentation) && present(tree.documentation.page_id) ? tree.documentation : null;
    if (!doc) return { ok: true, inception, intents, problems: [], plan: null, lines: [], note: 'no documentation page in sync.yaml: nothing on Confluence to check' };
    const names = { ...DEFAULTS, ...(isMap(tree.names) ? tree.names : {}) };

    const prefix = `docs/${inception}/pages/`;
    const name = present(doc.name) ? String(doc.name) : inception;
    const docId = String(doc.page_id);
    const entries = isMap(tree.entries) ? tree.entries : {};
    const entryOf = (slug) => (isMap(entries[slug]) && present(entries[slug].page_id) ? entries[slug] : null);
    const folderSet = new Set(intents);
    const problems = [];

    const owners = new Map();
    for (const slug of intents) {
        const e = entryOf(slug);
        if (e) owners.set(String(e.page_id), [...(owners.get(String(e.page_id)) || []), slug]);
    }
    const valid = new Set();
    for (const slug of intents) {
        const e = entryOf(slug);
        if (!e) {
            if (intents.length > 1) problems.push({ kind: 'no_page', intent: slug, detail: `${inception} holds ${intents.length} intents and ${slug} has no page of its own` });
            continue;
        }
        const id = String(e.page_id);
        if (id === docId) problems.push({ kind: 'inception_page', intent: slug, page_id: id, detail: `the page of ${slug} is the inception's own page` });
        else if (owners.get(id).length > 1) problems.push({ kind: 'shared_page', intent: slug, page_id: id, detail: `${owners.get(id).join(' and ')} share page ${id}` });
        else valid.add(slug);
    }
    const active = intents.length > 1 || intents.some(entryOf);

    const placed = placeRows(tree, prefix, folderSet, entryOf);
    const rowAt = (p) => placed.find((x) => x.row.path === p);
    for (const p of placed) {
        if ((p.key !== null && p.segs[0] !== p.key) || (p.key === null && p.place !== null)) {
            problems.push({ kind: 'row_intent', page_id: p.id, title: p.title, path: p.row.path, detail: `${p.row.path} is in the folder of ${p.place || 'the inception'} but says intent ${p.key || 'none'}` });
        }
    }

    const titleOf = (slug) => titlesOf(slug, name, names);
    const storiesTitle = (place) => {
        if (place === null) return (rowAt(`${prefix}stories/index.md`) || {}).title || fill(names.stories, { name });
        return (rowAt(`${prefix}${place}/stories/index.md`) || {}).title || titleOf(place).stories;
    };
    const move = [];
    const unmatched = [];
    for (const sp of placed.filter((p) => isStoryPage(p.sub))) {
        const parsed = storyTitle(sp.title, [name, ...intents, ...intents.map((s) => `${s} (intent)`)]);
        const matches = matchesOf(parsed, folders);
        const candidates = [...new Set(matches.map((m) => m.intent))];
        let target = null;
        let by = 'match';
        if (present(map[sp.id])) { target = String(map[sp.id]); by = 'user'; }
        else if (candidates.length === 1) target = candidates[0];
        else if (sp.place !== null && candidates.includes(sp.place)) target = sp.place;
        if (!active) continue;
        if (sp.place === null) {
            problems.push({ kind: 'shared_stories', page_id: sp.id, title: sp.title, detail: `"${sp.title}" hangs under the shared ${storiesTitle(null)}` });
        } else if (target && target !== sp.place) {
            problems.push({ kind: 'other_intent', page_id: sp.id, title: sp.title, intent: sp.place, belongs_to: target, detail: `"${sp.title}" hangs under the page of ${sp.place} but is a story of ${target}` });
        }
        if (target && target !== sp.place) {
            const folder = sp.sub[1].replace(/\.md$/, '');
            const children = placed.filter((c) => c.place === sp.place && isStoryChild(c.sub) && c.sub[1] === folder && sp.sub.length === 3)
                .map((c) => ({ page_id: c.id, from: c.row.path, to: `${prefix}${target}/${c.sub.join('/')}` }));
            const story = (matches.find((m) => m.intent === target) || {}).story || null;
            move.push({ page_id: sp.id, title: sp.title, intent: target, story, by, from: sp.row.path, to: `${prefix}${target}/${sp.sub.join('/')}`, children, from_title: storiesTitle(sp.place) });
        } else if (sp.place === null) {
            unmatched.push({ page_id: sp.id, title: sp.title, path: sp.row.path, hints: hintsOf(sp, parsed, folders, tree.citations) });
        }
    }

    for (const slug of valid) {
        if (!rowAt(`${prefix}${slug}/stories/index.md`)) problems.push({ kind: 'no_stories_page', intent: slug, detail: `${slug} has no Stories page under its own page` });
    }
    if (!problems.length) return { ok: true, inception, intents, problems, plan: null, lines: [] };

    const parentTitle = (rowAt(`${prefix}index.md`) || {}).title || fill(names.intent, { name });
    const create = [];
    for (const f of folders) {
        const t = titleOf(f.slug);
        const paths = { path: `${prefix}${f.slug}/index.md`, stories_path: `${prefix}${f.slug}/stories/index.md` };
        if (!valid.has(f.slug) && (intents.length > 1 || entryOf(f.slug))) {
            create.push({ intent: f.slug, page: true, stories: true, title: t.page, stories_title: t.stories, ...paths, ...bodies(f, parentTitle) });
        } else if (valid.has(f.slug) && !rowAt(paths.stories_path)) {
            const { stories_body } = bodies(f, parentTitle);
            create.push({ intent: f.slug, page: false, stories: true, page_id: String(entryOf(f.slug).page_id), title: (rowAt(paths.path) || {}).title || t.page, stories_title: t.stories, ...paths, stories_body });
        }
    }
    const toTitle = (slug) => (create.find((c) => c.intent === slug) || {}).stories_title || storiesTitle(slug);
    const lines = [
        ...create.map((c) => (c.page
            ? `create "${c.title}" under "${parentTitle}", with "${c.stories_title}" under it`
            : `create "${c.stories_title}" under "${c.title}"`)),
        ...move.map((m) => `move "${m.title}" from "${m.from_title}" to "${toTitle(m.intent)}" (${m.by === 'user' ? 'mapped by the user' : `story ${m.story} of ${m.intent}`})`),
        ...unmatched.map((u) => [`not moved: "${u.title}" under "${storiesTitle(null)}" matches no story of an intent`,
            ...u.hints.map((h) => (h.why === 'title' ? `same title as story ${h.story} of ${h.intent}` : `its statements are cited by story ${h.story} of ${h.intent}`))].join('; ')),
        ...problems.filter((p) => p.kind === 'row_intent').map((p) => `pull again: ${p.detail}`),
    ];
    const plan = { parent: { page_id: docId, title: parentTitle, url: doc.url ?? null }, create, move: move.map(({ from_title, ...m }) => m), unmatched };
    return { ok: false, inception, intents, problems, plan, lines };
}

module.exports = { PAGE_PROBLEMS, checkTree, storyTitle, titlesOf, norm };
