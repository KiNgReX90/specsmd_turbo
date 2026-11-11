const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { INTENT_TREE, git, run, worktree, write } = require("./review-fixture.cjs");
const {
  A_EDITABLE, A_ONE, CAUGHT_ONE, INTENT_REVIEW, REVIEW, SURVIVES_TWO, itemSpec, mutantRepo, proposal, read, record, runs, withMutants,
} = require("./run-review-mutants-fixture.cjs");

// A set-aside mutant stays aside wherever its line went: the runner places an owed proposal in the
// file its item moved the line to, and a withdrawal or a deferral of that mutant still holds there.
// And a deferral never leaves a review that says clean while a criterion still owes a proof: it
// stays fix, and the next review call dispatches its reviewer for exactly those criteria.

const WRITER = path.join(__dirname, "state-transition.cjs");
const SCAN = ".specs-inferno/intents/alpha/scan.yaml";
const SPEC = ".specs-inferno/intents/alpha/work-items/a-one.md";
const LATER = ".specs-inferno/intents/alpha/first-update.md";
const shown = (result) => result.out + result.err;
const CAUGHT_TWO = proposal("a-one:2", { line: 2, find: "a2 = 2", replace: "a2 = 8", expect: "checks/a2.expect" });

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

/** Item a-one reviewed beside a sibling's uncommitted work, so its proposals stay owed. */
function owedItem(fixture, tree, body) {
  write(tree, "docs/b.md", "a-two is mid-build\n");
  write(tree, REVIEW, body);
  assert.equal(record(fixture, [], tree).code, 0);
  git(tree, ["checkout", "--", "docs/b.md"]);
}

/** Commit a correction that moves one line of src/a.ts into src/c.ts, which a-one now owns. */
function moved(tree, a, c, extra = {}) {
  write(tree, "src/a.ts", a);
  write(tree, "src/c.ts", c);
  write(tree, SPEC, itemSpec("a-one", A_ONE, [...A_EDITABLE, "src/c.ts"]));
  for (const [rel, body] of Object.entries(extra)) write(tree, rel, body);
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a line moves into its own module"]);
}

function deferFinding(tree, entry) {
  const result = spawnSync(process.execPath, [WRITER, "defer-finding", "--intent", "alpha", "--entry", String(entry), "--to", "first-update.md",
    "--reason", "the user put it after the release", "--file", path.join(tree, ".specs-inferno/state.yaml")], { encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test("a withdrawn owed proposal whose line a later commit moved to another file is not run and gets no finding", () => {
  const { fixture, tree } = intentTree();
  owedItem(fixture, tree, withMutants(CAUGHT_ONE, CAUGHT_TWO.replace("a-one:2", "2")));
  moved(tree, "export { a } from './c';\nexport const a2 = 2;\n", "export const a = 1;\n", { "checks/one.expect": "src/c.ts a = 1\n" });
  const placed = proposal("a-one:1", { file: "src/c.ts" });
  const withdrawn = `withdrawn:\n${placed}    reason: it changes nothing a reader sees\n`;

  const refused = intentReview(fixture, tree, `verdict: clean\n${withdrawn}`);
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, /a-one owes a caught mutant or a checked pin for criteria 1 "a reads one"/);
  assert.deepEqual(runs(fixture), []);

  write(tree, INTENT_REVIEW, `verdict: clean\nmutants:\n${proposal("a-one:1")}${withdrawn}`);
  const doubled = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
  assert.equal(doubled.code, 2, shown(doubled));
  assert.match(doubled.err, /mutants entry 1 is withdrawn: leave it out of mutants/);

  write(tree, INTENT_REVIEW, `verdict: clean\nmutants:\n${proposal("a-one:1", { file: "src/c.ts", replace: "a = 9" })}${withdrawn}`);
  const clean = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
  assert.equal(clean.code, 0, shown(clean));
  assert.deepEqual(runs(fixture), ["checks/a2.expect", "checks/one.expect"]);
  const kept = read(tree, INTENT_REVIEW);
  assert.doesNotMatch(kept, /replace: "a = 7"[\s\S]*withdrawn:/, "the withdrawn mutant left mutants");
  assert.match(kept, /^findings: \[\]$/m, "no finding for the withdrawn mutant");

  write(tree, "docs/b.md", "a docs change\n");
  git(tree, ["commit", "-qam", "a docs change"]);
  const again = intentReview(fixture, tree, `verdict: clean\nwithdrawn:\n${proposal("a-one:1")}    reason: as the item review recorded it\n`);
  assert.equal(again.code, 0, shown(again));
  assert.equal(read(tree, INTENT_REVIEW).split("    reason: ").length - 1, 1, "a repeat at the old file is the same withdrawal");
});

test("a survivor the runner placed in the file its line moved to is withdrawn by the entry as its item recorded it", () => {
  const { fixture, tree } = intentTree();
  owedItem(fixture, tree, withMutants(CAUGHT_ONE, SURVIVES_TWO));
  moved(tree, "export const a = 1;\nexport { a2 } from './c';\n", "export const a2 = 2;\n", { "checks/a2.expect": "src/c.ts a2 = 2\n" });
  assert.equal(intentReview(fixture, tree, "verdict: clean\n").code, 2);
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/two.expect"]);
  assert.match(read(tree, INTENT_REVIEW), /criterion: a-one:2\n {4}file: src\/c\.ts\n/);
  write(tree, "docs/b.md", "a docs change\n");
  git(tree, ["commit", "-qam", "a docs change"]);

  const result = intentReview(fixture, tree, `verdict: clean\nmutants:\n${CAUGHT_TWO.replace("line: 2", "line: 1").replace("src/a.ts", "src/c.ts")}` +
    `withdrawn:\n${SURVIVES_TWO.replace("criterion: 2", "criterion: a-one:2")}    reason: its test never reads the line it breaks\n`);

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/a2.expect"]);
});

test("a deferred survivor whose line a later commit moved to another file is not run again", () => {
  const { fixture, tree } = intentTree();
  owedItem(fixture, tree, withMutants(CAUGHT_ONE, SURVIVES_TWO));
  assert.equal(intentReview(fixture, tree, "verdict: clean\n").code, 2);
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/two.expect"]);
  write(tree, ".specs-inferno/standards/defer-findings.yaml", "survivors: true\n");
  write(tree, LATER, "- src/a.ts:2 the test of criterion 2 reads too little\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the user's rule and list"]);
  assert.equal(deferFinding(tree, 1).code, 0);
  git(tree, ["commit", "-qam", "the survivor deferred"]);
  moved(tree, "export const a = 1;\nexport { a2 } from './c';\n", "export const a2 = 2;\n");

  const result = intentReview(fixture, tree, "verdict: clean\n");

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), []);
  assert.match(read(tree, INTENT_REVIEW), /^deferred:\n {2}- criterion: a-one:2\n/m);
});

/** Item a-one proves criterion 1 (and any other it proposes for), and the intent review found one minor finding and proposed nothing. */
function minorOnly(...proposals) {
  const { fixture, tree } = intentTree();
  write(tree, REVIEW, withMutants(CAUGHT_ONE, ...proposals));
  assert.equal(record(fixture, [], tree).code, 0);
  runs(fixture);
  const body = "verdict: fix\nfindings:\n  - criterion: a-one:1\n    file: src/a.ts\n    line: 1\n    evidence: the name reads loosely\n" +
    "    fix: say it plainly\n    severity: minor\n    owner: a-one\n";
  assert.equal(intentReview(fixture, tree, body).code, 2);
  write(tree, LATER, "- src/a.ts:1 the name reads loosely\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the user's list"]);
  return { fixture, tree };
}

test("a deferral that leaves a criterion without a proof keeps the review fix, names the criterion, and the next call dispatches for it", () => {
  const { fixture, tree } = minorOnly();
  const deferred = deferFinding(tree, 1);
  assert.equal(deferred.code, 0, shown(deferred));
  assert.match(deferred.out, /\n {2}no finding stays open, and a-one owes a caught mutant or a checked pin for criteria 2 "a2 reads two": the review stays fix; run \S*run\.cjs review --tree \S+(?: --\S+ \S+)* to dispatch its reviewer for them\n/);
  const recorded = read(tree, INTENT_REVIEW);
  assert.match(recorded, /^verdict: fix\nfindings: \[\]\n/);
  git(tree, ["commit", "-qam", "the minor finding deferred"]);

  const dispatched = run(fixture, ["review", "--tree", tree]);
  assert.equal(dispatched.code, 3, shown(dispatched));
  assert.match(dispatched.out, /^intent review owed for alpha: every open finding is deferred, and a-one owes a caught mutant or a checked pin for criteria 2 "a2 reads two"; propose a mutant or a pin for each/m);
  assert.match(dispatched.out, /^ {2}previous \.specs-inferno\/intents\/alpha\/review\.yaml/m);
  assert.doesNotMatch(dispatched.out + dispatched.err, /send this back|send each item its findings/);

  write(tree, INTENT_REVIEW, `verdict: clean\nmutants:\n${CAUGHT_TWO}`);
  const clean = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
  assert.equal(clean.code, 0, shown(clean));
  assert.deepEqual(runs(fixture), ["checks/a2.expect"]);
  assert.match(read(tree, INTENT_REVIEW), /^verdict: clean\n[\s\S]*^deferred:\n {2}- criterion: a-one:1\n/m);
});

test("a deferral that leaves no criterion without a proof records clean", () => {
  const { fixture, tree } = minorOnly(CAUGHT_TWO.replace("a-one:2", "2"));
  const deferred = deferFinding(tree, 1);
  assert.equal(deferred.code, 0, shown(deferred));
  assert.match(deferred.out, /\n {2}no finding stays open, so the review now says clean\n/);
  assert.match(read(tree, INTENT_REVIEW), /^verdict: clean\n/);
  git(tree, ["commit", "-qam", "the minor finding deferred"]);
  const now = run(fixture, ["review", "--tree", tree]);
  assert.equal(now.code, 0, shown(now));
  assert.match(now.out, /intent review clean for the current tree/);
});
