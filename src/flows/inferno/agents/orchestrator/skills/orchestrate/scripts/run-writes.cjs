'use strict';

/**
 * The callers of what an item writes through. A work item may list under `writes:` the functions
 * its change writes through, and `run.cjs frontier` prints every file that calls one of them and
 * that the item does not cite as a `candidate` line. Measured 2026-09-18: a planner that routed a
 * write through an existing store function missed the command wrapper around it in two of three
 * runs, whatever its text said, and the side effects the store alone skips (a sync, a recomputed
 * index, an event) live in that wrapper. A candidate refuses nothing: the planner judges it.
 *
 * The search is held as narrow as the ownership closure (run-ownership.cjs) holds its own: one
 * git grep per item for the whole words, a file above the size cap read as empty, a name with more
 * uncited callers than one item can take printed as `skipped`, and the per-item print cap shared
 * with the ownership candidates. A file counts as a caller only where a line calls the name: a
 * definition, a declaration, a comment and a longer name are no call. A test file, the plan's own
 * files and the docs are never callers, because a test is reached by its runner and the existing
 * closure already names the tests that reference what an item owns.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { isTestFile } = require('./run-test-files.cjs');

/** One function name as code spells it, with no module, path or parentheses. */
const NAME = /^[A-Za-z_$][\w$]*$/;
/** One git grep per item, so the names stay a command line rather than a scan of the tree. */
const MAX_NAMES = 20;
const MAX_BYTES = 400 * 1024;
/** Above this a name is a habit of the codebase, more callers than one item can be handed. */
const MAX_HITS = 6;

/** Where no caller lives: the plan, the installed flow, the docs. */
const OUTSIDE = [':(exclude).specs-inferno', ':(exclude).specsmd', ':(exclude,glob)**/*.md', ':(exclude,glob)**/*.mdx'];
/** A test is reached by its runner, as run-ownership.cjs reads the same folders. */
const TEST_FOLDER = /(^|\/)(e2e|integration)\//;

/** The words that may stand before a definition's name, and the ones that make it a call. */
const MODIFIERS = '(?:pub(?:\\([^)]*\\))?|export|default|public|private|protected|internal|static|async|override|abstract|final|virtual|readonly|declare|get|set|unsafe|const|extern|inline)';
const CONTROL = new Set([
  'return', 'await', 'yield', 'throw', 'new', 'delete', 'typeof', 'else', 'do', 'case', 'in', 'of', 'not', 'and', 'or',
  'if', 'elif', 'while', 'for', 'with', 'assert', 'raise', 'lambda', 'print', 'echo', 'go', 'defer', 'match', 'let',
  'var', 'val', 'is', 'as', 'using', 'lock', 'loop', 'move', 'from', 'import', 'except', 'then',
]);

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every refusal of one item's `writes:`, in the shape team-scheduler gives a wrong `reads:` entry.
 * An item that writes through no existing function omits the key, so an absent key is no error.
 */
function writesErrors(id, writes) {
  if (writes === undefined || writes === null) return [];
  if (!Array.isArray(writes) || writes.length === 0) {
    return [`${id}: writes must list at least one function when the item declares it`];
  }
  const errors = [];
  writes.forEach((entry, index) => {
    if (typeof entry !== 'string' || !NAME.test(entry.trim())) {
      errors.push(`${id}: writes[${index}] must be one function name, such as save_item, without its module, path or parentheses`);
    }
  });
  return errors;
}

/** A line without its comment: none when the line is one, the code before a trailing one. */
function code(line) {
  const text = line.trim();
  if (/^(\/\/|\/\*|\*|#(?!\[)|--|<!--|;;)/.test(text)) return '';
  return text.replace(/\/\*.*?\*\//g, '').replace(/(^|\s)\/\/.*$/, '').replace(/\s#\s.*$/, '');
}

/** Whether `text`, free of comments, defines or declares `name` rather than calling it. */
function defines(text, name) {
  const args = '\\s*(?:(?:::)?<[^<>()]*>)?\\s*\\(';
  if (new RegExp(`\\b(?:fn|def|func|fun|function|sub|proc)\\b[^=;{}]*?(?<![\\w$])${name}${args}`).test(text)) return true;
  const head = new RegExp(`^(?:${MODIFIERS}\\s+)*(?:([\\w$][\\w$<>\\[\\],.?]*)\\s+)?${name}${args}[^;]*\\)\\s*((?::|->|throws)[^;{=]*)?(\\{.*|;)?$`);
  const match = head.exec(text);
  if (!match) return false;
  const [, type, annotation, end] = match;
  if (type && CONTROL.has(type)) return false;
  if (end && end.startsWith('{')) return true;
  return Boolean(type || annotation);
}

/** The 1-based line of the first call of `name` in `body`, or 0 when no line calls it. */
function callLine(body, name) {
  const call = new RegExp(`(?<![\\w$])${escape(name)}\\s*(?:(?:::)?<[^<>()]*>)?\\s*\\(`);
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const text = code(lines[i]);
    if (call.test(text) && !defines(text, escape(name))) return i + 1;
  }
  return 0;
}

function read(tree, rel) {
  try {
    const file = path.join(tree, rel);
    return fs.statSync(file).size > MAX_BYTES ? '' : fs.readFileSync(file, 'utf8');
  } catch (error) {
    return '';
  }
}

/** The paths an item cites: the files it owns, every path its manifest names, and its own text. */
function citer(tree, item) {
  const entries = (list) => (Array.isArray(list) ? list : []).map((entry) => entry && entry.path).filter(Boolean);
  const context = item.context || {};
  const named = [
    ...((item.ownership && item.ownership.editable) || []),
    ...entries(context.required), ...entries(context.patterns), ...entries(context.tests),
    ...entries(item.reads), ...entries(item.design_contract),
  ].filter((entry) => typeof entry === 'string' && entry.trim() !== '');
  let text = '';
  try {
    text = item.file ? fs.readFileSync(item.file, 'utf8') : '';
  } catch (error) {
    text = '';
  }
  return (file) => text.includes(file) || lib.ownedBy(file, named, tree);
}

/**
 * Adds to `closure` (run-ownership.cjs `candidates`) the uncited callers of what each item in
 * `items` writes through, with `ownedBy` set when another open item in `open` holds the file. A
 * file the closure already names for the item is not named twice.
 */
function addCallers(tree, items, open, closure) {
  if (!lib.git(tree, ['rev-parse', '--git-dir'], { tolerate: true })) return closure;
  for (const item of items) {
    const names = [...new Set((item.writes || []).map((entry) => String(entry).trim()))].slice(0, MAX_NAMES);
    if (names.length === 0) continue;
    const args = ['grep', '-l', '-I', '-w', '-F'];
    for (const name of names) args.push('-e', name);
    const files = lib.gitLines(tree, [...args, '--', '.', ...OUTSIDE], { tolerate: true }).sort();
    const cites = citer(tree, item);
    const known = new Set(closure.found.filter((entry) => entry.item === item.id).map((entry) => entry.path));
    const callers = new Map(names.map((name) => [name, []]));
    const seen = new Map(names.map((name) => [name, false]));
    for (const file of files) {
      const body = read(tree, file);
      for (const name of names) {
        if (new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`).test(body)) seen.set(name, true);
        if (isTestFile(file) || TEST_FOLDER.test(file) || cites(file)) continue;
        const line = callLine(body, name);
        if (line > 0) callers.get(name).push({ file, line });
      }
    }
    const taken = new Set();
    for (const name of names) {
      const hits = callers.get(name);
      if (!seen.get(name) || hits.length > MAX_HITS) {
        closure.skipped.push({ item: item.id, key: name, hits: hits.length });
        continue;
      }
      for (const { file, line } of hits) {
        if (known.has(file) || taken.has(file)) continue;
        taken.add(file);
        const other = (open || []).find(
          (entry) => entry.id !== item.id && lib.ownedBy(file, entry.ownership && entry.ownership.editable, tree)
        );
        closure.found.push({ item: item.id, path: file, calls: name, line, ownedBy: other ? other.id : null });
      }
    }
  }
  return closure;
}

module.exports = { addCallers, callLine, writesErrors };
