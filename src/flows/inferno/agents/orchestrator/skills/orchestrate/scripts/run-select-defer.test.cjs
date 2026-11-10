const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { git, repo, run } = require("./run-fixture.cjs");

// select offers intents, never items: a deferred item is counted apart, because it waits for a
// later plan and nothing in this one builds it.

const WRITER = path.join(__dirname, "state-transition.cjs");

test("select counts a deferred item apart from the items still to build", () => {
  const fixture = repo();
  assert.match(run(fixture, ["select"]).out, /^ {2}alpha {2}Alpha {2}2 items: 1 low, 1 medium$/m);
  const deferred = spawnSync(process.execPath, [WRITER, "defer-item", "--intent", "alpha", "--item", "a-two", "--reason", "waits for the first update"], {
    cwd: fixture.root, encoding: "utf8", env: { ...process.env, XDG_CACHE_HOME: fixture.cache },
  });
  assert.equal(deferred.status, 0, deferred.stdout + deferred.stderr);
  git(fixture.root, ["commit", "-qam", "defer"]);
  assert.match(run(fixture, ["select"]).out, /^ {2}alpha {2}Alpha {2}1 items: 1 low; 1 deferred$/m);
});
