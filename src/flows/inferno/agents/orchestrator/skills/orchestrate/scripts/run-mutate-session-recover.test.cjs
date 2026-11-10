const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");

// A batch killed outright never runs the close of the session it holds open. The journal keeps
// that close, so the next step that reads the tree closes the session before it restores the
// files, and says so. A signal the batch holds stops it between the mutants of a session.

const {
  LINES, RUN, batchArgs, calls, checks, journalOf, mutated, outsideConfig, readIn, sessionBatch, sessionBlock, sessionEnv, sessionTree,
  until, wrapped,
} = require("./run-mutate-session-fixture.cjs");
const { git } = require("./run-mutate-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

const CONFIG = `mutate:\n${sessionBlock()}`;
const SHARED = wrapped(checks("alpha = 1", "gamma = 3"));
const THREE = [
  { criterion: "AC1", file: "src/m.txt", line: 1, find: "1", replace: "7", test: SHARED },
  { criterion: "AC2", file: "src/m.txt", line: 2, find: "2", replace: "8", test: SHARED },
  { criterion: "AC3", file: "src/m.txt", line: 3, find: "3", replace: "9", test: SHARED },
];

/** Start a batch of `entries` whose wrapper holds at `act`; resolves once the held call is logged. */
async function held(t, f, act, entries = THREE) {
  const child = spawn(process.execPath, batchArgs(f, entries, { config: outsideConfig(f, CONFIG) }),
    { cwd: f.tree, env: sessionEnv(f, { FAKE_ACT: act }), stdio: ["ignore", "pipe", "pipe"] });
  const release = () => writeFile(f.release, "");
  // A hold also ends once the tree's dir is gone, which the tree's own after hook removes.
  t.after(() => child.kill("SIGKILL"));
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  const done = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  const mode = act.split("@")[0];
  assert.ok(await until(() => calls(f, mode).length > 0), `the ${mode} never started`);
  return { child, done, release, out: () => out };
}

/** A single mutate on line 2, the step after a killed batch here; it runs no session. */
function single(f, act = "") {
  const args = [RUN, "mutate", "--tree", f.tree, "--file", "src/m.txt", "--line", "2", "--replace", "beta = 5", "--test", "true"];
  const result = spawnSync(process.execPath, args, { cwd: f.tree, encoding: "utf8", env: sessionEnv(f, { FAKE_ACT: act }) });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

for (const [act, holding] of [["open@1=hold", LINES], ["run@1=hold", mutated(1, "1", "7")]]) {
  test(`a batch killed while its session is open (${act}) has that session closed by the next batch, before its files are restored`, async (t) => {
    const f = sessionTree(t);
    const run = await held(t, f, act);
    assert.equal(readIn(f, "src/m.txt"), holding);
    run.child.kill("SIGKILL");
    await run.done;
    const left = JSON.parse(fs.readFileSync(journalOf(f), "utf8"));
    assert.equal(left.session.dir, calls(f, "open")[0].session, "the journal holds the open session");
    assert.equal(calls(f, "close").length, 0);

    const next = sessionBatch(f, THREE, { config: outsideConfig(f, CONFIG), json: true });
    run.release();
    assert.equal(next.code, 0, next.out + next.err);
    const close = calls(f, "close")[0];
    assert.equal(close.session, left.session.dir, "the left session is the one closed");
    assert.equal(close.tree, f.tree);
    const order = calls(f).map((c) => c.call);
    assert.ok(order.indexOf("close") < order.indexOf("open", order.indexOf("open") + 1), "it closes before the next session opens");
    assert.deepEqual(next.payload.entries.map((e) => e.caught), [true, false, true]);
    assert.equal(readIn(f, "src/m.txt"), LINES);
    assert.equal(journalOf(f), null);
    const human = sessionBatch(f, THREE, { config: outsideConfig(f, CONFIG) });
    assert.doesNotMatch(human.out, /interrupted/, "the record is gone once it is closed");
  });
}

test("the step after the kill says it closed the session, and a close that fails there says to close it by hand while the files still go back", async (t) => {
  for (const [act, said] of [
    ["", /^closed the host session an interrupted mutate left open$/m],
    ["close@1=fail", /^the close of the host session an interrupted mutate left open failed \(exit 3 -> \S+\.log\); close it on the host by hand$/m],
  ]) {
    const f = sessionTree(t);
    const run = await held(t, f, "run@1=hold");
    run.child.kill("SIGKILL");
    await run.done;
    const next = single(f, act);
    run.release();
    assert.equal(next.code, 0, next.out + next.err);
    assert.match(next.out, said);
    assert.match(next.out, /^restored src\/m\.txt from an interrupted mutate$/m);
    assert.equal(calls(f, "close").length, 1, "one close, by the step after the kill");
    assert.equal(readIn(f, "src/m.txt"), LINES);
    assert.equal(journalOf(f), null);
  }
});

test("a killed batch's file edited since is refused, and its session is still closed and dropped from the journal", async (t) => {
  const f = sessionTree(t);
  const run = await held(t, f, "run@1=hold");
  run.child.kill("SIGKILL");
  await run.done;
  const edited = `${readIn(f, "src/m.txt")}delta = 4\n`;
  writeFile(`${f.tree}/src/m.txt`, edited);
  const next = single(f);
  run.release();
  assert.equal(next.code, 2, next.out + next.err);
  assert.match(next.err, /MUTATE_LEFTOVER.*src\/m\.txt/);
  assert.match(next.err, /^closed the host session an interrupted mutate left open$/m);
  const kept = JSON.parse(fs.readFileSync(journalOf(f), "utf8"));
  assert.equal(kept.session, undefined, "the closed session leaves the journal");
  assert.deepEqual(kept.files.map((record) => record.file), ["src/m.txt"]);
  assert.equal(single(f).code, 2);
  assert.equal(calls(f, "close").length, 1, "a refused tree never closes the session twice");
  assert.equal(readIn(f, "src/m.txt"), edited);
});

test("a SIGTERM to the batch while a session runs its first mutant stops it before the second, closes the session and restores the tree", async (t) => {
  const f = sessionTree(t);
  const run = await held(t, f, "run@1=hold");
  run.child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 100));
  run.release();
  const code = await run.done;
  assert.equal(code, 2, run.out());
  assert.match(run.out(), /^the batch stopped on SIGTERM, so every entry still to run reads not run$/m);
  assert.match(run.out(), /^caught yes \| src\/m\.txt:1 \| AC1$/m);
  assert.match(run.out(), /^no verdict: not run \| src\/m\.txt:2 \| AC2$/m);
  assert.match(run.out(), /^no verdict: not run \| src\/m\.txt:3 \| AC3$/m);
  assert.equal(calls(f, "run").length, 1);
  assert.equal(calls(f, "close").length, 1);
  assert.equal(readIn(f, "src/m.txt"), LINES);
  assert.equal(git(f.tree, "status", "--porcelain"), "");
  assert.equal(journalOf(f), null);
});

test("a SIGTERM held during the last mutant of a session stops the batch before the next session opens", async (t) => {
  const f = sessionTree(t);
  const run = await held(t, f, "run@1=hold", [THREE[0], { ...THREE[1], test: wrapped(checks("beta = 2")) }]);
  run.child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 100));
  run.release();
  assert.equal(await run.done, 2, run.out());
  assert.match(run.out(), /^caught yes \| src\/m\.txt:1 \| AC1$/m);
  assert.match(run.out(), /^no verdict: not run \| src\/m\.txt:2 \| AC2$/m);
  assert.deepEqual([calls(f, "open").length, calls(f, "close").length], [1, 1], "no second session opens after the signal");
  assert.equal(readIn(f, "src/m.txt"), LINES);
  assert.equal(journalOf(f), null);
});
