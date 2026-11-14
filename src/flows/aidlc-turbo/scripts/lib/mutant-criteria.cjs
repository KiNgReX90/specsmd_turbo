/**
 * specsmd AI-DLC Turbo - one mutant per acceptance criterion, for
 * story-mutate.cjs.
 *
 * The story lens proposes one mutant per acceptance criterion a test covers.
 * Its `criterion` starts with the number of that criterion in the story's
 * list, 1 for the first (`AC` or `AC-` before it is allowed); the criteria no
 * real test covers come as `untested`. This module knows:
 * - the cap (capOf): `construction.mutants` of the config, a whole number from
 *   0. Anything else (`all`, no key, no config) is no cap, the default;
 * - how many criteria the story has (criteriaCount): the items of its
 *   acceptance criteria section in the record's language, else the length of
 *   its frontmatter `observed_via`. 0 when neither shows any: then no
 *   criterion is checked, and the cap keeps the first mutants of the list;
 * - which mutant may run (planMutants): a cap keeps the first that many
 *   criteria with a test and leaves the mutants of the others unrun
 *   (`capped`); a mutant is `invalid` when it names no criterion by its
 *   number, one the story does not have, or one that has a mutant already,
 *   in this run or from an earlier one. A criterion whose earlier mutant was
 *   invalid may have one new proposal, and no more;
 * - the result per criterion (criteriaResults), in the proof's `criteria`:
 *   `{ criterion, result, mutants, reason? }`, with `result` survived
 *   (one of its mutants survived), killed, invalid (with the reason of its
 *   last), missing (a test and no mutant), untested or capped.
 *
 * A proof written before `criteria` existed is read from its `mutants`: an
 * entry whose criterion starts with a number counts for that criterion.
 *
 * Node builtins only, plus ../frontmatter.cjs and the ./lib modules.
 */

const fs = require('fs');
const { extractFrontmatter } = require('../frontmatter.cjs');
const lang = require('./lang.cjs');
const { readDoc, readYaml, readStoryMarkdown } = require('./overview-read.cjs');

const NUMBER = /^\s*(?:AC-?\s*)?(\d+)\b/i;

/** The criterion number a mutant names: a number, null when it names none, undefined when the field is no text. */
function criterionNumber(text) {
    if (typeof text !== 'string') return undefined;
    const m = text.match(NUMBER);
    return m ? Number(m[1]) : null;
}

/** The cap of `construction.mutants` in a parsed config: a whole number from 0, else null (no cap). */
function capOf(config) {
    const block = config && typeof config === 'object' ? config.construction : null;
    const value = block && typeof block === 'object' ? block.mutants : undefined;
    return Number.isInteger(value) && value >= 0 ? value : null;
}

/** How many acceptance criteria the story has; 0 when it shows none. */
function criteriaCount(intent, story, root) {
    try {
        const table = lang.forRecord(readYaml(intent.record) || {}, root);
        const n = readStoryMarkdown(readDoc(story.file).body, table).criteria.length;
        if (n) return n;
        const fm = extractFrontmatter(fs.readFileSync(story.file, 'utf8')) || {};
        return Array.isArray(fm.observed_via) ? fm.observed_via.length : 0;
    } catch {
        return 0;
    }
}

/** The criterion numbers of `--untested`: "3,5" -> [3, 5]. */
const parseUntested = (text) => String(text || '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);

/**
 * The mutants that counted for each criterion before this run, as
 * Map(criterion -> [id]), leaving out the ids this run runs again. From the
 * proof's `criteria`, else from its `mutants` (a proof from before).
 */
function earlierIds(proof, count, rerun) {
    const out = new Map();
    const add = (n, id) => {
        if (!Number.isInteger(n) || n < 1 || n > count || rerun.has(id)) return;
        out.set(n, [...(out.get(n) || []), id]);
    };
    if (Array.isArray(proof.criteria)) {
        for (const c of proof.criteria) {
            if (c && Array.isArray(c.mutants)) c.mutants.forEach((id) => add(c.criterion, id));
        }
    } else if (Array.isArray(proof.mutants)) {
        for (const m of proof.mutants) if (m) add(criterionNumber(m.criterion), m.id);
    }
    return out;
}

/** The untested criteria: the flag when given, else what the earlier run recorded. */
function untestedOf(flag, proof) {
    if (flag !== null && flag !== undefined) return new Set(parseUntested(flag));
    const earlier = Array.isArray(proof.criteria) ? proof.criteria : [];
    return new Set(earlier.filter((c) => c && c.result === 'untested').map((c) => c.criterion));
}

/**
 * Plan one run. `todo` is [{ id, m }] in list order, `previous` the proof
 * before this run (only for --only), `untestedFlag` the text of --untested.
 * Returns { count, reasons: Map(id -> invalid reason), skipped: Set(id),
 * counting: Map(criterion -> [id]), untested, capped }.
 */
function planMutants({ count, cap, untestedFlag, todo, previous = null }) {
    const reasons = new Map();
    const skipped = new Set();
    if (!count) {
        if (cap !== null && !previous) todo.slice(cap).forEach(({ id }) => skipped.add(id));
        return { count, reasons, skipped, counting: new Map(), untested: new Set(), capped: new Set() };
    }
    const proof = previous || {};
    const before = earlierIds(proof, count, new Set(todo.map((t) => t.id)));
    const resultOf = new Map((Array.isArray(proof.mutants) ? proof.mutants : []).filter(Boolean).map((m) => [m.id, m]));
    const named = new Set([...before.keys(), ...todo.map(({ m }) => criterionNumber(m && m.criterion))]);
    const untested = untestedOf(untestedFlag, proof);
    const tested = [];
    for (let n = 1; n <= count; n += 1) if (named.has(n) || !untested.has(n)) tested.push(n);
    const capped = new Set(cap === null ? [] : tested.slice(cap));

    const counting = new Map([...before].map(([n, ids]) => [n, [...ids]]));
    const now = new Map();
    for (const { id, m } of todo) {
        const n = criterionNumber(m && m.criterion);
        if (n === undefined) continue;
        if (n === null) { reasons.set(id, 'criterion names no acceptance criterion by its number'); continue; }
        if (n < 1 || n > count) { reasons.set(id, `criterion ${n} is not in the story`); continue; }
        if (capped.has(n)) { skipped.add(id); continue; }
        if (now.has(n)) { reasons.set(id, `criterion ${n} has ${now.get(n)} already`); continue; }
        const earlier = before.get(n) || [];
        const held = earlier.find((e) => resultOf.get(e) && resultOf.get(e).result !== 'invalid');
        if (held) { reasons.set(id, `criterion ${n} has ${held} already`); continue; }
        if (earlier.length >= 2) { reasons.set(id, `criterion ${n} had its one new proposal`); continue; }
        now.set(n, id);
        counting.set(n, [...earlier, id]);
    }
    return { count, reasons, skipped, counting, untested, capped };
}

/**
 * The result per criterion from the plan and the proof's mutant entries after
 * the run. Returns { criteria, lines }: the proof's `criteria` and one stdout
 * line per criterion, `CRITERION {n} {result}[ {id}][ ({reason})]`, the id
 * being the mutant that decided it.
 */
function criteriaResults(plan, entries) {
    const byId = new Map(entries.map((e) => [e.id, e]));
    const criteria = [];
    const lines = [];
    for (let n = 1; n <= plan.count; n += 1) {
        const ids = (plan.counting.get(n) || []).filter((id) => byId.has(id));
        const runs = ids.map((id) => byId.get(id));
        const pick = (result) => runs.filter((r) => r.result === result).pop();
        const decided = pick('survived') || pick('killed') || runs[runs.length - 1];
        if (decided) {
            const invalid = decided.result === 'invalid';
            criteria.push({ criterion: n, result: decided.result, mutants: ids, ...(invalid ? { reason: decided.reason } : {}) });
            lines.push(`CRITERION ${n} ${decided.result} ${decided.id}${invalid ? ` (${decided.reason})` : ''}`);
        } else {
            const result = plan.capped.has(n) ? 'capped' : plan.untested.has(n) ? 'untested' : 'missing';
            criteria.push({ criterion: n, result, mutants: [] });
            lines.push(`CRITERION ${n} ${result}`);
        }
    }
    return { criteria, lines };
}

module.exports = {
    criterionNumber, capOf, criteriaCount, parseUntested, planMutants, criteriaResults,
};
