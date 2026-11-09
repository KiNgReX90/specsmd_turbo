/**
 * specsmd AI-DLC Turbo - the integration tests of the overview page.
 *
 * Each story's record lists `integration: [{ with, test }]`: a test in the
 * later story that runs against the real code of the earlier story `with`,
 * written in the record's language.
 * The page shows each one as a card, so this module adds what a reader needs
 * and the record does not hold as separate fields:
 *   - id: T1, T2, ... in story order, the label on the card and on its arrow.
 *   - code: the real classes the test runs against, the drawing parts whose name
 *     the test text names, each with the story that builds it; when the
 *     text names none, the parts the earlier story builds and the later one uses
 *     (codeFrom: 'drawing' instead of 'test', so the page can say so).
 *   - expect: the expected outcome, cut from the test text (after the last
 *     colon, else the clause with the first outcome verb of the record's
 *     language, overview.outcomeWords in the string table); empty when no
 *     such clause is found, never invented.
 */
'use strict';

const lang = require('./lang.cjs');

const list = (v) => (Array.isArray(v) ? v : []);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pattern of the outcome verbs of a table: the words a test text states its expected outcome with. */
function outcomeWords(table) {
    const words = lang.text(table, 'overview.outcomeWords');
    return new RegExp(`(?<![\\p{L}])(${(Array.isArray(words) ? words : []).map(reEsc).join('|') || '$^'})(?![\\p{L}])`, 'u');
}

/** The expected outcome in a test text, or '' when it has no clear one. `table`: the string table of its language. */
function outcome(text, table = lang.load(lang.FALLBACK)) {
    if (!text) return '';
    const colon = text.lastIndexOf(': ');
    if (colon > 0 && text.length - colon > 8) return text.slice(colon + 2).trim();
    const m = outcomeWords(table).exec(text);
    if (!m) return '';
    const comma = text.lastIndexOf(', ', m.index);
    return text.slice(comma >= 0 ? comma + 2 : 0).trim();
}

function integrationTests(raw, record, { plain, storyId, present, table = lang.load(lang.FALLBACK) }) {
    const drawing = (record && record.technical_design && record.technical_design.drawing) || {};
    const parts = list(drawing.parts).filter((p) => p && p.id && present(p.name));
    const builds = new Map(raw.map((s) => [s.id, Object.keys((s.rec && s.rec.drawing && s.rec.drawing.builds) || {})]));
    const uses = new Map(raw.map((s) => [s.id, list(s.rec && s.rec.drawing && s.rec.drawing.uses)]));
    const owner = (pid, earlier, later) => {
        if ((builds.get(earlier) || []).includes(pid)) return earlier;
        if ((builds.get(later) || []).includes(pid)) return later;
        const s = raw.find((r) => (builds.get(r.id) || []).includes(pid));
        return s ? s.id : null;
    };
    const card = (p, earlier, later) => ({ name: String(p.name), what: plain(p.what), story: owner(p.id, earlier, later) });
    let n = 0;
    return raw.flatMap((s) => list(s.rec && s.rec.integration)
        .filter((e) => e && typeof e === 'object' && present(e.with))
        .map((e) => {
            const earlier = storyId(e.with);
            const test = plain(e.test);
            let code = parts
                .map((p) => ({ p, at: test.search(new RegExp(`(^|[^\\w])${reEsc(String(p.name))}(?![\\w])`)) }))
                .filter((x) => x.at >= 0)
                .sort((a, b) => a.at - b.at)
                .map((x) => card(x.p, earlier, s.id));
            let codeFrom = 'test';
            if (!code.length) {
                const used = new Set(uses.get(s.id) || []);
                code = parts.filter((p) => (builds.get(earlier) || []).includes(p.id) && used.has(p.id))
                    .map((p) => card(p, earlier, s.id));
                codeFrom = code.length ? 'drawing' : '';
            }
            return {
                id: `T${++n}`,
                later: s.id,
                earlier,
                full: test,
                expect: outcome(test, table),
                code,
                codeFrom,
            };
        }));
}

module.exports = { integrationTests, outcome };
