const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

// What a host session must leave as it was: the seal (a reseal runs in the tree and every path it
// changed reaches the session), the Rust entries' shared build, the config's other keys, and the
// record step of a review, which runs its mutants through this batch under the selected --config.

const {
  REMOTE, beside, calls, checks, outsideConfig, sessionBatch, sessionBlock, sessionTree, wrapped,
} = require("./run-mutate-session-fixture.cjs");
const { VALUE, assertSealed, builds, fakeTest, git, reseals, sealConfig, sealTree } = require("./run-mutate-fixture.cjs");
const { readConfig } = require("./run-lib.cjs");
const { sessionOf } = require("./run-mutate-session.cjs");
const { commandOf, hostOf } = require("./run-mutate-host.cjs");
const { write } = require("./review-fixture.cjs");
const { A_ONE, CONFIG, REVIEW, itemReview, mutantRepo, record } = require("./run-review-mutants-fixture.cjs");
const { parseItemReview } = require("./run-review-file.cjs");

const CONFIG_SESSION = `mutate:\n${sessionBlock()}`;

test("a sealed file in a session is resealed in the tree, every path the reseal changed is sent, and each goes back after", (t) => {
  const f = sealedSession(t);
  const config = outsideConfig(f, sealConfig(`node seal.cjs ${VALUE}`, { extra: sessionBlock() }));
  const result = sessionBatch(f, [
    { criterion: "AC1", file: VALUE, line: 1, find: "1", replace: "2", test: wrapped("node check.cjs strict") },
    { criterion: "AC2", file: VALUE, line: 1, find: "1", replace: "2", test: wrapped("node check.cjs any") },
  ], { config, json: true, env: { FAKE_WATCH: `${VALUE},manifest.txt` } });
  assert.equal(result.code, 0, result.out + result.err);
  // A seal left stale in the session fails every test there, so AC2 would read caught.
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught]), [["session", true], ["session", false]]);
  assert.equal(reseals(f), 2);
  const first = calls(f, "send").filter((send) => send.nth <= 5).map((send) => send.file);
  assert.equal(first[0], VALUE);
  assert.deepEqual([...first].sort(), [".seal-stamp", "defs/seal.lock", "defs/stamp.lock", VALUE, "manifest.txt"]);
  assert.deepEqual(calls(f, "send").slice(5, 10).map((send) => send.file), first, "the same paths go back");
  assert.ok(calls(f, "run").every((run) => run.held[VALUE] === "2\n" && run.held["manifest.txt"] !== f.manifest));
  const remote = (rel) => path.join(f.remote, rel);
  assert.equal(fs.readFileSync(remote("manifest.txt"), "utf8"), f.manifest, "the session's seal is the original again");
  assert.equal(fs.readFileSync(remote(f.lock.rel), "utf8"), f.lock.body);
  assert.equal(fs.existsSync(remote(f.stamp)), false, "a path the reseal made is deleted in the session");
  assert.equal(fs.existsSync(remote(".seal-stamp")), false);
  assertSealed(f);
});

/** A sealed tree with the wrapper and its files beside it. */
function sealedSession(t) {
  const f = { ...sealTree(t, { "remote.cjs": REMOTE }), state: null };
  return Object.assign(f, beside(f.tree));
}

test("a reseal that fails in a session reads no verdict and sends nothing, and the next session opens on a whole tree", (t) => {
  const f = sealedSession(t);
  const config = outsideConfig(f, sealConfig(`node seal.cjs ${VALUE} --fail`, { extra: sessionBlock() }));
  const result = sessionBatch(f, [
    { criterion: "AC1", file: VALUE, line: 1, find: "1", replace: "2", test: wrapped("node check.cjs any") },
    { criterion: "AC2", file: "src/plain.txt", line: 1, find: "x", replace: "y", test: wrapped("node check.cjs strict") },
  ], { config, json: true });
  assert.equal(result.code, 0, result.out + result.err);
  const rows = result.payload.entries;
  assert.deepEqual([rows[0].caught, rows[0].why], [null, "reseal failed (exit 3)"]);
  // A copy that still held the first mutant, or the seal its reseal wrote, fails the strict check.
  assert.equal(rows[1].caught, false);
  assert.deepEqual(calls(f, "send").map((send) => send.file), ["src/plain.txt", "src/plain.txt"]);
  assert.equal(calls(f, "run").length, 1);
  assert.equal(calls(f, "open").length, 2);
  assertSealed(f);
});

test("a reseal that ran past reseal_seconds in a session stops the batch, and the session closes", (t) => {
  const f = sealedSession(t);
  const config = outsideConfig(f, sealConfig("sleep 15", { extra: `  reseal_seconds: 0.5\n${sessionBlock()}` }));
  const test = wrapped("node check.cjs any");
  const result = sessionBatch(f, [1, 2].map((n) => ({ criterion: `AC${n}`, file: VALUE, line: 1, find: "1", replace: String(n + 1), test })), { config });
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^the reseal of entry 1 ended on SIGTERM, so the batch stopped$/m);
  assert.match(result.out, /^no verdict: not run \| defs\/value\.txt:1 \| AC2$/m);
  assert.deepEqual([calls(f, "send").length, calls(f, "run").length, calls(f, "close").length], [0, 0, 1]);
  assertSealed(f);
});

// A test that leaves the seal read-only in the tree keeps the seal from going back, as in run-mutate-seal.test.cjs.
const LOCKS = 'chmod a-w "$INFERNO_TREE/defs/seal.lock"';

test("a seal that cannot go back after a session's mutant stops the batch before it is sent back, and the next step closes nothing", (t) => {
  const f = sealedSession(t);
  const config = outsideConfig(f, sealConfig(`node seal.cjs ${VALUE}`, { extra: sessionBlock() }));
  const test = wrapped(`node check.cjs any && ${LOCKS}`);
  const result = sessionBatch(f, [1, 2].map((n) => ({ criterion: `AC${n}`, file: VALUE, line: 1, find: "1", replace: String(n + 1), test })),
    { config, json: true });
  assert.equal(result.code, 2, result.out + result.err);
  assert.equal(result.payload.restored, false);
  assert.equal(result.payload.stopped, "the batch stopped, since a seal could not be put back");
  assert.equal(calls(f, "send").length, 5, "the mutant and its four seal paths went in, and nothing came back");
  assert.deepEqual([calls(f, "run").length, calls(f, "close").length], [1, 1]);
  fs.chmodSync(path.join(f.tree, f.lock.rel), 0o644);
  const next = sessionBatch(f, [{ criterion: "AC1", file: "src/plain.txt", line: 1, find: "x", replace: "y", test: "true" }]);
  assert.equal(next.code, 0, next.out + next.err);
  assert.match(next.out, /^restored defs\/seal\.lock, which a reseal changed, from an interrupted mutate$/m);
  assert.doesNotMatch(next.out, /host session/, "the session closed in the batch is not closed again");
  assert.equal(calls(f, "close").length, 1);
  assertSealed(f);
});

test("a seal that cannot go back before a session opens stops the batch with no session opened", (t) => {
  const f = sealedSession(t);
  const config = outsideConfig(f, sealConfig(`node seal.cjs ${VALUE}`, { extra: sessionBlock() }));
  const result = sessionBatch(f, [
    { criterion: "AC1", file: VALUE, line: 1, find: "1", replace: "2", test: `node check.cjs any && chmod a-w ${f.lock.rel}` },
    { criterion: "AC2", file: "src/plain.txt", line: 1, find: "x", replace: "y", test: wrapped("node check.cjs any") },
  ], { config, json: true });
  assert.equal(result.code, 2, result.out + result.err);
  assert.equal(result.payload.stopped, "the batch stopped, since a seal could not be put back");
  assert.deepEqual(calls(f), []);
  fs.chmodSync(path.join(f.tree, f.lock.rel), 0o644);
});

const LIB = "pub fn alpha() -> usize { ONE + TEN }\npub fn beta() -> usize { 2 }\n";

test("Rust entries keep their shared build with the key set, even when their test goes through the wrapper", (t) => {
  const f = sessionTree(t, { "src/lib.rs": LIB });
  const shared = wrapped(checks("alpha = 1"));
  const result = sessionBatch(f, [
    { criterion: "AC1", file: "src/lib.rs", line: 1, find: "ONE", replace: "TWO", test: wrapped(fakeTest(f, "alpha", "ONE + TEN")) },
    { criterion: "AC2", file: "src/lib.rs", line: 2, find: "2", replace: "8", test: wrapped(fakeTest(f, "beta", "usize")) },
    { criterion: "AC3", file: "src/m.txt", line: 1, find: "1", replace: "7", test: shared },
    { criterion: "AC4", file: "src/m.txt", line: 2, find: "2", replace: "8", test: shared },
  ], { config: outsideConfig(f, CONFIG_SESSION), json: true });
  assert.equal(result.code, 0, result.out + result.err);
  assert.equal(builds(f), 1, "one build for the switched Rust entries");
  assert.equal(result.payload.builds, 1);
  assert.deepEqual(result.payload.entries.map((e) => [e.form, e.caught]), [["switch", true], ["switch", false], ["session", true], ["session", false]]);
  assert.equal(calls(f, "direct").length, 4, "two control runs and two switched runs, each through the wrapper as given");
  assert.equal(calls(f, "open").length, 1);
  assert.equal(git(f.tree, "status", "--porcelain"), "");
});

test("the mutate block config.example.yaml documents parses once it is uncommented, and its session reaches the wrapper's commands only", (t) => {
  const example = fs.readFileSync(path.join(__dirname, "../../../config.example.yaml"), "utf8");
  const block = /^# mutate:.*\n(?:#  .*\n)+/m.exec(example)[0].replace(/^# ?/gm, "");
  const f = sessionTree(t);
  const config = readConfig(f.tree, outsideConfig(f, block));
  assert.equal(config.mutate.sealed.length, 1);
  const hosted = sessionOf(config);
  for (const key of ["open", "send", "run", "close"]) assert.equal(typeof hosted[key], "string", key);
  const reached = hosted.match.exec("tools/remote-test.sh . node --test test/a.test.mjs");
  assert.equal(reached && reached.index, 0);
  assert.equal(hosted.match.exec("node --test test/a.test.mjs"), null);
  const host = hostOf(config);
  const command = commandOf(host, f.tree, "node --test test/a.test.mjs");
  assert.equal(hosted.match.exec(command).index, 0, "the session reaches a bare test the wrapper wrapped");
  assert.equal(commandOf(host, f.tree, "tools/remote-test.sh . node --test test/a.test.mjs"), "tools/remote-test.sh . node --test test/a.test.mjs");
  assert.equal(host.checks.length, 1);
  assert.ok(host.checks[0].match.test("npm run check:wire"));
  assert.ok(host.checks[0].finding.test("WIRE MISMATCH: amount"));
});

test("a session block this runner cannot use fails at config load, naming the key and the file, and nothing runs", (t) => {
  const f = sessionTree(t);
  const block = sessionBlock();
  const entries = [{ criterion: "AC1", file: "src/m.txt", line: 1, find: "1", replace: "7", test: wrapped(checks("alpha = 1")) }];
  for (const [body, key] of [
    ["mutate:\n  session: on\n", /mutate\.session in \S+ must be a map of match, open, send, run, close\./],
    [`mutate:\n${block}    wait: node remote.cjs wait\n`, /mutate\.session in \S+ must be a map of match, open, send, run, close only, not wait\./],
    [`mutate:\n${block.replace(/ {4}close: .*\n/, "")}`, /mutate\.session\.close in \S+ must be a non-empty string\./],
    [`mutate:\n${block.replace(/run: .*/, 'run: " "')}`, /mutate\.session\.run in \S+ must be a non-empty string\./],
    [`mutate:\n${sessionBlock({ match: "^(node" })}`, /mutate\.session\.match in \S+ must be a regex \(/],
    ["mutate:\n  sessions: on\n", /mutate in \S+ must be a map holding sealed, reseal_seconds, session, run, wrapped and checks only, not sessions\./],
  ]) {
    const config = outsideConfig(f, body, "bad.yaml");
    const result = sessionBatch(f, entries, { config });
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, /BAD_CONFIG/);
    assert.match(result.err, key);
    assert.ok(result.err.includes(config), result.err);
  }
  assert.deepEqual(calls(f), [], "a refused config runs nothing");
});

// The record step of an item review runs the reviewer's proposals through this batch with the
// config the review was given, so a host's session reaches it, and the rows read as without one.
const PROPOSALS = itemReview(["1:1:a = 1:a = 7", "2:2:a2 = 2:a2 = 8"].map((spec) => {
  const [criterion, line, find, replace] = spec.split(":");
  return `  - criterion: ${criterion}\n    says: ${A_ONE[criterion - 1]}\n    file: src/a.ts\n    line: ${line}\n    find: "${find}"\n    replace: "${replace}"\n` +
    "    test: node remote.cjs direct node checks/has.cjs checks/one.expect\n";
}).join("").replace(/^/, "mutants:\n"));

for (const selected of [true, false]) {
  test(`the record step of an item review runs its mutants ${selected ? "in the session its selected --config names" : "as before without one"}, with the same rows`, () => {
    const fixture = mutantRepo({ files: { "remote.cjs": REMOTE } });
    const wrapper = beside(fixture.root);
    write(fixture.root, REVIEW, PROPOSALS);
    const file = path.join(path.dirname(fixture.root), "session.yaml");
    write(path.dirname(fixture.root), "session.yaml", `${CONFIG}${CONFIG_SESSION}`);
    const result = record(fixture, selected ? ["--config", file] : []);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.out, /mutants: 2 ran, 1 caught, 1 survived/);
    const recorded = parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true });
    assert.deepEqual(recorded.mutants.map((m) => [m.criterion, m.caught]), [["1", "yes"], ["2", "no"]]);
    assert.equal(calls(wrapper, "open").length, selected ? 1 : 0);
    assert.equal(calls(wrapper, "run").length, selected ? 2 : 0);
    assert.equal(calls(wrapper, "direct").length, selected ? 0 : 2);
    assert.equal(git(fixture.root, "status", "--porcelain"), "");
  });
}
