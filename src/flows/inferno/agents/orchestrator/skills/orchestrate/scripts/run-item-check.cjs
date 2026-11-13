'use strict';

/**
 * Where `run.cjs verify-item` runs an item's own check, its `finalize_check` (run-item-proof.cjs).
 *
 * Without `verification.run` each check runs in the tree through lib.runShell, as it always did:
 * no host session and no refused reading, whatever else the config sets.
 *
 * With it the check is placed as `mutate.run` places a mutant's test (run-mutate-host.cjs): a bare
 * check goes through the host's wrapper, the tree and the check one single-quoted shell word each,
 * and one that already starts with the wrapper's own words, or that `verification.wrapped` marks,
 * runs as written. The placed checks then run as integrate's commands do, through `checkRounds`
 * (run-check-session.cjs): the checks of one verify-item, a batch's too, share one
 * `verification.session` where its match reaches them, as the commands of one integrate do, and a
 * session runs a placed check bare. A check the wrapper refused (`verification.refused`,
 * run-check-refused.cjs) runs once more, in a fresh session where it has one; refused twice it is
 * no verdict, and verify-item writes no proof. Before its checks, verify-item with the key closes
 * each session a killed integrate, gate or verify-item left open in the tree (`closeLeft`), as
 * integrate and the gate do; without the key it closes none.
 */

const fs = require('fs');
const path = require('path');

const lib = require('./run-lib.cjs');
const { checkRounds, closeLeft } = require('./run-check-session.cjs');
const { readRun } = require('./run-check-refused.cjs');
const { commandOf, wrapperOf } = require('./run-mutate-host.cjs');

/** What `log` holds from byte `from` on: every run, here or in a session, writes its log. */
const readFrom = (log, from) => fs.readFileSync(log).subarray(from).toString('utf8');

/**
 * Run each of `checks`, `[{ item, check }]`, in `tree`, its log at `logOf(item)`. Returns `runs`,
 * one per check in order, `{ item, command, run, output, line }`: `command` the check as it ran,
 * `run` as the shell returned it, `output` what that run wrote to its log, and `line` the refusal
 * line of a check the wrapper refused twice, else null; `left`, the lines of closing the sessions
 * a killed run left, to print first; and `notes`, the lines a session's close left.
 */
function runItemChecks(tree, config, checks, logOf) {
  const wrapper = wrapperOf(config.verification);
  if (!wrapper) {
    const runs = checks.map(({ item, check }) => {
      const log = logOf(item);
      return { item, command: check, run: lib.runShell(check, tree, log), output: readFrom(log, 0), line: null };
    });
    return { runs, left: [], notes: [] };
  }
  const left = closeLeft(tree);
  const dir = path.join(lib.cacheDir(tree), lib.currentBranch(tree), `verify-${lib.stamp()}`);
  const checked = checkRounds(tree, config, dir, (step) => checks.map(({ item, check }) => step(item, (shell) => {
    const command = commandOf({ run: wrapper }, tree, check);
    const log = logOf(item);
    const read = readRun(config, shell, command, tree, log, command === check ? {} : { test: check });
    return { item, command, run: read.run, output: readFrom(log, read.from), line: read.line, result: read.line ? 'refused' : 'ran' };
  })));
  return { runs: checked.value, left, notes: checked.notes };
}

module.exports = { runItemChecks };
