const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, INTENT_TREE, git, intentReviewed, repo, run, worktree, write } = require("./review-fixture.cjs");
const lib = require("./run-lib.cjs");
const proofs = require("./run-proofs.cjs");
const { intentReviewPath, parseFor, reviewCurrent } = require("./run-intent-owed.cjs");

// Under review.outside, once a fold leaves the intent review holding by tree_outside alone, a new
// path under .specs-inferno/ keeps it current: an external criterion's evidence file, a deferred
// finding's file, the archive's move of the intent folder. A change to the intent's code still owes it.

const GATED = CONFIG.replace("delivery:", "  finalize:\n    - echo gated\ndelivery:");
const outside = (globs) => GATED.replace("  model: model-review\n", `  model: model-review\n  outside: ${globs}\n`);
const CASES = [
  { name: '["**"]', config: outside('["**"]'), fold: { "src/b.ts": "export const b = 5;\n", "docs/added.md": "a page\n" } },
  { name: '["docs/**"]', config: outside('["docs/**"]'), fold: { "docs/added.md": "a page\n" } },
];
const INTENT = ".specs-inferno/intents/alpha";

/** A clean intent review, then a fold of the base that leaves it holding by tree_outside alone. */
function folded({ config, fold }) {
  const fixture = repo({ config });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  git(tree, ["commit", "-qam", "the work"]);
  intentReviewed(tree, "alpha", "verdict: clean\n", lib.readConfig(tree));
  for (const [rel, body] of Object.entries(fold)) write(fixture.root, rel, body);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "main moved"]);
  const gated = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gated.code, 0, gated.out + gated.err);
  assert.match(gated.out, /folded main into/);
  assert.notEqual(review(tree).tree, proofs.scopeHash(tree), "the review no longer holds by its tree hash");
  assert.equal(current(tree), true);
  return { fixture, tree };
}

function review(tree) {
  return parseFor(tree, intentReviewPath(tree, "alpha"), "alpha", true);
}

const current = (tree) => reviewCurrent(tree, lib.readConfig(tree), review(tree));

function committed(tree, files, message) {
  for (const [rel, body] of Object.entries(files)) write(tree, rel, body);
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", message]);
}

function greenOwes(fixture, tree) {
  const result = run(fixture, ["green", "--tree", tree, "--json"]);
  return { result, owed: JSON.parse(result.out).owed || [] };
}

for (const entry of CASES) {
  test(`with review.outside ${entry.name} an evidence file committed after the fold keeps the review, and green owes none`, () => {
    const { fixture, tree } = folded(entry);
    committed(tree, { [`${INTENT}/evidence/checkout.md`]: "the gift card checkout, seen working\n" }, "evidence");
    assert.equal(current(tree), true);
    const { result, owed } = greenOwes(fixture, tree);
    assert.equal(result.code, 0, result.out + result.err);
    assert.ok(!owed.includes("review"), result.out);
  });

  test(`with review.outside ${entry.name} a code change committed after the fold owes the review as before`, () => {
    const { fixture, tree } = folded(entry);
    committed(tree, { "src/a.ts": "export const a = 4;\n" }, "own change, to a file the review already names");
    assert.equal(current(tree), false);
    const { result, owed } = greenOwes(fixture, tree);
    assert.equal(result.code, 3, result.out + result.err);
    assert.ok(owed.includes("review"), result.out);
    const said = run(fixture, ["green", "--tree", tree]);
    assert.match(said.out + said.err, /intent review owed: the code changed since the review/);
  });

  test(`with review.outside ${entry.name} a deferred finding's file written after the fold keeps the review`, () => {
    const { fixture, tree } = folded(entry);
    committed(tree, { [`${INTENT}/after-release.md`]: "src/a.ts:1 rounds the gift card balance down\n" }, "deferred finding");
    assert.equal(current(tree), true);
    const { result, owed } = greenOwes(fixture, tree);
    assert.equal(result.code, 0, result.out + result.err);
    assert.ok(!owed.includes("review"), result.out);
  });

  test(`with review.outside ${entry.name} the archive's move of the intent folder after the fold keeps the review`, () => {
    const { fixture, tree } = folded(entry);
    fs.mkdirSync(path.join(tree, ".specs-inferno/archive/intents"), { recursive: true });
    git(tree, ["mv", INTENT, ".specs-inferno/archive/intents/alpha"]);
    git(tree, ["commit", "-qm", "archive alpha"]);
    assert.equal(intentReviewPath(tree, "alpha"), ".specs-inferno/archive/intents/alpha/review.yaml");
    assert.equal(current(tree), true);
    const { result, owed } = greenOwes(fixture, tree);
    assert.equal(result.code, 0, result.out + result.err);
    assert.ok(!owed.includes("review"), result.out);
  });
}
