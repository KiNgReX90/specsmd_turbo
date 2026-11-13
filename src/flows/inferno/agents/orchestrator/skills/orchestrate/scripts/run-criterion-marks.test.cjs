const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const { REVIEW, itemReview, runs } = require("./run-review-mutants-fixture.cjs");
const { CONFIG, git, run, write } = require("./review-fixture.cjs");
const { GATE, MARKED, SPEC, aOne, intentReview, itemReviewed, lint, planned, shown } = require("./run-criterion-marks-fixture.cjs");
const { itemProofs, mutantGaps } = require("./run-mutant-coverage.cjs");
const { gateCommand, gateHeld, gateMark } = require("./run-criterion-marks.cjs");
const { tempDir } = require("./test-temp.cjs");

// A criterion no mutant can turn red carries a gate mark on its own line, `(gate: <name>)`: the
// command of verification.finalize or the lane the gate proves it with. It owes no mutant, it
// keeps its number, and the plan lint holds the name to the config. A mark the item's review
// did not see when it was planned counts only from a commit of its spec alone.

test("a criterion marked with a gate command owes no mutant, and one the config does not hold is refused by the plan lint", () => {
  const { fixture, tree } = planned();
  const clean = lint(fixture, tree);
  assert.equal(clean.code, 0, shown(clean));
  assert.match(clean.out, /^clean alpha: 2 open items, 1 criteria$/m);
  itemReviewed(fixture, tree);
  runs(fixture);

  const result = intentReview(fixture, tree);

  assert.equal(result.code, 0, shown(result));
  assert.match(result.out, /intent review clean, recorded/);
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/a2.expect"], "criterion 3's mutant still counts for criterion 3");

  write(tree, SPEC, aOne(`the size cap holds on every file (gate: echo nothing)`));
  const refused = lint(fixture, tree);
  assert.equal(refused.code, 2, shown(refused));
  assert.deepEqual(refused.out.split("\n").filter((line) => line.startsWith("FINDING ")), [
    "FINDING a-one: acceptance criterion 2 is marked (gate: echo nothing), which the config's verification block does not hold: " +
      "name a command of verification.finalize, verbatim or as its rest after verification.session.match, or a lane the config sets as verification.<lane>",
  ]);
});

test("the same criterion without the mark still owes its mutant", () => {
  const { fixture, tree } = planned("the size cap holds on every file (`scripts/size.sh`)");
  itemReviewed(fixture, tree);

  const result = intentReview(fixture, tree);

  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, /a-one owes a caught mutant or a checked pin for criteria 2 "the size cap holds on every file \(`scripts\/size\.sh`\)"\./);
});

test("a mark added after the item's review in a commit that is not its spec's alone counts for nothing", () => {
  const { fixture, tree } = planned("the size cap holds on every file (`scripts/size.sh`)");
  itemReviewed(fixture, tree);
  write(tree, SPEC, aOne());
  write(tree, "docs/b.md", "the notes moved too\n");
  git(tree, ["commit", "-qam", "a mark beside other work"]);

  const result = intentReview(fixture, tree);

  assert.equal(result.code, 2, shown(result));
  assert.match(result.err, new RegExp("a-one owes a caught mutant or a checked pin for criteria 2 \"the size cap holds on every file \\(gate: echo gate ran\\)\" " +
    "\\(its gate mark came after the item's first review, outside a commit of its spec alone\\)\\."));
});

test("a mark the orchestrator adds after the item's review in a commit of its spec alone counts", () => {
  const { fixture, tree } = planned("the size cap holds on every file (`scripts/size.sh`)");
  itemReviewed(fixture, tree);
  write(tree, SPEC, aOne());
  git(tree, ["commit", "-qm", "criterion 2 is proven at the gate", "--", SPEC]);

  const result = intentReview(fixture, tree);

  assert.equal(result.code, 0, shown(result));
});

test("a mark that arrives in the commit that first records the item's review counts for nothing", () => {
  const { tree } = planned("the size cap holds on every file (`scripts/size.sh`)");
  write(tree, SPEC, aOne());
  write(tree, REVIEW, itemReview(""));
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a review and a mark together"]);

  const proofs = itemProofs(tree, "alpha", ["a-one"]);

  assert.deepEqual(proofs[0].late, [1]);
  assert.deepEqual(mutantGaps(proofs, [{ criterion: "a-one:1", caught: "yes" }, { criterion: "a-one:3", caught: "yes" }]), [
    `a-one owes a caught mutant or a checked pin for criteria 2 "${MARKED}" (its gate mark came after the item's first review, outside a commit of its spec alone)`,
  ]);
  write(tree, REVIEW, itemReview("", "fix"));
  git(tree, ["commit", "-qam", "a later review"]);
  assert.deepEqual(itemProofs(tree, "alpha", ["a-one"])[0].late, [1], "the first review decides, not the latest");
});

test("an item without a mark reads no history, so it counts as before even outside git", () => {
  const root = path.join(tempDir("inferno-marks-plain-"), "app");
  write(root, SPEC, aOne("the size cap holds on every file (`scripts/size.sh`)"));
  const proofs = itemProofs(root, "alpha", ["a-one"]);
  assert.deepEqual(proofs[0].late, []);
  assert.deepEqual(mutantGaps(proofs, []).length, 1);
});

test("a mark not yet committed after the item's review counts for nothing, and one planned before it counts", () => {
  const { fixture, tree } = planned();
  itemReviewed(fixture, tree);
  assert.deepEqual(itemProofs(tree, "alpha", ["a-one"])[0].late, [], "planned before the review");

  write(tree, SPEC, aOne().replace("a reads one (`checks/one.expect`)", "a reads one (gate: echo gate ran)"));

  assert.deepEqual(itemProofs(tree, "alpha", ["a-one"])[0].late, [0]);
});

test("an item with no review recorded yet takes its marks as planned", () => {
  const { tree } = planned("the size cap holds on every file (`scripts/size.sh`)");
  write(tree, SPEC, aOne());

  assert.deepEqual(itemProofs(tree, "alpha", ["a-one"])[0].late, []);
});

test("mutantGaps leaves a marked criterion out and keeps every number, a mutant on it changes nothing", () => {
  const item = { id: "a-one", tested: true, criteria: ["one", "two (gate: npm run check)", "three"], mutants: [], pins: [] };
  assert.deepEqual(mutantGaps([item], [{ criterion: "a-one:3", caught: "yes" }]), ['a-one owes a caught mutant or a checked pin for criteria 1 "one"']);
  assert.deepEqual(mutantGaps([item], [{ criterion: "a-one:1", caught: "yes" }, { criterion: "a-one:3", caught: "yes" }]), []);
  assert.deepEqual(mutantGaps([item], ["a-one:1", "a-one:2", "a-one:3"].map((criterion) => ({ criterion, caught: "yes" }))), []);
  assert.deepEqual(mutantGaps([{ ...item, late: [1] }], [{ criterion: "a-one:1", caught: "yes" }, { criterion: "a-one:2", caught: "yes" }, { criterion: "a-one:3", caught: "yes" }]), [],
    "a late mark with its own caught mutant owes nothing");
});

test("a gate mark is read from the end of the criterion's own line only", () => {
  assert.equal(gateMark("compiles on the lane (gate: verification.windows)"), "verification.windows");
  assert.equal(gateMark("(gate: npm run check)"), "npm run check");
  assert.equal(gateMark("a lint passes (gate:   `npm run lint`  )"), "npm run lint");
  assert.equal(gateMark("runs (gate: node -e \"f()\")"), "node -e \"f()\"");
  assert.equal(gateMark("a lint passes (gate: npm run lint) on the base"), null);
  assert.equal(gateMark("a lint passes(gate: npm run lint)"), null);
  assert.equal(gateMark("a lint passes (gate: )"), null);
  assert.equal(gateMark("a lint passes (`npm run lint`)"), null);
});

test("a mark names a command of verification.finalize or a lane the config sets", () => {
  const config = {
    verification: {
      finalize: ["npm run check", "cargo test"],
      integrate: ["npm run quick"],
      lint: ["npm run lint"],
      windows: { command: "npm run test:windows", scope: ["src/**"] },
    },
  };
  const held = (names, under) => names.filter((name) => gateHeld(under, name));
  const names = ["npm run check", "cargo test", "verification.windows", "npm run quick", "npm run lint", "verification.lint", "verification.smoke"];
  assert.deepEqual(held(names, config), ["npm run check", "cargo test", "verification.windows"]);
  assert.deepEqual(held(names, { verification: { smoke: { command: "npm run smoke", scope: ["src/**"] } } }), ["verification.smoke"]);
  assert.deepEqual(held(names, {}), []);
});

test("a finalize command is named verbatim, or by its rest after the session's match, and the verbatim one wins", () => {
  const session = { match: "^remote \\S+ ", open: "o", run: "r", close: "c" };
  const wrapped = { verification: { finalize: ["remote /t npm run check", "cargo test"], session } };
  assert.equal(gateCommand(wrapped, "npm run check"), "remote /t npm run check");
  assert.equal(gateCommand(wrapped, "remote /t npm run check"), "remote /t npm run check");
  assert.equal(gateCommand(wrapped, "cargo test"), "cargo test");
  assert.equal(gateCommand(wrapped, "/t npm run check"), null, "the rest is read after the whole match");
  assert.equal(gateCommand(wrapped, "npm run lint"), null);
  assert.equal(gateCommand({ verification: { finalize: ["x remote /t npm run check"], session } }, "npm run check"), null, "the match reaches only at the start");
  assert.equal(gateCommand({ verification: { finalize: wrapped.verification.finalize } }, "npm run check"), null, "no session, no rest");
  assert.equal(gateCommand({ verification: { finalize: ["remote /t npm run check", "npm run check"], session } }, "npm run check"), "npm run check");
  assert.equal(gateCommand({ verification: { session } }, "npm run check"), null);
  assert.equal(gateHeld(wrapped, "npm run check"), true);
  assert.equal(gateHeld({ verification: { finalize: wrapped.verification.finalize } }, "npm run check"), false);
});

// A host config may put its wrapper in front of every finalize command; the plan still names the
// bare command, the rest the session's match leaves, and the lint reads it so under that config.
const WRAP = "tools/remote.sh /trees/alpha";
const SESSION = "  session:\n    match: '^tools/remote\\.sh \\S+ '\n    open: tools/remote.sh open\n" +
  "    run: tools/remote.sh run\n    close: tools/remote.sh close\n";
const wrappedConfig = (session) => CONFIG.replace("verification:\n", `verification:\n  finalize:\n    - ${WRAP} ${GATE}\n${session}`);
const findings = (result) => result.out.split("\n").filter((line) => line.startsWith("FINDING "));
const unheld = (name) => `FINDING a-one: acceptance criterion 2 is marked (gate: ${name}), which the config's verification block does not hold: ` +
  "name a command of verification.finalize, verbatim or as its rest after verification.session.match, or a lane the config sets as verification.<lane>";

test("under wrapped finalize commands the session's match reaches, the plan lint accepts a bare mark and a verbatim one", () => {
  const { fixture, tree } = planned();
  write(tree, ".specs-inferno/config.yaml", wrappedConfig(SESSION));
  const bare = lint(fixture, tree);
  assert.equal(bare.code, 0, shown(bare));

  write(tree, SPEC, aOne(`the size cap holds on every file (gate: ${WRAP} ${GATE})`));
  const verbatim = lint(fixture, tree);
  assert.equal(verbatim.code, 0, shown(verbatim));

  write(tree, SPEC, aOne("the size cap holds on every file (gate: echo nothing)"));
  const neither = lint(fixture, tree);
  assert.equal(neither.code, 2, shown(neither));
  assert.deepEqual(findings(neither), [unheld("echo nothing")]);
});

test("under wrapped finalize commands with no session key, the plan lint refuses a bare mark as before", () => {
  const { fixture, tree } = planned();
  write(tree, ".specs-inferno/config.yaml", wrappedConfig(""));
  const result = lint(fixture, tree);
  assert.equal(result.code, 2, shown(result));
  assert.deepEqual(findings(result), [unheld(GATE)]);
});

test("a host config that wraps its commands lets the plan lint read a bare mark through the session it inherits", () => {
  const { fixture, tree } = planned();
  const base = CONFIG.replace("verification:\n", `verification:\n  finalize:\n    - ${GATE}\n${SESSION}`);
  write(tree, ".specs-inferno/config.yaml", base);
  write(tree, ".specs-inferno/config.host.yaml", wrappedConfig(""));
  const host = run(fixture, ["plan-lint", "alpha", "--tree", tree, "--config", ".specs-inferno/config.host.yaml"]);
  assert.equal(host.code, 0, shown(host));

  write(tree, ".specs-inferno/config.yaml", CONFIG.replace("verification:\n", `verification:\n  finalize:\n    - ${GATE}\n`));
  const unwrapped = run(fixture, ["plan-lint", "alpha", "--tree", tree, "--config", ".specs-inferno/config.host.yaml"]);
  assert.equal(unwrapped.code, 2, shown(unwrapped));
  assert.deepEqual(findings(unwrapped), [unheld(GATE)]);
});

test("the config example says a gate mark may name the rest its documented match leaves", () => {
  const example = require("node:fs").readFileSync(path.join(__dirname, "../../../config.example.yaml"), "utf8");
  const line = example.split("\n").find((entry) => entry.startsWith("  #   match: "));
  assert.match(line, /the rest of the command is the check the session runs, and a gate mark may name it$/);
  const match = /^ {2}# {3}match: '(.+?)'/.exec(line)[1];
  const config = { verification: { finalize: ["tools/remote-test.sh . npm test"], session: { match } } };
  assert.equal(gateCommand(config, "npm test"), "tools/remote-test.sh . npm test");
});
