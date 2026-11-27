const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { STATE, git, repo, run } = require("./run-fixture.cjs");

// frontier prints a deferred item as such and never offers it: it is out of this intent, so it
// is neither ready nor waiting, and its stale contract is no error.

const WRITER = path.join(__dirname, "state-transition.cjs");

function deferred(fixture, item = "a-two") {
  const result = spawnSync(process.execPath, [WRITER, "defer-item", "--intent", "alpha", "--item", item, "--reason", "waits for the first update"], {
    cwd: fixture.root, encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: fixture.cache },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  git(fixture.root, ["commit", "-qam", "defer"]);
  return fixture;
}

test("frontier prints a deferred item with its reason and never offers it", () => {
  const fixture = deferred(repo());
  const result = run(fixture, ["frontier", "alpha"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^ready a-one /m);
  assert.match(result.out, /^deferred a-two: waits for the first update$/m);
  assert.doesNotMatch(result.out, /^(?:ready|waiting) a-two/m);
  const payload = JSON.parse(run(fixture, ["frontier", "alpha", "--json"]).out);
  assert.deepEqual(payload.deferred, [{ id: "a-two", reason: "waits for the first update" }]);
  assert.deepEqual(payload.ready.map((item) => item.id), ["a-one"]);
  assert.deepEqual(payload.waiting, []);
});

test("a deferred item's contract is never validated", () => {
  // a-two's spec names a context path nobody created: an open item would stop the frontier.
  const fixture = repo({
    items: {
      ...require("./run-fixture.cjs").ITEMS,
      "alpha/a-two": require("./run-fixture.cjs").item({ id: "a-two", intent: "alpha", depends_on: ["a-one"], required: ["src/gone.ts"], editable: ["src/b.ts"] }),
    },
  });
  assert.equal(run(fixture, ["frontier", "alpha"]).code, 2);
  deferred(fixture);
  const result = run(fixture, ["frontier", "alpha"]);
  assert.equal(result.code, 0, result.out + result.err);
});

test("frontier says no item is left when only deferred items are not completed, and still names them", () => {
  const state = STATE.replace(
    "        complexity: low\n        status: pending\n        depends_on: []\n      - id: a-two",
    "        complexity: low\n        status: completed\n        completed_at: 2026-10-01T00:00:00Z\n        integrated_sha: abc1234\n        review: clean\n        depends_on: []\n      - id: a-two",
  );
  const fixture = deferred(repo({ state }));
  const result = run(fixture, ["frontier", "alpha"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(result.out.trim().split("\n"), ["no item left in this intent", "deferred a-two: waits for the first update"]);
});

test("an open item that still waits on a deferred one says so", () => {
  // The writer refuses to leave a dependent hanging; a ledger edited by hand still can.
  const state = STATE.replace(
    "        complexity: low\n        status: pending\n        depends_on: []\n      - id: a-two",
    "        complexity: low\n        status: deferred\n        depends_on: []\n      - id: a-two",
  );
  const result = run(repo({ state }), ["frontier", "alpha"]);
  assert.match(result.out, /^waiting a-two on a-one \(deferred\)$/m);
  assert.match(result.out, /^deferred a-one: no reason recorded$/m);
});
