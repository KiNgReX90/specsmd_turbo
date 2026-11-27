const assert = require("node:assert/strict");
const test = require("node:test");

const review = require("./review-fixture.cjs");
const shipping = require("./run-fixture.cjs");

// The gate prints how many mutants the intent review withdrew, and the gate and the ship print how
// many findings it deferred and the file that holds them, so the next plan picks them up. Nothing
// is printed for a review that set nothing aside.

const GATED = review.CONFIG.replace("delivery:", "  finalize:\n    - echo gated\ndelivery:");

const deferred = (line, to) => `  - criterion: a-one:1\n    file: src/a.ts\n    line: ${line}\n    evidence: the label reads loosely\n` +
  `    fix: say it plainly\n    severity: minor\n    owner: a-one\n    to: ${to}\n    reason: after the release\n`;
const withdrawn = (replace) => `  - criterion: a-one:1\n    file: src/a.ts\n    line: 1\n    find: a = 3\n    replace: ${replace}\n    test: npm test\n` +
  "    caught: no\n    reason: it changed a line no test reads\n";
const LISTS = `withdrawn:\n${withdrawn("a = 4")}${withdrawn("a = 5")}deferred:\n${deferred(1, "first-update.md")}${deferred(2, "first-update.md")}` +
  `${deferred(1, "polish.md")}`;

function gatedTree(body) {
  const fixture = review.repo({ config: GATED });
  const tree = review.worktree(fixture, review.INTENT_TREE);
  review.write(tree, "src/a.ts", "export const a = 3;\n");
  review.write(tree, ".specs-inferno/intents/alpha/first-update.md", "- src/a.ts:1 and src/a.ts:2 wait\n");
  review.write(tree, ".specs-inferno/intents/alpha/polish.md", "- src/a.ts:1 waits\n");
  review.git(tree, ["add", "-A"]);
  review.git(tree, ["commit", "-qm", "the work and the user's lists"]);
  review.intentReviewed(tree, "alpha", body);
  return { fixture, tree };
}

const WITHDRAWN_LINE = "WITHDRAWN 2 mutants of the intent review, each with its reason in .specs-inferno/intents/alpha/review.yaml; none counts for its criterion";
const DEFERRED_LINES = [
  "DEFERRED 2 findings of the intent review to .specs-inferno/intents/alpha/first-update.md: the next plan picks them up",
  "DEFERRED 1 finding of the intent review to .specs-inferno/intents/alpha/polish.md: the next plan picks them up",
];

test("the gate prints the withdrawn mutants and the deferred findings by the file that holds them", () => {
  const { fixture, tree } = gatedTree(`verdict: clean\n${LISTS}`);
  const result = review.run(fixture, ["gate", "--tree", tree]);
  assert.equal(result.code, 0, result.out + result.err);
  const lines = result.out.split("\n");
  assert.deepEqual(lines.filter((line) => /^(WITHDRAWN|DEFERRED) /.test(line)), [WITHDRAWN_LINE, ...DEFERRED_LINES]);
  assert.ok(lines.indexOf(WITHDRAWN_LINE) < lines.findIndex((line) => line.startsWith("PASS")), "the review's lines lead the commands");
});

test("a detached gate prints the same lines when it starts", () => {
  const { fixture, tree } = gatedTree(`verdict: clean\nwithdrawn:\n${withdrawn("a = 4")}deferred:\n${deferred(2, "first-update.md")}`);
  const started = review.run(fixture, ["gate", "--tree", tree, "--detach"]);
  const waited = review.run(fixture, ["gate", "--tree", tree, "--wait"]);
  assert.equal(started.code, 0, started.out + started.err);
  assert.equal(waited.code, 0, waited.out + waited.err);
  assert.match(started.out, /^WITHDRAWN 1 mutant of the intent review, each with its reason in /m);
  assert.match(started.out, /^DEFERRED 1 finding of the intent review to \.specs-inferno\/intents\/alpha\/first-update\.md: /m);
});

test("the gate prints neither line for a review that set nothing aside", () => {
  const { fixture, tree } = gatedTree("verdict: clean\n");
  const result = review.run(fixture, ["gate", "--tree", tree]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.doesNotMatch(result.out, /WITHDRAWN|DEFERRED/);
});

test("ship prints the deferred findings and the file that holds them where the base now has it", () => {
  const fixture = shipping.repo();
  const { tree } = shipping.closed(fixture);
  shipping.write(tree, ".specs-inferno/archive/intents/alpha/first-update.md", "- src/a.ts:1 waits\n");
  shipping.git(tree, ["add", "-A"]);
  shipping.git(tree, ["commit", "-qm", "the user's list"]);
  review.intentReviewed(tree, "alpha", `verdict: clean\nwithdrawn:\n${withdrawn("a = 4")}deferred:\n${deferred(1, "first-update.md")}`);
  assert.equal(shipping.run(fixture, ["gate", "--tree", tree]).code, 0);

  const result = shipping.run(fixture, ["ship", "alpha", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /\nDEFERRED 1 finding of the intent review to \.specs-inferno\/archive\/intents\/alpha\/first-update\.md: the next plan picks them up\nshipped\n/);
  assert.doesNotMatch(result.out, /WITHDRAWN/, "a withdrawal is the review's own business and ends at the gate");
});

test("ship prints no such line for a review that deferred nothing", () => {
  const fixture = shipping.repo();
  const { tree } = shipping.closed(fixture);
  assert.equal(shipping.run(fixture, ["gate", "--tree", tree]).code, 0);
  const result = shipping.run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.doesNotMatch(result.out, /DEFERRED/);
});
