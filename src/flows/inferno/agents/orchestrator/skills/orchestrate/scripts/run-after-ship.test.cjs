const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const review = require("./review-fixture.cjs");
const shipping = require("./run-fixture.cjs");
const { parseIntentReview } = require("./run-intent-review-file.cjs");
const { tempDir } = require("./test-temp.cjs");
const { writeFile } = require("./test-write.cjs");

// A success criterion whose instrument runs only once the intent landed on the base branch, such
// as a timer the default branch's checkout runs, is marked `(after ship)` in the brief at plan
// time. The intent review proves it `after_ship`: green does not wait for its evidence, the ship
// prints it as owed, and select lists it until the path exists. An unmarked criterion cannot
// take that way around an evidence file the merge could have waited for.

const COMMAND = "systemctl --user is-active acme-gift-sweep.timer";
const EVIDENCE = ".specs-inferno/intents/alpha/evidence/timer.txt";
const brief = (mark = " (after ship)") => `# Intent: Alpha

## Success Criteria

- SC-1: \`node --test src/a.test.ts\` reports 0 fail
- SC-2: \`${COMMAND}\` reads active on each machine${mark}
`;
const entry = (proof = "after_ship", criterion = "SC-2") =>
  `verdict: clean\ncriteria:\n  - criterion: ${criterion}\n    proof: ${proof}\n    where: ${COMMAND}\n    evidence: ${EVIDENCE}\n`;
const OWED = `owed after ship: ${COMMAND} -> ${EVIDENCE}`;

const REVIEW = ".specs-inferno/intents/alpha/review.yaml";
const BRIEF = ".specs-inferno/intents/alpha/brief.md";

/** An intent worktree whose work and brief are committed and whose reviewer was dispatched. */
function dispatched(mark) {
  const fixture = review.repo();
  const tree = review.worktree(fixture, review.INTENT_TREE);
  review.write(tree, "src/a.ts", "export const a = 3;\n");
  review.write(tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  review.write(tree, BRIEF, brief(mark));
  review.git(tree, ["add", "-A"]);
  review.git(tree, ["commit", "-qm", "the work"]);
  review.run(fixture, ["review", "--tree", tree]);
  return { fixture, tree };
}

const record = (fixture, tree) => review.run(fixture, ["review", "--tree", tree, "--reviewer", "rev-1"]);

test("review records an after_ship entry for a criterion the brief marks (after ship)", () => {
  const { fixture, tree } = dispatched();
  review.write(tree, REVIEW, entry());
  const result = record(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(fs.readFileSync(path.join(tree, REVIEW), "utf8"), /proof: after_ship/);
});

for (const [name, mark, body, reason] of [
  ["a criterion the brief does not mark", "", entry(), /criteria entry 1 is proven after_ship for SC-2, which the brief does not mark \(after ship\)/],
  ["a criterion named by no SC id", " (after ship)", entry("after_ship", "the timer runs"), /names no SC-<n> of the brief/],
  ["an entry with no evidence path", " (after ship)", entry().replace(`    evidence: ${EVIDENCE}\n`, ""), /proven after the ship and names no evidence path/],
]) {
  test(`review refuses an after_ship entry for ${name} and records nothing`, () => {
    const { fixture, tree } = dispatched(mark);
    const before = review.git(tree, ["rev-parse", "HEAD"]);
    review.write(tree, REVIEW, body);
    const result = record(fixture, tree);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, reason);
    assert.equal(review.git(tree, ["rev-parse", "HEAD"]), before);
  });
}

/** The same worktree, its review recorded as run.cjs records one, and the gate passed. */
function gated(body) {
  const config = review.CONFIG.replace("delivery:", "  finalize:\n    - echo gated\ndelivery:");
  const fixture = review.repo({ config });
  const tree = review.worktree(fixture, review.INTENT_TREE);
  review.write(tree, "src/a.ts", "export const a = 3;\n");
  review.write(tree, BRIEF, brief());
  review.git(tree, ["add", "-A"]);
  review.git(tree, ["commit", "-qm", "the work"]);
  review.intentReviewed(tree, "alpha", body);
  assert.equal(review.run(fixture, ["gate", "--tree", tree]).code, 0);
  return { fixture, tree };
}

test("green does not wait for an after_ship path, and names it in its payload", () => {
  const { fixture, tree } = gated(entry());
  const result = review.run(fixture, ["green", "--tree", tree, "--json"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(JSON.parse(result.out).after_ship, [{ criterion: "SC-2", where: COMMAND, evidence: EVIDENCE }]);
});

test("the same entry spelled external is refused as today: green owes its evidence", () => {
  const { fixture, tree } = gated(entry("external"));
  const result = review.run(fixture, ["green", "--tree", tree, "--json"]);
  assert.equal(result.code, 3, result.out + result.err);
  assert.deepEqual(JSON.parse(result.out).owed, ["evidence"]);
});

/** Alpha closed, archived and gated with an after_ship review, the way ship expects it. */
function shippable() {
  const fixture = shipping.repo();
  const { tree } = shipping.closed(fixture);
  const archived = ".specs-inferno/archive/intents/alpha/brief.md";
  shipping.write(tree, archived, brief());
  shipping.git(tree, ["add", "-A"]);
  shipping.git(tree, ["commit", "-qm", "brief"]);
  review.intentReviewed(tree, "alpha", entry());
  assert.equal(shipping.run(fixture, ["gate", "--tree", tree]).code, 0);
  return { fixture, tree };
}

test("ship merges past an after_ship path and prints it as owed, as its last line", () => {
  const { fixture, tree } = shippable();
  const result = shipping.run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(result.code, 0, result.out + result.err);
  const lines = shipping.lines(result.out);
  assert.equal(lines.at(-1), OWED);
  assert.equal(lines.at(-2), "shipped");
});

test("the shipped intent keeps its owed entry until the path exists, and select lists it", () => {
  const { fixture, tree } = shippable();
  assert.equal(shipping.run(fixture, ["ship", "alpha", "--tree", tree]).code, 0);
  const listed = shipping.run(fixture, ["select"]);
  assert.equal(listed.code, 0, listed.out + listed.err);
  assert.match(listed.out, new RegExp(`^owed alpha  after ship: ${COMMAND.replace(/\./g, "\\.")} -> ${EVIDENCE.replace(/\./g, "\\.")}$`, "m"));
  const payload = JSON.parse(shipping.run(fixture, ["select", "--json"]).out);
  assert.deepEqual(payload.owed, [{ id: "alpha", criterion: "SC-2", where: COMMAND, evidence: EVIDENCE }]);

  // The session on the base branch writes the evidence once the timer ran: the entry is paid.
  shipping.write(fixture.root, ".specs-inferno/archive/intents/alpha/evidence/timer.txt", "active\n");
  const paid = shipping.run(fixture, ["select", "--json"]);
  assert.deepEqual(JSON.parse(paid.out).owed, []);
  assert.doesNotMatch(shipping.run(fixture, ["select"]).out, /^owed /m);
});

test("a ship that fails after the merge still prints the owed lines, after what is left to do", () => {
  const { fixture, tree } = shippable();
  // The origin refuses every push, so the ship merged and stops at its push.
  const hook = path.join(fixture.remote, "hooks", "pre-receive");
  writeFile(hook, "#!/bin/sh\nexit 1\n", "utf8");
  fs.chmodSync(hook, 0o755);
  const result = shipping.run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(result.code, 2, result.out + result.err);
  const lines = shipping.lines(result.out);
  assert.equal(lines.at(-1), OWED);
  assert.match(lines.at(-2), /^left to do: push main/);
});

test("select lists a completed intent the live ledger still holds, unarchived", () => {
  const state = shipping.STATE.replace("    status: pending\n    base_branch: main\n    depends_on_intents: [gone-to-archive]", "    status: completed\n    base_branch: main\n    depends_on_intents: [gone-to-archive]");
  const fixture = shipping.repo({ state });
  shipping.write(fixture.root, BRIEF, brief());
  shipping.write(fixture.root, REVIEW, `${entry()}tree: abc\ncommit: def\n`);
  const payload = JSON.parse(shipping.run(fixture, ["select", "--json"]).out);
  assert.deepEqual(payload.owed, [{ id: "alpha", criterion: "SC-2", where: COMMAND, evidence: EVIDENCE }]);
});

test("a review recorded under the released flow parses as before", () => {
  const tree = tempDir("inferno-after-ship-");
  const body = "verdict: clean\ncriteria:\n  - criterion: a is three\n    proof: test\n    where: node --test src/a.test.ts\n" +
    "  - criterion: a reads 3\n    proof: code\n    where: src/a.ts:1\n" +
    `  - criterion: an operator saw it\n    proof: external\n    where: by hand\n    evidence: ${EVIDENCE}\n` +
    "tree: abc\ncommit: def\nreviewer: rev-1\n";
  fs.mkdirSync(path.join(tree, path.dirname(REVIEW)), { recursive: true });
  writeFile(path.join(tree, REVIEW), body, "utf8");
  const parsed = parseIntentReview(tree, REVIEW, { recorded: true, items: ["a-one"], scanIds: [] });
  assert.deepEqual(parsed.criteria.map((one) => one.proof), ["test", "code", "external"]);
  assert.equal(parsed.criteria[2].evidence, EVIDENCE);
});
