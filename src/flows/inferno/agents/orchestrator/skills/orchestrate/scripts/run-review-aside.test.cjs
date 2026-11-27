const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { INTENT_TREE, git, run, worktree, write } = require("./review-fixture.cjs");
const {
  CAUGHT_ONE, INTENT_REVIEW, REVIEW, SURVIVES_TWO, mutantRepo, proposal, read, record, runs, withMutants,
} = require("./run-review-mutants-fixture.cjs");

// The two lists of an intent review whose entries are set aside. `withdrawn` holds a mutant its
// reviewer proposed by mistake: the runner stops running it and writes no finding for it, and it
// never counts for its criterion. `deferred` holds a finding the user put after the release, which
// only the orchestrator's defer-finding writes: the verdict leaves it out, a deferred survivor stops
// running, and each later record carries both lists over.

const WRITER = path.join(__dirname, "state-transition.cjs");
const SCAN = ".specs-inferno/intents/alpha/scan.yaml";
const LATER = ".specs-inferno/intents/alpha/first-update.md";
const shown = (result) => result.out + result.err;

function intentTree() {
  const fixture = mutantRepo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, SCAN, "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "scan"]);
  return { fixture, tree };
}

function intentReview(fixture, tree, body) {
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, body);
  return run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
}

/** A commit outside the ledger, so the recorded intent review no longer reads the tree. */
function codeMoved(tree, text) {
  write(tree, "docs/b.md", `${text}\n`);
  git(tree, ["commit", "-qam", text]);
}

function deferFinding(tree, entry, reason = "the user put it after the release") {
  const result = spawnSync(process.execPath, [WRITER, "defer-finding", "--intent", "alpha", "--entry", String(entry), "--to", "first-update.md",
    "--reason", reason, "--file", path.join(tree, ".specs-inferno/state.yaml")], { encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

/** The intent review recorded fix on the survivor of criterion a-one:2, an owed item proposal it ran. */
function survivorRecorded() {
  const { fixture, tree } = intentTree();
  write(tree, "docs/b.md", "a-two is mid-build\n");
  write(tree, REVIEW, withMutants(CAUGHT_ONE, SURVIVES_TWO));
  assert.equal(record(fixture, [], tree).code, 0);
  git(tree, ["checkout", "--", "docs/b.md"]);
  const first = intentReview(fixture, tree, "verdict: clean\n");
  assert.equal(first.code, 2, shown(first));
  assert.match(read(tree, INTENT_REVIEW), /severity: major\n    owner: a-one\n    mutant: a-one:2/);
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/two.expect"]);
  return { fixture, tree };
}

const SURVIVOR = proposal("a-one:2", { line: 2, find: "a2 = 2", replace: "a2 = 8", expect: "checks/two.expect" });
const WITHDRAWN = `withdrawn:\n${SURVIVOR}    caught: no\n    reason: its test never reads the line it breaks\n`;
const CAUGHT_TWO = proposal("a-one:2", { line: 2, find: "a2 = 2", replace: "a2 = 8", expect: "checks/a2.expect" });

test("a withdrawn survivor stops making the record fix, and the record says clean only once its criterion has a caught mutant", () => {
  const { fixture, tree } = survivorRecorded();
  codeMoved(tree, "a docs change");

  const refused = intentReview(fixture, tree, `verdict: clean\n${WITHDRAWN}`);
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, /a-one owes a caught mutant or a checked pin for criteria 2 "a2 reads two"/);
  assert.deepEqual(runs(fixture), [], "the withdrawn survivor did not run");

  write(tree, INTENT_REVIEW, `verdict: clean\nmutants:\n${CAUGHT_TWO}${WITHDRAWN}`);
  const clean = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
  assert.equal(clean.code, 0, shown(clean));
  assert.match(clean.out, /intent review clean, recorded/);
  assert.deepEqual(runs(fixture), ["checks/a2.expect"], "only the new proposal ran");
  const kept = read(tree, INTENT_REVIEW);
  assert.doesNotMatch(kept, /mutant: a-one:2/, "no finding for the withdrawn mutant");
  assert.match(kept, /^withdrawn:\n {2}- criterion: a-one:2\n(?:.*\n){4} {4}test: node checks\/has\.cjs checks\/two\.expect \.\.\/runs\.log\n {4}caught: no\n {4}reason: /m);
  assert.doesNotMatch(kept.split("withdrawn:")[0], /two\.expect/, "the withdrawn mutant left mutants");
});

test("a withdrawal of the intent reviewer's own survivor is carried over by every record, and a repeat of it is held once", () => {
  const { fixture, tree } = intentTree();
  write(tree, REVIEW, withMutants(CAUGHT_ONE));
  assert.equal(record(fixture, [], tree).code, 0);
  runs(fixture);
  const first = intentReview(fixture, tree, `verdict: clean\nmutants:\n${SURVIVOR}`);
  assert.equal(first.code, 2, shown(first));
  assert.deepEqual(runs(fixture), ["checks/two.expect"]);
  codeMoved(tree, "a docs change");
  const withdrawing = intentReview(fixture, tree, `verdict: clean\nmutants:\n${CAUGHT_TWO}${WITHDRAWN}`);
  assert.equal(withdrawing.code, 0, shown(withdrawing));
  assert.deepEqual(runs(fixture), ["checks/a2.expect"]);

  for (const body of [`verdict: clean\n${WITHDRAWN}`, "verdict: clean\n"]) {
    codeMoved(tree, `a docs change before ${body.length}`);
    const next = intentReview(fixture, tree, body);
    assert.equal(next.code, 0, shown(next));
    assert.deepEqual(runs(fixture), []);
    const kept = read(tree, INTENT_REVIEW);
    assert.match(kept, /^withdrawn:\n {2}- criterion: a-one:2\n(?:.*\n){4} {4}test: .*two\.expect/m);
    assert.equal(kept.split("    reason: ").length - 1, 1, "the withdrawal is held once");
  }
});

test("a withdrawal names a mutant the intent holds, carries a reason, and leaves mutants", () => {
  const { fixture, tree } = survivorRecorded();
  codeMoved(tree, "a docs change");
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  const other = proposal("a-one:2", { line: 2, find: "a2 = 2", replace: "a2 = 9", expect: "checks/two.expect" });
  for (const [body, pattern] of [
    [`verdict: clean\nwithdrawn:\n${other}    reason: wrong\n`, /withdrawn entry 1 names no mutant of this intent: copy one as the last intent review or an item review recorded it/],
    [`verdict: clean\nwithdrawn:\n${SURVIVOR}`, /withdrawn entry 1 has no reason/],
    [`verdict: clean\nwithdrawn:\n${SURVIVOR.replace(/ {4}replace: .*\n/, "")}    reason: wrong\n`, /withdrawn entry 1 has no replace: copy the mutant as recorded/],
    [`verdict: clean\nmutants:\n${SURVIVOR}${WITHDRAWN}`, /mutants entry 1 is withdrawn: leave it out of mutants/],
  ]) {
    write(tree, INTENT_REVIEW, body);
    const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
    assert.equal(result.code, 2, shown(result));
    assert.match(result.err, pattern);
    assert.deepEqual(runs(fixture), []);
  }
});

test("an owed item proposal the intent reviewer withdraws before it ever ran is never run", () => {
  const { fixture, tree } = intentTree();
  write(tree, "docs/b.md", "a-two is mid-build\n");
  write(tree, REVIEW, withMutants(CAUGHT_ONE, SURVIVES_TWO));
  assert.equal(record(fixture, [], tree).code, 0);
  git(tree, ["checkout", "--", "docs/b.md"]);

  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${CAUGHT_TWO}withdrawn:\n${SURVIVOR}    reason: a mistake\n`);

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/a2.expect"]);
});

/** Item a-one's two criteria each caught, then an intent review that found one blocker and two minor findings. */
function threeFindings() {
  const { fixture, tree } = intentTree();
  write(tree, REVIEW, withMutants(CAUGHT_ONE, CAUGHT_TWO.replace("a-one:2", "2\n    says: a2 reads two")));
  assert.equal(record(fixture, [], tree).code, 0);
  runs(fixture);
  const finding = (line, file, severity, evidence) => `  - criterion: a-one:${line}\n    file: ${file}\n    line: ${line}\n` +
    `    evidence: ${evidence}\n    fix: say it plainly\n    severity: ${severity}\n    owner: a-one\n`;
  const body = `verdict: fix\nfindings:\n${finding(1, "src/a.ts", "blocker", "the gift card total drops the tax")}` +
    `${finding(2, "src/a.ts", "minor", "the name reads loosely")}${finding(1, "checks/two.expect", "minor", "the expect file is terse")}`;
  const result = intentReview(fixture, tree, body);
  assert.equal(result.code, 2, shown(result));
  write(tree, LATER, "# After the release\n\n- src/a.ts:2 the name reads loosely\n- checks/two.expect:1 the expect file is terse\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the user's list for the first update"]);
  return { fixture, tree };
}

test("an intent review with a blocker and two deferred minor findings stays fix until the blocker is closed, then records clean with both kept", () => {
  const { fixture, tree } = threeFindings();
  for (const entry of [3, 2]) {
    const deferred = deferFinding(tree, entry);
    assert.equal(deferred.code, 0, shown(deferred));
  }
  git(tree, ["commit", "-qam", "two minor findings deferred"]);

  const waiting = run(fixture, ["review", "--tree", tree]);
  assert.equal(waiting.code, 2, shown(waiting));
  assert.match(waiting.out, /^FIX a-one: a-one:1 src\/a\.ts:1: the gift card total drops the tax/m);
  assert.doesNotMatch(waiting.out, /loosely|terse/);

  codeMoved(tree, "the blocker is fixed");
  const result = intentReview(fixture, tree, "verdict: clean\n");

  assert.equal(result.code, 0, shown(result));
  const kept = read(tree, INTENT_REVIEW);
  assert.match(kept, /^verdict: clean$/m);
  assert.doesNotMatch(kept, /^findings:/m);
  assert.match(kept, /^deferred:\n {2}- criterion: a-one:1\n {4}file: checks\/two\.expect\n(?:.*\n){5} {4}to: first-update\.md\n {4}reason: .*\n {2}- criterion: a-one:2\n {4}file: src\/a\.ts\n/m);
});

test("a reviewer may repeat the recorded deferred entries verbatim, and never write one of its own", () => {
  const { fixture, tree } = threeFindings();
  assert.equal(deferFinding(tree, 2).code, 0);
  git(tree, ["commit", "-qam", "a minor finding deferred"]);
  const recorded = read(tree, INTENT_REVIEW);
  const deferred = recorded.slice(recorded.indexOf("deferred:\n"), recorded.indexOf("tree: "));
  codeMoved(tree, "the blocker is fixed");
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);

  const open = "findings:\n  - criterion: a-one:1\n    file: checks/two.expect\n    line: 1\n    evidence: the expect file is terse\n" +
    "    fix: say it plainly\n    severity: minor\n    owner: a-one\n";
  for (const own of [deferred.replace("the name reads loosely", "the name reads badly"), deferred.replace("    owner: a-one\n", "    owner: a-one\n    find: name\n")]) {
    write(tree, INTENT_REVIEW, `verdict: fix\n${open}${own}`);
    const refused = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
    assert.equal(refused.code, 2, shown(refused));
    assert.match(refused.err, /deferred entry 1 is not one the last recorded review holds: the reviewer never defers, only the orchestrator's defer-finding does/);
  }

  write(tree, INTENT_REVIEW, `verdict: clean\n${deferred}`);
  const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
  assert.equal(result.code, 0, shown(result));
  assert.equal(read(tree, INTENT_REVIEW).split("- criterion:").length - 1, 1, "the deferred entry is held once");
});

test("a deferred survivor stops running, stays in the file with caught: no, and answers its criterion", () => {
  const { fixture, tree } = survivorRecorded();
  write(tree, ".specs-inferno/standards/defer-findings.yaml", "survivors: true\n");
  write(tree, LATER, "- src/a.ts:2 the test of criterion 2 reads too little\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the user's rule and list"]);
  const deferred = deferFinding(tree, 1);
  assert.equal(deferred.code, 0, shown(deferred));
  assert.match(deferred.out, /no finding stays open, so the review now says clean/);
  git(tree, ["commit", "-qam", "the survivor deferred"]);
  const now = run(fixture, ["review", "--tree", tree]);
  assert.equal(now.code, 0, shown(now));

  codeMoved(tree, "a docs change");
  const result = intentReview(fixture, tree, "verdict: clean\n");

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), [], "neither the deferred survivor nor its owed item proposal ran");
  const kept = read(tree, INTENT_REVIEW);
  assert.match(kept, /^deferred:\n {2}- criterion: a-one:2\n(?:.*\n){6} {4}mutant: a-one:2\n {4}find: "a2 = 2"\n {4}replace: "a2 = 8"\n {4}test: .*two\.expect.*\n {4}caught: no\n {4}to: first-update\.md\n/m);
  assert.doesNotMatch(kept.split("deferred:")[0], /two\.expect/);
});
