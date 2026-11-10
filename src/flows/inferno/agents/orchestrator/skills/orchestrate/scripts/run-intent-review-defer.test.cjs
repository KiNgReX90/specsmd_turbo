const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { INTENT_TREE, git, repo, run, worktree, write } = require("./review-fixture.cjs");

// A deferred item owes no review, no proof and no integrate, and the intent review, the gate
// and the ship do not wait for it: every one of them reads the intent's items through
// run-intent-owed.cjs intentItems, which leaves a deferred item out.

const WRITER = path.join(__dirname, "state-transition.cjs");
const REVIEW = ".specs-inferno/intents/alpha/review.yaml";
const A_TWO = ".specs-inferno/intents/alpha/work-items/a-two.md";

/** An intent with its work committed, an empty scan collected, and a-two holding a tested criterion. */
function started() {
  const fixture = repo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  write(tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  const spec = fs.readFileSync(path.join(tree, A_TWO), "utf8");
  write(tree, A_TWO, spec.replace("## Execution Manifest", "## Acceptance Criteria\n\n- [ ] the docs say two (`src/a.test.ts`)\n\n## Execution Manifest"));
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the work"]);
  return { fixture, tree };
}

/** Defer a-two in the intent worktree and commit what the writer wrote, as the orchestrator does. */
function deferred({ fixture, tree }) {
  const result = spawnSync(process.execPath, [WRITER, "defer-item", "--intent", "alpha", "--item", "a-two", "--reason", "waits for the next plan"], {
    cwd: tree, encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: fixture.cache },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "specsmd(alpha): defer a-two"]);
  return { fixture, tree };
}

const review = (fixture, tree, args = []) => run(fixture, ["review", "--tree", tree, ...args]);
const record = (fixture, tree) => review(fixture, tree, ["--reviewer", "rev-1"]);

test("the intent reviewer is sent every item spec but a deferred one's, and told why that one is out", () => {
  const { fixture, tree } = deferred(started());
  const result = review(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /a-one\.md/);
  assert.doesNotMatch(result.out, /a-two\.md/);
  assert.match(result.out, /deferred a-two: waits for the next plan\. It is out of this intent, so judge no criterion it alone delivers/);
});

test("a clean intent review owes no caught mutant for a deferred item's criteria", () => {
  const live = started();
  review(live.fixture, live.tree);
  write(live.tree, REVIEW, "verdict: clean\n");
  const owed = record(live.fixture, live.tree);
  assert.equal(owed.code, 2, owed.out + owed.err);
  assert.match(owed.err, /a-two owes a caught mutant for criteria 1/);

  const { fixture, tree } = deferred(started());
  review(fixture, tree);
  write(tree, REVIEW, "verdict: clean\n");
  const clean = record(fixture, tree);
  assert.equal(clean.code, 0, clean.out + clean.err);
  assert.match(clean.out, /intent review clean/);
});

test("an intent review finding owned by a deferred item is refused: no builder fixes it", () => {
  const { fixture, tree } = deferred(started());
  review(fixture, tree);
  write(tree, REVIEW, "verdict: fix\nfindings:\n  - criterion: c\n    file: docs/b.md\n    line: \"1\"\n    evidence: e\n    fix: f\n    severity: blocker\n    owner: a-two\n");
  const result = record(fixture, tree);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /owner a-two, which is no work item of this intent/);
});

test("the item review and integrate refuse a deferred item", () => {
  const { fixture, tree } = deferred(started());
  for (const args of [["review", "--item", "a-two", "--tree", tree], ["integrate", "--item", "a-two", "--tree", tree]]) {
    const result = run(fixture, args);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, /ITEM_DEFERRED/);
    assert.match(result.err, /a-two is deferred out of alpha: it owes no review and no integrate/);
  }
});
