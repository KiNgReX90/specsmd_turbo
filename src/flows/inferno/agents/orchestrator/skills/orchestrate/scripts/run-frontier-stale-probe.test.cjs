const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { fixture, run } = require("./run-frontier-fixture.cjs");

// A diagnosis probe measures the tree an item is about to be built on. Once the item is built,
// in its review loop, the probe measured the tree before its own fix and is stale by design. On
// 2026-11-10 three such probes stopped the whole frontier with exit 2, and the two items that
// were truly ready never appeared. Only an item nobody dispatched or reviewed is replayed now,
// and a stale one is reported against itself while the rest of the ready set still prints.

function dispatchLog(tree, intent, item) {
  const result = run(tree, ["dispatch-log", intent, "--item", item, "--tier", "strong", "--agent", "builder"]);
  assert.equal(result.code, 0, result.out + result.err);
}

const lines = (out) => out.split("\n").filter(Boolean);

test("a built item's stale probe no longer hides the fresh ready item", () => {
  const tree = fixture();
  dispatchLog(tree, "kappa", "k-built");
  const result = run(tree, ["frontier", "kappa"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^ready k-fresh /m);
  assert.match(result.out, /^ready k-built /m);
  assert.match(result.out, /^ready k-reviewed /m);
  assert.doesNotMatch(result.out, /INVALID/);
});

test("an item with a review is not replayed either", () => {
  const tree = fixture();
  dispatchLog(tree, "kappa", "k-built");
  const payload = JSON.parse(run(tree, ["frontier", "kappa", "--json"]).out);
  assert.deepEqual(payload.ready.map((item) => item.id).sort(), ["k-built", "k-fresh", "k-reviewed"]);
  assert.deepEqual(payload.invalid, []);
});

test("a written review file counts as a review before it is recorded", () => {
  const tree = fixture();
  const file = path.join(tree.root, ".specs-inferno/intents/kappa/reviews/k-built.yaml");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "verdict: fix\n", "utf8");
  const result = run(tree, ["frontier", "kappa"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^ready k-built /m);
  assert.doesNotMatch(result.out, /INVALID/);
});

test("a never dispatched item with a stale probe is still caught, beside the ready set", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "kappa"]);
  assert.equal(result.code, 0, result.out + result.err);
  const printed = lines(result.out);
  assert.ok(printed.some((line) => /^INVALID k-built: diagnosis probe .* expected 9 got 2/.test(line)), result.out);
  assert.ok(!printed.some((line) => line.startsWith("ready k-built ")), "the stale item is left out of the ready set");
  assert.ok(printed.some((line) => line.startsWith("ready k-fresh ")), result.out);
  assert.ok(printed.some((line) => line.startsWith("ready k-reviewed ")), result.out);
  const payload = JSON.parse(run(tree, ["frontier", "kappa", "--json"]).out);
  assert.deepEqual(payload.ready.map((item) => item.id).sort(), ["k-fresh", "k-reviewed"]);
  assert.ok(!payload.dispatch.includes("k-built"));
  assert.equal(payload.invalid.length, 1);
  assert.match(payload.invalid[0], /^k-built: diagnosis probe/);
});

test("when the stale items are all that could start, frontier still stops with exit 2", () => {
  const tree = fixture();
  const result = run(tree, ["frontier", "lambda"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.deepEqual(lines(result.out).map((line) => line.split(":")[0]), ["INVALID l-new"]);
});
