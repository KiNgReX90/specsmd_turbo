const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { fixture, item, run } = require("./run-frontier-fixture.cjs");
const { probes } = require("./run-probes.cjs");
const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");

// A probe is a measurement, so what it printed decides it, not how it exited. `grep -c X file`
// prints 0 and exits 1 when nothing matches: a plan that says `shows: "0"` was reported as drift
// and the orchestrator read the drift by hand to tell it from a moved tree. A command that never
// answered still never reads as planned: it printed nothing, ran out of time (124), could not
// start (125 to 127), ended fatally or by a signal (128 and up). What it printed is both streams,
// as the log records them, so an error line on either one is output that differs from the plan.

const intent = (id, kind, items) => `  - id: ${id}
    title: "${id}"
    status: pending
    base_branch: main
    depends_on_intents: []
    work_items:
${items
  .map(
    (entry) => `      - id: ${entry}
        title: "${entry}"
        kind: ${kind}
        complexity: low
        status: pending
        depends_on: []`
  )
  .join("\n")}`;

const STATE = `project:
  name: demo
intents:
${intent("count", "behavior", ["c-zero", "c-plain", "c-ended", "c-silent", "c-moved", "c-long"])}
${intent("diag", "ui", ["d-count", "d-killed"])}
${intent("wrap", "ui", ["w-wrapped"])}
`;

const ENDED = [124, 125, 126, 127, 128, 137];
const LONG = "0".repeat(300);
const CLIPPED = `${"0".repeat(120)}...`;
const COUNT = "grep -c absent src/board/tile.css";
const BUILD = "echo build ${WRAPPED:-bare}";

const probe = (id, probes) => item({ id, intent: "count", editable: ["src/board/tile.css"], probes });
const corrective = (id, editable, diagnosis, extra = {}) =>
  item({
    id,
    intent: "diag",
    kind: "ui",
    description: "The board is broken at 960px because the shelf foot is too tall.",
    editable: [editable],
    diagnosis: { claim: "the shelf foot adds 104 px", ...diagnosis },
    ...extra,
  });

const ITEMS = {
  "count/c-zero": probe("c-zero", [
    { run: COUNT, shows: "0" },
    { run: "test -f src/board/tile.ts", shows: "" },
  ]),
  "count/c-plain": probe("c-plain", [
    { run: "echo src/board/tile.css | xargs grep -c absent", shows: "0" },
    { run: "echo 0; exit 2", shows: "0" },
    { run: "echo 0; exit 123", shows: "0" },
    { run: "printf %0300d 0; exit 1", shows: LONG },
  ]),
  "count/c-ended": probe(
    "c-ended",
    ENDED.map((code) => ({ run: `echo 0; exit ${code}`, shows: "0" }))
  ),
  "count/c-silent": probe("c-silent", [{ run: "grep -n absent src/board/tile.css", shows: "" }]),
  "count/c-moved": probe("c-moved", [
    { run: "grep -c radius src/board/tile.css", shows: "9" },
    { run: "echo 7; echo no such file >&2; exit 1", shows: "8" },
    { run: "echo 0; echo no such file >&2; exit 2", shows: "0" },
    { run: "echo 0; echo no such file; exit 1", shows: "0" },
    { run: "echo 0; echo no such file >&2", shows: "0" },
  ]),
  "count/c-long": probe("c-long", [
    { run: "printf %0300d 0", shows: "1" },
    { run: "printf %0300d 0; exit 1", shows: "1" },
  ]),
  "diag/d-count": corrective("d-count", "src/board/tile.css", { probe: COUNT, shows: "0" }),
  "diag/d-killed": corrective("d-killed", "src/board/tile.ts", { probe: "echo 9; kill -9 $$", shows: "9" }),
  "wrap/w-wrapped": corrective(
    "w-wrapped",
    "src/board/tile.css",
    { probe: BUILD, shows: "build wrapped" },
    { intent: "wrap", probes: [{ run: BUILD, shows: "build bare" }] }
  ),
};

const tree = () => fixture({ state: STATE, items: ITEMS });
const lines = (out) => out.split("\n").filter(Boolean);
const json = (fixtureTree, id) => JSON.parse(run(fixtureTree, ["probes", id, "--json"]).out);

test("a count probe that prints what it shows and exits 1 is no drift", () => {
  const fixtureTree = tree();
  const result = run(fixtureTree, ["probes", "c-zero"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(lines(result.out), [`probe ok c-zero ${COUNT}`, "probe ok c-zero test -f src/board/tile.ts"]);
  const payload = json(fixtureTree, "c-zero");
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.probes, [
    { run: COUNT, shows: "0", got: "0", ok: true },
    { run: "test -f src/board/tile.ts", shows: "", got: "", ok: true },
  ]);
});

test("a plain non-zero exit up to 123 counts when the output is what the plan shows", () => {
  const fixtureTree = tree();
  const result = run(fixtureTree, ["probes", "c-plain"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(lines(result.out), [
    "probe ok c-plain echo src/board/tile.css | xargs grep -c absent",
    "probe ok c-plain echo 0; exit 2",
    "probe ok c-plain echo 0; exit 123",
    "probe ok c-plain printf %0300d 0; exit 1",
  ]);
  assert.equal(json(fixtureTree, "c-plain").probes[3].got, CLIPPED);
});

test("a command that timed out, never started, ended fatally or by a signal is drift though it printed the plan", () => {
  const fixtureTree = tree();
  const result = run(fixtureTree, ["probes", "c-ended"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.deepEqual(
    lines(result.out),
    ENDED.map((code) => `drift c-ended echo 0; exit ${code} expected 0 got exit ${code}, printed 0`)
  );
  const payload = json(fixtureTree, "c-ended");
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.probes[0], { run: "echo 0; exit 124", shows: "0", got: "exit 124, printed 0", ok: false });
});

test("a failed command that printed nothing is drift, even against a plan that shows nothing", () => {
  const fixtureTree = tree();
  const result = run(fixtureTree, ["probes", "c-silent"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.deepEqual(lines(result.out), [
    "drift c-silent grep -n absent src/board/tile.css expected  got exit 1, printed nothing",
  ]);
  assert.equal(json(fixtureTree, "c-silent").probes[0].got, "exit 1, printed nothing");
});

test("the drift line names the exit beside what a failed command printed, and keeps its shape for a plain drift", () => {
  const fixtureTree = tree();
  const result = run(fixtureTree, ["probes", "c-moved"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.deepEqual(result.out.trim().split("\n"), [
    "drift c-moved grep -c radius src/board/tile.css expected 9 got 2",
    "drift c-moved echo 7; echo no such file >&2; exit 1 expected 8 got exit 1, printed 7",
    "no such file",
    "drift c-moved echo 0; echo no such file >&2; exit 2 expected 0 got exit 2, printed 0",
    "no such file",
    "drift c-moved echo 0; echo no such file; exit 1 expected 0 got exit 1, printed 0",
    "no such file",
    "drift c-moved echo 0; echo no such file >&2 expected 0 got 0",
    "no such file",
  ]);
  assert.deepEqual(
    json(fixtureTree, "c-moved").probes.map((entry) => entry.got),
    ["2", "exit 1, printed 7\nno such file", "exit 2, printed 0\nno such file", "exit 1, printed 0\nno such file", "0\nno such file"]
  );
});

test("what a probe printed is clipped, whether it exited 0 or failed", () => {
  const fixtureTree = tree();
  const result = run(fixtureTree, ["probes", "c-long"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.deepEqual(lines(result.out), [
    `drift c-long printf %0300d 0 expected 1 got ${CLIPPED}`,
    `drift c-long printf %0300d 0; exit 1 expected 1 got exit 1, printed ${CLIPPED}`,
  ]);
});

test("a diagnosis whose count prints what it shows and exits 1 holds, in probes and in the frontier", () => {
  const fixtureTree = tree();
  const probes = run(fixtureTree, ["probes", "d-count"]);
  assert.equal(probes.code, 0, probes.out + probes.err);
  assert.deepEqual(lines(probes.out), [`diagnosis ok d-count ${COUNT}`]);
  assert.deepEqual(json(fixtureTree, "d-count").diagnosis, { command: COUNT, shows: "0", got: "0", ok: true });
  const frontier = run(fixtureTree, ["frontier", "diag"]);
  assert.equal(frontier.code, 0, frontier.out + frontier.err);
  assert.match(frontier.out, /^ready d-count /m);
});

test("a diagnosis killed by a signal is drift though it printed what it shows, and the line names the signal", () => {
  const fixtureTree = tree();
  const probes = run(fixtureTree, ["probes", "d-killed"]);
  assert.equal(probes.code, 2, probes.out + probes.err);
  assert.deepEqual(lines(probes.out), ["drift d-killed diagnosis echo 9; kill -9 $$ expected 9 got signal SIGKILL, printed 9"]);
  assert.deepEqual(json(fixtureTree, "d-killed").diagnosis, {
    command: "echo 9; kill -9 $$",
    shows: "9",
    got: "signal SIGKILL, printed 9",
    ok: false,
  });
  const frontier = run(fixtureTree, ["frontier", "diag"]);
  const invalid = lines(frontier.out).filter((line) => line.startsWith("INVALID"));
  assert.deepEqual(invalid, [
    "INVALID d-killed: diagnosis probe echo 9; kill -9 $$ expected 9 got signal SIGKILL, printed 9. " +
      "Measure the cause again on this tree and plan the fix at what it shows.",
  ]);
  assert.doesNotMatch(frontier.out, /^ready d-killed /m);
});

test("a diagnosis goes bare through the build wrapper, while a probe keeps its own cap and never queues", (t) => {
  const fixtureTree = tree();
  const bin = tempDir("inferno-probe-wrapper-");
  const wrapper = path.join(bin, "claude-build");
  writeFile(wrapper, '#!/bin/sh\n[ "$1" = "--" ] && shift\nWRAPPED=wrapped exec "$@"\n');
  fs.chmodSync(wrapper, 0o755);
  const original = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${original}`;
  t.after(() => {
    process.env.PATH = original;
  });
  const result = probes("w-wrapped", { tree: fixtureTree.root });
  assert.deepEqual(result.out, [`probe ok w-wrapped ${BUILD}`, `diagnosis ok w-wrapped ${BUILD}`]);
  assert.equal(result.exit, 0);
});
