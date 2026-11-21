const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// A mutant test whose command is missing from the tree it runs in ends on exit 127 before any test.
// Every entry that runs in place has no control run, so each would pay a write, a run and a restore
// to learn the same thing. Once one entry's run reads that its command was not found, every later
// entry with the same test, as the batch runs it, is not written and not run: it reads not run,
// without a verdict, and the record leaves it owed. An entry with another test still runs.

const { RUN, batchTree, builds, fakeTest, git, runs } = require("./run-mutate-fixture.cjs");
const { reseals, sealTree } = require("./run-mutate-fixture.cjs");
const { calls, checks, outsideConfig, sessionBlock, sessionEnv, sessionTree, wrapped } = require("./run-mutate-session-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

const MISSING = /^the test's command was not found \(exit 127\): bash: line 1: shopgen: command not found; the tree the test ran in lacks that command, and the host prepares that tree in the command mutate\.run names or in mutate\.session\.open$/;
const NOT_RUN = (criterion) => `not run, as the test of criterion ${criterion} found no command`;
const SHOPGEN = "echo ran >> ../ran.log; shopgen build";

/** Run a batch of `entries` written outside the tree; `config` is a config file, `json` adds the payload. */
function batch(f, entries, { config = null, json = true } = {}) {
  const file = path.join(f.dir, "batch.json");
  writeFile(file, JSON.stringify(entries));
  const args = [RUN, "mutate", "--tree", f.tree, "--batch", file, ...(config ? ["--config", config] : []), ...(json ? ["--json"] : [])];
  const result = spawnSync(process.execPath, args, { cwd: f.tree, encoding: "utf8", env: sessionEnv(f) });
  return { code: result.status, out: result.stdout, err: result.stderr, payload: json ? JSON.parse(result.stdout) : null };
}

const ran = (f) => {
  const log = path.join(f.dir, "ran.log");
  return fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0;
};
const on = (criterion, file, line, find, replace, test) => ({ criterion, file, line, find, replace, test });

test("three entries with one test whose first run exits 127 run it once; the two after are neither written nor run, and another test still runs", (t) => {
  const f = sealTree(t);
  const entries = [
    on("AC1", "defs/value.txt", 1, "1", "2", SHOPGEN),
    on("AC2", "defs/value.txt", 1, "1", "3", SHOPGEN),
    on("AC3", "defs/value.txt", 1, "1", "4", SHOPGEN),
    on("AC4", "src/plain.txt", 1, "x", "y", "grep -q y src/plain.txt || { echo '# fail 1'; exit 1; }"),
  ];
  const result = batch(f, entries);
  assert.equal(result.code, 0, result.out + result.err);
  const rows = result.payload.entries;
  assert.equal(rows[0].caught, null);
  assert.match(rows[0].why, MISSING);
  assert.equal(rows[0].code, 127);
  assert.equal(rows[0].skipped, undefined, "the entry that ran is no skipped one");
  assert.deepEqual(rows.slice(1, 3).map((row) => [row.caught, row.why, row.skipped, row.code, row.log]),
    Array(2).fill([null, NOT_RUN("AC1"), 1, undefined, undefined]));
  assert.deepEqual([rows[3].caught, rows[3].skipped], [false, undefined], "an entry with another test still runs");
  assert.equal(ran(f), 1, "the test ran once");
  assert.equal(reseals(f), 1, "only the first entry was written into the sealed file");
  assert.equal(git(f.tree, "status", "--porcelain"), "");
  assert.equal(fs.readFileSync(path.join(f.tree, "defs/value.txt"), "utf8"), "1\n");
});

test("the text names the reason once and how many entries did not run for it, and pastes only what has a verdict", (t) => {
  const f = sessionTree(t);
  const result = batch(f, [
    on("AC1", "src/m.txt", 1, "1", "7", SHOPGEN),
    on("AC2", "src/m.txt", 2, "2", "8", SHOPGEN),
    on("AC3", "src/m.txt", 3, "3", "9", SHOPGEN),
    on("AC4", "src/m.txt", 3, "3", "5", checks("gamma = 3")),
  ], { json: false });
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.out.split("was not found (exit 127)").length - 1, 1, result.out);
  assert.match(result.out, /^no verdict: the test's command was not found \(exit 127\): .* \| src\/m\.txt:1 \| AC1$/m);
  assert.match(result.out, /^no verdict: not run, as the test of criterion AC1 found no command \| src\/m\.txt:2 \| AC2$/m);
  assert.match(result.out, /^no verdict: not run, as the test of criterion AC1 found no command \| src\/m\.txt:3 \| AC3$/m);
  assert.match(result.out, /^2 entries did not run, as the test of criterion AC1 found no command$/m);
  assert.equal(result.out.split("entries did not run").length - 1, 1, "one line for the test, not one per entry");
  assert.match(result.out, /^caught yes \| src\/m\.txt:3 \| AC4$/m);
  const pasted = result.out.slice(result.out.indexOf("paste under mutants:"));
  assert.equal(pasted, `paste under mutants:\n  - criterion: "AC4"\n    test: ${JSON.stringify(checks("gamma = 3"))}\n    caught: yes\n`);
  const one = batch(f, [on("AC1", "src/m.txt", 1, "1", "7", SHOPGEN), on("AC2", "src/m.txt", 2, "2", "8", SHOPGEN)], { json: false });
  assert.match(one.out, /^1 entry did not run, as the test of criterion AC1 found no command$/m);
});

test("two tests that each find no command get a line each, with their own count and their own criterion", (t) => {
  const f = sessionTree(t);
  const other = "echo ran >> ../ran.log; shopgen-cli check";
  const result = batch(f, [
    on("AC1", "src/m.txt", 1, "1", "7", SHOPGEN),
    on("AC2", "src/m.txt", 2, "2", "8", other),
    on("AC3", "src/m.txt", 3, "3", "9", SHOPGEN),
    on("AC4", "src/m.txt", 1, "1", "6", SHOPGEN),
    on("AC5", "src/m.txt", 2, "2", "5", other),
  ], { json: false });
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^2 entries did not run, as the test of criterion AC1 found no command$/m);
  assert.match(result.out, /^1 entry did not run, as the test of criterion AC2 found no command$/m);
  assert.equal(ran(f), 2);
});

// The same test is the same command as the batch runs it: a test written bare and the same test
// written through the host's wrapper as `mutate.run` would place it run one command, while a test
// that differs in any byte of that command is another one.
const WRAP = String.raw`'use strict';
const { spawnSync } = require('child_process');
const [tree, test] = process.argv.slice(2);
const run = spawnSync('bash', ['-c', test], { cwd: tree, stdio: 'inherit' });
console.log('wrapper: exit ' + run.status);
process.exit(run.status === null ? 1 : run.status);
`;
const word = (value) => `'${value.replace(/'/g, "'\\''")}'`;

test("through mutate.run the skip holds the command as placed: a test written through the wrapper is the bare one, a byte more is another", (t) => {
  const f = sessionTree(t);
  const wrap = path.join(f.dir, "wrap.cjs");
  writeFile(wrap, WRAP);
  const config = outsideConfig(f, `mutate:\n  run: "node ${wrap} {tree} {test}"\n`);
  const result = batch(f, [
    on("AC1", "src/m.txt", 1, "1", "7", SHOPGEN),
    on("AC2", "src/m.txt", 2, "2", "8", `node ${wrap} ${word(f.tree)} ${word(SHOPGEN)}`),
    on("AC3", "src/m.txt", 3, "3", "9", `${SHOPGEN} `),
  ], { config });
  assert.equal(result.code, 0, result.out + result.err);
  const rows = result.payload.entries;
  assert.match(rows[0].why, MISSING, "the wrapper's own last line is not the one named");
  assert.deepEqual([rows[1].why, rows[1].skipped], [NOT_RUN("AC1"), 1]);
  assert.match(rows[2].why, MISSING);
  assert.equal(rows[2].skipped, undefined);
  assert.equal(ran(f), 2, "the bare test ran once, the one with a byte more ran too");
  fs.rmSync(path.join(f.dir, "ran.log"));
  const placedFirst = batch(f, [
    on("AC1", "src/m.txt", 1, "1", "7", `node ${wrap} ${word(f.tree)} ${word(SHOPGEN)}`),
    on("AC2", "src/m.txt", 2, "2", "8", SHOPGEN),
  ], { config });
  assert.equal(placedFirst.code, 0, placedFirst.out + placedFirst.err);
  assert.match(placedFirst.payload.entries[0].why, MISSING);
  assert.deepEqual([placedFirst.payload.entries[1].why, placedFirst.payload.entries[1].skipped], [NOT_RUN("AC1"), 1], "the bare test after the placed one");
  assert.equal(ran(f), 1);
});

test("inside a mutate.session the skip holds too: one run in the session, and an entry with another test still runs there", (t) => {
  const f = sessionTree(t);
  const config = outsideConfig(f, `mutate:\n${sessionBlock()}`);
  const result = batch(f, [
    on("AC1", "src/m.txt", 1, "1", "7", wrapped(SHOPGEN)),
    on("AC2", "src/m.txt", 2, "2", "8", wrapped(SHOPGEN)),
    on("AC3", "src/m.txt", 3, "3", "9", wrapped(checks("gamma = 3"))),
  ], { config });
  assert.equal(result.code, 0, result.out + result.err);
  const rows = result.payload.entries;
  assert.deepEqual(rows.map((row) => row.form), ["session", "session", "session"]);
  assert.match(rows[0].why, MISSING);
  assert.deepEqual([rows[1].caught, rows[1].why, rows[1].skipped], [null, NOT_RUN("AC1"), 1]);
  assert.equal(rows[2].caught, true);
  assert.deepEqual(calls(f, "run").map((call) => call.test), [SHOPGEN, checks("gamma = 3")]);
  assert.deepEqual(calls(f, "send").map((call) => call.file), ["src/m.txt", "src/m.txt", "src/m.txt", "src/m.txt"], "the skipped mutant is never sent");
  assert.deepEqual([calls(f, "open").length, calls(f, "close").length], [1, 1]);
});

test("a Rust entry on a build of its own inside the session skips a later entry the session serves with its test", (t) => {
  const f = sessionTree(t, { "src/lib.rs": "#[doc = \"beta\"] pub fn beta() -> usize { 2 }\n" });
  const config = outsideConfig(f, `mutate:\n${sessionBlock()}`);
  const result = batch(f, [
    on("AC1", "src/lib.rs", 1, "\"beta\"", "\"omega\"", wrapped(SHOPGEN)),
    on("AC2", "src/m.txt", 1, "1", "7", wrapped(SHOPGEN)),
  ], { config });
  assert.equal(result.code, 0, result.out + result.err);
  const rows = result.payload.entries;
  assert.deepEqual(rows.map((row) => row.form), ["classic", "session"]);
  assert.match(rows[0].why, MISSING);
  assert.deepEqual([rows[1].why, rows[1].skipped], [NOT_RUN("AC1"), 1]);
  assert.equal(calls(f, "run").length, 1);
});

const LIB = "pub fn alpha() -> usize { 1 }\n#[doc = \"beta\"] pub fn beta() -> usize { 2 }\npub fn gamma() -> usize { 3 }\n";

test("a Rust entry on a build of its own reads the reason and skips a later entry with its test", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB, "src/m.js": "module.exports = 1;\n" });
  const tree = { ...f, tree: f.root };
  const result = batch(tree, [
    on("AC1", "src/lib.rs", 2, "\"beta\"", "\"omega\"", SHOPGEN),
    on("AC2", "src/m.js", 1, "1", "2", SHOPGEN),
  ]);
  assert.equal(result.code, 0, result.out + result.err);
  const rows = result.payload.entries;
  assert.equal(rows[0].form, "classic");
  assert.match(rows[0].why, MISSING);
  assert.deepEqual([rows[1].why, rows[1].skipped], [NOT_RUN("AC1"), 1]);
  assert.equal(ran(f), 1);
});

test("a control run that exits 127 stops the batch with the reason, before any switched run", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB });
  const test = `${fakeTest(f, "alpha", "{ 1 }")} > /dev/null; shopgen build`;
  const result = batch({ ...f, tree: f.root }, [on("AC1", "src/lib.rs", 1, "1", "7", test), on("AC2", "src/lib.rs", 3, "3", "9", test)]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.payload.stopped, /^the control run of .* has no verdict, the test's command was not found \(exit 127\): bash: line 1: shopgen: command not found; .* mutate\.session\.open \(-> \S+\), so no entry has one$/);
  assert.deepEqual(runs(f).map((run) => run.on), [null], "one control run, no switched one");
  assert.equal(builds(f), 1);
  const refusing = `${fakeTest(f, "alpha", "{ 1 }")} > /dev/null; echo 'wrapper: no machine free, refusing'; exit 127`;
  const config = path.join(f.dir, "refused.yaml");
  writeFile(config, "verification:\n  refused: \"^wrapper: no machine free\"\n");
  const refused = batch({ ...f, tree: f.root }, [on("AC1", "src/lib.rs", 1, "1", "7", refusing)], { config });
  assert.match(refused.payload.stopped, /^the control run of .* has no verdict, no test summary reports a failure \(exit 127\)/, "a refusal reads as before");
});

test("a switched run that exits 127 reads the reason, and the control proved the command, so a switched entry with that test still runs", (t) => {
  const f = batchTree(t, { "src/lib.rs": LIB });
  // Green with every switch off; a switched run turns the fake red, its output dropped, and then calls a missing command.
  const test = `${fakeTest(f, "alpha", "{ 1 }")} > /dev/null && ${fakeTest(f, "gamma", "{ 3 }")} > /dev/null || shopgen build`;
  const result = batch({ ...f, tree: f.root }, [on("AC1", "src/lib.rs", 1, "1", "7", test), on("AC2", "src/lib.rs", 3, "3", "9", test)]);
  assert.equal(result.code, 0, result.out + result.err);
  const rows = result.payload.entries;
  assert.deepEqual(rows.map((row) => [row.form, row.skipped]), [["switch", undefined], ["switch", undefined]]);
  for (const row of rows) assert.match(row.why, MISSING);
  assert.deepEqual(runs(f).map((run) => [run.name, run.on]), [["alpha", null], ["gamma", null], ["alpha", "1"], ["alpha", "2"], ["gamma", "2"]]);
});

// A check (`check: true`) runs once on the tree as it is first. When that run exits 127 every entry
// of the check reads the reason and no mutant of it runs, as for any check red there. A check green
// there proved its command is in the tree, so its own 127 is the mutant's, and it neither skips nor
// is skipped by an entry that is no check.
test("a check whose run on the tree as it is exits 127 gives each of its entries the reason, colour codes cut, and runs no mutant", (t) => {
  const f = sessionTree(t);
  const lint = "echo ran >> ../ran.log; printf '\\033[31msh: 1: lintgen: not found\\033[0m\\n'; exit 127";
  const result = batch(f, [
    { ...on("AC1", "src/m.txt", 1, "1", "7", lint), check: true },
    { ...on("AC2", "src/m.txt", 2, "2", "8", lint), check: true },
  ]);
  assert.equal(result.code, 0, result.out + result.err);
  const why = "the test's command was not found (exit 127): sh: 1: lintgen: not found; the tree the test ran in lacks that command, " +
    "and the host prepares that tree in the command mutate.run names or in mutate.session.open";
  assert.deepEqual(result.payload.entries.map((row) => [row.caught, row.why, row.skipped]), Array(2).fill([null, why, undefined]));
  assert.equal(ran(f), 1, "only the run on the tree as it is");
});

test("a check whose script a mutant breaks into a command not found reads caught yes", (t) => {
  const f = sessionTree(t, { "tools/check.sh": "grep -q 'alpha = 1' src/m.txt\n" });
  const result = batch(f, [{ ...on("AC1", "tools/check.sh", 1, "grep", "grpe", "sh tools/check.sh"), check: true }], { json: false });
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^caught yes \| tools\/check\.sh:1 \| AC1$/m);
});

test("a check proven on the tree as it is neither skips an entry with its command nor is skipped by one", (t) => {
  const f = sessionTree(t);
  const test = "echo ran >> ../ran.log; grep -q 'alpha = 1' src/m.txt || shopgen build";
  for (const first of [false, true]) {
    fs.rmSync(path.join(f.dir, "ran.log"), { force: true });
    const result = batch(f, [
      { ...on("AC1", "src/m.txt", 1, "1", "7", test), ...(first ? { check: true } : {}) },
      { ...on("AC2", "src/m.txt", 1, "1", "6", test), ...(first ? {} : { check: true }) },
    ]);
    assert.equal(result.code, 0, result.out + result.err);
    const [check, plain] = first ? result.payload.entries : [...result.payload.entries].reverse();
    assert.deepEqual([check.caught, check.skipped], [true, undefined], "the check noticed the mutant");
    assert.match(plain.why, MISSING);
    assert.equal(plain.skipped, undefined);
    assert.equal(ran(f), 3, "the check's run on the tree as it is, then both mutants");
  }
});

// A run whose last line is the host's refusal (`verification.refused`) is the wrapper's: it ran
// nothing, so it reads as before and skips nothing, in place and in a session alike.
const REFUSING = "echo ran >> ../ran.log; echo 'wrapper: no machine free, refusing'; exit 127";

test("a refusal of the host's wrapper that exits 127 reads as before and skips no entry, in place and in a session", (t) => {
  const f = sessionTree(t);
  const config = outsideConfig(f, `verification:\n  refused: "^wrapper: no machine free"\nmutate:\n${sessionBlock()}`);
  const result = batch(f, [
    on("AC1", "src/m.txt", 1, "1", "7", REFUSING),
    on("AC2", "src/m.txt", 2, "2", "8", REFUSING),
    on("AC3", "src/m.txt", 3, "3", "9", wrapped(REFUSING)),
  ], { config });
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((row) => row.form), ["classic", "classic", "session"]);
  for (const row of result.payload.entries) {
    assert.match(row.why, /^no test summary reports a failure \(exit 127\)/);
    assert.equal(row.skipped, undefined);
  }
  assert.equal(ran(f), 3);
});

test("a single mutant whose test exits 127 reads the reason, and a refusal of the host's wrapper reads as before", (t) => {
  const f = sessionTree(t);
  const single = (test, extra = []) => {
    const args = [RUN, "mutate", "--tree", f.tree, "--file", "src/m.txt", "--line", "1", "--replace", "alpha = 7", "--test", test, "--json", ...extra];
    const result = spawnSync(process.execPath, args, { cwd: f.tree, encoding: "utf8", env: sessionEnv(f) });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  const missing = single(SHOPGEN);
  assert.equal(missing.caught, null);
  assert.match(missing.why, MISSING);
  const config = outsideConfig(f, "verification:\n  refused: \"^wrapper: no machine free\"\n");
  assert.match(single(REFUSING, ["--config", config]).why, /^no test summary reports a failure \(exit 127\)/);
});
