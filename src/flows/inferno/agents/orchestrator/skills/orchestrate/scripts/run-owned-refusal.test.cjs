const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { ITEMS, git, item, opened, repo, run, write } = require("./run-fixture.cjs");
const { readItemSpec } = require("./run-lib.cjs");
const { canonical } = require("./run-owned.cjs");
const { tempDir } = require("./test-temp.cjs");

// An `ownership.editable` entry that is no path used to stop frontier, verify-item and integrate
// with "Ownership requires a path" alone, which named neither the item nor the entry. The refusal
// now names the item, the spec and the entry as it is written there, with its line.

const SPEC = ".specs-inferno/intents/alpha/work-items/a-one.md";
const RAW = "    - key: value";

function badRepo() {
  return repo({ items: { ...ITEMS, "alpha/a-one": item({ id: "a-one", intent: "alpha", editable: ["src/a.ts", "key: value"] }) } });
}

function assertNamed(result, root) {
  const file = path.join(root, SPEC);
  const line = fs.readFileSync(file, "utf8").split("\n").indexOf(RAW) + 1;
  assert.ok(line > 0);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /\[OWNERSHIP\] Ownership requires a path/);
  assert.ok(result.err.includes("item a-one"), result.err);
  assert.ok(result.err.includes(`${file}:${line}`), result.err);
  assert.ok(result.err.includes("`- key: value`"), result.err);
}

test("frontier refuses an entry that is no path, naming the item, the spec, its line and the entry", () => {
  const fixture = badRepo();
  assertNamed(run(fixture, ["frontier", "alpha"]), fixture.root);
});

test("verify-item refuses the same entry the same way", () => {
  const fixture = badRepo();
  assertNamed(run(fixture, ["verify-item", "a-one", "--intent", "alpha"]), fixture.root);
});

test("integrate refuses the same entry the same way", () => {
  const fixture = badRepo();
  const { tree } = opened(fixture);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a-one landed"]);
  assertNamed(run(fixture, ["integrate", "--item", "a-one", "--tree", tree]), tree);
});

test("an entry with a comment that holds a colon is a path, and frontier reads it", () => {
  const fixture = repo({ items: { ...ITEMS, "alpha/a-one": item({ id: "a-one", intent: "alpha", editable: ["src/a.ts", "src/x.ts  # note: text"] }) } });
  const result = run(fixture, ["frontier", "alpha", "--json"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(readItemSpec(fixture.root, "alpha", "a-one").manifest.ownership.editable, ["src/a.ts", "src/x.ts"]);
});

function specTree(t, manifest) {
  const root = tempDir("inferno-owned-spec-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, ".specs-inferno/intents/i/work-items/w.md", `---\nid: w\n---\n\n# Work Item: w\n\n## Execution Manifest\n\n${manifest}\n## Technical Notes\n`);
  return path.join(root, ".specs-inferno/intents/i/work-items/w.md");
}

test("the refusal counts the dashes under editable past comments and blank lines, and quotes an empty entry", (t) => {
  const file = specTree(t, ["ownership:", "  editable:", "    # the paths", "    - a.ts", "", '    - ""', "    - key: one", "      more: two", "reads: []", ""].join("\n"));
  const root = file.slice(0, file.indexOf("/.specs-inferno/"));
  const line = fs.readFileSync(file, "utf8").split("\n").indexOf('    - ""') + 1;
  assert.throws(() => readItemSpec(root, "i", "w"), (error) => {
    assert.equal(error.code, "OWNERSHIP");
    assert.ok(error.message.includes(`${file}:${line}`), error.message);
    assert.ok(error.message.includes('item w lists `- ""` under ownership.editable'), error.message);
    return true;
  });
});

test("an editable list that the spec writes inline, or under a key the reader cannot place, falls back to the entry as read", () => {
  const { rawEntry } = require("./run-item-spec.cjs");
  assert.equal(rawEntry("## Execution Manifest\nownership:\n  editable: [a]\n", 0), null);
  assert.equal(rawEntry("## Execution Manifest\nownership:\n  editable:\n    - a\nnext:\n  - b\n", 1), null);
  assert.equal(rawEntry("editable:\n  - a\n## Execution Manifest\nownership:\n  editable:\n    - b\n", 0).text, "- b");
  assert.deepEqual(rawEntry("## Execution Manifest\nownership:\n  editable:  # the paths\n    - a\n", 0), { text: "- a", line: 4 });
});

test("a map entry is refused at its own line, the first bad entry first", (t) => {
  const file = specTree(t, ["ownership:", "  editable:", "    - a.ts", "    - key: one", "    - b.ts", ""].join("\n"));
  const root = file.slice(0, file.indexOf("/.specs-inferno/"));
  const line = fs.readFileSync(file, "utf8").split("\n").indexOf("    - key: one") + 1;
  assert.throws(() => readItemSpec(root, "i", "w"), (error) => {
    assert.match(error.message, /item w lists `- key: one` under ownership\.editable/);
    assert.ok(error.message.includes(`${file}:${line}`), error.message);
    return true;
  });
});

test("an entry whose line cannot be found is named as it was read, still with the item and the spec", (t) => {
  const file = specTree(t, ["ownership:", '  "editable":', "    - key: one", ""].join("\n"));
  assert.throws(() => readItemSpec(file.slice(0, file.indexOf("/.specs-inferno/")), "i", "w"), (error) => {
    assert.ok(error.message.includes(`item w lists {"key":"one"} under ownership.editable in ${file}.`), error.message);
    return true;
  });
});

test("a spec whose editable holds paths only, or holds no list, reads as before", (t) => {
  for (const manifest of ["ownership:\n  editable:\n    - a.ts\n", "ownership:\n  editable: [a.ts, b.ts]\n", "context: {}\n", "ownership: {}\n"]) {
    const file = specTree(t, manifest);
    assert.doesNotThrow(() => readItemSpec(file.slice(0, file.indexOf("/.specs-inferno/")), "i", "w"), manifest);
  }
});

test("canonical names the entry it refuses", () => {
  assert.throws(() => canonical({ key: "value" }), /Ownership requires a path, not \{"key":"value"\}/);
  assert.throws(() => canonical("  "), /Ownership requires a path, not " {2}"/);
});
