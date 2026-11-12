const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { INTENT_TREE, git, intentReviewed, repo, run, worktree, write } = require("./review-fixture.cjs");
const { writeFile } = require("./test-write.cjs");
const { CAUGHT_ONE, INTENT_REVIEW, itemReview, mutantRepo } = require("./run-review-mutants-fixture.cjs");

// --- a minor-only fix settles ----------------------------------------------------------
// A fix review whose findings are all minor is no miss. The warm builder corrects, verify-item
// proves the correction, and when every path of the item changed since that review is a file
// the review lists, `review --item` records `settled` at HEAD and prints the integrate call:
// no second review. A correction that touches any other file of the item owes a delta review,
// and a settled item whose listed files change again owes one too. The intent review is told
// which corrections no item review re-read.

const REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const ledger = (tree) => fs.readFileSync(path.join(tree, ".specs-inferno/state.yaml"), "utf8");
const head = (tree) => git(tree, ["rev-parse", "HEAD"]);

const MINOR = `item: a-one
verdict: fix
files: [src/a.ts, src/a.test.ts]
findings:
  - criterion: AC1 the value reads two
    file: src/a.ts
    line: 1
    evidence: the name a reads as nothing
    fix: name it count
    severity: minor
`;
const MAJOR = MINOR.replace("severity: minor", "severity: major");

/** The host, in `tree` (its root unless an intent worktree is asked for), with a-one's minor-only fix review on record. */
function minorReviewed(options = {}) {
  const fixture = repo(options);
  const tree = options.intentTree ? worktree(fixture, INTENT_TREE) : fixture.root;
  const at = (args) => run(fixture, [...args, "--tree", tree]);
  if (options.verifyBefore) dispatched({ tree, at }, { "src/a.ts": "export const a = 1; // built\n" });
  else write(tree, "src/a.ts", "export const a = 1; // built\n");
  git(tree, ["commit", "-qam", "a-one built"]);
  if (options.verifyBefore) verified({ at });
  const review = (extra = []) => at(["review", "--item", "a-one", "--reviewer", "rev-1", ...extra]);
  write(tree, REVIEW, options.body || MINOR);
  const recorded = review();
  assert.equal(recorded.code, 2, recorded.out + recorded.err);
  // The commit the fix review read, as its record names it.
  const read = /^commit: ([0-9a-f]+)$/m.exec(fs.readFileSync(path.join(tree, REVIEW), "utf8"))[1];
  return { fixture, tree, at, review, read };
}

/**
 * A builder's turn the way the orchestrator runs it: dispatch-log, the files written, accept-dispatch.
 * verify-item then checks the item against that dispatch.
 */
function dispatched(host, files) {
  const logged = host.at(["dispatch-log", "alpha", "--item", "a-one", "--tier", "cheap", "--agent", "specsmd-inferno-builder-cheap", "--json"]);
  assert.equal(logged.code, 0, logged.out + logged.err);
  for (const [rel, body] of Object.entries(files)) write(host.tree, rel, body);
  const accepted = host.at(["accept-dispatch", JSON.parse(logged.out).dispatch_id, "--changed-paths", JSON.stringify(Object.keys(files))]);
  assert.equal(accepted.code, 0, accepted.out + accepted.err);
}

/** verify-item on the item as it stands; returns its proof file. */
function verified(host) {
  const result = host.at(["verify-item", "a-one"]);
  assert.equal(result.code, 0, result.out + result.err);
  return /^proof (.+)$/m.exec(result.out)[1];
}

/** The warm builder's correction: dispatched, proved with verify-item unless told not to, committed. */
function corrected(host, files, { verify = true } = {}) {
  dispatched(host, files);
  const proof = verify ? verified(host) : null;
  git(host.tree, ["add", "--", ...Object.keys(files)]);
  git(host.tree, ["commit", "-qm", "the warm correction"]);
  return proof;
}

const NAMED = { "src/a.ts": "export const count = 1; // built\n" };

test("a minor-only fix settles when the correction stays inside the listed files, and prints the integrate call", () => {
  const host = minorReviewed();
  corrected(host, NAMED);
  const at = head(host.tree);

  const result = host.review();

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^review a-one settled at [0-9a-f]{7}: the warm builder corrected every minor finding inside src\/a\.ts, the files the review lists, so no second review reads it$/m);
  assert.match(result.out, /^then run\.cjs integrate --item a-one --tree /m);
  assert.match(ledger(host.tree), /review: settled\n/);
  assert.match(ledger(host.tree), new RegExp(`review_commit: ${at}\\n`));
  assert.match(ledger(host.tree), /review_misses: 0\n\s+review_weight: minor\n/);
  assert.equal(git(host.tree, ["log", "-1", "--format=%s"]), "specsmd(alpha): review a-one settled");
  assert.equal(git(host.tree, ["status", "--porcelain"]), "", "only the ledger is committed, and it is");
  assert.equal(fs.readFileSync(path.join(host.tree, REVIEW), "utf8").includes("severity: minor"), true, "the review file stays as recorded");

  // Asked again it answers from the ledger and writes nothing.
  const again = host.review();
  assert.equal(again.code, 0, again.out + again.err);
  assert.match(again.out, /^review a-one settled for the current files \(settled at [0-9a-f]{7}\)$/m);
  assert.equal(git(host.tree, ["log", "-1", "--format=%s"]), "specsmd(alpha): review a-one settled");
});

test("one touched file of the item outside the listed ones owes a delta review", () => {
  const host = minorReviewed();
  corrected(host, { ...NAMED, "src/a2.test.ts": "// a test the review does not list\n" });

  const result = host.review();

  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /^review owed for a-one: the correction of the minor findings touches src\/a2\.test\.ts, which the review does not list$/m);
  assert.match(result.out, /paths src\/a\.ts src\/a\.test\.ts src\/a2\.test\.ts/);
  assert.match(ledger(host.tree), /review: fix\n/);
});

test("a serious fix review never settles, even when the correction stays inside the listed files", () => {
  const host = minorReviewed({ body: MAJOR });
  corrected(host, NAMED);
  const result = host.review();
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /^review owed for a-one: the item changed since the last review$/m);
  assert.doesNotMatch(ledger(host.tree), /review: settled/);
});

test("settle waits for a proof of the corrected state, and runs as printed once there is one", () => {
  const host = minorReviewed();
  corrected(host, NAMED, { verify: false });

  const owed = host.review();

  assert.equal(owed.code, 3, owed.out + owed.err);
  assert.match(owed.out, /^settle owed for a-one: every finding was minor and the correction stays inside the files the review lists, but no verify-item proof of the correction is on record$/m);
  assert.match(owed.out, /run run\.cjs verify-item a-one --tree \S+, then run\.cjs review --item a-one --tree /);
  assert.doesNotMatch(ledger(host.tree), /review: settled/);
  // Run the verify-item call as printed, from the project root the way the orchestrator runs it.
  const printedCall = /run run\.cjs (verify-item .+?), then /.exec(owed.out)[1].split(" ");
  const proved = run(host.fixture, printedCall);
  assert.equal(proved.code, 0, proved.out + proved.err);
  assert.equal(host.review().code, 0);
  assert.match(ledger(host.tree), /review: settled\n/);
});

test("a proof that predates the fix review, that failed, or that the item outgrew does not settle it", () => {
  const stale = minorReviewed();
  // verify-item before the fix review was recorded: the proof of the first build.
  dispatched(stale, { "src/a.ts": "export const a = 1; // built again\n" });
  verified(stale);
  git(stale.tree, ["commit", "-qam", "built again"]);
  write(stale.tree, REVIEW, MINOR);
  stale.review();
  corrected(stale, NAMED, { verify: false });
  assert.match(stale.review().out, /^settle owed for a-one: .* but its verify-item proof predates the fix review$/m);

  // verify-item on the very commit the fix review read: before the review, so no proof of a correction.
  const early = minorReviewed({ verifyBefore: true });
  corrected(early, NAMED, { verify: false });
  assert.match(early.review().out, /^settle owed for a-one: .* but its verify-item proof predates the fix review$/m);

  const failed = minorReviewed();
  const file = corrected(failed, NAMED);
  writeFile(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), passed: false }));
  assert.match(failed.review().out, /^settle owed for a-one: .* but its verify-item proof failed$/m);

  const outgrown = minorReviewed();
  corrected(outgrown, NAMED);
  corrected(outgrown, { "src/a.ts": "export const count = 2; // built\n" }, { verify: false });
  assert.match(outgrown.review().out, /^settle owed for a-one: .* but the item changed since its verify-item proof$/m);
  for (const host of [stale, early, failed, outgrown]) assert.doesNotMatch(ledger(host.tree), /review: settled/);
});

test("a listed file of the item that changed after the proof, outside the proof's paths, does not settle it", () => {
  // The review lists src/a2.test.ts, which the build wrote; the correction's proof covers only src/a.ts.
  const body = MINOR.replace("files: [src/a.ts, src/a.test.ts]", "files: [src/a.ts, src/a.test.ts, src/a2.test.ts]");
  const host = minorReviewed({ body, files: { "src/a2.test.ts": "// the build's test\n" } });
  corrected(host, NAMED);
  corrected(host, { "src/a2.test.ts": "// the build's test, changed after the proof\n" }, { verify: false });

  const result = host.review();

  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /^settle owed for a-one: .* but the item changed since its verify-item proof$/m);
  assert.doesNotMatch(ledger(host.tree), /review: settled/);
});

test("a settled item passes integrate, releases its successor, and leaves the gate to the intent review", () => {
  const host = minorReviewed({ intentTree: true, config: "delivery:\n  base_branch: main\nverification:\n  integrate:\n    - echo integrate ran\n  finalize:\n    - echo gated\n" });
  corrected(host, NAMED);
  assert.equal(host.review().code, 0);

  const integrated = host.at(["integrate", "--item", "a-one"]);

  assert.equal(integrated.code, 0, integrated.out + integrated.err);
  assert.match(ledger(host.tree), /status: completed\n[\s\S]*?integrated_sha: [0-9a-f]+/);
  assert.match(host.at(["frontier", "alpha"]).out, /^ready a-two /m);
  write(host.tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  git(host.tree, ["add", "-A"]);
  git(host.tree, ["commit", "-qm", "scan collected"]);
  intentReviewed(host.tree);
  const gate = host.at(["gate"]);
  assert.equal(gate.code, 0, gate.out + gate.err);
  assert.match(gate.out, /PASS \d+s echo gated/);
});

test("a settled item whose listed file changes again is owed a delta review from the review it settled", () => {
  const host = minorReviewed();
  corrected(host, NAMED);
  host.review();
  write(host.tree, "src/a2.test.ts", "// a test of the later change\n");
  git(host.tree, ["add", "-A"]);
  git(host.tree, ["commit", "-qm", "a test beside it"]);
  assert.equal(host.review().code, 0, "a file of the item the review does not list leaves it settled, as it leaves a clean one");
  // The later change the way the flow makes one: a builder's turn, then verify-item, then the commit.
  corrected(host, { "src/a.ts": "export const count = 3; // later\n" });

  const result = host.review();

  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /^review owed for a-one: a file the settled review lists changed since it settled$/m);
  assert.match(result.out, new RegExp(`range ${host.read.slice(0, 7)}[0-9a-f]*\\.\\.`), "the delta reads the settled correction too");
  assert.match(result.out, /paths src\/a\.ts src\/a\.test\.ts src\/a2\.test\.ts/, "and every file of the item changed since");
  assert.match(result.out, /^ {2}previous \.specs-inferno\/intents\/alpha\/reviews\/a-one\.yaml$/m);
  const integrate = host.at(["integrate", "--item", "a-one"]);
  assert.equal(integrate.code, 3, integrate.out + integrate.err);
  assert.match(integrate.err, /a-one: a file it lists changed since its review/);
});

test("a settled item whose listed file changed is told verify-item first while its proof is old, then the delta review from the settled one", () => {
  const host = minorReviewed();
  corrected(host, NAMED);
  assert.equal(host.review().code, 0);
  corrected(host, { "src/a.ts": "export const count = 5; // later\n" }, { verify: false });

  const first = host.review();

  assert.equal(first.code, 3, first.out + first.err);
  assert.match(first.out, /^verify-item owed for a-one before its review: its proof \S+a-one\.json was taken over an older state of its paths, so no reviewer may read it$/m);
  assert.doesNotMatch(first.out, /^review owed /m, "no reviewer is dispatched over an old proof");
  assert.match(ledger(host.tree), /review: settled\n/);
  // Run the verify-item call as printed, from the project root the way the orchestrator runs it.
  const printedCall = /^then run\.cjs (verify-item .+?), then run\.cjs review --item a-one /m.exec(first.out)[1].split(" ");
  const proved = run(host.fixture, printedCall);
  assert.equal(proved.code, 0, proved.out + proved.err);

  const second = host.review();

  assert.equal(second.code, 3, second.out + second.err);
  assert.match(second.out, /^review owed for a-one: a file the settled review lists changed since it settled$/m);
  assert.match(second.out, new RegExp(`range ${host.read.slice(0, 7)}[0-9a-f]*\\.\\.`), "the delta reads from the commit the settled review read");
  assert.match(second.out, /^ {2}previous \.specs-inferno\/intents\/alpha\/reviews\/a-one\.yaml$/m);
  assert.match(second.out, /^ {2}proof \S+a-one\.json$/m, "and names the proof it now may read");
});

test("the intent review dispatch lists each settled item with the range nobody re-read, and none when none settled", () => {
  const plain = minorReviewed({ intentTree: true });
  write(plain.tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  git(plain.tree, ["add", "-A"]);
  git(plain.tree, ["commit", "-qm", "scan collected"]);
  const none = plain.at(["review"]);
  assert.equal(none.code, 3, none.out + none.err);
  assert.doesNotMatch(none.out, /settled/);
  assert.deepEqual(JSON.parse(plain.at(["review", "--json"]).out).settled, []);

  const host = minorReviewed({ intentTree: true });
  corrected(host, NAMED);
  host.review();
  const range = `${host.read.slice(0, 7)}..${git(host.tree, ["rev-parse", "--short", "HEAD~1"])}`;
  write(host.tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  git(host.tree, ["add", "-A"]);
  git(host.tree, ["commit", "-qm", "scan collected"]);

  const dispatch = host.at(["review"]);

  assert.equal(dispatch.code, 3, dispatch.out + dispatch.err);
  assert.match(dispatch.out, new RegExp(`^ {2}settled a-one ${range}$`, "m"));
  assert.deepEqual(JSON.parse(host.at(["review", "--json"]).out).settled, [{ item: "a-one", range }]);

  // A delta of the intent review lists no item the last intent review already read settled.
  intentReviewed(host.tree);
  write(host.tree, "docs/b.md", "docs moved on\n");
  git(host.tree, ["commit", "-qam", "a-two moved"]);
  const delta = host.at(["review"]);
  assert.equal(delta.code, 3, delta.out + delta.err);
  assert.doesNotMatch(delta.out, /^ {2}settled /m);
});

test("a fix review whose commit is gone never settles: the correction cannot be told from the rest", () => {
  const host = minorReviewed();
  const file = path.join(host.tree, ".specs-inferno/state.yaml");
  writeFile(file, ledger(host.tree).replace(/review_commit: [0-9a-f]+/, `review_commit: ${"d".repeat(40)}`));
  git(host.tree, ["commit", "-qam", "a ledger whose review commit is not in this history"]);
  corrected(host, NAMED);
  const result = host.review();
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /^review owed for a-one: the item changed since the last review$/m);
  assert.doesNotMatch(ledger(host.tree), /review: settled/);
});

test("a settled review file that names no commit reads from the settle commit, and the intent review names the start unknown", () => {
  const host = minorReviewed({ intentTree: true });
  corrected(host, NAMED);
  host.review();
  const settledAt = git(host.tree, ["rev-parse", "--short", "HEAD~1"]);
  const file = path.join(host.tree, REVIEW);
  writeFile(file, fs.readFileSync(file, "utf8").replace(/^commit: .*\n/m, ""));
  write(host.tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  git(host.tree, ["add", "-A"]);
  git(host.tree, ["commit", "-qm", "a review file recorded without its commit, and the scan"]);
  assert.match(host.at(["review"]).out, new RegExp(`^ {2}settled a-one unknown\\.\\.${settledAt}$`, "m"));

  corrected(host, { "src/a.ts": "export const count = 4; // later\n" });
  assert.match(host.review().out, new RegExp(`range ${settledAt}[0-9a-f]*\\.\\.`));
});

test("a settled item's caught mutant and checked pin count at the intent review as a clean item's do", () => {
  // a-one owes, for each of its two criteria, a caught mutant or a checked pin. Its minor-only
  // fix review holds both: criterion 1 by a mutant its test catches, criterion 2 by a pin.
  const SENTENCE = "Gift cards never expire and keep their full value.";
  const fixture = mutantRepo({ files: {
    "src/notice.html": `<p>${SENTENCE}</p>\n`,
    "checks/notice.test.cjs": `says(['${SENTENCE}']);\n`,
  } });
  const tree = worktree(fixture, INTENT_TREE);
  const host = { fixture, tree, at: (args) => run(fixture, [...args, "--tree", tree]) };
  const pin = `pins:\n  - criterion: 2\n    says: a2 reads two\n    file: src/notice.html\n    test: checks/notice.test.cjs\n    text: "${SENTENCE}"\n`;
  write(tree, REVIEW, itemReview(`findings:\n  - criterion: AC1\n    file: src/a.ts\n    line: 1\n    evidence: the name a reads as nothing\n` +
    `    fix: say what it counts\n    severity: minor\nmutants:\n${CAUGHT_ONE}${pin}`, "fix"));
  const recorded = host.at(["review", "--item", "a-one", "--reviewer", "rev-1"]);
  assert.equal(recorded.code, 2, recorded.out + recorded.err);
  corrected(host, { "src/a.ts": "export const a = 1; // the count\nexport const a2 = 2;\n" });
  const settled = host.at(["review", "--item", "a-one"]);
  assert.equal(settled.code, 0, settled.out + settled.err);
  assert.match(ledger(tree), /review: settled\n/);
  write(tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "scan collected"]);

  assert.equal(host.at(["review"]).code, 3);
  write(tree, INTENT_REVIEW, "verdict: clean\n");
  const intent = host.at(["review", "--reviewer", "rev-2"]);

  assert.equal(intent.code, 0, intent.out + intent.err);
  assert.doesNotMatch(intent.out + intent.err, /owes a caught mutant or a checked pin/);
});
