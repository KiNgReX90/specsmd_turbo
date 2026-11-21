const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { git, repo, run, write } = require("./review-fixture.cjs");

// A reviewer that folds a finding's text with `>-` writes plain YAML. The review step used to
// refuse that file as BAD_REVIEW and send it back for one more round, naming a body line.

const REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const review = (fixture) => run(fixture, ["review", "--item", "a-one", "--tree", fixture.root, "--reviewer", "rev-1"]);

const FOLDED = `item: a-one
verdict: fix
files:
  - src/a.ts
findings:
  - criterion: AC1 the value reads two
    file: src/a.ts
    line: 1
    evidence: >-
      read src/a.ts, it exports 1
      where the criterion asks for 2
    fix: >-
      export 2
    severity: major
`;

test("an item review whose finding is folded with >- is recorded, its text on one line", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, FOLDED);

  const result = review(fixture);

  assert.equal(result.code, 2, result.out + result.err);
  assert.doesNotMatch(result.err, /BAD_REVIEW/);
  assert.match(result.out, /FINDING AC1 the value reads two src\/a\.ts:1: read src\/a\.ts, it exports 1 where the criterion asks for 2\. fix: export 2/);
  assert.match(fs.readFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), "utf8"), /review: fix/);
  const recorded = fs.readFileSync(path.join(fixture.root, REVIEW), "utf8");
  assert.ok(recorded.startsWith(FOLDED), "the reviewer's text stays as written");
  assert.match(recorded, /^reviewer: rev-1$/m);
  assert.equal(git(fixture.root, ["status", "--porcelain"]), "", "the review and the ledger are committed");
});

test("an item review with a header YAML does not allow is sent back, naming the marker's line", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, FOLDED.replace("evidence: >-", "evidence: >0"));

  const result = review(fixture);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /ERROR \[BAD_REVIEW\].*cannot parse line 9: .*header >0 /);
  assert.doesNotMatch(fs.readFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), "utf8"), /review:/);
});
