const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { CONFIG, closed, git, repo, run, write } = require("./run-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

// A lane red accepted as intermittent reaches the base as one `exception:` line in the ship
// commit, written by ship. Those lines are the ledger a later intent reads.

const TEST = 'checkout/gift-card.test.mjs "redeems a card twice"';

/**
 * A repo whose main carries a smoke lane that writes a verdicts file proving TEST intermittent and
 * exits 10, at `verdicts` as the config names it: relative to the tree, in a folder git ignores, or
 * absolute when null names one outside the tree.
 */
function laned(verdicts = null) {
  const fixture = repo();
  const next = path.join(fixture.dir, "verdicts-next.json");
  const named = verdicts || path.join(fixture.dir, "verdicts.json");
  writeFile(next, `${JSON.stringify({ red: [{ name: TEST, base: "green", again: "green" }] })}\n`);
  write(fixture.root, "lane.cjs", `const fs = require("node:fs");\nconst to = ${JSON.stringify(named)};\n` +
    `fs.mkdirSync(require("node:path").dirname(to), { recursive: true });\nfs.copyFileSync(${JSON.stringify(next)}, to);\nprocess.exit(10);\n`);
  write(fixture.root, ".gitignore", "node_modules/\n.lane/\n");
  const lane = `  smoke:\n    command: node lane.cjs\n    scope: ["src/**"]\n    verdicts: ${named}\n`;
  write(fixture.root, ".specs-inferno/config.yaml", CONFIG.replace("verification:\n", `verification:\n${lane}`));
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "smoke lane"]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  return fixture;
}

/** Close alpha, gate it, and accept its smoke lane's intermittent red; returns the worktree and branch. */
function accepted(fixture) {
  const made = closed(fixture);
  assert.equal(run(fixture, ["gate", "--detach", "--tree", made.tree]).code, 0);
  const owed = run(fixture, ["gate", "--wait", "--tree", made.tree, "--minutes", "0.5"]);
  assert.equal(owed.code, 3, owed.out + owed.err);
  const done = run(fixture, ["smoke", "--accept-intermittent", "--test", TEST, "--reason", "a race under load", "--by", "lead", "--tree", made.tree]);
  assert.equal(done.code, 0, done.out + done.err);
  assert.equal(run(fixture, ["gate", "--wait", "--tree", made.tree, "--minutes", "0.5"]).code, 0);
  return made;
}

/** An empty commit on the primary's main, pushed, whose message carries `body`; returns its short sha. */
function landed(fixture, body) {
  git(fixture.root, ["commit", "-q", "--allow-empty", "-m", "another landing", "-m", body]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  return git(fixture.root, ["rev-parse", "--short", "HEAD"]).trim();
}

const message = (fixture) => git(fixture.root, ["log", "-1", "--format=%B", "main"]);
const exceptionLines = (fixture) => message(fixture).split("\n").filter((line) => line.startsWith("exception:"));
/** Every path in a text that starts with a slash: a path of the machine that ran the lane. */
const absolute = (text) => text.match(/(?:^|[\s"'])\/[^\s"']*/gm) || [];

test("ship writes the intermittent accept into the ship commit as one exception line that names no path of the machine", () => {
  const fixture = laned(".lane/verdicts.json");
  const { tree, branch } = accepted(fixture);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.equal(git(fixture.root, ["log", "-1", "--pretty=%s", "main"]).trim(), `Merge branch '${branch}'`);
  const lines = exceptionLines(fixture);
  assert.equal(lines.length, 1, lines.join("\n"));
  const [, json] = /^exception: smoke intermittent (\{.*\})$/.exec(lines[0]);
  const record = JSON.parse(json);
  assert.deepEqual(record.tests, [TEST]);
  assert.equal(record.reason, "a race under load");
  assert.equal(record.by, "lead");
  assert.match(record.log, /^lane-smoke-\S+\.log$/);
  assert.equal(record.verdicts, ".lane/verdicts.json");
  assert.equal(typeof record.run, "string");
  assert.deepEqual(absolute(message(fixture)), []);
  assert.equal(fs.existsSync(tree), false);
  // The line ship wrote is the one a later accept reads back from the base.
  const { repeats } = require("./run-lanes-intermittent.cjs");
  const sha = git(fixture.root, ["rev-parse", "--short", "main"]).trim();
  assert.deepEqual(repeats(fixture.root, "main", [TEST]).map((line) => line.replace(/ \d{4}-\d\d-\d\d /, " <date> ")),
    [`earlier intermittent accept of ${TEST}: ${sha} <date> by lead: a race under load`]);
});

test("ship refuses a third accept of a test until a commit on the base names its fix", () => {
  const fixture = laned();
  const { tree } = accepted(fixture);
  const exception = (by) => `exception: smoke intermittent ${JSON.stringify({ tests: [TEST], reason: "an earlier race", by, run: "earlier", log: "lane.log" })}`;
  const first = landed(fixture, exception("lead"));
  const second = landed(fixture, exception("release-lead"));
  const tip = git(fixture.root, ["rev-parse", "main"]).trim();
  const refused = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /INTERMITTENT_LIMIT/);
  assert.match(refused.err, new RegExp(`2 times on main since a commit there last named its fix: ${first} .* by lead, ${second} .* by release-lead`));
  assert.ok(refused.err.includes(`"Fixes-intermittent: ${TEST}"`), refused.err);
  assert.equal(git(fixture.root, ["rev-parse", "main"]).trim(), tip);
  assert.equal(fs.existsSync(tree), true);

  landed(fixture, `Fixes-intermittent: ${TEST}`);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.equal(exceptionLines(fixture).length, 1);
  // A verdicts file the config names by an absolute path reaches the commit by its file name alone.
  assert.equal(JSON.parse(/\{.*\}$/.exec(exceptionLines(fixture)[0])[0]).verdicts, "verdicts.json");
  assert.deepEqual(absolute(message(fixture)), []);
});
