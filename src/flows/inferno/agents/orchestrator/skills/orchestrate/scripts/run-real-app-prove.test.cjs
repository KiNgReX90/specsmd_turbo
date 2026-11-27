'use strict';

// On a host whose config sets real_app.prove, the journeys an item changed run in the item:
// verify-item runs the command over the paths under real_app.paths the item's diff changed and
// the tree still holds, records the run in the item's proof, and fails on a red. The item's
// review waits until its proof holds that run, so the item cannot land without it. Without the
// key nothing of this runs and the proof is the one written before. The proof itself:
// run-item-proof.test.cjs; the review's proof rules: run-review-proof.test.cjs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');
const { proofPath, readItemProof } = require('./run-item-proof.cjs');
const { writeFile } = require('./test-write.cjs');

const LOCK = `${JSON.stringify({ flow: 'inferno', rules: { review: '2026-09-20T00:00:00.000Z' }, files: {} })}\n`;
const CONFIG = '.specs-inferno/config.yaml';
const HOST = 'delivery:\n  base_branch: main\n';
const PATHS = 'real_app:\n  paths: ["integration/**"]\n';
const ITEMS = {
  a: { editable: ['a.cjs', 'integration/a.journey.mjs', 'integration/gone.journey.mjs', 'integration/'], check: 'node -e "0"' },
};

// The host's prove command: it prints its tree and each journey it was handed, notes every run
// beside the repository, and exits with the code its argument names.
const PROVE = [
  "const fs = require('fs');",
  "const path = require('path');",
  'console.log(`tree ${process.env.INFERNO_TREE}`);',
  "const journeys = fs.readFileSync(process.env.INFERNO_JOURNEYS, 'utf8').split('\\n').filter(Boolean);",
  'for (const journey of journeys) console.log(`journey ${journey}`);',
  "fs.appendFileSync(path.join(__dirname, 'ran.txt'), `${journeys.join(' ')}\\n`);",
  'process.exit(Number(process.argv[2] || 0));',
  '',
].join('\n');

/** Item a on an intent branch whose host config is `config`, with the prove script beside the repository. */
function setup(t, config) {
  const f = fixture(t, ITEMS);
  // proofPath reads the cache from the environment, as the runner's own process does.
  const before = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = f.cache;
  t.after(() => {
    if (before === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = before;
  });
  const outside = path.dirname(f.root);
  writeFile(path.join(outside, 'prove.cjs'), PROVE);
  f.write('.specsmd/inferno/flow.lock', LOCK);
  f.write(CONFIG, config);
  f.land('.specsmd/inferno/flow.lock', CONFIG);
  const ran = path.join(outside, 'ran.txt');
  return { ...f, prove: (code = 0) => `prove: "node ${path.join(outside, 'prove.cjs')} ${code}"\n`, ran: () => (fs.existsSync(ran) ? fs.readFileSync(ran, 'utf8') : null) };
}

/** Set the host config to `body` in one commit. */
function configure(f, body) {
  f.write(CONFIG, body);
  f.land(CONFIG);
}

/** One build of item a: dispatch-log, the work, accept-dispatch, and the commit unless told not to land. */
function work(f, files, { removed = [], land = true } = {}) {
  const dispatch = f.start('--item', 'a');
  for (const [file, body] of Object.entries(files)) f.write(file, body);
  for (const file of removed) fs.rmSync(path.join(f.root, file));
  f.accepted(dispatch, [...Object.keys(files), ...removed]);
  if (land) {
    f.git('add', '-A', '--', ...Object.keys(files), ...removed);
    f.git('commit', '-qm', 'item a');
  }
}

const review = (f) => f.human('review', '--item', 'a', '--tree', f.root);
const JOURNEY = { 'a.cjs': 'module.exports = 2;\n', 'integration/a.journey.mjs': "await open('panel');\n" };

test('on a host with real_app.prove, verify-item runs it over the journeys the item changed and records the run in the proof', (t) => {
  const f = setup(t, HOST);
  configure(f, `${HOST}${PATHS}  ${f.prove(0)}`);
  work(f, { ...JOURNEY, 'integration/new.journey.mjs': "await open('list');\n" }, { removed: ['integration/gone.journey.mjs'], land: false });

  const human = f.human('verify-item', 'a', '--tree', f.root);
  assert.equal(human.code, 0, human.out);
  assert.match(human.out, /^PASS \d+s real_app\.prove node \S+prove\.cjs 0 over 2 journey files$/m);
  // The deleted journey is in the diff but no longer in the tree, so the command is never handed it.
  assert.equal(f.ran(), 'integration/a.journey.mjs integration/new.journey.mjs\n');

  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  const proof = readItemProof(f.root, 'alpha', 'a');
  assert.equal(proof.passed, true);
  assert.deepEqual(proof.diff.paths, ['a.cjs', 'integration/a.journey.mjs', 'integration/gone.journey.mjs', 'integration/new.journey.mjs']);
  const run = proof.real_app;
  assert.equal(run.command, `node ${path.join(path.dirname(f.root), 'prove.cjs')} 0`);
  assert.deepEqual(run.journeys, ['integration/a.journey.mjs', 'integration/new.journey.mjs']);
  assert.equal(run.exit, 0);
  assert.ok(Number.isFinite(run.seconds) && run.seconds >= 0);
  assert.equal(run.counts, null);
  assert.deepEqual(run.tail, [`tree ${f.root}`, 'journey integration/a.journey.mjs', 'journey integration/new.journey.mjs']);
  assert.ok(fs.existsSync(run.log), run.log);
  assert.equal(proof.commands.length, 1, 'the real-app run is its own record, beside the item checks');
});

test('a red real-app proof fails verify-item, and the proof records the failed run', (t) => {
  const f = setup(t, HOST);
  configure(f, `${HOST}${PATHS}  ${f.prove(1)}`);
  work(f, JOURNEY, { land: false });
  const human = f.human('verify-item', 'a', '--tree', f.root);
  assert.equal(human.code, 2, human.out);
  assert.match(human.out, /^FAIL \d+s real_app\.prove node \S+prove\.cjs 1 -> \S+real-app-a-\d{8}T\d{6}Z\.log$/m);
  assert.match(human.out, /^journey integration\/a\.journey\.mjs$/m, 'the last lines of the run follow the FAIL line');
  assert.match(human.out, /^ownership clean since /m, 'the item checks still ran and passed');

  const result = f.verify('a');
  assert.equal(result.code, 2, result.out);
  const proof = readItemProof(f.root, 'alpha', 'a');
  assert.equal(proof.passed, false);
  assert.equal(proof.real_app.exit, 1);
  assert.deepEqual(proof.real_app.journeys, ['integration/a.journey.mjs']);
  assert.equal(proof.commands[0].exit, 0);
});

test('an item whose diff changes no journey the tree holds runs no proof, and the proof records none', (t) => {
  const f = setup(t, HOST);
  configure(f, `${HOST}${PATHS}  ${f.prove(1)}`);
  work(f, { 'a.cjs': 'module.exports = 2;\n' }, { removed: ['integration/gone.journey.mjs'], land: false });
  const result = f.verify('a');
  assert.equal(result.code, 0, result.out);
  assert.equal(f.ran(), null, 'the command never ran');
  assert.doesNotMatch(f.human('verify-item', 'a', '--tree', f.root).out, /real_app\.prove/);
  const proof = readItemProof(f.root, 'alpha', 'a');
  assert.equal(proof.passed, true);
  assert.equal(proof.real_app, null);
});

test('without real_app.prove verify-item runs nothing more and its proof holds no real-app field', (t) => {
  const f = setup(t, `${HOST}${PATHS}`);
  work(f, JOURNEY, { land: false });
  const human = f.human('verify-item', 'a', '--tree', f.root);
  assert.equal(human.code, 0, human.out);
  assert.doesNotMatch(human.out, /real_app/);
  assert.equal(f.verify('a').code, 0);
  const proof = readItemProof(f.root, 'alpha', 'a');
  assert.equal(proof.passed, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(proof, 'real_app'), JSON.stringify(proof));
});

test('on a host with real_app.prove an item that changed a journey gets no review until its proof holds the run, so it cannot land', (t) => {
  const f = setup(t, `${HOST}${PATHS}`);
  work(f, JOURNEY, { land: false });
  // A proof the item got before the host set the key holds no run of the journeys.
  assert.equal(f.verify('a').code, 0);
  f.git('add', '--', ...Object.keys(JOURNEY));
  f.git('commit', '-qm', 'item a');
  configure(f, `${HOST}${PATHS}  ${f.prove(0)}`);
  const file = proofPath(f.root, 'alpha', 'a');

  const before = review(f);
  assert.equal(before.code, 3, before.out);
  assert.doesNotMatch(before.out, /^dispatch /m);
  assert.match(before.out, new RegExp(`^verify-item owed for a before its review: its proof ${file} holds no run of real_app\\.prove over integration/a\\.journey\\.mjs$`, 'm'));
  assert.match(before.out, new RegExp(`^then run\\.cjs verify-item a --tree ${f.root}, then run\\.cjs review --item a --tree ${f.root}$`, 'm'));
  const data = f.call('review', '--item', 'a', '--tree', f.root).data;
  assert.equal(data.owed, 'verify-item');
  assert.equal(data.proof, null);
  const integrate = f.human('integrate', '--item', 'a', '--tree', f.root);
  assert.equal(integrate.code, 3, integrate.out);
  assert.match(integrate.out, /item review owed, nothing integrated/);

  // With no proof at all the review waits the same way.
  fs.rmSync(file);
  const none = review(f);
  assert.equal(none.code, 3, none.out);
  assert.doesNotMatch(none.out, /^dispatch /m);
  assert.match(none.out, /^verify-item owed for a before its review: no proof is on record, and the item owns journeys under real_app\.paths that real_app\.prove runs before its review$/m);

  // A green run on record lets the review go out, naming the proof.
  assert.equal(f.verify('a').code, 0);
  const named = review(f);
  assert.equal(named.code, 3, named.out);
  assert.match(named.out, /^dispatch specsmd-inferno-reviewer item a$/m);
  assert.match(named.out, new RegExp(`^ {2}proof ${file}$`, 'm'));
});

test('a proof of another prove command or over other journeys holds no run of the journeys as the host now proves them', (t) => {
  const f = setup(t, HOST);
  configure(f, `${HOST}${PATHS}  ${f.prove(0)}`);
  work(f, JOURNEY);
  assert.equal(f.verify('a', '--since', 'HEAD~1').code, 0);
  assert.equal(review(f).code, 3);
  assert.match(review(f).out, /^dispatch /m);
  configure(f, `${HOST}${PATHS}  prove: "node -e 0"\n`);
  const other = review(f);
  assert.equal(other.code, 3, other.out);
  assert.doesNotMatch(other.out, /^dispatch /m);
  assert.match(other.out, /^verify-item owed for a before its review: its proof \S+ ran real_app\.prove as another command or over other journeys than its diff changes now$/m);
});

test('without real_app.prove the review of an item that changed a journey goes out as before, with or without a proof', (t) => {
  const f = setup(t, `${HOST}${PATHS}`);
  work(f, JOURNEY);
  const none = review(f);
  assert.equal(none.code, 3, none.out);
  assert.match(none.out, /^dispatch specsmd-inferno-reviewer item a$/m);
  assert.match(none.out, /^no proof for a, so its reviewer runs the item's tests itself/m);
  assert.equal(f.verify('a', '--since', 'HEAD~1').code, 0);
  const named = review(f);
  assert.match(named.out, new RegExp(`^ {2}proof ${proofPath(f.root, 'alpha', 'a')}$`, 'm'));
});

test('a real_app.prove that is no command, or that has no real_app.paths to read, is refused with the shape it needs', (t) => {
  const f = setup(t, HOST);
  work(f, JOURNEY, { land: false });
  configure(f, `${HOST}${PATHS}  prove: ["a", "b"]\n`);
  const list = f.verify('a');
  assert.equal(list.code, 2, list.out);
  assert.match(list.out, /BAD_CONFIG[\s\S]*real_app\.prove in \S+config\.yaml must be one shell command/);
  configure(f, `${HOST}real_app:\n  ${f.prove(0)}`);
  const alone = f.verify('a');
  assert.equal(alone.code, 2, alone.out);
  assert.match(alone.out, /real_app\.prove in \S+config\.yaml needs real_app\.paths/);
});
