const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { git, write } = require("./review-fixture.cjs");
const { writeFile } = require("./test-write.cjs");
const { CLEAN, QCLEAN, QUALITY, REVIEW, block, contractFix, host, ledger, qualityFix, shown } = require("./run-review-quality-fixture.cjs");

// The record stamps the commit its reviewer read, the end of the range the dispatch printed, never
// HEAD at record time. A correction committed between the dispatch and the record then lies after
// the stamp: the record says the change is read first, and the next review call owes the delta from
// the commit read, in every lens that was dispatched. The files hash is taken there too, so a review
// holds only for the bytes its reviewer read. A dispatch printed again stamps the oldest end printed
// since the last record; a record with no range noted stamps HEAD as before.

const head = (tree) => git(tree, ["rev-parse", "HEAD"]);
const read = (tree, rel) => fs.readFileSync(path.join(tree, rel), "utf8");
const commitOnly = (tree, rel, body, message) => {
  write(tree, rel, body);
  git(tree, ["add", "--", rel]);
  git(tree, ["commit", "-qm", message, "--", rel]);
  return head(tree);
};
/** The range a lens's dispatch block reads, from and to, and its paths. */
const rangeOf = (out, agent) => {
  const [, from, to, paths] = /^ {2}range ([0-9a-f]+)\.\.([0-9a-f]+) paths (.+)$/m.exec(block(out, agent).join("\n"));
  return { from, to, paths: paths.split(" ") };
};
const LENSES = ["specsmd-inferno-reviewer", "specsmd-inferno-reviewer-quality"];
const note = (h) => path.join(h.fixture.cache, "specsmd-inferno", "app", "review-lenses", "alpha", "a-one.json");

test("a correction and another item's commit landing before the record leave the stamp on the commit read, and the delta reads the correction in each lens", () => {
  const h = host();
  assert.equal(h.review().code, 3);
  const readAt = head(h.tree);
  write(h.tree, REVIEW, contractFix("major"));
  write(h.tree, QUALITY, qualityFix("major"));
  const correction = commitOnly(h.tree, "src/a.ts", "export const a = 3;\n", "the correction");
  commitOnly(h.tree, "docs/b.md", "a-two's docs\n", "a-two's work");

  const recorded = h.review();

  assert.equal(recorded.code, 3, shown(recorded));
  assert.match(recorded.out, new RegExp(`^review a-one fix, recorded at ${readAt.slice(0, 7)}`, "m"));
  assert.match(recorded.out, /^FINDING AC1 the value reads two src\/a\.ts:1: /m);
  assert.doesNotMatch(recorded.out, /^next /m, "no builder takes the findings before the correction is read");
  assert.match(recorded.out, new RegExp(`^then run\\.cjs review --item a-one --tree \\S+: the item changed after its reviewer read it at ` +
    `${readAt.slice(0, 7)}, and that change is read before a builder takes a finding$`, "m"));
  assert.match(ledger(h.tree), new RegExp(`review_commit: ${readAt}\\n`));
  for (const file of [REVIEW, QUALITY]) assert.match(read(h.tree, file), new RegExp(`^commit: ${readAt}$`, "m"));
  const landing = h.at(["integrate", "--item", "a-one"]);
  assert.notEqual(landing.code, 0, shown(landing));

  const delta = h.review();

  assert.equal(delta.code, 3, shown(delta));
  for (const agent of LENSES) {
    const range = rangeOf(delta.out, agent);
    assert.ok(readAt.startsWith(range.from), `${agent} reads from the commit read: ${range.from}`);
    assert.ok(git(h.tree, ["rev-list", `${range.from}..${range.to}`]).split("\n").includes(correction), `${agent}'s range holds the correction`);
    assert.deepEqual(range.paths, ["src/a.ts"]);
  }

  // The next record stamps the end of its own dispatch: the range of the round before is forgotten.
  const deltaAt = head(h.tree);
  write(h.tree, REVIEW, CLEAN);
  write(h.tree, QUALITY, QCLEAN);
  const clean = h.review();
  assert.equal(clean.code, 0, shown(clean));
  assert.match(ledger(h.tree), new RegExp(`review_commit: ${deltaAt}\\n`));
});

test("a commit between the dispatch and the record that touches none of the item's paths owes nothing", () => {
  const h = host();
  assert.equal(h.review().code, 3);
  const readAt = head(h.tree);
  write(h.tree, REVIEW, contractFix("major"));
  write(h.tree, QUALITY, QCLEAN);
  commitOnly(h.tree, "docs/b.md", "a-two's docs\n", "a-two's work");

  const recorded = h.review();

  assert.equal(recorded.code, 2, shown(recorded));
  assert.match(recorded.out, /^next .*, then commit and run review again$/m, "the findings go to the builder the ladder names");
  assert.doesNotMatch(recorded.out, /changed after its reviewer read/);
  assert.match(ledger(h.tree), new RegExp(`review_commit: ${readAt}\\n`));
  const again = h.review();
  assert.equal(again.code, 2, shown(again));
  assert.match(again.out, new RegExp(`^review a-one fix for the current files \\(read at ${readAt.slice(0, 7)}\\)`, "m"));
});

test("a clean review whose listed file changed after its read is owed again and never lands", () => {
  const h = host();
  assert.equal(h.review().code, 3);
  const readAt = head(h.tree);
  write(h.tree, REVIEW, CLEAN);
  write(h.tree, QUALITY, QCLEAN);
  commitOnly(h.tree, "src/a.ts", "export const a = 5;\n", "a later change");

  const recorded = h.review(["--json"]);

  assert.equal(recorded.code, 3, shown(recorded));
  const payload = JSON.parse(recorded.out);
  assert.deepEqual([payload.ok, payload.verdict, payload.owed], [false, "clean", "review"]);
  const landing = h.at(["integrate", "--item", "a-one"]);
  assert.notEqual(landing.code, 0, shown(landing));
  assert.match(shown(landing), /a-one: a file it lists changed since its review/);
  const delta = h.review();
  assert.equal(delta.code, 3, shown(delta));
  assert.ok(readAt.startsWith(rangeOf(delta.out, LENSES[0]).from));
});

test("the record's line for a clean review read before a change says the change is read before the item lands", () => {
  const h = host();
  assert.equal(h.review().code, 3);
  const readAt = head(h.tree);
  write(h.tree, REVIEW, CLEAN);
  write(h.tree, QUALITY, QCLEAN);
  commitOnly(h.tree, "src/a.ts", "export const a = 5;\n", "a later change");
  const recorded = h.review();
  assert.equal(recorded.code, 3, shown(recorded));
  assert.match(recorded.out, new RegExp(`: the item changed after its reviewer read it at ${readAt.slice(0, 7)}, and that change is read before the item lands$`, "m"));
  assert.doesNotMatch(recorded.out, /integrate --item/);
});

test("a file of the item the review does not list, changed after the read, owes a fix review its delta and leaves a clean one standing", () => {
  for (const [body, quality, code] of [[contractFix("major"), qualityFix("major"), 3], [CLEAN, QCLEAN, 0]]) {
    const h = host();
    assert.equal(h.review().code, 3);
    write(h.tree, REVIEW, body);
    write(h.tree, QUALITY, quality);
    // a-one owns src/a2.test.ts, which neither file lists: the usual answer to a criterion with no test.
    commitOnly(h.tree, "src/a2.test.ts", "// the missing test\n", "a new test of the item");

    const recorded = h.review();

    assert.equal(recorded.code, code, shown(recorded));
    if (code === 0) assert.match(recorded.out, /^then run\.cjs integrate --item a-one /m);
    else assert.match(recorded.out, /that change is read before a builder takes a finding$/m);
  }
});

test("a dispatch printed again with a newer end stamps the oldest end printed since the last record", () => {
  const h = host();
  assert.equal(h.review().code, 3);
  const first = head(h.tree);
  const second = commitOnly(h.tree, "src/a.ts", "export const a = 6;\n", "the builder's last commit");
  const again = h.review();
  assert.equal(again.code, 3, shown(again));
  assert.ok(second.startsWith(rangeOf(again.out, LENSES[0]).to), "the second print ends at the newer commit");
  write(h.tree, REVIEW, CLEAN);
  write(h.tree, QUALITY, QCLEAN);

  const recorded = h.review();

  assert.equal(recorded.code, 3, shown(recorded));
  assert.match(ledger(h.tree), new RegExp(`review_commit: ${first}\\n`));
  const delta = h.review();
  for (const agent of LENSES) {
    const range = rangeOf(delta.out, agent);
    assert.ok(first.startsWith(range.from), `${agent} reads from the oldest end: ${range.from}`);
    assert.ok(git(h.tree, ["rev-list", `${range.from}..${range.to}`]).split("\n").includes(second), `${agent}'s range holds the newer commit`);
  }
});

test("a record with no range noted, as for a dispatch the released flow printed or a cache someone removed, stamps HEAD as before", () => {
  for (const kept of [null, { lenses: ["contract", "quality"] }]) {
    const h = host();
    assert.equal(h.review().code, 3);
    if (kept) writeFile(note(h), `${JSON.stringify(kept)}\n`);
    else fs.rmSync(note(h));
    write(h.tree, REVIEW, CLEAN);
    write(h.tree, QUALITY, QCLEAN);
    const at = commitOnly(h.tree, "src/a.ts", "export const a = 7;\n", "a later change");

    const recorded = h.review();

    assert.equal(recorded.code, 0, shown(recorded));
    assert.match(ledger(h.tree), new RegExp(`review_commit: ${at}\\n`));
    assert.match(read(h.tree, QUALITY), new RegExp(`^commit: ${at}$`, "m"));
  }
});

test("a read commit that HEAD's history no longer holds stamps the newest commit both hold, and the review holds only for the bytes read", () => {
  for (const [bytes, holds] of [["export const a = 8;\n", false], [null, true]]) {
    const h = host();
    assert.equal(h.review().code, 3);
    const parent = git(h.tree, ["rev-parse", "HEAD~1"]);
    // History rewritten since the dispatch: the item's commit amended, its bytes changed or kept.
    if (bytes) write(h.tree, "src/a.ts", bytes);
    git(h.tree, ["add", "--", "src/a.ts"]);
    git(h.tree, ["commit", "-q", "--amend", "-m", "a-one built, amended"]);
    write(h.tree, REVIEW, CLEAN);
    write(h.tree, QUALITY, QCLEAN);

    const recorded = h.review();

    assert.equal(recorded.code, holds ? 0 : 3, shown(recorded));
    assert.match(ledger(h.tree), new RegExp(`review_commit: ${parent}\\n`));
    const next = h.review();
    if (holds) {
      assert.equal(next.code, 0, shown(next));
      continue;
    }
    assert.equal(next.code, 3, shown(next));
    assert.ok(parent.startsWith(rangeOf(next.out, LENSES[0]).from), "the delta reads every change since the commit both histories hold");
  }
});
