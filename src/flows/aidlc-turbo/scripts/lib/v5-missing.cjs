/**
 * specsmd AI-DLC Turbo - what the records do not hold for the v5 page.
 *
 * missing(record, { intent? }) returns every gap in the new data the v5 page
 * reads (lib/v5-model.cjs documents it): the C4 block technical_design.c4 and
 * the plain texts intent.plain and stories[].plain. Each gap is
 *
 *   { path, id, kind, text }
 *
 *   path   where in record.yaml the data belongs: technical_design.c4,
 *          technical_design.c4.components[2].parts, stories[1].plain
 *   id     the element it belongs to: the intent slug, a story id, an element
 *          id, `from->to` for an edge, a part id
 *   kind   c4 | plain | no-id | no-system | system | container | parts |
 *          no-parts | edge | outside | no-outside | no-component
 *   text   one English sentence saying what is missing
 *
 * Without the block the report names the block once, not every element it
 * would hold. A component naming a part the Code Scaffold does not draw, an
 * edge naming no element, and a container or component that sits nowhere are
 * named too: lib/v5-c4.cjs leaves them out of the model. The report is data
 * the caller prints (missingLines gives one line per gap); it never fills a gap
 * with a guess, a placeholder or a generated sentence, and never changes the
 * record. Linting the block's values is the record lint's job, not this.
 *
 * Pure, Node builtins only, plus ./design-model.cjs, ./overview-text.cjs and
 * ./v5-c4.cjs.
 */

'use strict';

const { designModel } = require('./design-model.cjs');
const { present, storyId } = require('./overview-text.cjs');
const { LISTS, blockOf, text, isObj, list } = require('./v5-c4.cjs');

const C4 = 'technical_design.c4';

/** The gaps in the C4 block, given the drawn Code Scaffold parts. */
function c4Gaps(c4, drawn, add) {
    const kindOf = new Map();
    for (const key of LISTS) {
        list(c4[key]).forEach((e, i) => {
            if (!isObj(e)) return;
            if (!text(e.id)) add(`${C4}.${key}[${i}].id`, text(e.name) || '?', 'no-id', `${key.slice(0, -1)} ${i + 1} has no id`);
            else kindOf.set(text(e.id), key);
        });
    }
    const systems = list(c4.systems).filter((s) => isObj(s) && text(s.id));
    const internal = systems.filter((s) => s.ext !== true);
    if (!internal.length) add(`${C4}.systems`, 'systems', 'no-system', 'the C4 model has no system of its own (a system without ext), the one the intent changes');
    list(c4.containers).forEach((c, i) => {
        if (!isObj(c) || !text(c.id)) return;
        const sys = text(c.system);
        if (sys && kindOf.get(sys) !== 'systems') add(`${C4}.containers[${i}].system`, text(c.id), 'system', `container ${text(c.id)} belongs to system ${sys}, which the C4 model does not have`);
        else if (!sys && internal.length !== 1) add(`${C4}.containers[${i}].system`, text(c.id), 'system', `container ${text(c.id)} names no system, and the C4 model has ${internal.length} of its own to choose from`);
    });
    const held = new Set();
    list(c4.components).forEach((k, i) => {
        if (!isObj(k) || !text(k.id)) return;
        const id = text(k.id);
        const c = text(k.container);
        if (kindOf.get(c) !== 'containers') add(`${C4}.components[${i}].container`, id, 'container', c ? `component ${id} sits in container ${c}, which the C4 model does not have` : `component ${id} names no container`);
        const parts = list(k.parts).map(text).filter(Boolean);
        if (!parts.length) add(`${C4}.components[${i}].parts`, id, 'no-parts', `component ${id} holds no part of the Code Scaffold`);
        for (const pid of parts) {
            if (drawn.has(pid)) held.add(pid);
            else add(`${C4}.components[${i}].parts`, id, 'parts', `component ${id} holds part ${pid}, which the Code Scaffold does not draw`);
        }
    });
    list(c4.edges).forEach((e, i) => {
        if (!isObj(e)) return;
        const id = `${text(e.from) || '?'}->${text(e.to) || '?'}`;
        for (const end of ['from', 'to']) {
            const v = text(e[end]);
            if (!kindOf.has(v)) add(`${C4}.edges[${i}].${end}`, id, 'edge', v ? `edge ${id} starts or ends at ${v}, which the C4 model does not have` : `edge ${id} has no ${end}`);
        }
    });
    const outside = isObj(c4.outside) ? c4.outside : {};
    for (const [pid, sid] of Object.entries(outside)) {
        if (!drawn.has(pid)) add(`${C4}.outside.${pid}`, pid, 'outside', `outside names part ${pid}, which the Code Scaffold does not draw`);
        else if (kindOf.get(text(sid)) !== 'systems') add(`${C4}.outside.${pid}`, pid, 'outside', `part ${pid} stands for system ${text(sid) || '?'}, which the C4 model does not have`);
    }
    for (const [pid, layer] of drawn) {
        if (layer === 'external') {
            if (!(pid in outside)) add(`${C4}.outside`, pid, 'no-outside', `the external part ${pid} stands for no system of the C4 model`);
        } else if (!held.has(pid)) add(`${C4}.components`, pid, 'no-component', `part ${pid} sits in no component of the C4 model`);
    }
}

/** Every gap in the new data of the v5 page, in record order: the C4 block first, then the plain texts. */
function missing(record, opts = {}) {
    const rec = isObj(record) ? record : {};
    const recIntent = isObj(rec.intent) ? rec.intent : {};
    const slug = text(recIntent.slug) || text(opts.intent) || 'intent';
    const gaps = [];
    const add = (path, id, kind, what) => gaps.push({ path, id, kind, text: what });
    const c4 = blockOf(rec);
    if (!c4) add(C4, slug, 'c4', 'the record has no C4 model: no persons, systems, containers, components or edges');
    else {
        const design = designModel(rec);
        const drawn = new Map(((design && design.parts) || []).filter((p) => p.id && p.layer).map((p) => [p.id, p.layer]));
        c4Gaps(c4, drawn, add);
    }
    if (!present(recIntent.plain)) add('intent.plain', slug, 'plain', 'the intent has no plain text');
    list(rec.stories).forEach((s, i) => {
        if (!isObj(s)) return;
        const id = present(s.id) ? storyId(s.id) : String(i + 1);
        if (!present(s.plain)) add(`stories[${i}].plain`, id, 'plain', `story ${id} has no plain text`);
    });
    return gaps;
}

/** One line per gap, for the caller to print: `path (id): text`. */
const missingLines = (gaps) => gaps.map((g) => `${g.path} (${g.id}): ${g.text}`);

module.exports = { missing, missingLines };
