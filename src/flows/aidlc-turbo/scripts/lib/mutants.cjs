/**
 * specsmd AI-DLC Turbo - check, apply and undo one mutant of story-mutate.cjs.
 *
 * A mutant is { id, file, line, from, to, test, criterion } as the story
 * reviewer proposed it. This module knows:
 * - the list (checkList: a JSON array, every id once) and each mutant's
 *   fields (fieldProblem: `missing {fields}`, `{fields} must be text`, or
 *   `line must be a whole number from 1`); a mutant without a usable id is
 *   `#{position}` (mutantId);
 * - the program its test runs (testProgram): an
 *   optional leading `cd {dir} && ` is allowed, `dir` relative, without `..`
 *   and without operator characters; the rest may hold none of ; & | < > ` $
 *   or a line break;
 * - the line it breaks (locate): `from` exactly once on line `line`, else the
 *   one line of the file that holds `from` (exactly once), else none;
 * - the mutated bytes (mutateBuffer): `from` is found and replaced as bytes,
 *   on that line only, so CRLF, a missing final newline and a file that is
 *   not UTF-8 stay as they were;
 * - the restore: the original Buffer written back and its sha256 checked,
 *   once more from the copy when it does not match. A restore that still
 *   differs throws an error with code RESTORE. lib/mutant-marker.cjs runs a
 *   mutant with it.
 *
 * Node builtins only: the target project often has no node_modules at all.
 */

const fs = require('fs');
const crypto = require('crypto');

const FIELDS = ['id', 'file', 'line', 'from', 'to', 'test', 'criterion'];
const SHELL_OPS = /[;&|<>`$\n\r]/;
const CD_PREFIX = /^cd\s+([^\s;&|<>`$]+)\s*&&\s*/;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** A usable id: the mutant's own, else `#{position}` (1-based). */
const mutantId = (m, i) => (m && typeof m.id === 'string' && m.id.trim() ? m.id : `#${i + 1}`);

/** The problem with the list as a whole, or null: not an array, or an id used twice. */
function checkList(mutants) {
    if (!Array.isArray(mutants)) return 'the mutants file must hold a JSON array';
    const seen = new Set();
    for (const [i, m] of mutants.entries()) {
        const id = mutantId(m, i);
        if (seen.has(id)) return `the mutant id ${id} is used twice`;
        seen.add(id);
    }
    return null;
}

/** Why one mutant's fields are unusable (its `invalid` reason), or null. */
function fieldProblem(m) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return `missing ${FIELDS.join(', ')}`;
    const missing = FIELDS.filter((f) => m[f] === undefined || m[f] === null);
    if (missing.length) return `missing ${missing.join(', ')}`;
    if (!Number.isInteger(m.line) || m.line < 1) return 'line must be a whole number from 1';
    const bad = FIELDS.filter((f) => f !== 'line' && (typeof m[f] !== 'string' || (f !== 'to' && !m[f].trim())));
    return bad.length ? `${bad.join(', ')} must be text` : null;
}

/** The program a command runs and the command without its `cd {dir} && ` prefix. */
function testProgram(command) {
    const text = String(command).trim();
    const cd = text.match(CD_PREFIX);
    const relative = cd && !/^([/\\]|[A-Za-z]:)/.test(cd[1]) && !cd[1].split(/[/\\]/).includes('..');
    const rest = relative ? text.slice(cd[0].length) : text;
    return { program: rest.split(/\s+/)[0], rest };
}

/** Why the test command may not run, or null. */
function testProblem(test, programs) {
    const { program, rest } = testProgram(test);
    if (SHELL_OPS.test(rest)) return 'test has shell operators';
    if (!programs.has(program)) return 'test is not a verification program';
    return null;
}

/** Byte ranges [start, end) of every line, the line end not included. */
function lineRanges(buf) {
    const out = [];
    let start = 0;
    for (let i = 0; i < buf.length; i += 1) {
        if (buf[i] === 0x0a) { out.push([start, i]); start = i + 1; }
    }
    if (start < buf.length) out.push([start, buf.length]);
    return out;
}

/** Byte offsets of `needle` within [start, end) of buf, overlaps counted. */
function offsets(buf, [start, end], needle) {
    const out = [];
    for (let i = buf.indexOf(needle, start); i !== -1 && i + needle.length <= end; i = buf.indexOf(needle, i + 1)) out.push(i);
    return out;
}

/** The 1-based line to mutate: `line` when it holds `from` exactly once, else the one line that does, else null. */
function locate(buf, line, from) {
    const needle = Buffer.from(from, 'utf8');
    const ranges = lineRanges(buf);
    if (line <= ranges.length && offsets(buf, ranges[line - 1], needle).length === 1) return line;
    const holding = ranges.map((r, i) => ({ i, n: offsets(buf, r, needle).length })).filter((h) => h.n > 0);
    return holding.length === 1 && holding[0].n === 1 ? holding[0].i + 1 : null;
}

/**
 * The file with `from` replaced by `to` on that one line. The replace works on
 * bytes, so a file that is not UTF-8 (an ISO-8859-1 Java source) keeps every
 * other byte of the line too.
 */
function mutateBuffer(buf, line, from, to) {
    const needle = Buffer.from(from, 'utf8');
    const at = offsets(buf, lineRanges(buf)[line - 1], needle)[0];
    return Buffer.concat([buf.subarray(0, at), Buffer.from(to, 'utf8'), buf.subarray(at + needle.length)]);
}

/** Write the original back and check it; once more when it differs. Throws code RESTORE. */
function restore(file, original) {
    const want = sha256(original);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            fs.writeFileSync(file, original);
            if (sha256(fs.readFileSync(file)) === want) return;
        } catch { /* try again, then give up */ }
    }
    const error = new Error(`restore failed: ${file}`);
    error.code = 'RESTORE';
    throw error;
}

module.exports = {
    FIELDS, sha256, mutantId, checkList, fieldProblem, testProgram, testProblem, lineRanges, locate, mutateBuffer, restore,
};
