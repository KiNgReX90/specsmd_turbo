const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { git, run, write } = require("./review-fixture.cjs");
const {
  CAUGHT_ONE, CONFIG, REVIEW, SURVIVES_TWO, itemReview, mutantRepo, proposal, read, record, recordedByHand, runs, withMutants,
} = require("./run-review-mutants-fixture.cjs");
const { parseItemReview } = require("./run-review-file.cjs");
const { itemProofs, mutantGaps } = require("./run-mutant-coverage.cjs");

// The runner runs the mutants, once. A first item review proposes one mutant per acceptance
// criterion that a test covers, named by the criterion's number, and runs none: the record step
// runs them through the batch, writes `caught` and turns each survivor into a major finding. A
// delta review proposes none; its record reruns only the survivors. A review the released flow
// recorded, with mutants its reviewer ran itself under a free-text criterion, still reads.

const ledger = (fixture) => read(fixture.root, ".specs-inferno/state.yaml");
const shown = (result) => result.out + result.err;

function refused(fixture, body, pattern) {
  const before = ledger(fixture);
  write(fixture.root, REVIEW, body);
  const result = record(fixture);
  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, pattern);
  assert.equal(ledger(fixture), before, "nothing is recorded");
  assert.deepEqual(runs(fixture), [], "a refused proposal never runs");
}

test("a proposal that names its criterion in free text is refused, and nothing runs", () => {
  const fixture = mutantRepo();
  refused(fixture, withMutants(proposal("AC1 a reads one")),
    /BAD_REVIEW.*mutants entry 1 criterion reads AC1 a reads one; name the acceptance criterion by its number alone, 1 for the first/);
  refused(fixture, withMutants(proposal(3)), /BAD_REVIEW.*mutants entry 1 names criterion 3, and a-one has 2 acceptance criteria/);
});

test("two proposals on one criterion are refused", () => {
  const fixture = mutantRepo();
  refused(fixture, withMutants(CAUGHT_ONE, proposal(1, { replace: "a = 9" })),
    /BAD_REVIEW.*criterion 1 has 2 mutants; propose one per criterion/);
});

test("a proposal is a whole mistake: a line to break and the test that should notice", () => {
  const fixture = mutantRepo();
  const ran = "  - criterion: 1\n    test: node checks/has.cjs checks/one.expect\n    caught: yes\n";
  refused(fixture, withMutants(ran), /BAD_REVIEW.*mutants entry 1 has no file: propose \{criterion, file, line, find, replace, test\}/);
  refused(fixture, withMutants(proposal(1, { find: "a = 5" })), /BAD_REVIEW.*mutants entry 1: find occurs 0 times on src\/a\.ts:1/);
});

test("the record step fills caught and writes the survivor finding", () => {
  const fixture = mutantRepo();
  write(fixture.root, REVIEW, withMutants(CAUGHT_ONE, SURVIVES_TWO));
  const result = record(fixture);

  assert.equal(result.code, 2, shown(result));
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/two.expect"], "each proposal ran once");
  assert.match(result.out, /mutants: 2 ran, 1 caught, 1 survived/);
  assert.match(result.out, /^FINDING 2 src\/a\.ts:2: the runner broke src\/a\.ts:2 .*node checks\/has\.cjs checks\/two\.expect .* stayed green/m);
  assert.doesNotMatch(result.out, /^MUTANT 2 survived/m, "the survivor is told once, as its finding");
  assert.match(ledger(fixture), /review: fix/);
  assert.match(ledger(fixture), /review_rejections: 1/);

  const recorded = parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true });
  assert.equal(recorded.verdict, "fix", "a survivor turns the reviewer's clean into fix");
  assert.deepEqual(recorded.mutants.map((m) => [m.criterion, m.caught]), [["1", "yes"], ["2", "no"]]);
  assert.deepEqual(recorded.findings.map((f) => [f.criterion, f.file, f.line, f.severity, f.mutant]), [["2", "src/a.ts", "2", "major", "2"]]);
  assert.match(recorded.findings[0].fix, /make that test turn red on that change; leave the production line as it is/);
  assert.equal(read(fixture.root, "src/a.ts"), "export const a = 1;\nexport const a2 = 2;\n", "every file is put back");
  assert.equal(git(fixture.root, ["status", "--porcelain"]), "");
});

/** Record the first review, then commit the builder's fix: the weak test for criterion 2 made strong. */
function fixedSurvivor() {
  const fixture = mutantRepo();
  write(fixture.root, REVIEW, withMutants(CAUGHT_ONE, SURVIVES_TWO));
  assert.equal(record(fixture).code, 2);
  runs(fixture);
  write(fixture.root, "checks/two.expect", "src/a.ts a2 = 2\n");
  git(fixture.root, ["commit", "-qam", "the test of criterion 2 now reads the value"]);
  return fixture;
}

test("a rerun touches only the survivors, and a caught one resolves its finding", () => {
  const fixture = fixedSurvivor();
  const owed = run(fixture, ["review", "--item", "a-one", "--tree", fixture.root]);
  assert.equal(owed.code, 3, shown(owed));
  write(fixture.root, REVIEW, itemReview(""));

  const result = record(fixture);

  assert.equal(result.code, 0, shown(result));
  assert.deepEqual(runs(fixture), ["checks/two.expect"], "criterion 1 was caught already, so only the survivor ran");
  assert.match(result.out, /mutants: 1 ran, 1 caught, 0 survived/);
  const recorded = parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true });
  assert.equal(recorded.verdict, "clean");
  assert.deepEqual(recorded.mutants.map((m) => [m.criterion, m.caught]), [["1", "yes"], ["2", "yes"]], "the runner carried the entries over");
  assert.deepEqual(recorded.findings, []);
});

test("a delta review with a new mutant is refused; one copied from the last review is no new one", () => {
  const fixture = fixedSurvivor();
  refused(fixture, itemReview(`mutants:\n${proposal(1, { replace: "a = 9" })}`),
    /BAD_REVIEW.*mutants entry 1 is new: a delta review proposes no mutant/);
  write(fixture.root, REVIEW, itemReview(`mutants:\n${CAUGHT_ONE}${SURVIVES_TWO}`));
  const copied = record(fixture);
  assert.equal(copied.code, 0, shown(copied));
  assert.deepEqual(runs(fixture), ["checks/two.expect"]);
});

// The released flow's reviewer ran its own mutants and pasted {criterion, test, caught}, the
// criterion in free text. Such a file is on record in every host that upgrades mid-intent.
const RELEASED = `item: a-one
verdict: clean
files: [src/a.ts]
findings: []
mutants:
  - criterion: AC1 a reads one
    test: node checks/has.cjs checks/one.expect
    caught: yes
`;

test("a recorded 0.1.81 review still parses, and its caught mutants still count", () => {
  const fixture = mutantRepo();
  recordedByHand(fixture.root, RELEASED);

  const current = run(fixture, ["review", "--item", "a-one", "--tree", fixture.root]);
  assert.equal(current.code, 0, shown(current));
  assert.match(current.out, /review a-one clean for the current files/);
  const recorded = parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true });
  assert.deepEqual(recorded.mutants, [{ criterion: "AC1 a reads one", test: "node checks/has.cjs checks/one.expect", caught: "yes" }]);
  assert.deepEqual(mutantGaps(itemProofs(fixture.root, "alpha", ["a-one"]), []), ['a-one owes a caught mutant or a checked pin for criteria 2 "a2 reads two"']);
});

test("a delta after a released-flow review keeps its caught mutants and leaves a survivor it cannot rerun to the intent review", () => {
  const fixture = mutantRepo();
  const survived = "  - criterion: AC2 a2 reads two\n    test: node checks/has.cjs checks/two.expect\n    caught: no\n";
  const finding = "  - criterion: AC2\n    file: src/a.ts\n    line: 2\n    evidence: read it\n    fix: test it\n    severity: major\n";
  recordedByHand(fixture.root, RELEASED.replace("verdict: clean", "verdict: fix").replace("findings: []\n", `findings:\n${finding}`) + survived, "fix");
  write(fixture.root, "checks/two.expect", "src/a.ts a2 = 2\n");
  git(fixture.root, ["commit", "-qam", "the fix"]);
  write(fixture.root, REVIEW, itemReview(""));

  const result = record(fixture);

  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /MUTANT AC2 a2 reads two names no line to break, so the intent review owes its criterion a caught mutant or a checked pin/);
  assert.deepEqual(runs(fixture), []);
  const recorded = parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true });
  assert.deepEqual(recorded.mutants.map((m) => [m.criterion, m.caught]), [["AC1 a reads one", "yes"]]);
});

test("the record runs on the host config the call selected, so a sealed file reads its true verdict", () => {
  const digest = (text) => crypto.createHash("sha256").update(text).digest("hex");
  const seal = "'use strict';\nconst fs = require('fs');\nconst crypto = require('crypto');\nfs.rmSync('manifest.txt');\n" +
    "fs.appendFileSync('manifest.txt', crypto.createHash('sha256').update(fs.readFileSync('defs/value.txt')).digest('hex') + '  defs/value.txt\\n');\n";
  // Red on a stale digest only, as a host's loader refuses a whole pack: it never reads the value.
  const check = "'use strict';\nconst fs = require('fs');\nconst crypto = require('crypto');\nconst [sum] = fs.readFileSync('manifest.txt', 'utf8').split('  ');\n" +
    "const ok = crypto.createHash('sha256').update(fs.readFileSync('defs/value.txt')).digest('hex') === sum;\n" +
    "console.log(ok ? '# pass 1' : '# fail 1');\nprocess.exit(ok ? 0 : 1);\n";
  const sealed = `${CONFIG}mutate:\n  sealed:\n    - paths: ["defs/**"]\n      reseal: "node seal.cjs"\n`;
  const fixture = mutantRepo({
    files: {
      "defs/value.txt": "1\n", "manifest.txt": `${digest("1\n")}  defs/value.txt\n`, "seal.cjs": seal, "checks/sealed.cjs": check,
      ".specs-inferno/config.sealed.yaml": sealed,
    },
  });
  const value = proposal(1, { file: "defs/value.txt", find: "1", replace: "2" }).replace(/test: .*\n/, "test: node checks/sealed.cjs\n");
  write(fixture.root, REVIEW, "item: a-one\nverdict: clean\nfiles: [defs/value.txt]\n" + `mutants:\n${value}`);

  const result = record(fixture, ["--config", ".specs-inferno/config.sealed.yaml"]);

  assert.equal(result.code, 2, shown(result));
  const recorded = parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true });
  assert.deepEqual(recorded.mutants.map((m) => m.caught), ["no"], "resealed, the test that never reads the value stays green");
  assert.equal(read(fixture.root, "manifest.txt"), `${digest("1\n")}  defs/value.txt\n`, "the seal is put back byte for byte");
  assert.equal(git(fixture.root, ["status", "--porcelain"]), "");
});

test("on a tree a sibling dirtied, the review is recorded without verdicts and its proposals stay owed", () => {
  const fixture = mutantRepo();
  write(fixture.root, "docs/b.md", "a-two is mid-build\n");
  write(fixture.root, REVIEW, withMutants(CAUGHT_ONE, SURVIVES_TWO));

  const result = record(fixture);

  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /no mutant ran: the tree holds uncommitted work in docs\/b\.md, so 2 proposals stay owed to the intent review/);
  assert.deepEqual(runs(fixture), [], "no proposal ran beside the sibling's work");
  assert.equal(read(fixture.root, "docs/b.md"), "a-two is mid-build\n");
  assert.match(git(fixture.root, ["status", "--porcelain"]), /^M docs\/b\.md$/, "the sibling's work is all that is uncommitted");
  const recorded = parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true });
  assert.equal(recorded.verdict, "clean");
  assert.deepEqual(recorded.mutants.map((m) => [m.criterion, m.line, m.caught]), [["1", "1", undefined], ["2", "2", undefined]]);
});

test("a batch that could not put every file back stops the record, and nothing is recorded", () => {
  const fixture = mutantRepo();
  const before = ledger(fixture);
  const head = git(fixture.root, ["rev-parse", "HEAD"]);
  // A test that stages the file it reads: the restore then checks the mutant out of the index again.
  const body = withMutants(CAUGHT_ONE.replace("test: node", "test: git add src/a.ts && node"));
  write(fixture.root, REVIEW, body);

  const result = record(fixture);

  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /ERROR \[MUTATE_RESTORE\] the runner's mutants could not put every file back: .*src\/a\.ts.*Nothing is recorded/);
  assert.equal(ledger(fixture), before, "the ledger holds no review");
  assert.equal(git(fixture.root, ["rev-parse", "HEAD"]), head, "nothing is committed");
  assert.equal(read(fixture.root, REVIEW), body, "the reviewer's file is as it wrote it");
});

test("a record the runner already wrote once is recorded again from its proposals", () => {
  const fixture = mutantRepo();
  write(fixture.root, REVIEW, withMutants(CAUGHT_ONE, SURVIVES_TWO));
  assert.equal(record(fixture).code, 2);
  runs(fixture);
  // A record cut off after the runner wrote the file and before the ledger took it.
  const written = read(fixture.root, REVIEW).replace(/^(tree|commit|reviewer): .*\n/gm, "");
  git(fixture.root, ["reset", "-q", "--hard", "HEAD~1"]);
  write(fixture.root, REVIEW, written);
  const again = record(fixture);
  assert.equal(again.code, 2, shown(again));
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/two.expect"]);
  const recorded = parseItemReview(fixture.root, REVIEW, "a-one", { recorded: true });
  assert.equal(recorded.findings.length, 1, "the survivor finding is written once");
  assert.ok(fs.existsSync(path.join(fixture.root, REVIEW)));
});
