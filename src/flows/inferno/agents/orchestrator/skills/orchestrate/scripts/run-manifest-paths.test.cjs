const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { fixture, run } = require("./run-frontier-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

// The existence check of an item's `context.required` and `reads` holds the item until a builder
// took it: a builder line in the dispatch log, a recorded review, or a written review file. From
// then until its integrate its tree is the tree after its own build, so a file its own commit
// deleted is no plan finding. plan-lint and the frontier ask the same question
// (run-manifest-paths.cjs). A plan in the new form, for an Acme Shop that sells gift cards:
// fold-harness moves a test harness into its own test and deletes the harness; show-balance
// is independent of it.

const HARNESS = "test/harness.ts";
const BRIEF = "# Intent: Gift cards\n\n## Success Criteria\n\n" +
  "- SC-1: `node --test test/checkout.test.ts` reports 0 fail\n- SC-2: `node --test test/cards.test.ts` reports 0 fail\n\n" +
  "## Item Map\n\n| Criterion | Items |\n| --- | --- |\n| SC-1 | fold-harness |\n| SC-2 | show-balance |\n";

const rows = (entries) => entries.map((entry) => `    - path: ${entry}\n      reason: why ${entry}`).join("\n");
const readRows = (entries) => entries.map((entry) => `    - path: ${entry}\n      source: the card row\n      when: on every open\n      stale: the old balance stays`).join("\n");

/** One open item in the planner's full form. */
function spec(id, { delivers, test: proof, required, reads = [], editable }) {
  const manifest = `context:\n  required:\n${rows(required)}\n  patterns:\n${rows(["src/money.ts"])}\n  tests:\n${rows([proof])}\n` +
    `ownership:\n  editable:\n${editable.map((entry) => `    - ${entry}`).join("\n")}\n${reads.length ? `reads:\n${readRows(reads)}\n` : ""}`;
  return `---\nid: ${id}\ntitle: "${id}"\nintent: gift\nkind: behavior\ncomplexity: low\nstatus: pending\ndepends_on: []\n` +
    `delivers: [${delivers}]\n---\n\n# Work Item: ${id}\n\n## Description\n\nThe card page shows the balance.\n\n` +
    `## Acceptance Criteria\n\n- [ ] A card of 25 shows 25 (\`${proof}\` :: shows the balance)\n\n## Edge Cases\n\nNone.\n\n` +
    `## Out of Scope\n\nNone.\n\n## Test Plan\n\n- Adds: \`${proof}\` :: shows the balance\n- Integration: none\n- Breaks: none\n\n` +
    `## Reuse\n\nNone.\n\n## Execution Manifest\n\n${manifest}\n## Technical Notes\n\nNone.\n\n## Dependencies\n\nNone.\n`;
}

const folder = (field) => spec("fold-harness", {
  delivers: "SC-1",
  test: "test/checkout.test.ts",
  required: field === "required" ? [HARNESS] : ["test/checkout.test.ts"],
  reads: field === "reads" ? [HARNESS] : [],
  editable: [HARNESS, "test/checkout.test.ts"],
});
const SHOW = spec("show-balance", { delivers: "SC-2", test: "test/cards.test.ts", required: ["src/cards.ts"], editable: ["src/cards.ts", "test/cards.test.ts"] });

const STATE = (extra = "", status = "pending") => `project:\n  name: demo\nintents:\n  - id: gift\n    title: "Gift"\n    status: pending\n` +
  "    base_branch: main\n    depends_on_intents: []\n    work_items:\n" +
  `      - id: fold-harness\n        title: "Fold harness"\n        kind: behavior\n        complexity: low\n        status: ${status}\n        depends_on: []${extra}\n` +
  "      - id: show-balance\n        title: \"Show balance\"\n        kind: behavior\n        complexity: low\n        status: pending\n        depends_on: []\n";
const COMPLETED = "\n        completed_at: 2026-11-10T08:00:00Z\n        integrated_sha: abc1234\n        review: clean";

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** The plan, committed; `before` runs while the harness exists, then fold-harness's commit deletes it. */
function folded(field, { state = STATE(), before = () => {} } = {}) {
  const sources = {
    "src/money.ts": "export {};\n", "src/cards.ts": "export {};\n", "test/cards.test.ts": "export {};\n",
    "test/checkout.test.ts": "export {};\n", [HARNESS]: "export const harness = 1;\n", ".specs-inferno/intents/gift/brief.md": BRIEF,
  };
  const tree = fixture({ sources, state, items: { "gift/fold-harness": folder(field), "gift/show-balance": SHOW } });
  before(tree);
  git(tree.root, ["rm", "-q", HARNESS]);
  git(tree.root, ["commit", "-qm", "fold-harness folds the harness into its test"]);
  return tree;
}

const dispatched = (tree, intent = "gift", item = "fold-harness", how = ["--tier", "strong", "--agent", "builder"]) =>
  assert.equal(run(tree, ["dispatch-log", intent, "--item", item, ...how]).code, 0);
const ORACLE = ["--tier", "oracle", "--impact", "low: one item", "--complexity", "low: one reading"];
const lines = (out) => out.split("\n").filter(Boolean);
// The built item is offered or held by the rules it has, and no line tells the plan to change.
const kind = (line) => line.split(" ")[0];

/** plan-lint has no finding, and the frontier offers show-balance; the lines it prints of fold-harness. */
function assertOffered(tree, open = 2) {
  const lint = run(tree, ["plan-lint", "gift"]);
  assert.equal(lint.code, 0, lint.out + lint.err);
  assert.deepEqual(lines(lint.out), [`clean gift: ${open} open items, 2 criteria`]);
  const frontier = run(tree, ["frontier", "gift"]);
  assert.equal(frontier.code, 0, frontier.out + frontier.err);
  assert.match(frontier.out, /^ready show-balance /m);
  assert.doesNotMatch(frontier.out, /INVALID|FINDING/);
  return lines(frontier.out).filter((line) => line.includes("fold-harness"));
}

for (const field of ["required", "reads"]) {
  const label = field === "required" ? "context.required" : "reads";
  const refusal = `fold-harness: ${label} path does not exist: test/harness.ts, and no item fold-harness depends on owns it`;

  test(`a dispatched item whose own commit deleted the file its ${label} names is no plan finding, at plan-lint and at frontier`, () => {
    const named = assertOffered(folded(field, { before: (tree) => dispatched(tree) }));
    assert.deepEqual(named.map(kind), ["ready", "batch"], named.join("\n"));
  });

  test(`the same ${label} with no dispatch line and no review is a finding, at plan-lint and at frontier`, () => {
    const tree = folded(field);
    const lint = run(tree, ["plan-lint", "gift"]);
    assert.equal(lint.code, 2, lint.out + lint.err);
    assert.deepEqual(lines(lint.out), [`FINDING ${refusal}`]);
    const frontier = run(tree, ["frontier", "gift"]);
    assert.equal(frontier.code, 2, frontier.out + frontier.err);
    assert.deepEqual(lines(frontier.out), [`FINDING ${refusal}`]);
  });
}

test("a recorded review starts the item as a dispatch line does, and the frontier prints only what the review owes", () => {
  const named = assertOffered(folded("required", { state: STATE("\n        review: fix") }));
  assert.deepEqual(named.map(kind), ["ready", "next", "batch"], named.join("\n"));
});

test("a review file written and not yet recorded starts the item too", () => {
  const review = (tree) => {
    const file = path.join(tree.root, ".specs-inferno/intents/gift/reviews/fold-harness.yaml");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFile(file, "verdict: fix\n", "utf8");
  };
  assertOffered(folded("reads", { before: review }));
});

test("an oracle ask on the item starts nothing: plan-lint still finds the missing path", () => {
  const tree = folded("required", { before: (one) => dispatched(one, "gift", "fold-harness", ORACLE) });
  const lint = run(tree, ["plan-lint", "gift"]);
  assert.equal(lint.code, 2, lint.out + lint.err);
  assert.match(lint.out, /^FINDING fold-harness: context\.required path does not exist: test\/harness\.ts/m);
});

test("a completed item is not read at all: its deleted file changes nothing", () => {
  assert.deepEqual(assertOffered(folded("required", { state: STATE(COMPLETED, "completed") }), 1), []);
});

test("an oracle ask is no dispatch for the probe replay either: the item's stale probe is still caught", () => {
  const tree = fixture();
  dispatched(tree, "kappa", "k-built", ORACLE);
  const payload = JSON.parse(run(tree, ["frontier", "kappa", "--json"]).out);
  assert.deepEqual(payload.ready.map((item) => item.id).sort(), ["k-fresh", "k-reviewed"]);
  assert.match(payload.invalid[0], /^k-built: diagnosis probe/);
});

test("a dispatch log the runner cannot read stops the run: it never reads as nobody started", () => {
  const tree = folded("required");
  fs.mkdirSync(path.join(tree.dir, "cache/specsmd-inferno/app/dispatch/gift.log"), { recursive: true });
  const result = run(tree, ["plan-lint", "gift"]);
  assert.notEqual(result.code, 0);
  assert.match(result.err, /EISDIR/);
  assert.doesNotMatch(result.out, /^clean /m);
});
