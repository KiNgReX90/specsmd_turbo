/**
 * specsmd AI-DLC Turbo - the C4 half of the v5 overview model.
 *
 * Reads the record's C4 block, technical_design.c4 (its shape is written down
 * once, in the header of lib/v5-model.cjs), into the maps the v5 kit reads
 * (window.C4.model): persons, systems, containers, components and outside, and
 * derives the views from them:
 *
 *   views.context      level 1: every person and system
 *   views.containers   level 2: the containers of the system without ext that
 *                      has them, inside its boundary, and who and what they
 *                      deal with
 *   views[zoom]        level 3, one per container with components: its
 *                      components inside its boundary, and their neighbours
 *
 * Derived, never written: a component's stories are those of the parts it
 * holds, a container's those of its components, a system's those of its
 * containers, unless the record lists them; a status the record leaves out
 * follows from the same (all new is new, all existing is existing, else
 * changed; a system with ext is existing). A view draws every edge of the
 * record at its own level (an edge to a component is an edge to its container
 * one level up, to its system at the context) together with the Code
 * Scaffold's calls between parts of two different elements, summed per pair.
 * An edge with no tech or end of its own takes them from the record's edge
 * between the same two elements one or two levels up.
 *
 * What the block names but the model does not hold (an unknown part, an edge
 * to no element) is left out here; lib/v5-missing.cjs names it. Nothing is
 * filled in: without the block every map and the views are empty. The views'
 * titles and the words that join several labels come from the `v5` section of
 * the string table given (lib/lang.cjs), English by default.
 *
 * Pure, Node builtins only, plus ./lang.cjs and ./overview-text.cjs.
 */

'use strict';

const lang = require('./lang.cjs');
const { storyId } = require('./overview-text.cjs');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
/** A trimmed string, or null for an empty or missing value. */
function text(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s || null;
}
const STATUS = ['new', 'changed', 'existing'];
const LISTS = ['persons', 'systems', 'containers', 'components'];
// the keys of the two views above the containers' own: a container never zooms into one of them
const RESERVED = new Set(['context', 'containers']);
const EN = lang.load(lang.FALLBACK);

const capFirst = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
/** The labels of several calls as one, as the kit joins them for its code view, in the words of `table`. */
const joinLabels = (labels, table = EN) => labels.slice(0, 2).map(capFirst).join(' · ')
    + (labels.length > 2 ? ` · ${lang.text(table, 'v5.more', { n: labels.length - 2 })}` : '');
const uniq = (a) => [...new Set(a)];
const byId = (a, b) => (parseInt(a, 10) - parseInt(b, 10)) || a.localeCompare(b);
const own = (key, v) => (text(v) ? { [key]: text(v) } : {});

/** The record's C4 block, or null when it has none. */
function blockOf(record) {
    const td = isObj(record) && isObj(record.technical_design) ? record.technical_design : null;
    return td && isObj(td.c4) ? td.c4 : null;
}

/** The status of an element from what it holds; null when that holds none. */
function statusFrom(children) {
    const s = children.map((c) => c.status).filter(Boolean);
    if (!s.length) return null;
    if (s.every((x) => x === 'new')) return 'new';
    if (s.every((x) => x === 'existing')) return 'existing';
    return 'changed';
}

const storiesOf = (e) => (Array.isArray(e.stories) ? uniq(e.stories.map(storyId)).sort(byId) : null);
const statusOf = (e) => (STATUS.includes(text(e.status)) ? text(e.status) : null);

/** The elements of the block, by id, with what follows from the parts they hold. */
function elementsOf(c4, parts) {
    const rows = (key) => list(c4[key]).filter((e) => isObj(e) && text(e.id) && !String(e.id).includes('@'));
    const persons = {};
    for (const p of rows('persons')) persons[text(p.id)] = { id: text(p.id), name: text(p.name) || text(p.id), kind: 'person', ...own('desc', p.desc) };
    const systems = {};
    const given = new Map();
    for (const s of rows('systems')) {
        const id = text(s.id);
        systems[id] = { id, name: text(s.name) || id, kind: text(s.kind) === 'db' ? 'db' : 'system', ...(s.ext === true ? { ext: true } : {}), ...own('tech', s.tech), ...own('desc', s.desc) };
        given.set(id, s);
    }
    const internal = Object.values(systems).filter((s) => !s.ext);
    const containers = {};
    for (const c of rows('containers')) {
        const id = text(c.id);
        const system = text(c.system) || (internal.length === 1 ? internal[0].id : null);
        if (!systems[system]) continue;
        containers[id] = { id, name: text(c.name) || id, kind: text(c.kind) === 'db' ? 'db' : 'container', system, ...own('tech', c.tech), ...own('desc', c.desc) };
        given.set(id, c);
    }
    const components = {};
    for (const k of rows('components')) {
        const id = text(k.id);
        const c = text(k.container);
        if (!containers[c]) continue;
        const held = uniq(list(k.parts).map(text).filter((pid) => pid && parts[pid]));
        components[id] = { id, c, name: text(k.name) || id, kind: 'component', ...own('tech', k.tech), ...own('desc', k.desc), ...own('icon', k.icon), parts: held };
        given.set(id, k);
    }
    // bottom up: a component from its parts, a container from its components, a system from its containers
    for (const k of Object.values(components)) {
        const ps = k.parts.map((pid) => parts[pid]);
        k.status = statusOf(given.get(k.id)) || statusFrom(ps);
        k.stories = storiesOf(given.get(k.id)) || uniq(ps.flatMap((p) => p.stories)).sort(byId);
    }
    const used = new Set(RESERVED);
    for (const c of Object.values(containers)) {
        const ks = Object.values(components).filter((k) => k.c === c.id);
        c.status = statusOf(given.get(c.id)) || statusFrom(ks);
        c.stories = storiesOf(given.get(c.id)) || uniq(ks.flatMap((k) => k.stories)).sort(byId);
        if (!ks.length) continue;
        const zoom = text(given.get(c.id).zoom);
        c.zoom = zoom && !used.has(zoom) && !zoom.startsWith('code:') ? zoom : c.id;
        used.add(c.zoom);
    }
    for (const s of Object.values(systems)) {
        const cs = Object.values(containers).filter((c) => c.system === s.id);
        s.status = statusOf(given.get(s.id)) || (s.ext ? 'existing' : statusFrom(cs));
        s.stories = storiesOf(given.get(s.id)) || uniq(cs.flatMap((c) => c.stories)).sort(byId);
    }
    for (const e of [...Object.values(components), ...Object.values(containers), ...Object.values(systems)]) if (!e.status) delete e.status;
    const outside = {};
    if (isObj(c4.outside)) {
        for (const [pid, sid] of Object.entries(c4.outside)) if (parts[pid] && systems[text(sid)]) outside[pid] = text(sid);
    }
    return { persons, systems, containers, components, outside };
}

/** Every edge a view can draw: the record's own, then the Code Scaffold's calls between parts of two elements. */
function sourcesOf(c4, m, parts, links) {
    const known = (id) => !!(m.persons[id] || m.systems[id] || m.containers[id] || m.components[id]);
    const said = list(c4.edges).filter((e) => isObj(e) && known(text(e.from)) && known(text(e.to))).map((e) => ({
        from: text(e.from), to: text(e.to), label: text(e.label), tech: text(e.tech), intent: e.intent === true, ends: e.ends === true,
    }));
    const compOf = new Map();
    for (const k of Object.values(m.components)) for (const pid of k.parts) if (!compOf.has(pid)) compOf.set(pid, k.id);
    const endOf = (pid) => compOf.get(pid) || m.outside[pid] || null;
    const calls = links.filter((l) => l.kind !== 'builds_on' && endOf(l.from) && endOf(l.to)).map((l) => ({
        from: endOf(l.from),
        to: endOf(l.to),
        intent: !!l.intent,
        ends: false,
        call: { from: parts[l.from].name, to: parts[l.to].name, ...own('label', l.label), ...own('code', l.code) },
    }));
    return { said, all: [...said, ...calls] };
}

/**
 * The edges of one view: every source lifted onto the view's nodes (`lift` gives the node an element is
 * drawn as, or null), kept when `keep` says, summed per pair. `ups` lift one and two levels up, for the
 * tech and the end an edge does not say itself; `quiet` marks an edge the view draws softly.
 */
function edgesOf(src, lift, keep, ups, quiet, table) {
    const sums = new Map();
    for (const s of src.all) {
        const a = lift(s.from);
        const b = lift(s.to);
        if (!a || !b || a === b || !keep(a, b)) continue;
        const key = `${a}>${b}`;
        if (!sums.has(key)) sums.set(key, { from: a, to: b, exact: [], said: [], calls: [], intent: false, ends: false });
        const e = sums.get(key);
        if (s.call) e.calls.push(s.call);
        else (s.from === a && s.to === b ? e.exact : e.said).push(s);
        e.intent = e.intent || s.intent;
        e.ends = e.ends || s.ends;
    }
    return [...sums.values()].map((e) => {
        const above = ups.flatMap((up) => {
            const a = up(e.from);
            const b = up(e.to);
            return a && b && a !== b ? src.said.filter((d) => up(d.from) === a && up(d.to) === b) : [];
        });
        const callLabels = uniq(e.calls.map((c) => c.label).filter(Boolean));
        const exact = e.exact.find((d) => d.label);
        const label = exact ? exact.label : joinLabels(uniq([...e.said.map((d) => d.label).filter(Boolean), ...callLabels]), table);
        const tech = [...e.exact, ...e.said, ...above].find((d) => d.tech);
        const out = { from: e.from, to: e.to, ...own('label', label), intent: e.intent, ...(tech ? { tech: tech.tech } : {}), ends: e.ends || above.some((d) => d.ends) };
        if (e.calls.length) Object.assign(out, { labels: callLabels, calls: e.calls });
        if (quiet) out.quiet = quiet(e);
        return out;
    });
}

/** The context view, the containers view and one view per container with components, titled in the words of `table`. */
function viewsOf(m, src, table = EN) {
    const T = (key, vars) => lang.text(table, `v5.${key}`, vars);
    const { persons, systems, containers, components } = m;
    const node = (id) => ({ ...(persons[id] || systems[id] || containers[id] || components[id]) });
    const toSystem = (id) => {
        if (persons[id] || systems[id]) return id;
        if (containers[id]) return containers[id].system;
        return components[id] ? containers[components[id].c].system : null;
    };
    const ordered = (inEdges, middle) => [
        ...Object.keys(persons).filter((id) => inEdges.has(id)),
        ...middle,
        ...Object.keys(containers).filter((id) => inEdges.has(id) && !middle.includes(id)),
        ...Object.keys(systems).filter((id) => inEdges.has(id)),
    ].map(node);
    const ends = (edges) => new Set(edges.flatMap((e) => [e.from, e.to]));
    const views = {};
    const all = () => true;
    views.context = {
        title: T('views.context'),
        level: 1,
        nodes: [...Object.keys(persons), ...Object.keys(systems)].map(node),
        edges: edgesOf(src, toSystem, all, [], null, table),
    };
    const S = Object.values(systems).find((s) => !s.ext && Object.values(containers).some((c) => c.system === s.id));
    if (!S) return views;
    const mine = Object.values(containers).filter((c) => c.system === S.id).map((c) => c.id);
    const toContainer = (id) => {
        if (persons[id]) return id;
        if (systems[id]) return id === S.id ? null : id;
        if (containers[id]) return containers[id].system === S.id ? id : containers[id].system;
        return components[id] ? toContainer(components[id].c) : null;
    };
    const edges2 = edgesOf(src, toContainer, all, [toSystem], null, table);
    views.containers = {
        title: T('views.containers'),
        level: 2,
        boundary: { id: S.id, name: S.name, tech: S.tech || T('kind.system'), children: mine },
        nodes: ordered(ends(edges2), mine),
        edges: edges2,
    };
    for (const cid of mine) {
        const C = containers[cid];
        if (!C.zoom) continue;
        const inside = Object.values(components).filter((k) => k.c === cid).map((k) => k.id);
        const toComponent = (id) => {
            if (components[id] && components[id].c === cid) return id;
            const up = toContainer(id);
            return up === cid ? null : up;
        };
        const keep = (a, b) => inside.includes(a) || inside.includes(b);
        const edges3 = edgesOf(src, toComponent, keep, [toContainer, toSystem], (e) => !!(containers[e.from] || containers[e.to]), table);
        views[C.zoom] = {
            title: T('views.components', { name: C.name }),
            level: 3,
            of: cid,
            boundary: { id: cid, name: C.name, ...own('tech', C.tech), children: inside },
            nodes: ordered(ends(edges3), inside),
            edges: edges3,
        };
    }
    return views;
}

/**
 * The C4 half of the model from the record and the scaffold half (the v5 parts by id and links):
 * { persons, systems, containers, components, outside, views }, every one empty without the block;
 * the views titled in the words of `table` (lib/lang.cjs), English by default.
 */
function c4Of(record, scaffold, table = EN) {
    const c4 = blockOf(record);
    if (!c4) return { persons: {}, systems: {}, containers: {}, components: {}, outside: {}, views: {} };
    const m = elementsOf(c4, scaffold.parts);
    return { ...m, views: viewsOf(m, sourcesOf(c4, m, scaffold.parts, scaffold.links), table) };
}

module.exports = { LISTS, STATUS, blockOf, c4Of, joinLabels, text, isObj, list };
