const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { git, repo, write } = require("./review-fixture.cjs");
const { changedSince, locate } = require("./run-mutant-runs.cjs");

// Where a proposal's line is now. Its own line first, then the one line of its own file that
// holds its find once. Once its file holds the find nowhere, or is gone, the runner follows it
// into the files the item changed since its first review, owned by the item and outside the
// ledger, and places it only where exactly one line holds it once.

const REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const ENTRY = { criterion: "1", file: "src/a.ts", line: "1", find: "a = 1", replace: "a = 7", test: "node checks/one.cjs" };
const EDITABLE = ["src/**", ".specs-inferno/notes.md"];

/** A host whose item a-one recorded its first review with ENTRY, then committed `after`. */
function moved(after, { before = {} } = {}) {
  const fixture = repo();
  const tree = fixture.root;
  write(tree, "src/a.ts", "export const a = 1;\nexport const a2 = 2;\n");
  for (const [rel, body] of Object.entries(before)) write(tree, rel, body);
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a-one built"]);
  write(tree, REVIEW, "item: a-one\nverdict: clean\nfiles: [src/a.ts]\nmutants:\n  - criterion: 1\n    file: src/a.ts\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the first review of a-one"]);
  for (const [rel, body] of Object.entries(after)) {
    if (body === null) fs.rmSync(path.join(tree, rel));
    else write(tree, rel, body);
  }
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the correction"]);
  return tree;
}

const placed = (tree, entry = ENTRY) => locate(tree, entry, () => changedSince(tree, REVIEW, EDITABLE));

test("its own line, holding the find once, is its place, whatever other lines of the file hold", () => {
  const tree = moved({ "src/a.ts": "export const a = 1;\nexport const b = a = 1;\n" });
  assert.deepEqual(locate(tree, ENTRY, () => assert.fail("its own line holds it")), { line: "1" });
});

test("a line that moved inside its own file is found there, and nothing further is read", () => {
  const tree = moved({ "src/a.ts": "// head\nexport const a = 1;\n", "src/c.ts": "export const a = 1;\n" });
  assert.deepEqual(locate(tree, ENTRY, () => assert.fail("its own file holds it")), { line: "2" });
});

test("a find its file holds nowhere is followed into the one changed file of the item that holds it once", () => {
  const tree = moved({ "src/a.ts": "export { a } from './c';\n", "src/c.ts": "// c\nexport const a = 1;\n" });
  assert.deepEqual(placed(tree), { file: "src/c.ts", line: "2" });
});

test("a file that is gone is followed too, and a deleted file among the changed ones is passed over", () => {
  const tree = moved({ "src/a.ts": null, "src/c.ts": "export const a = 1;\n" });
  assert.deepEqual(changedSince(tree, REVIEW, EDITABLE), ["src/a.ts", "src/c.ts"]);
  assert.deepEqual(placed(tree), { file: "src/c.ts", line: "1" });
  assert.deepEqual(locate(tree, ENTRY), { why: "src/a.ts is not a committed file, so nothing could restore it" }, "with nowhere to follow, it says the file is gone");
});

test("two lines that hold the find are no place, in one file or in two", () => {
  for (const after of [
    { "src/a.ts": "export { a } from './c';\n", "src/c.ts": "export const a = 1;\nexport const b = a = 1;\n" },
    { "src/a.ts": "export { a } from './c';\n", "src/c.ts": "export const a = 1;\n", "src/d.ts": "export const a = 1;\n" },
  ]) {
    const at = placed(moved(after));
    assert.equal(at.file, undefined);
    assert.equal(at.why, "src/a.ts:1 changed, and find no longer marks one line of it; 2 lines of the files the item changed since hold it, " +
      "so none is its place");
  }
});

test("one line that holds the find twice is no place either", () => {
  const at = placed(moved({ "src/a.ts": "export { a } from './c';\n", "src/c.ts": "export const a = 1, b = a = 1;\n" }));
  assert.deepEqual(at, { why: "src/a.ts:1 changed, and find no longer marks one line of it" });
});

test("a file that still holds the find on two lines keeps it, and nothing is followed", () => {
  const tree = moved({ "src/a.ts": "// head\nlet a = 1;\nlet b = a = 1;\n", "src/c.ts": "export const a = 1;\n" });
  assert.deepEqual(locate(tree, ENTRY, () => assert.fail("its own file still holds it")),
    { why: "src/a.ts:1 changed, and find no longer marks one line of it" });
});

test("only files the item owns, changed since its first review and outside the ledger, are followed into", () => {
  const tree = moved({
    "src/a.ts": "export { a } from './c';\n",
    "src/c.ts": "export const a = 1;\n",
    "docs/b.md": "a = 1 moved to c\n",
    ".specs-inferno/notes.md": "a = 1 moved to c\n",
  }, { before: { "src/legacy.ts": "// a = 1 was the default once\n" } });
  assert.deepEqual(changedSince(tree, REVIEW, EDITABLE), ["src/a.ts", "src/c.ts"]);
  assert.deepEqual(placed(tree), { file: "src/c.ts", line: "1" });
});

test("the files are counted from the item's first review, not its last", () => {
  const tree = moved({ "src/a.ts": "export { a } from './c';\n", "src/c.ts": "export const a = 1;\n" });
  write(tree, REVIEW, "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n");
  git(tree, ["commit", "-qam", "the second review of a-one"]);
  assert.deepEqual(changedSince(tree, REVIEW, EDITABLE), ["src/a.ts", "src/c.ts"]);
});

test("an item with no review on record has no changed files to follow into", () => {
  const tree = moved({ "src/a.ts": "export { a } from './c';\n", "src/c.ts": "export const a = 1;\n" });
  assert.deepEqual(changedSince(tree, ".specs-inferno/intents/alpha/reviews/a-two.yaml", EDITABLE), []);
});
