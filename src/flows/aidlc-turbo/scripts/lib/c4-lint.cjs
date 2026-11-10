/**
 * specsmd AI-DLC Turbo - spec-lint's check of the C4 model and the plain texts.
 *
 * lintC4(record, add) checks technical_design.c4 (its shape is written down
 * once, in the header of lib/v5-model.cjs) and the plain texts intent.plain
 * and stories[].plain against the rest of the record. Every finding goes to
 * add('record.yaml', 'c4', message), the message opening with the record path.
 *
 * It holds what the record gives, nothing more: a record without the block and
 * without plain texts is clean, as one without a drawing is to design-lint.cjs.
 * What is absent (the block, a part in no component, an external part with no
 * outside entry, a component without parts) is named by the missing report of
 * lib/v5-missing.cjs, never here. The wrong references that report finds are
 * taken from it, not checked twice.
 *
 *   - the block is a map, its persons, systems, containers, components and
 *     edges are lists of maps, outside a map
 *   - ids filled and unique over persons, systems, containers and
 *     components together, without @
 *   - every status new, changed or existing; a system's kind system or db, a
 *     container's container or db; ext, intent and ends true or false
 *   - every reference names an element of the right sort: a container's
 *     system, a component's container, both ends of an edge, the system an
 *     outside entry stands for
 *   - a component's parts are a list of parts the Code Scaffold draws, and no
 *     part sits in two components
 *   - every story an element names is a story of the record
 *   - a system with ext holds no container: it is outside the application
 *   - the plain texts: once the record carries one, the intent's and every
 *     story's are there; each is plain words in the record's language (no
 *     code, no markdown) without an em-dash; the intent's three to five
 *     sentences and at most 700 characters, a story's at most 450
 *
 * Pure, Node builtins only, plus ./v5-c4.cjs, ./v5-missing.cjs and
 * ./overview-text.cjs.
 */

'use strict';

const { LISTS, STATUS, blockOf, text, isObj, list } = require('./v5-c4.cjs');
const { missing } = require('./v5-missing.cjs');
const { present, storyId } = require('./overview-text.cjs');

const C4 = 'technical_design.c4';
const KINDS = { systems: ['system', 'db'], containers: ['container', 'db'] };
const FLAGS = { systems: ['ext'], edges: ['intent', 'ends'] };
// the gaps of lib/v5-missing.cjs that are a wrong value the record gives, not an absent one
const WRONG = new Set(['no-id', 'system', 'container', 'parts', 'edge', 'outside']);

const INTENT_MAX = 700;
const STORY_MAX = 450;
const SENTENCES_MIN = 3;
const SENTENCES_MAX = 5;
const DASH = '\u2014';
const CODE = /`|\b\w+_\w+\b|\b[\w-]+\.(?:java|jsx?|tsx?|cjs|mjs|sql|xml|jsp|ya?ml|json|py|html?|css|md|sh)\b|\b\w+\(\)/i;
const MARKUP = /\*\*|\]\(|^\s*#|^\s*[-*]\s/m;

const given = (v) => v !== undefined && v !== null;
/** Sentences end in . ! or ? before a capital; `e.g. the` stays one. */
const sentences = (t) => t.split(/(?<=[.!?])\s+(?=["'(]?[A-ZÀ-Þ])/).filter((s) => s.trim()).length;
const expected = (allowed) => (allowed.length === 2 ? `${allowed[0]} or ${allowed[1]}` : `one of ${allowed.join(', ')}`);

/** The block's own shape and values: lists, ids, known values, parts, stories, ext. */
function lintBlock(c4, rec, say) {
    for (const key of [...LISTS, 'edges']) if (given(c4[key]) && !Array.isArray(c4[key])) say(`${C4}.${key}`, 'must be a list');
    if (given(c4.outside) && !isObj(c4.outside)) say(`${C4}.outside`, 'must be a map of external part id to system id');

    const stories = new Set(list(rec.stories).filter((s) => isObj(s) && present(s.id)).map((s) => storyId(s.id)));
    const ext = new Set(list(c4.systems).filter((s) => isObj(s) && s.ext === true).map((s) => text(s.id)).filter(Boolean));
    const ids = new Set();
    const holder = new Map();
    const oneOf = (at, who, field, value, allowed) => {
        if (given(value) && !allowed.includes(value)) say(`${at}.${field}`, `${who} has ${field} "${value}", expected ${expected(allowed)}`);
    };

    for (const key of LISTS) {
        const one = key.slice(0, -1);
        list(c4[key]).forEach((e, i) => {
            const at = `${C4}.${key}[${i}]`;
            if (!isObj(e)) { say(at, 'is not a map: give it an id and a name'); return; }
            const id = text(e.id);
            const who = `${one} ${id || i + 1}`;
            if (id && id.includes('@')) say(`${at}.id`, `id ${id} holds an @, which the v5 page leaves out: pick another id`);
            if (id && ids.has(id)) say(`${at}.id`, `id ${id} appears twice: persons, systems, containers and components share one set of ids`);
            if (id) ids.add(id);
            if (key === 'persons') return;
            if (present(e.status)) oneOf(at, who, 'status', text(e.status), STATUS);
            if (KINDS[key] && present(e.kind)) oneOf(at, who, 'kind', text(e.kind), KINDS[key]);
            for (const flag of FLAGS[key] || []) oneOf(at, who, flag, e[flag], [true, false]);
            if (given(e.stories)) {
                if (!Array.isArray(e.stories)) say(`${at}.stories`, `${who}: stories must be a list of story ids`);
                else {
                    e.stories.filter(present).map(storyId).filter((s) => !stories.has(s))
                        .forEach((s) => say(`${at}.stories`, `${who} names story ${s}, which is not a story of this intent`));
                }
            }
            const sys = text(e.system);
            if (key === 'containers' && sys && ext.has(sys)) {
                say(`${at}.system`, `${who} sits in system ${sys}, which is outside the application (ext): a system with ext holds no containers, give ${id || who} a system of the application or drop ext`);
            }
            if (key !== 'components') return;
            if (given(e.parts) && !Array.isArray(e.parts)) say(`${at}.parts`, `${who}: parts must be a list of part ids`);
            for (const pid of new Set(list(e.parts).map(text).filter(Boolean))) {
                if (holder.has(pid)) say(`${at}.parts`, `part ${pid} sits in ${holder.get(pid)} and in ${who}: a part sits in one component`);
                else holder.set(pid, who);
            }
        });
    }

    list(c4.edges).forEach((e, i) => {
        const at = `${C4}.edges[${i}]`;
        if (!isObj(e)) { say(at, 'is not a map: give it from, to and label'); return; }
        const who = `edge ${text(e.from) || '?'}->${text(e.to) || '?'}`;
        for (const flag of FLAGS.edges) oneOf(at, who, flag, e[flag], [true, false]);
    });
}

/** The plain texts: all there once one is, plain words, the template's length, no em-dash. */
function lintPlain(rec, say) {
    const intent = isObj(rec.intent) ? rec.intent : {};
    const texts = [{ at: 'intent.plain', who: 'the intent', value: intent.plain, max: INTENT_MAX, counted: true }];
    list(rec.stories).forEach((s, i) => {
        if (isObj(s)) texts.push({ at: `stories[${i}].plain`, who: `story ${present(s.id) ? storyId(s.id) : i + 1}`, value: s.plain, max: STORY_MAX });
    });
    if (!texts.some((x) => present(x.value))) return;
    for (const x of texts) {
        if (!present(x.value)) { say(x.at, `${x.who} has no plain text: once the record carries plain texts, the intent and every story have one`); continue; }
        const raw = String(x.value).trim();
        const t = raw.replace(/\s+/g, ' ');
        const note = (message) => say(x.at, `${x.who}: the plain text ${message}`);
        const length = Array.from(t).length;
        if (length > x.max) note(`is ${length} characters, at most ${x.max}`);
        const n = x.counted ? sentences(t) : 0;
        if (x.counted && (n < SENTENCES_MIN || n > SENTENCES_MAX)) note(`is ${n} sentence${n === 1 ? '' : 's'}, expected three to five`);
        if (t.includes(DASH)) note('holds an em-dash: use a comma, a colon or a full stop');
        if (CODE.test(t)) note('holds code (backticks, a file name, an identifier or a call): say it in the words of the people who use it');
        if (MARKUP.test(raw)) note('holds markdown (bold, a heading, a list or a link): write plain sentences');
    }
}

/** spec-lint's check of the C4 block and the plain texts; a record without them is clean. */
function lintC4(record, add) {
    const rec = isObj(record) ? record : {};
    const say = (where, message) => add('record.yaml', 'c4', `${where}: ${message}`);
    const td = isObj(rec.technical_design) ? rec.technical_design : {};
    if (given(td.c4) && !isObj(td.c4)) say(C4, 'must be a map of persons, systems, containers, components, edges and outside');
    const c4 = blockOf(rec);
    if (c4) {
        lintBlock(c4, rec, say);
        for (const g of missing(rec)) if (WRONG.has(g.kind)) say(g.path, g.text);
    }
    lintPlain(rec, say);
}

module.exports = { lintC4, INTENT_MAX, STORY_MAX };
