'use strict';

/**
 * The count half of the planner A/B eval: a folder of recorded runs into the table, read-only,
 * as often as one likes. A recorded run is `runs/<arm>-<host>-<n>/` with
 *
 *   meta.json         arm, host, run, wallMs, exit and consumerSha, written by the run half
 *   transcript.jsonl  the Claude stream-json, or the Codex session rollout
 *   tree/             the consumer as the planner left it, its .specs-inferno/state.yaml the plan
 *   frontier.json     per planned intent the exit and the lines of `run.cjs frontier`
 *
 * beside one `ab.json` that names the statement, the consumer commit and the arms. A run whose
 * transcript does not read is that run's error, and every other run is still counted.
 */

const fs = require('node:fs');
const path = require('node:path');

const { S } = require('./paths.cjs');
const { countClaude } = require('./count-claude.cjs');
const { countCodex } = require('./count-codex.cjs');

class CountError extends Error {}

const COUNTERS = { claude: countClaude, codex: countCodex };
const HOST_ORDER = ['claude', 'codex'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The planned intents of a tree and their item counts, read the way the flow reads its ledger. */
function planOf(tree) {
  if (!fs.existsSync(path.join(tree, '.specs-inferno', 'state.yaml'))) return [];
  const { readLedger } = require(path.join(S, 'run-lib.cjs'));
  try {
    return readLedger(tree).intents.map((intent) => ({ id: intent.id, items: intent.items.length }));
  } catch (error) {
    // The frontier record of the run says the same and names it as the run's result.
    return [];
  }
}

/** One cell for the frontier of every planned intent of a run. */
function frontierCell(records) {
  if (!Array.isArray(records) || records.length === 0) return 'no intent planned';
  const refused = records.filter((record) => record.exit !== 0);
  if (refused.length) {
    const lines = refused.flatMap((record) => record.lines || []);
    const first = lines[0] || `exit ${refused[0].exit}`;
    return `refused: ${first}${lines.length > 1 ? ` (+${lines.length - 1} more)` : ''}`;
  }
  const candidates = records.flatMap((record) => record.lines || []).filter((line) => /^candidates? /.test(line)).length;
  return candidates ? `${candidates} candidate${candidates === 1 ? '' : 's'}` : 'clean';
}

function countRun(dir, ab) {
  const meta = readJson(path.join(dir, 'meta.json'));
  const row = { id: `${meta.arm}-${meta.host}-${meta.run}`, arm: meta.arm, host: meta.host, run: meta.run };
  const notes = [];
  if (meta.exit !== 0) notes.push(meta.exit === null ? 'host was stopped' : `host exited ${meta.exit}`);
  if (meta.error) notes.push(meta.error);
  if (ab.consumerSha && meta.consumerSha !== ab.consumerSha) {
    notes.push(`consumer at ${String(meta.consumerSha).slice(0, 12)}, not ${ab.consumerSha.slice(0, 12)}`);
  }
  try {
    const counter = COUNTERS[meta.host];
    if (!counter) throw new CountError(`no counter for host ${meta.host}`);
    const transcript = path.join(dir, 'transcript.jsonl');
    if (!fs.existsSync(transcript)) throw new CountError('no transcript.jsonl was kept');
    const count = counter(transcript);
    const frontierFile = path.join(dir, 'frontier.json');
    const plan = planOf(path.join(dir, 'tree'));
    if (count.compactions) notes.push(`${count.compactions} compaction${count.compactions === 1 ? '' : 's'}`);
    if (!count.finished) notes.push(count.output === null ? 'unfinished: the stream has no result line, so it has no totals' : 'transcript has no end');
    Object.assign(row, {
      rounds: count.rounds,
      shellCalls: count.shellCalls,
      shellSubcommands: count.shellSubcommands,
      output: count.output,
      costUsd: Number.isFinite(count.costUsd) ? count.costUsd : null,
      wallMs: Number.isFinite(meta.wallMs) ? meta.wallMs : count.hostWallMs,
      items: plan.reduce((sum, intent) => sum + intent.items, 0),
      intents: plan,
      frontier: frontierCell(fs.existsSync(frontierFile) ? readJson(frontierFile) : []),
      count,
    });
  } catch (error) {
    row.error = error.message;
  }
  row.notes = notes.join('; ');
  return row;
}

const NUMBERS = ['rounds', 'shellCalls', 'shellSubcommands', 'output', 'costUsd', 'wallMs', 'items'];

function meansOf(runs) {
  const means = [];
  const arms = [...new Set(runs.map((run) => run.arm))].sort();
  for (const host of HOST_ORDER) {
    for (const arm of arms) {
      const all = runs.filter((run) => run.arm === arm && run.host === host);
      if (all.length === 0) continue;
      const counted = all.filter((run) => !run.error);
      const mean = { arm, host, counted: counted.length };
      // A run with no total for a number (an unfinished one, a host that names no cost) is left
      // out of that number's mean, never counted as zero.
      for (const key of NUMBERS) {
        const values = counted.map((run) => run[key]).filter((value) => Number.isFinite(value));
        const places = key === 'costUsd' ? 100 : 10;
        mean[key] = values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * places) / places : null;
      }
      mean.clean = counted.filter((run) => run.frontier === 'clean').length;
      means.push(mean);
    }
  }
  return means;
}

/** Every recorded run of `out`, counted, with the mean of each arm on each host. */
function countRuns(out) {
  const abFile = path.join(out, 'ab.json');
  if (!fs.existsSync(abFile)) throw new CountError(`no ab.json in ${out}: name the folder a planner-ab run wrote`);
  const ab = readJson(abFile);
  const runsDir = path.join(out, 'runs');
  const dirs = fs.existsSync(runsDir)
    ? fs.readdirSync(runsDir).map((name) => path.join(runsDir, name)).filter((dir) => fs.existsSync(path.join(dir, 'meta.json')))
    : [];
  if (dirs.length === 0) throw new CountError(`no recorded run under ${runsDir}`);
  const runs = dirs.map((dir) => countRun(dir, ab)).sort((a, b) =>
    HOST_ORDER.indexOf(a.host) - HOST_ORDER.indexOf(b.host) || a.arm.localeCompare(b.arm) || a.run - b.run);
  return { ab, runs, means: meansOf(runs), ok: runs.every((run) => !run.error) };
}

/** A token count as the table writes it: 146k, 1.2M, or the number below a thousand. */
function size(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`;
  return `${Math.round(value)}`;
}

const minutes = (ms) => (Number.isFinite(ms) ? `${(ms / 60000).toFixed(1)} min` : '-');
const tokens = (value) => (Number.isFinite(value) ? size(value) : 'no total');
const money = (value) => (Number.isFinite(value) ? `${value.toFixed(2)} USD` : '-');
const cells = (values) => `| ${values.join(' | ')} |`;

function table(result) {
  const { ab } = result;
  const out = [
    `Planner A/B: consumer ${String(ab.consumerSha || 'unknown').slice(0, 12)}, statement ${String(ab.statementSha || 'unknown').slice(0, 12)}, ${ab.runs} runs per arm`,
    ...Object.entries(ab.arms || {}).map(([arm, info]) => `${arm}: ${info.label}`),
    '',
    cells(['Run', 'Model rounds', 'Shell calls', 'Subcommands', 'Output tokens', 'Cost', 'Wall', 'Items', 'Frontier', 'Notes']),
    cells(Array(10).fill('---')),
  ];
  for (const run of result.runs) {
    const name = `${run.arm} ${run.host} ${run.run}`;
    if (run.error) out.push(cells([name, `error: ${run.error}`, '', '', '', '', '', '', '', run.notes]));
    else {
      out.push(cells([name, run.rounds, run.shellCalls, run.shellSubcommands, tokens(run.output), money(run.costUsd), minutes(run.wallMs),
        run.items, run.frontier, run.notes]));
    }
  }
  for (const mean of result.means) {
    out.push(cells([`${mean.arm} ${mean.host} mean`, mean.rounds, mean.shellCalls, mean.shellSubcommands, tokens(mean.output),
      money(mean.costUsd), minutes(mean.wallMs), mean.items, `${mean.clean} of ${mean.counted} clean`, '']));
  }
  return `${out.join('\n')}\n`;
}

module.exports = { CountError, countRuns, table, frontierCell };
