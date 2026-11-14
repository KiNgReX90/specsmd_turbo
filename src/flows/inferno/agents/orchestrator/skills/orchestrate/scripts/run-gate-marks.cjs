'use strict';

/**
 * The gate's lines for the criteria the plan marked with the command or lane that proves them
 * (run-criterion-marks.cjs): one `MARKED <item>:<n> (gate: <name>): <verdict>` line per mark,
 * beside the verdict this gate gave that command or lane. A finalize command reads as the gate
 * ran it, a lane as gate --wait found it. A gate with no marked criterion prints nothing new,
 * and neither does a call that gave no verdict yet (a started, queued or running gate).
 *
 * The lines go after a red gate's own lines, and before the last line of any other, so the
 * green line and a lane's accept line stay last. They take only the room the 30-line answer
 * leaves; the payload carries every mark under `marks`.
 */

const fs = require('fs');

const lib = require('./run-lib.cjs');
const { configuredLanes } = require('./run-lane-config.cjs');
const { intentFor, intentItems } = require('./run-intent-owed.cjs');
const { acceptanceCriteria } = require('./run-mutant-coverage.cjs');
const { gateCommand, gateMark } = require('./run-criterion-marks.cjs');
const { gateStartCall } = require('./run-call.cjs');

const MAX_LINES = 30;
const WORDS = {
  pass: 'PASS',
  green: 'GREEN, unchanged since its last pass',
  skip: 'SKIP, no path in its scope changed',
  fail: 'FAIL',
  refused: 'NO VERDICT, the host ran nothing',
};

/** Every marked criterion of the intent's items, numbered as the item numbers it. */
function markedCriteria(tree, intent) {
  return intentItems(tree, intent).flatMap((id) => {
    const text = fs.readFileSync(lib.readItemSpec(tree, intent, id).file, 'utf8');
    return acceptanceCriteria(text).map((criterion, index) => ({ item: id, criterion: index + 1, gate: gateMark(criterion) }))
      .filter((entry) => entry.gate !== null);
  });
}

/** The verdict the gate's payload gives one name. */
function verdictOf(name, tree, config, payload) {
  const lane = configuredLanes(config).find((entry) => `verification.${entry.name}` === name);
  if (lane) {
    if (!Array.isArray(payload.lanes)) return `not run by this gate, ${gateStartCall(tree)} starts the lanes`;
    const state = payload.lanes.find((entry) => entry.lane === lane.name);
    if (!state) return 'not started, no path in its scope changed';
    return state.state === 'green' ? 'GREEN' : state.state;
  }
  const command = gateCommand(config, name);
  if (command === null) return 'no command of verification.finalize and no lane of this config';
  const entry = payload.results.find((result) => result.command === command);
  return entry ? WORDS[entry.result] : 'not run, the gate stopped at an earlier red';
}

/** The gate's result with its marked criteria added; the result itself when it has none to add. */
function withMarks(options, result) {
  const { payload } = result;
  if (!Array.isArray(payload.results) || payload.results.length === 0) return result;
  const tree = options.tree || lib.repoRoot(options.cwd);
  const marks = markedCriteria(tree, intentFor(tree, options));
  if (marks.length === 0) return result;
  const config = lib.readConfig(tree, options.config);
  for (const mark of marks) mark.verdict = verdictOf(mark.gate, tree, config, payload);
  const lines = marks.map((mark) => `MARKED ${mark.item}:${mark.criterion} (gate: ${mark.gate}): ${mark.verdict}`);
  const room = MAX_LINES - result.out.length;
  const shown = room > 0 ? lib.capLines(lines, room) : [];
  const out = result.exit === 2 ? [...result.out, ...shown] : [...result.out.slice(0, -1), ...shown, ...result.out.slice(-1)];
  return { ...result, payload: { ...payload, marks }, out };
}

module.exports = { withMarks };
