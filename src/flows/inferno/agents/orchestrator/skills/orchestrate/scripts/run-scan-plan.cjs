'use strict';

/**
 * The plan-time half of `run.cjs scan`: the cross-check of a captured plan, after the plan lint
 * has passed its form. Its model is Turbo's cross-check: one reader, a fixed list of kinds of
 * problem, a budget of tool calls, and an end.
 *
 * The pass sends one cross-checker per cut of the plan (run-scan-slices.cjs), all in one
 * message, each with the brief and its cut to read in one batch. A fix round sends one, with
 * the earlier round's findings and the diff of what the repair changed (run-scan-rounds.cjs).
 * Every finding goes back to the planner through a gaps file, because the printout is capped
 * and the file is not. After the second fix round what is still open goes to the oracle, and
 * no later call dispatches anything.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { standardsFor } = require('./run-standards.cjs');
const { planOracleCall, scanCall } = require('./run-call.cjs');
const { NOT_A_FINDING, PLAN_ID, PLAN_KINDS, numbered } = require('./run-scan-file.cjs');
const { planCuts, planItems } = require('./run-scan-slices.cjs');
const rounds = require('./run-scan-rounds.cjs');

const { RunError } = lib;

/** The tool calls a cross-checker spends on the code: the claims, the reuse check, and a fix round. */
const CALLS = { claims: 12, reuse: 6, fix: 12 };

const RULES = 'grep before you read, line ranges only, never a whole file over 200 lines, no directory walk, ' +
  'never a file read twice. Reading the plan and the rule files above is not counted.';

const SPENT = 'When the budget is spent, stop: write the lines you have proved and leave the rest, ' +
  "which each item's check at its dispatch and its cold review still catch.";

const itemPaths = (items) => items.map((id) => `work-items/${id}.md`).join(', ');
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** One finding as the planner and the next round read it. */
const gapText = (line) => `GAP ${line.id} ${line.kind} ${line.file}:${line.line}: ${line.claim} (proof: ${line.proof})`;

/** Where every GAP line of the last collect is written for the planner. */
const gapsFileOf = (dir) => `${dir}-gaps.txt`;

/** The rule files that apply to the items' `ownership.editable`, for a deviation to name. */
function standardsLine(tree, context, items) {
  const editable = new Set();
  for (const id of items) {
    try {
      const spec = lib.readItemSpec(tree, context.intent, id);
      for (const entry of (spec.manifest && spec.manifest.ownership && spec.manifest.ownership.editable) || []) editable.add(entry);
    } catch (error) {
      // An item whose manifest does not parse is the plan lint's finding, not this check's.
      if (!(error instanceof RunError)) throw error;
    }
  }
  const files = standardsFor(tree, [...editable], { config: context.options.config });
  return `- standards: ${files.length > 0 ? files.join(', ') : 'none listed for these items'}`;
}

/** The question, its five kinds, and what is no finding: the same for every round. */
const kindLines = () => [
  `- question ${PLAN_ID}: report each problem as one line, tagged with its kind:`,
  ...Object.entries(PLAN_KINDS).map(([kind, what]) => `- ${kind}: ${what}`),
  `- not a finding: ${NOT_A_FINDING}`,
];

function passBrief(tree, context, entry, entries) {
  const plan = `${lib.SPECS_DIR}/intents/${context.intent}`;
  const others = entries.filter((other) => other !== entry).flatMap((other) => other.items);
  const of = entries.length > 1 ? `, cut ${entries.indexOf(entry) + 1} of ${entries.length}` : '';
  return [
    `# INFERNO cross-check: the pass${of}`,
    '',
    `Check the plan of intent ${context.intent} against itself and the code, and write only the result file. ` +
      'Read the brief and every work item of your cut in one batch before you judge any part of it. ' +
      'The plan lint has passed its form; you check its meaning.',
    '',
    `- tree ${tree}`,
    `- plan ${plan}: its brief.md and the work items of your cut. Nothing is built yet, so read the plan against the live tree.`,
    `- cut: ${itemPaths(entry.items) || 'none: the plan has no work item yet, so check its brief.md'}`,
    ...(others.length > 0
      ? [`- other cuts, which other cross-checkers read: ${itemPaths(others)}. Open one only to check a producer or consumer your cut relies on.`]
      : []),
    standardsLine(tree, context, entry.items),
    ...kindLines(),
    `- budget: at most ${CALLS.claims} tool calls on the code to check the plan's claims, and ${CALLS.reuse} more for the reuse ` +
      'check: for every command, table, screen, setting or module an item creates, grep for an existing one that fits. ' +
      `${RULES} ${SPENT}`,
    `- result ${entry.result}`,
    '',
  ].join('\n');
}

/** The repair as the fix round reads it: a diff per changed file, the added and dropped items. */
function repairLines(changes, round) {
  const lines = [
    ...changes.changed.map((file) => `- changed ${file.rel}: read only the hunks of diff -u ${file.before} ${file.now}`),
    ...changes.added.map((rel) => `- added ${rel}: read it whole`),
    ...changes.dropped.map((rel) => `- dropped ${rel}`),
  ];
  return lines.length > 0 ? lines : [`- changed: no plan file since ${rounds.roundName(round - 1)} read it`];
}

function fixBrief(tree, context, entry, round, earlier, changes) {
  return [
    `# INFERNO cross-check: ${rounds.roundName(round)}`,
    '',
    `The plan of intent ${context.intent} was repaired after ${rounds.roundName(round - 1)} found the earlier findings below. ` +
      'Check each earlier finding and only the parts the repair changed, and write only the result file. ' +
      'Never read the whole plan again: open another part only to check a producer or consumer a changed hunk relies on. ' +
      'Report an earlier finding the repair did not settle as a line again, and a new finding only inside a changed hunk.',
    '',
    `- tree ${tree}`,
    `- plan ${lib.SPECS_DIR}/intents/${context.intent}`,
    ...earlier.map((line) => `- earlier ${gapText(line).slice('GAP '.length)}`),
    ...repairLines(changes, round),
    standardsLine(tree, context, entry.items),
    ...kindLines(),
    `- budget: at most ${CALLS.fix} tool calls on the code. ${RULES} ${SPENT}`,
    `- result ${entry.result}`,
    '',
  ].join('\n');
}

/** The end of the cross-check: what is still open goes to the oracle, and the plan to build. */
function oracleSteps(tree, context) {
  return [
    `ask the oracle about each GAP line in ${gapsFileOf(context.dir)}, one at a time: ${planOracleCall(tree, context.intent)}, ` +
      'then spawn the agent and model it prints',
    'resume the planner with each decision as written, and the plan goes to build',
  ];
}

/**
 * What the next plan-time dispatch sends, as `{ round, entries }` with each entry's brief text,
 * or `{ spent }` with the steps that remain once the pass and both fix rounds are done.
 */
function planDispatch(tree, context) {
  const { intent, dir } = context;
  const done = rounds.readRounds(dir, intent);
  const round = rounds.nextRound(done);
  if (round === null) {
    return {
      spent: {
        exit: 3,
        payload: { ok: false, intent, owed: 'oracle', gapsFile: gapsFileOf(dir) },
        out: [`the cross-check of ${intent} has had its pass and both fix rounds, so it never checks this plan again`, ...oracleSteps(tree, context)],
      },
    };
  }
  const at = (id) => ({ id, question: PLAN_ID, brief: path.join(dir, `${id}.md`), result: path.join(dir, `${id}.yaml`) });
  let entries;
  if (round === 1) {
    const cuts = planCuts(tree, intent).map((cut) => cut.items);
    const all = cuts.length > 0 ? cuts : [[]];
    entries = all.map((items, index) => ({ ...at(all.length === 1 ? PLAN_ID : `${PLAN_ID}-${index + 1}`), items }));
    for (const entry of entries) entry.text = passBrief(tree, context, entry, entries);
  } else {
    const entry = { ...at(PLAN_ID), items: planItems(tree, intent).map((item) => item.id) };
    entry.text = fixBrief(tree, context, entry, round, done[done.length - 1].findings, rounds.repairChanges(tree, intent, dir, round));
    entries = [entry];
  }
  rounds.snapshot(tree, intent, dir, round);
  const lead = round === 1
    ? `cross-check of ${intent}: the pass over its whole plan, ${plural(entries.length, 'cross-checker')}`
    : `cross-check of ${intent}: ${rounds.roundName(round)}, one cross-checker over the earlier findings and the repair`;
  return { round, entries, lead };
}

/**
 * The collect of a round: a clean one ends the cross-check, a round with findings hands every
 * one to the planner for the next fix round, and the last one to the oracle.
 */
function planCollect(tree, context, sent, results) {
  const { intent, dir } = context;
  const round = Number(sent.round) || 1;
  const gapsFile = gapsFileOf(dir);
  const lines = numbered(results).map((line, index) => ({ ...line, id: `r${round}-${index + 1}` }));
  if (lines.length === 0) {
    fs.rmSync(gapsFile, { force: true });
    rounds.clearRounds(dir);
    return {
      exit: 0,
      payload: { ok: true, intent, gaps: [], round },
      out: [`no finding in the plan of ${intent} after ${rounds.roundName(round)}: it goes to build`],
    };
  }
  const gaps = lines.map(gapText);
  fs.mkdirSync(path.dirname(gapsFile), { recursive: true });
  fs.writeFileSync(gapsFile, `${gaps.join('\n')}\n`);
  rounds.recordRound(dir, intent, round, lines);
  const last = round >= rounds.MAX_ROUNDS;
  const tail = last
    ? [`the cross-check of ${intent} has had its pass and both fix rounds, so the plan is never checked again`, ...oracleSteps(tree, context)]
    : [
      `${rounds.roundName(round)} found ${plural(lines.length, 'finding')}: ${rounds.roundName(round + 1)} checks each of them and only what the repair changes`,
      `resume the planner with every GAP line in ${gapsFile} as one message, then run ${scanCall(tree, context.options.plan)} again`,
    ];
  return {
    exit: 2,
    payload: { ok: false, intent, gaps: lines, gapsFile, round, oracle: last },
    out: [...lib.capLines(gaps, context.maxLines - tail.length), ...tail],
  };
}

module.exports = { CALLS, planCollect, planDispatch };
