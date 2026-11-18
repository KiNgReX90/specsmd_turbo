const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, INTENT_TREE, git, intentReviewed, repo, run, worktree, write } = require("./review-fixture.cjs");
const lib = require("./run-lib.cjs");
const { foldBound, ownFiles } = require("./run-intent-fold.cjs");
const { parseFor, reviewCurrent } = require("./run-intent-owed.cjs");

// The intent's own files are read against the base. When the local base and origin's base differ
// and one holds the other, the older one's merge base predates the commits the newer one synced,
// so only the newer one is read: a file the base synced is never the intent's own, and a file the
// intent changed always is. Only when the two diverged are both read, as before.

const GATED = CONFIG.replace("delivery:", "  finalize:\n    - echo gated\ndelivery:");
const BOUND = GATED.replace("  model: model-review\n", '  model: model-review\n  outside: ["**"]\n');
const REVIEW = ".specs-inferno/intents/alpha/review.yaml";
const KB = { "kb/x.md": "a page the base synced\n" };

/** An intent tree that changed src/a.ts, cut from main. */
function opened() {
  const fixture = repo({ config: BOUND });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  git(tree, ["commit", "-qam", "the work"]);
  return { fixture, tree };
}

/** A commit of `files` on top of `from` in the primary checkout, which leaves main where it stood. */
function commitOn(fixture, from, files) {
  git(fixture.root, ["checkout", "-q", "--detach", from]);
  for (const [rel, body] of Object.entries(files)) write(fixture.root, rel, body);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", `synced ${Object.keys(files).join(" ")}`]);
  const sha = git(fixture.root, ["rev-parse", "HEAD"]);
  git(fixture.root, ["checkout", "-q", "main"]);
  return sha;
}

const origin = (fixture, sha, base = "main") => git(fixture.root, ["update-ref", `refs/remotes/origin/${base}`, sha]);
const forward = (fixture, sha) => git(fixture.root, ["merge", "-q", "--ff-only", sha]);
const fold = (tree, ref) => git(tree, ["merge", "-q", "--no-edit", ref]);
const own = (tree, base = "main", at) => {
  const files = ownFiles(tree, base, at);
  return files && [...files].sort();
};

test("a local base that lags origin's: the files origin synced are not the intent's own", () => {
  const { fixture, tree } = opened();
  origin(fixture, commitOn(fixture, "main", KB));
  fold(tree, "origin/main");
  assert.deepEqual(own(tree), ["src/a.ts"]);
});

test("a local base ahead of origin's: the files it holds and origin lacks are not the intent's own", () => {
  const { fixture, tree } = opened();
  origin(fixture, git(fixture.root, ["rev-parse", "main"]));
  forward(fixture, commitOn(fixture, "main", KB));
  fold(tree, "main");
  assert.deepEqual(own(tree), ["src/a.ts"]);
});

test("a local base equal to origin's: the intent's own files are its changes alone", () => {
  const { fixture, tree } = opened();
  const synced = commitOn(fixture, "main", KB);
  forward(fixture, synced);
  origin(fixture, synced);
  fold(tree, "main");
  assert.deepEqual(own(tree), ["src/a.ts"]);
});

test("a local base and origin's that diverged are both read, so a file only one of them synced stays in", () => {
  const { fixture, tree } = opened();
  const local = commitOn(fixture, "main", KB);
  origin(fixture, commitOn(fixture, "main", { "kb/y.md": "a page origin synced\n" }));
  forward(fixture, local);
  fold(tree, "main");
  assert.deepEqual(own(tree), ["kb/x.md", "src/a.ts"]);
});

test("only a local base: the intent's own files are read against it", () => {
  const { fixture, tree } = opened();
  forward(fixture, commitOn(fixture, "main", KB));
  fold(tree, "main");
  assert.equal(lib.git(tree, ["rev-parse", "--verify", "--quiet", "origin/main"], { tolerate: true }), null, "no origin ref");
  assert.deepEqual(own(tree), ["src/a.ts"]);
});

test("only origin's base: the intent's own files are read against it", () => {
  const { fixture, tree } = opened();
  origin(fixture, commitOn(fixture, "main", KB), "release");
  fold(tree, "origin/release");
  assert.deepEqual(own(tree, "release"), ["src/a.ts"]);
});

test("a base neither ref resolves, or the tree's own branch, tells no own files", () => {
  const { tree } = opened();
  assert.equal(ownFiles(tree, "nowhere"), null);
  assert.equal(ownFiles(tree, lib.currentBranch(tree)), null);
});

test("the files the intent changed at a commit are read against the newer base too", () => {
  const { fixture, tree } = opened();
  origin(fixture, commitOn(fixture, "main", KB));
  fold(tree, "origin/main");
  const at = git(tree, ["rev-parse", "HEAD"]);
  write(tree, "src/b.ts", "export const b = 7;\n");
  git(tree, ["commit", "-qam", "own change"]);
  assert.deepEqual(own(tree, "main", at), ["src/a.ts"]);
  assert.deepEqual(own(tree), ["src/a.ts", "src/b.ts"]);
});

/** A bare origin the primary checkout pushes main to, and a second clone that pushes to it as another host would. */
function remote(fixture) {
  const dir = path.dirname(fixture.root);
  const bare = path.join(dir, "origin.git");
  git(dir, ["init", "-q", "--bare", bare]);
  git(fixture.root, ["remote", "add", "origin", bare]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  const other = path.join(dir, "other");
  git(dir, ["clone", "-q", "-b", "main", bare, other]);
  git(other, ["config", "user.email", "test@example.com"]);
  git(other, ["config", "user.name", "Test"]);
  return (files) => {
    for (const [rel, body] of Object.entries(files)) write(other, rel, body);
    git(other, ["add", "-A"]);
    git(other, ["commit", "-qm", `synced ${Object.keys(files).join(" ")}`]);
    git(other, ["push", "-q", "origin", "main"]);
  };
}

test("with review.outside ** a sync folded from an origin the local base lags binds nothing, and every gate starts without a review", () => {
  const fixture = repo({ config: BOUND });
  const push = remote(fixture);
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  git(tree, ["commit", "-qam", "the work"]);
  intentReviewed(tree, "alpha", "verdict: clean\n", lib.readConfig(tree));
  const reviewed = git(tree, ["rev-parse", "HEAD"]);
  for (const files of [KB, { "kb/y.md": "the next sync\n" }]) {
    push(files);
    const gated = run(fixture, ["gate", "--tree", tree]);
    assert.equal(gated.code, 0, gated.out + gated.err);
    assert.match(gated.out, /folded main into/);
    assert.doesNotMatch(gated.out, /intent review owed/);
    assert.ok(fs.existsSync(path.join(tree, Object.keys(files)[0])));
  }
  assert.notEqual(git(fixture.root, ["rev-parse", "main"]), git(fixture.root, ["rev-parse", "origin/main"]), "the local base still lags");
  assert.deepEqual(foldBound(tree, lib.readConfig(tree), reviewed, "main").bound, []);
  assert.equal(reviewCurrent(tree, lib.readConfig(tree), parseFor(tree, REVIEW, "alpha", true)), true);
});

test("with review.outside ** a fold of a local base rebased since: the old copies' files are not the intent's own, and the review binds none of them", () => {
  const fixture = repo({ config: BOUND });
  const push = remote(fixture);
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  git(tree, ["commit", "-qam", "the work"]);
  // A page only the local base holds, folded in before the review; then origin moves and the local base is rebased onto it.
  forward(fixture, commitOn(fixture, "main", KB));
  fold(tree, "main");
  intentReviewed(tree, "alpha", "verdict: clean\n", lib.readConfig(tree));
  const reviewed = git(tree, ["rev-parse", "HEAD"]);
  push({ "kb/y.md": "a page origin synced\n" });
  git(fixture.root, ["fetch", "-q", "origin"]);
  git(fixture.root, ["rebase", "-q", "origin/main"]);
  const mine = (at) => own(tree, "main", at).filter((file) => !lib.inLedger(file));
  assert.deepEqual(mine(), ["src/a.ts"]);
  assert.deepEqual(mine(reviewed), ["src/a.ts"]);
  assert.equal(reviewCurrent(tree, lib.readConfig(tree), parseFor(tree, REVIEW, "alpha", true)), true);
  write(tree, "kb/x.md", "the intent edits the page\n");
  assert.deepEqual(mine(), ["kb/x.md", "src/a.ts"], "a page the intent edits is its own");
  git(tree, ["checkout", "--", "kb/x.md"]);
  const gated = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gated.code, 0, gated.out + gated.err);
  assert.doesNotMatch(gated.out, /intent review owed/);
  assert.deepEqual(foldBound(tree, lib.readConfig(tree), reviewed, "main").bound, []);
  // The intent edits the page in one commit and takes it back in the next: at the first it was the intent's own.
  write(tree, "kb/x.md", "the intent edits the page\n");
  git(tree, ["commit", "-qam", "the intent edits the page"]);
  const edited = git(tree, ["rev-parse", "HEAD"]);
  git(tree, ["revert", "--no-edit", "HEAD"]);
  assert.deepEqual(mine(edited), ["kb/x.md", "src/a.ts"]);
  assert.deepEqual(mine(), ["src/a.ts"]);
});

test("a local base and origin's that diverged and were both folded are both read, so a file only one of them synced stays in", () => {
  const { fixture, tree } = opened();
  const local = commitOn(fixture, "main", KB);
  origin(fixture, commitOn(fixture, "main", { "kb/y.md": "a page origin synced\n" }));
  forward(fixture, local);
  fold(tree, "main");
  fold(tree, "origin/main");
  assert.deepEqual(own(tree), ["kb/x.md", "kb/y.md", "src/a.ts"]);
});

test("only origin's base, rewritten to the same patch since the fold: the old copy's files are not the intent's own", () => {
  const { fixture, tree } = opened();
  const synced = commitOn(fixture, "main", KB);
  origin(fixture, synced, "release");
  fold(tree, "origin/release");
  const copy = git(fixture.root, ["commit-tree", `${synced}^{tree}`, "-p", `${synced}^`, "-m", "synced, reworded"]);
  origin(fixture, copy, "release");
  assert.deepEqual(own(tree, "release"), ["src/a.ts"]);
});

test("a commit before a fold of a base rewritten since reads only the folds it holds: the intent's edit the base landed later is its own there", () => {
  const { fixture, tree } = opened();
  const at = git(tree, ["rev-parse", "HEAD"]);
  const landed = commitOn(fixture, "main", { "src/a.ts": "export const a = 3;\n" });
  forward(fixture, landed);
  fold(tree, "main");
  git(fixture.root, ["reset", "-q", "--hard", git(fixture.root, ["commit-tree", `${landed}^{tree}`, "-p", `${landed}^`, "-m", "landed, reworded"])]);
  assert.deepEqual(own(tree, "main", at), ["src/a.ts"]);
  assert.deepEqual(own(tree), []);
});
