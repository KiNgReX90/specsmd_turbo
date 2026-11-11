const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { STATE, git, repo, reviewed, run, write } = require("./review-fixture.cjs");
const { QUALITY, REVIEW, block, contractFix, firstRound, host, ledger, qualityFix, shown } = require("./run-review-quality-fixture.cjs");
const { owedReviews } = require("./run-review.cjs");
const { readItemReview } = require("./run-review-quality.cjs");
const { boundFiles } = require("./run-review-file.cjs");
const lib = require("./run-lib.cjs");

// A file that left the tree since a review was recorded is a file that changed since that
// review: the review is stale, never malformed. A correction that deletes or renames a file the
// last round lists gets the dispatch of the lenses owed, the check over the items names the item
// stale, and the delta reviewer is told the file is gone so it neither looks for it nor lists it.

const GONE = "src/old/legacy.ts";
const MOVED = "src/old/renamed.ts";
const EDITABLE = ["src/a.ts", "src/a2.test.ts", "src/old/"];
const BUILT = { "src/a.ts": "export const a = 2;\n", [GONE]: "export const legacy = 1;\n" };

const listing = (body, files) => body.replace(/^files: \[.*\]$/m, `files: [${files.join(", ")}]`);

/** a-one built over two files, its first round recorded fix with the files each lens lists. */
function recordedFix(contractFiles, qualityFiles) {
  const h = host({ editable: EDITABLE, change: BUILT });
  const recorded = firstRound(h, listing(contractFix(), contractFiles), listing(qualityFix(), qualityFiles));
  assert.equal(recorded.code, 2, shown(recorded));
  return h;
}

function correct(h, args, message) {
  git(h.tree, args);
  write(h.tree, "src/a.ts", "export const a = 3;\n");
  git(h.tree, ["add", "-A"]);
  git(h.tree, ["commit", "-qm", message]);
}

/** The delta round owed: both dispatches, each naming its previous file and the gone path. */
function assertOwed(result, gone = GONE) {
  assert.equal(result.code, 3, shown(result));
  assert.doesNotMatch(shown(result), /BAD_REVIEW|has no readable review file/);
  assert.match(result.out, /^review owed for a-one: the item changed since the last review$/m);
  for (const [agent, file] of [["specsmd-inferno-reviewer", REVIEW], ["specsmd-inferno-reviewer-quality", QUALITY]]) {
    const lines = block(result.out, agent).join("\n");
    assert.match(lines, new RegExp(`^ {2}previous ${file.replace(/\./g, "\\.")}$`, "m"), `${agent} reads its own previous file`);
    assert.match(lines, new RegExp(`^ {2}gone ${gone}: `, "m"), `${agent} is told ${gone} left the tree`);
  }
}

test("a recorded contract review that lists a file the correction deleted reads as stale and the lenses owed are dispatched", () => {
  const h = recordedFix(["src/a.ts", GONE], ["src/a.ts"]);
  correct(h, ["rm", "-q", GONE], "the correction drops the legacy module");

  assertOwed(h.review());
});

test("a recorded quality review that lists a file the correction deleted reads as stale and the lenses owed are dispatched", () => {
  const h = recordedFix(["src/a.ts"], ["src/a.ts", GONE]);
  correct(h, ["rm", "-q", GONE], "the correction drops the legacy module");

  assertOwed(h.review());
});

test("a file the correction renamed reads as gone, and the delta reads its new path", () => {
  const h = recordedFix(["src/a.ts", GONE], ["src/a.ts", GONE]);
  correct(h, ["mv", GONE, MOVED], "the correction renames the legacy module");

  const result = h.review();
  assertOwed(result);
  assert.match(block(result.out, "specsmd-inferno-reviewer").join("\n"), new RegExp(`^ {2}range \\S+ paths .*${MOVED}`, "m"));
});

test("the gone line leaves the files that are still in the tree out", () => {
  const h = recordedFix(["src/a.ts", GONE], ["src/a.ts"]);
  correct(h, ["rm", "-q", GONE], "the correction drops the legacy module");

  const gone = block(h.review().out, "specsmd-inferno-reviewer").find((line) => line.startsWith("  gone "));
  assert.ok(gone.startsWith(`  gone ${GONE}: `), gone);
  assert.doesNotMatch(gone, /src\/a\.ts/);
});

test("a first review and a delta whose files all stand print no gone line", () => {
  const h = host({ editable: EDITABLE, change: BUILT });
  assert.doesNotMatch(h.review().out, /^ {2}gone /m);
  assert.equal(firstRound(h, listing(contractFix(), ["src/a.ts", GONE]), listing(qualityFix(), ["src/a.ts"])).code, 2);
  write(h.tree, "src/a.ts", "export const a = 3;\n");
  git(h.tree, ["commit", "-qam", "the correction"]);
  const result = h.review();
  assert.equal(result.code, 3, shown(result));
  assert.doesNotMatch(result.out, /^ {2}gone /m);
});

test("the delta that answers lists only files in the tree, and one that lists the gone file is sent back", () => {
  const h = recordedFix(["src/a.ts", GONE], ["src/a.ts"]);
  correct(h, ["rm", "-q", GONE], "the correction drops the legacy module");
  assert.equal(h.review().code, 3);

  write(h.tree, REVIEW, listing(contractFix(), ["src/a.ts", GONE]));
  write(h.tree, QUALITY, listing(qualityFix(), ["src/a.ts"]));
  const refused = h.review();
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, new RegExp(`BAD_REVIEW.*files lists ${GONE}, which is not in the tree`));

  write(h.tree, REVIEW, "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n");
  write(h.tree, QUALITY, "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n");
  const recorded = h.review();
  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(ledger(h.tree), /review: clean/);
});

test("a recorded review keeps a gone path in its files, and a fresh one is still refused it", () => {
  const h = recordedFix(["src/a.ts", GONE], ["src/a.ts", GONE]);
  correct(h, ["rm", "-q", GONE], "the correction drops the legacy module");

  assert.deepEqual(readItemReview(h.tree, "alpha", "a-one", { recorded: true }).files, ["src/a.ts", GONE]);
  const doc = { files: ["src/a.ts", GONE] };
  assert.deepEqual(boundFiles(h.tree, REVIEW, doc, { recorded: true }), ["src/a.ts", GONE]);
  assert.throws(() => boundFiles(h.tree, REVIEW, doc, { recorded: false }), /files lists src\/old\/legacy\.ts, which is not in the tree; list only files/);
});

// --- the check over the items, and an earlier item's review ------------------------------------

const SIBLINGS = STATE.replace("        depends_on: [a-one]", "        depends_on: []");

test("the check over the items names an item stale once a file its review lists is gone, never unreadable", () => {
  const fixture = repo({ files: { [GONE]: "export const legacy = 1;\n" }, editable: EDITABLE });
  reviewed(run, fixture, fixture.root, ["a-one"], ["src/a.ts", GONE]);
  git(fixture.root, ["rm", "-q", GONE]);
  git(fixture.root, ["commit", "-qm", "the legacy module goes"]);

  const lines = owedReviews(fixture.root, lib.readLedger(fixture.root), ["a-one"], {});
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^a-one: a file it lists changed since its review, run .*review --item a-one/);
  assert.doesNotMatch(lines[0], /no readable review file/);
  const integrate = run(fixture, ["integrate", "--item", "a-one", "--tree", fixture.root]);
  assert.equal(integrate.code, 3, integrate.out + integrate.err);
  assert.match(integrate.err, /a-one: a file it lists changed since its review/);
});

test("a later item that deletes a file an earlier completed item's clean review lists makes that review stale, not unreadable", () => {
  const fixture = repo({ state: SIBLINGS, files: { "src/shared.ts": "export const shared = 1;\n" } });
  reviewed(run, fixture, fixture.root, ["a-one"], ["src/a.ts", "src/shared.ts"]);
  const landed = run(fixture, ["integrate", "--item", "a-one", "--tree", fixture.root]);
  assert.equal(landed.code, 0, landed.out + landed.err);
  assert.match(ledger(fixture.root), /status: completed/);

  // a-two's change removes the shared module a-one's review read.
  git(fixture.root, ["rm", "-q", "src/shared.ts"]);
  write(fixture.root, "src/b.ts", "export const b = 3;\n");
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "a-two drops the shared module"]);

  const lines = owedReviews(fixture.root, lib.readLedger(fixture.root), ["a-one"], {});
  assert.deepEqual(lines.map((line) => line.split(",")[0]), ["a-one: a file it lists changed since its review"]);
  const again = run(fixture, ["review", "--item", "a-one", "--tree", fixture.root]);
  assert.equal(again.code, 3, again.out + again.err);
  assert.match(again.out, /^ {2}gone src\/shared\.ts: /m);
  assert.ok(fs.existsSync(path.join(fixture.root, REVIEW)));
});
