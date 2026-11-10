const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, STATE, git, repo, reviewed, run, write } = require("./review-fixture.cjs");

// The ledger commit takes the files the completion wrote and nothing beside them: a review
// another reviewer writes while integrate runs stays that reviewer's to record.

const SIBLINGS = STATE.replace("        depends_on: [a-one]", "        depends_on: []");
const REVIEW = ".specs-inferno/intents/alpha/reviews/a-two.yaml";
const HALT = ".specs-inferno/halt-notes/other.md";

/** A fixture whose integrate command runs `body` in the tree, standing in for work written beside it. */
function landing(body) {
  const fixture = repo({ state: SIBLINGS });
  const script = path.join(fixture.cache, "beside.cjs");
  fs.mkdirSync(fixture.cache, { recursive: true });
  fs.writeFileSync(script, `const fs = require("fs"), cp = require("child_process");\n${body}\n`);
  fixture.config = CONFIG.replace("echo integrate ran", `node ${script}`);
  write(fixture.root, ".specs-inferno/config.yaml", fixture.config);
  git(fixture.root, ["commit", "-qam", "the config runs a command beside integrate"]);
  write(fixture.root, "src/a.ts", "export const a = 4;\n");
  git(fixture.root, ["commit", "-qam", "a-one landed"]);
  reviewed(run, fixture, fixture.root, ["a-one"]);
  return fixture;
}

const WRITES_REVIEW = `fs.mkdirSync(${JSON.stringify(path.dirname(REVIEW))}, { recursive: true });
fs.writeFileSync(${JSON.stringify(REVIEW)}, "item: a-two\\nverdict: clean\\nfiles: [src/b.ts]\\n");`;
const STAGES_NOTE = `fs.mkdirSync(${JSON.stringify(path.dirname(HALT))}, { recursive: true });
fs.writeFileSync(${JSON.stringify(HALT)}, "halted\\n");
cp.execFileSync("git", ["add", ${JSON.stringify(HALT)}]);`;

const integrate = (fixture) => run(fixture, ["integrate", "--tree", fixture.root, "--item", "a-one"]);
const committed = (fixture) => git(fixture.root, ["show", "--name-only", "--format=", "HEAD"]).split("\n").sort();

test("a review file written while integrate runs stays out of the ledger commit", () => {
  const fixture = landing(WRITES_REVIEW);

  const result = integrate(fixture);

  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(committed(fixture), [".specs-inferno/intents/alpha/work-items/a-one.md", ".specs-inferno/state.yaml"]);
  assert.match(git(fixture.root, ["status", "--porcelain"]), /reviews\/a-two\.yaml/);
});

test("its review step then records it", () => {
  const fixture = landing(WRITES_REVIEW);
  assert.equal(integrate(fixture).code, 0);

  const result = run(fixture, ["review", "--item", "a-two", "--tree", fixture.root, "--reviewer", "rev-2"]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /review a-two clean, recorded/);
  const text = fs.readFileSync(path.join(fixture.root, REVIEW), "utf8").trimEnd().split("\n");
  assert.match(text[text.length - 3], /^tree: /);
  assert.match(text[text.length - 2], /^commit: /);
  assert.equal(text[text.length - 1], "reviewer: rev-2");
});

test("a file staged beside an integrate is not swept into the ledger commit", () => {
  const fixture = landing(STAGES_NOTE);

  const result = integrate(fixture);

  assert.equal(result.code, 0, result.out + result.err);
  assert.ok(git(fixture.root, ["diff", "--cached", "--name-only"]).split("\n").includes(HALT));
  assert.ok(!committed(fixture).includes(HALT));
});
