const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  BRANCH, commit, config, fixture, gated, git, laneRuns, nextVerdicts, passed, run, touch, withVerdicts, write,
} = require('./run-lanes-fixture.cjs');
const { writeFile } = require('./test-write.cjs');

// A product red the lane walked again and found intermittent: red on the branch, green on the
// base, green on a second walk on the branch. The names carry quotes and a dollar sign, so a
// printed accept line that quotes them badly fails to run as printed.
const TEST = 'checkout/gift-card.test.mjs "redeems a card it\'s given for $5"';
const OTHER = 'checkout/refund.test.mjs "refunds a used card"';
const PROVEN = [[TEST, 'green', 'green']];
const PRINTED = /^the lane proved every red intermittent: (node \S+run\.cjs smoke --accept-intermittent .+)$/m;

const lines = (result) => result.out.trim().split('\n');
const accept = (f, tests, ...extra) =>
  run(f, 'smoke', '--accept-intermittent', ...tests.flatMap((name) => ['--test', name]), '--reason', 'a race under load', '--by', 'lead', ...extra);

/** Every file under `dir` whose name ends with `suffix`. */
function filesEnding(dir, suffix) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).map(String).filter((file) => file.endsWith(suffix));
}

/** A commit on main, folded into the branch by the next gate, whose message carries `body`. */
function onMain(f, body) {
  const branch = git(f.tree, 'rev-parse', '--abbrev-ref', 'HEAD');
  git(f.tree, 'checkout', '-q', 'main');
  git(f.tree, 'commit', '-q', '--allow-empty', '-m', 'an earlier landing', '-m', body);
  const sha = git(f.tree, 'rev-parse', '--short', 'HEAD');
  git(f.tree, 'checkout', '-q', branch);
  return sha;
}

const exception = (tests, by = 'lead', reason = 'a race under load') =>
  `exception: smoke intermittent ${JSON.stringify({ tests, reason, by, run: 'earlier', log: 'lane-smoke.log' })}`;

test('a product red the lane proved intermittent is owed its accept, and the printed accept holds the gate', (t) => {
  const f = fixture(t, withVerdicts());
  nextVerdicts(f, PROVEN);
  touch(f);
  const owed = gated(f);
  assert.equal(owed.code, 3, owed.out + owed.err);
  assert.match(owed.out, /RED lane smoke: product red \(exit 10\)/);
  const printed = PRINTED.exec(lines(owed).pop());
  assert.ok(printed, `the accept line is not last: ${owed.out}`);
  assert.equal(run(f, 'green').code, 3);

  const line = printed[1].replace('"<why>"', '"a race under load"').replace('<who>', 'lead');
  const accepted = spawnSync('bash', ['-c', line], {
    cwd: f.tree, encoding: 'utf8', env: { ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache },
  });
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.match(accepted.stdout, /^accepted smoke product red as intermittent for this tree: checkout\/gift-card\.test\.mjs "redeems a card it's given for \$5"$/m);
  assert.match(accepted.stdout, /^wait with: node \S+run\.cjs gate --wait --tree \S+$/m);
  const record = JSON.parse(fs.readFileSync(path.join(f.cache, 'specsmd-inferno', 'app', 'green-commands',
    filesEnding(path.join(f.cache, 'specsmd-inferno', 'app', 'green-commands'), '.intermittent')[0]), 'utf8'));
  assert.deepEqual(record.tests, [TEST]);
  assert.equal(record.reason, 'a race under load');
  assert.equal(record.by, 'lead');
  assert.match(record.log, /lane-smoke-\S+\.log$/);
  assert.equal(record.verdicts, f.verdicts);

  const held = run(f, 'gate', '--wait', '--minutes', '0.5');
  passed(held);
  assert.ok(lines(held).includes(`ACCEPTED lane smoke intermittent: ${TEST}`), held.out);
  const verdict = run(f, 'green');
  passed(verdict);
  assert.ok(lines(verdict).includes(`ACCEPTED smoke intermittent: ${TEST}`), verdict.out);
  // The next gate on the same tree holds the lane on the record and walks nothing.
  const again = run(f, 'gate', '--detach');
  passed(again);
  assert.ok(lines(again).includes(`ACCEPTED lane smoke intermittent: ${TEST}`), again.out);
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  assert.deepEqual(laneRuns(f), ['smoke']);
});

test('a red the second walk did not clear, or the base walk did not clear, has no accept', (t) => {
  const f = fixture(t, withVerdicts());
  nextVerdicts(f, [[TEST, 'green', 'green'], [OTHER, 'green', 'red']]);
  touch(f);
  const red = gated(f);
  assert.equal(red.code, 2, red.out + red.err);
  assert.doesNotMatch(red.out, /--accept-intermittent/);
  const refused = accept(f, [TEST, OTHER]);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /not proven intermittent: checkout\/refund\.test\.mjs "refunds a used card" \(base green, again red\)/);
  assert.deepEqual(filesEnding(f.cache, '.intermittent'), []);

  nextVerdicts(f, [[TEST, 'red', 'green']]);
  assert.equal(gated(f, '--force').code, 2);
  const base = accept(f, [TEST]);
  assert.equal(base.code, 2, base.out + base.err);
  assert.match(base.err, /not proven intermittent: .* \(base red, again green\)/);
  assert.deepEqual(filesEnding(f.cache, '.intermittent'), []);
  assert.equal(run(f, 'green').code, 3);
});

test('a --test the verdicts file does not hold, or a red test no --test names, is refused; one call names every red test', (t) => {
  const f = fixture(t, withVerdicts());
  nextVerdicts(f, [[TEST, 'green', 'green'], [OTHER, 'green', 'green']]);
  touch(f);
  assert.equal(gated(f).code, 3);
  const unknown = accept(f, [TEST, OTHER, 'checkout/none.test.mjs "never ran"']);
  assert.equal(unknown.code, 2, unknown.out + unknown.err);
  assert.match(unknown.err, /the verdicts file holds no red test checkout\/none\.test\.mjs "never ran"/);
  const unnamed = accept(f, [TEST]);
  assert.equal(unnamed.code, 2, unnamed.out + unnamed.err);
  assert.match(unnamed.err, /no --test names the red test checkout\/refund\.test\.mjs "refunds a used card"/);
  assert.deepEqual(filesEnding(f.cache, '.intermittent'), []);
  passed(accept(f, [TEST, OTHER]));
  const held = run(f, 'gate', '--wait', '--minutes', '0.5');
  passed(held);
  for (const name of [TEST, OTHER]) assert.ok(lines(held).includes(`ACCEPTED lane smoke intermittent: ${name}`), held.out);
});

test("a verdicts file the lane did not write, or wrote before its last run, is refused", (t) => {
  const f = fixture(t, withVerdicts('10'));
  touch(f);
  assert.equal(gated(f).code, 2);
  const missing = accept(f, [TEST]);
  assert.equal(missing.code, 2, missing.out + missing.err);
  assert.match(missing.err, /no verdicts file the smoke lane wrote at \S+verdicts\.json/);
  writeFile(f.verdicts, `${JSON.stringify({ red: [{ name: TEST, base: 'green', again: 'green' }] })}\n`);
  const red = gated(f, '--force');
  assert.equal(red.code, 2, red.out + red.err);
  assert.doesNotMatch(red.out, /--accept-intermittent/);
  const refused = accept(f, [TEST]);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /the verdicts file \S+verdicts\.json is older than the lane's last run, started \S+/);
  assert.equal(run(f, 'green').code, 3);
});

test('a lane that names no verdicts file can never accept a product red as intermittent, and says so', (t) => {
  const f = fixture(t, config({ smoke: 'verdicts' }));
  nextVerdicts(f, PROVEN);
  touch(f);
  const red = gated(f);
  assert.equal(red.code, 2, red.out + red.err);
  assert.doesNotMatch(red.out, /--accept-intermittent/);
  const refused = accept(f, [TEST]);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /the smoke lane names no verdicts file, so its product red has no accept: set verification\.smoke\.verdicts/);
});

test('only a product red is accepted as intermittent', (t) => {
  const f = fixture(t, withVerdicts('11'));
  writeFile(f.verdicts, `${JSON.stringify({ red: [{ name: TEST, base: 'green', again: 'green' }] })}\n`);
  touch(f);
  assert.equal(gated(f).code, 3);
  const refused = accept(f, [TEST]);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /no product red of the smoke lane on this tree to accept/);
  assert.deepEqual(filesEnding(f.cache, '.intermittent'), []);
});

test('an edit to the tree after the accept drops it', (t) => {
  const f = fixture(t, withVerdicts());
  nextVerdicts(f, PROVEN);
  touch(f);
  assert.equal(gated(f).code, 3);
  passed(accept(f, [TEST]));
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
  touch(f);
  // The red ran on the tree before the edit, so it is neither held nor offered an accept.
  const moved = run(f, 'gate', '--wait', '--minutes', '0.5');
  assert.equal(moved.code, 2, moved.out + moved.err);
  assert.match(moved.out, /RED lane smoke: product red \(exit 10\)/);
  assert.doesNotMatch(moved.out, /ACCEPTED|--accept-intermittent/);
  const verdict = run(f, 'green', '--json');
  assert.equal(verdict.code, 3, verdict.out + verdict.err);
  assert.deepEqual(JSON.parse(verdict.out).owed, ['smoke']);
});

test('a later walk of the lane drops the accept of the walk before it', (t) => {
  const f = fixture(t, withVerdicts());
  nextVerdicts(f, PROVEN);
  touch(f);
  assert.equal(gated(f).code, 3);
  passed(accept(f, [TEST]));
  const rerun = gated(f, '--force');
  assert.equal(rerun.code, 3, rerun.out + rerun.err);
  assert.doesNotMatch(rerun.out, /ACCEPTED/);
  assert.match(lines(rerun).pop(), PRINTED);
  assert.equal(run(f, 'green').code, 3);
});

test('the intermittent accept takes --test, --reason and --by, and never --accept beside it', (t) => {
  const f = fixture(t, withVerdicts());
  for (const args of [
    ['--reason', 'a race', '--by', 'lead'],
    ['--test', TEST, '--by', 'lead'],
    ['--test', TEST, '--reason', 'a race'],
    ['--test', TEST, '--reason', ' ', '--by', 'lead'],
    ['--test', TEST, '--reason', 'a race', '--by', ' '],
    ['--test', TEST, '--reason', 'a race', '--by', 'lead', '--accept'],
  ]) {
    const refused = run(f, 'smoke', '--accept-intermittent', ...args);
    assert.equal(refused.code, 1, `${args.join(' ')}\n${refused.out}${refused.err}`);
    assert.match(refused.err, /usage: node run\.cjs smoke --accept-intermittent --test "<name>"/);
  }
  const unwalked = accept(f, [TEST]);
  assert.equal(unwalked.code, 2, unwalked.out + unwalked.err);
  assert.match(unwalked.err, /NOTHING_TO_ACCEPT.*no product red of the smoke lane on this tree to accept/);
});

test('an accept with no base branch to read the earlier accepts from is refused', (t) => {
  const f = fixture(t, withVerdicts());
  nextVerdicts(f, PROVEN);
  touch(f);
  assert.equal(gated(f).code, 3);
  // The config sits outside every lane scope, so the red still speaks for this tree.
  write(f.tree, '.specs-inferno/config.yaml', fs.readFileSync(path.join(f.tree, '.specs-inferno/config.yaml'), 'utf8').replace('base_branch: main', 'base_branch: gone'));
  commit(f.tree, 'base gone');
  const refused = accept(f, [TEST]);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /NO_BASE.*no gone branch here to read the earlier intermittent accepts from/);
  assert.deepEqual(filesEnding(f.cache, '.intermittent'), []);
});

test('under the merge slot a red owed its intermittent accept keeps the ticket, and the accept renews it', (t) => {
  const f = fixture(t, `${withVerdicts()}  merge_slot: true\n`);
  const slot = require('./run-slot.cjs');
  const before = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = f.cache;
  t.after(() => {
    if (before === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = before;
  });
  const ticket = () => slot.queue(f.tree).tickets.find((entry) => entry.holder === BRANCH);
  nextVerdicts(f, PROVEN);
  touch(f);
  assert.equal(gated(f).code, 3);
  const since = ticket().activity;
  passed(accept(f, [TEST]));
  assert.ok(Date.parse(ticket().activity) > Date.parse(since), `${since} -> ${ticket().activity}`);
});

test('a second accept of a test prints the earlier one from the base, and a third waits for a base commit naming its fix', (t) => {
  const f = fixture(t, withVerdicts());
  // A hand-written exception line, or one whose record does not parse or names no tests, never counts.
  onMain(f, `exception: lead cleared ${TEST} by hand`);
  onMain(f, `exception: smoke intermittent {"tests": [${JSON.stringify(TEST)}], "by": }`);
  onMain(f, `exception: smoke intermittent {"test": ${JSON.stringify(TEST)}, "by": "lead"}`);
  const first = onMain(f, exception([TEST], 'lead', 'the first race'));
  nextVerdicts(f, PROVEN);
  touch(f);
  assert.equal(gated(f).code, 3);
  const second = accept(f, [TEST]);
  passed(second);
  assert.ok(lines(second).includes(`earlier intermittent accept of ${TEST}: ${first} ${git(f.tree, 'log', '-1', '--format=%cs', first)} by lead: the first race`),
    second.out);
  assert.equal(lines(second).filter((line) => line.startsWith('earlier ')).length, 1, second.out);

  const two = onMain(f, exception([OTHER, TEST], 'release-lead', 'the second race'));
  assert.equal(gated(f, '--force').code, 3);
  const third = accept(f, [TEST]);
  assert.equal(third.code, 2, third.out + third.err);
  assert.match(third.err, new RegExp(`accepted as intermittent 2 times on main since a commit there last named its fix: ${first} .* by lead, ${two} .* by release-lead`));
  assert.ok(third.err.includes(`"Fixes-intermittent: ${TEST}"`), third.err);
  assert.equal(run(f, 'gate', '--wait', '--minutes', '0.5').code, 3);

  // A fix named on the branch alone is not on the base yet.
  git(f.tree, 'commit', '-q', '--allow-empty', '-m', 'fix the race', '-m', `Fixes-intermittent: ${TEST}`);
  assert.equal(accept(f, [TEST]).code, 2);
  onMain(f, `Fixes-intermittent: ${TEST}`);
  const lifted = accept(f, [TEST]);
  passed(lifted);
  assert.ok(!lifted.out.includes('earlier '), lifted.out);
  passed(run(f, 'gate', '--wait', '--minutes', '0.5'));
});

test('the verdicts key and form the config example documents are the ones the flow reads', (t) => {
  const { intermittentTests } = require('./run-lanes-intermittent.cjs');
  const { configuredLanes } = require('./run-lane-config.cjs');
  const lib = require('./run-lib.cjs');
  const example = fs.readFileSync(path.join(__dirname, '../../../config.example.yaml'), 'utf8');
  const documented = /^ {4}# verdicts: (\S+)\s+# optional: .* as (\{"red": \[.*?\]\})/m.exec(example);
  assert.ok(documented, 'no verdicts line under the smoke lane in config.example.yaml');
  const form = JSON.parse(documented[2]);
  assert.deepEqual(intermittentTests(form), { tests: ['<test>'], entries: form.red });
  const f = fixture(t, `verification:\n  smoke:\n    command: npm run smoke\n    scope: ["src/**"]\n    verdicts: ${documented[1]}\n`);
  assert.equal(configuredLanes(lib.readConfig(f.tree)).find((lane) => lane.name === 'smoke').verdicts, documented[1]);
});

test('a verdicts body names each red test, each green on the base and on a second walk, or it proves nothing', () => {
  const { intermittentTests } = require('./run-lanes-intermittent.cjs');
  const entry = (fields) => ({ red: [{ name: TEST, base: 'green', again: 'green', ...fields }] });
  for (const [body, why] of [
    [null, /no red test listed/],
    [{}, /no red test listed/],
    [{ red: 'x' }, /no red test listed/],
    [{ red: [] }, /no red test listed/],
    [{ red: [null] }, /a red test without a name/],
    [entry({ name: ' ' }), /a red test without a name/],
    [entry({ name: 7 }), /a red test without a name/],
    [entry({ base: undefined }), /not proven intermittent: .* \(base undefined, again green\)/],
    [entry({ again: 'skipped' }), /not proven intermittent: .* \(base green, again skipped\)/],
  ]) {
    const read = intermittentTests(body);
    assert.equal(read.tests, undefined, JSON.stringify(body));
    assert.match(read.refusal, why, JSON.stringify(body));
  }
  const twice = { red: [{ name: TEST, base: 'green', again: 'green' }, { name: TEST, base: 'green', again: 'green' }] };
  assert.deepEqual(intermittentTests(twice).tests, [TEST]);
});
