'use strict';

// Two items of one intent that own one file, as the verify-item suites of run-sibling.cjs drive
// them through run.cjs: each builder's turn the way the orchestrator runs it, and each landing
// committed with the `Item:` trailers the test names.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { fixture } = require('./run-attribution-fixture.cjs');

const RUN = path.join(__dirname, 'run.cjs');

/** The file items a, b and d own through `docs/`; c owns only its own file. */
const SHARED = 'docs/guide.md';
const ITEMS = { a: ['docs/', 'a.cjs'], b: ['docs/', 'b.cjs'], c: ['c.cjs'], d: ['docs/', 'd.cjs'] };

/** The refusal verify-item gives for accepted bytes nothing explains, word for word. */
const REFUSED = `ERROR [DISPATCH_PROOF] accepted dispatch bytes changed at ${SHARED}: run dispatch-log before a correction ` +
  'resumes the builder, then accept-dispatch its result';

/** Commit `files` with a subject and, as its last paragraph, the trailer lines given. Returns the commit. */
function commit(f, files, ...trailers) {
  f.git('add', '--', ...files);
  f.git('commit', '-q', '-m', `land ${files.join(' ')}`, ...(trailers.length > 0 ? ['-m', trailers.join('\n')] : []));
  return f.git('rev-parse', 'HEAD');
}

/** One builder's turn of `item`: dispatch-log, the files written, accept-dispatch. Returns the dispatch id. */
function build(f, item, files) {
  const id = f.start('--item', item);
  for (const [file, body] of Object.entries(files)) f.write(file, body);
  f.accepted(id, Object.keys(files));
  return id;
}

/** Item a builds the guide and lands with its own trailer. */
function aLanded(f) {
  const dispatch = build(f, 'a', { [SHARED]: 'guide\nby a\n', 'a.cjs': 'a\n' });
  return { dispatch, landed: commit(f, [SHARED, 'a.cjs'], 'Item: a') };
}

/** a lands, then b changes the guide after a's accept and lands with `trailers`. */
function siblingChanged(t, trailers = ['Item: b'], items = ITEMS, prepare = () => {}) {
  const f = fixture(t, items);
  prepare(f);
  const { dispatch, landed } = aLanded(f);
  build(f, 'b', { [SHARED]: 'guide\nby a\nby b\n', 'b.cjs': 'b\n' });
  return { f, dispatch, landed, sibling: commit(f, [SHARED, 'b.cjs'], ...trailers) };
}

/**
 * verify-item of `item` run from the folder above the tree, so a git call that leaves the tree
 * out reads no repository at all. Returns { code, data, out } as the fixture's calls do.
 */
function verifyFrom(f, item) {
  const result = spawnSync(process.execPath, [RUN, 'verify-item', item, '--tree', f.root, '--json'], {
    cwd: path.dirname(f.root), encoding: 'utf8', env: { ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache },
  });
  let data = null;
  try { data = JSON.parse(result.stdout); } catch (error) { data = null; }
  return { code: result.status, data, out: result.stdout + result.stderr };
}

/** A verify-item result that is the DISPATCH_PROOF refusal of the guide's bytes, word for word. */
function refused(result) {
  assert.equal(result.code, 2, result.out);
  assert.ok(result.out.split('\n').includes(REFUSED), result.out);
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const short = (f, sha) => f.git('rev-parse', '--short', sha);

/** The line verify-item says of one sibling commit, as a pattern of the whole line. */
function said(f, { commit: sha, from, items = ['b'], ids = ['a'], owners = ids }) {
  const calls = owners.map((id) => `run.cjs review --item ${id} --tree ${f.root}`).join(' and ');
  return new RegExp(`^${escaped(`${SHARED}: commit ${short(f, sha)} of ${items.join(' and ')} changed it after the accepted dispatch of ` +
    `${ids.join(', ')}, so verify-item took the proof again with no new dispatch, and the review of ${owners.join(', ')} is owed for ` +
    `${short(f, from)}..${short(f, sha)}: run ${calls}`)}$`, 'm');
}

module.exports = { ITEMS, REFUSED, SHARED, aLanded, build, commit, refused, said, siblingChanged, verifyFrom };
