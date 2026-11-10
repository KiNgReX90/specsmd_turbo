/**
 * specsmd AI-DLC Turbo - the Code Scaffold, the model behind the drawing.
 *
 * The Code Scaffold shows the code the intent will build, before anything
 * is built: modules as frames, their parts (classes, files, tables) per layer,
 * arrows for what calls what, and per story what it builds and uses. It is a
 * starting point, not a source of truth: a tech lead or architect corrects it
 * at the approval, and it is never updated after. Plan writes it into the
 * record from the explorers' findings:
 *
 *   technical_design.drawing  { summary, lanes?, modules, parts, links }
 *   stories[].drawing         { summary, builds: { id: what }, uses: [id] }
 *
 * Every arrow is proven in the code like every part: a link that calls an
 * existing or changed part carries proof { file, lines, note } (where the
 * callee already offers what is called), or, for a changed callee, adds
 * (what the change adds for this call). design-lint.cjs enforces it.
 * The texts are in the record's language; the lane names and the reasons
 * below come from its string table (./lang.cjs, design.lanes and
 * design.reasons).
 *
 * This module turns those record fields into the one shape every reader uses
 * (spec-lint, render-specs and the overview page), and owns
 * the confidence rules, so the colour of a part never depends on who reads it.
 *
 * Confidence follows from the evidence with fixed rules. The agent can only
 * lower it (doubt), never raise it:
 *   - red: a choice is still open (open), the approval asks it.
 *   - new: green. Without an example in the code it says it has its own
 *     design, which is no reason for doubt.
 *   - changed or existing: green only with the place in the code checked
 *     (path and lines). spec-lint blocks the approval without them.
 *   - orange on top of that: known only from documentation (source), resting
 *     on an assumption (assumption), or real doubt (doubt).
 * Deviating from the example on purpose (deviates) is no doubt: the part
 * stays green and gets a "differs" label.
 *
 * A part without a layer is not drawn. With `near`, the id of a drawn part,
 * it is a file that part brings along (its test, its fix script): the
 * Review tab lists it right after that part.
 *
 * Pure, Node builtins only. Returns null for a record without a drawing.
 */

const lang = require('./lang.cjs');

const LAYERS = ['screen', 'server', 'database', 'external'];
const EN = lang.load(lang.FALLBACK);
/** The lane names of the English table; a drawing takes those of its record's language. */
const LAYER_NAMES = EN.design.lanes;
const STATUS = ['new', 'changed', 'existing'];
const KINDS = [
    'class', 'abstract class', 'interface', 'enum', 'record', 'classes',
    'web component', 'JS module', 'CSS', 'JSP', 'HTML', 'servlet',
    'config', 'migration', 'SQL script', 'table', 'view', 'index',
    'endpoint', 'queue', 'job', 'file',
];
const LINK_KINDS = ['calls', 'builds_on'];

/** The reasons behind a colour, in English; a drawing takes those of its record's language. */
const REASONS = EN.design.reasons;
// after the build the same reasons tell what was known at the design, in the past
const REASONS_BUILT = EN.design.reasonsBuilt;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
/** A trimmed string, or null for an empty or missing value. */
function text(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s || null;
}

/** { file, lines, note }, or null without a file. */
function place(v) {
    if (!isObj(v) || !text(v.file)) return null;
    return { file: text(v.file), lines: text(v.lines), note: text(v.note) };
}

/**
 * The colour of one part and the reasons behind it, from its evidence, the
 * reasons in the past when `built`, in the language of `table`. Pure.
 */
function confidence(part, built, table = EN) {
    const R = (built ? table.design.reasonsBuilt : table.design.reasons) || (built ? REASONS_BUILT : REASONS);
    if (text(part.open)) return { level: 'red', reasons: [R.open] };
    const reasons = [];
    let green;
    if (part.status === 'new') {
        green = true;
        reasons.push(place(part.follows) ? R.newFollows : R.newOwn);
    } else {
        green = !!(text(part.path) && text(part.lines));
        reasons.push(green ? R.checked : R.unchecked);
    }
    if (text(part.source)) { green = false; reasons.push(R.docs); }
    if (text(part.assumption)) { green = false; reasons.push(R.assumption + text(part.assumption)); }
    if (text(part.doubt)) { green = false; reasons.push(R.doubt + text(part.doubt)); }
    return { level: green ? 'green' : 'orange', reasons };
}

function moduleOf(m) {
    return {
        id: text(m.id),
        name: text(m.name) || text(m.id),
        status: text(m.status),
        what: text(m.what),
        path: text(m.path),
        repo: text(m.repo),
        follows: place(m.follows),
        registered_in: list(m.registered_in).map(place).filter(Boolean),
    };
}

function rightOf(r) {
    if (!isObj(r)) return null;
    return {
        short: text(r.short),
        status: text(r.status),
        what: text(r.what),
        file: text(r.file),
        lines: text(r.lines),
        decision: text(r.decision),
    };
}

function partOf(p, built, table) {
    const part = {
        id: text(p.id),
        name: text(p.name) || text(p.id),
        module: text(p.module),
        layer: text(p.layer),
        status: text(p.status),
        kind: text(p.kind),
        extends: text(p.extends),
        implements: text(p.implements),
        sub: text(p.sub),
        what: text(p.what),
        path: text(p.path),
        lines: text(p.lines),
        repo: text(p.repo),
        near: text(p.near),
        follows: place(p.follows),
        deviates: text(p.deviates),
        source: text(p.source),
        assumption: text(p.assumption),
        right: rightOf(p.right),
        open: text(p.open),
        open_detail: text(p.open_detail),
        doubt: text(p.doubt),
    };
    part.confidence = confidence(part, built, table);
    return part;
}

/** Link ids are from-to, with -2, -3 for a second link between the same two. */
function linksOf(raw) {
    const seen = new Map();
    return list(raw).filter(isObj).map((l) => {
        const from = text(l.from);
        const to = text(l.to);
        const base = `${from}-${to}`;
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        return {
            id: n === 1 ? base : `${base}-${n}`,
            from,
            to,
            kind: text(l.kind) || 'calls',
            label: text(l.label),
            step: text(l.step),
            code: text(l.code),
            proof: place(l.proof),
            adds: text(l.adds),
        };
    });
}

/** One frame per module per layer it has parts in, in layer order. */
function framesOf(modules, parts) {
    const frames = [];
    for (const m of modules) {
        const mine = parts.filter((p) => p.module === m.id);
        const layers = LAYERS.filter((layer) => mine.some((p) => p.layer === layer));
        for (const layer of layers) {
            frames.push({
                id: layers.length === 1 ? m.id : `${m.id}@${layer}`,
                module: m.id,
                layer,
                parts: mine.filter((p) => p.layer === layer).map((p) => p.id),
            });
        }
    }
    return frames;
}

/** The story's number in the drawing: "003" is 3, any other id stays as it is. */
function storyNumber(id) {
    return /^\d+$/.test(id) ? String(Number(id)) : id;
}

function storyOf(s, partIds, moduleIds, links) {
    const d = s.drawing;
    const builds = {};
    if (isObj(d.builds)) for (const [k, v] of Object.entries(d.builds)) builds[String(k).trim()] = text(v) || '';
    const uses = list(d.uses).map(text).filter(Boolean);
    const touched = new Set([...Object.keys(builds), ...uses]);
    const id = text(s.id) || '';
    return {
        id,
        n: storyNumber(id),
        title: text(s.short) || text(s.title) || id,
        summary: text(d.summary),
        builds,
        uses,
        parts: [...touched].filter((k) => partIds.has(k)),
        modules: Object.keys(builds).filter((k) => moduleIds.has(k)),
        links: links.filter((l) => touched.has(l.from) && touched.has(l.to)).map((l) => l.id),
    };
}

/**
 * The record's drawing as one shape, or null when the record has none. Ids
 * and references are taken as they are: spec-lint reports what is wrong.
 * With { built: true } (the page after the build) the reasons are in the past.
 * The lane names and reasons are in the language of { table }, by default
 * the string table of the record's own language.
 */
function designModel(record, opts) {
    const td = isObj(record) && isObj(record.technical_design) ? record.technical_design : null;
    const raw = td && isObj(td.drawing) ? td.drawing : null;
    if (!raw) return null;
    const table = (opts && opts.table) || lang.forRecord(record);
    const modules = list(raw.modules).filter(isObj).map(moduleOf);
    const parts = list(raw.parts).filter(isObj).map((p) => partOf(p, !!(opts && opts.built), table));
    const links = linksOf(raw.links);
    const names = isObj(raw.lanes) ? raw.lanes : {};
    const lanes = LAYERS.filter((layer) => parts.some((p) => p.layer === layer))
        .map((layer) => ({ id: layer, name: text(names[layer]) || table.design.lanes[layer] || LAYER_NAMES[layer] }));
    const partIds = new Set(parts.map((p) => p.id));
    const moduleIds = new Set(modules.map((m) => m.id));
    const stories = list(record.stories).filter((s) => isObj(s) && isObj(s.drawing))
        .map((s) => storyOf(s, partIds, moduleIds, links));
    for (const p of parts) p.stories = stories.filter((s) => p.id in s.builds).map((s) => s.id);
    for (const m of modules) m.stories = stories.filter((s) => m.id in s.builds).map((s) => s.id);
    return {
        summary: text(raw.summary),
        lanes,
        modules,
        frames: framesOf(modules, parts),
        parts,
        links,
        stories,
    };
}

module.exports = {
    LAYERS, LAYER_NAMES, STATUS, KINDS, LINK_KINDS, REASONS, REASONS_BUILT,
    confidence, designModel, partOf, storyNumber,
};
