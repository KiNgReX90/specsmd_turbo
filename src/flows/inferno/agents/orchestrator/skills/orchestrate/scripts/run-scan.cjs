'use strict';

/**
 * `run.cjs scan`: four cold scanners each ask one question of the intent's whole diff before
 * the intent review, because some leaks live between items and pass every item review.
 *
 * The call writes one brief per question under the run's cache dir and prints the dispatch
 * lines, grouped by what the host spawns in one message. `--collect` reads the four result
 * files, refuses a line without the command that proves it, and records and commits
 * scan.yaml, bound to the tree the scanners were sent. The intent review answers every line.
 *
 * At plan time, `--plan <intent>` is the cross-check of the captured plan before anything is
 * built (run-scan-plan.cjs): a pass over the whole plan, then at most two fix rounds, and its
 * collect hands every finding back to the planner instead of recording. A plan that builds on
 * an unmerged intent waits for that merge, so it is checked against the real tree.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const gate = require('./run-gate.cjs');
const { resolveBase, unmetPrerequisites } = require('./run-intents.cjs');
const { hostActor } = require('./run-review.cjs');
const owed = require('./run-intent-owed.cjs');
const { intentReviewCall, scanCall } = require('./run-call.cjs');
const { IDS, PLAN_ID, QUESTIONS, readResult, renderScan } = require('./run-scan-file.cjs');
const { planItems } = require('./run-scan-slices.cjs');
const { planCollect, planDispatch } = require('./run-scan-plan.cjs');

const { RunError } = lib;

/** The lines run.cjs prints of an answer (lib.capLines); the plan collect fits its step inside them. */
const MAX_LINES = 30;

/** How many scanners a host spawns in one message: every one on Claude, three on Codex. */
const GROUP = { claude: Infinity, codex: 3 };

const short = (tree, ref) => lib.git(tree, ['rev-parse', '--short', ref]);

/**
 * The questions this call asks, and so the ones its collect reads: all four before the
 * review, the cross-check at plan time. The dispatch records them and the collect reads exactly
 * those. `--only` named the plan-time question once; a call that still names it is refused
 * with the call that works.
 */
function questions(tree, options) {
  if (options.only) {
    const call = options.plan ? scanCall(tree, options.plan, Boolean(options.collect)) : scanCall(tree, null, Boolean(options.collect));
    throw new RunError(`usage: the scan takes no --only: the scan before the review asks all four questions, and the plan-time cross-check is one call: run ${call}`, 'BAD_ARGS', 1);
  }
  return options.plan ? [PLAN_ID] : IDS;
}

/** The agent file the host dispatches the scanner from, relative to the project root. */
function roleFile(config, agent) {
  return config.host === 'codex' ? path.join('.codex', 'agents', `${agent}.toml`) : path.join('.claude', 'agents', `${agent}.md`);
}

/** A host without the scanner role is refused with the fix, never skipped. */
function refuseUninstalled(tree, context) {
  const rel = roleFile(context.config, context.agent);
  if ([tree, lib.primaryRoot(tree)].some((root) => fs.existsSync(path.join(root, rel)))) return;
  throw new RunError(
    `the scanner role is not installed on this host: ${rel} is missing. reinstall the flow on this host so the role lands, ` +
      `then run ${scanCall(tree, context.options.plan)} again.`,
    'NO_SCANNER'
  );
}

function briefText(tree, context, entry, range) {
  const { question } = entry;
  return [
    `# INFERNO scan: ${question}`,
    '',
    `Answer this one question about intent ${context.intent} and write only the result file. ` +
      'Be exhaustive within the range: ask the question of every identifier, op, field, question id, file contract and ' +
      'behaviour it adds, changes or removes, across the whole tree, and report every gap you find, however many, never a sample. ' +
      'Every line carries the command that proves it.',
    '',
    `- tree ${tree}`,
    `- range ${range}`,
    `- question ${question}: ${QUESTIONS[question]}`,
    `- result ${entry.result}`,
    '',
  ].join('\n');
}

function groupLine(index, size) {
  const what = size === 1 ? 'this one' : `these ${size}`;
  return index === 0 ? `spawn ${what} in one message` : `once they return, spawn ${what} in one message`;
}

function dispatch(tree, context) {
  const { intent, config, options, ids, dir, agent, model } = context;
  refuseUninstalled(tree, context);
  let range = null;
  let entries;
  let lead;
  let round = null;
  if (options.plan) {
    const planned = planDispatch(tree, context);
    if (planned.spent) return planned.spent;
    ({ entries, lead, round } = planned);
    // A fresh plan-time dispatch drops the last one's briefs and results, whatever its cuts were.
    fs.rmSync(dir, { recursive: true, force: true });
  } else {
    const base = options.base || resolveBase(config, null, tree);
    range = `${short(tree, gate.mergeBase(tree, base))}..${short(tree, 'HEAD')}`;
    lead = `scan of ${intent} over ${range}`;
    entries = ids.map((id) => ({ id, question: id, items: null, brief: path.join(dir, `${id}.md`), result: path.join(dir, `${id}.yaml`) }));
    for (const entry of entries) entry.text = briefText(tree, context, entry, range);
  }
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of entries) {
    fs.rmSync(entry.result, { force: true });
    fs.writeFileSync(entry.brief, entry.text);
  }
  const at = {
    intent, plan: Boolean(options.plan), ids, range, round, head: lib.git(tree, ['rev-parse', 'HEAD']), hash: proofs.scopeHash(tree),
    slices: entries.map(({ id, question, items }) => ({ id, question, items })),
  };
  fs.writeFileSync(path.join(dir, 'dispatch.json'), `${JSON.stringify(at)}\n`);
  const size = GROUP[config.host === 'codex' ? 'codex' : 'claude'];
  const groups = [];
  for (let i = 0; i < entries.length; i += size) groups.push(entries.slice(i, i + size).map(({ text, ...entry }) => entry));
  const out = [lead];
  groups.forEach((group, index) => {
    out.push(groupLine(index, group.length));
    for (const entry of group) out.push(`dispatch ${agent}${model ? ` model ${model}` : ''} scan ${entry.question} brief ${entry.brief}`);
  });
  out.push(`then ${scanCall(tree, options.plan, true)} collects them`);
  return { exit: 3, payload: { ok: false, intent, owed: 'scan', agent, model, range, round, groups }, out };
}

/** The work items added to or dropped from the plan since its cross-check was dispatched, or null. */
function planChange(tree, intent, entries) {
  const sent = new Set(entries.flatMap((entry) => entry.items || []));
  const now = new Set(planItems(tree, intent).map((item) => item.id));
  const added = [...now].filter((id) => !sent.has(id));
  const dropped = [...sent].filter((id) => !now.has(id));
  if (added.length === 0 && dropped.length === 0) return null;
  return [added.length > 0 ? `added ${added.join(', ')}` : '', dropped.length > 0 ? `dropped ${dropped.join(', ')}` : '']
    .filter(Boolean).join('; ');
}

function readDispatch(dir, intent, plan) {
  try {
    const entry = JSON.parse(fs.readFileSync(path.join(dir, 'dispatch.json'), 'utf8'));
    return entry && entry.intent === intent && entry.plan === plan ? entry : null;
  } catch (error) {
    return null;
  }
}

function record(tree, context, sent, results) {
  const { intent } = context;
  const rel = owed.scanPath(tree, intent);
  const { text, lines } = renderScan({ intent, range: sent.range, results, tree: sent.hash, commit: sent.head });
  fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
  fs.writeFileSync(path.join(tree, rel), text);
  lib.git(tree, ['add', '--', rel]);
  lib.git(tree, ['commit', '-q', '-m', `specsmd(${intent}): scan, ${lines.length} lines`, '--', rel]);
  return {
    exit: 0,
    payload: { ok: true, intent, scan: rel, lines },
    out: [
      `scan of ${intent} collected: ${lines.length} line${lines.length === 1 ? '' : 's'}, recorded in ${rel} at ${short(tree, 'HEAD')}`,
      ...lines.map((line) => `SCAN ${line.id} ${line.file}:${line.line}: ${line.claim}`),
      `then ${intentReviewCall(tree)}`,
    ],
  };
}

function collect(tree, context) {
  const { intent, options, ids, dir } = context;
  const again = scanCall(tree, options.plan);
  const fix = scanCall(tree, options.plan, true);
  const sent = readDispatch(dir, intent, Boolean(options.plan));
  const owing = (out) => ({ exit: 3, payload: { ok: false, intent, owed: 'scan' }, out });
  if (!sent) return owing([`no scan of ${intent} is on record: run ${again}, spawn the dispatch lines it prints, then collect`]);
  if (!options.plan && sent.hash !== proofs.scopeHash(tree)) {
    return owing([
      `the code moved since the scan dispatch at ${sent.head.slice(0, 7)}, so the results read another tree; nothing recorded`,
      `run ${again} for a fresh dispatch, spawn the lines it prints, then collect`,
    ]);
  }
  if (!Array.isArray(sent.ids) || sent.ids.join(',') !== ids.join(',')) {
    return owing([
      `the scan on record asked ${(Array.isArray(sent.ids) && sent.ids.join(', ')) || 'no question'}, and this collect reads ` +
        `${ids.join(', ')}; nothing recorded`,
      `run ${again} for a fresh dispatch, spawn the lines it prints, then collect`,
    ]);
  }
  const entries = Array.isArray(sent.slices) ? sent.slices : ids.map((id) => ({ id, question: id, items: null }));
  const changed = options.plan ? planChange(tree, intent, entries) : null;
  if (changed) {
    return owing([
      `the plan of ${intent} changed since the scan dispatch (${changed}), so an item went unchecked; nothing collected`,
      `run ${again} for a fresh dispatch, spawn the lines it prints, then collect`,
    ]);
  }
  const resultOf = (entry) => path.join(dir, `${entry.id}.yaml`);
  const missing = entries.filter((entry) => !fs.existsSync(resultOf(entry)));
  if (missing.length > 0) {
    return owing([
      `waiting on the ${missing.map((entry) => entry.id).join(', ')} scanner${missing.length === 1 ? '' : 's'}: ` +
        `${missing.map(resultOf).join(' ')} not written yet`,
      `spawn the dispatch lines ${again} printed for ${missing.length === 1 ? 'it' : 'them'}, then run ${fix} again`,
    ]);
  }
  const results = entries.map((entry) => ({ question: entry.question, lines: readResult(resultOf(entry), entry.question, fix, entry.id, Boolean(options.plan)) }));
  return options.plan ? planCollect(tree, context, sent, results) : record(tree, context, sent, results);
}

/**
 * The intents a plan builds on that have not merged yet. Until they merge the plan pins detail
 * of a tree that does not exist, so its cross-check waits and then runs against the real tree.
 */
function unmergedBase(tree, intent) {
  if (!fs.existsSync(lib.statePath(tree))) return [];
  const ledger = lib.readLedger(tree);
  const entry = ledger.intents.find((candidate) => candidate.id === intent);
  return entry ? unmetPrerequisites(ledger, entry) : [];
}

function scan(options) {
  const tree = options.tree || lib.repoRoot(options.cwd);
  const config = lib.readConfig(tree, options.config);
  const ids = questions(tree, options);
  const intent = options.plan || owed.intentFor(tree, options);
  if (options.plan && !fs.existsSync(path.join(tree, lib.SPECS_DIR, 'intents', intent))) {
    throw new RunError(`no plan of ${intent} in ${path.join(tree, lib.SPECS_DIR, 'intents')}: capture the intent first, then run this again`, 'NO_PLAN');
  }
  const unmerged = options.plan ? unmergedBase(tree, intent) : [];
  if (unmerged.length > 0) {
    return {
      exit: 3,
      payload: { ok: false, intent, owed: 'merge', unmerged },
      out: [
        `the plan of ${intent} builds on ${unmerged.join(', ')}, not merged yet: its cross-check waits for that merge`,
        `once ${unmerged.join(', ')} ${unmerged.length === 1 ? 'has' : 'have'} merged into the base, run ${scanCall(tree, options.plan)}`,
      ],
    };
  }
  const root = path.join(lib.cacheDir(tree), lib.currentBranch(tree), 'scan');
  const dir = options.plan ? path.join(root, `plan-${intent}`) : root;
  const { agent, model } = hostActor('scanner', config);
  const context = { intent, config, options, ids, dir, agent, model, maxLines: MAX_LINES };
  if (!options.plan && !owed.scanOwed(tree, intent)) {
    const rel = owed.scanPath(tree, intent);
    return { exit: 0, payload: { ok: true, intent, scan: rel }, out: [`the scan of ${intent} is collected in ${rel}`, `then ${intentReviewCall(tree)}`] };
  }
  return options.collect ? collect(tree, context) : dispatch(tree, context);
}

module.exports = { scan };
