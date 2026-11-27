'use strict';

/**
 * Adds the lines the owner accepted to a host config's text, and nothing else.
 *
 * Why text and not a rewrite: the config is the host's own file, with its comments, its order
 * and its quoting, and the YAML reader here reads but never writes. So each accepted entry is
 * inserted as one line at the end of the block it belongs to, a block that is missing is
 * appended, and every line the host wrote stays as it was. The result is then parsed and
 * compared with what the additions mean: a text whose meaning differs from the config plus
 * those entries is refused and never written.
 */

const { RunError } = require('./run-error.cjs');
const { parseYaml } = require('./run-yaml.cjs');

const indentOf = (line) => /^ */.exec(line)[0].length;
const isContent = (line) => line.trim() !== '' && !line.trim().startsWith('#');
const header = (key) => new RegExp(`^ *${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(.*)$`);

/** A double-quoted YAML scalar the reader decodes back to `value`. */
const quote = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The value after a key's colon is a comment or nothing, so the block below holds its value. */
function opensBlock(rest) {
  const value = rest.trim();
  return value === '' || value.startsWith('#');
}

function inline(at, file) {
  return new RunError(`${at} in ${file} is written inline: write it as a block, one entry per line, then accept again.`, 'BAD_CONFIG', 2);
}

/** The index after the last content line deeper than `indent`, from `from` on: where a block ends. */
function blockEnd(lines, from, indent) {
  let end = from;
  for (let i = from; i < lines.length; i += 1) {
    if (!isContent(lines[i])) continue;
    if (indentOf(lines[i]) <= indent) break;
    end = i + 1;
  }
  return end;
}

/**
 * Where entries of `section.key` go, creating the headers that are missing. Returns the index to
 * insert at and the indent of an entry; refuses a section or key written inline.
 */
function place(lines, section, key, file) {
  let top = lines.findIndex((line) => indentOf(line) === 0 && isContent(line) && header(section).test(line));
  if (top === -1) {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length > 0) lines.push('');
    lines.push(`${section}:`, `  ${key}:`);
    return { at: lines.length, indent: 4 };
  }
  if (!opensBlock(header(section).exec(lines[top])[1])) throw inline(section, file);
  const sectionEnd = blockEnd(lines, top + 1, 0);
  const first = lines.slice(top + 1, sectionEnd).find(isContent);
  const child = first ? indentOf(first) : 2;
  const own = lines.findIndex((line, i) => i > top && i < sectionEnd && isContent(line) && indentOf(line) === child && header(key).test(line));
  if (own === -1) {
    lines.splice(sectionEnd, 0, `${' '.repeat(child)}${key}:`);
    return { at: sectionEnd + 1, indent: child + 2 };
  }
  if (!opensBlock(header(key).exec(lines[own])[1])) throw inline(`${section}.${key}`, file);
  const end = blockEnd(lines, own + 1, child);
  const entry = lines.slice(own + 1, end).find(isContent);
  return { at: end, indent: entry ? indentOf(entry) : child + 2 };
}

/** The config's value at `section.key`, as `kind` ('list' or 'map'), empty when absent. */
function valueAt(config, section, key, kind) {
  const block = config[section] && typeof config[section] === 'object' ? config[section][key] : undefined;
  if (kind === 'list') return Array.isArray(block) ? [...block] : [];
  return block && typeof block === 'object' && !Array.isArray(block) ? { ...block } : {};
}

/**
 * The config text with `additions` in it: each `{section, key, item}` appends `item` to the list
 * `section.key`, each `{section, key, name, value}` adds `name: value` to the map there. An
 * addition the config already holds is skipped. Returns the new text and the additions made.
 */
function addEntries(text, additions, file) {
  const before = parseYaml(text);
  const expected = JSON.parse(JSON.stringify(before));
  const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');
  const made = [];
  for (const addition of additions) {
    const { section, key } = addition;
    const isList = addition.item !== undefined;
    const current = valueAt(expected, section, key, isList ? 'list' : 'map');
    if (isList ? current.includes(addition.item) : Object.prototype.hasOwnProperty.call(current, addition.name)) continue;
    const { at, indent } = place(lines, section, key, file);
    const pad = ' '.repeat(indent);
    if (isList) {
      lines.splice(at, 0, `${pad}- ${quote(addition.item)}`);
      current.push(addition.item);
    } else {
      const value = Array.isArray(addition.value) ? `[${addition.value.map(quote).join(', ')}]` : quote(addition.value);
      lines.splice(at, 0, `${pad}${/^[\w.-]+$/.test(addition.name) ? addition.name : quote(addition.name)}: ${value}`);
      current[addition.name] = addition.value;
    }
    if (!expected[section] || typeof expected[section] !== 'object') expected[section] = {};
    expected[section][key] = current;
    made.push(addition);
  }
  const out = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  if (JSON.stringify(parseYaml(out)) !== JSON.stringify(expected)) {
    throw new RunError(`the accepted lines would change what ${file} already says, so nothing was written: add them by hand.`, 'BAD_CONFIG', 2);
  }
  return { text: made.length > 0 ? out : text, made };
}

module.exports = { addEntries };
