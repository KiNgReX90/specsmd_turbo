const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

// A mutate killed outright leaves its journal, and the next call puts back what it can prove: each
// path a reseal changed while it still holds what the reseal wrote, the ignored seal included.
// What it cannot prove it refuses, and the journal keeps it until a human clears it.

const {
  RUN, VALUE, assertSealed, configFile, git, journalOf, readIn, sealConfig, sealEnv, sealMutate, sealTree, singleArgs, until,
} = require("./run-mutate-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

const JOURNAL = path.join(__dirname, "run-mutate-journal.cjs");
const SEALS = [".seal-stamp", "defs/seal.lock", "defs/stamp.lock", "manifest.txt"];
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Start `args` with a test that marks its start and holds; kill it outright once the test runs. */
async function killedDuringTest(f, args) {
  const started = path.join(f.dir, "started");
  const release = path.join(f.dir, "release");
  const child = spawn(process.execPath, args(`touch ${started}; until [ -f ${release} ] || [ ! -d ${f.dir} ]; do sleep 0.05; done; true`),
    { cwd: f.tree, env: sealEnv(f), stdio: "ignore" });
  const done = new Promise((resolve) => child.on("close", resolve));
  const ran = await until(() => fs.existsSync(started));
  child.kill("SIGKILL");
  await done;
  writeFile(release, "");
  assert.ok(ran, "the test never started");
}

const single = (f, extra = []) => (test) => singleArgs(f, test, extra);
const batched = (f, extra = []) => (test) => {
  const file = path.join(f.dir, "held.json");
  writeFile(file, JSON.stringify([{ criterion: "AC1", file: VALUE, line: 1, find: "1", replace: "2", test }]));
  return [RUN, "mutate", "--tree", f.tree, "--batch", file, ...extra];
};
const journal = (f) => JSON.parse(fs.readFileSync(journalOf(f), "utf8"));

for (const [shape, args] of [["run", single], ["batch", batched]]) {
  test(`a ${shape} killed after the reseal is restored by the next call, the ignored seal included`, async (t) => {
    const f = sealTree(t);
    await killedDuringTest(f, args(f));
    assert.notEqual(readIn(f, "manifest.txt"), f.manifest, "the reseal ran before the kill");
    assert.notEqual(readIn(f, f.lock.rel), f.lock.body, "the reseal rewrote the ignored seal before the kill");
    assert.deepEqual(journal(f).seal.paths.map((record) => record.file).sort(), SEALS, "the seal records name only what the reseal changed");
    const next = sealMutate(f, "node check.cjs strict");
    assert.equal(next.code, 0, next.out + next.err);
    assert.match(next.out, /^restored defs\/value\.txt from an interrupted mutate$/m);
    for (const rel of SEALS) assert.match(next.out, new RegExp(`^restored ${escape(rel)}, which a reseal changed, from an interrupted mutate$`, "m"));
    assert.match(next.out, /^caught yes$/m);
    assertSealed(f);
  });

  test(`a ${shape} whose reseal rewrote the mutated file itself is restored by the next call after a kill`, async (t) => {
    const f = sealTree(t);
    const config = configFile(f, "rewrite.yaml", sealConfig(`node seal.cjs ${VALUE} --rewrite`));
    await killedDuringTest(f, args(f, ["--config", config]));
    assert.equal(readIn(f, VALUE), "2\n# sealed\n", "the reseal rewrote the mutant before the kill");
    const next = sealMutate(f, "node check.cjs strict");
    assert.equal(next.code, 0, next.out + next.err);
    assert.match(next.out, /^restored defs\/value\.txt from an interrupted mutate$/m);
    assert.match(next.out, /^caught yes$/m);
    assertSealed(f);
  });

  // Once HEAD moved, neither the mutant with its lines back nor HEAD's copy hashes to the original.
  test(`a ${shape} whose reseal rewrote the mutated file is refused after a kill once HEAD moved, and nothing is written there`, async (t) => {
    const f = sealTree(t);
    const config = configFile(f, "rewrite.yaml", sealConfig(`node seal.cjs ${VALUE} --rewrite`));
    await killedDuringTest(f, args(f, ["--config", config]));
    const moved = configFile(f, "moved.txt", "3\n");
    git(f.tree, "update-index", "--cacheinfo", `100644,${git(f.tree, "hash-object", "-w", moved)},${VALUE}`);
    git(f.tree, "commit", "-qm", "moved");
    const next = sealMutate(f, "true");
    assert.equal(next.code, 2, next.out + next.err);
    assert.match(next.err, /MUTATE_LEFTOVER/);
    assert.match(next.err, /defs\/value\.txt.*the file changed since/);
    assert.equal(readIn(f, VALUE), "2\n# sealed\n", "recovery wrote a copy whose hash is not the original's");
    const kept = journal(f);
    assert.deepEqual(shape === "run" ? [kept.file] : kept.files.map((record) => record.file), [VALUE], "the journal keeps the refused file");
  });
}

test("a seal path edited after the kill is refused, the rest is restored, and the journal keeps the refused one", async (t) => {
  const f = sealTree(t);
  await killedDuringTest(f, single(f));
  writeFile(path.join(f.tree, "manifest.txt"), "edited by hand\n");
  const next = sealMutate(f, "true");
  assert.equal(next.code, 2, next.out + next.err);
  assert.match(next.err, /MUTATE_LEFTOVER/);
  assert.match(next.err, /a reseal of an interrupted mutate rewrote manifest\.txt, and the file changed since/);
  assert.match(next.err, /^restored defs\/seal\.lock, which a reseal changed, from an interrupted mutate$/m);
  assert.equal(readIn(f, "manifest.txt"), "edited by hand\n");
  assert.equal(readIn(f, VALUE), "1\n");
  assert.equal(readIn(f, f.lock.rel), f.lock.body);
  const kept = journal(f);
  assert.deepEqual(kept.files, []);
  assert.deepEqual(kept.seal.paths.map((record) => record.file), ["manifest.txt"]);
});

test("a seal path that already holds its bytes from before is left alone, not refused", async (t) => {
  const f = sealTree(t);
  await killedDuringTest(f, single(f));
  git(f.tree, "checkout", "--", "manifest.txt");
  const next = sealMutate(f, "node check.cjs strict");
  assert.equal(next.code, 0, next.out + next.err);
  assert.doesNotMatch(next.out, /restored manifest\.txt/);
  assert.match(next.out, /^restored defs\/seal\.lock, which a reseal changed, from an interrupted mutate$/m);
  assert.match(next.out, /^caught yes$/m);
  assertSealed(f);
});

test("a run killed during its reseal is refused until a human clears it, and the journal keeps only the reseal", async (t) => {
  const f = sealTree(t);
  const [started, release, finished] = ["started", "release", "finished"].map((name) => path.join(f.dir, name));
  const hold = `node seal.cjs ${VALUE}; touch ${started}; until [ -f ${release} ] || [ ! -d ${f.dir} ]; do sleep 0.05; done; touch ${finished}`;
  const config = configFile(f, "hold.yaml", sealConfig(hold));
  const child = spawn(process.execPath, singleArgs(f, "node check.cjs strict", ["--config", config]), { cwd: f.tree, env: sealEnv(f), stdio: "ignore" });
  const done = new Promise((resolve) => child.on("close", resolve));
  assert.ok(await until(() => fs.existsSync(started)), "the reseal never started");
  child.kill("SIGKILL");
  await done;
  writeFile(release, "");
  assert.ok(await until(() => fs.existsSync(finished)), "the reseal never finished");
  const next = sealMutate(f, "true");
  assert.equal(next.code, 2, next.out + next.err);
  assert.match(next.err, /MUTATE_LEFTOVER/);
  assert.match(next.err, new RegExp(`an interrupted mutate was killed while its reseal \\(${escape(hold)}\\) ran, so the paths it changed are unknown`));
  assert.match(next.err, /^restored defs\/value\.txt from an interrupted mutate$/m);
  assert.equal(readIn(f, VALUE), "1\n");
  assert.notEqual(readIn(f, "manifest.txt"), f.manifest, "recovery guessed at the paths the reseal changed");
  const kept = journal(f);
  assert.equal(kept.file, undefined, "the restored file left the journal");
  assert.deepEqual(kept.files, []);
  assert.deepEqual(kept.seal, { running: hold, paths: [] });
  const again = sealMutate(f, "true");
  assert.equal(again.code, 2, again.out + again.err);
  assert.match(again.err, /killed while its reseal/);
});

test("a live mutate whose seal path the caller reads refuses the caller's recovery", async (t) => {
  const f = sealTree(t);
  const started = path.join(f.dir, "started");
  const release = path.join(f.dir, "release");
  const hold = `touch ${started}; until [ -f ${release} ] || [ ! -d ${f.dir} ]; do sleep 0.05; done; node check.cjs strict`;
  const child = spawn(process.execPath, singleArgs(f, hold), { cwd: f.tree, env: sealEnv(f), stdio: ["ignore", "pipe", "ignore"] });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  const done = new Promise((resolve) => child.on("close", resolve));
  t.after(() => child.kill("SIGKILL"));
  assert.ok(await until(() => fs.existsSync(started)), "the test never started");
  // `keepLive(file)` is true for a file the caller never reads, as the item review passes it.
  const recover = (reads) => spawnSync(process.execPath, ["-e", [
    `const { recoverInterrupted } = require(${JSON.stringify(JOURNAL)});`,
    "try { console.log(JSON.stringify(recoverInterrupted(process.argv[1], { keepLive: (file) => file !== process.argv[2] }))); }",
    "catch (error) { console.log(error.code); }",
  ].join("\n"), f.tree, reads], { env: sealEnv(f), encoding: "utf8" }).stdout.trim();
  const reads = { manifest: recover("manifest.txt"), other: recover("src/plain.txt") };
  writeFile(release, "");
  await done;
  assert.equal(reads.manifest, "MUTATE_RUNNING", "a caller that reads a seal path the live run resealed must wait for it");
  assert.equal(reads.other, "[]", "a caller that reads nothing the live run holds goes on");
  assert.match(out, /^caught yes$/m);
  assertSealed(f);
});
