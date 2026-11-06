const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, INTENT_TREE, git, intentReviewed, repo, run, worktree, write } = require("./review-fixture.cjs");
const lib = require("./run-lib.cjs");

// A kb sync the base brings in (review.outside) keeps the intent review current; the intent's
// own edit to the same kb, or a base change outside it, still voids the review.

const GATED = CONFIG.replace("delivery:", "  finalize:\n    - echo gated\ndelivery:");
const OUTSIDE = GATED.replace("  model: model-review\n", '  model: model-review\n  outside: ["wiki/**", "grok/**"]\n');
const REVIEW = ".specs-inferno/intents/alpha/review.yaml";
const SCAN = ".specs-inferno/intents/alpha/scan.yaml";

function opened(config = OUTSIDE) {
  const fixture = repo({ config });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  git(tree, ["commit", "-qam", "the work"]);
  return { fixture, tree };
}

function baseCommits(fixture, rel, body = "synced\n") {
  write(fixture.root, rel, body);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", `main changed ${rel}`]);
}

const gate = (fixture, tree) => run(fixture, ["gate", "--tree", tree]);
const green = (fixture, tree) => run(fixture, ["green", "--tree", tree, "--json"]);

test("a base commit that only changes wiki/ keeps a clean review current", () => {
  const { fixture, tree } = opened();
  intentReviewed(tree, "alpha", "verdict: clean\n", lib.readConfig(tree));
  baseCommits(fixture, "wiki/page.md");
  const result = gate(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /folded main into/);
  assert.doesNotMatch(result.out, /intent review owed/);
  assert.ok(fs.existsSync(path.join(tree, "wiki/page.md")));
});

test("the same base commit voids the review when review.outside is unset", () => {
  const { fixture, tree } = opened(GATED);
  intentReviewed(tree, "alpha", "verdict: clean\n", lib.readConfig(tree));
  assert.doesNotMatch(fs.readFileSync(path.join(tree, REVIEW), "utf8"), /tree_outside/);
  baseCommits(fixture, "wiki/page.md");
  const result = gate(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /intent review owed: the code changed since the review/);
});

test("the intent's own wiki edit after the review voids it", () => {
  const { fixture, tree } = opened();
  intentReviewed(tree, "alpha", "verdict: clean\n", lib.readConfig(tree));
  assert.equal(gate(fixture, tree).code, 0);
  assert.equal(green(fixture, tree).code, 0);
  write(tree, "wiki/page.md", "the intent's own page\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "own wiki edit"]);
  const result = green(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.ok(JSON.parse(result.out).owed.includes("review"));
});

test("a base commit outside the kb voids the review even with review.outside set", () => {
  const { fixture, tree } = opened();
  intentReviewed(tree, "alpha", "verdict: clean\n", lib.readConfig(tree));
  baseCommits(fixture, "docs/moved.md");
  const result = gate(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /intent review owed: the code changed since the review/);
});

test("a review recorded without tree_outside keeps today's rule", () => {
  const { fixture, tree } = opened();
  const proofs = require("./run-proofs.cjs");
  write(tree, SCAN, "lines: []\n");
  write(tree, REVIEW, `verdict: clean\ntree: ${proofs.scopeHash(tree)}\ncommit: ${git(tree, ["rev-parse", "HEAD"])}\nreviewer: rev-1\n`);
  git(tree, ["add", "--", SCAN, REVIEW]);
  git(tree, ["commit", "-qm", "review with no tree_outside", "--", SCAN, REVIEW]);
  baseCommits(fixture, "wiki/page.md");
  const result = gate(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /intent review owed: the code changed since the review/);
});

test("run.cjs review records tree_outside", () => {
  const { fixture, tree } = opened();
  write(tree, SCAN, "lines: []\n");
  git(tree, ["add", "--", SCAN]);
  git(tree, ["commit", "-qm", "scan"]);
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, REVIEW, "verdict: clean\n");
  const recorded = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
  assert.equal(recorded.code, 0, recorded.out + recorded.err);
  const text = fs.readFileSync(path.join(tree, REVIEW), "utf8");
  assert.match(text, /^tree: [0-9a-f]{64}\ntree_outside: [0-9a-f]{64}$/m);
  baseCommits(fixture, "grok/notes.md");
  const again = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
  assert.equal(again.code, 0, again.out + again.err);
  assert.match(again.out, /folded main into .*intent review clean for the current tree/);
});

test("review.outside must be a list of globs and merge_slot a boolean, and a --config file inherits both", () => {
  const gates = require("./run-config-gates.cjs");
  const badOutside = repo({ config: GATED.replace("  model: model-review\n", '  model: model-review\n  outside: "wiki/**"\n') });
  const outside = run(badOutside, ["gate", "--tree", badOutside.root]);
  assert.match(outside.err, /ERROR \[BAD_CONFIG\] review\.outside/);
  assert.ok(outside.err.includes('"outside: [\\"wiki/**\\"]" under review:'), outside.err);
  const badSlot = repo({ config: GATED.replace("verification:\n", "verification:\n  merge_slot: yes\n") });
  const slot = run(badSlot, ["gate", "--tree", badSlot.root]);
  assert.match(slot.err, /ERROR \[BAD_CONFIG\] verification\.merge_slot/);

  const plain = repo({ config: GATED });
  assert.equal(gates.mergeSlot(lib.readConfig(plain.root)), false);
  assert.deepEqual(gates.reviewOutside(lib.readConfig(plain.root)), []);

  const set = repo({ config: OUTSIDE.replace("verification:\n", "verification:\n  merge_slot: true\n") });
  write(set.root, "scratch.yaml", "models:\n  strong: model-other\nreview:\n  model: model-other\nverification:\n  finalize:\n    - echo scratch\n");
  const inherited = lib.readConfig(set.root, "scratch.yaml");
  assert.equal(gates.mergeSlot(inherited), true);
  assert.deepEqual(gates.reviewOutside(inherited), ["wiki/**", "grok/**"]);
  assert.equal(inherited.review.model, "model-other");
});
