const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const { CONFIG, INTENT_TREE, git, intentReviewed, repo, run, worktree, write } = require("./review-fixture.cjs");
const { tempDir } = require("./test-temp.cjs");
const { withMarks } = require("./run-gate-marks.cjs");

// The gate lists each criterion the plan marked with the command or lane that proves it, beside
// the verdict this gate gave that command or lane. With no mark it prints nothing new.

const ITEMS = ".specs-inferno/intents/alpha/work-items";
const LANE_CONFIG = "verification:\n  finalize:\n    - npm run check\n    - npm run size\n" +
  "  windows:\n    command: npm run test:windows\n    scope: [\"src/**\"]\n";

const spec = (id, criteria) => `---\nid: ${id}\nintent: alpha\n---\n\n# Work Item: ${id}\n\n## Acceptance Criteria\n\n` +
  `${criteria.map((text) => `- [ ] ${text}`).join("\n")}\n\n## Execution Manifest\n\ncontext: {}\n`;

/** A tree outside git holding a config and the specs of intent alpha. */
function tree(specs, config = LANE_CONFIG) {
  const root = path.join(tempDir("inferno-gate-marks-"), "app");
  write(root, ".specs-inferno/config.yaml", config);
  for (const [id, criteria] of Object.entries(specs)) write(root, `${ITEMS}/${id}.md`, spec(id, criteria));
  return root;
}

const MARKED = {
  "a-one": ["reads one (`a.test.ts`)", "the size cap holds (gate: npm run size)", "compiles on Windows (gate: verification.windows)"],
  "a-two": ["the check passes (gate: `npm run check`)", "a lint passes (gate: npm run lint)"],
};

const gateResult = (exit, results, extra = {}) => ({
  exit, payload: { ok: exit === 0, results, ...extra }, out: ["PASS 1s npm run check", "last line"],
});
const PASSED = [{ command: "npm run check", result: "pass" }, { command: "npm run size", result: "green" }];
const marked = (result, root) => withMarks({ tree: root, intent: "alpha" }, result).out.filter((line) => line.startsWith("MARKED "));

test("each marked criterion stands beside the verdict of its finalize command, and a lane is not run by a gate in this process", () => {
  const root = tree(MARKED);
  const result = withMarks({ tree: root, intent: "alpha" }, gateResult(0, PASSED));

  assert.deepEqual(result.out, [
    "PASS 1s npm run check",
    "MARKED a-one:2 (gate: npm run size): GREEN, unchanged since its last pass",
    "MARKED a-one:3 (gate: verification.windows): not run by this gate, gate --detach starts the lanes",
    "MARKED a-two:1 (gate: npm run check): PASS",
    "MARKED a-two:2 (gate: npm run lint): no command of verification.finalize and no lane of this config",
    "last line",
  ]);
  assert.deepEqual(result.payload.marks[0], { item: "a-one", criterion: 2, gate: "npm run size", verdict: "GREEN, unchanged since its last pass" });
  assert.equal(result.exit, 0);
});

test("a red gate prints the marks after its red, a command after the red was not run, a skipped one says so", () => {
  const root = tree({ "a-one": ["the size cap holds (gate: npm run size)"], "a-two": ["the check passes (gate: npm run check)"] });
  const red = withMarks({ tree: root, intent: "alpha" }, gateResult(2, [{ command: "npm run check", result: "fail" }]));
  assert.deepEqual(red.out.slice(2), [
    "MARKED a-one:1 (gate: npm run size): not run, the gate stopped at an earlier red",
    "MARKED a-two:1 (gate: npm run check): FAIL",
  ]);
  const skipped = marked(gateResult(0, [{ command: "npm run check", result: "skip" }, { command: "npm run size", result: "skip" }]), root);
  assert.equal(skipped[0], "MARKED a-one:1 (gate: npm run size): SKIP, no path in its scope changed");
});

test("gate --wait gives a lane its own state, and a lane it did not start is named so", () => {
  const root = tree({ "a-one": ["compiles on Windows (gate: verification.windows)"] });
  const lanes = (states) => marked(gateResult(0, PASSED, { lanes: states }), root);
  assert.deepEqual(lanes([{ lane: "windows", state: "green" }]), ["MARKED a-one:1 (gate: verification.windows): GREEN"]);
  assert.deepEqual(lanes([{ lane: "windows", state: "product-red" }]), ["MARKED a-one:1 (gate: verification.windows): product-red"]);
  assert.deepEqual(lanes([{ lane: "smoke", state: "green" }]), ["MARKED a-one:1 (gate: verification.windows): not started, no path in its scope changed"]);
});

test("the verdicts read the config the gate runs with", () => {
  const root = tree({ "a-one": ["the size cap holds (gate: npm run size)"] }, "verification:\n  finalize:\n    - npm run check\n");
  write(root, ".specs-inferno/config.lane.yaml", LANE_CONFIG);
  assert.deepEqual(marked(gateResult(0, PASSED), root), ["MARKED a-one:1 (gate: npm run size): no command of verification.finalize and no lane of this config"]);
  const selected = withMarks({ tree: root, intent: "alpha", config: ".specs-inferno/config.lane.yaml" }, gateResult(0, PASSED)).out;
  assert.equal(selected[1], "MARKED a-one:1 (gate: npm run size): GREEN, unchanged since its last pass");
});

test("nothing new is printed with no mark, before a gate ran, or for a gate that ran no command", () => {
  const plain = tree({ "a-one": ["reads one (`a.test.ts`)"] });
  const result = gateResult(0, PASSED);
  assert.equal(withMarks({ tree: plain, intent: "alpha" }, result), result);
  const root = tree(MARKED);
  for (const unchanged of [
    { exit: 4, payload: { running: true }, out: ["call it again"] },
    { exit: 0, payload: { started: true }, out: ["gate started pid 1"] },
    gateResult(2, []),
  ]) assert.equal(withMarks({ tree: root, intent: "alpha" }, unchanged), unchanged);
});

test("the marks take only the room the 30 lines leave, so the last line is never cut", () => {
  const root = tree(MARKED);
  const long = (count) => ({ ...gateResult(0, PASSED), out: Array.from({ length: count }, (_, at) => `line ${at + 1}`) });
  const tight = withMarks({ tree: root, intent: "alpha" }, long(28)).out;
  assert.equal(tight.length, 30);
  assert.deepEqual(tight.slice(27), ["MARKED a-one:2 (gate: npm run size): GREEN, unchanged since its last pass", "... 3 more lines", "line 28"]);
  assert.deepEqual(withMarks({ tree: root, intent: "alpha" }, long(30)).out, long(30).out);
});

test("run.cjs gate prints a marked criterion beside its command's verdict, before the green line", () => {
  const config = CONFIG.replace("verification:\n", "verification:\n  finalize:\n    - echo gate ran\n");
  const fixture = repo({ config });
  write(fixture.root, `${ITEMS}/a-one.md`, spec("a-one", ["reads one (`src/a.test.ts`)", "the size cap holds (gate: echo gate ran)"]));
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "a marked criterion"]);
  const intentTree = worktree(fixture, INTENT_TREE);
  intentReviewed(intentTree);

  const result = run(fixture, ["gate"], intentTree);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^PASS \d+s echo gate ran\nMARKED a-one:2 \(gate: echo gate ran\): PASS\ngreen [0-9a-f]+\n$/m);
});
