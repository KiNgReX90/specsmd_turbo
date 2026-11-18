const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { INTENT_TREE, git, repo, run, worktree, write } = require("./review-fixture.cjs");
const { CLEAN, QCLEAN, QUALITY, REVIEW, block, contractFix, firstRound, host, ledger, qualityFix, shown } = require("./run-review-quality-fixture.cjs");
const { CAUGHT_ONE, STRONG_TWO, itemReview, mutantRepo, record, withMutants } = require("./run-review-mutants-fixture.cjs");
const { parseItemReview } = require("./run-review-file.cjs");
const { parseQualityReview, readItemReview } = require("./run-review-quality.cjs");

// A delta reviewer whose earlier verdict still holds would leave its file as it was, and git reads an
// untouched file as unwritten, so the record could never tell it from a lens nobody ran. The delta's
// dispatch asks each lens to name the range it read under `read`, also when its verdict holds: the
// file is then written anew, and the record holds the line to the ranges its lens's dispatches
// printed since the last record. A file left untouched is refused as before, with that line in the
// dispatch sent again; a range no dispatch printed is refused naming both. A first review gets no
// such line, and a file without it reads as before. The intent review's: run-intent-review-read.test.cjs.

const head = (tree) => git(tree, ["rev-parse", "HEAD"]);
const read = (tree, rel) => fs.readFileSync(path.join(tree, rel), "utf8");
const LENSES = ["specsmd-inferno-reviewer", "specsmd-inferno-reviewer-quality"];
const readLine = (out, agent) => block(out, agent).find((line) => line.startsWith("  read "));
const rangeOf = (out, agent) => /^ {2}range (\S+) paths /m.exec(block(out, agent).join("\n"))[1];
/** The file as it stands with the range its reviewer read added, the way a reviewer whose verdict holds writes it again. */
const holding = (tree, rel, range) => write(tree, rel, `${read(tree, rel)}read: ${range}\n`);

/** a-one's first round recorded with both lenses, then a correction committed and the delta dispatched. */
function delta(contract, quality) {
  const h = host();
  const first = h.review();
  assert.equal(first.code, 3, shown(first));
  write(h.tree, REVIEW, contract);
  write(h.tree, QUALITY, quality);
  const recorded = h.review();
  assert.ok([0, 2].includes(recorded.code), shown(recorded));
  write(h.tree, "src/a.ts", "export const a = 3;\n");
  git(h.tree, ["commit", "-qm", "the correction", "--", "src/a.ts"]);
  const dispatched = h.review();
  assert.equal(dispatched.code, 3, shown(dispatched));
  return { h, out: dispatched.out, range: rangeOf(dispatched.out, LENSES[0]), firstRange: rangeOf(first.out, LENSES[1]) };
}

test("a delta dispatch asks each lens to name the range it read; a first dispatch does not", () => {
  const h = host();
  const first = h.review();
  for (const agent of LENSES) assert.equal(readLine(first.out, agent), undefined);
  write(h.tree, REVIEW, contractFix("major"));
  write(h.tree, QUALITY, QCLEAN);
  assert.equal(h.review().code, 2);
  write(h.tree, "src/a.ts", "export const a = 3;\n");
  git(h.tree, ["commit", "-qm", "the correction", "--", "src/a.ts"]);

  const next = h.review();

  assert.equal(next.code, 3, shown(next));
  for (const agent of LENSES) {
    const range = rangeOf(next.out, agent);
    assert.equal(readLine(next.out, agent), `  read ${range}: write read: ${range} into the file, also when the earlier verdict still holds`);
    assert.match(block(next.out, agent).at(-2), /^ {2}write /, "the read line follows the file to write");
  }
});

test("a quality delta whose verdict holds is refused while untouched, and recorded once it names the range it read", () => {
  const { h, range } = delta(contractFix("major"), QCLEAN);
  write(h.tree, REVIEW, CLEAN);

  const waiting = h.review();

  assert.equal(waiting.code, 3, shown(waiting));
  assert.match(waiting.out, /^refusing to record the review of a-one: \.specs-inferno\/intents\/alpha\/reviews\/quality\/a-one\.yaml is not written/m);
  assert.equal(readLine(waiting.out, LENSES[1]), `  read ${range}: write read: ${range} into the file, also when the earlier verdict still holds`);
  assert.match(ledger(h.tree), /review: fix/, "nothing recorded");

  holding(h.tree, QUALITY, range);
  const recorded = h.review();

  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(ledger(h.tree), /review: clean/);
  assert.match(read(h.tree, QUALITY), new RegExp(`^read: ${range}$`, "m"));
  assert.equal(git(h.tree, ["status", "--porcelain"]), "");
  // Every reader of a review file reads the line: the parsers, the one reading, the step and the landing.
  assert.equal(parseQualityReview(h.tree, QUALITY, "a-one", { recorded: true }).verdict, "clean");
  assert.equal(readItemReview(h.tree, "alpha", "a-one", { recorded: true }).verdict, "clean");
  assert.match(h.review().out, /^review a-one clean for the current files/m);
  const landed = h.at(["integrate", "--item", "a-one"]);
  assert.equal(landed.code, 0, shown(landed));
});

test("a contract delta whose verdict holds is recorded once it names the range it read", () => {
  const { h, range } = delta(CLEAN, qualityFix("major"));
  write(h.tree, QUALITY, QCLEAN);
  const waiting = h.review();
  assert.equal(waiting.code, 3, shown(waiting));
  assert.match(waiting.out, /reviews\/a-one\.yaml is not written/);
  assert.equal(readLine(waiting.out, LENSES[0]), `  read ${range}: write read: ${range} into the file, also when the earlier verdict still holds`);

  holding(h.tree, REVIEW, range);
  const recorded = h.review();

  assert.equal(recorded.code, 0, shown(recorded));
  assert.equal(parseItemReview(h.tree, REVIEW, "a-one", { recorded: true }).verdict, "clean");
  assert.match(read(h.tree, REVIEW), new RegExp(`^read: ${range}$`, "m"));
});

test("both lenses whose verdicts hold are recorded at once once each names the range it read", () => {
  const h = host();
  assert.equal(firstRound(h, CLEAN, QCLEAN).code, 0);
  write(h.tree, "src/a.ts", "export const a = 3;\n");
  git(h.tree, ["commit", "-qm", "a later change", "--", "src/a.ts"]);
  const readAt = head(h.tree);
  const owed = h.review();
  assert.equal(owed.code, 3, shown(owed));
  // Both untouched: nothing is pending, so the review is owed again, as before.
  assert.equal(h.review().code, 3);
  const range = rangeOf(owed.out, LENSES[0]);
  holding(h.tree, REVIEW, range);
  holding(h.tree, QUALITY, range);

  const recorded = h.review();

  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(ledger(h.tree), new RegExp(`review_commit: ${readAt}\\n`));
});

test("a range no dispatch of the lens printed is refused, the refusal naming both, and nothing is recorded", () => {
  const { h, range, firstRange } = delta(contractFix("major"), QCLEAN);
  // The dispatch printed twice over the same range, which the refusal names once.
  assert.equal(h.review().code, 3);
  const state = ledger(h.tree);
  const recordedAt = read(h.tree, QUALITY);
  const dots = (text) => text.replace(/[.[\]]/g, "\\$&");
  write(h.tree, REVIEW, CLEAN);
  // The last round's range copied over, a typo, and no range at all.
  for (const [line, named] of [[firstRange], [`zzzzzzz..${range.split("..")[1]}`], [`[${range}]`, [range]]]) {
    write(h.tree, QUALITY, `${recordedAt}read: ${line}\n`);
    const refused = h.review();
    assert.equal(refused.code, 2, shown(refused));
    assert.match(refused.err, new RegExp(`BAD_REVIEW.*quality/a-one\\.yaml: read names ${dots(JSON.stringify(named || line))}, and its dispatch printed ` +
      `${dots(range)}: write the range it printed`));
    assert.equal(ledger(h.tree), state);
  }
});

test("a delta that says clean while it still lists an earlier finding is refused, its read line or not", () => {
  const { h, range } = delta(CLEAN, qualityFix("major"));
  holding(h.tree, REVIEW, range);
  write(h.tree, QUALITY, `${qualityFix("major").replace("verdict: fix", "verdict: clean")}read: ${range}\n`);
  const refused = h.review();
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, /quality\/a-one\.yaml: verdict clean with 1 finding\(s\)/);
  assert.match(ledger(h.tree), /review: fix/);
});

test("a range a waiting refusal sends again is noted beside the first, so the lens that read it is recorded", () => {
  const { h, range } = delta(contractFix("major"), QCLEAN);
  const firstEnd = range.split("..")[1];
  write(h.tree, REVIEW, CLEAN);
  write(h.tree, "docs/b.md", "a-two's docs\n");
  git(h.tree, ["commit", "-qm", "a-two's work", "--", "docs/b.md"]);
  const waiting = h.review();
  assert.equal(waiting.code, 3, shown(waiting));
  const again = rangeOf(waiting.out, LENSES[1]);
  assert.notEqual(again, range, "sent again over a newer end");
  const recordedAt = read(h.tree, QUALITY);
  write(h.tree, QUALITY, `${recordedAt}read: zzzzzzz..${firstEnd}\n`);
  const refused = h.review();
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, new RegExp(`its dispatch printed ${range.replace(/\./g, "\\.")} or ${again.replace(/\./g, "\\.")}: `));
  write(h.tree, QUALITY, recordedAt);
  holding(h.tree, QUALITY, again);

  const recorded = h.review();

  assert.equal(recorded.code, 0, shown(recorded));
  assert.ok(/review_commit: ([0-9a-f]+)/.exec(ledger(h.tree))[1].startsWith(firstEnd), "the stamp is the oldest end printed");
});

test("a record refused for a lens file not written is refused again while that file is still missing, and nothing is recorded", () => {
  const { h } = delta(contractFix("major"), QCLEAN);
  write(h.tree, REVIEW, CLEAN);
  const state = ledger(h.tree);
  // The refusal notes the range it sends again and keeps the lenses the dispatch printed.
  for (let round = 0; round < 2; round += 1) {
    const waiting = h.review();
    assert.equal(waiting.code, 3, shown(waiting));
    assert.match(waiting.out, /^refusing to record the review of a-one: \.specs-inferno\/intents\/alpha\/reviews\/quality\/a-one\.yaml is not written/m);
    assert.equal(ledger(h.tree), state);
  }
});

test("the lenses noted outlive the record's forget: a recorded contract file edited in place waits for the quality lens as before", () => {
  const h = host();
  assert.equal(firstRound(h, CLEAN, QCLEAN).code, 0);
  const state = ledger(h.tree);
  // Sent back and edited in place, it is recorded with no dispatch between, reading the lenses noted.
  write(h.tree, REVIEW, `# read again\n${read(h.tree, REVIEW)}`);

  const waiting = h.review();

  assert.equal(waiting.code, 3, shown(waiting));
  assert.match(waiting.out, /^refusing to record the review of a-one: \.specs-inferno\/intents\/alpha\/reviews\/quality\/a-one\.yaml is not written/m);
  assert.equal(ledger(h.tree), state);
});

test("a read line naming the printed commits in full or by longer short ids is held to them; an end this history does not hold is refused", () => {
  const { h, range } = delta(contractFix("major"), QCLEAN);
  const state = ledger(h.tree);
  const recordedAt = read(h.tree, QUALITY);
  const spelled = (args) => range.split("..").map((rev) => git(h.tree, ["rev-parse", ...args, rev])).join("..");
  const unknown = `${range.split("..")[0]}..${"e".repeat(40)}`;
  write(h.tree, REVIEW, `${CLEAN}read: ${spelled(["--short=12"])}\n`);
  write(h.tree, QUALITY, `${recordedAt}read: ${unknown}\n`);
  const refused = h.review();
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, new RegExp(`BAD_REVIEW.*quality/a-one\\.yaml: read names "${unknown.replace(/\./g, "\\.")}", ` +
    `and its dispatch printed ${range.replace(/\./g, "\\.")}: write the range it printed`));
  assert.equal(ledger(h.tree), state);
  write(h.tree, QUALITY, `${recordedAt}read: ${spelled([])}\n`);

  const recorded = h.review();

  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(ledger(h.tree), /review: clean/);
});

/** a-one on the host's main, reviewed fix with no dispatch on record, a fix committed and its delta dispatched. */
function deltaOnMain() {
  const fixture = repo();
  const at = (args) => run(fixture, [...args, "--tree", fixture.root]);
  write(fixture.root, REVIEW, contractFix("major"));
  assert.equal(at(["review", "--item", "a-one", "--reviewer", "rev-1"]).code, 2);
  write(fixture.root, "src/a.ts", "export const a = 2;\n");
  git(fixture.root, ["commit", "-qm", "the fix", "--", "src/a.ts"]);
  const dispatched = at(["review", "--item", "a-one"]);
  assert.equal(dispatched.code, 3, shown(dispatched));
  fs.rmSync(path.join(fixture.cache, "specsmd-inferno", "app", "review-lenses", "alpha", "a-one.json"));
  return { fixture, at, range: rangeOf(dispatched.out, LENSES[0]) };
}

test("each lens's read line is held to its own dispatch: a quality lens reading the whole item beside a contract delta", () => {
  const h = host();
  // The released flow dispatched the contract lens alone and recorded its file.
  write(h.tree, REVIEW, contractFix("major"));
  assert.equal(h.at(["review", "--item", "a-one", "--reviewer", "rev-1"]).code, 2);
  write(h.tree, "src/a.ts", "export const a = 3;\n");
  git(h.tree, ["commit", "-qm", "the correction", "--", "src/a.ts"]);
  const owed = h.review();
  assert.equal(owed.code, 3, shown(owed));
  const [contract, quality] = LENSES.map((agent) => rangeOf(owed.out, agent));
  assert.notEqual(contract, quality, "the quality lens reads the item from its fork");
  assert.equal(readLine(owed.out, LENSES[1]), undefined, "a lens reading the item for the first time names nothing");
  write(h.tree, REVIEW, `${CLEAN}read: ${contract}\n`);
  write(h.tree, QUALITY, `${QCLEAN}read: ${contract}\n`);
  const refused = h.review();
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, new RegExp(`quality/a-one\\.yaml: read names "${contract.replace(/\./g, "\\.")}", and its dispatch printed ${quality.replace(/\./g, "\\.")}: `));
  write(h.tree, QUALITY, QCLEAN);
  const recorded = h.review();
  assert.equal(recorded.code, 0, shown(recorded));
});

test("a range whose start this history does not hold is held as it was printed", () => {
  const fixture = repo();
  const at = (args) => run(fixture, [...args, "--tree", fixture.root]);
  write(fixture.root, REVIEW, contractFix("major"));
  assert.equal(at(["review", "--item", "a-one", "--reviewer", "rev-1"]).code, 2);
  const state = path.join(fixture.root, ".specs-inferno/state.yaml");
  write(fixture.root, ".specs-inferno/state.yaml", read(fixture.root, ".specs-inferno/state.yaml").replace(/review_commit: [0-9a-f]+/, `review_commit: ${"d".repeat(40)}`));
  git(fixture.root, ["commit", "-qm", "a ledger whose review commit is not in this history", "--", state]);
  write(fixture.root, "src/a.ts", "export const a = 2;\n");
  git(fixture.root, ["commit", "-qm", "the fix", "--", "src/a.ts"]);
  const owed = at(["review", "--item", "a-one"]);
  assert.equal(owed.code, 3, shown(owed));
  const range = rangeOf(owed.out, LENSES[0]);
  assert.match(range, /^d{7}\.\./);
  write(fixture.root, REVIEW, `${CLEAN}read: eeeeeee..${range.split("..")[1]}\n`);
  const refused = at(["review", "--item", "a-one", "--reviewer", "rev-2"]);
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, new RegExp(`its dispatch printed ${range.replace(/\./g, "\\.")}: `));
  write(fixture.root, REVIEW, `${CLEAN}read: ${range}\n`);
  const recorded = at(["review", "--item", "a-one", "--reviewer", "rev-2"]);
  assert.equal(recorded.code, 0, shown(recorded));
});

test("with no range noted, as from a removed cache, the read line is held to nothing and the file records as before", () => {
  const { fixture, at, range } = deltaOnMain();
  write(fixture.root, REVIEW, `${CLEAN}read: zzzzzzz..${range.split("..")[1]}\n`);
  const recorded = at(["review", "--item", "a-one", "--reviewer", "rev-2"]);
  assert.equal(recorded.code, 0, shown(recorded));
});

test("the runner's rewrite of a delta with carried mutants keeps the range its reviewer read", () => {
  const fixture = mutantRepo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, REVIEW, withMutants(CAUGHT_ONE, STRONG_TWO));
  assert.equal(record(fixture, [], tree).code, 0);
  write(tree, "src/a.ts", "export const a = 1;\nexport const a2 = 2;\n// corrected\n");
  git(tree, ["commit", "-qm", "the correction", "--", "src/a.ts"]);
  const owed = run(fixture, ["review", "--item", "a-one", "--tree", tree]);
  assert.equal(owed.code, 3, shown(owed));
  const range = rangeOf(owed.out, LENSES[0]);
  write(tree, REVIEW, `${itemReview("")}read: ${range}\n`);
  write(tree, QUALITY, "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n");

  const recorded = record(fixture, ["--quality-reviewer", "rev-q"], tree);

  assert.equal(recorded.code, 0, shown(recorded));
  assert.match(read(tree, REVIEW), /^mutants:$/m, "the runner wrote its carried mutants");
  assert.match(read(tree, REVIEW), new RegExp(`^read: ${range}$`, "m"));
});
