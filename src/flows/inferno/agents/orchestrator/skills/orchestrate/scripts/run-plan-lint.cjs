'use strict';

/**
 * The plan lint: the form of one intent's brief and open work items, checked by script before
 * any builder reads them. `run.cjs plan-lint <intent>` prints one finding per line and exits 2
 * on any; `run.cjs frontier` runs the same check and stops on a finding before it prints a
 * ready set. Modelled on the Turbo spec lint, the hard gate before that flow's approval: a
 * scanner that finds a missing section by reading costs a round, a script costs nothing.
 *
 * What it holds, against templates/work-item.md.hbs and templates/brief.md.hbs of the planner:
 *   - every `SC-<n>` of the brief is delivered by an item, every open item names one in
 *     `delivers:`, and the brief's Item Map is the inverse of those lists;
 *   - every acceptance criterion carries a code span. The planner text says a criterion names
 *     its test file, case id or command and the value it must show. A code span is what a
 *     script can tell apart: whether it names a path, a case id or a command, and whether the
 *     prose around it states a value, only a reader can judge, so the lint holds it to no more;
 *   - every open item has the nine sections in order, Edge Cases, Out of Scope and Reuse hold
 *     their content or exactly `None.`, every fixed line holds its form, and no line holds a
 *     TBD or a TODO;
 *   - every breaking test of the Test Plan is in the item's `ownership.editable`.
 * Two open items with no `depends_on` path between them that share an editable file are
 * printed as `overlap` lines, never as findings: the overlap is legal, the orchestrator
 * serializes it, and the line is there so the planner orders them on purpose.
 *
 * The sign of the new form is a numbered success criterion (`- SC-<n>: `) in the brief. A plan
 * written before this lint has none and builds from its old items (plan section 7, "Rollout
 * to a host"), so it is never refused. A brief that carries the sign makes the whole plan new:
 * an item that leaves its sections out is a finding, never an old item.
 *
 * A completed item is never linted, as the frontier never re-validates one: its spec is the
 * tree of the day it landed. Only what it delivers is read, so its criteria stay delivered. A
 * deferred item is read the same way: it is out of this intent and a later plan rewrites it.
 *
 * Every finding prints ids and paths from the plan only, never its prose.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { isComplete, isDeferred } = require('./state-transition.cjs');
const { acceptanceCriteria } = require('./run-mutant-coverage.cjs');

const ITEM_SECTIONS = [
  'Description', 'Acceptance Criteria', 'Edge Cases', 'Out of Scope', 'Test Plan', 'Reuse',
  'Execution Manifest', 'Technical Notes', 'Dependencies',
];
/** The sections that hold their content or exactly the line `None.` */
const NONE_SECTIONS = ['Edge Cases', 'Out of Scope', 'Reuse'];
const EDGE_HEADER = ['Case', 'Expected behaviour', 'Test'];
const REUSE_HEADER = ['Structure', 'Decision', 'Evidence'];
const MAP_HEADER = ['Criterion', 'Items'];
const CRITERION = /^- (SC-[1-9]\d*): \S/;
const PLACEHOLDER = /\bTBD\b|\bTODO\b/;
const NO_TESTS = new Set(['docs-only', 'config-only']);

/** The `## ` sections of a markdown file, in order, outside code fences. */
function sections(content) {
  const out = [];
  let current = null;
  let fenced = false;
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = !fenced && /^## (.+?)\s*$/.exec(line);
    if (heading) {
      current = { heading: heading[1], lines: [] };
      out.push(current);
    } else if (current) current.lines.push(line);
  }
  return out;
}

const filled = (lines) => lines.map((line) => line.trim()).filter(Boolean);
const section = (parsed, heading) => parsed.find((entry) => entry.heading === heading);

/** The contents of every code span on a line, single or double backticks. */
const codeSpans = (line) => [...line.matchAll(/(`+)(.+?)\1/g)].map((match) => match[2].trim());
/** A test reference reads `` `<path>` :: <case> ``: the path is the line's first code span. */
const testPath = (text) => codeSpans(text)[0] || null;

const cells = (line) => line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());
const isSeparator = (line) => /^\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line);

/** A table: its header cells and its rows, or null when the first line is no table row. */
function table(lines) {
  if (lines.length === 0 || !lines[0].startsWith('|')) return null;
  const body = lines.slice(1);
  if (body[0] && isSeparator(body[0])) body.shift();
  return { header: cells(lines[0]), rows: body.map((line) => (line.startsWith('|') ? cells(line) : null)) };
}

function briefFile(tree, intentId) {
  return [
    path.join(tree, lib.SPECS_DIR, 'intents', intentId, 'brief.md'),
    path.join(tree, lib.SPECS_DIR, 'archive', 'intents', intentId, 'brief.md'),
  ].find((file) => fs.existsSync(file)) || null;
}

/** The brief's numbered criteria and its Item Map, or null when the brief carries no sign of the new form. */
function readBrief(tree, intentId, findings) {
  const file = briefFile(tree, intentId);
  if (!file) return null;
  const parsed = sections(fs.readFileSync(file, 'utf8'));
  const criteriaSection = section(parsed, 'Success Criteria');
  const lines = criteriaSection ? filled(criteriaSection.lines) : [];
  if (!lines.some((line) => CRITERION.test(line))) return null;

  const criteria = [];
  lines.forEach((line, index) => {
    const match = CRITERION.exec(line);
    if (!match) findings.push(`brief: success criterion line ${index + 1} carries no SC-<n> id`);
    else if (criteria.includes(match[1])) findings.push(`brief: ${match[1]} is numbered twice`);
    else criteria.push(match[1]);
  });

  const map = new Map();
  const mapSection = section(parsed, 'Item Map');
  const mapTable = mapSection && table(filled(mapSection.lines));
  if (!mapSection) findings.push('brief: no ## Item Map section');
  else if (!mapTable || mapTable.header.join('|') !== MAP_HEADER.join('|')) {
    findings.push(`brief: ## Item Map table header is not | ${MAP_HEADER.join(' | ')} |`);
  } else {
    mapTable.rows.forEach((row, index) => {
      if (!row || row.length !== 2) {
        findings.push(`brief: Item Map row ${index + 1} is not | <criterion> | <items> |`);
        return;
      }
      const [criterion, items] = row;
      if (map.has(criterion)) findings.push(`brief: the Item Map has two rows for ${criterion}`);
      else if (!criteria.includes(criterion)) findings.push(`brief: the Item Map names ${criterion}, which Success Criteria does not number`);
      map.set(criterion, items.split(',').map((entry) => entry.trim()).filter(Boolean));
    });
    for (const criterion of criteria) {
      if (!map.has(criterion)) findings.push(`brief: ${criterion} has no row in the Item Map`);
    }
  }
  return { criteria, map: mapTable ? map : null };
}

/** The item's open spec, or a finding when the ledger names an item with no spec on disk. */
function readSpec(tree, intentId, itemId) {
  try {
    const spec = lib.readItemSpec(tree, intentId, itemId);
    return { ...spec, content: fs.readFileSync(spec.file, 'utf8') };
  } catch (error) {
    if (error.code === 'SPEC_MISSING') return null;
    throw error;
  }
}

const list = (value) => (Array.isArray(value) ? value.map(String) : []);

function sectionFindings(parsed, add) {
  const present = parsed.map((entry) => entry.heading);
  const missing = ITEM_SECTIONS.filter((heading) => !present.includes(heading));
  for (const heading of missing) add(`no ## ${heading} section`);
  const order = present.filter((heading) => ITEM_SECTIONS.includes(heading));
  if (missing.length === 0 && order.join('|') !== ITEM_SECTIONS.join('|')) {
    add(`the sections run out of order, the template's order is ${ITEM_SECTIONS.join(', ')}`);
  }
  for (const heading of NONE_SECTIONS) {
    const entry = section(parsed, heading);
    if (entry && filled(entry.lines).length === 0) add(`## ${heading} is empty, give its lines or the line None.`);
  }
}

/** The body of a None-section, or null when it is exactly `None.` or absent. */
function noneBody(parsed, heading, add) {
  const entry = section(parsed, heading);
  if (!entry) return null;
  const lines = filled(entry.lines);
  if (lines.length === 0 || (lines.length === 1 && lines[0] === 'None.')) return null;
  if (lines.includes('None.')) add(`## ${heading} holds None. beside other lines`);
  return lines.filter((line) => line !== 'None.');
}

/** A table section: the header and three filled cells per row, then `check` on each row. */
function tableFindings(parsed, heading, header, add, check) {
  const lines = noneBody(parsed, heading, add);
  if (!lines) return;
  const parsedTable = table(lines);
  if (!parsedTable || parsedTable.header.join('|') !== header.join('|')) {
    add(`## ${heading} table header is not | ${header.join(' | ')} |`);
    return;
  }
  parsedTable.rows.forEach((row, index) => {
    const label = `${heading} row ${index + 1}`;
    if (!row || row.length !== header.length || row.some((cell) => !cell)) {
      add(`${label} is not a row of ${header.length} filled cells`);
      return;
    }
    check(row, label);
  });
}

function testPlanFindings(id, item, editable, parsed, tree, add) {
  const entry = section(parsed, 'Test Plan');
  if (!entry) return;
  const lines = filled(entry.lines);
  if (lines.length === 0) {
    add('## Test Plan is empty');
    return;
  }
  let adds = 0;
  const integration = { none: false, with: [] };
  const breaks = { none: false, named: false };
  lines.forEach((line, index) => {
    const at = `Test Plan line ${index + 1}`;
    const integrated = /^- Integration with ([^\s:]+): (.+)$/.exec(line);
    const named = /^- (Adds|Breaks): (.+)$/.exec(line);
    if (line === '- Integration: none') {
      integration.none = true;
      return;
    }
    if (line === '- Breaks: none') {
      breaks.none = true;
      return;
    }
    if (!integrated && !named) {
      add(`${at} has none of the prefixes Adds:, Integration with <item-id>:, Integration: none, Breaks:`);
      return;
    }
    const test = testPath(integrated ? integrated[2] : named[2]);
    if (!test) add(`${at} names no test as \`<path>\` :: <case>`);
    if (integrated) {
      integration.with.push(integrated[1]);
      if (!item.depends_on.includes(integrated[1])) add(`Test Plan integrates with ${integrated[1]}, which ${id} does not depend on`);
    } else if (named[1] === 'Adds') adds += 1;
    else {
      breaks.named = true;
      if (test && !lib.ownedBy(test, editable, tree)) add(`breaking test ${test} is outside its ownership.editable`);
    }
  });
  if (adds === 0 && !NO_TESTS.has(item.kind)) add('Test Plan adds no test');
  if (integration.none && integration.with.length > 0) add('Test Plan says Integration: none beside an Integration with line');
  if (!integration.none && integration.with.length === 0 && item.depends_on.length === 0) add('Test Plan has no Integration line');
  for (const dependency of item.depends_on) {
    if (!integration.with.includes(dependency)) add(`Test Plan has no Integration with ${dependency} line for its dependency ${dependency}`);
  }
  if (breaks.none && breaks.named) add('Test Plan says Breaks: none beside a Breaks line');
  if (!breaks.none && !breaks.named) add('Test Plan has no Breaks line');
}

/** Every finding on one open item's own text. */
function itemFindings(tree, item, spec, criteria, findings) {
  const add = (message) => findings.push(`${item.id}: ${message}`);
  const parsed = sections(spec.content);
  const delivers = list(spec.frontmatter.delivers);
  if (delivers.length === 0) add('delivers: names no success criterion');
  for (const criterion of delivers) {
    if (!criteria.includes(criterion)) add(`delivers ${criterion}, which the brief does not number`);
  }
  sectionFindings(parsed, add);

  const acceptance = acceptanceCriteria(spec.content);
  if (section(parsed, 'Acceptance Criteria') && acceptance.length === 0) add('## Acceptance Criteria lists no criterion');
  acceptance.forEach((criterion, index) => {
    if (codeSpans(criterion).length === 0) add(`acceptance criterion ${index + 1} names no test file, case id or command in a code span`);
  });

  tableFindings(parsed, 'Edge Cases', EDGE_HEADER, add, (row, label) => {
    if (!testPath(row[2])) add(`${label} names no test as \`<path>\` :: <case>`);
  });
  const scope = noneBody(parsed, 'Out of Scope', add) || [];
  scope.forEach((line, index) => {
    if (!/^- \S/.test(line)) add(`Out of Scope line ${index + 1} is not a - <line> bullet`);
  });
  const manifest = spec.manifest || {};
  const editable = list(manifest.ownership && manifest.ownership.editable);
  testPlanFindings(item.id, { ...item, kind: item.kind || String(spec.frontmatter.kind || '') }, editable, parsed, tree, add);
  tableFindings(parsed, 'Reuse', REUSE_HEADER, add, (row, label) => {
    if (!['reuse', 'create'].includes(row[1])) add(`${label} decides ${row[1]}, a decision is reuse or create`);
    if (!codeSpans(row[2]).some((span) => /\S:\d+(?:-\d+)?$/.test(span))) add(`${label} carries no \`file:line\` evidence`);
  });

  spec.content.split('\n').forEach((line, index) => {
    if (PLACEHOLDER.test(line)) add(`line ${index + 1} holds TBD or TODO`);
  });
  return delivers;
}

/** The brief's criteria against what the items deliver, both ways. */
function coverageFindings(brief, delivered, open, findings) {
  for (const criterion of brief.criteria) {
    if (![...delivered.values()].some((ids) => ids.includes(criterion))) findings.push(`brief: ${criterion} is delivered by no item`);
  }
  if (!brief.map) return;
  for (const [criterion, ids] of brief.map) {
    for (const id of ids) {
      if (!delivered.has(id)) findings.push(`brief: the Item Map names ${id} for ${criterion}, which is no item of this intent`);
      else if (open.has(id) && !delivered.get(id).includes(criterion)) {
        findings.push(`brief: the Item Map names ${id} for ${criterion}, but its delivers: does not`);
      }
    }
  }
  for (const id of open) {
    for (const criterion of delivered.get(id)) {
      const row = brief.map.get(criterion);
      if (row && !row.includes(id)) findings.push(`brief: ${id} delivers ${criterion}, but the Item Map row of ${criterion} does not name it`);
    }
  }
}

/** Every item reachable from `id` through depends_on. */
function reach(id, items, seen = new Set()) {
  const item = items.find((entry) => entry.id === id);
  for (const dependency of (item && item.depends_on) || []) {
    if (!seen.has(dependency)) {
      seen.add(dependency);
      reach(dependency, items, seen);
    }
  }
  return seen;
}

function overlaps(tree, intent, editable) {
  const open = intent.items.filter((item) => editable.has(item.id));
  const out = [];
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      const [a, b] = [open[i], open[j]];
      if (reach(a.id, intent.items).has(b.id) || reach(b.id, intent.items).has(a.id)) continue;
      const shared = editable.get(a.id).filter((entry) => editable.get(b.id).some((other) => lib.overlaps(entry, other, tree)));
      if (shared.length > 0) out.push({ items: [a.id, b.id], shared });
    }
  }
  return out;
}

/**
 * The lint of one intent from the ledger. `form` is `old` for a plan written before the lint,
 * which then carries no finding.
 */
function lintPlan(tree, intent) {
  const findings = [];
  const brief = readBrief(tree, intent.id, findings);
  if (!brief) return { form: 'old', findings: [], overlaps: [], open: 0, criteria: 0 };

  const delivered = new Map();
  const editable = new Map();
  const open = new Set();
  for (const item of intent.items) {
    const spec = readSpec(tree, intent.id, item.id);
    if (isComplete(item.status) || isDeferred(item.status)) {
      // Read for what it delivers, never linted.
      delivered.set(item.id, spec ? list(spec.frontmatter.delivers) : undefined);
      continue;
    }
    open.add(item.id);
    if (!spec) {
      findings.push(`${item.id}: no work-item spec on disk for this ledger item`);
      delivered.set(item.id, []);
      continue;
    }
    delivered.set(item.id, itemFindings(tree, item, spec, brief.criteria, findings));
    const manifest = spec.manifest || {};
    editable.set(item.id, list(manifest.ownership && manifest.ownership.editable));
  }
  // A completed item whose spec is gone delivers what the Item Map says it does.
  for (const [id, ids] of delivered) {
    if (ids === undefined) {
      delivered.set(id, brief.map ? [...brief.map].filter(([, ids]) => ids.includes(id)).map(([criterion]) => criterion) : []);
    }
  }
  coverageFindings(brief, delivered, open, findings);
  return { form: 'new', findings, overlaps: overlaps(tree, intent, editable), open: open.size, criteria: brief.criteria.length };
}

const findingLine = (finding) => `FINDING ${finding}`;
const overlapLine = (pair) =>
  `overlap ${pair.items.join(' + ')} (shares ${pair.shared.join(', ')}): no depends_on path between them, ` +
  'not a finding: order them on purpose or leave them to be serialized';

/** The finding lines `run.cjs frontier` stops on; none for a plan written before the lint. */
function frontierFindings(tree, intent) {
  return lintPlan(tree, intent).findings.map(findingLine);
}

function planLint(intentId, options) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const intent = lib.findIntent(lib.readLedger(tree), intentId);
  const result = lintPlan(tree, intent);
  const payload = { ok: result.findings.length === 0, form: result.form, findings: result.findings, overlaps: result.overlaps };
  if (result.form === 'old') {
    return { exit: 0, payload, out: [`plan of ${intent.id} was written before the plan lint, so it is not linted`] };
  }
  const out = [...result.findings.map(findingLine), ...result.overlaps.map(overlapLine)];
  if (result.findings.length === 0) out.push(`clean ${intent.id}: ${result.open} open items, ${result.criteria} criteria`);
  return { exit: result.findings.length > 0 ? 2 : 0, payload, out };
}

module.exports = { frontierFindings, lintPlan, planLint };
