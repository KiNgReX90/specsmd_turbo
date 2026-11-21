'use strict';

/**
 * A work item's spec: the frontmatter, what the item says it is for, and the execution manifest.
 * run-lib.cjs re-exports `readItemSpec` as its own, so every step reads a spec through one door.
 *
 * Every `ownership.editable` entry must be a path or a glob. One that is not (a map the reader made
 * of `- key: value`, an empty string) is refused here, where the item, the spec and the line are
 * known, instead of deep inside an ownership check that knows none of them. frontier, verify-item
 * and integrate all read the spec first, so each refuses it naming the line to fix.
 */

const fs = require('fs');
const path = require('path');

const { RunError } = require('./run-error.cjs');
const { parseYaml } = require('./run-yaml.cjs');

const SPECS_DIR = '.specs-inferno';
const indentOf = (line) => /^ */.exec(line)[0].length;

/**
 * The `index`th dash under the manifest's `editable:` key as the spec writes it, with its 1-based
 * line, or null when the spec does not write the list as dashes under a plain `editable:` key.
 */
function rawEntry(content, index) {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => /^## Execution Manifest\s*$/.test(line));
  const key = lines.findIndex((line, i) => i > start && /^\s*editable:\s*(#.*)?$/.test(line));
  if (start === -1 || key === -1) return null;
  const dashes = [];
  for (let i = key + 1; i < lines.length; i += 1) {
    const text = lines[i].trim();
    if (text === '' || text.startsWith('#')) continue;
    if (indentOf(lines[i]) <= indentOf(lines[key])) break;
    if (text.startsWith('-')) dashes.push({ text, line: i + 1 });
  }
  return dashes[index] || null;
}

function checkOwnership(itemId, file, content, manifest) {
  const editable = manifest.ownership && manifest.ownership.editable;
  if (!Array.isArray(editable)) return;
  const index = editable.findIndex((entry) => typeof entry !== 'string' || entry.trim() === '');
  if (index === -1) return;
  const raw = rawEntry(content, index);
  const where = raw ? `\`${raw.text}\` under ownership.editable at ${file}:${raw.line}` : `${JSON.stringify(editable[index])} under ownership.editable in ${file}`;
  throw new RunError(
    `Ownership requires a path: item ${itemId} lists ${where}. Write each entry as a path or a glob; ` +
      'a comment goes after it behind a space and #.',
    'OWNERSHIP'
  );
}

/**
 * The spec of `itemId` in `intentId`, live or archived. The manifest is plain YAML under the
 * `## Execution Manifest` heading, fenced or not, which is how the planner's template renders it.
 */
function readItemSpec(root, intentId, itemId) {
  const candidates = [
    path.join(root, SPECS_DIR, 'intents', intentId, 'work-items', `${itemId}.md`),
    path.join(root, SPECS_DIR, 'archive', 'intents', intentId, 'work-items', `${itemId}.md`),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) {
    throw new RunError(`work-item spec not found: ${candidates[0]}`, 'SPEC_MISSING');
  }
  const content = fs.readFileSync(file, 'utf8');
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content);
  const section = /\n## Execution Manifest\s*\n([\s\S]*?)(?=\n## |\n?$)/.exec(content);
  const body = section ? section[1].replace(/^\s*```(?:yaml)?\s*$/gm, '') : '';
  // What the item says it is for, which is where a corrective item announces itself.
  const described = /\n## Description\s*\n([\s\S]*?)(?=\n## |\n?$)/.exec(content);
  const opening = /^# Work Item:[^\n]*\n([\s\S]*?)(?=\n## |\n?$)/m.exec(content);
  const manifest = parseYaml(body);
  checkOwnership(itemId, file, content, manifest);
  return {
    file,
    frontmatter: frontmatter ? parseYaml(frontmatter[1]) : {},
    description: ((described && described[1]) || (opening && opening[1]) || '').trim(),
    manifest,
  };
}

module.exports = { rawEntry, readItemSpec };
