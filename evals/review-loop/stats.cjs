#!/usr/bin/env node
'use strict';

/**
 * The review-loop readout, read-only. It walks the git history of each item review file, both
 * lenses (`.specs-inferno/intents/<intent>/reviews/<item>.yaml` and `reviews/quality/<item>.yaml`),
 * between base and head and prints one line per item and the rows of the plan's section 3 that
 * come from review files, plus the oracle dispatches by route from the dispatch log. Tokens per
 * agent type, and per item for its reviewers of both lenses, come from tokens.cjs.
 *
 *   node evals/review-loop/stats.cjs --tree <intent worktree> --base <ref> [--head <ref>]
 *     [--intent <id>] [--dispatch-log <file>] [--json]
 */

const fs = require('node:fs');
const path = require('node:path');

const { UsageError, commitOf } = require('./history.cjs');
const { measure } = require('./measure.cjs');

const USAGE = 'usage: node stats.cjs --tree <intent worktree> --base <ref> [--head <ref>] [--intent <id>] [--dispatch-log <file>] [--json]';
const VALUED = ['--tree', '--base', '--head', '--intent', '--dispatch-log'];

function parseArgs(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--json') options.json = true;
    else if (VALUED.includes(flag) && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) {
      options[flag.slice(2).replace(/-(\w)/g, (_, letter) => letter.toUpperCase())] = argv[index + 1];
      index += 1;
    } else throw new UsageError(`${flag} is no option here`);
  }
  if (!options.tree || !options.base) throw new UsageError('--tree and --base are required');
  if (!fs.existsSync(options.tree)) throw new UsageError(`${options.tree} does not exist`);
  return options;
}

const short = (sha) => sha.slice(0, 9);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const one = (value) => value.toFixed(1);
const weights = (counts) => `${counts.blocker} blocker, ${counts.major} major, ${counts.minor} minor${counts.unrated ? `, ${counts.unrated} unrated` : ''}`;
const lensSegment = (name, lens) => `${name} rounds ${lens.rounds}, fix ${lens.fix}, findings ${weights(lens.findings)}`;

function itemLine(item, width) {
  const later = item.laterFindings;
  return [
    item.item.padEnd(width),
    `rounds ${item.rounds}`,
    `fix ${item.fix} (serious ${item.serious}, survivor only ${item.survivorOnly}, minor only ${item.minorOnly})`,
    `later findings ${later.blocker} blocker, ${later.major} major, ${later.minor} minor`,
    `criteria ${item.criteria === null ? 'no spec' : item.criteria}`,
    `mutants ${item.mutants} in ${plural(item.mutantRounds, 'round')}, first ${item.firstRound.mutants}`,
    `survivors ${item.survivors.mutants}`,
    `largest ${item.largest}`,
    `files ${item.filesFirst} to ${item.filesLast}`,
    `grants ${item.grants}`,
    `mutants run ${item.mutantsRun}`,
    ...['contract', 'quality'].filter((name) => item.lenses[name]).map((name) => lensSegment(name, item.lenses[name])),
  ].join('  ');
}

function oracleRow(oracle) {
  if (!oracle.present) return `no dispatch log at ${oracle.logs.join(', ') || 'any path: no intent was measured'}`;
  const routes = Object.entries(oracle.byRoute).map(([route, count]) => `${route} ${count}`);
  return `${oracle.total}${routes.length ? `: ${routes.join(', ')}` : ''}`;
}

function lensRow(lens) {
  if (lens.items === 0) return 'none';
  return `${plural(lens.rounds, 'round')} over ${plural(lens.items, 'item')}, fix ${lens.fixRounds}; ` +
    `findings ${lens.findings.total}, so ${one(lens.findingsPerItem)} per item: ${weights(lens.findings)}; ` +
    `in its first round ${weights(lens.firstFindings)}`;
}

function rows(totals, oracle) {
  const later = totals.laterFindings;
  const largest = totals.largest;
  return [
    ['Review rounds', `${totals.rounds} over ${plural(totals.items, 'item')}, so ${one(totals.roundsPerItem)} per item`],
    ['Rounds per item, sorted', totals.roundsSorted.join(', ') || 'none'],
    ['Fix rounds', `${totals.fixRounds}`],
    ['Fix rounds with a blocker or major finding that is not a surviving mutant', `${totals.serious}`],
    ['Fix rounds that are serious only because a mutant survived', `${totals.survivorOnly}`],
    ['Fix rounds with minor findings only and no survivor', `${totals.minorOnly}`],
    ['Findings in round 2 and later',
      `${later.total}: ${later.blocker} blocker, ${later.major} major, ${later.minor} minor${later.unrated ? `, ${later.unrated} unrated` : ''}`],
    [`Acceptance criteria of the ${plural(totals.items, 'item')}`,
      `${totals.criteria}${totals.criteriaMissing.length ? ` (no spec at head for ${totals.criteriaMissing.join(', ')})` : ''}`],
    ['Mutants, each counted once',
      `${totals.mutants} in ${plural(totals.mutantRounds, 'round')}, so ${one(totals.mutantsPerCriterion)} per acceptance criterion`],
    ['Mutants counted as run', `${totals.mutantsRun}: a carried mutant counts again only when its verdict changed`],
    ['Mutants in a first round', `${totals.firstRound.mutants}, of which ${totals.firstRound.numbered} name a numbered criterion`],
    ['Mutants in round 2 and later', `${totals.laterRounds.mutants}, of which ${totals.laterRounds.freeText} name a criterion in free text`],
    ['Surviving mutants',
      `${totals.survivors.mutants}: ${totals.survivors.numbered} on a numbered criterion, ${totals.survivors.freeText} on a free-text one`],
    ['Largest single round', largest
      ? `${largest.mutants} mutants, on an item with ${largest.criteria === null ? 'no spec and so no' : largest.criteria} acceptance criteria (${largest.item})`
      : 'none'],
    ['Commits that grant an item more ownership', `${totals.grantCommits}`],
    ["Files an item's review lists, first round to last", totals.filesGrowth.map((entry) => `${entry.first} to ${entry.last}`).join(', ') || 'no list grew'],
    ['Contract lens', lensRow(totals.lenses.contract)],
    ['Quality lens', lensRow(totals.lenses.quality)],
    ['Oracle dispatches', oracleRow(oracle)],
  ];
}

function text(result) {
  const width = Math.max(4, ...result.items.map((item) => item.item.length));
  const table = rows(result.totals, result.oracle);
  const label = Math.max(...table.map(([name]) => name.length));
  const out = [`review loop of ${result.tree} from ${short(result.base)} to ${short(result.head)}`, ''];
  for (const item of result.items) out.push(itemLine(item, width));
  if (result.items.length === 0) out.push('no item review was recorded in this range');
  out.push('');
  for (const [name, value] of table) out.push(`${name.padEnd(label)}  ${value}`);
  if (result.totals.unreadable > 0) out.push(`${plural(result.totals.unreadable, 'round')} did not read as YAML and count as rounds without a verdict`);
  out.push('', 'Reviewer, builder and orchestrator tokens: node evals/review-loop/tokens.cjs --session <transcript dir>',
    'Reviewer tokens per item, both lenses: add --tree, --base and --intent as here');
  return `${out.join('\n')}\n`;
}

function main(argv) {
  try {
    const options = parseArgs(argv);
    const tree = path.resolve(options.tree);
    const base = commitOf(tree, options.base);
    const head = commitOf(tree, options.head || 'HEAD');
    const result = measure(tree, base, head, { intent: options.intent, dispatchLog: options.dispatchLog });
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : text(result));
    return 0;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main };
