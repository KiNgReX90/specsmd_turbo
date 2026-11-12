const assert = require("node:assert/strict");
const test = require("node:test");

const { parseYaml } = require("./run-yaml.cjs");

// A block scalar header is `|` or `>`, then at most one chomping marker (`-` strips the final
// line breaks, `+` keeps them all) and one indentation digit, in either order. The reader used
// to take `|`, `|-` and `>` alone: a finding written `evidence: >-` was refused, and the refusal
// named the first body line instead of the marker.

const doc = (...lines) => parseYaml(`${lines.join("\n")}\n`);

/** Each header with a body under it and the text YAML reads from it. */
const HEADERS = [
  { header: ">-", body: ["one", "two"], text: "one two" },
  { header: ">+", body: ["one", "two", ""], text: "one two\n\n" },
  { header: "|+", body: ["one", "two", ""], text: "one\ntwo\n\n" },
  { header: "|2", body: ["  x", "y"], text: "  x\ny" },
  { header: ">2-", body: ["  x", "y", "z"], text: "  x\ny z" },
];

/** The body lines under a key at `indent`, each indented two more, an empty line left empty. */
const under = (indent, body) => body.map((line) => (line === "" ? "" : `${" ".repeat(indent + 2)}${line}`));

for (const { header, body, text } of HEADERS) {
  test(`a map value written ${header} reads as its text, and the key after it still reads`, () => {
    assert.deepEqual(doc(`what: ${header}`, ...under(0, body), "after: x"), { what: text, after: "x" });
  });

  test(`a nested map value written ${header} reads as its text`, () => {
    assert.deepEqual(doc("outer:", `  what: ${header}`, ...under(2, body), "  after: x"), { outer: { what: text, after: "x" } });
  });

  test(`a list item written ${header} reads as its text`, () => {
    assert.deepEqual(doc("items:", `  - ${header}`, ...under(2, body), "  - next"), { items: [text, "next"] });
  });

  test(`a key of a list item map written ${header} reads as its text`, () => {
    const parsed = doc("findings:", "  - file: src/a.ts", `    what: ${header}`, ...under(4, body), "    severity: minor", "  - file: src/b.ts");
    assert.deepEqual(parsed, { findings: [{ file: "src/a.ts", what: text, severity: "minor" }, { file: "src/b.ts" }] });
  });

  test(`a list item map that opens with ${header} reads as its text`, () => {
    const parsed = doc("findings:", `  - what: ${header}`, ...under(4, body), "    severity: minor");
    assert.deepEqual(parsed, { findings: [{ what: text, severity: "minor" }] });
  });
}

test("the chomping marker and the indentation digit read in either order", () => {
  assert.equal(doc("a: |-2", "    x", "  y").a, "  x\ny");
  assert.equal(doc("a: |2-", "    x", "  y").a, "  x\ny");
  assert.equal(doc("a: >+1", "  x", "", "b: y").a, " x\n\n");
  assert.equal(doc("a: >1+", "  x", "", "b: y").a, " x\n\n");
});

test("a header with a comment behind it still opens its block", () => {
  assert.deepEqual(doc("a: >-  # folded", "  one", "  two", "b: x"), { a: "one two", b: "x" });
  assert.deepEqual(doc("l:", "  - |+ # kept", "    one", "", "  - two"), { l: ["one\n\n", "two"] });
});

// --- folding -----------------------------------------------------------------

test("a folded block joins its lines with a space and keeps a line break for each empty line", () => {
  assert.equal(doc("a: >-", "  one", "  two", "", "  three", "", "", "  four").a, "one two\nthree\n\nfour");
});

test("a folded block keeps the line breaks around a more indented line", () => {
  assert.equal(doc("a: >-", "  one", "    code()", "  two", "  three").a, "one\n  code()\ntwo three");
});

// --- what a released review holds reads as before ---------------------------
// The released reader took `|`, `|-` and `>`, and read every one of them without a final line
// break. That stays: every reader of these values matches the text against a file or prints it
// in a line, and a final break would make a pin's copy or a mutant's line miss its file.

test("a literal block written | or |- reads as the released reader read it", () => {
  const body = ["Read landingSince and baseline.", "On the base it returns HEAD,", "so the ratchet compares nothing."];
  const text = body.join("\n");
  assert.equal(doc("evidence: |-", ...under(0, body), "severity: minor").evidence, text);
  assert.equal(doc("evidence: |", ...under(0, body), "severity: minor").evidence, text);
  assert.equal(doc("notes: |", "  one", "  two").notes, "one\ntwo");
});

test("a folded block written > reads without a final line break, as a clipped block always read", () => {
  assert.equal(doc("a: >", "  one", "  two", "", "b: x").a, "one two");
});

test("a block scalar with no body reads as the empty text", () => {
  assert.deepEqual(doc("a: |", "b: x"), { a: "", b: "x" });
  assert.deepEqual(doc("a: >-", "b: x"), { a: "", b: "x" });
});

// --- a literal block reads its body as written -------------------------------

test("a literal block keeps a deeper indent, an empty line inside it and a line that opens with a hash", () => {
  assert.deepEqual(doc("a: |-", "  if (x) {", "    run();", "  }", "", "  # not a comment", "b: x"), {
    a: "if (x) {\n  run();\n}\n\n# not a comment",
    b: "x",
  });
});

test("a hash line indented less than the block ends it, as a comment", () => {
  assert.deepEqual(doc("a: |-", "  one", "# a comment", "b: x"), { a: "one", b: "x" });
});

test("a block scalar in a file written with CRLF line ends reads without the carriage returns", () => {
  assert.deepEqual(parseYaml("a: >-\r\n  one\r\n  two\r\nb: x\r\n"), { a: "one two", b: "x" });
});

// --- a header YAML does not allow --------------------------------------------

for (const header of [">0", "|-+", "|10", ">--", "|2-3"]) {
  test(`the header ${header} is refused on the line of the marker, naming the marker`, () => {
    assert.throws(
      () => doc("item: a-one", "findings:", `  - what: ${header}`, "      one", "      two"),
      (error) => {
        assert.equal(error.code, "BAD_YAML");
        assert.match(error.message, /^cannot parse line 3: /);
        assert.ok(error.message.includes(`header ${header} `), error.message);
        assert.doesNotMatch(error.message, /line 4/);
        return true;
      },
    );
  });
}

test("a value that only opens with a bar or an angle bracket is still a plain scalar", () => {
  assert.deepEqual(doc("a: |x", "b: >y"), { a: "|x", b: ">y" });
});
