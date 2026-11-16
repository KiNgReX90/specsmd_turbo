const assert = require("node:assert/strict");
const test = require("node:test");

const { casesConfig, provesFindings, testerProves } = require("./run-cases.cjs");
const { idShape } = require("./run-cases-proves.cjs");

// The brief's `Tester proves:` line names the cases the gate holds the branch to. A path with a
// line number, a section number or a date on that line once became a case id no commit could
// answer, so the gate was red before it ran a command. Only a token of the host's case-id shape,
// group 1 of a case opener, is a case id now.
const settings = (...openers) => casesConfig({ cases: { files: openers.map((opener, at) => ({ path: `cases-${at}.md`, case: opener })) } }, "test");
const HOST = settings("^### (TC-\\d+)");
const shape = (...openers) => idShape(settings(...openers));

test("the Tester proves line keeps the case ids and drops a path with a line number", () => {
  assert.deepEqual(testerProves("# Demo\n\nTester proves: TC-1, x.md:42\n", idShape(HOST)), ["TC-1"]);
});

test("a case id wrapped in brackets, emphasis, code or a trailing stop still counts", () => {
  const text = "**Tester proves:** TC-1 (TC-2 and `TC-3`, **TC-4**. stub at integration/TEST-CASES.md:4752 dated 2026-11-15, section 7)";
  assert.deepEqual(testerProves(text, idShape(HOST)), ["TC-1", "TC-2", "TC-3", "TC-4"]);
});

test("a token is an id only when the whole of it has the shape", () => {
  assert.deepEqual(testerProves("Tester proves: TC-1x, xTC-1, TC-, TC-12", idShape(HOST)), ["TC-12"]);
});

test("a brief without the line proves nothing", () => {
  assert.deepEqual(testerProves("# Demo\n\nNo tester line.\n", idShape(HOST)), []);
  assert.deepEqual(testerProves(undefined, idShape(HOST)), []);
});

test("the shape is group 1 of each opener, past escapes, classes, lookarounds and groups that capture nothing", () => {
  const cases = [
    [["^### (TC-\\d+)"], ["TC-7"], ["TC-7a", "7"]],
    [["^\\s*- \\*\\*([A-Z][\\w-]+)\\*\\*"], ["HC-tray"], ["hc-tray"]],
    [["^(?:#+) \\[(?<id>[A-Z]+-\\d+)\\]"], ["AB-3"], ["#", "AB"]],
    [["^[(]x\\) (C\\d+)"], ["C4"], ["x", "C"]],
    [["^[\\](]+ (C\\d+)"], ["C5"], ["]("]],
    [["^(?=#)#+ (?<!x)(\\d+)\\."], ["12"], ["#", "x"]],
    [["^### (TC-(?:\\d+))"], ["TC-8"], ["TC-"]],
    [["^### (TC-\\d+)", "^## (HC-\\w+)"], ["TC-9", "HC-quit"], ["HC-"]],
  ];
  for (const [openers, ids, others] of cases) {
    const built = shape(...openers);
    for (const id of ids) assert.equal(built.test(id), true, `${openers}: ${id}`);
    for (const other of others) assert.equal(built.test(other), false, `${openers}: ${other}`);
  }
});

// No shape: the host configures no cases, or no opener of it captures an id. The gate then reads
// the line as it did before the shape: every token that holds a digit.
test("with no shape the line keeps every token that holds a digit, as before", () => {
  assert.equal(idShape(null), null);
  assert.equal(shape("^### TC-\\d+"), null);
  assert.deepEqual(testerProves("Tester proves: TC-1, x.md:42 and more", null), ["TC-1", "xmd42"]);
});

// The plan lint refuses the line when it names anything else, with the token and the shape.
const configOf = (config) => () => config;

test("the lint finds each token of the line that is no case id, and names the shape it wants", () => {
  const found = provesFindings("Tester proves: TC-1 (stub at x.md:42)\n", configOf({ cases: { files: [{ path: "c.md", case: "^### (TC-\\d+)" }] } }));
  assert.equal(found.length, 1);
  assert.match(found[0], /^brief: the Tester proves line names "stub", "at", "x\.md:42", which are no case ids of the shape \/\^\(\?:TC-\\d\+\)\$\/; it names case ids alone$/);
  const one = provesFindings("Tester proves: TC-1, x.md:42\n", configOf({ cases: { files: [{ path: "c.md", case: "^### (TC-\\d+)" }] } }));
  assert.match(one[0], /names "x\.md:42", which is no case id of the shape/);
});

test("the lint finds nothing on a line of case ids alone, on no line, and on a host with no shape", () => {
  const host = configOf({ cases: { files: [{ path: "c.md", case: "^### (TC-\\d+)" }] } });
  assert.deepEqual(provesFindings("Tester proves: TC-1, **TC-2**\n", host), []);
  assert.deepEqual(provesFindings("Tester proves: x.md:42\n", configOf({})), []);
  assert.deepEqual(provesFindings("Tester proves: x.md:42\n", configOf({ cases: { files: [{ path: "c.md", case: "^### TC-\\d+" }] } })), []);
});

test("the lint reads no config for a brief whose line names nothing", () => {
  const never = () => {
    throw new Error("config read");
  };
  assert.deepEqual(provesFindings("# Demo\n", never), []);
  assert.deepEqual(provesFindings("Tester proves:\n", never), []);
});
