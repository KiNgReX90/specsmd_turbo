const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { git, run, worktree, INTENT_TREE, write } = require("./review-fixture.cjs");
const {
  A_EDITABLE, A_ONE, INTENT_REVIEW, REVIEW, itemSpec, mutantRepo, proposal, record, runs, withMutants,
} = require("./run-review-mutants-fixture.cjs");
const { proofOwed } = require("./run-review-aside.cjs");
const { commentMarker } = require("./run-review-file.cjs");
const { parseIntentReview } = require("./run-intent-review-file.cjs");
const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");

// The schema of the two set-aside lists, and the recorder's refusal of a mutant on a comment line.

const REL = ".specs-inferno/intents/alpha/review.yaml";
const RECORDED = "tree: abc\ncommit: def\n";
const PROOFS = [{ id: "a-one", criteria: ["a reads one", "a2 reads two"], tested: true, tests: [], mutants: [{ criterion: "1", caught: "yes" }], pins: [] }];

function reviewDir(body, files = {}) {
  const tree = tempDir("inferno-aside-");
  for (const [rel, text] of Object.entries({ [REL]: body, ...files })) {
    fs.mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
    writeFile(path.join(tree, rel), text, "utf8");
  }
  return tree;
}

const parse = (tree, proofs = []) => parseIntentReview(tree, REL, { recorded: true, items: ["a-one"], scanIds: [], proofs });

const deferredEntry = (extra = "", to = "later.md") => "  - criterion: a-one:2\n    file: src/a.ts\n    line: 2\n    evidence: e\n    fix: f\n" +
  `    severity: major\n    owner: a-one\n${extra}    to: ${to}\n    reason: after the release\n`;
const SURVIVOR = "    mutant: a-one:2\n    find: a2 = 2\n    replace: a2 = 8\n    test: npm test\n    caught: no\n";
const LATER = { ".specs-inferno/intents/alpha/later.md": "- src/a.ts:2 waits\n" };

test("a review recorded under the released flow, with neither list, reads as before", () => {
  const body = "verdict: fix\nfindings:\n  - criterion: a-one:1\n    file: src/a.ts\n    line: 1\n    evidence: e\n    fix: f\n    severity: minor\n" +
    "    owner: a-one\nmutants:\n  - criterion: a-one:1\n    test: npm test\n    caught: yes\n";
  const review = parse(reviewDir(`${body}${RECORDED}`));
  assert.deepEqual([review.verdict, review.findings.length, review.mutants.length, review.withdrawn, review.deferred], ["fix", 1, 1, [], []]);
});

test("a deferred survivor answers its criterion, and a withdrawn mutant never does", () => {
  const owed = /a-one owes a caught mutant or a checked pin for criteria 2 "a2 reads two"/;
  assert.throws(() => parse(reviewDir(`verdict: clean\n${RECORDED}`), PROOFS), owed);
  const answered = parse(reviewDir(`verdict: clean\ndeferred:\n${deferredEntry(SURVIVOR)}${RECORDED}`, LATER), PROOFS);
  assert.equal(answered.deferred.length, 1);
  const other = deferredEntry(SURVIVOR.replace("a-one:2", "a-two:2"));
  assert.throws(() => parse(reviewDir(`verdict: clean\ndeferred:\n${other}${RECORDED}`, LATER), PROOFS), owed, "a survivor of another item answers nothing here");
  assert.throws(() => parse(reviewDir(`verdict: clean\ndeferred:\n${deferredEntry()}${RECORDED}`, LATER), PROOFS), owed, "a finding answers no criterion");
  const withdrawn = "withdrawn:\n  - criterion: a-one:2\n    file: src/a.ts\n    line: 2\n    find: a2 = 2\n    replace: \"\"\n    test: npm test\n" +
    "    caught: yes\n    reason: a mistake\n";
  assert.throws(() => parse(reviewDir(`verdict: clean\n${withdrawn}${RECORDED}`), PROOFS), owed);
  assert.equal(parse(reviewDir(`verdict: fix\nfindings:\n${deferredEntry().replace(/ {4}to: .*\n {4}reason: .*\n/, "")}${withdrawn}${RECORDED}`)).withdrawn[0].replace, "");
});

test("a deferred entry is held to its to file and to the mutant it carries", () => {
  for (const [entry, files, pattern] of [
    [deferredEntry(), {}, /deferred entry 1 to names later\.md, which is no file in .*\.specs-inferno\/intents\/alpha; write the findings/],
    [deferredEntry(), { ".specs-inferno/intents/alpha/later.md": "- src/a.ts:3\n" }, /deferred entry 1 to names later\.md, which does not name src\/a\.ts:2/],
    [deferredEntry("", "../../state.yaml"), {}, /deferred entry 1 to names \.\.\/\.\.\/state\.yaml; name a file in the intent folder/],
    [deferredEntry(SURVIVOR.replace(/ {4}find: .*\n/, "")), LATER, /deferred entry 1 carries mutant a-one:2 without the mutant as recorded: find, replace, test and caught: no/],
    [deferredEntry(SURVIVOR.replace(/ {4}test: .*\n/, "")), LATER, /carries mutant a-one:2 without the mutant as recorded/],
    [deferredEntry(SURVIVOR.replace(/ {4}replace: .*\n/, "")), LATER, /carries mutant a-one:2 without the mutant as recorded/],
    [deferredEntry(SURVIVOR.replace("caught: no", "caught: yes")), LATER, /carries mutant a-one:2 without the mutant as recorded/],
    [deferredEntry().replace(/ {4}reason: .*\n/, ""), LATER, /deferred entry 1 has no reason/],
    [deferredEntry().replace("    owner: a-one\n", "    owner: a-one\n    note: x\n"), LATER, /unknown key note in deferred entry 1/],
  ]) {
    assert.throws(() => parse(reviewDir(`verdict: clean\ndeferred:\n${entry}${RECORDED}`, files)), pattern);
  }
  assert.equal(parse(reviewDir(`verdict: clean\ndeferred:\n${deferredEntry("", "./later.md")}${RECORDED}`, LATER)).deferred.length, 1);
});

test("a fix review owes its reviewer for a proof only when every finding is deferred and a criterion still owes one", () => {
  const tree = reviewDir("", { ".specs-inferno/intents/alpha/work-items/a-one.md": itemSpec("a-one", A_ONE, A_EDITABLE) });
  const review = { verdict: "fix", findings: [], survivors: [], mutants: [{ criterion: "a-one:1", caught: "yes" }], pins: [], deferred: [] };
  assert.equal(proofOwed(tree, "alpha", review),
    'every open finding is deferred, and a-one owes a caught mutant or a checked pin for criteria 2 "a2 reads two"; propose a mutant or a pin for each');
  for (const other of [{ verdict: "clean" }, { findings: [{}] }, { survivors: [{}] }, { mutants: [...review.mutants, { criterion: "a-one:2", caught: "yes" }] }]) {
    assert.equal(proofOwed(tree, "alpha", { ...review, ...other }), null);
  }
});

test("the comment markers are told by the file's language, after the indent, and only at the start of the line", () => {
  for (const [file, text, marker] of [
    ["deploy/job.yml", "    # Node alone runs every script in this job.", "#"],
    ["tools/tax.py", "# the rate", "#"],
    ["Makefile", "# build", "#"],
    ["infra/Dockerfile", "  # base image", "#"],
    ["src/store.ts", "  // the total", "//"],
    ["src/main.rs", "/// the store", "//"],
    ["db/report.sql", "-- the totals", "--"],
    ["src/store.TS", "// upper case", "//"],
  ]) {
    assert.equal(commentMarker(file, text), marker, `${file}: ${text}`);
  }
  for (const [file, text] of [
    ["src/store.ts", "const url = 'https://acme.example/cards'; // a link"],
    ["tools/tax.py", "label = \"# not a comment\""],
    ["db/report.sql", "select total from cards -- per card"],
    ["src/lib.rs", "#[derive(Debug)]"],
    ["src/main.c", "#include <stdio.h>"],
    ["docs/guide.md", "# Heading"],
    ["src/store.ts", "x = a -- b"],
    ["tools/tax.py", "// floor division is //"],
    ["notes", "# no extension"],
    ["src/constructor", "# a name an object knows"],
  ]) {
    assert.equal(commentMarker(file, text), null, `${file}: ${text}`);
  }
});

const PY = "# the rate the shop charges\nRATE = 2\n";

test("an item review's proposal on a comment line is refused by file and line before anything runs", () => {
  const fixture = mutantRepo({ files: { "tools/tax.py": PY, "checks/tax.expect": "tools/tax.py RATE = 2\n" } });
  const tax = (line, find, replace) => proposal(2, { file: "tools/tax.py", line, find, replace, expect: "checks/tax.expect" });
  write(fixture.root, REVIEW, withMutants(proposal(1), tax(1, "rate", "fee")));
  const refused = record(fixture);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /mutants entry 2 breaks tools\/tax\.py:1, a line that opens with the comment marker #, so no test can tell; propose a mutant on a line that runs/);
  assert.deepEqual(runs(fixture), []);
  for (const [entry, pattern] of [
    [proposal(2, { file: "tools/gone.py", find: "x", replace: "y" }), /tools\/gone\.py is not a committed file/],
    [tax(9, "RATE", "FEE"), /line 9 is not a line of tools\/tax\.py/],
  ]) {
    write(fixture.root, REVIEW, withMutants(proposal(1), entry));
    const result = record(fixture);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, pattern);
  }
  write(fixture.root, REVIEW, withMutants(proposal(1), tax(2, "RATE = 2", "RATE = 3")));
  assert.equal(record(fixture).code, 0);
});

test("an intent review's proposal on a comment line is refused by file and line", () => {
  const fixture = mutantRepo({ files: { "tools/tax.py": PY } });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "scan"]);
  write(tree, REVIEW, withMutants(proposal(1)));
  assert.equal(record(fixture, [], tree).code, 0);
  runs(fixture);
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, `verdict: clean\nmutants:\n${proposal("a-one:2", { file: "tools/tax.py", line: 1, find: "rate", replace: "fee" })}`);
  const result = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /mutants entry 1 breaks tools\/tax\.py:1, a line that opens with the comment marker #/);
  assert.deepEqual(runs(fixture), []);
});
