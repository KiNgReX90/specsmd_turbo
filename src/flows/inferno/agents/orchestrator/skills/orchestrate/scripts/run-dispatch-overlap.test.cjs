'use strict';

// dispatch-log's door: a dispatch whose frozen ownership overlaps an open record of another
// lineage is refused before anything is written, with the calls that lead on. The attempt before
// it in its own lineage, an oracle ask and the dispatch that joins two chains pass. A correction
// named for one item of a chain says each item it took in.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { fixture, printedCalls } = require('./run-attribution-fixture.cjs');

const SHARING = { a: ['shared.cjs', 'a.cjs'], b: ['shared.cjs', 'b.cjs'] };
const SELECTOR = ['--tier', 'strong', '--agent', 'builder'];

const log = (f, ...selector) => f.call('dispatch-log', 'alpha', ...selector, ...SELECTOR, '--tree', f.root);

/** A dispatch-log refused beside the open dispatch `open` for `theirs`, as its first words name it. */
function refusedBeside(result, items, open, theirs) {
  assert.equal(result.code, 2, result.out);
  assert.match(result.out, new RegExp(`dispatch-log ${items}: dispatch ${open} for ${theirs} is still open and owns `), result.out);
}

test('a correction while its own earlier dispatch is open is logged, and one named for an item of a chain says each item it took in', (t) => {
  const f = fixture(t, SHARING);
  const chain = log(f, '--items', 'a,b');
  assert.equal(chain.code, 0, chain.out);
  assert.deepEqual(chain.data.taken_in, []);
  const named = log(f, '--item', 'b');
  assert.equal(named.code, 0, named.out);
  assert.deepEqual(named.data.taken_in, [{ item: 'a', dispatch_id: chain.data.dispatch_id }]);
  const told = f.human('dispatch-log', 'alpha', '--item', 'b', ...SELECTOR, '--tree', f.root);
  assert.equal(told.code, 0, told.out);
  const lines = told.out.split('\n');
  assert.match(lines[0], /^logged b, a -> \S+alpha\.log$/);
  assert.equal(lines[1], `took in a: its current dispatch ${named.data.dispatch_id} covers it, so this dispatch owns its files too`);
  const whole = f.human('dispatch-log', 'alpha', '--items', 'a,b', ...SELECTOR, '--tree', f.root);
  assert.equal(whole.code, 0, whole.out);
  assert.doesNotMatch(whole.out, /took in/);
});

test('a dispatch abandoned open, or one of an item completed without its accept, refuses an overlap until the accept it prints closes it', (t) => {
  for (const status of ['pending', 'completed\n        completed_at: 2026-01-01T00:00:00Z\n        integrated_sha: abc1234']) {
    const f = fixture(t, SHARING);
    const old = f.start('--item', 'a');
    const ledger = path.join(f.root, '.specs-inferno/state.yaml');
    f.write('.specs-inferno/state.yaml', fs.readFileSync(ledger, 'utf8').replace('- id: a\n        status: pending', `- id: a\n        status: ${status}`));
    const refused = log(f, '--item', 'b');
    refusedBeside(refused, 'b', old, 'a');
    const [accept] = printedCalls(refused.out);
    const closed = f.asPrinted(accept.replace('<changed_files as JSON>', '[]'));
    assert.equal(closed.code, 0, closed.out);
    const two = f.start('--item', 'b');
    f.write('shared.cjs', 'b\n');
    f.accepted(two, ['shared.cjs']);
    const result = f.verify('b');
    assert.equal(result.code, 0, `${status}: ${result.out}`);
  }
});

test('an open dispatch of another intent in the same tree refuses an overlap with the accept alone, since a chain spans one intent', (t) => {
  const f = fixture(t, SHARING);
  const state = fs.readFileSync(path.join(f.root, '.specs-inferno/state.yaml'), 'utf8');
  f.write('.specs-inferno/state.yaml', `${state}  - id: beta\n    status: pending\n    work_items:\n      - id: c\n        status: pending\n`);
  f.write('.specs-inferno/intents/beta/work-items/c.md', '---\nid: c\nintent: beta\n---\n\n## Execution Manifest\n\nownership:\n  editable:\n    - shared.cjs\n');
  f.land('.specs-inferno');
  const one = f.start('--item', 'a');
  const refused = f.call('dispatch-log', 'beta', '--item', 'c', ...SELECTOR, '--tree', f.root);
  refusedBeside(refused, 'c', one, 'a');
  assert.deepEqual(printedCalls(refused.out), [`accept-dispatch ${one} --changed-paths '<changed_files as JSON>' --tree ${f.root}`]);
});

test('the dispatch that joins two chains passes the door while one of them is still open, and supersedes that one', (t) => {
  const f = fixture(t, SHARING);
  for (const item of ['a', 'b']) {
    const id = f.start('--item', item);
    f.write('shared.cjs', `by ${item}\n`);
    f.accepted(id, ['shared.cjs']);
  }
  const fix = f.start('--item', 'b');
  const waiting = f.verify('a');
  assert.equal(waiting.code, 2, waiting.out);
  assert.match(waiting.out, new RegExp(`dispatch ${fix} for b is still open: run accept-dispatch`));
  const joined = log(f, '--items', 'a,b');
  assert.equal(joined.code, 0, joined.out);
  const late = f.accept(fix, []);
  assert.equal(late.code, 2, late.out);
  assert.match(late.out, /superseded/);
});

test('an oracle ask beside an open dispatch that owns the item\'s files takes no baseline and is never refused', (t) => {
  const f = fixture(t, SHARING);
  f.start('--item', 'a');
  const grade = (line) => `low: ${line}`;
  const asked = f.call('dispatch-log', 'alpha', '--tier', 'oracle', '--item', 'b', '--impact', grade('only the private helper b.cjs reads the value'),
    '--complexity', grade('one reading survives the measurement in b.cjs'), '--tree', f.root);
  assert.equal(asked.code, 0, asked.out);
});

/** Every file the fixture's cache holds, but the stat index and the owner stamp each step writes before it runs. */
function cacheFiles(f) {
  const files = {};
  for (const name of fs.readdirSync(f.cache, { recursive: true })) {
    const file = path.join(f.cache, name);
    if (fs.statSync(file).isFile() && !['index.json', 'owner.json'].includes(path.basename(file))) files[name] = fs.readFileSync(file).toString('base64');
  }
  return files;
}

test('a refused dispatch-log leaves the cache as it found it: no record, no log line, no baseline', (t) => {
  const f = fixture(t, SHARING);
  f.start('--item', 'a');
  const before = cacheFiles(f);
  assert.equal(log(f, '--item', 'b').code, 2);
  assert.deepEqual(cacheFiles(f), before);
});

test('the refusal names the shared path as each ownership entry names it, and leads the chain with the dispatch whose first baseline came first', (t) => {
  const f = fixture(t, { a: ['lib/'], b: ['lib/b.cjs', 'b.cjs'], c: ['c.cjs', 'x.cjs'], d: ['x.cjs'] });
  const folder = f.start('--item', 'a');
  const named = log(f, '--item', 'b');
  refusedBeside(named, 'b', folder, 'a');
  assert.match(named.out, /owns lib\/, which this dispatch owns as lib\/b\.cjs, /);
  const first = f.start('--item', 'c');
  f.write('x.cjs', 'by c\n');
  f.accepted(first, ['x.cjs']);
  const later = f.start('--item', 'd');
  const correction = log(f, '--item', 'c');
  refusedBeside(correction, 'c', later, 'd');
  assert.equal(printedCalls(correction.out)[1], `dispatch-log alpha --items c,d --tier <tier> --agent <agent> --tree ${f.root}`);
});

test('the door reads the frozen ownership with its grants, of the open dispatch and of the correction that inherits one', (t) => {
  const f = fixture(t, { a: ['a.cjs'], b: ['b.cjs', 'other.cjs'] });
  const one = f.start('--item', 'a');
  assert.equal(f.call('grant', one, '--path', 'other.cjs', '--tree', f.root).code, 0);
  const beside = log(f, '--item', 'b');
  refusedBeside(beside, 'b', one, 'a');
  assert.match(beside.out, /owns other\.cjs too/);
  f.accepted(one, []);
  const two = f.start('--item', 'b');
  const correction = log(f, '--item', 'a');
  refusedBeside(correction, 'a', two, 'b');
  assert.match(correction.out, /owns other\.cjs too/);
});
