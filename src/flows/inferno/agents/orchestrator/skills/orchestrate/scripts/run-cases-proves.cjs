'use strict';

/**
 * The brief's `Tester proves:` line, as pure functions: the case ids it names and the tokens it
 * names besides. A case id is a token of the host's case-id shape, group 1 of a `cases.files`
 * case opener, so a path with a line number, a section number or a date on that line is never
 * one: each once became an id no commit could answer, and the gate was red before it ran a
 * command. A host whose openers capture no id has no shape, and its line reads as it did before
 * the shape: every token that holds a digit. run-cases.cjs owns the config and the gate.
 */

const LINE = /^[*_\s-]*Tester proves:?[*_]*\s*(.*)$/im;
/** The brackets, emphasis, quotes and stops that wrap an id in prose, never part of it. */
const WRAP = /^[([{<*_`'"]+|[)\]}>*_`'".,;:!?]+$/g;

/** The index past the `]` that closes the character class opened at `at`. */
function classEnd(source, at) {
  let index = at + 1;
  while (index < source.length && source[index] !== ']') index += source[index] === '\\' ? 2 : 1;
  return index;
}

/** The source of the first capturing group of a regex source, or null when it has none. */
function groupOne(source) {
  let depth = 0;
  let open = null;
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at];
    if (char === '\\') at += 1;
    else if (char === '[') at = classEnd(source, at);
    else if (char === '(') {
      depth += 1;
      const named = /^\?<(?![=!])[^>]*>/.exec(source.slice(at + 1));
      if (open === null && (source[at + 1] !== '?' || named)) open = { depth, from: at + 1 + (named ? named[0].length : 0) };
    } else if (char === ')') {
      if (open && open.depth === depth) return source.slice(open.from, at);
      depth -= 1;
    }
  }
  return null;
}

/** The whole-token shape of a case id from validated cases settings, or null when no opener captures one. */
function idShape(settings) {
  const groups = settings ? settings.files.map((entry) => groupOne(entry.opener.source)).filter(Boolean) : [];
  return groups.length > 0 ? new RegExp(`^(?:${groups.join('|')})$`) : null;
}

/** The raw tokens of the line, split on commas and spaces. */
function rawTokens(text) {
  const line = LINE.exec(text || '');
  return line ? line[1].split(/[,\s]+/) : [];
}

/** The tokens of the line, each without the prose around it. */
const tokens = (text) => rawTokens(text).map((token) => token.replace(WRAP, '')).filter(Boolean);

/** The case ids the brief's `Tester proves:` line names, or none. */
function testerProves(text, shape) {
  if (!shape) return rawTokens(text).map((token) => token.replace(/[^\w-]/g, '')).filter((token) => /\d/.test(token));
  return tokens(text).filter((token) => shape.test(token));
}

/** The tokens of the line that are no case id of `shape`. */
const otherTokens = (text, shape) => tokens(text).filter((token) => !shape.test(token));

module.exports = { idShape, otherTokens, testerProves, tokens };
