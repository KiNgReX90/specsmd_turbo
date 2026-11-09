/**
 * specsmd AI-DLC Turbo - the string tables, one per language.
 *
 * Everything the flow writes for people (the markdown headings of a story,
 * "None.", the fixed texts of the overview page, its Code Scaffold and its
 * C4 model) comes from one table per language. There is no language
 * setting: the inception agent writes the record in the language the user
 * speaks in the session and stores it as `intent.language`, a BCP-47 code
 * such as `en`, `de` or `fr`. A record without it is `en`.
 *
 * A table is read in three layers, each filling what the one above lacks:
 *
 *   .specs-aidlc-turbo/repo/lang/{code}.json   the project's own table, an agent-written translation
 *   templates/lang/{code}.json                 a table that ships with the flow (en)
 *   templates/lang/en.json                     every key, the fallback for a missing one
 *
 * A code with a region (`pt-BR`) also tries its language (`pt`). An unknown
 * language without a project table gets the English table.
 *
 * Usage, to see whether a language has a table yet:
 *   node .specsmd/aidlc-turbo/scripts/lib/lang.cjs <code> [--root .specs-aidlc-turbo]
 * Exit 0 with "built-in" or "project", 1 with "missing" and the file to write.
 * With --show <section> it prints that section of the language's whole
 * table as JSON (the words an agent writes in that language, such as
 * testCase); exit 2 when there is no such section.
 *
 * Node builtins only.
 */

const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = '.specs-aidlc-turbo';
const BUILT_IN = path.join(__dirname, '..', '..', 'templates', 'lang');
const FALLBACK = 'en';

const isMap = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** A BCP-47 code as the tables name it: lower case, `-` between the parts. `en` when it is empty. */
function normalize(code) {
    const c = String(code === undefined || code === null ? '' : code).trim().replace(/_/g, '-').toLowerCase();
    return /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/.test(c) ? c : FALLBACK;
}

/** The codes to try for a language, most specific first: pt-br, pt. */
function candidates(code) {
    const parts = normalize(code).split('-');
    return parts.map((_, i) => parts.slice(0, parts.length - i).join('-'));
}

/** The language a record is written in: its intent.language, else en. */
function languageOf(record) {
    const intent = isMap(record) && isMap(record.intent) ? record.intent : {};
    return normalize(intent.language);
}

/** The artifact root of an intent from paths.findIntent: docs/{inception}/{intent} lies three folders below it. */
function rootOfIntent(intent) {
    return path.dirname(path.dirname(path.dirname(intent.dir)));
}

/** Where the project keeps its own tables. */
function projectDir(root = ARTIFACT_DIR) {
    return path.join(root, 'repo', 'lang');
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

/** b over a: every key of b wins, maps merge key by key, a list or a text replaces. */
function merge(a, b) {
    if (!isMap(b)) return a;
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = isMap(v) && isMap(out[k]) ? merge(out[k], v) : v;
    return out;
}

/** Which table a language gets: { code, source: built-in | project | missing, file }. */
function find(code, root = ARTIFACT_DIR) {
    for (const c of candidates(code)) {
        const own = path.join(projectDir(root), `${c}.json`);
        if (fs.existsSync(own)) return { code: c, source: 'project', file: own };
        const shipped = path.join(BUILT_IN, `${c}.json`);
        if (fs.existsSync(shipped)) return { code: c, source: 'built-in', file: shipped };
    }
    return { code: normalize(code), source: 'missing', file: path.join(projectDir(root), `${normalize(code)}.json`) };
}

/**
 * The whole table of a language: en, then the built-in table of the
 * language, then the project's own, each filling what the next lacks.
 */
function load(code, root = ARTIFACT_DIR) {
    let table = readJson(path.join(BUILT_IN, `${FALLBACK}.json`)) || {};
    for (const c of candidates(code).reverse()) {
        if (c !== FALLBACK) table = merge(table, readJson(path.join(BUILT_IN, `${c}.json`)));
        table = merge(table, readJson(path.join(projectDir(root), `${c}.json`)));
    }
    return { ...table, lang: normalize(code) };
}

/** The table of the language a record is written in. */
function forRecord(record, root = ARTIFACT_DIR) {
    return load(languageOf(record), root);
}

/** One text by its dotted key, with {name} filled from vars. The key itself when the table has no such text. */
function text(table, key, vars) {
    let v = table;
    for (const k of String(key).split('.')) v = isMap(v) ? v[k] : undefined;
    if (typeof v !== 'string') return Array.isArray(v) ? v : key;
    return vars ? v.replace(/\{(\w+)\}/g, (m, name) => (vars[name] === undefined ? m : String(vars[name]))) : v;
}

/** Every distinct value of one key over the built-in tables and the one given: to read text any of them wrote. */
function everyWord(table, key) {
    const out = new Set([text(table, key)]);
    for (const f of fs.readdirSync(BUILT_IN).filter((n) => n.endsWith('.json'))) {
        const t = readJson(path.join(BUILT_IN, f));
        if (t) out.add(text(t, key));
    }
    return [...out].filter((w) => typeof w === 'string' && w !== key);
}

function main(argv) {
    const args = argv.slice();
    const at = args.indexOf('--root');
    const root = at >= 0 ? args.splice(at, 2)[1] || ARTIFACT_DIR : ARTIFACT_DIR;
    const sh = args.indexOf('--show');
    const section = sh >= 0 ? args.splice(sh, 2)[1] : null;
    if (args.length !== 1 || args[0].startsWith('-') || (sh >= 0 && !section)) {
        console.error('Usage: node .specsmd/aidlc-turbo/scripts/lib/lang.cjs <code> [--root .specs-aidlc-turbo] [--show <section>]');
        return 2;
    }
    if (section) {
        const part = load(args[0], root)[section];
        if (!isMap(part)) {
            console.error(`no section ${section} in the table of ${normalize(args[0])}`);
            return 2;
        }
        console.log(JSON.stringify(part, null, 2));
        return 0;
    }
    const hit = find(args[0], root);
    if (hit.source === 'missing') {
        console.log(`missing: no table for ${hit.code}. Translate ${path.join(BUILT_IN, 'en.json')} into ${hit.file}, keys unchanged.`);
        return 1;
    }
    console.log(`${hit.source}: ${hit.file}`);
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { BUILT_IN, FALLBACK, normalize, candidates, languageOf, rootOfIntent, projectDir, merge, find, load, forRecord, text, everyWord };
