const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { INTENT_TREE, git, repo, run, worktree, write } = require("./review-fixture.cjs");

// Every review is a fresh dispatch, a delta review too: a resumed reviewer carries every round's
// context into the next one, and a fresh one reads the fix and nothing else. A delta dispatch
// names the previous review file and the range from the commit that review recorded to HEAD,
// which is the fix. Recording a review still names the agent id of the reviewer that wrote it,
// and the record keeps it beside the tree and the commit. The intent review never names an
// item's reviewer.

const ITEM_REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const INTENT_REVIEW = ".specs-inferno/intents/alpha/review.yaml";
const CODEX = ".specs-inferno/config.codex.yaml";

const itemReview = (fixture, args = []) => run(fixture, ["review", "--item", "a-one", "--tree", fixture.root, ...args]);
const shown = (result) => result.out + result.err;

const FIX = `item: a-one
verdict: fix
files: [src/a.ts]
findings:
  - criterion: AC1 the value reads two
    file: src/a.ts
    line: 1
    evidence: read src/a.ts, it exports 1
    fix: export 2
    severity: major
`;
const CLEAN = "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n";

/** An item whose first review said fix, recorded by `reviewer`, and whose fix is committed. */
function fixedAfter(fixture, reviewer) {
  assert.equal(itemReview(fixture).code, 3);
  write(fixture.root, ITEM_REVIEW, FIX);
  const recorded = itemReview(fixture, ["--reviewer", reviewer]);
  assert.equal(recorded.code, 2, shown(recorded));
  write(fixture.root, "src/a.ts", "export const a = 2;\n");
  git(fixture.root, ["commit", "-qam", "the fix"]);
}

test("an item's first review dispatches a cold reviewer, and its record call names the reviewer's id", () => {
  const fixture = repo();
  const first = itemReview(fixture);
  assert.equal(first.code, 3, shown(first));
  assert.match(first.out, /^dispatch specsmd-inferno-reviewer model model-review item a-one$/m);
  assert.doesNotMatch(first.out, /^resume /m);
  assert.match(first.out, new RegExp(`^then run\\.cjs review --item a-one --reviewer <agent-id> --tree ${fixture.root} records it; it runs the review's mutants first`, "m"));
});

test("the record writes the reviewer's id beside the tree and the commit", () => {
  const fixture = repo();
  write(fixture.root, ITEM_REVIEW, CLEAN);
  const recorded = itemReview(fixture, ["--reviewer", "rev-a1"]);
  assert.equal(recorded.code, 0, shown(recorded));
  const file = fs.readFileSync(path.join(fixture.root, ITEM_REVIEW), "utf8");
  assert.match(file, /^tree: [0-9a-f]{64}\ncommit: [0-9a-f]{40}\nreviewer: rev-a1\n$/m);
});

test("a record without the reviewer's id, or with the placeholder, refuses and prints the call with the flag", () => {
  const fixture = repo();
  write(fixture.root, ITEM_REVIEW, FIX);
  for (const args of [[], ["--reviewer", "<agent-id>"]]) {
    const refused = itemReview(fixture, args);
    assert.equal(refused.code, 2, shown(refused));
    assert.match(refused.err, /ERROR \[NO_REVIEWER\]/);
    assert.match(refused.err, new RegExp(`run\\.cjs review --item a-one --reviewer <agent-id> --tree ${fixture.root}`));
    assert.match(refused.err, /the id the host returned when it spawned the reviewer/);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), "utf8"), /review:/);
  assert.notEqual(git(fixture.root, ["status", "--porcelain", "--", ITEM_REVIEW]), "");
});

/** The commit a recorded review read, as its file holds it. */
const readAt = (tree, rel) => /^commit: ([0-9a-f]{40})$/m.exec(fs.readFileSync(path.join(tree, rel), "utf8"))[1];
const short = (tree, ref) => git(tree, ["rev-parse", "--short", ref]);

test("a review owed after a recorded one is a fresh dispatch that names the previous review and the fix's range", () => {
  const fixture = repo();
  fixedAfter(fixture, "rev-a1");
  const delta = itemReview(fixture);
  assert.equal(delta.code, 3, shown(delta));
  assert.doesNotMatch(delta.out, /^resume |rev-a1|if it does not answer/m);
  const lines = delta.out.split("\n");
  const at = lines.indexOf("dispatch specsmd-inferno-reviewer model model-review item a-one");
  assert.ok(at > 0, delta.out);
  assert.equal(lines[at + 1], `  previous ${ITEM_REVIEW}`);
  const range = `${short(fixture.root, readAt(fixture.root, ITEM_REVIEW))}..${short(fixture.root, "HEAD")}`;
  assert.equal(lines[at + 2], `  range ${range} paths src/a.ts`);
  assert.equal(lines[at + 3], "  spec .specs-inferno/intents/alpha/work-items/a-one.md");
  assert.equal(lines[at + 4], "  brief .specs-inferno/intents/alpha/brief.md");
  assert.equal(lines[at + 5], `  write ${ITEM_REVIEW}`);
  assert.match(lines[at + 6], /^then run\.cjs review --item a-one --reviewer <agent-id> --tree /);
  const payload = JSON.parse(run(fixture, ["review", "--item", "a-one", "--tree", fixture.root, "--json"]).out);
  assert.equal(payload.previous, ITEM_REVIEW);
  assert.equal(payload.range, range);
  write(fixture.root, ITEM_REVIEW, CLEAN);
  const clean = itemReview(fixture, ["--reviewer", "rev-a2"]);
  assert.equal(clean.code, 0, shown(clean));
  assert.match(fs.readFileSync(path.join(fixture.root, ITEM_REVIEW), "utf8"), /^reviewer: rev-a2$/m);
});

test("an item's first review names no previous review", () => {
  const fixture = repo();
  const first = itemReview(fixture);
  assert.equal(first.code, 3, shown(first));
  assert.doesNotMatch(first.out, /^ {2}previous /m);
});

test("on Codex the record takes the task path spawn_agent returns, and the delta is a fresh spawn of the Codex reviewer", () => {
  const fixture = repo({ files: { [CODEX]: "verification:\n  integrate:\n    - echo codex\ndelivery:\n  base_branch: main\n" } });
  fixedAfter(fixture, "/root/review_a_one");
  const delta = itemReview(fixture, ["--config", CODEX]);
  assert.equal(delta.code, 3, shown(delta));
  assert.match(delta.out, /^dispatch specsmd_inferno_reviewer item a-one\n {2}previous \.specs-inferno\/intents\/alpha\/reviews\/a-one\.yaml$/m);
  assert.doesNotMatch(delta.out, /followup_task|review_a_one|^resume /m);
});

/** An intent worktree with its work committed, an empty scan collected and an item review by `itemReviewer`. */
function intentStarted(itemReviewer) {
  const fixture = repo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 3;\n");
  write(tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "the work"]);
  write(tree, ITEM_REVIEW, CLEAN);
  const item = run(fixture, ["review", "--item", "a-one", "--tree", tree, "--reviewer", itemReviewer]);
  assert.equal(item.code, 0, shown(item));
  return { fixture, tree };
}

test("the intent's first review dispatches cold, names no previous review and never an item's reviewer", () => {
  const { fixture, tree } = intentStarted("rev-item");
  const first = run(fixture, ["review", "--tree", tree]);
  assert.equal(first.code, 3, shown(first));
  assert.match(first.out, /^dispatch specsmd-inferno-reviewer model model-review intent alpha$/m);
  assert.doesNotMatch(first.out, /resume|rev-item|^ {2}previous /m);
  assert.match(first.out, new RegExp(`^then run\\.cjs review --reviewer <agent-id> --tree ${tree} records it$`, "m"));
});

test("the intent review's record refuses without the reviewer's id, writes it, and the next intent review is a fresh dispatch of the delta", () => {
  const { fixture, tree } = intentStarted("rev-item");
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, "verdict: clean\n");
  const refused = run(fixture, ["review", "--tree", tree]);
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, new RegExp(`ERROR \\[NO_REVIEWER\\].*run\\.cjs review --reviewer <agent-id> --tree ${tree}`));
  const recorded = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-int"]);
  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(fs.readFileSync(path.join(tree, INTENT_REVIEW), "utf8"), /^commit: [0-9a-f]{40}\nreviewer: rev-int$/m);
  write(tree, "src/a.ts", "export const a = 4;\n");
  git(tree, ["commit", "-qam", "a later fix"]);
  const delta = run(fixture, ["review", "--tree", tree]);
  assert.equal(delta.code, 3, shown(delta));
  assert.doesNotMatch(delta.out, /^resume |rev-int|rev-item|if it does not answer/m);
  const lines = delta.out.split("\n");
  const at = lines.indexOf("dispatch specsmd-inferno-reviewer model model-review intent alpha");
  assert.ok(at > 0, delta.out);
  assert.equal(lines[at + 1], `  previous ${INTENT_REVIEW}`);
  assert.equal(lines[at + 2], `  range ${short(tree, readAt(tree, INTENT_REVIEW))}..${short(tree, "HEAD")}`);
});
