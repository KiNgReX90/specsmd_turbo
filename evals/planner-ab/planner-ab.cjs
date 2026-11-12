#!/usr/bin/env node
'use strict';

/**
 * Planner A/B eval: plan one fixed statement at one fixed commit of one invented consumer with
 * two planner texts, on Claude Code and on Codex, two runs per arm at least, and count each run.
 *
 *   node evals/planner-ab/planner-ab.cjs run --b <source tree | patch> --out <dir>
 *     [--source <src>] [--a <source tree | patch>] [--hosts claude,codex] [--runs 2]
 *     [--consumer <dir>] [--statement <file>] [--timeout-min 90] [--dry]
 *   node evals/planner-ab/planner-ab.cjs count <dir> [--json]
 *
 * Arm A is `--source` as it is (default: this repository's src/), or `--a`. Arm B is `--b`: a
 * second source tree, or a patch made with `git diff` from the repository root or from src/,
 * applied to a copy of `--source`. A patch is the cheapest arm: change the planner text, run
 * `git diff > /tmp/change.patch`, put the text back if you like, and measure.
 *
 * `run` plans, one run after the other, and keeps every run under `<dir>/runs/<arm>-<host>-<n>/`:
 * the tree the planner left, its transcript, its frontier record and its meta. It ends with the
 * table. `run --dry` prints every command it would run and writes nothing. `count` reads a kept
 * folder into the table again, without running or writing anything: per run the model rounds,
 * the shell calls and the subcommands they batch, the output tokens, the wall time, the work
 * items planned and the frontier result, then each arm's mean on each host. It exits 1 when a
 * run could not be counted, 2 on a usage error.
 *
 * The consumer is evals/planner-ab/consumer, an invented gift card shop with its own code,
 * tests, rules and host configs; the statement is evals/planner-ab/statement.md.
 */

const path = require('node:path');

const { CONSUMER, SRC, STATEMENT } = require('./paths.cjs');
const { ArmError } = require('./arms.cjs');
const { HOSTS } = require('./hosts.cjs');
const { RunError, dryRun, realRun } = require('./run.cjs');
const { CountError, countRuns, table } = require('./count.cjs');

const USAGE = [
  'usage: planner-ab.cjs run --b <source tree | patch> --out <dir> [--source <src>] [--a <source tree | patch>]',
  '         [--hosts claude,codex] [--runs 2] [--consumer <dir>] [--statement <file>] [--timeout-min 90] [--dry]',
  '       planner-ab.cjs count <dir> [--json]',
].join('\n');

class UsageError extends Error {}

const VALUED = ['--a', '--b', '--out', '--source', '--hosts', '--runs', '--consumer', '--statement', '--timeout-min'];

function parseRun(argv) {
  const options = { source: SRC, consumer: CONSUMER, statement: STATEMENT, hosts: [...HOSTS], runs: 2, timeoutMin: 90, dry: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry') {
      options.dry = true;
      continue;
    }
    if (!VALUED.includes(flag)) throw new UsageError(`${flag} is no option of run`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
    index += 1;
    if (flag === '--hosts') options.hosts = value.split(',').map((host) => host.trim()).filter(Boolean);
    else if (flag === '--runs') options.runs = Number(value);
    else if (flag === '--timeout-min') options.timeoutMin = Number(value);
    else options[flag.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = path.resolve(value);
  }
  if (!options.b) throw new UsageError('--b is required: the source tree or patch of the changed planner text');
  if (!options.out) throw new UsageError('--out is required: the folder the runs are kept in');
  if (!Number.isInteger(options.runs) || options.runs < 2) {
    throw new UsageError('--runs must be two runs per arm at least: one planner text gave 10 items once and 12 the next time');
  }
  if (!(options.timeoutMin > 0)) throw new UsageError('--timeout-min must be a positive number of minutes');
  if (options.hosts.length === 0 || options.hosts.some((host) => !HOSTS.includes(host))) {
    throw new UsageError(`--hosts names ${HOSTS.join(' and ')} only`);
  }
  return options;
}

function main(argv) {
  const [command, ...rest] = argv;
  try {
    if (command === 'run') {
      const options = parseRun(rest);
      if (options.dry) {
        process.stdout.write(dryRun(options));
        return 0;
      }
      realRun(options);
      const result = countRuns(options.out);
      process.stdout.write(table(result));
      return result.ok ? 0 : 1;
    }
    if (command === 'count') {
      const json = rest.includes('--json');
      const dirs = rest.filter((arg) => arg !== '--json');
      if (dirs.length !== 1 || dirs[0].startsWith('--')) throw new UsageError('count takes one folder');
      const result = countRuns(path.resolve(dirs[0]));
      process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : table(result));
      return result.ok ? 0 : 1;
    }
    throw new UsageError(command ? `${command} is no command: run or count` : 'name a command: run or count');
  } catch (error) {
    if (![UsageError, ArmError, RunError, CountError].some((kind) => error instanceof kind)) throw error;
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main };
