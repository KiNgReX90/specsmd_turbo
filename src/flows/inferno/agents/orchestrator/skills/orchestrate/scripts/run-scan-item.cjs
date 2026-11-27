'use strict';

/**
 * The slice check, `run.cjs scan --item <id>`: one cross-checker over one work item, just
 * before its dispatch, against the tree its predecessors left. The plan's cross-check read the
 * item before any predecessor landed, so it could not check a claim about code a predecessor
 * had yet to build. `probes` reruns the measurements the planner wrote down; this reads the
 * claims nobody measured.
 *
 * Only an item with a `depends_on` predecessor gets one: for the others the plan's cross-check
 * read the tree they build on, and the plan lint keeps a sibling with no path between them off
 * their files. It runs once, with no rounds. A wrong assumption or a rebuilt part goes into the
 * dispatch as the measured fact, the way a `drift` line does, and nothing waits on it. A
 * conflict means the spec has to change first, so it goes to the planner, once: the next call
 * for that item dispatches nothing, and the item is built on its repaired spec.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const gate = require('./run-gate.cjs');
const { resolveBase } = require('./run-intents.cjs');
const { NOT_A_FINDING, SLICE_ID, SLICE_KINDS } = require('./run-scan-file.cjs');

const { RunError } = lib;

/** The tool calls the slice check spends on the code: one item's claims, so fewer than a cut's. */
const CALLS = 8;

/** Where a collected slice check is kept, so the item gets it once. */
const doneFile = (dir) => `${dir}-done.txt`;

const sliceText = (line) => `SLICE ${line.id} ${line.kind} ${line.file}:${line.line}: ${line.claim} (proof: ${line.proof})`;

/** The item's predecessors inside its intent, from its spec's `depends_on`. */
function predecessors(tree, intent, id) {
  const spec = lib.readItemSpec(tree, intent, id);
  const depends = spec.frontmatter && Array.isArray(spec.frontmatter.depends_on) ? spec.frontmatter.depends_on.map(String) : [];
  return depends.filter((other) => {
    try {
      lib.readItemSpec(tree, intent, other);
      return true;
    } catch (error) {
      if (error instanceof RunError) return false;
      throw error;
    }
  });
}

function briefText(tree, context, entry, before, base) {
  const { intent, options } = context;
  return [
    `# INFERNO slice check: ${options.item}`,
    '',
    `Check one work item of intent ${intent} against the tree its predecessors left, just before its build, and write only the ` +
      "result file. The plan's cross-check read this item before any of them landed: look only for what shows now.",
    '',
    `- tree ${tree}`,
    `- item ${lib.SPECS_DIR}/intents/${intent}/work-items/${options.item}.md: read it whole`,
    `- predecessors: ${before.map((id) => `work-items/${id}.md`).join(', ')}, landed in git diff ${base}..HEAD: ` +
      "read only the hunks the item's claims touch",
    `- question ${SLICE_ID}: report each problem as one line, tagged with its kind:`,
    ...Object.entries(SLICE_KINDS).map(([kind, what]) => `- ${kind}: ${what}`),
    `- not a finding: ${NOT_A_FINDING} Nor is anything the plan's cross-check could already see.`,
    `- budget: at most ${CALLS} tool calls on the code: grep before you read, line ranges only, never a whole file over 200 lines, ` +
      'no directory walk, never a file read twice. Reading the item is not counted. When the budget is spent, stop: write the ' +
      "lines you have proved and leave the rest to the item's cold review.",
    `- result ${entry.result}`,
    '',
  ].join('\n');
}

/**
 * What the slice check sends, `{ entries, lead }`, or `{ done }` when the item gets none: no
 * predecessor, or a check already collected.
 */
function itemDispatch(tree, context) {
  const { intent, options, dir } = context;
  const id = options.item;
  const done = (out) => ({ done: { exit: 0, payload: { ok: true, intent, item: id, owed: null }, out } });
  if (fs.existsSync(doneFile(dir))) {
    return done([`the slice check of ${id} ran once, and its lines are in ${doneFile(dir)}: it never runs again, so dispatch ${id}`]);
  }
  const before = predecessors(tree, intent, id);
  if (before.length === 0) {
    return done([`${id} has no predecessor in ${intent}: the plan's cross-check read the tree it builds on, so dispatch it`]);
  }
  const base = lib.git(tree, ['rev-parse', '--short', gate.mergeBase(tree, resolveBase(context.config, null, tree))]);
  const entry = { id: SLICE_ID, question: SLICE_ID, items: [id], brief: path.join(dir, `${SLICE_ID}.md`), result: path.join(dir, `${SLICE_ID}.yaml`) };
  entry.text = briefText(tree, context, entry, before, base);
  return { entries: [entry], lead: `slice check of ${id} against the tree ${before.join(', ')} left` };
}

/** The collect: every line for the dispatch, a conflict for the planner once, and the check kept as run. */
function itemCollect(tree, context, results) {
  const { intent, options, dir } = context;
  const id = options.item;
  const lines = results.flatMap((result) => result.lines).map((line, index) => ({ ...line, id: `s-${index + 1}` }));
  const slices = lines.map(sliceText);
  fs.mkdirSync(path.dirname(doneFile(dir)), { recursive: true });
  fs.writeFileSync(doneFile(dir), slices.length > 0 ? `${slices.join('\n')}\n` : 'no finding\n');
  if (lines.length === 0) {
    return { exit: 0, payload: { ok: true, intent, item: id, lines: [] }, out: [`no finding in the slice check of ${id}: dispatch it`] };
  }
  const conflicts = lines.filter((line) => line.kind === 'conflict');
  const tail = [
    `paste each SLICE line into the dispatch of ${id} as the measured fact that replaced the plan's assumption`,
    ...(conflicts.length > 0
      ? [`send every conflict SLICE line to the planner once, as one message, and dispatch ${id} on its repaired spec with no second slice check`]
      : []),
  ];
  return {
    exit: conflicts.length > 0 ? 2 : 0,
    payload: { ok: conflicts.length === 0, intent, item: id, lines, conflicts: conflicts.length, file: doneFile(dir) },
    out: [...lib.capLines(slices, context.maxLines - tail.length), ...tail],
  };
}

module.exports = { CALLS, itemCollect, itemDispatch };
