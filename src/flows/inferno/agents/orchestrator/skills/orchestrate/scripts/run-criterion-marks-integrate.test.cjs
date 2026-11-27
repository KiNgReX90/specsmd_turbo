const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, git, run, write } = require("./review-fixture.cjs");
const { INTENT_REVIEW } = require("./run-review-mutants-fixture.cjs");
const { SPEC, aOne, intentReview, itemReviewed, lint, planned, shown } = require("./run-criterion-marks-fixture.cjs");
const lib = require("./run-lib.cjs");
const { itemProofs } = require("./run-mutant-coverage.cjs");
const { withMarks } = require("./run-gate-marks.cjs");
const { caller } = require("./run-call.cjs");
const { gateCommand, gateHeld, integrateCommand } = require("./run-criterion-marks.cjs");
const { tempDir } = require("./test-temp.cjs");

// A host may keep a check in verification.integrate and out of finalize, by design: integrate runs
// it at every landing and refuses a red one. A criterion that only that check proves takes a gate
// mark naming it, and the mark counts only while integrate's green proof for the tree stands, the
// one `commandProof` finds for that command, config file, scope content and, for a base-scoped
// command, merge base.

const CHECK = "echo integrate ran";
const HOST = ".specs-inferno/config.host.yaml";
const CRITERION = (name) => `the check exits 0 on this branch (gate: ${name})`;
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The gap line of criterion 2 marked with `name` while integrate has no green proof for the tree, as a pattern. */
const pattern = (name) => escaped(`a-one owes a caught mutant or a checked pin for criteria 2 "${CRITERION(name)}" (its gate mark names ${name}, ` +
  "a command of verification.integrate with no green proof for this tree: run ") + "\\S*run\\.cjs integrate --tree \\S+" +
  escaped(" to prove it, or prove the criterion)");
const integrate = (fixture, tree, ...flags) => run(fixture, ["integrate", "--tree", tree, ...flags]);
const record = (fixture, tree) => run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);

/** The plan with a-one's criterion 2 marked with `name`, under the config `change` makes of the fixture's, its item review recorded. */
function host(name = CHECK, change = (text) => text) {
  const { fixture, tree } = planned(CRITERION(name));
  const rel = ".specs-inferno/config.yaml";
  const config = change(fs.readFileSync(path.join(tree, rel), "utf8"));
  write(tree, rel, config);
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "--allow-empty", "-qm", "the host's integrate check"]);
  itemReviewed(fixture, tree);
  return { fixture, tree };
}

test("a criterion an integrate command proves records clean over its green proof for the tree, and is refused without one", () => {
  const { fixture, tree } = host();
  const linted = lint(fixture, tree);
  assert.equal(linted.code, 0, `the plan lint takes a mark that names an integrate command: ${shown(linted)}`);

  const refused = intentReview(fixture, tree);
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, new RegExp(`${pattern(CHECK)}\\. Propose one mutant for each under mutants`));
  assert.equal(git(tree, ["status", "--porcelain", "--", INTENT_REVIEW]), `?? ${INTENT_REVIEW}`, "nothing is recorded");

  const landed = integrate(fixture, tree);
  assert.equal(landed.code, 0, shown(landed));
  assert.match(landed.out, new RegExp(`^PASS \\S+ ${escaped(CHECK)}$`, "m"));
  const recorded = record(fixture, tree);
  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(recorded.out, /intent review clean, recorded/);

  const green = run(fixture, ["green", "--tree", tree]);
  assert.doesNotMatch(shown(green), /intent review owed/, "the commit that records the review keeps the proof it rests on");
  const gated = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gated.code, 0, shown(gated));
  assert.match(gated.out, new RegExp(`^MARKED a-one:2 \\(gate: ${escaped(CHECK)}\\): GREEN, integrate proved it for this tree$`, "m"));

  write(tree, "docs/c.md", "a file inside the check's scope\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a commit inside the scope after the proof"]);
  const moved = run(fixture, ["green", "--tree", tree]);
  assert.equal(moved.code, 3, shown(moved));
  assert.match(moved.out, /^intent review owed: the code changed since the review read it at \w{7}$/m);
  assert.match(moved.out, new RegExp(`^intent review owed: (?:\\S+: )?verdict clean while ${pattern(CHECK)}\\. Propose`, "m"));
  const gate = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gate.code, 3, shown(gate));
  assert.match(gate.out, new RegExp(`^intent review owed: (?:\\S+: )?verdict clean while ${pattern(CHECK)}`, "m"));
  assert.match(gate.out, /^run \S*run\.cjs review --tree \S+ first, then gate again$/m);
});

test("a red integrate run mints no proof, so the mark reads none until a green run", () => {
  const flag = path.join(tempDir("inferno-marks-flag-"), "green");
  const check = `test -f ${flag}`;
  const { fixture, tree } = host(check, (text) => text.replace(CHECK, check));

  const red = integrate(fixture, tree);
  assert.equal(red.code, 2, shown(red));
  const refused = intentReview(fixture, tree);
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, new RegExp(pattern(check)));

  fs.rmSync(path.join(tree, INTENT_REVIEW));
  write(path.dirname(flag), "green", "");
  assert.equal(integrate(fixture, tree).code, 0);
  const clean = intentReview(fixture, tree);
  assert.equal(clean.code, 0, shown(clean));
});

test("a base-scoped integrate command reads no proof once the merge base moved, and the next integrate closes it", () => {
  const { fixture, tree } = host(CHECK, (text) => text.replace("verification:\n", `verification:\n  base_scoped:\n    - ${CHECK}\n`));
  assert.equal(integrate(fixture, tree).code, 0);
  const clean = intentReview(fixture, tree);
  assert.equal(clean.code, 0, shown(clean));
  assert.doesNotMatch(shown(run(fixture, ["green", "--tree", tree])), /intent review owed/, "the record's commit keeps the merge base");

  write(fixture.root, ".specs-inferno/notes.md", "a note on the base\n");
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "the base moves, and no code with it"]);
  git(tree, ["merge", "-q", "--no-edit", "main"]);
  const moved = run(fixture, ["green", "--tree", tree]);
  assert.equal(moved.code, 3, shown(moved));
  assert.match(moved.out, new RegExp(`^intent review owed: ${escaped(INTENT_REVIEW)}: verdict clean while ${pattern(CHECK)}\\.`, "m"));

  assert.equal(integrate(fixture, tree).code, 0);
  assert.doesNotMatch(shown(run(fixture, ["green", "--tree", tree])), /intent review owed/, "integrate at the new base proves it again");
});

test("an integrate command whose scope the branch never touched is skipped, and its mark reads the proof that scope's content already has", () => {
  const scoped = (text) => text.replace("verification:\n", `verification:\n  finalize_scopes:\n    ${CHECK}: ["lib/**"]\n`);
  const { fixture, tree } = host(CHECK, scoped);
  write(fixture.root, ".specs-inferno/config.yaml", scoped(fs.readFileSync(path.join(fixture.root, ".specs-inferno/config.yaml"), "utf8")));
  write(fixture.root, "lib/x.ts", "export const x = 1;\n");
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "the scope on the base"]);
  git(tree, ["merge", "-q", "--no-edit", "main"]);

  const skipped = integrate(fixture, tree);
  assert.equal(skipped.code, 0, shown(skipped));
  assert.match(skipped.out, new RegExp(`^SKIP ${escaped(CHECK)}`, "m"));
  const refused = intentReview(fixture, tree);
  assert.equal(refused.code, 2, "a skip mints no proof");
  assert.match(refused.err, new RegExp(pattern(CHECK)));

  fs.rmSync(path.join(tree, INTENT_REVIEW));
  const base = integrate(fixture, fixture.root);
  assert.equal(base.code, 0, shown(base));
  assert.match(base.out, new RegExp(`^PASS \\S+ ${escaped(CHECK)}$`, "m"));
  const clean = intentReview(fixture, tree);
  assert.equal(clean.code, 0, `the proof the base minted for the same scope content stands: ${shown(clean)}`);
});

/** Run `body` with this process reading the fixture's cache, as the runner it spawns does. */
function inCache(fixture, body) {
  const cache = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = fixture.cache;
  try {
    return body();
  } finally {
    if (cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = cache;
  }
}

test("the proof is read under the config file the call selected", () => {
  const { fixture, tree } = host();
  write(tree, HOST, fs.readFileSync(path.join(tree, ".specs-inferno/config.yaml"), "utf8"));
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "a host config"]);
  assert.equal(integrate(fixture, tree, "--config", HOST).code, 0);

  const unproven = (config) => inCache(fixture, () => itemProofs(tree, "alpha", ["a-one"], config)[0].unproven);
  assert.deepEqual(unproven(lib.readConfig(tree, HOST)), []);
  assert.deepEqual(unproven(lib.readConfig(tree)), [1], "a proof minted under another config file is not this call's");
});

test("a command in both lists reads as a finalize command and needs no integrate proof", () => {
  const { fixture, tree } = host(CHECK, (text) => text.replace("  finalize:\n", `  finalize:\n    - ${CHECK}\n`));
  const result = intentReview(fixture, tree);
  assert.equal(result.code, 0, shown(result));

  const session = { match: "^remote \\S+ ", open: "o", run: "r", close: "c" };
  const both = { verification: { finalize: ["remote /t npm test"], integrate: ["npm test", "npm run lint"], session } };
  assert.equal(gateCommand(both, "npm test"), "remote /t npm test", "the finalize command the rest names wins over a verbatim integrate one");
  assert.equal(integrateCommand(both, "npm test"), null);
  assert.equal(integrateCommand(both, "npm run lint"), "npm run lint");
  const wrapped = { verification: { integrate: ["remote /t npm run lint"], session } };
  assert.equal(integrateCommand(wrapped, "npm run lint"), "remote /t npm run lint", "named by its rest after the session's match");
  assert.equal(integrateCommand({ verification: { integrate: ["remote /t npm run lint"] } }, "npm run lint"), null);
  assert.equal(gateHeld(wrapped, "npm run lint"), true);
  assert.equal(gateHeld(wrapped, "npm run check"), false);
});

test("itemProofs lists an integrate mark with no proof under unproven, and reads no config and no proof for an item with no mark", () => {
  const { fixture, tree } = host();
  inCache(fixture, () => {
    const before = itemProofs(tree, "alpha", ["a-one"])[0];
    assert.deepEqual([before.unheld, before.unproven], [[], [1]]);
    assert.match(before.integrate, /^run\.cjs integrate --tree \S+/);
    assert.equal(integrate(fixture, tree).code, 0);
    assert.deepEqual(itemProofs(tree, "alpha", ["a-one"], lib.readConfig(tree))[0].unproven, []);
  });

  write(tree, ".specs-inferno/config.yaml", `${CONFIG}host: nobody\n`);
  assert.throws(() => itemProofs(tree, "alpha", ["a-one"]), /host in/, "a mark reads the config");
  write(tree, SPEC, aOne("the size cap holds on every file (`scripts/size.sh`)"));
  const plain = itemProofs(tree, "alpha", ["a-one"])[0];
  assert.deepEqual([plain.unheld, plain.unproven], [[], []], "an item with no mark reads no config");
});

test("the gate prints an integrate mark's verdict from integrate's proof for the tree", () => {
  const { fixture, tree } = host();
  caller({});
  const gate = { exit: 0, payload: { ok: true, results: [{ command: "echo gate ran", result: "pass" }] }, out: ["PASS 1s echo gate ran", "green"] };
  const line = () => inCache(fixture, () => withMarks({ tree, intent: "alpha" }, gate).out.find((entry) => entry.startsWith("MARKED ")));
  assert.equal(line(), `MARKED a-one:2 (gate: ${CHECK}): NO PROOF, integrate has no green run of it for this tree: run run.cjs integrate --tree ${tree}`);
  assert.equal(integrate(fixture, tree).code, 0);
  assert.equal(line(), `MARKED a-one:2 (gate: ${CHECK}): GREEN, integrate proved it for this tree`);
});
