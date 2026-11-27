'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { tempDir } = require('./test-temp.cjs');
const { commandName, repeats, rerunLine } = require('./run-lanes-intermittent.cjs');

// A rerun's cause is counted and written under its command's name: the rest after
// `verification.session.match` where the match reaches the command, as a gate mark names it, else the
// command as written, and the gate tree's path as `{tree}` either way. A host whose wrapper takes the
// tree as an argument spells one check differently in every tree; its name is one.

const MATCH = '^tools/remote\\.sh auto \\S+ ';
const SESSION = { verification: { session: { match: MATCH, open: 'echo open', run: 'echo run', close: 'echo close' } } };
const BARE = 'npm run test:definitions';
const wrapped = (tree, command = BARE) => `tools/remote.sh auto ${tree} ${command}`;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A real directory to stand for the gate tree, since a name resolves the tree's path. */
function treeDir(t) {
  const dir = tempDir('inferno-rerun-name-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Signs a regex reads as its own, so a path read as a pattern names no tree.
  const tree = path.join(dir, 'gate.tree+1');
  fs.mkdirSync(tree);
  return { dir, tree };
}

test('a command the session match reaches is named by its rest, as a gate mark names it, and never by nothing', (t) => {
  const { tree } = treeDir(t);
  assert.equal(commandName(SESSION, wrapped(tree), tree), BARE);
  assert.equal(commandName(SESSION, wrapped('/trees/other-gate'), tree), BARE);
  // The match leaves a space before the rest: the name is the rest a fix line can carry.
  const loose = { verification: { session: { ...SESSION.verification.session, match: '^tools/remote\\.sh auto \\S+' } } };
  assert.equal(commandName(loose, wrapped(tree), tree), BARE);
  // A match that reaches the whole command, or all of it but spaces, leaves no name: the command as written stands.
  const whole = { verification: { session: { ...SESSION.verification.session, match: '^tools/remote\\.sh auto \\S+ npm run \\S+' } } };
  assert.equal(commandName(whole, wrapped('/trees/other-gate'), tree), wrapped('/trees/other-gate'));
  assert.equal(commandName(whole, `${wrapped('/trees/other-gate')}  `, tree), `${wrapped('/trees/other-gate')}  `);
  // A match that reaches it later than its start reaches nothing, and so does a config with no session.
  assert.equal(commandName(SESSION, `env A=1 ${wrapped('/trees/other-gate')}`, tree), `env A=1 ${wrapped('/trees/other-gate')}`);
  assert.equal(commandName({}, wrapped('/trees/other-gate'), tree), wrapped('/trees/other-gate'));
  assert.equal(commandName({ verification: {} }, BARE, tree), BARE);
});

test("the gate tree's path is written {tree} wherever it stands whole, and a look-alike stays as written", (t) => {
  const { tree } = treeDir(t);
  assert.equal(commandName({}, wrapped(tree), tree), 'tools/remote.sh auto {tree} npm run test:definitions');
  assert.equal(commandName({}, `node ${tree}/run.cjs --out ${tree}/ --root=${tree}`, tree), 'node {tree}/run.cjs --out {tree}/ --root={tree}');
  assert.equal(commandName({}, `${tree}/run.sh "${tree}" '${tree}/x'`, tree), `{tree}/run.sh "{tree}" '{tree}/x'`);
  for (const edge of [' ', '\t', '"', "'", '`', '=', ':', ';', ',', '&', '|', '(', ')', '<', '>']) {
    assert.equal(commandName({}, `run${edge}${tree}${edge}x`, tree), `run${edge}{tree}${edge}x`, JSON.stringify(edge));
  }
  for (const like of [`${tree}2`, `${tree}.old/run.sh`, `${tree}-b`, `${tree}_c`, `/x${tree}`, `~${tree}`, `a${tree}`, `${path.dirname(tree)}/gate`]) {
    assert.equal(commandName({}, `node ${like} && echo done`, tree), `node ${like} && echo done`, like);
  }
  // A rest the match leaves names the tree the same way, so it is one name across trees too.
  assert.equal(commandName(SESSION, wrapped(tree, `npm test -- --dir ${tree}/web`), tree), 'npm test -- --dir {tree}/web');
  assert.equal(commandName({}, BARE, tree), BARE);
});

test('a gate tree named through a link is written {tree} by its link and by the path it resolves to', (t) => {
  const { dir, tree } = treeDir(t);
  const link = path.join(dir, 'linked-tree');
  fs.symlinkSync(tree, link);
  assert.equal(commandName({}, `node ${tree}/run.cjs ${link}/x`, link), 'node {tree}/run.cjs {tree}/x');
  assert.equal(commandName(SESSION, wrapped(link, `node ${tree}/run.cjs`), link), 'node {tree}/run.cjs');
});

/** A repository whose main carries one commit per message in `bodies`, and the gate tree beside it. */
function ledger(t, bodies) {
  const { dir, tree } = treeDir(t);
  const root = path.join(dir, 'app');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  const shas = bodies.map((body) => {
    git(root, 'commit', '-q', '--allow-empty', '-m', 'a landing', '-m', body);
    return git(root, 'rev-parse', '--short', 'HEAD');
  });
  return { root, tree, shas };
}

const cause = (command, by, tests = [command]) =>
  rerunLine({ command, tests, cause: `a race ${by} saw`, by, run: 'gate-20260101T000000Z', log: 'rerun-evidence/a/0.log' });

test('a line the build before names wrote with the whole wrapped command counts toward the limit of its name, and a fix line of either lifts it', (t) => {
  const { root, tree, shas } = ledger(t, [cause(wrapped('/trees/gate-a'), 'lead'), cause(BARE, 'release-lead')]);
  const name = (test) => commandName(SESSION, test, tree);
  assert.throws(() => repeats(root, 'main', [BARE], 'run the gate again with its cause', name), (error) => {
    assert.equal(error.code, 'INTERMITTENT_LIMIT');
    assert.match(error.message, new RegExp(`^refused: ${BARE} was accepted as intermittent 2 times on main since a commit there last named its fix: ` +
      `${shas[0]} \\S+ by lead, ${shas[1]} \\S+ by release-lead\\.`));
    assert.ok(error.message.endsWith(`land the fix on main with the line "Fixes-intermittent: ${BARE}" in its message, then run the gate again with its cause.`), error.message);
    return true;
  });
  // Without the session the config cannot tell the whole command's name, so that line stays as written.
  const plain = repeats(root, 'main', [BARE], 'again', (test) => commandName({}, test, tree));
  assert.deepEqual(plain.map((line) => line.replace(/ \d{4}-\d\d-\d\d /, ' <date> ')), [`earlier intermittent accept of ${BARE}: ${shas[1]} <date> by release-lead: a race release-lead saw`]);

  // A fix line written with the whole command of yet another tree names the same check.
  const fixed = ledger(t, [cause(wrapped('/trees/gate-a'), 'lead'), cause(BARE, 'release-lead'), `Fixes-intermittent: ${wrapped('/trees/gate-c')}`]);
  assert.deepEqual(repeats(fixed.root, 'main', [BARE], 'again', (test) => commandName(SESSION, test, fixed.tree)), []);
});

test('a lane test is counted as written, and a line of the released flow whose tests are no names reads without error', (t) => {
  const { root, tree } = ledger(t, []);
  // A lane test that holds the tree's path: the naming would change it, and the lane's own lines still count it as written.
  const lane = `${tree}/tests/checkout.test.mjs > redeems a card`;
  const accept = (by) => `exception: smoke intermittent ${JSON.stringify({ tests: [lane], reason: 'a lane race', by, run: 'r', log: 'lane.log' })}`;
  const odd = `exception: smoke intermittent ${JSON.stringify({ tests: [null, 7, { name: lane }], reason: 'by hand', by: 'lead' })}`;
  for (const body of [odd, accept('lead'), accept('release-lead')]) git(root, 'commit', '-q', '--allow-empty', '-m', 'a landing', '-m', body);
  const name = (test) => commandName(SESSION, test, tree);
  assert.throws(() => repeats(root, 'main', [lane], 'accept again', name), /accepted as intermittent 2 times on main .* by lead, .* by release-lead/s);
  assert.deepEqual(repeats(root, 'main', [BARE], 'accept again', name), []);
});
