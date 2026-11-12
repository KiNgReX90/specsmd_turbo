const assert = require("node:assert/strict");
const test = require("node:test");

// A red run is a caught mistake only when the test ran and noticed it. A Rust build that failed and
// a JavaScript file that does not parse never reach the test, so they read no verdict, and so does a
// red run that printed no test summary reporting a failure. The texts below are what cargo,
// node --test, node, vitest (4.0 with esbuild, 4.1 with oxc and rolldown), Playwright and Jest
// print, cut down to the lines that decide.

const { verdictOf } = require("./run-mutate-verdict.cjs");

const ABS = "/w/app/src/s.ts";
const run = (code, extra = {}) => ({ code, signal: null, ...extra });

const CARGO_FAILED = "error[E0308]: mismatched types\n --> src/lib.rs:3:5\n\nerror: could not compile `fixture` (lib test) due to 1 previous error\n";
const CARGO_RED = "running 1 test\ntest tests::add ... FAILED\n\nfailures:\n\ntest result: FAILED. 0 passed; 1 failed\nerror: test failed, to rerun pass `--lib`\n";
const CARGO_KILLED = "running 1 test\nerror: test failed, to rerun pass `--lib`\n\nCaused by:\n  process didn't exit successfully: `/t/deps/fixture-1` (signal: 9, SIGKILL: kill)\n";

const NODE_CJS = `  /w/app/src/s.ts:1\n  module.exports = (if 1 { 2 });\n                    ^^\n  \n  SyntaxError: Unexpected token 'if'\n      at wrapSafe (node:internal/modules/cjs/loader:1743:18)\n`;
const NODE_ESM = `file:///w/app/src/s.ts:1\nexport const v = (if 1 { 2 });\n                  ^^\n\nSyntaxError: Unexpected token 'if'\n    at compileSourceTextModule (node:internal/modules/esm/utils:318:16)\n`;
const NODE_TS = `/w/app/src/s.ts:1\nexport const v: number = (if 1 { 2 });\n                          ^^\n\nSyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: Expression expected\n    at parseTypeScript (node:internal/modules/typescript:72:36)\n`;
const NODE_RUNTIME = `/w/app/src/s.ts:1\nmodule.exports = JSON.parse('{bad');\n                      ^\n\nSyntaxError: Expected property name or '}' in JSON at position 1\n    at JSON.parse (<anonymous>)\n    at Object.<anonymous> (/w/app/src/s.ts:1:23)\n\u2139 tests 1\n\u2139 pass 0\n\u2139 fail 1\n`;
const VITEST_ESBUILD = ` FAIL  a.test.ts [ a.test.ts ]\nError: Transform failed with 1 error:\n/w/app/src/s.ts:1:26: ERROR: Unexpected "if"\n  Plugin: vite:esbuild\n  File: /w/app/src/s.ts:1:26\n`;
const VITEST_OXC = ` FAIL  a.test.ts [ a.test.ts ]\nError: Transform failed with 1 error:\n\n[PARSE_ERROR] Unexpected token\n   ╭─[ s.ts:1:27 ]\n───╯\n\n  Plugin: vite:oxc\n  File: /w/app/src/s.ts\n`;
const VITEST_ROLLDOWN = ` FAIL  j.test.ts [ j.test.ts ]\nRolldownError: Parse failure: Parse failed with 1 error:\nUnexpected token\nAt file: /src/s.ts:2:18\n  File: /src/s.ts:2:18\n`;
const VITEST_RUNTIME = ` FAIL  c.test.ts > two\nSyntaxError: runtime boom\n ❯ thrower src/s.ts:2:45\n\n Test Files  1 failed (1)\n      Tests  1 failed | 1 passed (2)\n`;
const VITEST_OTHER_FILE = ` FAIL  a.test.ts [ a.test.ts ]\nError: Transform failed with 1 error:\n  Plugin: vite:oxc\n  File: /w/app/src/other.ts\n\n Test Files  1 failed (1)\n      Tests  no tests\n`;

// A red run that never reached a test: remote-run refusing, a missing binary, a wrapper error.
const REFUSED = "remote-run: a run of this tree is already going on delta, refusing\n";
const NODE_NONE_FAILED = "\u2139 tests 3\n\u2139 pass 3\n\u2139 fail 0\n\u2139 cancelled 0\n";
const TAP_NONE_FAILED = "# tests 3\n# pass 3\n# fail 0\n";
// The summary each runner prints when a test failed.
const NODE_FAILED = "\u2716 adds (1.2ms)\n\u2139 tests 2\n\u2139 pass 1\n\u2139 fail 1\n";
const TAP_FAILED = "not ok 1 - adds\n1..1\n# tests 1\n# pass 0\n# fail 1\n";
const VITEST_FAILED = " FAIL  a.test.ts > adds\nAssertionError: expected 2 to be 1\n\n Test Files  1 failed (1)\n      Tests  1 failed | 2 passed (3)\n";
const VITEST_FILES_FAILED = " FAIL  a.test.ts [ a.test.ts ]\nError: boom at import\n\n Test Files  1 failed (1)\n      Tests  no tests\n";
const PLAYWRIGHT_FAILED = "  1) [chromium] \u203a a.spec.ts:3:1 \u203a adds\n\n  1 failed\n    [chromium] \u203a a.spec.ts:3:1 \u203a adds\n  4 passed (2.1s)\n";
const JEST_FAILED = "FAIL src/a.test.js\n  \u25cf adds\n\nTest Suites: 1 failed, 1 total\nTests:       1 failed, 2 passed, 3 total\n";
const ANSI_NODE_FAILED = "\x1b[34m\u2139 fail 1\x1b[39m\n";

for (const [name, result, text, expected] of [
  ["a green run", run(0), "test result: ok", { caught: false }],
  ["a red cargo test", run(101), CARGO_RED, { caught: true }],
  ["a cargo build that failed", run(101), CARGO_FAILED, { caught: null, why: "did not build" }],
  ["a test binary the cap killed", run(101), CARGO_KILLED, { caught: null, why: /killed/ }],
  ["a run killed with exit 137", run(137), "", { caught: null, why: /killed \(exit 137\)/ }],
  ["a run that ended on a signal", run(1, { signal: "SIGTERM" }), "", { caught: null, why: /ended on SIGTERM/ }],
  ["node failing to parse the file under CommonJS", run(1), NODE_CJS, { caught: null, why: "did not parse" }],
  ["node failing to parse the file as a module", run(1), NODE_ESM, { caught: null, why: "did not parse" }],
  ["node failing to strip the file's types", run(1), NODE_TS, { caught: null, why: "did not parse" }],
  ["a SyntaxError the code throws while it runs", run(1), NODE_RUNTIME, { caught: true }],
  ["vitest with esbuild failing to transform the file", run(1), VITEST_ESBUILD, { caught: null, why: "did not parse" }],
  ["vitest with oxc failing to transform the file", run(1), VITEST_OXC, { caught: null, why: "did not parse" }],
  ["vitest with rolldown failing to parse the file", run(1), VITEST_ROLLDOWN, { caught: null, why: "did not parse" }],
  ["vitest reporting a SyntaxError a test threw", run(1), VITEST_RUNTIME, { caught: true }],
  ["vitest failing to transform another file", run(1), VITEST_OTHER_FILE, { caught: true }],
  ["a red run with no test summary", run(2), REFUSED, { caught: null, why: /^no test summary.*\(exit 2\)$/ }],
  ["a red run that printed nothing", run(79), "", { caught: null, why: /^no test summary.*\(exit 79\)$/ }],
  ["a summary of fail 0 under a non-zero exit", run(1), NODE_NONE_FAILED, { caught: null, why: /^no test summary.*\(exit 1\)$/ }],
  ["a TAP summary of fail 0 under a non-zero exit", run(1), TAP_NONE_FAILED, { caught: null, why: /^no test summary.*\(exit 1\)$/ }],
  ["a red run whose node --test summary reports a failure", run(1), NODE_FAILED, { caught: true }],
  ["a red run whose TAP summary reports a failure", run(1), TAP_FAILED, { caught: true }],
  ["a red run whose coloured node --test summary reports a failure", run(1), ANSI_NODE_FAILED, { caught: true }],
  ["a red run whose vitest summary reports a failed test", run(1), VITEST_FAILED, { caught: true }],
  ["a red run whose vitest summary reports a failed file", run(1), VITEST_FILES_FAILED, { caught: true }],
  ["a red run whose Playwright summary reports a failure", run(1), PLAYWRIGHT_FAILED, { caught: true }],
  ["a red run whose Jest summary reports a failure", run(1), JEST_FAILED, { caught: true }],
  ["a cargo build that failed under a failing summary", run(101), CARGO_FAILED + "test result: FAILED. 0 passed; 1 failed\n", { caught: null, why: "did not build" }],
  ["node failing to parse the file under a failing summary", run(1), NODE_CJS + NODE_FAILED, { caught: null, why: "did not parse" }],
]) {
  test(`${name} reads ${expected.caught === null ? "no verdict" : `caught ${expected.caught ? "yes" : "no"}`}`, () => {
    const verdict = verdictOf(result, text, ABS);
    assert.equal(verdict.caught, expected.caught);
    if (expected.why instanceof RegExp) assert.match(verdict.why, expected.why);
    else if (expected.why) assert.equal(verdict.why, expected.why);
  });
}

// A compiler that a signal ended makes cargo exit 101 with `error: could not compile`, as a build
// that failed does. The machine killed it, so it is a kill, and a crate no mutated file belongs to
// that did not compile is never the mutant's doing.
const fs = require("node:fs");
const path = require("node:path");
const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");

const SCCACHE_KILLED = "   Compiling dep-utils v2.0.0\nsccache: Compiler killed by signal 15\nerror: could not compile `dep-utils` (lib)\n\nCaused by:\n  process didn't exit successfully: `sccache rustc --crate-name dep_utils` (exit status: 254)\n";
const LINKER_KILLED = "collect2: fatal error: ld terminated with signal 9 [Killed]\nerror: could not compile `shop` (bin \"shop\") due to 1 previous error\n";
const OTHER_CRATE = "   Compiling dep-ui v0.18.0\nerror: failed to run custom build command for `dep-ui-sys v0.18.0`\nerror: could not compile `dep-ui` (lib) due to 1 previous error\n";
const OWN_CRATE = "error[E0308]: mismatched types\n --> src/lib.rs:3:5\nerror: could not compile `shop-core` (lib) due to 1 previous error\n";
const PRINTED_KILL = "running 1 test\ntest tests::supervisor ... FAILED\nchild killed by signal 15\n\ntest result: FAILED. 0 passed; 1 failed\n";

/** A tree whose crate `shop-core` holds src/lib.rs, and a src/notes.txt that belongs to no crate. */
function crateTree() {
  const root = tempDir("inferno-verdict-crate-");
  fs.mkdirSync(path.join(root, ".git"));
  fs.mkdirSync(path.join(root, "core", "src"), { recursive: true });
  writeFile(path.join(root, "core", "Cargo.toml"), "[package]\nname = \"shop-core\"\nversion = \"0.1.0\"\n\n[dependencies]\nname-tool = \"1\"\n");
  writeFile(path.join(root, "core", "src", "lib.rs"), "pub fn one() -> u8 { 1 }\n");
  fs.mkdirSync(path.join(root, "src"));
  writeFile(path.join(root, "src", "notes.txt"), "one\n");
  return { lib: path.join(root, "core", "src", "lib.rs"), notes: path.join(root, "src", "notes.txt") };
}

test("a compiler a signal ended reads killed, never did not build", () => {
  const { lib } = crateTree();
  assert.deepEqual(verdictOf(run(101), SCCACHE_KILLED, lib), { caught: null, why: "killed (SIGTERM)" });
  assert.deepEqual(verdictOf(run(101), SCCACHE_KILLED, null, { files: [] }), { caught: null, why: "killed (SIGTERM)" });
  assert.deepEqual(verdictOf(run(101), LINKER_KILLED, lib), { caught: null, why: "killed (SIGKILL)" });
});

test("a kill a test prints in its own output stays the test's red", () => {
  assert.deepEqual(verdictOf(run(101), PRINTED_KILL, ABS), { caught: true });
});

test("a crate no mutated file belongs to that did not compile is not the mutant's build", () => {
  const { lib } = crateTree();
  const verdict = verdictOf(run(101), OTHER_CRATE, lib);
  assert.equal(verdict.caught, null);
  assert.notEqual(verdict.why, "did not build");
  assert.match(verdict.why, /dep-ui/);
  assert.match(verdict.why, /no mutated file belongs to/);
  assert.equal(verdictOf(run(101), OTHER_CRATE, null, { files: [lib] }).why, verdict.why);
});

test("the mutated file's own crate that did not compile, or a crate nothing can tell, reads did not build", () => {
  const { lib, notes } = crateTree();
  assert.deepEqual(verdictOf(run(101), OWN_CRATE, lib), { caught: null, why: "did not build" });
  assert.deepEqual(verdictOf(run(101), OTHER_CRATE + OWN_CRATE, lib), { caught: null, why: "did not build" });
  assert.deepEqual(verdictOf(run(101), OTHER_CRATE, notes), { caught: null, why: "did not build" });
  assert.deepEqual(verdictOf(run(101), OTHER_CRATE, null, { files: [lib, notes] }), { caught: null, why: "did not build" });
});

// A check, a contract script or a lint, prints no test runner's summary. A host names its checks
// with the line each prints on a finding, and a red run that printed that line is caught. The same
// command ended by a wrapper error printed no such line, so it still reads no verdict.
const CHECKS = [{ match: /^npm run check:wire\b/, finding: /^WIRE MISMATCH: /m }];
const WIRE_FOUND = "> shop@1.0.0 check:wire\n> node scripts/wire.mjs\n\nWIRE MISMATCH: gift_card.amount is a string on the wire\n";

test("a listed check whose red run printed its finding line reads caught", () => {
  assert.deepEqual(verdictOf(run(1), WIRE_FOUND, ABS, { test: "npm run check:wire", checks: CHECKS }), { caught: true });
});

test("a listed check that a wrapper error ended reads no verdict, and its green run reads caught no", () => {
  const verdict = verdictOf(run(2), REFUSED, ABS, { test: "npm run check:wire", checks: CHECKS });
  assert.equal(verdict.caught, null);
  assert.match(verdict.why, /^no test summary.*\(exit 2\)/);
  assert.doesNotMatch(verdict.why, /cannot prove/);
  assert.deepEqual(verdictOf(run(0), WIRE_FOUND, ABS, { test: "npm run check:wire", checks: CHECKS }), { caught: false });
});

test("a finding line of a command no check lists is no verdict", () => {
  const verdict = verdictOf(run(1), WIRE_FOUND, ABS, { test: "node scripts/wire.mjs", checks: CHECKS });
  assert.equal(verdict.caught, null);
});

test("no summary on a command that is no known runner names the gate mark and the host key", () => {
  for (const test of ["npm run check:wire", "node scripts/clause-map.mjs", "bash tools/lint.sh src"]) {
    const verdict = verdictOf(run(1), WIRE_FOUND, ABS, { test });
    assert.match(verdict.why, /^no test summary reports a failure \(exit 1\)/);
    assert.match(verdict.why, /a check cannot prove a mutant/);
    assert.match(verdict.why, /\(gate: <name>\)/);
    assert.match(verdict.why, /mutate\.checks/);
  }
});

test("no summary on a known runner's command says only that", () => {
  for (const test of ["cargo test --manifest-path core/Cargo.toml one", "node --test test/a.test.cjs", "npx vitest run a.test.ts",
    "npm test", "npm run test:unit", "npx playwright test", "npx jest a", "tools/remote.sh . cargo test one"]) {
    assert.equal(verdictOf(run(2), REFUSED, ABS, { test }).why, "no test summary reports a failure (exit 2)", test);
  }
});
