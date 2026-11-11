const assert = require("node:assert/strict");
const test = require("node:test");

const { parseYaml } = require("./run-yaml.cjs");

// A comment starts at a `#` that whitespace precedes, outside quotes, wherever the reader takes a
// scalar. A list item used to be split on its first `: ` before the comment was cut, so
// `- path  # note: text` read as the map {"path  # note": "text"}, and an ownership entry
// written that way stopped every step that read the item.

test("a commented plain list item reads as its path, even when the comment holds a colon", () => {
  assert.deepEqual(parseYaml("e:\n  - a.rs  # g: x\n"), { e: ["a.rs"] });
  assert.deepEqual(parseYaml("e:\n  - a.rs # plain note\n  - b.rs\n"), { e: ["a.rs", "b.rs"] });
});

test("a hash inside quotes and a hash with no whitespace before it stay part of the value", () => {
  const doc = parseYaml(['e:', '  - "a # b"', '  - a#b', "  - 'c # d: e'  # f: g", '  - "h # i: j"', "k: a#b # tail", ""].join("\n"));
  assert.deepEqual(doc.e, ["a # b", "a#b", "c # d: e", "h # i: j"]);
  assert.equal(doc.k, "a#b");
});

test("a list item that really is a map stays a map, with a trailing comment cut from its value", () => {
  const doc = parseYaml(["e:", "  - key: value  # note: text", "    other: two # more", '  - "quoted key": three # x', ""].join("\n"));
  assert.deepEqual(doc.e, [{ key: "value", other: "two" }, { "quoted key": "three" }]);
});

test("a list item map whose first key carries only a comment keeps the block under it", () => {
  const doc = parseYaml(["e:", "  - paths: # the sealed files", "      - a/**", "    reseal: make seal", ""].join("\n"));
  assert.deepEqual(doc.e, [{ paths: ["a/**"], reseal: "make seal" }]);
});

test("a block scalar marker followed by a comment still opens its block", () => {
  const doc = parseYaml(["notes: |  # kept as written", "  one", "  two", "after: x", ""].join("\n"));
  assert.equal(doc.notes, "one\ntwo");
  assert.equal(doc.after, "x");
});

test("an inline list and a map value cut a trailing comment, and keep a quoted hash", () => {
  const doc = parseYaml('a: [x, "y # z"]  # note: n\nb: v  # note: n\n');
  assert.deepEqual(doc.a, ["x", "y # z"]);
  assert.equal(doc.b, "v");
});
