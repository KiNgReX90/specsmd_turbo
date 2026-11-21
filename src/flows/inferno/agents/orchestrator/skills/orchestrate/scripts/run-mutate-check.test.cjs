const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

// A criterion only a plain check proves (a grep count, a probe line) takes that check as its
// mutant's test, and the entry says `check: true`. The runner then reads the check's exit code:
// zero on the tree as it is, which it runs first, and non-zero on the mutant reads caught. A check
// red on the tree as it is, a run something killed, and a failed build read no verdict. A check runs
// as written in the tree, never through the host's wrapper, its session or the machine's build
// queue, so no wrapper's own failure can read as caught.

const { calls, checks, outsideConfig, readIn, sessionBatch, sessionBlock, sessionTree } = require("./run-mutate-session-fixture.cjs");
const { readBatch } = require("./run-mutate-entries.cjs");
const { verdictOf } = require("./run-mutate-verdict.cjs");
const { writeFile } = require("./test-write.cjs");

const GREP = "test $(git grep -n FORBIDDEN -- src | wc -l) -eq 0";
// The same check, logging the count it read to check-runs.log beside the tree.
const LOGGED = 'n=$(git grep -n FORBIDDEN -- src | wc -l); echo "$n" >> ../check-runs.log; test "$n" -eq 0';
const ADDS = { criterion: "AC1", file: "src/m.txt", line: 2, find: "beta = 2", replace: "FORBIDDEN = 2" };
const LIB = "pub fn alpha() -> usize { ONE + TEN }\npub fn beta() -> usize { 2 }\n";

const shown = (result) => result.out + result.err;
const checkRuns = (f) => {
  const log = path.join(f.dir, "check-runs.log");
  return fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
};
const rows = (result) => result.payload.entries.map((row) => [row.caught, row.why]);

test("a mutant that adds the line a grep forbids reads caught when its entry says check: true", (t) => {
  const f = sessionTree(t);
  const marked = sessionBatch(f, [{ ...ADDS, test: GREP, check: true }], { json: true });
  assert.equal(marked.code, 0, shown(marked));
  assert.deepEqual(rows(marked), [[true, undefined]]);
  assert.equal(readIn(f, "src/m.txt"), "alpha = 1\nbeta = 2\ngamma = 3\n", "the line is put back");

  const bare = sessionBatch(f, [{ ...ADDS, test: GREP }], { json: true });
  assert.equal(bare.code, 0, shown(bare));
  assert.equal(bare.payload.entries[0].caught, null, "without the key a check still reads no summary");
  assert.match(bare.payload.entries[0].why, /^no test summary reports a failure \(exit 1\): .*check: true/);
});

test("the check runs once on the tree as it is, before any mutant, and entries of one check share that run", (t) => {
  const f = sessionTree(t);
  const result = sessionBatch(f, [
    { ...ADDS, test: LOGGED, check: true },
    { criterion: "AC2", file: "src/m.txt", line: 1, find: "alpha = 1", replace: "FORBIDDEN = 1", test: LOGGED, check: true },
    { criterion: "AC3", file: "src/m.txt", line: 3, find: "gamma = 3", replace: "gamma = 9", test: `echo runner >> ../check-runs.log; ${checks("gamma = 3")}` },
  ], { json: true });
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(rows(result), [[true, undefined], [true, undefined], [true, undefined]]);
  assert.deepEqual(checkRuns(f), ["0", "1", "1", "runner"], "one unmutated run of the check, then one run per mutant; a runner's test runs once");
});

test("a check red on the tree as it is reads no verdict, and its mutant never runs", (t) => {
  const f = sessionTree(t, { "src/m.txt": "alpha = 1\nbeta = 2\nFORBIDDEN = 3\n" });
  const result = sessionBatch(f, [
    { ...ADDS, test: LOGGED, check: true },
    { criterion: "AC2", file: "src/m.txt", line: 1, find: "alpha = 1", replace: "alpha = 7", test: LOGGED },
  ], { json: true });
  assert.equal(result.code, 0, shown(result));
  assert.equal(result.payload.entries[0].caught, null);
  assert.match(result.payload.entries[0].why, /^the check is red on the tree as it is \(exit 1 -> .*\), so its red on the mutant would prove nothing$/);
  assert.match(result.payload.entries[1].why, /^no test summary reports a failure/, "the same command without the key is no check");
  assert.deepEqual(checkRuns(f), ["1", "1"], "the unmutated run, then only the entry that is no check");
});

test("a check that stays green on its mutant reads caught no, a survivor like any other", (t) => {
  const f = sessionTree(t);
  const result = sessionBatch(f, [{ criterion: "AC1", file: "src/m.txt", line: 1, find: "1", replace: "7", test: GREP, check: true }], { json: true });
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(rows(result), [[false, undefined]]);
});

test("a check killed on its mutant or on the tree as it is reads no verdict, and a signal stops the batch", (t) => {
  const f = sessionTree(t);
  const onMutant = (code) => `if git grep -q FORBIDDEN -- src; then exit ${code}; fi`;
  const killed = sessionBatch(f, [{ ...ADDS, test: onMutant(137), check: true }], { json: true });
  assert.equal(killed.code, 0, shown(killed));
  assert.deepEqual(rows(killed), [[null, "killed (exit 137)"]]);

  const first = sessionBatch(f, [{ ...ADDS, test: `${LOGGED}; exit 143`, check: true }], { json: true });
  assert.equal(first.code, 0, shown(first));
  assert.equal(first.payload.entries[0].caught, null);
  assert.match(first.payload.entries[0].why, /^the unmutated run of the check was killed \(exit 143 -> /);
  assert.deepEqual(checkRuns(f), ["0"], "its mutant never ran");

  const signalled = sessionBatch(f, [{ ...ADDS, test: "if git grep -q FORBIDDEN -- src; then kill -TERM $$; fi", check: true }], { json: true });
  assert.equal(signalled.code, 2, shown(signalled));
  assert.match(signalled.payload.stopped, /the test of entry 1 ended on SIGTERM/);
  assert.equal(signalled.payload.entries[0].caught, null);

  const before = sessionBatch(f, [{ ...ADDS, test: "kill -TERM $$", check: true }], { json: true });
  assert.equal(before.code, 2, shown(before));
  assert.match(before.payload.stopped, /^the unmutated run of kill -TERM \$\$ ended on SIGTERM, so the batch stopped$/);
  assert.equal(before.payload.entries[0].why, "not run");
  assert.equal(readIn(f, "src/m.txt"), "alpha = 1\nbeta = 2\ngamma = 3\n");
});

test("a signal held during an unmutated run stops the batch before the next one", (t) => {
  const f = sessionTree(t);
  const result = sessionBatch(f, [
    { ...ADDS, test: "echo a >> ../check-runs.log; kill -TERM $PPID", check: true },
    { criterion: "AC2", file: "src/m.txt", line: 1, find: "alpha = 1", replace: "FORBIDDEN = 1", test: LOGGED, check: true },
  ], { json: true });
  assert.equal(result.code, 2, shown(result));
  assert.match(result.payload.stopped, /^the batch stopped on SIGTERM/);
  assert.deepEqual(checkRuns(f), ["a"]);
});

/** A host wrapper beside the tree that logs its call and refuses, as one with no machine free does. */
function refusingWrapper(f) {
  const wrap = path.join(f.dir, "wrap.sh");
  writeFile(wrap, `#!/bin/sh\necho "$@" >> ${JSON.stringify(path.join(f.dir, "wrap.log"))}\necho 'wrapper: no machine free'\nexit 3\n`, { mode: 0o755 });
  const log = path.join(f.dir, "wrap.log");
  return { wrap, called: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0) };
}

test("a check runs as written in the tree, never through mutate.run, so a wrapper that refuses cannot read as caught", (t) => {
  const f = sessionTree(t);
  const { wrap, called } = refusingWrapper(f);
  const config = outsideConfig(f, `mutate:\n  run: "sh ${wrap} {tree} {test}"\n`);
  const result = sessionBatch(f, [
    { ...ADDS, test: GREP, check: true },
    { criterion: "AC2", file: "src/m.txt", line: 1, find: "alpha = 1", replace: "FORBIDDEN = 1", test: `sh ${wrap} . ${JSON.stringify(GREP)}`, check: true },
    { criterion: "AC3", file: "src/m.txt", line: 3, find: "gamma = 3", replace: "gamma = 9", test: checks("gamma = 3") },
  ], { config, json: true });
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(result.payload.entries[0].caught, true, "the refusing wrapper never saw the check");
  assert.equal(result.payload.entries[1].caught, null);
  assert.match(result.payload.entries[1].why, /^a check runs as written in the tree, never through the host's wrapper/);
  assert.equal(result.payload.entries[2].caught, null, "a runner's test still goes through the wrapper");
  assert.equal(called(), 1, "only the runner's test reached the wrapper");
});

test("a host session whose match reaches a check never serves it", (t) => {
  const f = sessionTree(t);
  const config = outsideConfig(f, `mutate:\n${sessionBlock({ match: "^test " })}`);
  const result = sessionBatch(f, [{ ...ADDS, test: GREP, check: true }], { config, json: true });
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(rows(result), [[true, undefined]]);
  assert.equal(result.payload.entries[0].form, "classic");
  assert.deepEqual(calls(f), [], "no session opened");
});

test("a check never queues on the machine's build wrapper, whose own refusal would read as caught", (t) => {
  const f = sessionTree(t);
  const bin = path.join(f.dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  writeFile(path.join(bin, "claude-build"), `#!/bin/sh\necho queued >> ${JSON.stringify(path.join(f.dir, "queued.log"))}\nexit 75\n`, { mode: 0o755 });
  const result = sessionBatch(f, [{ ...ADDS, test: GREP, check: true }], { json: true, env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(rows(result), [[true, undefined]]);
  assert.equal(fs.existsSync(path.join(f.dir, "queued.log")), false);
});

test("a Rust check runs on a build of its own in place, and a mutant whose build failed reads no verdict", (t) => {
  const f = sessionTree(t, { "src/lib.rs": LIB });
  const probe = `${JSON.stringify(f.cargo)} test alpha "ONE + TEN" | grep -q "test result: ok"`;
  const failed = 'if grep -q TWO src/lib.rs; then echo "error: could not compile \\`app\\` (lib)"; exit 101; fi';
  const result = sessionBatch(f, [
    { criterion: "AC1", file: "src/lib.rs", line: 1, find: "ONE", replace: "TWO", test: probe, check: true },
    { criterion: "AC2", file: "src/lib.rs", line: 1, find: "TEN", replace: "TWO", test: failed, check: true },
  ], { json: true });
  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(result.payload.entries.map((row) => [row.form, row.own, row.caught, row.why]), [
    ["classic", "a check runs as written, in place", true, undefined],
    ["classic", "a check runs as written, in place", null, "did not build"],
  ]);
  assert.equal(readIn(f, "src/lib.rs"), LIB);
});

test("an entry's check reads true or is left out", (t) => {
  const f = sessionTree(t);
  const file = path.join(f.dir, "entries.yaml");
  const yaml = (check) => `- criterion: AC1\n  file: src/m.txt\n  line: 2\n  find: beta = 2\n  replace: FORBIDDEN = 2\n  test: grep -c beta src/m.txt\n${check}`;
  for (const [check, want] of [["", false], ["  check: true\n", true]]) {
    writeFile(file, yaml(check));
    assert.equal(readBatch(f.tree, file)[0].check, want);
  }
  writeFile(file, JSON.stringify([{ ...ADDS, test: GREP, check: true }]));
  assert.equal(readBatch(f.tree, file)[0].check, true);
  writeFile(file, yaml("  checked: true\n"));
  assert.throws(() => readBatch(f.tree, file), /entry 1: it holds checked; an entry holds criterion, file, line, find, replace, test only, and check: true/);
  writeFile(file, yaml("  check: yes\n"));
  assert.throws(() => readBatch(f.tree, file), /entry 1: check reads yes; write check: true for a test that is a plain check, or leave it out/);
});

test("a red check's verdict holds every guard a runner's red holds", () => {
  const red = { code: 1, signal: null };
  assert.deepEqual(verdictOf(red, "", null, { test: GREP, check: true }), { caught: true });
  assert.deepEqual(verdictOf({ code: 0, signal: null }, "", null, { test: GREP, check: true }), { caught: false });
  assert.deepEqual(verdictOf({ code: 1, signal: "SIGKILL" }, "", null, { check: true }), { caught: null, why: "ended on SIGKILL" });
  assert.deepEqual(verdictOf({ code: 101, signal: null }, "error: could not compile `app` (lib)\n", null, { check: true }), { caught: null, why: "did not build" });
  assert.deepEqual(verdictOf({ code: 1, signal: null }, "test x ... (signal: 9, SIGKILL: kill)\n", null, { check: true }), { caught: null, why: "killed (SIGKILL)" });
});
