const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

// A shell exits 127 when it cannot find a command and 126 when it cannot execute one. Neither is a
// test noticing a mistake: the tree the test ran in lacks what the test calls. Such a run reads no
// verdict, and its reason names the exit, the line of the log that says what was missing, and what
// the host does about it, so nobody opens a log on another machine to learn it.

const { LINE_MAX, TAIL, verdictOf } = require("./run-mutate-verdict.cjs");
const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");

const ABS = "/w/app/src/s.ts";
const run = (code, extra = {}) => ({ code, signal: null, ...extra });
const HOST = "the host prepares that tree in the command mutate.run names or in mutate.session.open";
const NOT_FOUND = (line) => `the test's command was not found (exit 127): ${line}; the tree the test ran in lacks that command, and ${HOST}`;
const NOT_RUN = (line) => `the test's command could not be executed (exit 126): ${line}; the tree the test ran in holds that command but cannot run it, and ${HOST}`;

// What a host's wrapper prints around a test whose tree has no node_modules: the package script,
// the shell's line, and the wrapper's own last word.
const WRAPPED_127 = "> shop@1.0.0 build\n> shopgen build\n\nsh: 1: shopgen: not found\nremote-test: exit 127\n";

test("a run that exits 127 after a command not found reads no verdict, naming that line and what the host does", () => {
  assert.deepEqual(verdictOf(run(127), WRAPPED_127, ABS, { test: "npm --prefix site run build && node --test site/test/a.test.mjs" }),
    { caught: null, why: NOT_FOUND("sh: 1: shopgen: not found"), missing: true });
});

test("a run that exits 126 reads that the command could not be executed", () => {
  const text = "bash: line 1: ./tools/build.sh: Permission denied\nremote-test: exit 126\n";
  assert.deepEqual(verdictOf(run(126), text, ABS), { caught: null, why: NOT_RUN("bash: line 1: ./tools/build.sh: Permission denied"), missing: true });
});

test("the line named is the last one that says why a command could not run, past the wrapper's own words", () => {
  for (const line of [
    "bash: line 1: shopgen: command not found",
    "bash: ./bin/check: Permission denied",
    "bash: ./bin/check: cannot execute binary file: Exec format error",
    "/usr/bin/env: 'node': No such file or directory",
  ]) {
    const text = `building\n${line}\nremote-test: the run ended\nremote-test: exit 127\n`;
    assert.equal(verdictOf(run(127), text, ABS).why, NOT_FOUND(line), line);
  }
});

test("without a line that names the failure the last line is named, colour codes cut, a carriage return ending a line", () => {
  assert.equal(verdictOf(run(127), "building\nstep two\n", ABS).why, NOT_FOUND("step two"));
  assert.equal(verdictOf(run(127), "\x1b[31mstep \x1b[1;31mtwo\x1b[0m\n   \n\n", ABS).why, NOT_FOUND("step two"));
  assert.equal(verdictOf(run(127), "fetch 10%\rfetch 100%\rsh: 1: shopgen: not found\rremote-test: exit 127\r\n", ABS).why,
    NOT_FOUND("sh: 1: shopgen: not found"));
});

test("only the tail is searched for a line that names the failure", () => {
  const tail = (count) => Array.from({ length: count }, (_, i) => `step ${i + 1}`).join("\n");
  assert.equal(verdictOf(run(127), `sh: 1: shopgen: not found\n${tail(TAIL - 1)}\n`, ABS).why, NOT_FOUND("sh: 1: shopgen: not found"));
  assert.equal(verdictOf(run(127), `sh: 1: shopgen: not found\n${tail(TAIL)}\n`, ABS).why, NOT_FOUND(`step ${TAIL}`));
});

test("a long line is cut to a fixed length, and a log with no line still reads well", () => {
  assert.deepEqual([TAIL, LINE_MAX], [20, 200], "the tail searched and the cut length");
  const whole = "x".repeat(LINE_MAX);
  assert.equal(verdictOf(run(127), `${whole}\n`, ABS).why, NOT_FOUND(whole));
  assert.equal(verdictOf(run(127), `${whole}yz\n`, ABS).why, NOT_FOUND(`${whole}...`));
  assert.equal(verdictOf(run(127), "", ABS).why,
    `the test's command was not found (exit 127), and its log holds no line; the tree the test ran in lacks that command, and ${HOST}`);
  assert.equal(verdictOf(run(127), " \n\r\n", ABS).why, verdictOf(run(127), "", ABS).why);
});

// The other readings keep their place: a kill, a build that did not compile and a file that does not
// parse read before it, as each can end a chain whose last command was not found. A failing test
// summary or a listed check's finding line is the test noticing, so it reads caught whatever the exit.
const CARGO_FAILED = "error[E0308]: mismatched types\n --> src/lib.rs:3:5\n\nerror: could not compile `fixture` (lib test) due to 1 previous error\n";
const CARGO_KILLED = "running 1 test\nerror: test failed\n  process didn't exit successfully: `/t/deps/fixture-1` (signal: 9, SIGKILL: kill)\n";
const NODE_CJS = `  /w/app/src/s.ts:1\n  module.exports = (if 1 { 2 });\n                    ^^\n  \n  SyntaxError: Unexpected token 'if'\n      at wrapSafe (node:internal/modules/cjs/loader:1743:18)\n`;
const CHECKS = [{ match: /^npm run check:wire\b/, finding: /^WIRE MISMATCH: /m }];

test("a kill, a build that did not compile and a file that does not parse keep their own reading under exit 127", () => {
  const missing = "sh: 1: cleanup: not found\n";
  assert.deepEqual(verdictOf(run(127), CARGO_KILLED + missing, ABS), { caught: null, why: "killed (SIGKILL)" });
  assert.deepEqual(verdictOf(run(127), CARGO_FAILED + missing, ABS), { caught: null, why: "did not build" });
  assert.deepEqual(verdictOf(run(127), NODE_CJS + missing, ABS), { caught: null, why: "did not parse" });
  assert.deepEqual(verdictOf(run(127, { signal: "SIGTERM" }), missing, ABS), { caught: null, why: "ended on SIGTERM" });
});

test("a failing summary or a listed check's finding line under exit 127 is the test noticing, and reads caught", () => {
  assert.deepEqual(verdictOf(run(127), "ℹ fail 1\nsh: 1: cleanup: not found\n", ABS), { caught: true });
  assert.deepEqual(verdictOf(run(127), "WIRE MISMATCH: amount\nsh: 1: cleanup: not found\n", ABS, { test: "npm run check:wire", checks: CHECKS }), { caught: true });
  assert.equal(verdictOf(run(127), "ℹ fail 0\nsh: 1: cleanup: not found\n", ABS).why, NOT_FOUND("sh: 1: cleanup: not found"));
  assert.equal(verdictOf(run(127), "sh: 1: wire: not found\n", ABS, { test: "npm run check:wire", checks: CHECKS }).why, NOT_FOUND("sh: 1: wire: not found"));
});

test("a plain check or a command no runner starts reads the reason too, without the check hint", () => {
  assert.deepEqual(verdictOf(run(127), "sh: 1: rg: not found\n", null, { test: "test $(rg -c X src) -eq 0", check: true }),
    { caught: null, why: NOT_FOUND("sh: 1: rg: not found"), missing: true });
  assert.deepEqual(verdictOf(run(1), "", null, { test: "test $(rg -c X src) -eq 0", check: true }), { caught: true });
  assert.equal(verdictOf(run(127), "sh: 1: rg: not found\n", ABS, { test: "bash tools/lint.sh src" }).why, NOT_FOUND("sh: 1: rg: not found"));
  assert.match(verdictOf(run(2), "", ABS, { test: "bash tools/lint.sh src" }).why, /check: true/, "any other exit keeps the hint");
});

// A run whose last line is the host's refusal (`verification.refused`) never reached the test: the
// wrapper ran nothing, so its exit names no command of the test and it reads as it did before.
function refusedLog(text) {
  const file = path.join(tempDir("inferno-verdict-missing-"), "run.log");
  writeFile(file, text);
  return file;
}
const REFUSED = { verification: { refused: "^wrapper: no machine free" } };

test("a refusal of the host's wrapper that exits 127 reads as before, and no other line is taken for it", () => {
  const log = refusedLog("sh: 1: ssh: not found\nwrapper: no machine free, refusing\n");
  const text = "sh: 1: ssh: not found\nwrapper: no machine free, refusing\n";
  const test = "npm test";
  assert.deepEqual(verdictOf(run(127, { log }), text, ABS, { test, config: REFUSED }), { caught: null, why: "no test summary reports a failure (exit 127)" });
  assert.equal(verdictOf(run(127, { log }), text, ABS, { test }).why, NOT_FOUND("sh: 1: ssh: not found"), "without the key it is a missing command");
  const narrowed = { verification: { ...REFUSED.verification, refused_exit: "75" } };
  assert.equal(verdictOf(run(127, { log }), text, ABS, { test, config: narrowed }).why, NOT_FOUND("sh: 1: ssh: not found"), "a refusal exits 75 only");
});
