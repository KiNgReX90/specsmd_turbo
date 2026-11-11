const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// mutate puts back the line it broke and the seal it resealed, and nothing else. A test command
// that writes into the tree used to leave its change behind while the runner said every file was
// restored, so the next step met a file nobody wrote. The runner now reads git status before the
// first write and after the last restore, and a path whose state moved reads `restored: false`,
// by name, with the key a host that seals files sets.

const { RUN, batchTree, env, fakeTest, git, runBatch } = require("./run-mutate-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

const FILES = { "src/m.js": "module.exports = 1;\n", "README.md": "readme\n", ".gitignore": "build/\n", "src/lib.rs": "pub fn gamma() -> usize { 3 }\n" };
const CHECK = "node -e \"process.exit(require('./src/m.js') === 1 ? 0 : 1)\" || { s=$?; echo '# fail 1'; exit $s; }";
const HINT = /^a sealed file goes under mutate\.sealed in \.specs-inferno\/config\.yaml/m;
const OTHER = /^any other path: the test command must leave the tree as it found it, so name another command or write where git ignores/m;

function single(f, test) {
  const args = [RUN, "mutate", "--tree", f.root, "--file", "src/m.js", "--line", "1", "--replace", "module.exports = 2;", "--test", test, "--json"];
  const result = spawnSync(process.execPath, args, { cwd: f.root, encoding: "utf8", env: env(f) });
  return { code: result.status, out: result.stdout, err: result.stderr, payload: JSON.parse(result.stdout) };
}

function human(f, test) {
  const args = [RUN, "mutate", "--tree", f.root, "--file", "src/m.js", "--line", "1", "--replace", "module.exports = 2;", "--test", test];
  return spawnSync(process.execPath, args, { cwd: f.root, encoding: "utf8", env: env(f) }).stdout;
}

const js = (test) => [{ criterion: "AC1", file: "src/m.js", line: 1, find: "1", replace: "2", test }];
const read = (f, rel) => fs.readFileSync(path.join(f.root, rel), "utf8");

// --- one mutant -------------------------------------------------------------

test("a single mutant whose test appends to a tracked file reads restored false and names the file", (t) => {
  const f = batchTree(t, FILES);
  const result = single(f, `echo more >> README.md; ${CHECK}`);
  assert.equal(result.code, 2, result.out + result.err);
  assert.equal(result.payload.restored, false);
  assert.deepEqual(result.payload.left, ["README.md"]);
  assert.equal(result.payload.caught, true, "the verdict is still reported");
  assert.equal(read(f, "src/m.js"), FILES["src/m.js"], "the mutant itself is back");
  assert.equal(read(f, "README.md"), "readme\nmore\n", "the change the test made is left for the host to see");
  git(f.root, "checkout", "--", "README.md");
  const out = human(f, `echo again >> README.md; ${CHECK}`);
  assert.match(out, /^not restored: the test command left README\.md changed/m);
  assert.match(out, HINT);
  assert.match(out, OTHER);
  assert.match(out, /put that path back before the next step/);
});

test("a single mutant whose test creates untracked files names each file, at most five on the line", (t) => {
  const f = batchTree(t, FILES);
  const result = single(f, "mkdir -p out && for i in 1 2 3 4 5 6; do echo x > out/$i.txt; done; true");
  assert.equal(result.code, 2, result.out + result.err);
  assert.equal(result.payload.restored, false);
  assert.deepEqual(result.payload.left, ["out/1.txt", "out/2.txt", "out/3.txt", "out/4.txt", "out/5.txt", "out/6.txt"]);
  fs.rmSync(path.join(f.root, "out"), { recursive: true });
  const out = human(f, "mkdir -p out && for i in 1 2 3 4 5 6; do echo x > out/$i.txt; done; true");
  assert.match(out, /left out\/1\.txt, out\/2\.txt, out\/3\.txt, out\/4\.txt, out\/5\.txt and 1 more changed/);
  assert.match(out, /put those paths back before the next step/);
});

test("a single mutant whose test deletes a tracked file names it", (t) => {
  const f = batchTree(t, FILES);
  const result = single(f, "rm README.md; true");
  assert.equal(result.payload.restored, false);
  assert.deepEqual(result.payload.left, ["README.md"]);
});

test("a single mutant that leaves the tree as it found it reads restored true, an ignored file aside", (t) => {
  const f = batchTree(t, FILES);
  const result = single(f, `mkdir -p build && echo x > build/out; ${CHECK}`);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.payload.restored, true);
  assert.equal(result.payload.left, undefined);
  assert.equal(git(f.root, "status", "--porcelain"), "");
});

// --- a batch ----------------------------------------------------------------

test("a batch whose test appends to a tracked file reads restored false, names it, and gives the hint", (t) => {
  const f = batchTree(t, FILES);
  const result = runBatch(f, js(`echo more >> README.md; ${CHECK}`), { json: true });
  assert.equal(result.code, 2, result.out + result.err);
  assert.equal(result.payload.restored, false);
  assert.deepEqual(result.payload.left, ["README.md"]);
  assert.equal(result.payload.entries[0].caught, true);
  assert.equal(read(f, "src/m.js"), FILES["src/m.js"]);
  git(f.root, "checkout", "--", "README.md");
  const out = runBatch(f, js(`echo again >> README.md; ${CHECK}`)).out;
  assert.match(out, /^not restored: the test command left README\.md changed/m);
  assert.match(out, HINT);
  assert.match(out, OTHER);
});

test("a batch whose test creates an untracked file names that file", (t) => {
  const f = batchTree(t, FILES);
  const result = runBatch(f, js(`mkdir -p gen && echo x > gen/new.txt; ${CHECK}`), { json: true });
  assert.equal(result.code, 2, result.out + result.err);
  assert.equal(result.payload.restored, false);
  assert.deepEqual(result.payload.left, ["gen/new.txt"]);
});

test("a batch that leaves the tree as it found it reads restored true, and its own batch file in the tree is not blamed", (t) => {
  const f = batchTree(t, FILES);
  const result = runBatch(f, js(CHECK), { json: true, file: path.join(f.root, "batch.json") });
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.payload.restored, true);
  assert.equal(result.payload.left, undefined);
});

test("a file dirty before the batch that the test then changes is blamed", (t) => {
  const f = batchTree(t, FILES);
  const result = runBatch(f, js(`echo more >> batch.json; ${CHECK}`), { json: true, file: path.join(f.root, "batch.json") });
  assert.equal(result.code, 2, result.out + result.err);
  assert.deepEqual(result.payload.left, ["batch.json"]);
});

test("a batch that stops with no verdict and left a file changed does not say every file is restored", (t) => {
  const f = batchTree(t, FILES);
  const entries = [{ criterion: "AC1", file: "src/lib.rs", line: 1, find: "3", replace: "9", test: `echo more >> README.md; ${fakeTest(f, "gamma", "{ 99 }")}` }];
  const result = runBatch(f, entries);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /red with every switch off/);
  assert.doesNotMatch(result.out, /every file is restored/);
  assert.match(result.out, /^not restored: the test command left README\.md changed/m);
  writeFile(path.join(f.root, "README.md"), FILES["README.md"]);
  const clean = runBatch(f, [{ ...entries[0], test: fakeTest(f, "gamma", "{ 99 }") }]);
  assert.match(clean.out, /^every file is restored$/m);
});
