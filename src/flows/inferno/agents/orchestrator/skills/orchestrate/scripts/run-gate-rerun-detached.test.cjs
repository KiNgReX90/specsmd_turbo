'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const { BRANCH, commit, config, detachedTree, fixture, git, passed, run, write } = require('./run-lanes-fixture.cjs');
const { writeFile } = require('./test-write.cjs');

// A rerun's cause sits beside the proof its green minted, which any tree on the same code reads, and
// it was taken as this tree's when its branch matched. Every detached tree is on HEAD, so a detached
// tree's green showed the cause of another detached tree's rerun. The cause is the tree's whose gate
// folder holds the red it ran again.

const CHECK = 'node lane.cjs check file';
// The fixture names the code file outside the tree after the `file` token.
const RERUN = /^RERUN node lane\.cjs check file \S+: red in gate-\d{8}T\d{6}Z, cause by lead: "the port was taken"$/m;

test("a detached tree's green on the code another detached tree ran again holds no cause of that rerun", (t) => {
  const f = fixture(t, config({}, [CHECK]));
  git(f.tree, 'checkout', '-q', 'main');
  write(f.tree, 'src/shared.txt', 'shared\n');
  commit(f.tree, 'shared work');
  git(f.tree, 'checkout', '-q', BRANCH);
  const a = detachedTree(f, 'A', false);
  const b = detachedTree(f, 'B', false);
  const gate = (tree, ...extra) => run(f, 'gate', '--intent', 'demo', '--tree', tree, ...extra);

  writeFile(f.code, '1');
  assert.equal(gate(b).code, 2);
  writeFile(f.code, '0');
  const rerun = gate(b, '--cause', 'the port was taken', '--by', 'lead');
  passed(rerun);
  assert.match(rerun.out, RERUN);

  const other = gate(a, '--json');
  passed(other);
  const payload = JSON.parse(other.out);
  assert.equal('rerun' in payload, false, other.out);
  assert.equal((payload.notes || []).some((line) => RERUN.test(line)), false, other.out);
  assert.ok(payload.results.every((entry) => entry.result === 'green'), 'the green proof itself is the code\'s, read by both trees');

  const own = gate(b, '--json');
  passed(own);
  assert.equal(JSON.parse(own.out).rerun.length, 1);
});
