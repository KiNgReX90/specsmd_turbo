const assert = require("node:assert/strict");
const test = require("node:test");
const { CONFIG, closed, git, repo, run, write } = require("./run-fixture.cjs");
const { intentReviewed } = require("./review-fixture.cjs");
const lib = require("./run-lib.cjs");

// A harness fix inside the smoke lane's own scope lands on the base after the lane ended
// instrument red. The accept made before ship holds through the fold ship makes, and ship merges.

/**
 * A repo whose main carries a smoke lane that ends instrument red, finalize commands the harness
 * lies outside of, and an intent review that a base change to the harness leaves standing.
 */
function laned() {
  const fixture = repo();
  write(fixture.root, "lane.cjs", "process.exit(11);\n");
  const lane = '  smoke:\n    command: node lane.cjs\n    scope: ["src/**"]\n';
  const scoped = `review:\n  outside: ["src/harness/**"]\n${CONFIG.replace("verification:\n", `verification:\n${lane}`)}`
    .replace('"echo scoped": ["docs/**"]', '"echo scoped": ["docs/**"]\n    "echo always": ["src/a.ts"]');
  write(fixture.root, ".specs-inferno/config.yaml", scoped);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "smoke lane"]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  return fixture;
}

test("ship folds a harness fix inside the lane scope, holds the accept made before the fold, and merges", () => {
  const fixture = laned();
  const { tree, branch } = closed(fixture);
  assert.equal(run(fixture, ["gate", "--detach", "--tree", tree]).code, 0);
  const red = run(fixture, ["gate", "--wait", "--tree", tree, "--minutes", "0.5"]);
  assert.equal(red.code, 3, red.out + red.err);
  write(fixture.root, "src/harness/walk.cjs", "// the walk, fixed\n");
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "harness fix"]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  const fix = git(fixture.root, ["rev-parse", "HEAD"]).trim();
  const accepted = run(fixture, ["smoke", "--accept", "--harness-fix", fix, "--tree", tree]);
  assert.equal(accepted.code, 0, accepted.out + accepted.err);
  intentReviewed(tree, "alpha", "verdict: clean\n", lib.readConfig(tree));
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.match(shipped.out, new RegExp(`^ACCEPTED smoke instrument red, harness fix ${fix.slice(0, 7)}$`, "m"));
  assert.match(git(fixture.root, ["log", "-1", "--pretty=%s"]), new RegExp(`Merge branch '${branch}'`));
});
