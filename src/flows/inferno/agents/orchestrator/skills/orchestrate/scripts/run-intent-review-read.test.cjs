const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, INTENT_TREE, git, repo, run, worktree, write } = require("./review-fixture.cjs");
const { CHECK, proposal } = require("./run-review-mutants-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

// The intent review's record binds the tree its reviewer was dispatched on: it stamps that
// dispatch's commit and refuses a tree that moved since. A dispatch printed again before the record
// keeps the first print since the last record, so a commit that landed between the two prints is
// never recorded as read; the refusal drops the dispatch, so the fresh one reads it and the gate
// waits for its record. A commit that changes only the ledger, outside its standards, moves nothing
// the record binds. A delta's dispatch asks the reviewer to name the range it read, so a verdict
// that still holds is written anew, and the record holds the line to the ranges printed.

const REVIEW = ".specs-inferno/intents/alpha/review.yaml";
const head = (tree) => git(tree, ["rev-parse", "HEAD"]);
const read = (tree, rel) => fs.readFileSync(path.join(tree, rel), "utf8");
const shown = (result) => result.out + result.err;
const intentReview = (fixture, tree, args = []) => run(fixture, ["review", "--tree", tree, ...args]);
const record = (fixture, tree) => intentReview(fixture, tree, ["--reviewer", "rev-1"]);
const rangeOf = (out) => /^ {2}range (\S+)$/m.exec(out)[1];
const readLine = (out) => (/^ {2}read .*$/m.exec(out) || [undefined])[0];
const commitOnly = (tree, rel, body, message) => {
  write(tree, rel, body);
  git(tree, ["add", "--", rel]);
  git(tree, ["commit", "-qm", message, "--", rel]);
  return head(tree);
};

/** An intent with its work committed and an empty scan collected, on a host whose gate has a command to run. */
function started() {
  const fixture = repo({ config: CONFIG.replace("delivery:", "  finalize:\n    - echo gated\ndelivery:") });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  write(tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the work"]);
  return { fixture, tree };
}

test("an intent dispatch printed again over a later commit keeps the first print, so the record refuses the commit its reviewer may not have read", () => {
  const { fixture, tree } = started();
  assert.equal(intentReview(fixture, tree).code, 3);
  const first = head(tree);
  const later = commitOnly(tree, "src/a.ts", "export const a = 5;\n", "landed after the dispatch");
  const again = intentReview(fixture, tree);
  assert.equal(again.code, 3, shown(again));
  write(tree, REVIEW, "verdict: clean\n");

  const refused = record(fixture, tree);

  assert.equal(refused.code, 3, shown(refused));
  assert.match(refused.out, new RegExp(`the code moved since the dispatch at ${first.slice(0, 7)}`));
  assert.equal(head(tree), later, "nothing recorded");
  fs.rmSync(path.join(tree, REVIEW));
  const gated = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gated.code, 3, shown(gated));
  assert.match(gated.out, /intent review owed/);

  // The refusal dropped the dispatch: the fresh one reads the commit, and its record is taken.
  const fresh = intentReview(fixture, tree);
  assert.equal(fresh.code, 3, shown(fresh));
  const [from, to] = rangeOf(fresh.out).split("..");
  assert.ok(git(tree, ["rev-list", `${from}..${to}`]).split("\n").includes(later), "the fresh range holds the later commit");
  write(tree, REVIEW, "verdict: clean\n");
  const recorded = record(fixture, tree);
  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(read(tree, REVIEW), new RegExp(`^commit: ${later}$`, "m"));
});

test("a commit between two prints that changes only the ledger moves nothing the record binds, and the record stamps the first print", () => {
  const { fixture, tree } = started();
  const firstRange = rangeOf(intentReview(fixture, tree).out);
  const first = head(tree);
  commitOnly(tree, ".specs-inferno/intents/alpha/notes.md", "the orchestrator's notes\n", "a ledger file only");
  const again = intentReview(fixture, tree);
  assert.notEqual(rangeOf(again.out), firstRange, "the second print ends at the newer commit");
  // The reviewer of the first print names the range it read, which is kept beside the second.
  write(tree, REVIEW, `verdict: clean\nread: ${firstRange}\n`);

  const recorded = record(fixture, tree);

  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(read(tree, REVIEW), new RegExp(`^commit: ${first}$`, "m"));
});

/** A clean intent review on record, a later change to the code, and the delta dispatched. */
function delta() {
  const { fixture, tree } = started();
  const first = intentReview(fixture, tree);
  write(tree, REVIEW, "verdict: clean\n");
  assert.equal(record(fixture, tree).code, 0);
  commitOnly(tree, "src/a.ts", "export const a = 4;\n", "a later change");
  const owed = intentReview(fixture, tree);
  assert.equal(owed.code, 3, shown(owed));
  return { fixture, tree, out: owed.out, range: rangeOf(owed.out), firstRange: rangeOf(first.out) };
}

test("a delta intent review whose verdict holds is recorded once it names the range it read; untouched, it is owed again", () => {
  const { fixture, tree, out, range } = delta();
  assert.equal(readLine(out), `  read ${range}: write read: ${range} into the file, also when the earlier verdict still holds`);
  // Untouched: nothing is pending, so the review is owed again, as before.
  const untouched = intentReview(fixture, tree);
  assert.equal(untouched.code, 3, shown(untouched));
  assert.match(untouched.out, /^intent review owed for alpha: /m);
  write(tree, REVIEW, `${read(tree, REVIEW)}read: ${range}\n`);

  const recorded = record(fixture, tree);

  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(read(tree, REVIEW), new RegExp(`^read: ${range}$`, "m"));
  assert.match(intentReview(fixture, tree).out, /^intent review clean for the current tree/m);
});

test("an intent review's read line that names a range its dispatch did not print is refused, naming both", () => {
  const { fixture, tree, range, firstRange } = delta();
  const before = head(tree);
  const recordedAt = read(tree, REVIEW);
  const dots = (text) => text.replace(/[.[\]]/g, "\\$&");
  for (const [line, named] of [[firstRange, firstRange], [`[${range}]`, [range]]]) {
    write(tree, REVIEW, `${recordedAt}read: ${line}\n`);
    const refused = record(fixture, tree);
    assert.equal(refused.code, 2, shown(refused));
    assert.match(refused.err, new RegExp(`BAD_REVIEW.*review\\.yaml: read names ${dots(JSON.stringify(named))}, and its dispatch printed ${dots(range)}: `));
    assert.equal(head(tree), before);
  }
});

test("a dispatch the released flow noted holds no range, so a read line is held to nothing", () => {
  const { fixture, tree, range } = delta();
  const saved = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = fixture.cache;
  const file = require("./run-slot.cjs").reviewDispatchPath(tree);
  process.env.XDG_CACHE_HOME = saved;
  const { intent, head: at, hash } = JSON.parse(fs.readFileSync(file, "utf8"));
  writeFile(file, `${JSON.stringify({ intent, head: at, hash })}\n`);
  write(tree, REVIEW, `${read(tree, REVIEW)}read: zzzzzzz..${range.split("..")[1]}\n`);
  const recorded = record(fixture, tree);
  assert.equal(recorded.code, 0, shown(recorded));
});

test("the runner's rewrite of an intent review with mutants keeps the range its reviewer read", () => {
  const { fixture, tree } = started();
  write(tree, ".specs-inferno/intents/alpha/work-items/a-one.md", "---\nid: a-one\nintent: alpha\nstatus: pending\n---\n\n# Work Item: a-one\n\n" +
    "## Acceptance Criteria\n\n- [ ] a is three\n\n## Execution Manifest\n\ncontext:\n  tests:\n    - path: src/a.test.ts\n      reason: proof\n" +
    "ownership:\n  editable:\n    - src/a.ts\n");
  write(tree, "checks/has.cjs", CHECK);
  write(tree, "checks/a.expect", "src/a.ts a = 3\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a criterion, its test and the check the proposal runs"]);
  const range = rangeOf(intentReview(fixture, tree).out);
  write(tree, REVIEW, `verdict: clean\nmutants:\n${proposal("a-one:1", { find: "a = 3", replace: "a = 4", expect: "checks/a.expect" })}read: ${range}\n`);

  const recorded = record(fixture, tree);

  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(read(tree, REVIEW), /^ {4}caught: yes$/m, "the runner ran the mutant and wrote the file again");
  assert.match(read(tree, REVIEW), new RegExp(`^read: ${range}$`, "m"));
});
