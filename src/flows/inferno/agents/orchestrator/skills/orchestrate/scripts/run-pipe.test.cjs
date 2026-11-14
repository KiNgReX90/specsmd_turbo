'use strict';

// An answer longer than a pipe takes at once (64 KiB on Linux) reaches a reader that pipes it
// whole: run.cjs exits once its last write has left the process (run-exit.cjs), in text and in
// --json, with the exit code the command meant. And a review dispatch keeps its brief short: past
// forty paths the range line gives the count, and a paths-file line names the list it wrote
// outside the tree, in the run's cache.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { fixture } = require('./run-attribution-fixture.cjs');
const { PIPE, piped: pipedIn } = require('./test-pipe.cjs');

const RUN = path.join(__dirname, 'run.cjs');
const LOCK = `${JSON.stringify({ flow: 'inferno', rules: { review: '2026-09-20T00:00:00.000Z' }, files: {} })}\n`;

/** Item a owning `editable`, on an intent branch whose flow lock carries the review rule. */
function setup(t, editable, check = 'node -e "0"') {
  const f = fixture(t, { a: { editable, check } });
  f.write('.specsmd/inferno/flow.lock', LOCK);
  f.land('.specsmd/inferno/flow.lock');
  return f;
}

const ENV = (f) => ({ ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache });
const piped = (f, ...args) => pipedIn(f.root, ENV(f), RUN, args);

/** Where the runner of fixture `f` keeps its notes: the run's cache, outside the tree. */
const cached = (f, ...parts) => path.join(f.cache, 'specsmd-inferno', 'repo', ...parts);
const lastLine = (text) => text.replace(/\n$/, '').split('\n').pop();
const lineOf = (text, prefix, from = 0) => text.split('\n').slice(from).find((line) => line.startsWith(prefix));

/** One build of item a: dispatch-log, the files, accept-dispatch, a green verify-item, the commit. */
function build(f, files) {
  const dispatch = f.start('--item', 'a');
  for (const file of files) f.write(file, 'module.exports = 2;\n');
  f.accepted(dispatch, files);
  const verified = f.verify('a');
  assert.equal(verified.code, 0, verified.out);
  f.land(...files);
}

// Six folders of 240 characters and a file name of about 200: forty such paths pass 64 KiB.
const DEEP = Array.from({ length: 6 }, (_, at) => `${at}${'d'.repeat(239)}`).join('/');
const deepFiles = (count) => Array.from({ length: count }, (_, at) => `${DEEP}/${'f'.repeat(200)}-${String(at).padStart(2, '0')}.cjs`);

test('a review dispatch over 64 KiB read through a pipe arrives whole, ending on its then line, in text and in --json', (t) => {
  const f = setup(t, [`${DEEP}/`]);
  // Forty paths is the most a range line lists itself, so both lenses print every one inline.
  const files = deepFiles(40);
  build(f, files);

  const text = piped(f, 'review', '--item', 'a', '--tree', f.root);
  assert.equal(text.code, 3, text.stderr);
  assert.ok(Buffer.byteLength(text.stdout) > PIPE, `${Buffer.byteLength(text.stdout)} bytes`);
  assert.match(lastLine(text.stdout), /^then run\.cjs review --item a /);
  const contract = text.stdout.split('\n').indexOf('dispatch specsmd-inferno-reviewer item a');
  assert.ok(contract >= 0, text.stdout);
  assert.equal(lineOf(text.stdout, '  range ', contract).split(' paths ')[1], files.join(' '));
  assert.doesNotMatch(text.stdout, /paths-file/);

  const json = piped(f, 'review', '--item', 'a', '--tree', f.root, '--json');
  assert.equal(json.code, 3, json.stderr);
  assert.ok(Buffer.byteLength(json.stdout) > PIPE);
  const data = JSON.parse(json.stdout);
  assert.deepEqual(data.paths, files);
  assert.equal(data.paths_file, null);
  assert.deepEqual(data.quality.paths, files);
  assert.equal(data.quality.paths_file, null);
});

test('a verify-item answer over 64 KiB read through a pipe arrives whole with its exit code, 0 and 2, in text and in --json', (t) => {
  const filler = 'x'.repeat(PIPE + 1024);
  for (const [check, code] of [[`true ${filler}`, 0], [`false ${filler}`, 2]]) {
    const f = setup(t, ['a.cjs'], check);
    const proof = cached(f, 'item-proofs', 'alpha', 'a.json');
    const text = piped(f, 'verify-item', 'a', '--since', 'HEAD', '--tree', f.root);
    assert.equal(text.code, code, `${check.slice(0, 5)}: ${text.stderr}`);
    assert.ok(Buffer.byteLength(text.stdout) > PIPE);
    assert.ok(text.stdout.includes(check), check.slice(0, 5));
    assert.equal(lastLine(text.stdout), `proof ${proof}`);
    const json = piped(f, 'verify-item', 'a', '--since', 'HEAD', '--tree', f.root, '--json');
    assert.equal(json.code, code, check.slice(0, 5));
    assert.equal(JSON.parse(json.stdout).checks[0].command, check);
  }
});

test('a refusal over 64 KiB read through a pipe reaches stderr whole, with its exit code', (t) => {
  const f = setup(t, ['a.cjs']);
  const option = `--${'o'.repeat(PIPE + 1024)}`;
  const result = piped(f, 'verify-item', 'a', option);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, `ERROR [BAD_ARGS] missing value for ${option}\n`);
});

test('a reader that goes away early leaves the exit code as the command meant it', (t) => {
  const f = setup(t, ['a.cjs'], `false ${'x'.repeat(PIPE + 1024)}`);
  const result = spawnSync('bash', ['-c', `"$0" "$1" verify-item a --since HEAD --tree "$2" | head -c 1 >/dev/null; echo "\${PIPESTATUS[0]}"`,
    process.execPath, RUN, f.root], { cwd: f.root, encoding: 'utf8', env: ENV(f) });
  assert.equal(result.stdout.trim(), '2', result.stderr);
});

test('past forty paths a lens dispatch prints the count and a paths-file outside the tree that lists every path', (t) => {
  const f = setup(t, ['src/']);
  const files = Array.from({ length: 41 }, (_, at) => `src/part-${String(at).padStart(2, '0')}.cjs`);
  build(f, files);

  const text = piped(f, 'review', '--item', 'a', '--tree', f.root);
  assert.equal(text.code, 3, text.stderr);
  const lines = text.stdout.split('\n');
  const file = (lens) => cached(f, 'review-paths', 'alpha', 'a', `${lens}.txt`);
  for (const [lens, dispatch] of [['contract', 'dispatch specsmd-inferno-reviewer item a'], ['quality', 'dispatch specsmd-inferno-reviewer-quality item a']]) {
    const at = lines.indexOf(dispatch);
    assert.ok(at >= 0, text.stdout);
    assert.match(lines[at + 1], /^ {2}range \w+\.\.\w+ paths 41, one per line in the paths-file below$/);
    assert.equal(lines[at + 2], `  paths-file ${file(lens)}`);
    assert.equal(fs.readFileSync(file(lens), 'utf8'), `${files.join('\n')}\n`);
    assert.ok(path.relative(f.root, file(lens)).startsWith(`..${path.sep}`), file(lens));
  }
  assert.doesNotMatch(text.stdout, /src\/part-00\.cjs/);

  const data = JSON.parse(piped(f, 'review', '--item', 'a', '--tree', f.root, '--json').stdout);
  assert.deepEqual(data.paths, files);
  assert.equal(data.paths_file, file('contract'));
  assert.deepEqual(data.quality.paths, files);
  assert.equal(data.quality.paths_file, file('quality'));
});
