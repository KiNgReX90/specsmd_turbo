/**
 * specsmd AI-DLC Turbo - where the build deviated from the Code Scaffold.
 *
 * The Code Scaffold is drawn at inception and never updated after the
 * approval: it is a starting point, not a source of truth. After the build
 * the overview shows, next to the drawing, where the build went another way
 * and why. This module computes that from what each built story really
 * changed (changed_files) and from what its builder reported in the build
 * notes of its story file:
 *
 *   - **Built**: in a few plain sentences, what the story built
 *   - **What changed**: per part of the Code Scaffold the story built or
 *     changed, and per file outside it, a few plain sentences on what changed
 *     in that file and why
 *   - **Outside the Code Scaffold**: built, but the scaffold does not name it
 *   - **Different from the Code Scaffold**: a planned part built differently
 *   - **Not built**: a planned part the story did not build
 *
 * An item is `path`: what was built. Why: why (Not built: only why; What
 * changed: its sentences as they are). What was planned comes from the
 * story's drawing, what it says the story builds there (else the part's own
 * short line or description), so the builder never repeats it. The labels
 * are English, the agent's half of the story.
 *
 * buildNotesOf(markdown) reads those lines. applyBuild(model, built)
 * enriches a designModel(record) with them:
 *
 *   part.build / module.build  { state: 'as_planned', story, why }, or
 *                              { state: 'different' | 'gone' | 'added', story, story_name, plan, built, why }
 *   model.build                { stories: [{ id, n, built, different, extra, gone }], different, extra, gone, changes }
 *   model.build.changes        { [part id]: [{ story, text }] }, in story order: what each builder wrote under
 *                              What changed for that part, matched by the path the item names, else by the
 *                              part's name, else by the name of its file (a part built in another place)
 *
 * A new file the notes name under Outside, inside a drawn module, is added
 * to the model as a new part of that module (state added). The record's
 * drawing is never touched. The few texts it adds come from the string table
 * of the record's language (design.added, design.buildLine). Pure, Node
 * builtins only.
 */

const { partOf, storyNumber } = require('./design-model.cjs');
const lang = require('./lang.cjs');

const ARTIFACTS = /(^|\/)\.specs-aidlc-turbo\//;
const LABEL = /^-\s+\*\*(?:(Outside|Different from) the Code Scaffold|(Not built)|(Built)|(What changed))\*\*\s*:?\s*(.*)$/i;
const ITEM = /^`([^`]+)`\s*:?\s*(.*)$/;
const NONE = /^none\.?$/i;
const WHY = /\bwhy\s*:\s*/i;
const EN = lang.load(lang.FALLBACK);
// what a new file is, and the layer it most likely sits in, by its extension
const KIND = { java: 'class', kt: 'class', cs: 'class', py: 'class', js: 'JS module', mjs: 'JS module', ts: 'JS module', css: 'CSS', jsp: 'JSP',
    html: 'HTML', sql: 'SQL script', xml: 'config', yaml: 'config', yml: 'config', properties: 'config', json: 'config' };
const LAYER = { java: 'server', kt: 'server', cs: 'server', py: 'server', sql: 'database', jsp: 'screen', html: 'screen', css: 'screen' };

const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const norm = (p) => String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
/** True when a and b are the same path, or one is a folder of the other. */
const covers = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
const base = (p) => p.split('/').pop();
const ext = (p) => (/\.([a-z0-9]+)$/i.exec(base(p)) || [])[1];
/** A file's name without its extension: `src/a/Cache.java` is Cache. */
const nameOf = (p) => (p ? base(p).replace(/\.[^.]+$/, '') || base(p) : null);
const dir = (p) => p.split('/').slice(0, -1);

/** What was built and why from an item's text: "what. Why: why", or only why. */
function split(rest) {
    const at = WHY.exec(rest);
    if (!at) return { why: text(rest) };
    return { built: text(rest.slice(0, at.index).replace(/^\s*built\s*:\s*/i, '')), why: text(rest.slice(at.index + at[0].length)) };
}

/** One reported item: `path`: text, or only a text. */
function itemOf(s) {
    const m = ITEM.exec(s.trim());
    return m ? { path: norm(m[1]) || null, raw: m[2] } : { path: null, raw: s };
}

/** The `### Build notes` section of a story file, or the whole text when it has none. */
function notesSection(markdown) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const at = lines.findIndex((l) => /^###\s+Build notes\s*$/i.test(l.trim()));
    if (at < 0) return lines;
    const rest = lines.slice(at + 1);
    const end = rest.findIndex((l) => /^#{1,3}\s/.test(l));
    return end < 0 ? rest : rest.slice(0, end);
}

/**
 * { outside, different, gone: [{ path, built?, why }], built, changed: [{ path, text }] }
 * from a story file or only its build notes. An item is one sub-bullet, or
 * the rest of the line itself (single-line form); "none." is no item.
 */
function buildNotesOf(markdown) {
    const raw = { outside: [], different: [], gone: [], changed: [] };
    let built = null;
    let into = null;
    let last = null;
    for (const line of notesSection(markdown)) {
        const label = LABEL.exec(line.trim());
        if (label && !/^\s/.test(line)) {
            const rest = label[5].trim();
            last = null;
            if (label[3]) { into = 'built'; built = NONE.test(rest) ? null : rest; continue; }
            into = label[4] ? raw.changed : label[2] ? raw.gone : label[1].toLowerCase() === 'outside' ? raw.outside : raw.different;
            if (rest && !NONE.test(rest)) { last = itemOf(rest); into.push(last); }
            continue;
        }
        if (!into || !line.trim()) continue;
        if (!/^\s/.test(line)) { into = null; last = null; continue; }
        if (into === 'built') { if (built !== null) built = `${built} ${line.trim()}`; continue; }
        const sub = /^\s+[-*]\s+(.*)$/.exec(line);
        if (sub) {
            if (NONE.test(sub[1].trim())) continue;
            last = itemOf(sub[1]);
            into.push(last);
        } else if (last) {
            // a text that wraps onto the next line
            last.raw = `${last.raw} ${line.trim()}`;
        }
    }
    const done = (x) => ({ path: x.path, ...split(x.raw) });
    return {
        outside: raw.outside.map(done),
        different: raw.different.map(done),
        gone: raw.gone.map((x) => ({ path: x.path, why: text(x.raw.replace(/^\s*why\s*:\s*/i, '')) })),
        built: text(built),
        changed: raw.changed.map((x) => ({ path: x.path, text: text(x.raw) })).filter((x) => x.text),
    };
}

/** Can the files tell whether this part or module was built where it was drawn? */
function checkable(x, isPart) {
    if (x.repo) return false;
    if (isPart) return !!x.path && !(x.status === 'changed' && x.layer === 'database');
    return !!x.path || list(x.registered_in).length > 0;
}

/** True when a file of the story lies where the part or module was drawn. */
function builtWhereDrawn(x, isPart, files) {
    const at = x.path ? norm(x.path) : null;
    if (isPart) return files.some((f) => covers(f, at));
    const reg = list(x.registered_in).map((r) => norm(r.file));
    return files.some((f) => (at && (f === at || f.startsWith(`${at}/`))) || reg.includes(f));
}

/** What was planned for x: what the story's drawing says it builds there, else the part's short line, else its description. */
const planOf = (x, story) => (story && text(story.builds[x.id])) || text(x.sub) || text(x.what);

/** One built story against what its drawing says it builds, with its build notes read (buildNotesOf). */
function storyBuild(model, entry, story, notes, table) {
    const files = [...new Set(list(entry.files).filter(text).map(norm))].filter((f) => !ARTIFACTS.test(f));
    const parts = new Map(model.parts.map((p) => [p.id, p]));
    const mods = new Map(model.modules.map((m) => [m.id, m]));
    const builds = story ? Object.keys(story.builds) : [];
    const id = String(entry.id);
    const storyName = story ? `${story.n}. ${story.title}` : null;
    const different = [];
    const gone = [];
    const used = new Set();
    for (const key of builds) {
        const isPart = parts.has(key);
        const x = isPart ? parts.get(key) : mods.get(key);
        if (!x) continue;
        const at = x.path ? norm(x.path) : null;
        const notedGone = at ? notes.gone.find((d) => d.path === at) : null;
        const noted = at && !notedGone ? notes.different.find((d) => d.path === at) : null;
        let state = null;
        let item = {};
        if (notedGone) { used.add(notedGone); state = 'gone'; item = notedGone; }
        else if (noted) { used.add(noted); state = 'different'; item = noted; }
        else if (checkable(x, isPart)) state = builtWhereDrawn(x, isPart, files) ? 'as_planned' : 'different';
        if (state) mark(x, state, item);
    }
    /** Part or module x in this story's build as `state`, with what the notes say of it. */
    function mark(x, state, item) {
        const why = item.why || null;
        const made = state === 'gone' ? null : item.built || null;
        // a part two stories build: a deviation in either one shows
        if (!(x.build && x.build.state !== 'as_planned')) {
            x.build = state === 'as_planned' ? { state, story: id, why }
                : { state, story: id, story_name: storyName, plan: planOf(x, story), built: made, why };
        }
        if (state === 'different') different.push({ id: x.id, name: x.name, path: x.path, plan: planOf(x, story), built: made, why });
        if (state === 'gone') gone.push({ id: x.id, name: x.name, path: x.path, plan: planOf(x, story), why });
    }
    // a reported deviation of a drawn part the story only uses marks that part; one that names no part still counts
    const drawnAt = (p) => (p ? model.parts.find((x) => !x.repo && x.path && norm(x.path) === p) : null);
    for (const [notesOf, state] of [[notes.different, 'different'], [notes.gone, 'gone']]) {
        for (const d of notesOf) {
            if (used.has(d)) continue;
            const x = drawnAt(d.path);
            if (x) mark(x, state, d);
            else if (state === 'different') different.push({ id: null, name: null, path: d.path, plan: null, built: d.built || null, why: d.why });
            else gone.push({ id: null, name: null, path: d.path, plan: null, why: d.why });
        }
    }

    const own = builds.map((k) => parts.get(k)).filter(Boolean);
    const paths = own.filter((p) => p.path).map((p) => norm(p.path));
    const registered = new Set(builds.map((k) => mods.get(k)).filter(Boolean)
        .flatMap((m) => list(m.registered_in).map((r) => norm(r.file))));
    const migration = own.some((p) => p.status === 'changed' && p.layer === 'database');
    // a part built in another place: the place its text names is that part, not an extra
    // and a part the notes name under Different is that part too
    const moved = notes.different.flatMap((d) => [d.path, ...[...`${d.built || ''} ${d.why || ''}`.matchAll(/`([^`]+)`/g)].map((m) => norm(m[1]))])
        .filter(Boolean);
    const onScaffold = (f) => paths.some((p) => covers(f, p)) || registered.has(f) || (migration && /\.sql$/i.test(f))
        || moved.some((p) => covers(f, p));
    const reasonOf = (f) => notes.outside.find((o) => o.path && covers(f, o.path));
    const extra = files.filter((f) => !onScaffold(f)).map((f) => {
        const o = reasonOf(f);
        return { file: f, name: nameOf(f), built: (o && o.built) || null, why: o ? o.why : null };
    });
    // reported, but no file of the story matches it: listed all the same
    for (const o of notes.outside) {
        if (!o.path || !files.some((f) => covers(f, o.path))) extra.push({ file: o.path, name: nameOf(o.path), built: o.built || null, why: o.why });
    }
    // every changed file off the scaffold, in a drawn module: a part of its own, with the builder's text when it named it
    for (const e of extra.filter((x) => x.file && ext(x.file) && files.includes(x.file))) addPart(model, story, id, storyName, { ...e, path: e.file }, table);
    return { id, n: storyNumber(id), built: notes.built, different, extra, gone };
}

/** The module a file lies in (the deepest drawn module path), or null. */
function moduleFor(model, file) {
    const hits = model.modules.filter((m) => m.path && !m.repo && file.startsWith(`${norm(m.path)}/`));
    return hits.sort((a, b) => norm(b.path).length - norm(a.path).length)[0] || null;
}

/** The layer of a new file in its module: the one of the parts nearest to it in the folders, its extension breaking a tie. */
function layerFor(model, mod, file) {
    const mine = model.parts.filter((p) => p.module === mod.id && p.layer);
    if (!mine.length) return null;
    const shared = (p) => {
        const a = dir(file);
        const b = p.path ? dir(norm(p.path)) : [];
        let n = 0;
        while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
        return n;
    };
    const best = Math.max(...mine.map(shared));
    const near = mine.filter((p) => shared(p) === best).map((p) => p.layer);
    const guess = LAYER[(ext(file) || '').toLowerCase()];
    return near.includes(guess) ? guess : near[0];
}

/** A unique id for a new part from its name. */
function idFor(model, name) {
    const taken = new Set([...model.parts.map((p) => p.id), ...model.modules.map((m) => m.id)]);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';
    let id = slug;
    for (let n = 2; taken.has(id); n += 1) id = `${slug}-${n}`;
    return id;
}

/** Add a file the notes name under Outside to the drawing, as a new part built by its story. */
function addPart(model, story, storyId, storyName, o, table) {
    const mod = moduleFor(model, o.path);
    const layer = mod && layerFor(model, mod, o.path);
    const frame = layer && model.frames.find((f) => f.module === mod.id && f.layer === layer);
    if (!frame || model.parts.some((p) => p.path && norm(p.path) === o.path)) return;
    const name = nameOf(o.path);
    const part = partOf({ id: idFor(model, name), name, module: mod.id, layer, status: 'new', kind: KIND[(ext(o.path) || '').toLowerCase()] || 'file',
        path: o.path, what: o.built || null }, false, table);
    part.confidence = { level: 'green', reasons: [lang.text(table, 'design.added')] };
    part.stories = [storyId];
    part.build = { state: 'added', story: storyId, story_name: storyName, plan: null, built: o.built || null, why: o.why || null };
    model.parts.push(part);
    frame.parts.push(part.id);
    if (story) { story.parts.push(part.id); story.builds[part.id] = o.built || ''; }
}

const order = (a, b) => (parseInt(a.id, 10) - parseInt(b.id, 10)) || String(a.id).localeCompare(String(b.id));

/** The part a What changed item names: by its path, else by its name or id, else by the name of its file; null when none or two fit. */
function partFor(model, key) {
    const k = norm(key);
    const one = (xs) => (xs.length === 1 ? xs[0] : null);
    return model.parts.find((p) => p.path && norm(p.path) === k)
        || one(model.parts.filter((p) => p.name === k || p.id === k))
        || (k.includes('/') || ext(k) ? one(model.parts.filter((p) => [p.name, p.path && nameOf(norm(p.path))].includes(nameOf(k)))) : null);
}

/** What the builders wrote under What changed, per part id, in story order; an item that names no part is left out. */
function changesOf(model, read) {
    const out = {};
    for (const { entry, notes } of read) {
        for (const c of notes.changed) {
            const p = c.path ? partFor(model, c.path) : null;
            if (p) (out[p.id] = out[p.id] || []).push({ story: String(entry.id), text: c.text });
        }
    }
    return out;
}

/**
 * Enrich the model with the build of every built story and return it.
 * built: [{ id, files, notes }], files without test files. An empty built
 * leaves the model as it was. `table` is the string table of the record.
 */
function applyBuild(model, built, table = EN) {
    const entries = list(built).filter((b) => b && text(b.id));
    if (!model || !entries.length) return model;
    const byNumber = new Map(model.stories.map((s) => [storyNumber(s.id), s]));
    const read = entries.slice().sort(order).map((entry) => ({ entry, notes: buildNotesOf(entry.notes) }));
    const stories = read.map(({ entry, notes }) => storyBuild(model, entry, byNumber.get(storyNumber(String(entry.id).trim())), notes, table));
    // a module was built as planned only when every part in it that was built was too
    for (const m of model.modules) {
        if (m.build && m.build.state === 'as_planned'
            && model.parts.some((p) => p.module === m.id && p.build && p.build.state !== 'as_planned')) delete m.build;
    }
    const count = (k) => stories.reduce((n, s) => n + s[k].length, 0);
    // matched once every story drew its new parts, so a later story's text finds a part an earlier one added
    model.build = { stories, different: count('different'), extra: count('extra'), gone: count('gone'), changes: changesOf(model, read) };
    return model;
}

/**
 * The one line the overview prints after the build. A part drawn and not built and an existing part drawn
 * to be used and not used count together: neither was built or used.
 */
function buildLine(build, table = EN) {
    if (!build.different && !build.extra && !build.gone) return lang.text(table, 'design.buildLine.asPlanned');
    const gone = build.gone ? lang.text(table, 'design.buildLine.gone', { n: build.gone }) : '';
    return lang.text(table, 'design.buildLine.changed', { different: build.different, extra: build.extra, gone });
}

module.exports = { buildNotesOf, applyBuild, buildLine };
