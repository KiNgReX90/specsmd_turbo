const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, git, intentReviewed, run, write } = require("./review-fixture.cjs");
const { INTENT_REVIEW } = require("./run-review-mutants-fixture.cjs");
const { FIRST_AND_THIRD, GATE, MARKED, SPEC, UNMARKED, aOne, intentReview, itemReviewed, lint, planned, shown } = require("./run-criterion-marks-fixture.cjs");
const lib = require("./run-lib.cjs");
const { itemProofs, mutantGaps } = require("./run-mutant-coverage.cjs");
const { proofOwed } = require("./run-review-aside.cjs");

// Every gate mark the mutant coverage counts is held to the config the command runs with, on a
// completed item as on an open one. The plan lint reads an open item only, so a mark added to a
// completed item's criterion in a commit of its spec alone, naming a command the gate never runs,
// is refused where the coverage reads it: at the intent review's record, and at every reader of a
// recorded review (the review call, the gate, green and through it the ship).

const NAME = "npm run typecheck";
const FALSE = `the size cap holds on every file (gate: ${NAME})`;
const HOST = ".specs-inferno/config.host.yaml";
const UNHELD = `a-one owes a caught mutant or a checked pin for criteria 2 "${FALSE}" (its gate mark names ${NAME}, ` +
  "which the config's verification block does not hold: correct the mark in a commit of its spec alone, or prove the criterion)";
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const caught = [{ criterion: "a-one:1", caught: "yes" }, { criterion: "a-one:3", caught: "yes" }];

/** The ledger with a-one completed, committed. */
function completed(tree) {
  const rel = ".specs-inferno/state.yaml";
  const text = fs.readFileSync(path.join(tree, rel), "utf8");
  const next = text.replace("        status: pending\n", "        status: completed\n");
  assert.notEqual(next, text);
  write(tree, rel, next);
  git(tree, ["commit", "-qm", "a-one completed", "--", rel]);
}

/** a-one reviewed and completed, then its criterion 2 marked with `name` in a commit of its spec alone. */
function markedAfter(name = NAME) {
  const { fixture, tree } = planned(UNMARKED);
  itemReviewed(fixture, tree);
  completed(tree);
  write(tree, SPEC, aOne(`the size cap holds on every file (gate: ${name})`));
  git(tree, ["commit", "-qm", "criterion 2 is proven at the gate", "--", SPEC]);
  return { fixture, tree };
}

/** A host config beside the default one whose finalize list holds the name too, committed. */
function hostConfig(tree) {
  write(tree, HOST, CONFIG.replace("verification:\n", `verification:\n  finalize:\n    - ${GATE}\n    - ${NAME}\n`));
  git(tree, ["add", "--", HOST]);
  git(tree, ["commit", "-qm", "a host config", "--", HOST]);
}

test("a clean intent review over a completed item's mark that names no command of the config is refused with that name", () => {
  const { fixture, tree } = markedAfter();
  const linted = lint(fixture, tree);
  assert.equal(linted.code, 0, `the plan lint reads no completed item: ${shown(linted)}`);

  const result = intentReview(fixture, tree);

  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, new RegExp(`${escaped(UNHELD)}\\. Propose one mutant for each under mutants`));
  assert.equal(git(tree, ["status", "--porcelain", "--", INTENT_REVIEW]), `?? ${INTENT_REVIEW}`, "nothing is recorded");
});

test("a completed item's mark the config holds counts as before", () => {
  const { fixture, tree } = markedAfter(GATE);
  const result = intentReview(fixture, tree);
  assert.equal(result.code, 0, shown(result));
});

test("the record reads the config it runs with, and every reader of the recorded review holds it to the config it runs with", () => {
  const { fixture, tree } = markedAfter();
  hostConfig(tree);
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, FIRST_AND_THIRD);

  const recorded = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1", "--config", HOST]);
  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(recorded.out, /intent review clean, recorded/);

  const held = run(fixture, ["green", "--tree", tree, "--config", HOST]);
  assert.doesNotMatch(shown(held), /intent review owed/, shown(held));

  const green = run(fixture, ["green", "--tree", tree]);
  assert.equal(green.code, 3, shown(green));
  assert.match(green.out, new RegExp(`^intent review owed: ${escaped(INTENT_REVIEW)}: verdict clean while ${escaped(UNHELD)}\\. ` +
    "Propose one mutant for each under mutants, .*send this back to the reviewer that wrote the file, then run \\S*run\\.cjs review --reviewer <agent-id> \\S+ \\S+ to record it\\.$", "m"));

  const gate = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gate.code, 3, shown(gate));
  assert.match(gate.out, new RegExp(`^intent review owed: .*${escaped(UNHELD)}`, "m"));
  assert.match(gate.out, /^run \S*run\.cjs review --reviewer <agent-id> \S+ \S+ first, then gate again$/m);

  write(tree, SPEC, aOne(MARKED));
  git(tree, ["commit", "-qm", "criterion 2 names the command that proves it", "--", SPEC]);
  const corrected = run(fixture, ["green", "--tree", tree]);
  assert.doesNotMatch(shown(corrected), /intent review owed/, "a mark corrected in a commit of its spec alone closes it");
});

test("a fix review whose every finding is deferred owes its reviewer for a false mark under the config the call runs with", () => {
  const { fixture, tree } = markedAfter();
  hostConfig(tree);
  write(tree, ".specs-inferno/intents/alpha/later.md", "- src/a.ts:2 waits\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the findings after the release"]);
  const mutants = caught.map((entry) => `  - criterion: ${entry.criterion}\n    test: node checks/has.cjs\n    caught: yes\n`).join("");
  intentReviewed(tree, "alpha", "verdict: fix\nfindings: []\nmutants:\n" + mutants + "deferred:\n" +
    "  - criterion: a-one:2\n    file: src/a.ts\n    line: 2\n    evidence: e\n    fix: f\n    severity: major\n    owner: a-one\n" +
    "    to: later.md\n    reason: after the release\n");

  const owes = `every open finding is deferred, and ${UNHELD}; propose a mutant or a pin for each`;
  const review = { verdict: "fix", findings: [], survivors: [], mutants: caught, pins: [], deferred: [] };
  assert.equal(proofOwed(tree, "alpha", review, lib.readConfig(tree, HOST)), null);
  assert.equal(proofOwed(tree, "alpha", review), owes, "with no config given, the tree's own config is read");

  const green = run(fixture, ["green", "--tree", tree]);
  assert.match(green.out, new RegExp(`^intent review owed: ${escaped(owes)}$`, "m"), shown(green));
  const held = run(fixture, ["green", "--tree", tree, "--config", HOST]);
  assert.match(held.out, /^intent review owed: the review says fix and its findings are not fixed$/m, shown(held));

  const call = run(fixture, ["review", "--tree", tree]);
  assert.equal(call.code, 3, shown(call));
  assert.match(shown(call), new RegExp(escaped(NAME)));
  const current = run(fixture, ["review", "--tree", tree, "--config", HOST]);
  assert.equal(current.code, 2, shown(current));
  assert.match(current.out, /^intent review fix for the current tree/m);
});

test("a late mark keeps its own reading, and an item with no test owes nothing for a mark", () => {
  const item = { id: "a-one", tested: true, criteria: ["one", FALSE, "three"], mutants: [], pins: [] };
  assert.deepEqual(mutantGaps([{ ...item, unheld: [1] }], caught), [UNHELD]);
  assert.deepEqual(mutantGaps([{ ...item, late: [1], unheld: [1] }], caught), [
    `a-one owes a caught mutant or a checked pin for criteria 2 "${FALSE}" (its gate mark came after the item's first review, outside a commit of its spec alone)`,
  ]);
  assert.deepEqual(mutantGaps([{ ...item, unheld: [1] }], [...caught, { criterion: "a-one:2", caught: "yes" }]), [], "a caught mutant proves it");
  assert.deepEqual(mutantGaps([{ ...item, tested: false, unheld: [1] }], []), []);
  assert.deepEqual(mutantGaps([item], caught), [], "an item read before this check counts its mark as before");
});

test("itemProofs lists the marks the config does not hold, leaves out a late one, and reads the tree's config when given none", () => {
  const { tree } = markedAfter();
  assert.deepEqual(itemProofs(tree, "alpha", ["a-one"])[0].unheld, [1]);
  assert.deepEqual(itemProofs(tree, "alpha", ["a-one"], lib.readConfig(tree))[0].unheld, [1]);
  hostConfig(tree);
  assert.deepEqual(itemProofs(tree, "alpha", ["a-one"], lib.readConfig(tree, HOST))[0].unheld, []);

  write(tree, SPEC, aOne(FALSE).replace("a reads one (`checks/one.expect`)", "a reads one (gate: echo other)"));
  write(tree, "docs/b.md", "the notes moved too\n");
  git(tree, ["commit", "-qam", "a mark beside other work"]);
  const proofs = itemProofs(tree, "alpha", ["a-one"], lib.readConfig(tree, HOST));
  assert.deepEqual([proofs[0].late, proofs[0].unheld], [[0], []], "a late mark is late, never unheld");
});
