'use strict';

/**
 * A YAML subset: maps, block and inline lists, quoted scalars, block scalars. Enough for
 * .specs-inferno/config.yaml and a work item's execution manifest, and no more. Anything
 * richer belongs in a real parser.
 *
 * Zero dependencies, the constraint run-lib.cjs carries too: these scripts run inside
 * consumer projects that have no node_modules.
 */

const { RunError } = require('./run-error.cjs');

/** The escapes a double-quoted scalar carries. Anything else is a defect in the manifest. */
const ESCAPES = new Map([
  ['"', '"'],
  ['\\', '\\'],
  ['/', '/'],
  ["'", "'"],
  ['n', '\n'],
  ['t', '\t'],
  ['r', '\r'],
  ['0', '\0'],
  [' ', ' '],
]);

/**
 * Where the quoted run opening at `start` closes, or -1 when it never does. A backslash
 * escape inside double quotes and a doubled quote inside single quotes stay inside the run,
 * which is what keeps a `#` or a `,` behind them out of the comment and list scanners.
 */
function endOfQuoted(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    if (quote === '"' && text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] !== quote) continue;
    if (quote === "'" && text[i + 1] === "'") {
      i += 1;
      continue;
    }
    return i;
  }
  return -1;
}

function stripComment(value) {
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '"' || char === "'") {
      const end = endOfQuoted(value, i);
      if (end === -1) return value;
      i = end;
    } else if (char === '#' && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i);
    }
  }
  return value;
}

/**
 * Decode the body of a double-quoted scalar. An escape this parser does not implement
 * stops the run: passing it through hands bash a backslash its author never wrote, and a
 * finalize_check that reads a literal quote is red forever or green for nothing.
 */
function unescapeDouble(body, label) {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\') {
      out += body[i];
      continue;
    }
    const next = body[i + 1];
    if (next === undefined || !ESCAPES.has(next)) {
      throw new RunError(
        `unsupported escape \\${next === undefined ? '' : next} in the double-quoted value of ${label}. ` +
          `This parser reads \\" \\\\ \\/ \\' \\n \\t \\r \\0 and an escaped space.`,
        'BAD_MANIFEST'
      );
    }
    out += ESCAPES.get(next);
    i += 1;
  }
  return out;
}

/** Strip a scalar's outer quotes and decode what they escape. */
function unquote(value, label) {
  const trimmed = value.trim();
  const last = trimmed.length - 1;
  if (last >= 1 && (trimmed[0] === '"' || trimmed[0] === "'") && endOfQuoted(trimmed, 0) === last) {
    const body = trimmed.slice(1, -1);
    return trimmed[0] === '"' ? unescapeDouble(body, label || 'a value') : body.replace(/''/g, "'");
  }
  return trimmed;
}

/** Outer quotes only, for git's own quoting, whose C escapes this parser does not read. */
function stripQuotes(value) {
  const trimmed = value.trim();
  const last = trimmed.length - 1;
  if (last >= 1 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed[last] === trimmed[0]) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Split an inline list on the commas outside its quoted entries. */
function splitInline(body) {
  const out = [];
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '"' || char === "'") {
      const end = endOfQuoted(body, i);
      if (end === -1) break;
      i = end;
    } else if (char === ',') {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out;
}

function scalar(raw, label) {
  const text = stripComment(raw).trim();
  if (text.startsWith('[') && text.endsWith(']')) {
    return splitInline(text.slice(1, -1))
      .map((entry) => unquote(entry, label))
      .filter((entry) => entry.length > 0);
  }
  return unquote(text, label);
}

function rowsOf(text) {
  const lines = text.split('\n');
  const rows = lines
    .map((line, index) => ({ indent: /^( *)/.exec(line)[1].length, text: line.trim(), raw: line, line: index + 1 }))
    .filter((row) => row.text.length > 0 && !row.text.startsWith('#'));
  // A block scalar's body is read from the lines as written: an empty line and a line that opens
  // with a hash are part of it, and neither is a row.
  rows.lines = lines.map((line) => line.replace(/\r$/, ''));
  return rows;
}

/**
 * A block scalar header: `|` or `>`, then at most one chomping marker and one indentation digit,
 * in either order. A value made of those characters alone that YAML does not allow, such as `>0`
 * or `|-+`, is refused on the marker's own line: read as text, its body lines would be refused one
 * line further on, under a message that points away from the marker.
 */
const HEADER = /^([|>])(?:([-+])([1-9])?|([1-9])([-+])?)?$/;

function blockHeader(value, line) {
  if (!/^[|>][-+0-9]*$/.test(value)) return null;
  const match = HEADER.exec(value);
  if (!match) {
    throw new RunError(
      `cannot parse line ${line}: the block scalar header ${value} is not one YAML allows. Write | or >, then at ` +
        'most one of - or + and one indentation digit 1 to 9, in either order; nothing was read past that line.',
      'BAD_YAML'
    );
  }
  return { fold: match[1] === '>', chomp: match[2] || match[5] || '', digit: Number(match[3] || match[4] || 0) };
}

/** The text of a block's body lines, its indent cut off, an empty line as ''. */
function blockText(body, { fold, chomp }) {
  let last = body.length;
  while (last > 0 && body[last - 1] === '') last -= 1;
  let out = '';
  let empties = 0;
  let read = false;
  let deeper = false;
  for (const line of body.slice(0, last)) {
    if (line === '') {
      empties += 1;
      continue;
    }
    // Folding joins two lines of text with a space, and an empty line between them stands for one
    // line break. A more indented line keeps the line breaks around it, as a literal line does.
    if (!fold || /^[ \t]/.test(line)) {
      deeper = fold;
      out += '\n'.repeat(read ? 1 + empties : empties);
    } else if (deeper) {
      deeper = false;
      out += '\n'.repeat(empties + 1);
    } else {
      out += empties === 0 ? (read ? ' ' : '') : '\n'.repeat(empties);
    }
    out += line;
    read = true;
    empties = 0;
  }
  // Keep (`+`) keeps the final line break and every empty line after it, and strip (`-`) drops
  // them. Clip, no marker, reads as strip, as this reader always read `|` and `>`: every value it
  // hands on is a path, a command, a line of code or a piece of copy that a reader matches against
  // a file or prints in a line, where a final break would make a pin's copy or a mutant's line miss.
  return chomp === '+' ? out + '\n'.repeat((read ? 1 : 0) + body.length - last) : out;
}

/**
 * The block scalar whose header stands on `line` under a node indented `parent`, and the index of
 * the first row after it. The body is every line indented deeper than the parent, or as deep as
 * the indentation digit says, up to the first line of text indented less.
 */
function parseBlockScalar(rows, index, parent, header, line) {
  const { lines } = rows;
  let indent = header.digit > 0 ? parent + header.digit : null;
  const body = [];
  let end = line;
  for (let i = line; i < lines.length; i += 1) {
    if (lines[i].trim() === '') {
      if (i < lines.length - 1) body.push('');
      continue;
    }
    const own = /^ */.exec(lines[i])[0].length;
    if (indent === null && own > parent) indent = own;
    if (indent === null || own < indent) break;
    body.push(lines[i].slice(indent));
    end = i + 1;
  }
  let next = index;
  while (next < rows.length && rows[next].line <= end) next += 1;
  return [blockText(body, header), next];
}

function parseNode(rows, index, indent, label) {
  if (rows[index].text.startsWith('- ')) return parseList(rows, index, indent, label);
  return parseMap(rows, index, indent);
}

function parseList(rows, index, indent, label) {
  const out = [];
  let i = index;
  while (i < rows.length && rows[i].indent === indent && rows[i].text.startsWith('- ')) {
    // The comment goes before the item is read as `key: value`, as YAML cuts it: else
    // `- path  # note: text` reads as the map {"path  # note": "text"}. A plain key never opens
    // with a quote, so a quoted scalar holding `: ` stays one scalar.
    const rest = stripComment(rows[i].text.slice(2)).trim();
    if (/^(?:"[^"]*"|'[^']*'|[^:"'][^:]*):(?: |$)/.test(rest)) {
      rows[i] = { indent: indent + 2, text: rest, raw: rest, line: rows[i].line };
      const [value, next] = parseMap(rows, i, indent + 2);
      out.push(value);
      i = next;
    } else {
      const header = blockHeader(rest, rows[i].line);
      if (header) {
        const [value, next] = parseBlockScalar(rows, i + 1, indent, header, rows[i].line);
        out.push(value);
        i = next;
      } else {
        out.push(scalar(rest, label));
        i += 1;
      }
    }
  }
  return [out, i];
}

function parseMap(rows, index, indent) {
  const out = {};
  let i = index;
  while (i < rows.length && rows[i].indent === indent && !rows[i].text.startsWith('- ')) {
    const match = /^("[^"]*"|'[^']*'|[^:]+):\s*(.*)$/.exec(rows[i].text);
    if (!match) break;
    const key = unquote(match[1], match[1]);
    const rest = match[2];
    // A header written `verification: # the cheap checks` carries a comment, not a value. Read
    // it as the empty value it is, or the block under it and every key after it fall out of
    // the document with no error at all (2026-09-09).
    // A block scalar's marker may carry a comment of its own too: `notes: |  # as written`.
    const value = stripComment(rest).trim();
    const header = blockHeader(value, rows[i].line);
    i += 1;
    if (header) {
      const [body, next] = parseBlockScalar(rows, i, indent, header, rows[i - 1].line);
      out[key] = body;
      i = next;
    } else if (value === '' && i < rows.length && rows[i].indent > indent) {
      const [value, next] = parseNode(rows, i, rows[i].indent, key);
      out[key] = value;
      i = next;
    } else {
      out[key] = scalar(rest, key);
    }
  }
  return [out, i];
}

/**
 * Parse the YAML subset above. Anything richer belongs in a real parser, not here.
 *
 * A document is parsed whole or not at all. Returning what was read up to the first line this
 * subset cannot place is how a config lost half its checks in silence, and half a config
 * looks exactly like a project that configured less.
 */
function parseYaml(text) {
  const rows = rowsOf(text);
  if (rows.length === 0) return {};
  const [value, next] = parseNode(rows, 0, rows[0].indent);
  if (next < rows.length) {
    throw new RunError(
      `cannot parse line ${rows[next].line}: ${rows[next].text}. This YAML subset reads maps, ` +
        'block and inline lists, quoted scalars and block scalars; nothing was read past that line.',
      'BAD_YAML'
    );
  }
  return value;
}

module.exports = { parseYaml, stripQuotes };
