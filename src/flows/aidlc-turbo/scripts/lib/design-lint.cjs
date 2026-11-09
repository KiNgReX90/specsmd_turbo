/**
 * specsmd AI-DLC Turbo - spec-lint's check of the Code Scaffold.
 *
 * lintDrawing(record, add, fsx) checks technical_design.drawing and every
 * story's drawing (see design-model.cjs for the shape) against the rest of
 * the record and against the code. Every finding goes to add('record.yaml',
 * 'drawing', message). A record without a drawing is clean, and spec-lint
 * does not call it at all when a sandbox switched the Code Scaffold off
 * (`sandbox.code_scaffold: false`, read by story-start.cjs readSettings).
 *
 *   - ids unique over modules and parts, filled, without @; every layer,
 *     status, kind, link kind and right status a known value
 *   - a part's module is a module id, every module has a part
 *   - no part is a .md file: documentation is no part of the drawing
 *   - a changed or existing part has path and lines; outside another
 *     repository (repo) the path exists and holds those lines
 *   - a new part or module (no repo) does not exist yet; a changed or
 *     existing module does
 *   - every follows file and registered_in file exists and holds its lines
 *     (no repo)
 *   - stories build only what is new or changed, and every such part and
 *     module is built by one; the path of what a story builds sits in its
 *     touches, exactly or as a folder of one or the other. A changed table
 *     changes through a new migration, so its own file needs no touches
 *   - links name parts; builds and uses name parts or modules
 *   - every arrow is proven: a link that calls an existing part gives proof
 *     (file and lines where the callee offers it) and no adds; one that
 *     calls a changed part gives proof or adds; a new callee and a
 *     builds_on link need neither. A proof file exists and holds its lines
 *     unless the callee lives in another repository (repo)
 *   - a new right names a decision of the record (D-n)
 *   - an open choice (open) comes with open_detail
 *   - the drawing and every story's drawing have a summary
 *
 * fsx answers for repo-relative paths: { exists(path), lineCount(path) },
 * lineCount null for a folder or a missing file. diskFsx(root) is the real
 * disk; tests pass a fake one. Node builtins only.
 */

const fs = require('fs');
const path = require('path');
const { LAYERS, STATUS, KINDS, LINK_KINDS, designModel } = require('./design-model.cjs');

const D = 'technical_design.drawing';
const RIGHT_STATUS = ['new', 'existing'];
const LINES = /^(\d+)(?:\s*-\s*(\d+))?$/;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const norm = (p) => String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
const storyId = (v) => { const s = String(v).trim(); return /^\d+$/.test(s) ? s.padStart(3, '0') : s; };
/** True when a and b are the same path, or one is a folder of the other. */
const covers = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** The real disk, for paths relative to root (the target project's root). */
function diskFsx(root) {
    const at = (p) => path.resolve(root, p);
    return {
        exists: (p) => fs.existsSync(at(p)),
        lineCount: (p) => {
            try {
                if (!fs.statSync(at(p)).isFile()) return null;
                const t = fs.readFileSync(at(p), 'utf8');
                return t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0;
            } catch {
                return null;
            }
        },
    };
}

function lintDrawing(record, add, fsx) {
    const model = designModel(record);
    if (!model) return;
    const say = (message) => add('record.yaml', 'drawing', message);
    const oneOf = (who, field, value, allowed) => {
        if (allowed.includes(value)) return true;
        const expected = allowed.length === 2 ? `${allowed[0]} or ${allowed[1]}` : `one of ${allowed.join(', ')}`;
        say(value ? `${D}: ${who} has ${field} "${value}", expected ${expected}` : `${D}: ${who} has no ${field}, expected ${expected}`);
        return false;
    };
    /** Lines "N" or "N-M", inside the file when the disk can tell. */
    const checkLines = (who, label, lines, file, onDisk) => {
        if (!lines) return;
        const m = LINES.exec(lines);
        const to = m ? Number(m[2] || m[1]) : 0;
        if (!m || Number(m[1]) < 1 || to < Number(m[1])) { say(`${D}: ${who}: ${label} "${lines}" is not N or N-M`); return; }
        const n = onDisk ? fsx.lineCount(file) : null;
        if (typeof n === 'number' && to > n) say(`${D}: ${who}: ${label} ${lines} fall outside ${file}, which has ${n} lines`);
    };
    /** An example (follows) or a registration (registered_in): the file exists and holds its lines. */
    const checkPlace = (who, label, place, onDisk) => {
        if (!place) return;
        const file = norm(place.file);
        if (onDisk && !fsx.exists(file)) { say(`${D}: ${who}: ${label === 'registered_in' ? label : `${label}.file`} ${file} does not exist`); return; }
        checkLines(who, `${label} lines`, place.lines, file, onDisk);
    };

    if (!model.summary) say(`${D} has no summary: say in a few plain sentences, in the record's language, what the drawing shows`);
    if (!model.parts.length) say(`${D} has no parts: draw the classes, files and tables the intent builds and uses`);

    // --- ids, unique over modules and parts together ------------------------
    const seen = new Set();
    for (const [items, what] of [[model.modules, 'modules'], [model.parts, 'parts']]) {
        items.forEach((x, i) => {
            if (!x.id) { say(`${D}: ${what}[${i}] has no id`); return; }
            if (x.id.includes('@')) say(`${D}: id ${x.id} holds an @: the drawing keeps @ for a module's frame per layer, pick another id`);
            if (seen.has(x.id)) say(`${D}: id ${x.id} appears twice: module and part ids are unique together`);
            seen.add(x.id);
        });
    }
    const partById = new Map(model.parts.filter((p) => p.id).map((p) => [p.id, p]));
    const moduleById = new Map(model.modules.filter((m) => m.id).map((m) => [m.id, m]));
    const built = new Set(model.stories.flatMap((s) => Object.keys(s.builds)));
    const decisions = new Set(list(record.decisions).filter(isObj).map((d) => text(d.id)).filter(Boolean));
    const notBuilt = (who, x) => {
        if (x.id && (x.status === 'new' || x.status === 'changed') && !built.has(x.id)) {
            say(`${D}: ${who} is ${x.status} but no story builds it: add it to a story's drawing.builds`);
        }
    };

    // --- modules -------------------------------------------------------------
    model.modules.forEach((m, i) => {
        const who = `module ${m.id || `modules[${i}]`}`;
        const known = oneOf(who, 'status', m.status, STATUS);
        if (m.id && !model.parts.some((p) => p.module === m.id)) say(`${D}: ${who} has no part: give it its parts, or drop it`);
        const onDisk = !m.repo;
        const file = m.path ? norm(m.path) : null;
        if (known && m.status !== 'new') {
            if (!file) say(`${D}: ${who} is ${m.status} but has no path: give the folder it lives in`);
            else if (onDisk && !fsx.exists(file)) say(`${D}: ${who}: path ${file} does not exist: fix the path, or mark the module new`);
        } else if (known && file && onDisk && fsx.exists(file)) say(`${D}: ${who} is new but ${file} already exists: mark it changed`);
        checkPlace(who, 'follows', m.follows, onDisk);
        m.registered_in.forEach((r) => checkPlace(who, 'registered_in', r, onDisk));
        notBuilt(who, m);
    });

    // --- parts ---------------------------------------------------------------
    model.parts.forEach((p, i) => {
        const who = `part ${p.id || `parts[${i}]`}`;
        oneOf(who, 'layer', p.layer, LAYERS);
        const known = oneOf(who, 'status', p.status, STATUS);
        oneOf(who, 'kind', p.kind, KINDS);
        if (p.module && !moduleById.has(p.module)) say(`${D}: ${who} names module ${p.module}, which is not a module id`);
        const onDisk = !p.repo;
        const file = p.path ? norm(p.path) : null;
        if (file && /\.(md|markdown)$/i.test(file)) say(`${D}: ${who} is a .md file (${file}): documentation is no part of the Code Scaffold, leave it out`);
        if (known && p.status !== 'new') {
            if (!file || !p.lines) say(`${D}: ${who} is ${p.status} but the place in the code is not checked: give path and lines, an explorer looks it up`);
            else if (onDisk && !fsx.exists(file)) say(`${D}: ${who}: path ${file} does not exist: fix the path, or mark the part new`);
            else checkLines(who, 'lines', p.lines, file, onDisk);
        } else if (known) {
            if (!file) say(`${D}: ${who} has no path: give the repo-relative file or folder it creates`);
            else if (onDisk && fsx.exists(file)) say(`${D}: ${who} is new but ${file} already exists: it is not new, mark it changed and give its lines`);
        }
        checkPlace(who, 'follows', p.follows, onDisk);
        if (p.right && oneOf(who, 'right.status', p.right.status, RIGHT_STATUS) && p.right.status === 'new') {
            if (!p.right.decision) say(`${D}: ${who} has a new right without a decision: name the D-n that creates it in right.decision`);
            else if (!decisions.has(p.right.decision)) say(`${D}: ${who}: right.decision ${p.right.decision} is not in decisions`);
        }
        if (p.open && !p.open_detail) say(`${D}: ${who} has open without open_detail: write out the choice the approval asks`);
        notBuilt(who, p);
    });

    // --- links: every arrow proven in the code -------------------------------
    /**
     * A call into an existing or changed part shows where the callee offers it,
     * or what the change adds. A builds_on link has no rule: the part's own
     * path and lines prove its base. A given proof is checked like follows.
     */
    const checkProof = (who, l, to, calls) => {
        const offer = `give proof.file and proof.lines where ${to.id} already offers what is called, an explorer looks it up`;
        if (calls && to.status === 'existing') {
            if (!l.proof) say(`${D}: ${who} calls an existing part without proof: ${offer}; when it is not there, mark ${to.id} changed and say in adds what the change adds`);
            if (l.adds) say(`${D}: ${who} has adds, but ${to.id} is existing and changes nothing: mark ${to.id} changed, or drop adds`);
        } else if (calls && to.status === 'changed' && !l.proof && !l.adds) {
            say(`${D}: ${who} calls a changed part with neither proof nor adds: ${offer}, or say in adds what the change to ${to.id} adds for this call`);
        }
        if (!l.proof) return;
        if (!l.proof.lines) say(`${D}: ${who}: proof has no lines: give the lines in ${norm(l.proof.file)} where ${to.id} offers it`);
        checkPlace(who, 'proof', l.proof, !to.repo);
    };
    model.links.forEach((l, i) => {
        const missing = ['from', 'to'].filter((end) => !l[end]);
        missing.forEach((end) => say(`${D}: link ${i + 1} has no ${end}`));
        const who = `link ${l.from || '?'} -> ${l.to || '?'}`;
        for (const end of ['from', 'to']) {
            if (l[end] && !partById.has(l[end])) say(`${D}: ${who}: ${end} ${l[end]} is not a part id`);
        }
        const calls = oneOf(who, 'kind', l.kind, LINK_KINDS) && l.kind === 'calls';
        const to = partById.get(l.to);
        if (to) checkProof(who, l, to, calls);
    });

    // --- stories: what each builds and uses ----------------------------------
    let k = 0;
    list(record.stories).filter(isObj).forEach((s, i) => {
        const who = `story ${text(s.id) ? storyId(s.id) : `stories[${i}]`}`;
        if (!isObj(s.drawing)) { say(`${who}: no drawing: give it a summary, what it builds and what it uses`); return; }
        const ms = model.stories[k];
        k += 1;
        if (!ms.summary) say(`${who}: drawing has no summary: say in a few plain sentences, in the record's language, what this story builds`);
        const builds = s.drawing.builds;
        if (builds !== undefined && builds !== null && !isObj(builds)) {
            say(`${who}: drawing.builds must be a map of part or module id to what this story builds there`);
        }
        const touches = list(s.touches).map(norm).filter(Boolean);
        for (const id of Object.keys(ms.builds)) {
            const part = partById.get(id);
            const x = part || moduleById.get(id);
            if (!x) { say(`${who}: drawing builds ${id}, which is not a part or module id`); continue; }
            if (x.status === 'existing') { say(`${who}: drawing builds ${id}, which is existing: move it to uses, or mark it changed`); continue; }
            // A changed table changes through a new migration, never in the file that created it.
            const own = x.path && !x.repo && !(part && part.layer === 'database' && part.status === 'changed');
            if (own && !touches.some((t) => covers(norm(x.path), t))) {
                say(`${who}: drawing builds ${part ? 'part' : 'module'} ${id} at ${norm(x.path)}, which no touches entry covers: add the path or a folder of it to touches`);
            }
        }
        for (const id of ms.uses) {
            if (!partById.has(id) && !moduleById.has(id)) say(`${who}: drawing uses ${id}, which is not a part or module id`);
        }
    });
}

module.exports = { lintDrawing, diskFsx };
