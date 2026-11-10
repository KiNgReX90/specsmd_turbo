const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

// A host whose tests run through a wrapper that first syncs the tree to another machine and
// waits there for a slot paid that sync and that wait once per mutant. With `mutate.session`
// the mutants that share a test command share one session of the wrapper: one open, then per
// mutant the changed file is sent, the test runs there, and the file is restored and sent back.
// A fake wrapper (run-mutate-session-fixture.cjs) logs every call and keeps a remote copy, so a
// test counts the opens and sees which copy each run was judged on.

const {
  LINES, calls, checks, journalOf, mutated, outsideConfig, readIn, sessionBatch, sessionBlock, sessionTree, wrapped,
} = require("./run-mutate-session-fixture.cjs");
const { git } = require("./run-mutate-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

const CONFIG = `mutate:\n${sessionBlock()}`;
/** The shared test: green while lines 1 and 3 hold, so a mutant of line 2 survives it. */
const SHARED = wrapped(checks("alpha = 1", "gamma = 3"));
const THREE = [
  { criterion: "AC1", file: "src/m.txt", line: 1, find: "1", replace: "7", test: SHARED },
  { criterion: "AC2", file: "src/m.txt", line: 2, find: "2", replace: "8", test: SHARED },
  { criterion: "AC3", file: "src/m.txt", line: 3, find: "3", replace: "9", test: SHARED },
];
const HELD = [mutated(1, "1", "7"), mutated(2, "2", "8"), mutated(3, "3", "9")];

const count = (f, mode) => calls(f, mode).length;

/** The tree, the remote copy and the journal are as they were before the batch. */
function assertWhole(f) {
  assert.equal(readIn(f, "src/m.txt"), LINES);
  assert.equal(git(f.tree, "status", "--porcelain"), "");
  assert.equal(journalOf(f), null);
}

test("three mutants that share one test command pay for one session: one open, three runs, three verdicts in order", (t) => {
  const f = sessionTree(t);
  const result = sessionBatch(f, THREE, { config: outsideConfig(f, CONFIG), json: true });

  assert.equal(count(f, "open"), 1, "the tree is synced once");
  assert.equal(count(f, "direct"), 0, "no mutant pays the wrapper in full");
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => [e.criterion, e.form, e.caught]),
    [["AC1", "session", true], ["AC2", "session", false], ["AC3", "session", true]]);
  assert.equal(result.payload.sessions, 1);
  const runs = calls(f, "run");
  assert.deepEqual(runs.map((run) => run.test), Array(3).fill(checks("alpha = 1", "gamma = 3")), "the session runs the test the match left");
  assert.deepEqual(runs.map((run) => run.held["src/m.txt"]), HELD, "each run is judged on a copy that holds its own mutant alone");
  assert.deepEqual(calls(f, "send").map((send) => send.file), Array(6).fill("src/m.txt"), "only the changed file goes in, and back");
  assert.equal(count(f, "close"), 1);
  const session = calls(f, "open")[0].session;
  assert.ok(calls(f).every((call) => call.session === session && call.tree === f.tree), "every call names the one session and the tree");
  assert.ok(!session.startsWith(f.tree + path.sep), "the session's directory is outside the tree");
  assert.equal(fs.readFileSync(path.join(f.remote, "src/m.txt"), "utf8"), LINES, "the remote copy is whole again");
  assertWhole(f);
});

test("without mutate.session the batch is as today, byte for byte, and each test pays its wrapper in full", (t) => {
  const f = sessionTree(t);
  const result = sessionBatch(f, THREE);
  assert.equal(result.code, 0, result.out + result.err);
  const paste = THREE.flatMap((e, i) => [`  - criterion: "${e.criterion}"`, `    test: ${JSON.stringify(SHARED)}`, `    caught: ${i === 1 ? "no" : "yes"}`]);
  assert.equal(result.out, [
    "caught yes | src/m.txt:1 | AC1",
    "caught no | src/m.txt:2 | AC2",
    "caught yes | src/m.txt:3 | AC3",
    "0 builds for 0 Rust entries (0 switched, 0 on a build of their own); 3 other entries ran a test once in place",
    "paste under mutants:",
    ...paste,
    "",
  ].join("\n"));
  assert.equal(count(f, "direct"), 3);
  assert.equal(count(f, "open"), 0);
  const json = sessionBatch(f, THREE, { json: true });
  assert.deepEqual(Object.keys(json.payload), ["builds", "rust", "switched", "entries", "paste", "restored"]);
  assert.deepEqual(json.payload.entries.map((e) => e.form), ["classic", "classic", "classic"]);
  assertWhole(f);
});

test("a test command the match does not reach runs in place beside the sessions, one session per test command, rows in the order given", (t) => {
  const f = sessionTree(t);
  const other = wrapped(checks("beta = 2"));
  const result = sessionBatch(f, [
    THREE[0],
    { criterion: "AC2", file: "src/m.txt", line: 2, find: "2", replace: "8", test: checks("beta = 2") },
    THREE[2],
    { criterion: "AC4", file: "src/m.txt", line: 1, find: "1", replace: "5", test: other },
  ], { config: outsideConfig(f, CONFIG) });
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^caught yes \| src\/m\.txt:1 \| AC1\ncaught yes \| src\/m\.txt:2 \| AC2\ncaught yes \| src\/m\.txt:3 \| AC3\ncaught no \| src\/m\.txt:1 \| AC4\n/);
  assert.match(result.out, /^0 builds for 0 Rust entries \(0 switched, 0 on a build of their own\); 1 other entry ran a test once in place; 3 other entries shared 2 sessions of the host's wrapper$/m);
  assert.equal(count(f, "open"), 2);
  assert.equal(count(f, "close"), 2);
  assert.deepEqual(calls(f, "run").map((run) => run.held["src/m.txt"]), [HELD[0], HELD[2], mutated(1, "1", "5")]);
  assertWhole(f);
});

test("a match that reaches a test command only past its start leaves that command in place", (t) => {
  const f = sessionTree(t);
  const config = outsideConfig(f, `mutate:\n${sessionBlock({ match: "remote\\.cjs direct " })}`);
  const result = sessionBatch(f, THREE, { config, json: true });
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(count(f, "open"), 0);
  assert.equal(count(f, "direct"), 3);
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught]), [["classic", true], ["classic", false], ["classic", true]]);
});

test("a session that does not open reads no verdict for its mutants, runs none of them, and still closes", (t) => {
  const f = sessionTree(t);
  const result = sessionBatch(f, THREE, { config: outsideConfig(f, CONFIG), act: "open@1=fail" });
  assert.equal(result.code, 0, result.out + result.err);
  for (const n of [1, 2, 3]) {
    assert.match(result.out, new RegExp(`^no verdict: the session did not open \\(exit 3 -> \\S+\\.log\\) \\| src/m\\.txt:${n} \\| AC${n}$`, "m"));
  }
  assert.doesNotMatch(result.out, /caught (yes|no)|paste under mutants/);
  assert.equal(count(f, "run"), 0);
  assert.equal(count(f, "send"), 0);
  assert.equal(count(f, "close"), 1, "a failed open may hold the slot, so the close runs");
  assertWhole(f);
});

test("a send of the mutant that fails reads no verdict for it, the file still goes back, and the next mutant is judged on a whole copy", (t) => {
  const f = sessionTree(t);
  const result = sessionBatch(f, THREE, { config: outsideConfig(f, CONFIG), act: "send@1=fail", json: true });
  assert.equal(result.code, 0, result.out + result.err);
  const rows = result.payload.entries;
  assert.equal(rows[0].caught, null);
  assert.match(rows[0].why, /^the send of src\/m\.txt into the session failed \(exit 3 -> \S+\.log\)$/);
  assert.deepEqual(rows.slice(1).map((e) => e.caught), [false, true]);
  assert.deepEqual(calls(f, "run").map((run) => run.held["src/m.txt"]), [HELD[1], HELD[2]]);
  assert.equal(count(f, "send"), 6, "the failed send, its send back, and two of each for the others");
  assertWhole(f);
});

test("a send back that fails stops its group: the mutant it held keeps its verdict, no later one is judged on that copy, and the next session runs", (t) => {
  const f = sessionTree(t);
  const result = sessionBatch(f, [...THREE, { criterion: "AC4", file: "src/m.txt", line: 2, find: "2", replace: "6", test: wrapped(checks("beta = 2")) }],
    { config: outsideConfig(f, CONFIG), act: "send@2=fail", json: true });
  assert.equal(result.code, 0, result.out + result.err);
  const rows = result.payload.entries;
  assert.equal(rows[0].caught, true);
  for (const row of rows.slice(1, 3)) {
    assert.equal(row.caught, null);
    assert.match(row.why, /^the send of src\/m\.txt back into the session failed \(exit 3 -> \S+\.log\), so the session may still hold the mutant of entry 1 and its group stopped$/);
  }
  assert.equal(rows[3].caught, true, "the next session opens a whole copy of its own");
  assert.deepEqual(calls(f, "run").map((run) => run.held["src/m.txt"]), [HELD[0], mutated(2, "2", "6")]);
  assert.equal(count(f, "open"), 2);
  assert.equal(count(f, "close"), 2);
  assertWhole(f);
});

test("a close that fails is told after the rows, and the verdicts stand", (t) => {
  const f = sessionTree(t);
  const result = sessionBatch(f, THREE, { config: outsideConfig(f, CONFIG), act: "close@1=fail", json: true });
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => e.caught), [true, false, true]);
  assert.equal(result.payload.notes.length, 1);
  assert.match(result.payload.notes[0], /^the close of the session for node remote\.cjs direct .* failed \(exit 3 -> \S+\.log\); close it on the host$/);
  const human = sessionBatch(f, THREE, { config: outsideConfig(f, CONFIG), act: "close@2=fail" });
  assert.match(human.out, /shared 1 session of the host's wrapper\nthe close of the session for .* failed \(exit 3 -> \S+\.log\); close it on the host\npaste under mutants:/);
  assertWhole(f);
});

// A session command, or the test the session runs, that a signal ended stops the batch: no run
// starts after it, every entry still to run reads not run, the session closes and the tree is whole.
for (const [act, stop, ran] of [
  ["open@1=exit143", /^the session's open ended on SIGTERM, so the batch stopped$/m, 0],
  ["send@1=signal", /^the send of src\/m\.txt ended on SIGTERM, so the batch stopped$/m, 0],
  ["send@2=exit143", /^the send of src\/m\.txt ended on SIGTERM, so the batch stopped$/m, 1],
  ["run@1=signal", /^the test of entry 1 ended on SIGTERM, so the batch stopped$/m, 1],
]) {
  test(`a session whose ${act.replace(/@.*=/, " call ends on ")} stops the batch, closes, and restores the tree`, (t) => {
    const f = sessionTree(t);
    const result = sessionBatch(f, THREE, { config: outsideConfig(f, CONFIG), act });
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.out, stop);
    assert.match(result.out, /^no verdict: not run \| src\/m\.txt:2 \| AC2$/m);
    assert.match(result.out, /^no verdict: not run \| src\/m\.txt:3 \| AC3$/m);
    assert.equal(count(f, "run"), ran);
    assert.equal(count(f, "close"), 1);
    assertWhole(f);
  });
}

test("a close that a signal ended stops the batch after the verdicts it read", (t) => {
  const f = sessionTree(t);
  const result = sessionBatch(f, THREE, { config: outsideConfig(f, CONFIG), act: "close@1=signal", json: true });
  assert.equal(result.code, 2, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => e.caught), [true, false, true]);
  assert.equal(result.payload.stopped, "the session's close ended on SIGTERM, so the batch stopped");
  assertWhole(f);
});

test("the session's open, send and close run bare, and only the test it runs goes through the machine's build wrapper, as the test did", (t) => {
  const f = sessionTree(t);
  const bin = path.join(f.dir, "bin");
  fs.mkdirSync(bin);
  writeFile(path.join(bin, "claude-build"), `#!/bin/sh\necho "$*" >> ${path.join(f.dir, "wrapped")}\nshift\nexec "$@"\n`);
  fs.chmodSync(path.join(bin, "claude-build"), 0o755);
  // Each command names a build, which the machine's wrapper would queue.
  const config = outsideConfig(f, `mutate:\n${sessionBlock()}`.replace(/(node remote\.cjs (?:open|send|run|close))$/gm, "$1 build"));
  const result = sessionBatch(f, THREE, { config, json: true, env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => e.caught), [true, false, true]);
  const wrappedLines = fs.readFileSync(path.join(f.dir, "wrapped"), "utf8").split("\n").filter(Boolean);
  assert.equal(wrappedLines.length, 3, wrappedLines.join("\n"));
  assert.ok(wrappedLines.every((line) => /node remote\.cjs run build$/.test(line)), wrappedLines.join("\n"));
  assertWhole(f);
});
