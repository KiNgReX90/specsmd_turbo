const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { CONFIG, INTENT_TREE, git, repo, run, worktree, write } = require("./review-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

// Where defer-item draws the line: the item's first builder dispatch. Before it the item is a
// plan and may wait for a later one; from it on a builder touched the tree, and a deferred item
// ships nothing and owes no review, so that work would reach the base unreviewed.

const WRITER = path.join(__dirname, "state-transition.cjs");

/** The writer as the orchestrator runs it, in the intent worktree, on the fixture's cache. */
function defer(fixture, tree, item = "a-two") {
  const result = spawnSync(process.execPath, [WRITER, "defer-item", "--intent", "alpha", "--item", item, "--reason", "waits for the next plan"], {
    cwd: tree,
    encoding: "utf8",
    env: { ...process.env, XDG_CACHE_HOME: fixture.cache },
  });
  return { code: result.status, out: result.stdout || "", err: result.stderr || "" };
}

function started(options) {
  const fixture = repo(options);
  return { fixture, tree: worktree(fixture, INTENT_TREE) };
}

function commit(tree, file, body) {
  write(tree, file, body);
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", `edit ${file}`]);
  return git(tree, ["rev-parse", "--short", "HEAD"]);
}

test("an item a builder was dispatched on is refused, naming the dispatch", () => {
  const { fixture, tree } = started();
  const logged = run(fixture, ["dispatch-log", "alpha", "--item", "a-two", "--tier", "strong", "--agent", "specsmd-inferno-builder", "--tree", tree, "--json"]);
  assert.equal(logged.code, 0, logged.out + logged.err);
  const id = JSON.parse(logged.out).dispatch_id;
  const result = defer(fixture, tree);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /ITEM_IN_FLIGHT/);
  assert.match(result.err, new RegExp(`a builder was dispatched on it \\(dispatch ${id}\\)`));
});

test("a dispatch line the runner before signed records wrote is a dispatch too", () => {
  const { fixture, tree } = started();
  const log = path.join(fixture.cache, "specsmd-inferno", "app", "dispatch", "alpha.log");
  fs.mkdirSync(path.dirname(log), { recursive: true });
  writeFile(log, "2026-09-01T00:00:00Z\talpha\ta-two\tstrong\tspecsmd-inferno-builder\t\n", "utf8");
  const result = defer(fixture, tree);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /a builder was dispatched on it \(dispatch 2026-09-01T00:00:00Z\)/);
});

test("a dispatch of another item is no mark on this one", () => {
  const { fixture, tree } = started();
  run(fixture, ["dispatch-log", "alpha", "--item", "a-one", "--tier", "cheap", "--agent", "specsmd-inferno-builder-cheap", "--tree", tree]);
  const result = defer(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
});

test("an oracle asked about the item is no dispatch: it edits nothing", () => {
  const { fixture, tree } = started();
  const asked = run(fixture, [
    "dispatch-log", "alpha", "--tier", "oracle", "--item", "a-two",
    "--impact", "low: one item", "--complexity", "low: one reading", "--tree", tree,
  ]);
  assert.equal(asked.code, 0, asked.out + asked.err);
  const result = defer(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^deferred a-two \(was pending\)/);
});

test("a commit on the intent branch to a file only the item owns is refused, naming the commit", () => {
  const { fixture, tree } = started();
  const sha = commit(tree, "docs/b.md", "half a page\n");
  const result = defer(fixture, tree);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /ITEM_IN_FLIGHT/);
  assert.match(result.err, new RegExp(`commits on files only it owns: ${sha} docs/b\\.md`));
});

test("a commit to a file another item owns too, or to another item's own file, is no mark", () => {
  // src/b.ts is a-one's as well as a-two's, so a change there says nothing about a-two.
  const { fixture, tree } = started({ editable: ["src/a.ts", "src/b.ts"] });
  commit(tree, "src/b.ts", "export const b = 3;\n");
  commit(tree, "src/a.ts", "export const a = 3;\n");
  // A file no item owns is nobody's work either.
  commit(tree, "notes/unowned.md", "a note\n");
  const result = defer(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
});

test("a sibling whose spec is gone owns nothing, and the item's own commit still refuses", () => {
  const { fixture, tree } = started();
  git(tree, ["rm", "-q", ".specs-inferno/intents/alpha/work-items/a-one.md"]);
  git(tree, ["commit", "-qm", "a-one's spec went"]);
  commit(tree, "docs/b.md", "half a page\n");
  const result = defer(fixture, tree);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /docs\/b\.md/);
});

test("with no base branch in the config, the intent's own base_branch says where the branch forked", () => {
  const { fixture, tree } = started({ config: CONFIG.replace("delivery:\n  base_branch: main\n", "") });
  commit(tree, "docs/b.md", "half a page\n");
  const result = defer(fixture, tree);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /commits on files only it owns: [0-9a-f]+ docs\/b\.md/);
});

test("a base branch git cannot find leaves the branch unread", () => {
  const { fixture, tree } = started({ config: CONFIG.replace("base_branch: main", "base_branch: release-gone") });
  commit(tree, "docs/b.md", "half a page\n");
  const result = defer(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
});

test("a change the base branch made, folded into the intent branch, is not the item's work", () => {
  const { fixture, tree } = started();
  commit(fixture.root, "docs/b.md", "the base moved\n");
  git(tree, ["merge", "-q", "--no-edit", "main"]);
  const result = defer(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
});
