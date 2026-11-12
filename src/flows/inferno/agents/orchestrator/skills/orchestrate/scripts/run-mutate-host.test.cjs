const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// A host decides where its mutant tests run: `mutate.run` is the wrapper every mutant test runs
// through, so a reviewer writes the bare test. A host names its checks under `mutate.checks`, with
// the line each prints on a finding, so a red check can read caught. And a build the machine killed
// is a kill: a control run killed stops the batch before it builds anything more.

const { RUN, fakeTest, git } = require("./run-mutate-fixture.cjs");
const { calls, checks, journalOf, outsideConfig, readIn, sessionBatch, sessionBlock, sessionEnv, sessionTree } = require("./run-mutate-session-fixture.cjs");
const { commandOf, hostOf } = require("./run-mutate-host.cjs");
const { readConfig, RunError } = require("./run-lib.cjs");
const { runEntries } = require("./run-mutant-runs.cjs");
const { writeFile } = require("./test-write.cjs");

const LIB = "pub fn alpha() -> usize { ONE + TEN }\npub fn beta() -> usize { 2 }\n";

// The host's wrapper: it logs each call beside the tree and runs the test it was given in the tree
// it was given, or refuses with WRAP_REFUSE as a wrapper with no machine free does.
const WRAP = String.raw`'use strict';
const fs = require('fs');
const { spawnSync } = require('child_process');
const [mode, tree, test, ...rest] = process.argv.slice(2);
fs.appendFileSync(process.env.WRAP_LOG, JSON.stringify({ mode, tree, test, rest, mutant: process.env.INFERNO_MUTANT || null }) + '\n');
if (process.env.WRAP_REFUSE) { console.log('wrapper: no machine free, refusing'); process.exit(3); }
const run = spawnSync('bash', ['-c', test], { cwd: tree, stdio: 'inherit' });
process.exit(run.status === null ? 1 : run.status);
`;

// A check: red with its own finding line once src/m.txt lost a line it needs, with no runner's summary.
const LINT = String.raw`'use strict';
const text = require('fs').readFileSync('src/m.txt', 'utf8');
if (!text.includes('alpha = 1')) { console.log('LINT FINDING: alpha is not 1'); process.exit(1); }
`;

/** A session tree with the wrapper beside it; `wrap` is its path, `log` the calls it logged. */
function hostTree(t, files = {}) {
  const f = sessionTree(t, { "lint.cjs": LINT, ...files });
  const wrap = path.join(f.dir, "wrap.cjs");
  writeFile(wrap, WRAP);
  const log = path.join(f.dir, "wrap.log");
  const wrapped = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  return { ...f, wrap, log, wrapped };
}

const runKey = (f) => `  run: "node ${f.wrap} auto {tree} {test}"\n`;
const batch = (f, entries, config, env = {}) => sessionBatch(f, entries, { config: outsideConfig(f, config), json: true, env: { WRAP_LOG: f.log, ...env } });
const shellWord = (value) => `'${value.replace(/'/g, "'\\''")}'`;

test("with mutate.run a bare test runs through the wrapper with the tree and the test as one word each", (t) => {
  const f = hostTree(t);
  const bare = checks("alpha = 1", "beta = 2");
  const result = batch(f, [
    { criterion: "AC1", file: "src/m.txt", line: 1, find: "1", replace: "7", test: bare },
    { criterion: "AC2", file: "src/m.txt", line: 3, find: "3", replace: "9", test: bare },
  ], `mutate:\n${runKey(f)}`);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => [e.test, e.caught]), [[bare, true], [bare, false]], "each row keeps the test the reviewer wrote");
  assert.deepEqual(f.wrapped().map((call) => [call.mode, call.tree, call.test, call.rest.length]), Array(2).fill(["auto", f.tree, bare, 0]));
  assert.equal(git(f.tree, "status", "--porcelain"), "");
});

test("a test that already starts with the wrapper is not wrapped twice", (t) => {
  const f = hostTree(t);
  const bare = checks("alpha = 1");
  const result = batch(f, [
    { criterion: "AC1", file: "src/m.txt", line: 1, find: "1", replace: "7", test: `node ${f.wrap} auto . ${shellWord(bare)}` },
  ], `mutate:\n${runKey(f)}`);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.payload.entries[0].caught, true);
  assert.deepEqual(f.wrapped().map((call) => [call.tree, call.test]), [[".", bare]], "one call of the wrapper, as written");
  assert.equal(commandOf(hostOf({ mutate: { run: "tools/w.sh {tree} {test}" } }), "/w/app", "tools/w.sh . npm test"), "tools/w.sh . npm test");
  assert.equal(commandOf(hostOf({ mutate: { run: "tools/w.sh {tree} {test}" } }), "/w/app", "tools/w.shx npm test"), "tools/w.sh '/w/app' 'tools/w.shx npm test'");
  assert.equal(commandOf(hostOf({}), "/w/app", "npm test"), "npm test", "without the key a test runs as written");
});

test("Rust entries keep their shared build through mutate.run, and each switch reaches the wrapped test", (t) => {
  const f = hostTree(t, { "src/lib.rs": LIB });
  const result = batch(f, [
    { criterion: "AC1", file: "src/lib.rs", line: 1, find: "ONE", replace: "TWO", test: fakeTest(f, "alpha", "ONE + TEN") },
    { criterion: "AC2", file: "src/lib.rs", line: 2, find: "2", replace: "8", test: fakeTest(f, "beta", "usize") },
  ], `mutate:\n${runKey(f)}`);
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(result.payload.builds, 1);
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught]), [["switch", true], ["switch", false]]);
  assert.deepEqual(f.wrapped().map((call) => call.mutant), [null, null, "1", "2"], "two control runs, then each switch alone");
});

test("mutate.session matches on the wrapped command, and its session runs the bare test", (t) => {
  const f = hostTree(t);
  const bare = checks("alpha = 1", "gamma = 3");
  const config = `mutate:\n  run: "node remote.cjs direct {tree} {test}"\n${sessionBlock({ match: "^node remote\\.cjs direct \\S+ " })}`;
  const result = batch(f, [
    { criterion: "AC1", file: "src/m.txt", line: 1, find: "1", replace: "7", test: bare },
    { criterion: "AC2", file: "src/m.txt", line: 2, find: "2", replace: "8", test: bare },
  ], config);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught]), [["session", true], ["session", false]]);
  assert.equal(calls(f, "open").length, 1);
  assert.equal(calls(f, "direct").length, 0);
  assert.deepEqual(calls(f, "run").map((call) => call.test), [bare, bare]);
});

test("a single mutant runs its bare test through mutate.run", (t) => {
  const f = hostTree(t);
  const config = outsideConfig(f, `mutate:\n${runKey(f)}`);
  const bare = checks("alpha = 1");
  const result = spawnSync(process.execPath, [RUN, "mutate", "--tree", f.tree, "--file", "src/m.txt", "--line", "1", "--replace", "alpha = 7",
    "--test", bare, "--config", config, "--json"], { cwd: f.tree, encoding: "utf8", env: sessionEnv(f, { WRAP_LOG: f.log }) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).caught, true);
  assert.deepEqual(f.wrapped().map((call) => call.test), [bare]);
  assert.equal(readIn(f, "src/m.txt").split("\n")[0], "alpha = 1");
});

test("a listed check that printed its finding line reads caught, and the same check ended by a wrapper error reads no verdict", (t) => {
  const f = hostTree(t);
  const config = `mutate:\n${runKey(f)}  checks:\n    - match: '^node lint\\.cjs\\b'\n      finding: '^LINT FINDING: '\n`;
  const entries = [{ criterion: "AC1", file: "src/m.txt", line: 1, find: "1", replace: "7", test: "node lint.cjs" }];
  const found = batch(f, entries, config);
  assert.equal(found.code, 0, found.out + found.err);
  assert.equal(found.payload.entries[0].caught, true);
  const refused = batch(f, entries, config, { WRAP_REFUSE: "1" });
  assert.equal(refused.code, 0, refused.out + refused.err);
  assert.equal(refused.payload.entries[0].caught, null);
  assert.match(refused.payload.entries[0].why, /^no test summary reports a failure \(exit 3\)$/);
  const unlisted = batch(f, entries, `mutate:\n${runKey(f)}`);
  assert.equal(unlisted.payload.entries[0].caught, null);
  assert.match(unlisted.payload.entries[0].why, /a check cannot prove a mutant.*\(gate: <name>\).*mutate\.checks/);
});

// A control run whose compiler the machine killed: cargo exits 101 with could not compile, as a
// failed build does. It counts each run, so a test sees that nothing more was built.
const KILLED = "#!/bin/sh\necho run >> \"$KILLED_RUNS\"\necho '   Compiling dep-utils v2.0.0'\necho 'sccache: Compiler killed by signal 15'\n" +
  "echo 'error: could not compile `dep-utils` (lib)'\nexit 101\n";

function killedTree(t) {
  const f = hostTree(t, { "src/lib.rs": LIB });
  const cargo = path.join(f.dir, "killed", "cargo");
  fs.mkdirSync(path.dirname(cargo), { recursive: true });
  writeFile(cargo, KILLED, { mode: 0o755 });
  const killedRuns = path.join(f.dir, "killed-runs");
  const count = () => (fs.existsSync(killedRuns) ? fs.readFileSync(killedRuns, "utf8").split("\n").filter(Boolean).length : 0);
  const entries = [
    { criterion: "AC1", file: "src/lib.rs", line: 1, find: "ONE", replace: "TWO", test: `${cargo} test alpha` },
    { criterion: "AC2", file: "src/lib.rs", line: 2, find: "2", replace: "8", test: `${cargo} test alpha` },
  ];
  return { ...f, killedRuns, count, entries };
}

test("a control run whose compiler was killed by signal 15 stops the batch and builds nothing more", (t) => {
  const f = killedTree(t);
  const result = sessionBatch(f, f.entries, { json: true, env: { KILLED_RUNS: f.killedRuns } });
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.payload.stopped, /killed \(SIGTERM\)/);
  assert.doesNotMatch(result.payload.stopped, /red with every switch off|control run of/);
  assert.equal(f.count(), 1, "the control run alone, no build per mutant");
  const human = sessionBatch(f, f.entries, { env: { KILLED_RUNS: f.killedRuns } });
  assert.match(human.out, /run the same command again/);
  assert.equal(readIn(f, "src/lib.rs"), LIB);
  assert.equal(git(f.tree, "status", "--porcelain"), "");
  assert.equal(journalOf(f), null);
});

test("the record step's mutants stop on a killed control run with MUTATE_STOPPED and run the same command again", async (t) => {
  const f = killedTree(t);
  const saved = { ...process.env };
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  Object.assign(process.env, sessionEnv(f, { KILLED_RUNS: f.killedRuns }));
  await assert.rejects(runEntries(f.tree, f.entries.map((entry) => ({ ...entry, line: String(entry.line) })), { rel: ".specs-inferno/review.yaml" }),
    (error) => error instanceof RunError && error.code === "MUTATE_STOPPED" && /run the same command again/.test(error.message));
  assert.equal(f.count(), 1);
  assert.equal(git(f.tree, "status", "--porcelain"), "");
});

test("mutate.run and mutate.checks this runner cannot use fail at config load, naming the key and the file", (t) => {
  const f = hostTree(t);
  for (const [body, key] of [
    ["mutate:\n  run: \"\"\n", /mutate\.run in \S+ must be the wrapper's command with \{tree\} and \{test\} once each, after its own words\./],
    ["mutate:\n  run: \"tools/w.sh {test}\"\n", /mutate\.run in \S+ must be the wrapper's command/],
    ["mutate:\n  run: \"tools/w.sh {tree} {test} {test}\"\n", /mutate\.run in \S+ must be the wrapper's command/],
    ["mutate:\n  run: \"{tree} {test}\"\n", /mutate\.run in \S+ must be the wrapper's command/],
    ["mutate:\n  run: [a]\n", /mutate\.run in \S+ must be the wrapper's command/],
    ["mutate:\n  checks: on\n", /mutate\.checks in \S+ must be a list of \{match, finding\}\./],
    ["mutate:\n  checks:\n    - lint\n", /mutate\.checks\[0\] in \S+ must be a map of match and finding\./],
    ["mutate:\n  checks:\n    - match: a\n      finding: b\n      exit: 1\n", /mutate\.checks\[0\] in \S+ must be a map of match and finding only, not exit\./],
    ["mutate:\n  checks:\n    - finding: b\n", /mutate\.checks\[0\]\.match in \S+ must be a non-empty regex\./],
    ["mutate:\n  checks:\n    - match: a\n      finding: '(b'\n", /mutate\.checks\[0\]\.finding in \S+ must be a regex \(/],
    ["mutate:\n  runs: x\n", /mutate in \S+ must be a map holding sealed, reseal_seconds, session, run and checks only, not runs\./],
  ]) {
    const config = outsideConfig(f, body, "bad.yaml");
    const result = sessionBatch(f, [{ criterion: "AC1", file: "src/m.txt", line: 1, find: "1", replace: "7", test: "node lint.cjs" }], { config });
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, /BAD_CONFIG/);
    assert.match(result.err, key);
    assert.ok(result.err.includes(config), result.err);
  }
  assert.deepEqual(f.wrapped(), [], "a refused config runs nothing");
});

test("a --config file without a mutate block inherits mutate.run and mutate.checks, and a bad one is refused against the file that holds it", (t) => {
  const f = hostTree(t);
  const own = path.join(f.tree, ".specs-inferno", "config.yaml");
  fs.mkdirSync(path.dirname(own), { recursive: true });
  writeFile(own, `mutate:\n${runKey(f)}  checks:\n    - match: lint\n      finding: FINDING\n`);
  const selected = outsideConfig(f, "worker:\n  model: x\n", "selected.yaml");
  const host = hostOf(readConfig(f.tree, selected));
  assert.equal(host.run.text, `node ${f.wrap} auto {tree} {test}`);
  assert.equal(host.checks.length, 1);
  writeFile(own, "mutate:\n  run: \"tools/w.sh {test}\"\n");
  assert.throws(() => readConfig(f.tree, selected), (error) => error.code === "BAD_CONFIG" && error.message.includes(own));
});
