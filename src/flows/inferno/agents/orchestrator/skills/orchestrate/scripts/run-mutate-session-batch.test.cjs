const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

// One session of the host's wrapper serves the whole batch. A reviewer writes a test per mutant,
// so a session per test command would sync the tree and wait for the slot once per mutant again.
// The session opens at the first entry the match reaches and closes once after the last; each
// mutant still runs its own test in it. The control and the switched runs of a shared Rust build
// run in that same session when the match reaches their command.

const {
  LINES, batchArgs, calls, checks, journalOf, mutated, outsideConfig, readIn, sessionBatch, sessionBlock, sessionEnv, sessionTree, until,
  wrapped,
} = require("./run-mutate-session-fixture.cjs");
const { builds, fakeTest, git, runs } = require("./run-mutate-fixture.cjs");

const CONFIG = `mutate:\n${sessionBlock()}`;
/** Three mutants, each with a test command of its own; the third survives its test. */
const THREE = [
  { criterion: "AC1", file: "src/m.txt", line: 1, find: "1", replace: "7", test: wrapped(checks("alpha = 1")) },
  { criterion: "AC2", file: "src/m.txt", line: 2, find: "2", replace: "8", test: wrapped(checks("beta = 2")) },
  { criterion: "AC3", file: "src/m.txt", line: 3, find: "3", replace: "9", test: wrapped(checks("alpha = 1", "beta = 2")) },
];
const HELD = [mutated(1, "1", "7"), mutated(2, "2", "8"), mutated(3, "3", "9")];

const count = (f, mode) => calls(f, mode).length;

function assertWhole(f) {
  assert.equal(readIn(f, "src/m.txt"), LINES);
  assert.equal(git(f.tree, "status", "--porcelain"), "");
  assert.equal(journalOf(f), null);
}

test("three mutants with three test commands open one session and close one, and each runs its own test in it", (t) => {
  const f = sessionTree(t);
  const result = sessionBatch(f, THREE, { config: outsideConfig(f, CONFIG), json: true });
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual([count(f, "open"), count(f, "close"), count(f, "direct")], [1, 1, 0]);
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught]), [["session", true], ["session", true], ["session", false]]);
  assert.equal(result.payload.sessions, 1);
  assert.deepEqual(calls(f, "run").map((run) => run.test), [checks("alpha = 1"), checks("beta = 2"), checks("alpha = 1", "beta = 2")]);
  assert.deepEqual(calls(f, "run").map((run) => run.held["src/m.txt"]), HELD, "each run holds its own mutant alone");
  const session = calls(f, "open")[0].session;
  assert.ok(calls(f).every((call) => call.session === session), "every call names the one session");
  const human = sessionBatch(f, THREE, { config: outsideConfig(f, CONFIG) });
  assert.match(human.out, /; 3 other entries shared 1 session of the host's wrapper$/m);
  assertWhole(f);
});

test("a second send back that fails leaves the third mutant with no verdict, an entry outside the session still runs, and the session closes", (t) => {
  const f = sessionTree(t);
  const outside = { criterion: "AC4", file: "src/m.txt", line: 3, find: "3", replace: "5", test: checks("gamma = 3") };
  // Per mutant one send and one send back, so the fourth send is the second mutant's send back.
  const result = sessionBatch(f, [...THREE, outside], { config: outsideConfig(f, CONFIG), act: "send@4=fail", json: true });
  assert.equal(result.code, 0, result.out + result.err);
  const rows = result.payload.entries;
  assert.deepEqual(rows.slice(0, 2).map((e) => e.caught), [true, true], "the mutant the session may still hold keeps its verdict");
  assert.equal(rows[2].caught, null);
  assert.match(rows[2].why, /^the send of src\/m\.txt back into the session failed \(exit 3 -> \S+\.log\), so the session may still hold the mutant of entry 2 and the rest of the session stopped$/);
  assert.deepEqual([rows[3].form, rows[3].caught], ["classic", true], "the entry the match does not reach runs in place as before");
  assert.deepEqual(calls(f, "run").map((run) => run.held["src/m.txt"]), HELD.slice(0, 2));
  assert.deepEqual([count(f, "open"), count(f, "close"), count(f, "send")], [1, 1, 4]);
  assertWhole(f);
});

const LIB = "pub fn alpha() -> usize { ONE + TEN }\npub fn beta() -> usize { 2 }\n";

test("a batch with two switched Rust entries and one other entry opens one session: the shared build syncs once and waits once", (t) => {
  const f = sessionTree(t, { "src/lib.rs": LIB });
  const entries = [
    { criterion: "AC1", file: "src/lib.rs", line: 1, find: "ONE", replace: "TWO", test: wrapped(fakeTest(f, "alpha", "ONE + TEN")) },
    { criterion: "AC2", file: "src/lib.rs", line: 2, find: "2", replace: "8", test: wrapped(fakeTest(f, "beta", "usize")) },
    { criterion: "AC3", file: "src/m.txt", line: 1, find: "1", replace: "7", test: wrapped(checks("alpha = 1")) },
  ];
  const result = sessionBatch(f, entries, { config: outsideConfig(f, CONFIG), json: true });
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual([count(f, "open"), count(f, "close"), count(f, "direct")], [1, 1, 0]);
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught]), [["switch", true], ["switch", false], ["session", true]]);
  assert.equal([builds(f), result.payload.builds, result.payload.sessions].join(), "1,1,1", "one build, in the session");
  assert.deepEqual(runs(f).map((run) => [run.name, run.on]), [["alpha", null], ["beta", null], ["alpha", "1"], ["beta", "2"]],
    "the control runs with every switch off, then each entry with its own switch on");
  assert.deepEqual(calls(f, "send").map((send) => send.file), ["src/lib.rs", "src/lib.rs", "src/m.txt", "src/m.txt"],
    "the switches go in once, and back once before the other entry");
  assert.equal(fs.readFileSync(path.join(f.remote, "src/lib.rs"), "utf8"), LIB, "the session's copy is whole again");
  const human = sessionBatch(f, entries, { config: outsideConfig(f, CONFIG) });
  assert.match(human.out, /; 2 Rust entries and 1 other entry shared 1 session of the host's wrapper$/m);
  assert.equal(readIn(f, "src/lib.rs"), LIB);
  assertWhole(f);
});

/** Two switched Rust entries and one other entry, for the tree `f`. */
const mixed = (f) => [
  { criterion: "AC1", file: "src/lib.rs", line: 1, find: "ONE", replace: "TWO", test: wrapped(fakeTest(f, "alpha", "ONE + TEN")) },
  { criterion: "AC2", file: "src/lib.rs", line: 2, find: "2", replace: "8", test: wrapped(fakeTest(f, "beta", "usize")) },
  { criterion: "AC3", file: "src/m.txt", line: 1, find: "1", replace: "7", test: wrapped(checks("alpha = 1")) },
];

// A Rust entry whose wrapped test reads the source: a mutant on a build of its own, in the session.
const READS = "'use strict';\nconst ok = require('fs').readFileSync('src/lib.rs', 'utf8').includes(process.argv[2]);\n" +
  "console.log(ok ? '# pass 1' : '# fail 1');\nprocess.exit(ok ? 0 : 1);\n";
const reader = { criterion: "AC4", file: "src/lib.rs", line: 2, find: "2", replace: "6", test: wrapped("node reads.cjs '{ 2 }'") };

test("a session that does not open leaves every entry it serves with no verdict, the switched ones too, counts no build, and still closes", (t) => {
  const f = sessionTree(t, { "src/lib.rs": LIB, "reads.cjs": READS });
  const result = sessionBatch(f, [...mixed(f), reader], { config: outsideConfig(f, CONFIG), act: "open@1=fail", json: true });
  assert.equal(result.code, 0, result.out + result.err);
  for (const row of result.payload.entries) {
    assert.equal(row.caught, null);
    assert.match(row.why, /^the session did not open \(exit 3 -> \S+\.log\)$/);
  }
  assert.deepEqual([count(f, "open"), count(f, "send"), count(f, "run"), count(f, "close"), builds(f)], [1, 0, 0, 1, 0]);
  assert.equal(result.payload.builds, 0, "nothing was built, in the session or in place");
  assert.equal(readIn(f, "src/lib.rs"), LIB);
  assertWhole(f);
});

test("a send of the shared build into the session that fails leaves its entries with no verdict and counts no build, and the session serves the rest", (t) => {
  const f = sessionTree(t, { "src/lib.rs": LIB, "reads.cjs": READS });
  const result = sessionBatch(f, [...mixed(f), reader], { config: outsideConfig(f, CONFIG), act: "send@1=fail", json: true });
  assert.equal(result.code, 0, result.out + result.err);
  const rows = result.payload.entries;
  for (const row of rows.slice(0, 2)) {
    assert.equal(row.caught, null);
    assert.match(row.why, /^the send of src\/lib\.rs into the session failed \(exit 3 -> \S+\.log\)$/);
  }
  assert.deepEqual(rows.slice(2).map((e) => [e.form, e.caught]), [["session", true], ["classic", true]], "the send back made the copy whole");
  assert.equal(result.payload.builds, 1, "the reader's own build, not the shared one no test ran");
  assert.deepEqual(calls(f, "send").map((send) => send.file), ["src/lib.rs", "src/lib.rs", "src/lib.rs", "src/lib.rs", "src/m.txt", "src/m.txt"],
    "the build in and back, then the reader on its own build, then the other entry");
  assert.deepEqual([count(f, "open"), count(f, "close")], [1, 1]);
  assert.equal(readIn(f, "src/lib.rs"), LIB);
  assertWhole(f);
});

test("a send back of the shared build that fails leaves the rest of the session with no verdict and counts no build for it, and the session closes", (t) => {
  const f = sessionTree(t, { "src/lib.rs": LIB, "reads.cjs": READS });
  const result = sessionBatch(f, [...mixed(f), reader], { config: outsideConfig(f, CONFIG), act: "send@2=fail", json: true });
  assert.equal(result.code, 0, result.out + result.err);
  const rows = result.payload.entries;
  assert.deepEqual(rows.slice(0, 2).map((e) => e.caught), [true, false], "the switched runs keep their verdicts");
  for (const row of rows.slice(2)) {
    assert.equal(row.caught, null);
    assert.match(row.why, /^the send of src\/lib\.rs back into the session failed \(exit 3 -> \S+\.log\), so the session may still hold the switches of the shared build and the rest of the session stopped$/);
  }
  assert.equal(result.payload.builds, 1, "the shared build only: the reader never ran");
  assert.deepEqual([count(f, "open"), count(f, "run"), count(f, "send"), count(f, "close")], [1, 4, 2, 1]);
  assert.equal(readIn(f, "src/lib.rs"), LIB);
  assertWhole(f);
});

test("a batch killed during the control run in the session leaves the session and the switches to the next batch, which closes and restores them", async (t) => {
  const f = sessionTree(t, { "src/lib.rs": LIB });
  const child = spawn(process.execPath, batchArgs(f, mixed(f), { config: outsideConfig(f, CONFIG) }),
    { cwd: f.tree, env: sessionEnv(f, { FAKE_ACT: "run@1=hold" }), stdio: "ignore" });
  t.after(() => child.kill("SIGKILL"));
  const done = new Promise((resolve) => child.on("close", resolve));
  assert.ok(await until(() => calls(f, "run").length > 0), "the control run never started");
  assert.match(readIn(f, "src/lib.rs"), /INFERNO_MUTANT/, "the switches stand in the tree while the control runs");
  child.kill("SIGKILL");
  await done;
  const left = JSON.parse(fs.readFileSync(journalOf(f), "utf8"));
  assert.equal(left.session.dir, calls(f, "open")[0].session);
  const next = sessionBatch(f, [THREE[0]], { config: outsideConfig(f, CONFIG), json: true });
  assert.equal(next.code, 0, next.out + next.err);
  assert.equal(calls(f, "close")[0].session, left.session.dir, "the left session is the one closed first");
  assert.deepEqual(next.payload.entries.map((e) => e.caught), [true]);
  assert.equal(readIn(f, "src/lib.rs"), LIB);
  assertWhole(f);
});
