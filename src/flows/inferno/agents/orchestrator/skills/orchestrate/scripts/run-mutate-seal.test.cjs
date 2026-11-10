const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawn, spawnSync } = require("node:child_process");

// A host can seal files: a manifest holds their digests, and the loader refuses them all when one
// byte differs. A mutant in a sealed file then fails every test before the code under test runs.
// `mutate.sealed` names the sealed paths and the reseal command, so mutate reseals after the
// mutant lands and puts every path the reseal changed back byte for byte after the revert.

const { RUN, batchTree, fakeTest } = require("./run-mutate-fixture.cjs");
const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");

const VALUE = "defs/value.txt";
const digest = (text) => crypto.createHash("sha256").update(text).digest("hex");
// Committed with a comment the reseal never writes, so only a byte restore gives it back.
const manifest = (rel, body) => `# sealed by hand\n${digest(body)}  ${rel}\n`;
const MANIFEST = manifest(VALUE, "1\n");

// The reseal: it counts its runs outside the tree, rewrites the manifest and leaves a new file.
// It overwrites a file by removing it and appending, so this test holds no direct write.
const SEAL = String.raw`'use strict';
const fs = require('fs');
const crypto = require('crypto');
const rel = process.argv[2];
fs.appendFileSync(process.env.SEAL_RUNS, 'reseal\n');
fs.rmSync('manifest.txt', { force: true });
fs.appendFileSync('manifest.txt', crypto.createHash('sha256').update(fs.readFileSync(rel)).digest('hex') + '  ' + rel + '\n');
fs.appendFileSync('.seal-stamp', 'resealed\n');
if (process.argv.includes('--fail')) process.exit(3);
`;

// The test: red on a stale digest, as the host's loader refuses the whole pack. With `strict` it
// also checks the value the mutant changed. A red run prints node --test's failing summary.
const CHECK = String.raw`'use strict';
const fs = require('fs');
const crypto = require('crypto');
const fail = (why) => { console.log(why); console.log('# fail 1'); process.exit(1); };
for (const line of fs.readFileSync('manifest.txt', 'utf8').split('\n')) {
  const [sum, rel] = line.split('  ');
  if (!rel || line.startsWith('#')) continue;
  if (crypto.createHash('sha256').update(fs.readFileSync(rel)).digest('hex') !== sum) fail('stale seal on ' + rel);
}
if (process.argv[2] === 'strict' && fs.readFileSync('defs/value.txt', 'utf8') !== '1\n') fail('wrong value');
`;

const config = (glob, reseal) => `mutate:\n  sealed:\n    - paths: ["${glob}"]\n      reseal: "${reseal}"\n`;

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function sealTree(t) {
  const dir = tempDir("inferno-mutate-seal-");
  t.after(() => {
    spawnSync("chmod", ["-R", "u+w", dir]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const tree = path.join(dir, "app");
  const files = {
    [VALUE]: "1\n",
    "src/plain.txt": "x\n",
    "manifest.txt": MANIFEST,
    "seal.cjs": SEAL,
    "check.cjs": CHECK,
    ".specs-inferno/config.yaml": config("defs/**", `node seal.cjs ${VALUE}`),
    ".specs-inferno/config.fail.yaml": config("defs/**", `node seal.cjs ${VALUE} --fail`),
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
    writeFile(path.join(tree, rel), body);
  }
  git(tree, "init", "-q", "-b", "main");
  git(tree, "config", "user.email", "test@example.com");
  git(tree, "config", "user.name", "Test");
  git(tree, "add", "-A");
  git(tree, "commit", "-qm", "init");
  return { dir, tree, cache: path.join(dir, "cache"), runs: path.join(dir, "seal-runs") };
}

// CLAUDE_BUILD_WRAPPED is claude-build's nested-call marker: a fake command runs as is and never queues on the machine-wide build lock.
const env = (f) => ({ ...process.env, CLAUDE_BUILD_WRAPPED: "1", XDG_CACHE_HOME: f.cache, SEAL_RUNS: f.runs });
const single = (f, test, extra = []) =>
  [RUN, "mutate", "--tree", f.tree, "--file", VALUE, "--line", "1", "--replace", "2", "--test", test, ...extra];

function mutate(f, test, extra = []) {
  const result = spawnSync(process.execPath, single(f, test, extra), { cwd: f.tree, encoding: "utf8", env: env(f) });
  return { code: result.status, out: result.stdout, err: result.stderr, json: extra.includes("--json") ? JSON.parse(result.stdout || "null") : null };
}

function batch(f, entries, extra = []) {
  const file = path.join(f.dir, "batch.json");
  writeFile(file, JSON.stringify(entries));
  const result = spawnSync(process.execPath, [RUN, "mutate", "--tree", f.tree, "--batch", file, "--json", ...extra],
    { cwd: f.tree, encoding: "utf8", env: env(f) });
  return { code: result.status, out: result.stdout, err: result.stderr, payload: JSON.parse(result.stdout || "null") };
}

const read = (f, rel) => fs.readFileSync(path.join(f.tree, rel), "utf8");
const reseals = (f) => (fs.existsSync(f.runs) ? fs.readFileSync(f.runs, "utf8").split("\n").filter(Boolean).length : 0);

/** The tree is exactly as committed: the value, the manifest's own bytes, and no file the reseal left. */
function assertCommitted(f, value = "1\n", sealed = MANIFEST) {
  assert.equal(read(f, "manifest.txt"), sealed);
  assert.equal(git(f.tree, "status", "--porcelain"), "");
  assert.equal(fs.existsSync(path.join(f.tree, ".seal-stamp")), false);
  if (value !== null) assert.equal(read(f, VALUE), value);
}

test("a mutant in a sealed file is resealed, so a test that does not notice it reads caught no", (t) => {
  const f = sealTree(t);
  const result = mutate(f, "node check.cjs any");
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^caught no$/m);
  assert.equal(reseals(f), 1);
});

test("a mutant in a sealed file that the test notices reads caught yes", (t) => {
  const f = sealTree(t);
  const result = mutate(f, "node check.cjs strict", ["--json"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.json.caught, true);
  const log = fs.readFileSync(result.json.log, "utf8");
  assert.match(log, /^wrong value$/m);
  assert.doesNotMatch(log, /stale seal/);
});

test("the seal is restored byte for byte after the revert", (t) => {
  const f = sealTree(t);
  const result = mutate(f, "node check.cjs any");
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(reseals(f), 1, "the reseal ran once and nothing resealed again");
  assertCommitted(f);
});

test("a reseal that fails reads no verdict and leaves the tree clean", (t) => {
  const f = sealTree(t);
  const result = mutate(f, "node check.cjs strict", ["--config", ".specs-inferno/config.fail.yaml", "--json"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.json.caught, null);
  assert.equal(result.json.why, "reseal failed (exit 3)");
  assert.equal(reseals(f), 1);
  assertCommitted(f);
  const human = mutate(f, "node check.cjs strict", ["--config", ".specs-inferno/config.fail.yaml"]);
  assert.match(human.out, /^no verdict: reseal failed \(exit 3\)$/m);
  assertCommitted(f);
});

/** Start `args` with a test that marks its start and holds; kill it outright once the test runs. */
async function killedDuringTest(f, args) {
  const started = path.join(f.dir, "started");
  const release = path.join(f.dir, "release");
  const child = spawn(process.execPath, args(`touch ${started}; until [ -f ${release} ] || [ ! -d ${f.dir} ]; do sleep 0.05; done; true`),
    { cwd: f.tree, env: env(f), stdio: "ignore" });
  const done = new Promise((resolve) => child.on("close", resolve));
  for (let i = 0; i < 400 && !fs.existsSync(started); i += 1) await new Promise((r) => setTimeout(r, 25));
  const ran = fs.existsSync(started);
  child.kill("SIGKILL");
  await done;
  writeFile(release, "");
  assert.ok(ran, "the test never started");
}

test("a run killed after the reseal is restored by the next call", async (t) => {
  const f = sealTree(t);
  await killedDuringTest(f, (test) => single(f, test));
  assert.notEqual(read(f, "manifest.txt"), MANIFEST, "the reseal ran before the kill");
  const next = mutate(f, "node check.cjs strict");
  assert.equal(next.code, 0, next.out + next.err);
  assert.match(next.out, /restored manifest\.txt/);
  assert.match(next.out, /^caught yes$/m);
  assertCommitted(f);
});

test("a batch killed after the reseal is restored by the next call", async (t) => {
  const f = sealTree(t);
  const file = path.join(f.dir, "held.json");
  await killedDuringTest(f, (test) => {
    writeFile(file, JSON.stringify([{ criterion: "AC1", file: VALUE, line: 1, find: "1", replace: "2", test }]));
    return [RUN, "mutate", "--tree", f.tree, "--batch", file];
  });
  assert.notEqual(read(f, "manifest.txt"), MANIFEST, "the reseal ran before the kill");
  const next = mutate(f, "node check.cjs strict");
  assert.equal(next.code, 0, next.out + next.err);
  assert.match(next.out, /restored manifest\.txt/);
  assertCommitted(f);
});

test("a sealed key without reseal fails at config load", (t) => {
  const f = sealTree(t);
  const bad = path.join(f.dir, "bad.yaml");
  writeFile(bad, `mutate:\n  sealed:\n    - paths: ["defs/**"]\n`);
  const result = mutate(f, "node check.cjs any", ["--config", bad]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /BAD_CONFIG/);
  assert.match(result.err, /mutate\.sealed\[0\]\.reseal/);
  assert.ok(result.err.includes(bad), result.err);
  assert.equal(reseals(f), 0);
  assertCommitted(f);
});

test("batch entries on a sealed file are resealed, and an entry after them sees the committed seal", (t) => {
  const f = sealTree(t);
  const result = batch(f, [
    { criterion: "AC1", file: VALUE, line: 1, find: "1", replace: "2", test: "node check.cjs any" },
    { criterion: "AC2", file: VALUE, line: 1, find: "1", replace: "2", test: "node check.cjs strict" },
    { criterion: "AC3", file: "src/plain.txt", line: 1, find: "x", replace: "y", test: "node check.cjs any" },
  ]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => e.caught), [false, true, false]);
  assert.equal(reseals(f), 2);
  assertCommitted(f);
});

test("a batch entry whose reseal fails reads no verdict, and the next entry sees the committed seal", (t) => {
  const f = sealTree(t);
  const result = batch(f, [
    { criterion: "AC1", file: VALUE, line: 1, find: "1", replace: "2", test: "node check.cjs strict" },
    { criterion: "AC2", file: "src/plain.txt", line: 1, find: "x", replace: "y", test: "node check.cjs any" },
  ], ["--config", ".specs-inferno/config.fail.yaml"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => [e.caught, e.why]), [[null, "reseal failed (exit 3)"], [false, undefined]]);
  assertCommitted(f);
});

test("switched Rust entries in a sealed file share one reseal before the control run", (t) => {
  const lib = "pub fn alpha() -> usize { 1 }\npub fn beta() -> usize { 2 }\n";
  const sealed = manifest("src/lib.rs", lib);
  const f = batchTree(t, {
    "src/lib.rs": lib,
    "manifest.txt": sealed,
    "seal.cjs": SEAL,
    "check.cjs": CHECK,
    ".specs-inferno/config.yaml": config("src/**", "node seal.cjs src/lib.rs"),
  });
  const g = { dir: f.dir, tree: f.root, cache: f.cache, runs: path.join(f.dir, "seal-runs") };
  const file = path.join(f.dir, "batch.json");
  const entries = [
    { criterion: "AC1", file: "src/lib.rs", line: 1, find: "1", replace: "7", test: `node check.cjs any && ${fakeTest(f, "alpha", "usize")}` },
    { criterion: "AC2", file: "src/lib.rs", line: 2, find: "2", replace: "8", test: `node check.cjs any && ${fakeTest(f, "beta", "{ 2 }")}` },
  ];
  writeFile(file, JSON.stringify(entries));
  const result = spawnSync(process.execPath, [RUN, "mutate", "--tree", f.root, "--batch", file, "--json"],
    { cwd: f.root, encoding: "utf8", env: { ...env(g), FAKE_RUST_STATE: f.state } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.entries.map((e) => [e.form, e.caught]), [["switch", false], ["switch", true]]);
  assert.equal(reseals(g), 1);
  assertCommitted(g, null, sealed);
  assert.equal(read(g, "src/lib.rs"), lib);
});
