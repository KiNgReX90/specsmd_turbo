const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const lib = require("./run-lib.cjs");
const proofs = require("./run-proofs.cjs");
const { itemReviewCurrent } = require("./run-review-hash.cjs");
const { CONFIG, git, repo, reviewed, run, worktree, write } = require("./review-fixture.cjs");

// A review binds the files it lists. A fold of the base used to re-owe the review of every item
// that lists a file the fold touched, and every item lists the shared case registry whole, so one
// fold that only added another intent's reservation sent every item back to a reviewer (measured
// 2026-11-10). Now a hunk the fold brought in leaves the review current, and in the registry only
// the item's own case blocks, and blocks no item names, re-owe it. Every change the branch makes
// itself still does.

const REGISTRY = "integration/TEST-CASES.md";
const LISTED = ["src/a.ts", REGISTRY];
const WRITER = path.join(__dirname, "state-transition.cjs");

const CASED = `${CONFIG}cases:
  files:
    - path: ${REGISTRY}
      case: '^### (TC-\\d+)'
`;

const block = (id, title, step) => `### ${id} ${title}\n1. ${step}\n`;
const CASES = `# Tester cases

${block("TC-001", "The balance shows on the card", "Open a gift card.")}
${block("TC-002", "A refund returns the balance", "Refund a gift card.")}
${block("TC-009", "The card list", "Open the card list.")}`;
const SOURCE = ["export const a = 1;", "export const b = 2;", "export const c = 3;", "export const d = 4;", "export const e = 5;", ""];

/** The source with line `n` (from one) replaced. */
function source(edits = {}) {
  return SOURCE.map((line, index) => (edits[index + 1] === undefined ? line : edits[index + 1])).join("\n");
}

const read = (tree, rel) => fs.readFileSync(path.join(tree, rel), "utf8");

function commit(tree, files, message) {
  for (const [rel, body] of Object.entries(files)) write(tree, rel, body);
  git(tree, ["add", "--", ...Object.keys(files)]);
  git(tree, ["commit", "-qm", message]);
}

/** The item spec with a description that names its case. */
function named(tree, id, cases) {
  const rel = `.specs-inferno/intents/alpha/work-items/${id}.md`;
  return { [rel]: read(tree, rel).replace(/## Description\n\n.*\n\n|(?=## Execution Manifest)/, `## Description\n\nThe tester proves ${cases}.\n\n`) };
}

/**
 * An intent worktree cut from main, where a-one names TC-001 and a-two names TC-002, and a-one
 * has changed line 5 of its source and filled its case block. Nothing names TC-009.
 */
function built() {
  const fixture = repo({ config: CASED, editable: LISTED, files: { "src/a.ts": source(), [REGISTRY]: CASES } });
  commit(fixture.root, { ...named(fixture.root, "a-one", "TC-001"), ...named(fixture.root, "a-two", "TC-002") }, "name the cases");
  const tree = worktree(fixture);
  commit(tree, {
    "src/a.ts": source({ 5: "export const e = 50;" }),
    [REGISTRY]: CASES.replace("1. Open a gift card.", "1. Open a gift card.\n2. Read the balance."),
  }, "a-one");
  return { fixture, tree };
}

/** Commit on main, the base the intent folds. */
const onMain = (fixture, files) => commit(fixture.root, files, "main moved");

/** Merge main into the intent branch; true when it merged without a conflict. */
function fold(tree) {
  return spawnSync("git", ["merge", "--no-edit", "main"], { cwd: tree, encoding: "utf8" }).status === 0;
}

/** Finish a conflicted fold with the files as given. */
function resolve(tree, files) {
  for (const [rel, body] of Object.entries(files)) write(tree, rel, body);
  git(tree, ["add", "--", ...Object.keys(files)]);
  git(tree, ["commit", "-q", "--no-edit"]);
}

const review = (fixture, tree) => run(fixture, ["review", "--item", "a-one", "--tree", tree]);

function current(fixture, tree) {
  const result = review(fixture, tree);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /review a-one clean for the current files/);
}

function owed(fixture, tree) {
  const result = review(fixture, tree);
  assert.equal(result.code, 3, result.out + result.err);
  assert.match(result.out, /review owed for a-one: the item changed since the last review/);
  const integrate = run(fixture, ["integrate", "--item", "a-one", "--tree", tree]);
  assert.equal(integrate.code, 3, integrate.out + integrate.err);
  assert.match(integrate.err, /a-one: a file it lists changed since its review/);
}

/** The check itself, in this process, for a state no caller of it lets through. */
function standing(tree) {
  const intent = lib.readLedger(tree).intents.find((entry) => entry.id === "alpha");
  const item = intent.items.find((entry) => entry.id === "a-one");
  return itemReviewCurrent(tree, { intent, item, files: LISTED, config: lib.readConfig(tree) });
}

/** Record a clean review of a-one by hand: the ledger line and the recorded file, under `hash` and `at`. */
function recordAs(tree, hash, at, message) {
  const rel = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
  write(tree, rel, `item: a-one\nverdict: clean\nfiles: [${LISTED.join(", ")}]\ntree: ${hash}\ncommit: ${at}\nreviewer: rev-1\n`);
  execFileSync(process.execPath, [WRITER, "review-item", "--intent", "alpha", "--item", "a-one",
    "--file", path.join(tree, ".specs-inferno/state.yaml"), "--verdict", "clean", "--files-hash", hash, "--tier", "cheap", "--commit", at]);
  git(tree, ["add", "--", rel, ".specs-inferno/state.yaml"]);
  git(tree, ["commit", "-qm", message]);
}

/** Exactly what git leaves, untrimmed. */
const raw = (tree, args) => spawnSync("git", args, { cwd: tree, encoding: "utf8" }).stdout;

function lands(fixture, tree) {
  const result = run(fixture, ["integrate", "--item", "a-one", "--tree", tree]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /completed a-one at/);
}

test("a fold that adds an unrelated case block leaves a clean review current", () => {
  const { fixture, tree } = built();
  reviewed(run, fixture, tree, ["a-one"], LISTED);
  onMain(fixture, { [REGISTRY]: `${CASES}\n${block("TC-010", "Another intent's case", "Reserved.")}` });
  assert.ok(fold(tree));

  current(fixture, tree);
  lands(fixture, tree);
});

test("a fold that changes another line of a listed source leaves the review current, and a branch change to any other line re-owes it", () => {
  const { fixture, tree } = built();
  reviewed(run, fixture, tree, ["a-one"], LISTED);
  onMain(fixture, { "src/a.ts": source({ 1: "export const a = 10;" }) });
  assert.ok(fold(tree));
  current(fixture, tree);

  commit(tree, { "src/a.ts": read(tree, "src/a.ts").replace("export const c = 3;", "export const c = 30;") }, "a-two");
  owed(fixture, tree);
});

test("a sibling filling its own case block leaves the review current, and a sibling's change to the item's own block re-owes it", () => {
  const { fixture, tree } = built();
  reviewed(run, fixture, tree, ["a-one"], LISTED);
  commit(tree, { [REGISTRY]: read(tree, REGISTRY).replace("1. Refund a gift card.", "1. Refund a gift card.\n2. Read the balance.") }, "a-two");
  current(fixture, tree);

  // The sibling names the item's case too, and the item's own name still decides.
  commit(tree, {
    [REGISTRY]: read(tree, REGISTRY).replace("2. Read the balance.\n\n### TC-002", "2. Read the new balance.\n\n### TC-002"),
    ...named(tree, "a-two", "TC-002 after TC-001"),
  }, "a-two");
  owed(fixture, tree);
});

test("a change to a case block no item names re-owes the review, since the item may have made it", () => {
  const { fixture, tree } = built();
  reviewed(run, fixture, tree, ["a-one"], LISTED);
  commit(tree, { [REGISTRY]: read(tree, REGISTRY).replace("1. Open the card list.", "1. Open the card list.\n2. Sort it.") }, "a-one correction");

  owed(fixture, tree);
});

test("a fold whose conflict lies inside the item's own lines re-owes the review", () => {
  const { fixture, tree } = built();
  reviewed(run, fixture, tree, ["a-one"], LISTED);
  onMain(fixture, { "src/a.ts": source({ 5: "export const e = 500;" }) });
  assert.equal(fold(tree), false, "the fold conflicts");
  resolve(tree, { "src/a.ts": source({ 5: "export const e = 550;" }) });

  owed(fixture, tree);
});

test("a fold whose registry conflict renumbers a sibling's case and brings a new header leaves the item's review current", () => {
  const { fixture, tree } = built();
  const refund = block("TC-003", "A refund by mail", "Mail a refund.");
  commit(tree, { [REGISTRY]: `${read(tree, REGISTRY)}\n${refund}`, ...named(tree, "a-two", "TC-002 and TC-003") }, "a-two");
  reviewed(run, fixture, tree, ["a-one"], LISTED);
  const other = `${block("TC-003", "Another intent's case", "Reserved.")}\n${block("TC-011", "A third intent's case", "Reserved.")}`;
  onMain(fixture, { [REGISTRY]: `${CASES.replace("# Tester cases", "# Tester cases, by screen")}\n${other}` });
  assert.equal(fold(tree), false, "both sides reserved TC-003");
  const ours = read(tree, REGISTRY).replace(/<<<<<<<[\s\S]*>>>>>>> main\n/, "");
  resolve(tree, {
    [REGISTRY]: `${ours}${other}\n${refund.replace("TC-003", "TC-004")}`,
    ...named(tree, "a-two", "TC-002 and TC-004"),
  });

  current(fixture, tree);
  lands(fixture, tree);
});

test("a merge of an item branch is the branch's own change, on the intent branch and on the base itself", () => {
  const { fixture, tree } = built();
  reviewed(run, fixture, tree, ["a-one"], LISTED);
  git(tree, ["checkout", "-qb", "inferno-item/alpha/a-two"]);
  commit(tree, { "src/a.ts": source({ 3: "export const c = 30;", 5: "export const e = 50;" }) }, "a-two");
  git(tree, ["checkout", "-q", "inferno-intent/wt"]);
  git(tree, ["merge", "-q", "--no-ff", "--no-edit", "inferno-item/alpha/a-two"]);
  owed(fixture, tree);

  const direct = repo({ config: CASED, editable: LISTED, files: { "src/a.ts": source() } });
  commit(direct.root, { "src/a.ts": source({ 5: "export const e = 50;" }) }, "a-one");
  reviewed(run, direct, direct.root, ["a-one"], ["src/a.ts"]);
  git(direct.root, ["checkout", "-qb", "side"]);
  commit(direct.root, { "src/a.ts": source({ 3: "export const c = 30;", 5: "export const e = 50;" }) }, "a-two");
  git(direct.root, ["checkout", "-q", "main"]);
  git(direct.root, ["merge", "-q", "--no-ff", "--no-edit", "side"]);
  owed(direct, direct.root);
});

// A review the released flow recorded holds the hash of every file it lists, whole. It stays
// current while those files are unchanged, and a fold leaves it current as it does a new one.
test("a review recorded under the released whole-file rule reads as current, before and after a fold", () => {
  const { fixture, tree } = built();
  const hash = proofs.scopeHash(tree, LISTED, { exact: true });
  recordAs(tree, hash, git(tree, ["rev-parse", "HEAD"]), "review a-one clean, recorded by the released flow");
  current(fixture, tree);

  onMain(fixture, { [REGISTRY]: `${CASES}\n${block("TC-010", "Another intent's case", "Reserved.")}` });
  assert.ok(fold(tree));
  current(fixture, tree);
  lands(fixture, tree);
});

// --- the guards: a review stands after a fold only on what the walk proved ----------------------

test("a branch commit that changes a registry line outside every case block re-owes the review", () => {
  const { fixture, tree } = built();
  reviewed(run, fixture, tree, ["a-one"], LISTED);
  commit(tree, { [REGISTRY]: read(tree, REGISTRY).replace("# Tester cases", "# Tester cases for gift cards") }, "a-two");

  owed(fixture, tree);
});

test("a fold that merged cleanly but holds a hand edit of a listed file in its merge commit re-owes the review", () => {
  const { fixture, tree } = built();
  reviewed(run, fixture, tree, ["a-one"], LISTED);
  onMain(fixture, { "src/a.ts": source({ 1: "export const a = 10;" }) });
  assert.equal(spawnSync("git", ["merge", "--no-commit", "--no-ff", "main"], { cwd: tree }).status, 0, "the fold merges cleanly");
  resolve(tree, { "src/a.ts": source({ 1: "export const a = 10;", 3: "export const c = 30;", 5: "export const e = 50;" }) });

  owed(fixture, tree);
});

test("a fold committed with the conflict markers a merge of both sides writes re-owes the review", () => {
  const { fixture, tree } = built();
  reviewed(run, fixture, tree, ["a-one"], LISTED);
  onMain(fixture, { "src/a.ts": source({ 5: "export const e = 500;" }) });
  const sides = [git(tree, ["rev-parse", "HEAD"]), git(tree, ["rev-parse", "main"])];
  assert.equal(fold(tree), false, "the fold conflicts");
  // The merge commit holds the very text a merge of both sides writes, markers and all.
  const merged = raw(tree, ["merge-tree", "--write-tree", "--no-messages", ...sides]).split("\n")[0];
  resolve(tree, { "src/a.ts": raw(tree, ["show", `${merged}:src/a.ts`]) });
  assert.match(read(tree, "src/a.ts"), /^<<<<<<< /m);

  owed(fixture, tree);
});

test("a record whose hash does not bind the review commit's files re-owes the review, even after a fold that would stand", () => {
  const { fixture, tree } = built();
  // The hash of the listed files before a-one changed them, recorded against the commit after.
  recordAs(tree, proofs.scopeHash(fixture.root, LISTED, { exact: true }), git(tree, ["rev-parse", "HEAD"]), "a record that binds other files");
  onMain(fixture, { [REGISTRY]: `${CASES}\n${block("TC-010", "Another intent's case", "Reserved.")}` });
  assert.ok(fold(tree));

  owed(fixture, tree);
});

// review and integrate both refuse an uncommitted change to a listed file before they ask, so
// only a caller of the check itself meets this state.
test("an uncommitted change to a listed file after a fold that would stand leaves the review unbound", () => {
  const { fixture, tree } = built();
  reviewed(run, fixture, tree, ["a-one"], LISTED);
  onMain(fixture, { "src/a.ts": source({ 1: "export const a = 10;" }) });
  assert.ok(fold(tree));
  assert.equal(standing(tree), true, "the fold alone leaves the review standing");

  write(tree, "src/a.ts", source({ 1: "export const a = 10;", 3: "export const c = 30;", 5: "export const e = 50;" }));
  assert.equal(standing(tree), false);
});

test("a review commit off HEAD's first-parent line re-owes the review, though no commit on that line touched the files", () => {
  const { fixture, tree } = built();
  git(tree, ["checkout", "-qb", "side"]);
  commit(tree, { "src/a.ts": source({ 4: "export const d = 40;", 5: "export const e = 50;" }) }, "a-one on a side branch");
  reviewed(run, fixture, tree, ["a-one"], LISTED);
  git(tree, ["checkout", "-q", "inferno-intent/wt"]);
  // The intent branch takes the side's history and none of its files, then its ledger by hand.
  git(tree, ["merge", "-q", "-s", "ours", "--no-edit", "side"]);
  git(tree, ["checkout", "side", "--", ".specs-inferno"]);
  git(tree, ["commit", "-qm", "the ledger of the side branch"]);
  assert.doesNotMatch(read(tree, "src/a.ts"), /d = 40/, "the reviewed change never reached this line");

  owed(fixture, tree);
});
