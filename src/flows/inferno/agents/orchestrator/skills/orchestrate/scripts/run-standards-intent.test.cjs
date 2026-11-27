'use strict';

// What an intent reads of a rule file under .specs-inferno/standards/, the project's product and
// no ledger: the tree hash a command proof and the intent review bind, the dirty files a check
// reads, the quality lens, the files a correction round and a mutant follow, and what of a fold
// the intent review binds. An intent review the released flow recorded, which hashed no rule
// file, reads as before while no rule file changed since the commit it read. The item's own
// build and review: run-standards-product.test.cjs and run-standards-review.test.cjs.

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');
const dirt = require('./run-dirt.cjs');
const { CONFIG, INTENT_TREE, git, intentReviewed, repo, run, worktree, write } = require('./review-fixture.cjs');
const { intentReviewPath, intentReviewState, parseFor, reviewCurrent, scanPath } = require('./run-intent-owed.cjs');
const { mutantRepo } = require('./run-review-mutants-fixture.cjs');
const { foldBound, ownFiles } = require('./run-intent-fold.cjs');
const { qualityLens } = require('./run-review-quality.cjs');
const span = require('./run-review-span.cjs');
const mutantRuns = require('./run-mutant-runs.cjs');
const { RULE: DEFER_RULE } = require('./state-defer-finding.cjs');

const RULE = '.specs-inferno/standards/tooling.md';
const STATE = '.specs-inferno/state.yaml';
const GATED = CONFIG.replace('delivery:', '  finalize:\n    - echo gated\ndelivery:');
const outside = (globs) => GATED.replace('  model: model-review\n', `  model: model-review\n  outside: ${globs}\n`);

function commit(tree, files, message) {
  for (const [rel, body] of Object.entries(files)) write(tree, rel, body);
  git(tree, ['add', '-A']);
  git(tree, ['commit', '-qm', message]);
}

/** The intent worktree, its own change to the code and to the rule file committed. */
function built(config = GATED) {
  const fixture = repo({ config, files: { [RULE]: '# Tooling\n' } });
  const tree = worktree(fixture, INTENT_TREE);
  commit(tree, { 'src/a.ts': 'export const a = 3;\n', [RULE]: '# Tooling\n\nSearch by syntax.\n' }, 'the work');
  return { fixture, tree };
}

const review = (tree) => parseFor(tree, intentReviewPath(tree, 'alpha'), 'alpha', true);
const current = (tree) => reviewCurrent(tree, lib.readConfig(tree), review(tree));

test('the tree hash reads a rule file and never the ledger beside it', () => {
  const { tree } = built();
  const before = proofs.scopeHash(tree);
  write(tree, STATE, `${fs.readFileSync(path.join(tree, STATE), 'utf8')}# a ledger note\n`);
  assert.equal(proofs.scopeHash(tree), before, 'a ledger edit leaves every command proof standing');
  write(tree, RULE, '# Tooling\n\nSearch by text.\n');
  assert.notEqual(proofs.scopeHash(tree), before, 'a rule file edit voids a command proof over the whole tree');
  assert.equal(dirt.reads(null, RULE), true);
  assert.equal(dirt.reads(null, STATE), false);
});

test('a rule file edit after the intent review owes it again, and a ledger commit does not', () => {
  const { fixture, tree } = built();
  intentReviewed(tree);
  commit(tree, { '.specs-inferno/intents/alpha/after-release.md': 'a deferred finding\n' }, 'ledger');
  assert.equal(current(tree), true);
  commit(tree, { [RULE]: '# Tooling\n\nSearch by text.\n' }, 'the rule file changed');
  assert.equal(current(tree), false);
  const green = run(fixture, ['green', '--tree', tree]);
  assert.equal(green.code, 3, green.out + green.err);
  assert.match(green.out + green.err, /intent review owed: the code changed since the review/);
});

/** The intent review as the released flow recorded it: hashes that read no rule file. */
function releasedReview(tree, hashes) {
  const rel = intentReviewPath(tree, 'alpha');
  const scan = scanPath(tree, 'alpha');
  write(tree, scan, 'lines: []\n');
  const kept = hashes.outside ? `tree_outside: ${hashes.outside}\n` : '';
  write(tree, rel, `verdict: clean\ntree: ${hashes.tree}\n${kept}commit: ${hashes.commit || git(tree, ['rev-parse', 'HEAD'])}\n`);
  git(tree, ['add', '--', rel, scan]);
  git(tree, ['commit', '-qm', 'intent review alpha', '--', rel, scan]);
}

const released = (file) => file === '.specs-inferno' || file.startsWith('.specs-inferno/');

test('an intent review the released flow recorded holds while no rule file changed since the commit it read', () => {
  const { fixture, tree } = built();
  releasedReview(tree, { tree: proofs.scopeHash(tree, null, { skip: released }) });
  assert.equal(current(tree), true);
  const green = run(fixture, ['green', '--tree', tree, '--json']);
  assert.ok(!(JSON.parse(green.out).owed || []).includes('review'), green.out);
  commit(tree, { [RULE]: '# Tooling\n\nSearch by text.\n' }, 'the rule file changed');
  assert.equal(current(tree), false);

  const gone = built();
  releasedReview(gone.tree, { tree: proofs.scopeHash(gone.tree, null, { skip: released }), commit: '0'.repeat(40) });
  assert.equal(current(gone.tree), false, 'a commit history no longer holds tells no rule file stayed as it read it');
});

test('a released intent review the runner refuses now goes back to its reviewer on an unmoved tree, as before', () => {
  const fixture = mutantRepo({ files: { [RULE]: '# Tooling\n' } });
  const tree = worktree(fixture, INTENT_TREE);
  releasedReview(tree, { tree: proofs.scopeHash(tree, null, { skip: released }) });
  const state = intentReviewState(tree, lib.readConfig(tree), 'alpha');
  assert.equal(state.refused, true, state.owed.join('\n'));
  assert.match(state.owed.join('\n'), /a-one owes a caught mutant or a checked pin/);
});

test('under review.outside a released tree_outside holds after a fold while no rule file changed since', () => {
  const { fixture, tree } = built(outside('["**"]'));
  const own = ownFiles(tree, 'main');
  const named = [...own].filter((file) => !released(file)).sort();
  const hash = proofs.scopeHash(tree, null, { skip: (file) => released(file) || !own.has(file) });
  const kept = createHash('sha256').update(JSON.stringify([hash, named])).digest('hex');
  releasedReview(tree, { tree: proofs.scopeHash(tree, null, { skip: released }), outside: kept });
  commit(fixture.root, { 'docs/added.md': 'a page\n' }, 'main moved');
  git(tree, ['merge', '-q', '--no-edit', 'main']);
  assert.notEqual(review(tree).tree, proofs.scopeHash(tree, null, { skip: released }), 'the fold moved the tree');
  assert.equal(current(tree), true);
  commit(tree, { [RULE]: '# Tooling\n\nSearch by text.\n' }, 'the rule file changed');
  assert.equal(current(tree), false);
});

test('a fold that changes a rule file is bound by the intent review, and its ledger is not', () => {
  const { fixture, tree } = built(outside('["docs/**"]'));
  const before = git(tree, ['rev-parse', 'HEAD']);
  commit(fixture.root, { '.specs-inferno/standards/naming.md': '# Naming\n', 'docs/added.md': 'a page\n',
    '.specs-inferno/intents/other/brief.md': '# Intent: Other\n' }, 'main moved');
  git(tree, ['merge', '-q', '--no-edit', 'main']);
  assert.deepEqual(foldBound(tree, lib.readConfig(tree), before, 'main').bound, ['.specs-inferno/standards/naming.md']);
});

test('a rule file with code in it gets the quality lens, and a ledger file never does', () => {
  assert.equal(qualityLens('behavior', ['.specs-inferno/standards/no-raw-sql.cjs']), true);
  assert.equal(qualityLens('behavior', ['.specs-inferno/intents/alpha/hook.cjs']), false);
});

test('a correction round and a moved mutant follow a rule file the item owns, and never the ledger', () => {
  const fixture = repo({ files: { [RULE]: '# Tooling\n' } });
  const rel = '.specs-inferno/intents/alpha/reviews/a-one.yaml';
  commit(fixture.root, { [rel]: 'item: a-one\n' }, 'the first review');
  const from = git(fixture.root, ['rev-parse', 'HEAD']);
  commit(fixture.root, { [RULE]: '# Tooling\n\nSearch by syntax.\n', '.specs-inferno/config.yaml': `${CONFIG}# a host note\n` }, 'the fix');
  const owned = [RULE, '.specs-inferno/config.yaml'];
  assert.deepEqual(span.changedSince(fixture.root, { editable: owned }, from, []), [RULE]);
  assert.deepEqual(mutantRuns.changedSince(fixture.root, rel, owned), [RULE]);
});

test('a commit that changes only the defer rule moves no tree hash: the intent review and a command proof stay current', () => {
  const { fixture, tree } = built();
  commit(tree, { [DEFER_RULE]: 'survivors: true\n' }, "the user's defer rule");
  intentReviewed(tree);
  const config = lib.readConfig(tree);
  const proof = proofs.commandProof(tree, config, null, 'echo gated');
  commit(tree, { [DEFER_RULE]: 'survivors: true\nseverities: [minor, major]\n' }, 'the defer rule changed');
  assert.equal(proofs.commandProof(tree, config, null, 'echo gated').file, proof.file);
  assert.equal(current(tree), true);
  assert.equal(dirt.reads(null, DEFER_RULE), false);
  const green = run(fixture, ['green', '--tree', tree, '--json']);
  assert.ok(!(JSON.parse(green.out).owed || []).includes('review'), green.out);

  commit(tree, { [RULE]: '# Tooling\n\nSearch by text.\n' }, 'the rule file beside it changed');
  assert.notEqual(proofs.commandProof(tree, config, null, 'echo gated').file, proof.file);
  assert.equal(current(tree), false);
});

test('a released intent review still holds after a commit that changes only the defer rule', () => {
  const { tree } = built();
  commit(tree, { [DEFER_RULE]: 'survivors: true\n' }, "the user's defer rule");
  releasedReview(tree, { tree: proofs.scopeHash(tree, null, { skip: released }) });
  commit(tree, { [DEFER_RULE]: 'survivors: false\n' }, 'the defer rule changed');
  assert.equal(current(tree), true);
});
