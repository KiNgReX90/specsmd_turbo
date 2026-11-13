'use strict';
// A host whose item checks go through a wrapper, for the `verification.run` suites of verify-item
// (run-item-check.cjs). The wrapper sits beside the tree as `../wrap.cjs`, so a check spells it
// before the tree exists: `node ../wrap.cjs auto <tree> <test>` runs the test under bash in the
// tree it was given, and `open`, `run` and `close` are its session modes, `run` on INFERNO_TEST.
// Every call logs one line to wrap.log beside it. Each `refuse-<n>` file beside it makes one run
// whose test holds the file's text refuse with the line REFUSED reads, as a wrapper with no machine
// free does, and a `close-fails` file makes the session's close fail. A session call logs its
// INFERNO_SESSION.
const fs = require('node:fs');
const path = require('node:path');

const { writeFile } = require('./test-write.cjs');

const WRAP = String.raw`'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const [mode, tree, test] = process.argv.slice(2);
const direct = mode === 'auto';
const call = { mode, tree: direct ? tree : process.env.INFERNO_TREE, test: direct ? test : process.env.INFERNO_TEST || null, session: process.env.INFERNO_SESSION || null };
fs.appendFileSync(path.join(__dirname, 'wrap.log'), JSON.stringify(call) + '\n');
if (mode === 'close' && fs.existsSync(path.join(__dirname, 'close-fails'))) process.exit(1);
if (!direct && mode !== 'run') process.exit(0);
const refusal = fs.readdirSync(__dirname).find((name) => name.startsWith('refuse-') && call.test.includes(fs.readFileSync(path.join(__dirname, name), 'utf8')));
if (refusal) { fs.rmSync(path.join(__dirname, refusal)); console.log('wrapper: no machine free'); process.exit(3); }
const run = spawnSync('bash', ['-c', call.test], { cwd: call.tree, stdio: 'inherit' });
process.exit(run.status === null ? 1 : run.status);
`;

/** The wrapper as a check or a key spells it, from the tree. */
const WRAPPER = 'node ../wrap.cjs';
/** The item's bare check, and the one line it prints. */
const CHECK = 'echo item check ran';
/** The line the wrapper prints when it ran nothing, as `verification.refused` reads it. */
const REFUSED = '^wrapper: no machine free$';

/** The attribution fixture `f` with the wrapper beside its tree. */
function hostOf(f) {
  writeFile(path.join(path.dirname(f.root), 'wrap.cjs'), WRAP);
  return f;
}

/** The calls the wrapper logged, in order. */
function wrapCalls(f) {
  const log = path.join(path.dirname(f.root), 'wrap.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
}

/** Make the next `count` runs of the wrapper refuse, of every check or only of those holding `only`. */
function refuse(f, count, only = '') {
  for (let i = 1; i <= count; i += 1) writeFile(path.join(path.dirname(f.root), `refuse-${i}`), only);
}

/**
 * A config with `verification.run` unless `run` is false, `wrapped` and `refused` when set, and
 * the wrapper's session block when `session` is true.
 */
function configOf({ run = true, wrapped = null, refused = null, session = false } = {}) {
  const verification = (run ? `  run: "${WRAPPER} auto {tree} {test}"\n` : '') +
    (wrapped ? `  wrapped: '${wrapped}'\n` : '') +
    (refused ? `  refused: '${refused}'\n` : '') +
    (session ? `  session:\n    match: '^node \\.\\./wrap\\.cjs auto '\n${['open', 'run', 'close'].map((key) => `    ${key}: "${WRAPPER} ${key}"\n`).join('')}` : '');
  return `delivery:\n  base_branch: main\n${verification ? `verification:\n${verification}` : ''}`;
}

/**
 * Leave the record of a host session in the fixture's branch cache, as a verify-item killed between
 * the session's open and close does: of `owner`, `{ pid, start }`, with the session folder `dir`.
 */
function leftSession(f, owner, dir) {
  const records = path.join(f.cache, 'specsmd-inferno', 'repo', 'intent', 'check-sessions');
  fs.mkdirSync(records, { recursive: true });
  const file = path.join(records, `20260101T000000Z-${owner.pid}.json`);
  writeFile(file, `${JSON.stringify({ ...owner, close: `${WRAPPER} close`, dir, tree: f.root })}\n`);
  return file;
}

/** The command a bare `check` runs as in `tree` through the wrapper. */
const placed = (tree, check) => `${WRAPPER} auto '${tree}' '${check}'`;

module.exports = { CHECK, REFUSED, WRAPPER, configOf, hostOf, leftSession, placed, refuse, wrapCalls };
