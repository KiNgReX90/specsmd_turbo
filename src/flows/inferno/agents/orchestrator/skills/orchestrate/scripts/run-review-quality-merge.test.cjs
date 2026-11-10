const assert = require("node:assert/strict");
const test = require("node:test");

const { git, write } = require("./review-fixture.cjs");
const quality = require("./run-review-quality.cjs");
const { weightOf } = require("./run-review-file.cjs");
const { QUALITY, REVIEW, contractFix, firstRound, host, ledger, qualityFix, shown } = require("./run-review-quality-fixture.cjs");

// The contract file and the quality file of an item read as one review: `fix` when either says
// so, the files of both, and the same fault from both lenses, the same file and line, sent to the
// builder once at the higher severity, a repeat when either lens marked it one. The ladder weighs
// that one reading. The rest of the lens: run-review-quality.test.cjs.

test("the same file and line from both lenses goes to the builder once, at the higher severity", () => {
  const h = host();
  const result = firstRound(h, contractFix("minor"), qualityFix("blocker"));

  assert.equal(result.code, 2, shown(result));
  assert.equal(result.out.match(/^FINDING /gm).length, 1, result.out);
  const payload = JSON.parse(h.review(["--json"]).out);
  assert.equal(payload.findings.length, 1);
  assert.equal(payload.findings[0].severity, "blocker");
  assert.match(ledger(h.tree), /review_weight: serious/);

  const apart = host();
  const two = firstRound(apart, contractFix("minor"), qualityFix("minor", { line: 2 }));
  assert.equal(two.out.match(/^FINDING /gm).length, 2, "another line is another fault");
});

test("the one reading weighs both lenses: a serious finding of either is serious, minors of both are minor", () => {
  const contract = { verdict: "fix", files: ["src/a.ts"], findings: [{ criterion: "AC1", file: "src/a.ts", line: "1", severity: "minor" }], mutants: [], survivors: [], pins: [] };
  const lens = (severity, extra = {}) => ({ verdict: "fix", files: ["src/b.ts"], findings: [{ id: "Q1", check: "fit", file: "src/a.ts", line: "4", severity, ...extra }], lint: [] });
  assert.equal(weightOf(quality.mergeReviews(contract, lens("minor"))).weight, "minor");
  assert.equal(weightOf(quality.mergeReviews(contract, lens("major"))).weight, "serious");
  assert.equal(weightOf(quality.mergeReviews(contract, lens("minor", { repeat: "true" }))).weight, "repeat");
  const same = (extra) => ({ ...lens("major", extra), findings: [{ ...lens("major", extra).findings[0], line: "1" }] });
  assert.equal(weightOf(quality.mergeReviews({ ...contract, findings: [{ ...contract.findings[0], repeat: "true" }] }, same())).weight, "repeat",
    "the one finding kept repeats when the dropped one did");
  assert.equal(weightOf(quality.mergeReviews(contract, same({ repeat: "true" }))).weight, "repeat");
  // The contract finding is kept for its severity, and the quality finding it stands in for repeated.
  const major = { ...contract, findings: [{ ...contract.findings[0], severity: "major" }] };
  const kept = quality.mergeReviews(major, { ...lens("minor", { repeat: "true" }), findings: [{ ...lens("minor", { repeat: "true" }).findings[0], line: "1" }] });
  assert.equal(kept.findings.length, 1);
  assert.deepEqual([kept.findings[0].criterion, kept.findings[0].severity, kept.findings[0].repeat], ["AC1", "major", "true"]);
  assert.equal(weightOf(kept).weight, "repeat");
  assert.deepEqual(quality.mergeReviews(contract, lens("minor")).files, ["src/a.ts", "src/b.ts"]);
  assert.equal(quality.mergeReviews(contract, null), contract, "no quality file reads as the contract review alone");
  const clean = { ...contract, verdict: "clean", findings: [] };
  assert.equal(quality.mergeReviews(clean, { ...lens("minor"), verdict: "clean", findings: [] }).verdict, "clean");
  assert.equal(quality.mergeReviews(clean, lens("minor")).verdict, "fix");
});

test("a quality finding marked repeat on the line of an unmarked contract finding makes the review weigh repeat", () => {
  const h = host();
  assert.equal(firstRound(h, contractFix("major"), qualityFix("minor")).code, 2);
  assert.match(ledger(h.tree), /review_weight: serious/);
  write(h.tree, "src/a.ts", "export const a = 4;\n");
  git(h.tree, ["commit", "-qam", "the fix"]);
  assert.equal(h.review().code, 3);
  // Both lenses find their earlier finding still open; only the quality lens marks it a repeat.
  write(h.tree, REVIEW, contractFix("major"));
  write(h.tree, QUALITY, qualityFix("minor", { extra: "    repeat: true\n" }));

  const result = h.review();

  assert.equal(result.code, 2, shown(result));
  assert.equal(result.out.match(/^FINDING /gm).length, 1, result.out);
  assert.match(result.out, /^FINDING AC1 the value reads two src\/a\.ts:1: /m, "the contract finding is kept for its severity");
  assert.match(ledger(h.tree), /review_weight: repeat/);
  const [finding] = JSON.parse(h.review(["--json"]).out).findings;
  assert.deepEqual([finding.severity, finding.repeat], ["major", "true"]);
});
