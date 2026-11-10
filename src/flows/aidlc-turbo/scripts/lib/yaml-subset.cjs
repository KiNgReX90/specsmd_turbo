/**
 * specsmd AI-DLC Turbo - YAML, the subset the flow writes: the record, the
 * register, sync.yaml and the config. render-specs.cjs reads and writes the
 * record with it and passes parseYaml and dumpYaml on; a script that needs
 * no rendering (the sync scripts, the source register) reads YAML from here
 * directly.
 *
 * Node builtins only.
 */

function yamlError(message, line) {
    return new Error(line ? `YAML line ${line}: ${message}` : `YAML: ${message}`);
}

/** Resolve a plain scalar the way YAML 1.2 core does, dates stay strings. */
function resolvePlain(text) {
    const t = text.trim();
    if (t === '' || /^(null|Null|NULL|~)$/.test(t)) return null;
    if (/^(true|True|TRUE)$/.test(t)) return true;
    if (/^(false|False|FALSE)$/.test(t)) return false;
    if (/^[-+]?\d+$/.test(t)) return Number(t);
    if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
    return t;
}

const ESCAPES = { 0: '\0', a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0' };

/** Read a quoted scalar starting at s[i]. Returns [value, index after the closing quote]. */
function readQuoted(s, i, line) {
    const q = s[i];
    const escaped = [];
    let out = '';
    let j = i + 1;
    // Escapes are held out of the text until the line breaks are folded.
    const hold = (ch) => { out += `\u0001${escaped.length}\u0002`; escaped.push(ch); };
    const done = () => foldQuoted(out).replace(/\u0001(\d+)\u0002/g, (m, n) => escaped[Number(n)]);
    while (j < s.length) {
        const ch = s[j];
        if (q === "'" && ch === "'") {
            if (s[j + 1] === "'") { hold("'"); j += 2; continue; }
            return [done(), j + 1];
        }
        if (q === '"' && ch === '"') return [done(), j + 1];
        if (q === '"' && ch === '\\') {
            const next = s[j + 1];
            if (next === 'x' || next === 'u' || next === 'U') {
                const len = { x: 2, u: 4, U: 8 }[next];
                hold(String.fromCodePoint(parseInt(s.slice(j + 2, j + 2 + len), 16)));
                j += 2 + len;
                continue;
            }
            if (next === '\n') { j += 2; while (s[j] === ' ' || s[j] === '\t') j += 1; continue; }
            if (!(next in ESCAPES)) throw yamlError(`unknown escape \\${next}`, line);
            hold(ESCAPES[next]);
            j += 2;
            continue;
        }
        out += ch;
        j += 1;
    }
    throw yamlError('unterminated quoted string', line);
}

/** Line breaks inside a quoted scalar fold to a space; each empty line is a newline. */
function foldQuoted(raw) {
    return raw.replace(/[ \t]*\n((?:[ \t]*\n)*)[ \t]*/g, (m, blanks) => (blanks ? '\n'.repeat(blanks.split('\n').length - 1) : ' '));
}

/** True once every bracket of a flow collection is closed. */
function flowClosed(s) {
    let depth = 0;
    let atStart = true;
    for (let i = 0; i < s.length; i += 1) {
        const ch = s[i];
        if ((ch === '"' || ch === "'") && atStart) {
            try { i = readQuoted(s, i)[1] - 1; } catch { return false; }
            atStart = false;
            continue;
        }
        if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
            const nl = s.indexOf('\n', i);
            if (nl < 0) break;
            i = nl;
            continue;
        }
        if (ch === '[' || ch === '{') { depth += 1; atStart = true; } else if (ch === ']' || ch === '}') { depth -= 1; atStart = false; } else if (ch === ',' || ch === ':') atStart = true;
        else if (!/\s/.test(ch)) atStart = false;
    }
    return depth <= 0;
}

/** Parse a flow value at s[i]. Returns [value, index]. */
function readFlow(s, i, line, stops) {
    const ws = () => {
        for (;;) {
            while (i < s.length && /\s/.test(s[i])) i += 1;
            if (s[i] === '#' && (i === 0 || /\s/.test(s[i - 1]))) { while (i < s.length && s[i] !== '\n') i += 1; } else return;
        }
    };
    ws();
    const ch = s[i];
    if (ch === '[') {
        const arr = [];
        i += 1;
        for (;;) {
            ws();
            if (s[i] === ']') return [arr, i + 1];
            if (i >= s.length) throw yamlError('unclosed [', line);
            const [v, j] = readFlow(s, i, line, ',]');
            arr.push(v);
            i = j;
            ws();
            if (s[i] === ',') i += 1;
            else if (s[i] !== ']') throw yamlError(`expected , or ] in a flow list, found "${s[i] || 'end'}"`, line);
        }
    }
    if (ch === '{') {
        const obj = {};
        i += 1;
        for (;;) {
            ws();
            if (s[i] === '}') return [obj, i + 1];
            if (i >= s.length) throw yamlError('unclosed {', line);
            let key;
            if (s[i] === '"' || s[i] === "'") [key, i] = readQuoted(s, i, line);
            else {
                const start = i;
                while (i < s.length && !/[,}]/.test(s[i]) && !(s[i] === ':' && /[\s,}]/.test(s[i + 1] || ' '))) i += 1;
                key = s.slice(start, i).trim();
            }
            ws();
            let value = null;
            if (s[i] === ':') [value, i] = readFlow(s, i + 1, line, ',}');
            obj[String(key)] = value;
            ws();
            if (s[i] === ',') i += 1;
            else if (s[i] !== '}') throw yamlError(`expected , or } in a flow map, found "${s[i] || 'end'}"`, line);
        }
    }
    if (ch === '"' || ch === "'") return readQuoted(s, i, line);
    const start = i;
    while (i < s.length && !stops.includes(s[i]) && !(s[i] === '#' && /\s/.test(s[i - 1] || ' '))) i += 1;
    return [resolvePlain(s.slice(start, i).replace(/\s+/g, ' ')), i];
}

/** Parse YAML text into plain JS values. Throws with the line number on what it cannot read. */
function parseYaml(text) {
    const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const lines = src.split('\n').map((raw, n) => {
        if (/^ *\t/.test(raw) && raw.trim()) throw yamlError('tab used for indentation', n + 1);
        return { raw, n: n + 1, indent: raw.length - raw.replace(/^ +/, '').length };
    });
    let pos = 0;
    const content = (l) => l.raw.slice(l.indent);
    const blank = (l) => {
        const c = content(l);
        return c === '' || c.startsWith('#') || (l.indent === 0 && /^(---|\.\.\.)\s*$/.test(c));
    };
    const skip = () => { while (pos < lines.length && blank(lines[pos])) pos += 1; };
    const isItem = (c) => c === '-' || c.startsWith('- ');

    function keyOf(c) {
        if (c.startsWith('[') || c.startsWith('{') || isItem(c)) return null;
        if (c[0] === '"' || c[0] === "'") {
            try {
                const [key, j] = readQuoted(c, 0);
                const m = /^\s*:(\s|$)/.exec(c.slice(j));
                return m ? { key: String(key), rest: c.slice(j + m[0].length) } : null;
            } catch { return null; }
        }
        const m = /^([^#][^:]*?|[^#]\S*?):(\s|$)/.exec(c);
        if (!m || /\s#/.test(m[1])) return null;
        return { key: m[1].trim(), rest: c.slice(m[0].length) };
    }

    function blockScalar(header, parentIndent, line) {
        const m = /^([|>])([+-]?)(\d?)([+-]?)\s*(#.*)?$/.exec(header);
        if (!m) throw yamlError(`bad block scalar header "${header}"`, line);
        const folded = m[1] === '>';
        const chomp = m[2] || m[4];
        let indent = m[3] ? parentIndent + Number(m[3]) : null;
        const body = [];
        while (pos < lines.length) {
            const l = lines[pos];
            if (l.raw.trim() === '') { body.push(''); pos += 1; continue; }
            if (indent === null) {
                if (l.indent <= parentIndent) break;
                indent = l.indent;
            }
            if (l.indent < indent) break;
            body.push(l.raw.slice(indent));
            pos += 1;
        }
        let trailing = 0;
        while (body.length && body[body.length - 1] === '') { body.pop(); trailing += 1; }
        let textOut;
        if (!folded) textOut = body.join('\n');
        else {
            textOut = '';
            body.forEach((l, k) => {
                if (k === 0) { textOut = l; return; }
                const prev = body[k - 1];
                const joinable = l !== '' && prev !== '' && !/^\s/.test(l) && !/^\s/.test(prev);
                textOut += joinable ? ` ${l}` : `\n${l}`;
            });
            textOut = textOut.replace(/\n\n(?=[^\n\s])/g, '\n');
        }
        if (chomp === '-' || body.length === 0) return textOut;
        return chomp === '+' ? `${textOut}\n${'\n'.repeat(trailing)}` : `${textOut}\n`;
    }

    /** The value after `key:` or `- ` on one line; pos already points past that line. */
    function inlineValue(rest, parentIndent, line) {
        const r = rest.trim();
        if (r === '' || r.startsWith('#')) return undefined;
        if (r[0] === '|' || r[0] === '>') return blockScalar(r, parentIndent, line);
        if (r[0] === '"' || r[0] === "'" || r[0] === '[' || r[0] === '{') {
            let buf = r;
            const closed = () => {
                if (r[0] === '[' || r[0] === '{') return flowClosed(buf);
                try { readQuoted(buf, 0); return true; } catch { return false; }
            };
            while (!closed() && pos < lines.length) { buf += `\n${lines[pos].raw}`; pos += 1; }
            const [value, j] = r[0] === '[' || r[0] === '{' ? readFlow(buf, 0, line, '') : readQuoted(buf, 0, line);
            const tail = buf.slice(j).trim();
            if (tail && !tail.startsWith('#')) throw yamlError(`unexpected text after the value: "${tail}"`, line);
            return value;
        }
        let textOut = r.replace(/\s+#.*$/, '');
        // A plain scalar may continue on more indented lines.
        let blanks = 0;
        while (pos < lines.length) {
            const l = lines[pos];
            if (l.raw.trim() === '') { blanks += 1; pos += 1; continue; }
            if (l.indent <= parentIndent || content(l).startsWith('#')) break;
            textOut += blanks ? '\n'.repeat(blanks) : ' ';
            textOut += content(l).replace(/\s+#.*$/, '').trim();
            blanks = 0;
            pos += 1;
        }
        if (blanks) pos -= blanks;
        return resolvePlain(textOut);
    }

    function block(minIndent) {
        skip();
        if (pos >= lines.length) return null;
        const l = lines[pos];
        if (l.indent < minIndent) return null;
        const c = content(l);
        if (isItem(c)) return seq(l.indent);
        if (keyOf(c)) return map(l.indent);
        pos += 1;
        return inlineValue(c, l.indent - 1, l.n);
    }

    function seq(indent) {
        const out = [];
        for (;;) {
            skip();
            if (pos >= lines.length) break;
            const l = lines[pos];
            const c = content(l);
            if (l.indent !== indent || !isItem(c)) break;
            const rest = c === '-' ? '' : c.slice(2);
            const trimmed = rest.replace(/^ +/, '');
            if (trimmed === '' || trimmed.startsWith('#')) {
                pos += 1;
                out.push(block(indent + 1));
                continue;
            }
            if (isItem(trimmed) || keyOf(trimmed)) {
                const at = indent + 2 + (rest.length - trimmed.length);
                lines[pos] = { raw: ' '.repeat(at) + trimmed, n: l.n, indent: at };
                out.push(block(at));
                continue;
            }
            pos += 1;
            const v = inlineValue(trimmed, indent, l.n);
            out.push(v === undefined ? null : v);
        }
        return out;
    }

    function map(indent) {
        const out = {};
        for (;;) {
            skip();
            if (pos >= lines.length) break;
            const l = lines[pos];
            if (l.indent !== indent) {
                if (l.indent > indent) throw yamlError('unexpected indentation', l.n);
                break;
            }
            const c = content(l);
            const kv = keyOf(c);
            if (!kv) {
                if (isItem(c)) break;
                throw yamlError(`expected "key: value", found "${c}"`, l.n);
            }
            pos += 1;
            let value = inlineValue(kv.rest, indent, l.n);
            if (value === undefined) {
                skip();
                const next = lines[pos];
                if (next && next.indent > indent) value = block(indent + 1);
                else if (next && next.indent === indent && isItem(content(next))) value = seq(indent);
                else value = null;
            }
            out[kv.key] = value;
        }
        return out;
    }

    const doc = block(0);
    skip();
    if (pos < lines.length) throw yamlError(`unexpected "${content(lines[pos])}"`, lines[pos].n);
    return doc;
}

const isScalar = (v) => v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v);

/** One scalar, quoted only when YAML would read it back as something else. */
function dumpScalar(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v !== 'string') return String(v);
    const plain = v !== ''
        && v === v.trim()
        && typeof resolvePlain(v) === 'string'
        && !/[:#[\]{},&*!|>'"%@`\n\\]/.test(v)
        && !/^[-?]/.test(v);
    return plain ? v : JSON.stringify(v);
}

const dumpKey = (k) => (/^[A-Za-z_][\w-]*$/.test(k) ? k : JSON.stringify(k));

function flowOf(v) {
    if (Array.isArray(v)) return `[${v.map(flowOf).join(', ')}]`;
    if (v && typeof v === 'object') {
        const parts = Object.entries(v).map(([k, x]) => `${dumpKey(k)}: ${flowOf(x)}`);
        return parts.length ? `{ ${parts.join(', ')} }` : '{}';
    }
    return dumpScalar(v);
}

/** True when a value fits on one line: scalars, or lists and maps of scalars. */
function flat(v) {
    if (isScalar(v)) return true;
    const values = Array.isArray(v) ? v : Object.values(v);
    return values.every((x) => isScalar(x) || (Array.isArray(x) && x.every(isScalar)));
}

/** Dump plain JS values as YAML: block style on top, one-line flow style for small leaves. */
function dumpYaml(value, indent = 0) {
    const pad = ' '.repeat(indent);
    if (Array.isArray(value)) {
        if (!value.length) return `${pad}[]\n`;
        return value.map((item) => {
            if (flat(item)) return `${pad}- ${flowOf(item)}\n`;
            const inner = dumpYaml(item, indent + 2);
            return `${pad}- ${inner.slice(indent + 2)}`;
        }).join('');
    }
    if (value && typeof value === 'object') {
        return Object.entries(value).map(([k, v]) => {
            if (isScalar(v) || (flat(v) && indent > 0) || (Array.isArray(v) && !v.length)) return `${pad}${dumpKey(k)}: ${flowOf(v)}\n`;
            return `${pad}${dumpKey(k)}:\n${dumpYaml(v, indent + 2)}`;
        }).join('');
    }
    return `${pad}${dumpScalar(value)}\n`;
}

module.exports = { parseYaml, dumpYaml, dumpScalar, flowOf };
