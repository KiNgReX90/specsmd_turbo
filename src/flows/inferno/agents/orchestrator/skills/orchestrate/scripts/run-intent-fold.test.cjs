const assert = require("node:assert/strict");
const test = require("node:test");

const { CONFIG, INTENT_TREE, git, intentReviewed, repo, run, worktree, write } = require("./review-fixture.cjs");
const lib = require("./run-lib.cjs");
const { parseFor, reviewCurrent } = require("./run-intent-owed.cjs");

// review.outside: ["**"] binds the intent review to the files the intent changed. A fold of the
// base that changes or adds only other files keeps the review current, so the gate owes no
// review round for it; a fold that changes a file the intent changed owes one, and the delta
// dispatch names that file and what of the base to read; the intent's own change owes one too.
// Without the key every folded change voids the review, as released.

const GATED = CONFIG.replace("delivery:", "  finalize:\n    - echo gated\ndelivery:");
const BOUND = GATED.replace("  model: model-review\n", '  model: model-review\n  outside: ["**"]\n');
const REVIEW = ".specs-inferno/intents/alpha/review.yaml";
// Room between the head and the tail, so the intent's edit of one and the base's of the other fold cleanly.
const SPLIT = "export const a = 1;\n\n\n\n\nexport const tail = 0;\n";

function opened(config = BOUND) {
  const fixture = repo({ config, files: { "src/a.ts": SPLIT } });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", SPLIT.replace("a = 1", "a = 3"));
  git(tree, ["commit", "-qam", "the work"]);
  intentReviewed(tree, "alpha", "verdict: clean\n", lib.readConfig(tree));
  return { fixture, tree };
}

function baseCommits(fixture, files) {
  for (const [rel, body] of Object.entries(files)) write(fixture.root, rel, body);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", `main changed ${Object.keys(files).join(" ")}`]);
}

const gate = (fixture, tree) => run(fixture, ["gate", "--tree", tree]);
const green = (fixture, tree) => run(fixture, ["green", "--tree", tree, "--json"]);
const current = (tree) => reviewCurrent(tree, lib.readConfig(tree), parseFor(tree, REVIEW, "alpha", true));
const UNRELATED = { "src/b.ts": "export const b = 5;\n", "docs/added.md": "a page the base added\n" };
const INTENT_FILE = { "src/a.ts": SPLIT.replace("tail = 0", "tail = 9") };

test("with review.outside ** a fold that changes and adds files the intent never touched keeps the review, and the gate owes none", () => {
  const { fixture, tree } = opened();
  baseCommits(fixture, UNRELATED);
  const result = gate(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /folded main into/);
  assert.doesNotMatch(result.out, /intent review owed/);
  assert.equal(git(tree, ["show", "HEAD:src/b.ts"]), "export const b = 5;");
  assert.equal(current(tree), true);
  const greened = green(fixture, tree);
  assert.equal(greened.code, 0, greened.out + greened.err);
});

test("with review.outside ** a fold that changes a file the intent changed owes the review, and the dispatch names only that file", () => {
  const { fixture, tree } = opened();
  const held = git(fixture.root, ["rev-parse", "--short", "main"]);
  baseCommits(fixture, { ...UNRELATED, ...INTENT_FILE });
  const tip = git(fixture.root, ["rev-parse", "--short", "main"]);
  const gated = gate(fixture, tree);
  assert.equal(gated.code, 3, gated.out + gated.err);
  assert.match(gated.out, /intent review owed: the code changed since the review/);
  assert.match(gated.out, /the fold moved the tree from \w+ and changed what the review binds: src\/a\.ts$/m);
  assert.equal(current(tree), false);
  const sent = run(fixture, ["review", "--tree", tree]);
  assert.equal(sent.code, 3, sent.out + sent.err);
  const line = sent.out.split("\n").find((entry) => entry.includes("of the base"));
  assert.ok(line, sent.out);
  assert.match(line, /changed src\/a\.ts, which the review binds/);
  assert.ok(line.includes(`git diff ${held} ${tip} -- src/a.ts`), line);
  assert.match(line, /and what calls them, not the rest of the base delta/);
  assert.doesNotMatch(line, /src\/b\.ts|docs\/added\.md/);
});

test("with review.outside ** the intent's own change after the review owes it", () => {
  const { fixture, tree } = opened();
  write(tree, "src/b.ts", "export const b = 7;\n");
  git(tree, ["commit", "-qam", "own change"]);
  const result = gate(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /intent review owed: the code changed since the review/);
  assert.equal(current(tree), false);
});

test("with review.outside ** a delta dispatch after a fold that touched no file of the intent says to read none of the base", () => {
  const { fixture, tree } = opened();
  write(tree, "src/b.ts", "export const b = 7;\n");
  git(tree, ["commit", "-qam", "own change"]);
  baseCommits(fixture, { "docs/added.md": "a page the base added\n" });
  const sent = run(fixture, ["review", "--tree", tree]);
  assert.equal(sent.code, 3, sent.out + sent.err);
  assert.match(sent.out, /changed no file the review binds: read the intent's own commits \(git log -p --first-parent --no-merges \w+\.\.HEAD\) and none of the base delta/);
});

test("without review.outside a fold of a file the intent never touched owes the review, and the dispatch is the released one", () => {
  const { fixture, tree } = opened(GATED);
  baseCommits(fixture, UNRELATED);
  const gated = gate(fixture, tree);
  assert.equal(gated.code, 3, gated.out + gated.err);
  assert.match(gated.out, /intent review owed: the code changed since the review/);
  assert.match(gated.out, /the fold moved the tree from \w+; the reviewer reads the base delta from there/);
  const sent = run(fixture, ["review", "--tree", tree]);
  assert.equal(sent.code, 3, sent.out + sent.err);
  assert.match(sent.out, /^ {2}range \w+\.\.\w+$/m);
  assert.doesNotMatch(sent.out, /of the base|the review binds/);
});

/** The tree_outside the released flow recorded: it named the intent's ledger files among the files it changed. */
function releasedOutside(tree) {
  const { createHash } = require("node:crypto");
  const proofs = require("./run-proofs.cjs");
  const own = new Set([
    ...git(tree, ["diff", "--name-only", "--no-renames", "main...HEAD"]).split("\n"),
    ...git(tree, ["ls-files", "--others", "--exclude-standard"]).split("\n"),
  ].filter(Boolean));
  const hash = proofs.scopeHash(tree, null, { skip: (file) => !own.has(file) });
  return createHash("sha256").update(JSON.stringify([hash, [...own].sort()])).digest("hex");
}

test("a review recorded under review.outside ** before the ledger files were left out stays current after an unrelated fold", () => {
  const { fixture, tree } = opened();
  const text = require("node:fs").readFileSync(require("node:path").join(tree, REVIEW), "utf8");
  assert.match(text, /^tree_outside: [0-9a-f]{64}$/m);
  write(tree, REVIEW, text.replace(/^tree_outside: .*$/m, `tree_outside: ${releasedOutside(tree)}`));
  git(tree, ["commit", "-qam", "review as the released flow recorded it"]);
  assert.equal(current(tree), true);
  baseCommits(fixture, UNRELATED);
  const result = gate(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
  assert.doesNotMatch(result.out, /intent review owed/);
});

test("with review.outside ** a ledger file the intent changed and the fold changed is named neither in the gate line nor in the dispatch", () => {
  const notes = ".specs-inferno/notes.md";
  const fixture = repo({ config: BOUND, files: { "src/a.ts": SPLIT, [notes]: SPLIT } });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", SPLIT.replace("a = 1", "a = 3"));
  write(tree, notes, SPLIT.replace("a = 1", "a = 3"));
  git(tree, ["commit", "-qam", "the work"]);
  intentReviewed(tree, "alpha", "verdict: clean\n", lib.readConfig(tree));
  baseCommits(fixture, { ...INTENT_FILE, [notes]: SPLIT.replace("tail = 0", "tail = 9") });
  const gated = gate(fixture, tree);
  assert.equal(gated.code, 3, gated.out + gated.err);
  assert.match(gated.out, /and changed what the review binds: src\/a\.ts$/m);
  const sent = run(fixture, ["review", "--tree", tree]);
  const line = sent.out.split("\n").find((entry) => entry.includes("of the base"));
  assert.ok(line, sent.out);
  assert.ok(line.includes(" -- src/a.ts)"), line);
  assert.doesNotMatch(line, /notes\.md/);
});

test("with review.outside ** a file the intent changed when reviewed that the fold made the base's own is still named", () => {
  const { fixture, tree } = opened();
  // The base lands the intent's own edit, so after the fold the intent no longer changes the file,
  // and the review it read hashed that file: the fold voids the review through it, so it is named.
  baseCommits(fixture, { "src/a.ts": SPLIT.replace("a = 1", "a = 3"), ...UNRELATED });
  const gated = gate(fixture, tree);
  assert.equal(gated.code, 3, gated.out + gated.err);
  assert.equal(git(tree, ["diff", "--name-only", "main...HEAD", "--", "src"]), "");
  assert.match(gated.out, /and changed what the review binds: src\/a\.ts$/m);
  const sent = run(fixture, ["review", "--tree", tree]);
  assert.match(sent.out, /changed src\/a\.ts, which the review binds/);
  assert.doesNotMatch(sent.out, /changed [^\n]*src\/b\.ts[^\n]*which the review binds/);
});
