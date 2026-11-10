'use strict';

/**
 * The project's own rules. A host keeps them in `.specs-inferno/standards/`, one file per
 * topic, and its config lists each file under `standards:` with the path globs it applies to:
 *
 *   standards:
 *     - file: typescript.md
 *       paths: ["src/**", "web/*.tsx"]
 *
 * `standardsFor(root, paths, { config })` is the one entry point: the builder dispatch asks it
 * with the item's `ownership.editable`, and a reviewer lens with the paths a change touched. A
 * host without the folder or without the block gets an empty list, so it runs as before. A
 * `--config` file without the block takes the block of `.specs-inferno/config.yaml`, the way it
 * takes the other project facts, because the rules are the project's and not one host's.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { parseYaml } = require('./run-yaml.cjs');

const { RunError } = lib;
const STANDARDS_DIR = '.specs-inferno/standards';
const DEFAULT_CONFIG = '.specs-inferno/config.yaml';

/** The config file that holds the block, and the block, or null when no config holds one. */
function blockOf(root, selected) {
  const files = [...new Set([selected, DEFAULT_CONFIG].filter(Boolean).map((file) => path.resolve(root, file)))];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const config = parseYaml(fs.readFileSync(file, 'utf8')) || {};
    if (Object.prototype.hasOwnProperty.call(config, 'standards')) return { file, block: config.standards };
  }
  return null;
}

const refuse = (message) => new RunError(message, 'BAD_CONFIG');

function plainName(name) {
  return typeof name === 'string' && name.length > 0 && !path.posix.isAbsolute(name) && !name.includes('\\') &&
    path.posix.normalize(name) === name && !name.split('/').includes('..');
}

/** Every entry of the block as `{ file, paths }`, with `file` relative to the project root. */
function readStandards(root, options = {}) {
  const found = blockOf(root, options.config);
  if (!found || found.block === null || found.block === undefined) return [];
  const where = path.relative(root, found.file);
  if (!Array.isArray(found.block)) throw refuse(`standards in ${where} must be a list of entries, each a file and its paths`);
  return found.block.map((entry, index) => {
    const name = entry && typeof entry === 'object' ? entry.file : undefined;
    if (!plainName(name)) {
      throw refuse(`standards entry ${index + 1} in ${where} needs a file inside ${STANDARDS_DIR}/, not ${String(name || 'none')}`);
    }
    const paths = entry.paths;
    if (!Array.isArray(paths) || paths.length === 0 || !paths.every((glob) => typeof glob === 'string' && glob.length > 0)) {
      throw refuse(`standards entry ${name} in ${where} needs paths, a list of the globs it applies to`);
    }
    return { file: `${STANDARDS_DIR}/${name}`, paths: [...paths] };
  });
}

// A path with a wildcard is a glob, so a rule file applies when its globs and that glob share a
// path. Both compile to the same small automaton run-lib's globToRegExp describes, and the
// product of the two is searched for a path both accept.

const ANY = { any: true };
const SEGMENT = { segment: true };
const isGlob = (entry) => /[*?]/.test(entry);

function automaton(pattern) {
  const states = [];
  const add = () => states.push({ moves: [], next: [], accept: false }) - 1;
  const start = add();
  let at = start;
  if (!pattern.includes('/')) {
    // A pattern with no slash matches a name at any depth: anything ending in a slash may come first.
    at = add();
    states[start].next.push(at);
    states[start].moves.push({ on: ANY, to: start }, { on: '/', to: at });
  }
  const source = pattern.replace(/\/+$/, '/**');
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '*' && source[i + 1] === '*' && source[i + 2] === '/') {
      const loop = add();
      const inside = add();
      states[at].next.push(loop);
      states[loop].moves.push({ on: SEGMENT, to: inside });
      states[inside].moves.push({ on: SEGMENT, to: inside }, { on: '/', to: loop });
      at = loop;
      i += 2;
    } else if (source[i] === '*') {
      const wide = source[i + 1] === '*';
      states[at].moves.push({ on: wide ? ANY : SEGMENT, to: at });
      if (wide) i += 1;
    } else {
      const to = add();
      states[at].moves.push({ on: source[i] === '?' ? SEGMENT : source[i], to });
      at = to;
    }
  }
  states[at].accept = true;
  return states;
}

function closure(states, from) {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    for (const to of states[queue.shift()].next) {
      if (seen.has(to)) continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return [...seen];
}

function meets(a, b) {
  if (a === ANY || b === ANY) return true;
  if (a === SEGMENT || b === SEGMENT) return (a === SEGMENT ? b : a) !== '/';
  return a === b;
}

/** True when some path matches both globs. */
function overlaps(first, second) {
  const a = automaton(first);
  const b = automaton(second);
  const seen = new Set(['0,0']);
  const queue = [[0, 0]];
  while (queue.length > 0) {
    const [left, right] = queue.shift();
    const lefts = closure(a, left);
    const rights = closure(b, right);
    if (lefts.some((state) => a[state].accept) && rights.some((state) => b[state].accept)) return true;
    for (const one of lefts.flatMap((state) => a[state].moves)) {
      for (const other of rights.flatMap((state) => b[state].moves)) {
        const key = `${one.to},${other.to}`;
        if (meets(one.on, other.on) && !seen.has(key)) {
          seen.add(key);
          queue.push([one.to, other.to]);
        }
      }
    }
  }
  return false;
}

function applies(globs, entry) {
  return isGlob(entry) ? globs.some((glob) => overlaps(glob, entry)) : lib.matchesAny(entry, globs);
}

/**
 * The rule files that apply to `paths`, relative to `root`, in the order the config lists them.
 * `paths` are exact paths or globs; `options.config` is the host config the runner was given.
 * A listed file that does not exist is refused by name, whether it applies or not.
 */
function standardsFor(root, paths, options = {}) {
  if (!fs.existsSync(path.join(root, STANDARDS_DIR))) return [];
  const entries = readStandards(root, options);
  const missing = entries.filter((entry) => !fs.existsSync(path.join(root, entry.file))).map((entry) => entry.file);
  if (missing.length > 0) {
    throw refuse(`standards file ${missing.join(', ')} does not exist: write it or remove its entry from the standards block`);
  }
  return entries.filter((entry) => (paths || []).some((target) => applies(entry.paths, target))).map((entry) => entry.file);
}

module.exports = { STANDARDS_DIR, overlaps, readStandards, standardsFor };
