'use strict';

// The readout counts oracle dispatches by route from the dispatch log lines run.cjs writes.
// These cases hold the two together: a line dispatch-log writes for a first ask and for a
// retry of a blocked one reads back with the route it was sent on. They live here, beside the
// readout, because a host installs the flow scripts and never this folder.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { oracleEntry } = require('./measure.cjs');

const S = path.join(__dirname, '..', '..', 'src', 'flows', 'inferno', 'agents', 'orchestrator', 'skills', 'orchestrate', 'scripts');
const { CONFIG, repo, run } = require(path.join(S, 'run-fixture.cjs'));

const HARD_CONFIG = CONFIG.replace('  cheap: model-cheap\n', '  cheap: model-cheap\n  oracle_hard: model-hard\n');
const HIGH_IMPACT = 'high contract: renames the balance field of the public gift card schema in schema/card.json';
const LOW_IMPACT = 'low: only the private helper src/a.ts reads the value';
const HIGH_COMPLEXITY = 'high readings: three roundings of the balance stay defensible after src/a.test.ts ran';
const LOW_COMPLEXITY = 'low: one reading survives the measurement in src/a.test.ts';
const EARLIER = 'high earlier: the normal oracle returned blocked on this call';

const ask = (fixture, impact, complexity, extra = []) => {
  const result = run(fixture, ['dispatch-log', 'alpha', '--tier', 'oracle', '--item', 'a-one',
    '--impact', impact, '--complexity', complexity, ...extra, '--json']);
  assert.equal(result.code, 0, result.out + result.err);
  return JSON.parse(result.out);
};
const logLines = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);

test('the readout reads the route of each first oracle ask from its dispatch log line', () => {
  const fixture = repo({ config: HARD_CONFIG });
  const hard = ask(fixture, HIGH_IMPACT, HIGH_COMPLEXITY);
  const normal = ask(fixture, HIGH_IMPACT, LOW_COMPLEXITY);
  assert.equal(hard.route, 'hard');
  assert.equal(normal.route, 'normal');
  assert.deepEqual(logLines(hard.log).map(oracleEntry), [{ route: 'hard' }, { route: 'normal' }]);
});

test('the readout reads a retry of a blocked oracle as a hard ask', () => {
  const fixture = repo({ config: HARD_CONFIG });
  const normal = ask(fixture, LOW_IMPACT, LOW_COMPLEXITY);
  const retry = ask(fixture, LOW_IMPACT, EARLIER, ['--blocked', normal.dispatch_id]);
  assert.equal(retry.route, 'hard');
  assert.deepEqual(logLines(retry.log).map(oracleEntry), [{ route: 'normal' }, { route: 'hard' }]);
});

test('the readout counts no builder dispatch as an oracle ask', () => {
  const fixture = repo({ config: HARD_CONFIG });
  const builder = run(fixture, ['dispatch-log', 'alpha', '--item', 'a-one', '--tier', 'cheap', '--agent', 'builder', '--json']);
  assert.equal(builder.code, 0, builder.out + builder.err);
  const [line] = logLines(JSON.parse(builder.out).log);
  assert.equal(oracleEntry(line), null);
});
