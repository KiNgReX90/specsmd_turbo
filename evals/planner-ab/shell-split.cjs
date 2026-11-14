'use strict';

/**
 * The subcommands of one shell call. A host can batch several commands into one call
 * (`sed -n 1,80p a.js; sed -n 1,80p b.js && rg -n save src`), so the A/B eval counts both the
 * calls and what they hold. A subcommand is one pipeline of the POSIX shell grammar: the list
 * operators `&&`, `||`, `;`, a background `&` and a newline end one, a `|` does not. Quotes, a
 * command substitution, backticks, a heredoc body, a comment and a line continuation are read
 * as the shell reads them, so a separator inside them splits nothing. Control words are not
 * commands: `for` and `case` headers, `do`, `then`, `else`, `fi`, `done`, `esac` and the braces
 * of a group count nothing, while the condition of an `if` or a `while` and every command of a
 * body count one each. A script the shell itself would refuse to read (an unclosed quote, a
 * heredoc with no closing line) throws, so a count never rests on a guess.
 */

const path = require('node:path');

class ShellSplitError extends Error {}

/** The index of the quote that closes the one at `start`, past backslash escapes and `$(`. */
function closeDouble(s, start) {
  for (let i = start + 1; i < s.length; i += 1) {
    if (s[i] === '\\') i += 1;
    else if (s[i] === '$' && s[i + 1] === '(') i = closeParen(s, i + 1);
    else if (s[i] === '"') return i;
  }
  throw new ShellSplitError(`unclosed " at offset ${start}`);
}

function closeSingle(s, start) {
  const end = s.indexOf("'", start + 1);
  if (end < 0) throw new ShellSplitError(`unclosed ' at offset ${start}`);
  return end;
}

function closeBacktick(s, start) {
  for (let i = start + 1; i < s.length; i += 1) {
    if (s[i] === '\\') i += 1;
    else if (s[i] === '`') return i;
  }
  throw new ShellSplitError(`unclosed \` at offset ${start}`);
}

/** The index of the `)` that closes the `(` at `open`, quotes and nesting respected. */
function closeParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\') i += 1;
    else if (c === "'") i = closeSingle(s, i);
    else if (c === '"') i = closeDouble(s, i);
    else if (c === '`') i = closeBacktick(s, i);
    else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new ShellSplitError(`unclosed ( at offset ${open}`);
}

const HEREDOC = /^<<(-?)[ \t]*(['"]?)([A-Za-z0-9_.-]+)\2/;
const LEADING = /^(?:then|do|else|elif|if|while|until|time|!|\{)\s+/;
const CLOSING = /^(?:fi|done|esac|then|do|else|\{|\})(?:\s*[<>|&0-9].*)?$/s;
const HEADER = /^(?:for|select|case)\s/;

/** A segment as a command, or '' when it holds none. */
function clean(segment) {
  let text = segment.trim();
  while (LEADING.test(text)) text = text.replace(LEADING, '').trim();
  if (text === '' || CLOSING.test(text) || HEADER.test(text)) return '';
  return text;
}

/** Appends the bodies of the heredocs opened on the line that ends at `i`; returns the index after them. */
function readHeredocs(s, i, pending, append) {
  let at = i;
  for (const doc of pending) {
    for (;;) {
      if (at >= s.length) throw new ShellSplitError(`heredoc ${doc.word} has no closing line`);
      const newline = s.indexOf('\n', at);
      const end = newline < 0 ? s.length : newline;
      const line = s.slice(at, end);
      at = end + 1;
      const closes = (doc.strip ? line.replace(/^\t+/, '') : line) === doc.word;
      append(`\n${line}`);
      if (closes) break;
    }
  }
  return at;
}

/** Every subcommand of `script`, each trimmed, in order. */
function subcommands(script) {
  const s = String(script);
  const segments = [];
  const pending = [];
  let current = '';
  const end = () => {
    segments.push(current);
    current = '';
  };
  const take = (from, to) => {
    current += s.slice(from, to + 1);
    return to + 1;
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];
    if (c === '\\') i = take(i, i + 1);
    else if (c === "'") i = take(i, closeSingle(s, i));
    else if (c === '"') i = take(i, closeDouble(s, i));
    else if (c === '`') i = take(i, closeBacktick(s, i));
    else if (c === '$' && next === '(') i = take(i, closeParen(s, i + 1));
    else if (c === '(' && /[<>]$/.test(current)) i = take(i, closeParen(s, i));
    else if (c === '#' && (current === '' || /\s$/.test(current))) {
      const newline = s.indexOf('\n', i);
      i = newline < 0 ? s.length : newline;
    } else if (s.startsWith('<<<', i)) i = take(i, i + 2);
    else if (s.startsWith('<<', i) && HEREDOC.test(s.slice(i))) {
      const match = HEREDOC.exec(s.slice(i));
      pending.push({ word: match[3], strip: match[1] === '-' });
      i = take(i, i + match[0].length - 1);
    } else if (c === '\n') {
      i = pending.length ? readHeredocs(s, i + 1, pending, (text) => { current += text; }) : i + 1;
      pending.length = 0;
      end();
    } else if (s.startsWith('&&', i) || s.startsWith('||', i) || s.startsWith(';;', i)) {
      end();
      i += 2;
    } else if (c === '&' && (next === '>' || current.endsWith('>'))) i = take(i, i);
    else if (c === ';' || c === '&' || c === '(' || c === ')') {
      end();
      i += 1;
    } else i = take(i, i);
  }
  if (pending.length) throw new ShellSplitError(`heredoc ${pending[0].word} has no closing line`);
  end();
  return segments.map(clean).filter(Boolean);
}

/**
 * What a counter adds for one shell call: its subcommands, at least one, since a call ran even
 * when its command is empty. A command the shell could not read still was one call the host
 * made, so it counts as one and says it was unread.
 */
function subcommandCount(script) {
  try {
    return { count: Math.max(1, subcommands(script).length), unread: false };
  } catch (error) {
    if (!(error instanceof ShellSplitError)) throw error;
    return { count: 1, unread: true };
  }
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const PLAIN = /^[A-Za-z0-9_./:=,@%+-]+$/;

/** The script a call runs: the string itself, the `-c` script of an argv that runs a shell, or the argv joined. */
function scriptOf(command) {
  if (typeof command === 'string') return command;
  if (!Array.isArray(command) || command.some((arg) => typeof arg !== 'string')) {
    throw new ShellSplitError(`a shell command is neither a string nor an argv: ${JSON.stringify(command)}`);
  }
  if (command.length >= 3 && SHELLS.has(path.basename(command[0])) && /^-[a-z]*c[a-z]*$/.test(command[1])) return command[2];
  return command.map((arg) => (PLAIN.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`)).join(' ');
}

module.exports = { ShellSplitError, subcommands, subcommandCount, scriptOf };
