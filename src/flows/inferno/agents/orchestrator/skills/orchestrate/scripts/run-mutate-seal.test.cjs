const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

// A host can seal files: a manifest holds their digests, and the loader refuses them all when one
// byte differs. A mutant in a sealed file then fails every test before the code under test runs.
// `mutate.sealed` names the sealed paths and the reseal command, so mutate reseals after the
// mutant lands and puts every path the reseal changed back byte for byte, an ignored one included,
// on every exit. These are the live runs; run-mutate-seal-recover.test.cjs holds the killed ones.

const {
  VALUE, assertSealed, configFile, existsIn, fakeTest, readIn, reseals, runs, sealBatch, sealConfig, sealEnv, sealMutate, sealTree,
  sealedRustTree, singleArgs, until,
} = require("./run-mutate-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

test("a mutant in a sealed file is resealed, so a test that does not notice it reads caught no", (t) => {
  const f = sealTree(t);
  const result = sealMutate(f, "node check.cjs any");
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^caught no$/m);
  assert.equal(reseals(f), 1);
});

test("a mutant in a sealed file that the test notices reads caught yes", (t) => {
  const f = sealTree(t);
  const result = sealMutate(f, "node check.cjs strict", ["--json"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.json.caught, true);
  const log = fs.readFileSync(result.json.log, "utf8");
  assert.match(log, /^wrong value$/m);
  assert.doesNotMatch(log, /stale seal/);
});

test("after the revert the seal git tracks and the seal git ignores hold their bytes from before, and no file the reseal made is left", (t) => {
  const f = sealTree(t);
  const result = sealMutate(f, "node check.cjs any");
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(reseals(f), 1, "the reseal ran once and nothing resealed again");
  assertSealed(f);
});

test("a batch puts the ignored seal back between entries and at the end", (t) => {
  const f = sealTree(t);
  const result = sealBatch(f, [
    { criterion: "AC1", file: VALUE, line: 1, find: "1", replace: "2", test: "node check.cjs any" },
    { criterion: "AC2", file: "src/plain.txt", line: 1, find: "x", replace: "y", test: `cat ${f.lock.rel} > ${path.join(f.dir, "seen")}` },
  ]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(fs.readFileSync(path.join(f.dir, "seen"), "utf8"), f.lock.body, "the second entry saw the ignored seal as it was");
  assertSealed(f);
});

test("a reseal that fails reads no verdict and leaves the tree as it was", (t) => {
  const f = sealTree(t);
  const result = sealMutate(f, "node check.cjs strict", ["--config", ".specs-inferno/config.fail.yaml", "--json"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.json.caught, null);
  assert.equal(result.json.why, "reseal failed (exit 3)");
  assert.equal(reseals(f), 1);
  assertSealed(f);
  const human = sealMutate(f, "node check.cjs strict", ["--config", ".specs-inferno/config.fail.yaml"]);
  assert.match(human.out, /^no verdict: reseal failed \(exit 3\)$/m);
  assertSealed(f);
});

// A reseal a signal ended, or one its shell reports killed (a wrapper's cap gives 137 or 143), is
// this machine's failure and not the mutant's.
for (const [name, reseal, why] of [
  ["a signal ends", `node seal.cjs ${VALUE} && kill -KILL $$`, "reseal ended on SIGKILL"],
  ["its shell reports killed", `node seal.cjs ${VALUE}; exit 143`, "reseal ended on SIGTERM (exit 143)"],
]) {
  test(`a reseal that ${name} reads no verdict, exits 2 and leaves the tree as it was`, (t) => {
    const f = sealTree(t);
    const result = sealMutate(f, "node check.cjs strict", ["--config", configFile(f, "c.yaml", sealConfig(reseal)), "--json"]);
    assert.equal(result.code, 2, result.out + result.err);
    assert.equal(result.json.caught, null);
    assert.equal(result.json.why, why);
    assertSealed(f);
  });
}

// The reseal writes the seals, then leaves a writer behind that ignores SIGTERM and would write into
// the tree a second later, and hangs.
const HANGS = (f) => `node seal.cjs ${VALUE}; touch ${path.join(f.dir, "started")}; (trap '' TERM; sleep 1; echo late >> .late) & sleep 20`;

test("a reseal past mutate.reseal_seconds is ended with every process it started, reads no verdict and exits 2", async (t) => {
  const f = sealTree(t);
  const config = configFile(f, "c.yaml", sealConfig(HANGS(f), { extra: "  reseal_seconds: 0.5\n" }));
  const started = Date.now();
  const result = sealMutate(f, "node check.cjs strict", ["--config", config, "--json"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.equal(result.json.why, "reseal timed out after 0.5 seconds");
  assert.ok(Date.now() - started < 8000, "the timeout ended the reseal, not its own sleep");
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, started + 2500 - Date.now())));
  assert.equal(existsIn(f, ".late"), false, "a process the reseal started outlived the timeout and wrote into the tree");
  assertSealed(f);
});

test("a reseal that ignores the timeout's SIGTERM is killed after a grace, and reads no verdict", (t) => {
  const f = sealTree(t);
  const config = configFile(f, "c.yaml", sealConfig(`trap '' TERM; node seal.cjs ${VALUE}; sleep 15`, { extra: "  reseal_seconds: 0.5\n" }));
  const started = Date.now();
  const result = sealMutate(f, "node check.cjs strict", ["--config", config, "--json"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.equal(result.json.why, "reseal timed out after 0.5 seconds");
  assert.ok(Date.now() - started < 8000, "the reseal ran on after the timeout and its grace");
  assertSealed(f);
});

test("a stop signal to mutate's process group ends the reseal and every process it started", async (t) => {
  const f = sealTree(t);
  const config = configFile(f, "c.yaml", sealConfig(HANGS(f)));
  const child = spawn(process.execPath, singleArgs(f, "node check.cjs strict", ["--config", config]),
    { cwd: f.tree, env: sealEnv(f), stdio: ["ignore", "pipe", "pipe"], detached: true });
  // Never the `kill` program here: it reads `-<pid>` as an option and signals every process of the user.
  t.after(() => { try { if (child.pid > 1) process.kill(-child.pid, "SIGKILL"); } catch { /* the group is gone */ } });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  const done = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  assert.ok(await until(() => fs.existsSync(path.join(f.dir, "started"))), "the reseal never started");
  const stopped = Date.now();
  process.kill(-child.pid, "SIGTERM");
  const code = await done;
  assert.equal(code, 2, out);
  assert.match(out, /^no verdict: reseal ended on SIGTERM$/m);
  assert.ok(Date.now() - stopped < 4000, "the reseal ran on after the stop");
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, stopped + 1500 - Date.now())));
  assert.equal(existsIn(f, ".late"), false, "a process the reseal started outlived the stop and wrote into the tree");
  assertSealed(f);
});

test("a heavy reseal goes through the machine's build wrapper", (t) => {
  const f = sealTree(t);
  const bin = path.join(f.dir, "bin");
  fs.mkdirSync(bin);
  writeFile(path.join(bin, "claude-build"), `#!/bin/sh\necho "$*" >> ${path.join(f.dir, "wrapped")}\nshift\nexec "$@"\n`);
  fs.chmodSync(path.join(bin, "claude-build"), 0o755);
  const config = configFile(f, "c.yaml", sealConfig(`node seal.cjs ${VALUE} --build`));
  const result = spawnSync(process.execPath, singleArgs(f, "node check.cjs any", ["--config", config]),
    { cwd: f.tree, encoding: "utf8", env: { ...sealEnv(f), PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^caught no$/m);
  assert.match(fs.readFileSync(path.join(f.dir, "wrapped"), "utf8"), /^-- bash -c node seal\.cjs defs\/value\.txt --build$/m);
  assertSealed(f);
});

test("a sealed key without reseal, and a reseal_seconds that is no positive number, fail at config load", (t) => {
  const f = sealTree(t);
  for (const [body, key] of [
    [`mutate:\n  sealed:\n    - paths: ["defs/**"]\n`, /mutate\.sealed\[0\]\.reseal/],
    [sealConfig("node seal.cjs", { extra: "  reseal_seconds: 0\n" }), /mutate\.reseal_seconds in \S+ must be a positive number of seconds/],
    [sealConfig("node seal.cjs", { extra: "  reseal_seconds: soon\n" }), /mutate\.reseal_seconds/],
  ]) {
    const bad = configFile(f, "bad.yaml", body);
    const result = sealMutate(f, "node check.cjs any", ["--config", bad]);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, /BAD_CONFIG/);
    assert.match(result.err, key);
    assert.ok(result.err.includes(bad), result.err);
  }
  assert.equal(reseals(f), 0);
  assertSealed(f);
});

test("a selected config without a mutate block inherits the default's, and a broken inherited block names the default", (t) => {
  const f = sealTree(t, { ".specs-inferno/config.bare.yaml": "host: claude\n" });
  const result = sealMutate(f, "node check.cjs any", ["--config", ".specs-inferno/config.bare.yaml"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^caught no$/m);
  assert.equal(reseals(f), 1, "the selected config resealed with the default's mutate block");
  assertSealed(f);
  const g = sealTree(t, { ".specs-inferno/config.yaml": "mutate:\n  sealed: none\n", ".specs-inferno/config.bare.yaml": "host: claude\n" });
  const broken = sealMutate(g, "node check.cjs any", ["--config", ".specs-inferno/config.bare.yaml"]);
  assert.equal(broken.code, 2, broken.out + broken.err);
  assert.match(broken.err, /mutate\.sealed in \S+\/\.specs-inferno\/config\.yaml must be/);
});

test("batch entries on a sealed file are resealed, and an entry after them sees the seal as it was", (t) => {
  const f = sealTree(t);
  const result = sealBatch(f, [
    { criterion: "AC1", file: VALUE, line: 1, find: "1", replace: "2", test: "node check.cjs any" },
    { criterion: "AC2", file: VALUE, line: 1, find: "1", replace: "2", test: "node check.cjs strict" },
    { criterion: "AC3", file: "src/plain.txt", line: 1, find: "x", replace: "y", test: "node check.cjs any" },
  ]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => e.caught), [false, true, false]);
  assert.equal(reseals(f), 2);
  assertSealed(f);
});

test("a batch entry whose reseal fails reads no verdict, and the next entry sees the seal as it was", (t) => {
  const f = sealTree(t);
  const result = sealBatch(f, [
    { criterion: "AC1", file: VALUE, line: 1, find: "1", replace: "2", test: "node check.cjs strict" },
    { criterion: "AC2", file: "src/plain.txt", line: 1, find: "x", replace: "y", test: "node check.cjs any" },
  ], ["--config", ".specs-inferno/config.fail.yaml"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => [e.caught, e.why]), [[null, "reseal failed (exit 3)"], [false, undefined]]);
  assertSealed(f);
});

test("a batch entry whose reseal a signal ends stops the batch, and every entry after it reads not run", (t) => {
  const f = sealTree(t);
  const config = configFile(f, "c.yaml", sealConfig(`node seal.cjs ${VALUE} && kill -KILL $$`));
  const result = sealBatch(f, [
    { criterion: "AC1", file: VALUE, line: 1, find: "1", replace: "2", test: "node check.cjs strict" },
    { criterion: "AC2", file: "src/plain.txt", line: 1, find: "x", replace: "y", test: `touch ${path.join(f.dir, "ran")}` },
  ], ["--config", config]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => [e.caught, e.why]), [[null, "reseal ended on SIGKILL"], [null, "not run"]]);
  assert.equal(result.payload.stopped, "the reseal of entry 1 ended on SIGKILL, so the batch stopped");
  assert.equal(fs.existsSync(path.join(f.dir, "ran")), false);
  assertSealed(f);
});

test("a seal the batch cannot put back stops it before the next test, and the batch exits 2 naming the path", (t) => {
  const f = sealTree(t);
  const ran = path.join(f.dir, "ran");
  const result = sealBatch(f, [
    { criterion: "AC1", file: VALUE, line: 1, find: "1", replace: "2", test: `node check.cjs any && chmod a-w ${f.lock.rel}` },
    { criterion: "AC2", file: "src/plain.txt", line: 1, find: "x", replace: "y", test: `touch ${ran}` },
  ]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.equal(result.payload.restored, false);
  assert.match(result.payload.failed.join("\n"), /the restore of defs\/seal\.lock, which a reseal changed, failed/);
  assert.equal(result.payload.stopped, "the batch stopped, since a seal could not be put back");
  assert.equal(fs.existsSync(ran), false, "the next entry ran its test against a seal that was not put back");
  assert.equal(readIn(f, VALUE), "1\n");
  assert.equal(readIn(f, "src/plain.txt"), "x\n");
});

test("a seal mutate cannot put back exits 2 and names the path, and the next call puts it back from the journal", (t) => {
  const f = sealTree(t);
  const result = sealMutate(f, `node check.cjs any && chmod a-w ${f.lock.rel}`, ["--json"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.equal(result.json.restored, false);
  assert.match(result.json.failed.join("\n"), /the restore of defs\/seal\.lock, which a reseal changed, failed/);
  assert.equal(readIn(f, VALUE), "1\n");
  fs.chmodSync(path.join(f.tree, f.lock.rel), 0o644);
  const next = sealMutate(f, "node check.cjs any");
  assert.equal(next.code, 0, next.out + next.err);
  assert.match(next.out, /^restored defs\/seal\.lock, which a reseal changed, from an interrupted mutate$/m);
  assertSealed(f);
});

const RUST = "pub fn alpha() -> usize { 1 }\npub fn beta() -> usize { 2 }\npub const fn delta() -> usize { 4 }\n";

test("switched Rust entries in a sealed file share one reseal before the control run", (t) => {
  const lib = "pub fn alpha() -> usize { 1 }\npub fn beta() -> usize { 2 }\n";
  const f = sealedRustTree(t, lib);
  const result = sealBatch(f, [
    { criterion: "AC1", file: "src/lib.rs", line: 1, find: "1", replace: "7", test: `node check.cjs any && ${fakeTest(f, "alpha", "usize")}` },
    { criterion: "AC2", file: "src/lib.rs", line: 2, find: "2", replace: "8", test: `node check.cjs any && ${fakeTest(f, "beta", "{ 2 }")}` },
  ]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught]), [["switch", false], ["switch", true]]);
  assert.equal(reseals(f), 1);
  assertSealed(f, lib, "src/lib.rs");
});

test("a switch that does not compile in a sealed file goes to its own build, and the rest keep their switches", (t) => {
  const f = sealedRustTree(t, RUST);
  const result = sealBatch(f, [
    { criterion: "AC1", file: "src/lib.rs", line: 2, find: "2", replace: "8", test: `node check.cjs any && ${fakeTest(f, "beta", "{ 2 }")}` },
    { criterion: "AC2", file: "src/lib.rs", line: 3, find: "4", replace: "5", test: `node check.cjs any && ${fakeTest(f, "delta", "{ 4 }")}` },
  ]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught]), [["switch", true], ["classic", true]]);
  assert.deepEqual(runs(f).filter((run) => run.name === "beta").map((run) => run.on), [null, "1"], "beta's switch held on the second build");
  assertSealed(f, RUST, "src/lib.rs");
});

test("switched Rust entries whose reseal fails read no verdict, and no control run starts on a stale seal", (t) => {
  const f = sealedRustTree(t, RUST, "node seal.cjs src/lib.rs --fail");
  const result = sealBatch(f, [
    { criterion: "AC1", file: "src/lib.rs", line: 1, find: "1", replace: "7", test: `node check.cjs any && ${fakeTest(f, "alpha", "{ 1 }")}` },
    { criterion: "AC2", file: "src/lib.rs", line: 2, find: "2", replace: "8", test: `node check.cjs any && ${fakeTest(f, "beta", "{ 2 }")}` },
  ]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught, e.why]),
    [["switch", null, "reseal failed (exit 3)"], ["switch", null, "reseal failed (exit 3)"]]);
  assert.deepEqual(runs(f), [], "no test ran");
  assertSealed(f, RUST, "src/lib.rs");
});

test("switched Rust entries whose reseal a signal ends stop the batch before any other entry", (t) => {
  const f = sealedRustTree(t, RUST, "node seal.cjs src/lib.rs && kill -KILL $$", { "notes.txt": "x\n" });
  const ran = path.join(f.dir, "ran");
  const result = sealBatch(f, [
    { criterion: "AC1", file: "src/lib.rs", line: 1, find: "1", replace: "7", test: fakeTest(f, "alpha", "{ 1 }") },
    { criterion: "AC2", file: "notes.txt", line: 1, find: "x", replace: "y", test: `touch ${ran}` },
  ]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => [e.caught, e.why]), [[null, "reseal ended on SIGKILL"], [null, "not run"]]);
  assert.equal(result.payload.stopped, "the reseal of the switched entries ended on SIGKILL, so the batch stopped");
  assert.equal(fs.existsSync(ran), false);
  assertSealed(f, RUST, "src/lib.rs");
});

test("a seal the batch cannot put back between two builds stops it before the second control run", (t) => {
  const f = sealedRustTree(t, RUST);
  const lock = `chmod a-w ${f.lock.rel}`;
  const result = sealBatch(f, [
    { criterion: "AC1", file: "src/lib.rs", line: 2, find: "2", replace: "8", test: `${lock} && ${fakeTest(f, "beta", "{ 2 }")}` },
    { criterion: "AC2", file: "src/lib.rs", line: 3, find: "4", replace: "5", test: `${lock} && ${fakeTest(f, "delta", "{ 4 }")}` },
  ]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.equal(result.payload.restored, false);
  assert.match(result.payload.failed.join("\n"), /the restore of src\/seal\.lock, which a reseal changed, failed/);
  assert.equal(result.payload.stopped, "the batch stopped, since a seal could not be put back");
  assert.deepEqual(runs(f), [], "only the first control build ran, and it failed to compile");
  assert.equal(readIn(f, "src/lib.rs"), RUST);
});
