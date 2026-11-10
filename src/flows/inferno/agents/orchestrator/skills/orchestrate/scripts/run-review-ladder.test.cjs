const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { nextActor, nextLine, tierOf } = require("./run-review.cjs");
const { weightOf } = require("./run-review-file.cjs");
const { STATE, git, repo, run, write } = require("./review-fixture.cjs");
const { SURVIVES_TWO, mutantRepo } = require("./run-review-mutants-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

// --- the ladder has an end -------------------------------------------------------
// Complexity alone decides who builds first. A miss is a fix review that weighs serious: a
// blocker or major finding, or a mutant that survived. The item counts its misses once and
// never starts over when the tier changes. Miss 1 stays with the warm builder, or goes to a
// fresh strong one from the cheap tier; miss 2 goes to a fresh escalate builder; miss 3 to the
// oracle, whose decision the escalate builder builds; miss 4 ends the ladder at the user. A
// minor-only fix review is no miss, and a finding that repeats goes to the oracle at once.

const REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const ledger = (fixture) => fs.readFileSync(path.join(fixture.root, ".specs-inferno/state.yaml"), "utf8");
const review = (fixture, args = []) => run(fixture, ["review", "--item", "a-one", "--tree", fixture.root, "--reviewer", "rev-1", ...args]);
const nextOf = (result) => result.out.split("\n").find((line) => line.startsWith("next "));

const finding = (extra) => `  - criterion: AC1 the value reads two
    file: src/a.ts
    line: 1
    evidence: read src/a.ts, it exports 1
    fix: export 2
${extra}`;
const fixReview = (...findings) => `item: a-one\nverdict: fix\nfiles: [src/a.ts]\nfindings:\n${findings.join("")}`;
const MINOR = finding("    severity: minor\n");
const MAJOR = finding("    severity: major\n");

const MEDIUM = STATE.replace("        complexity: low\n", "        complexity: medium\n");

/** Commit one more correction of src/a.ts, then record `body` as the next review of a-one. */
let round = 0;
function corrected(fixture, body) {
  round += 1;
  write(fixture.root, "src/a.ts", `export const a = ${round + 10};\n`);
  git(fixture.root, ["commit", "-qam", `correction ${round}`]);
  write(fixture.root, REVIEW, body);
  return review(fixture);
}

const refused = (fixture, body, pattern) => {
  write(fixture.root, REVIEW, body);
  const result = review(fixture);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, pattern);
  assert.doesNotMatch(ledger(fixture), /review:/);
};

test("tierOf decides by complexity only", () => {
  assert.equal(tierOf({ complexity: "low", kind: "behavior" }), "cheap");
  assert.equal(tierOf({ complexity: "medium", kind: "docs-only" }), "strong");
  assert.equal(tierOf({ complexity: "high", kind: "test" }), "strong");
  assert.equal(tierOf({ complexity: "low", kind: "config" }), "cheap");
});

test("an item nobody rejected stays with the tier its complexity names", () => {
  assert.deepEqual(nextActor({ complexity: "low" }), {
    actor: "cheap", agent: "specsmd-inferno-builder-cheap", builder: "cheap", fresh: false, misses: 0,
  });
  assert.equal(nextActor({ complexity: "medium" }).actor, "strong");
  assert.equal(nextActor({ complexity: "medium", review: "clean", review_tier: "escalate", review_misses: 4, review_weight: "none" }).actor,
    "escalate", "a clean review sends nobody up the ladder");
});

test("each miss names the next rung, and miss 4 ends the ladder at the user", () => {
  const at = (misses, extra = {}) => nextActor({ complexity: "medium", review: "fix", review_weight: "serious", review_misses: misses, ...extra });
  assert.deepEqual(at(1, { review_tier: "strong" }), {
    actor: "strong", agent: "specsmd-inferno-builder", builder: "strong", fresh: false, misses: 1,
  });
  assert.deepEqual(at(1, { review_tier: "cheap", complexity: "low" }), {
    actor: "strong", agent: "specsmd-inferno-builder", builder: "strong", fresh: true, misses: 1,
  });
  assert.deepEqual(at(2, { review_tier: "strong" }), {
    actor: "escalate", agent: "specsmd-inferno-builder-escalate", builder: "escalate", fresh: true, misses: 2,
  });
  assert.deepEqual(at(3, { review_tier: "escalate" }), {
    actor: "oracle", agent: "specsmd-inferno-oracle", builder: "escalate", fresh: false, misses: 3,
  });
  assert.deepEqual(at(3, { review_tier: "strong" }), {
    actor: "oracle", agent: "specsmd-inferno-oracle", builder: "escalate", fresh: true, misses: 3,
  }, "miss 3 after an oracle answered a repeat still goes to the escalate builder, fresh");
  assert.deepEqual(at(4, { review_tier: "escalate" }), { actor: "user", agent: null, builder: "escalate", fresh: false, misses: 4 });
  assert.equal(at(5, { review_tier: "escalate" }).actor, "user", "a miss after the user's answer goes back to the user");
  assert.deepEqual(at(4, { review_tier: "strong" }), { actor: "user", agent: null, builder: "escalate", fresh: true, misses: 4 },
    "the user's answer goes to the escalate builder");
});

test("the oracle line names who builds the decision, and a repeat at miss 3 reads as the miss", () => {
  const item = (tier, weight) => ({ complexity: "medium", review: "fix", review_tier: tier, review_misses: 3, review_weight: weight });
  assert.match(nextLine("a-one", item("strong", "serious"), {}), /its decision goes to a fresh escalate builder with every finding so far, then commit/);
  assert.match(nextLine("a-one", item("escalate", "serious"), {}), /its decision goes to the warm escalate builder as a correction, then commit/);
  assert.match(nextLine("a-one", item("escalate", "repeat"), {}), /^next oracle specsmd-inferno-oracle: a-one missed 3 reviews, so ask it/);
});

test("the ladder reads the weight of the last fix review", () => {
  const at = (tier, misses, weight) => nextActor({ complexity: "high", review: "fix", review_tier: tier, review_misses: misses, review_weight: weight });
  assert.deepEqual(at("escalate", 3, "minor"), { actor: "escalate", agent: "specsmd-inferno-builder-escalate", builder: "escalate", fresh: false, misses: 3 });
  assert.equal(at("escalate", 3, "serious").actor, "oracle");
  assert.equal(at("cheap", 1, "minor").actor, "cheap");
  assert.equal(at("cheap", 1, "serious").actor, "strong");
  assert.deepEqual(at("cheap", 0, "repeat"), { actor: "oracle", agent: "specsmd-inferno-oracle", builder: "cheap", fresh: false, misses: 0 });
  assert.equal(at("strong", 1, "repeat").actor, "oracle");
  assert.equal(at("strong", 2, "repeat").builder, "strong", "a repeat below miss 3 goes back to the warm builder of its tier");
  assert.equal(at("escalate", 4, "repeat").actor, "user", "at the end of the ladder a repeat goes to the user too");
  assert.equal(at("escalate", 4, "minor").actor, "escalate", "a minor-only round is no miss, even at the end");
  assert.equal(at("strong", 2, undefined).actor, "escalate", "a ledger written before the weight climbs as before");
});

// --- a ledger the released flow wrote ----------------------------------------------
// It counted per tier and started over on each one, in `review_rejections`. Read without a
// `review_misses`, the tiers below the recorded one add the misses that climbed them: cheap to
// strong took one, strong to escalate took two.

test("a released flow's per-tier count reads as the misses that reached its rung", () => {
  const released = (complexity, tier, count) => nextActor({
    complexity, review: "fix", review_tier: tier, review_rejections: count, review_weight: "serious",
  });
  assert.deepEqual([released("low", "cheap", 1).actor, released("low", "cheap", 1).misses], ["strong", 1]);
  assert.deepEqual([released("low", "strong", 1).actor, released("low", "strong", 1).misses], ["escalate", 2]);
  assert.deepEqual([released("medium", "strong", 1).actor, released("medium", "strong", 1).misses], ["strong", 1]);
  assert.deepEqual([released("medium", "strong", 2).actor, released("medium", "strong", 2).misses], ["escalate", 2]);
  assert.deepEqual([released("medium", "escalate", 1).actor, released("medium", "escalate", 1).misses], ["oracle", 3]);
  assert.deepEqual([released("low", "escalate", 1).actor, released("low", "escalate", 1).misses], ["user", 4]);
  assert.deepEqual([released("medium", "escalate", 2).actor, released("medium", "escalate", 2).misses], ["user", 4]);
  assert.equal(nextActor({ complexity: "medium", review: "fix", review_tier: "strong", review_rejections: 9, review_misses: 1, review_weight: "serious" }).misses,
    1, "a recorded miss count wins over the old field");
});

test("a released flow's ledger and review file still read, and the next record counts on from them", () => {
  const fixture = repo({ state: MEDIUM });
  write(fixture.root, REVIEW, fixReview(MAJOR));
  review(fixture);
  // The ledger as the released flow left it: an escalate builder rejected once, counted per tier.
  const file = path.join(fixture.root, ".specs-inferno/state.yaml");
  writeFile(file, ledger(fixture).replace("review_tier: strong", "review_tier: escalate").replace(/review_misses: \d+/, "review_rejections: 1"));
  git(fixture.root, ["commit", "-qam", "the released flow's ledger"]);

  const asRecorded = review(fixture);
  assert.equal(asRecorded.code, 2, asRecorded.out + asRecorded.err);
  assert.match(asRecorded.out, /FINDING AC1 the value reads two src\/a\.ts:1/);
  assert.match(nextOf(asRecorded), /^next oracle specsmd-inferno-oracle: a-one missed 3 reviews, so ask it about a-one/);

  const next = corrected(fixture, fixReview(MAJOR));
  assert.equal(next.code, 2, next.out + next.err);
  assert.match(ledger(fixture), /review_misses: 4/);
  assert.doesNotMatch(ledger(fixture), /review_rejections/, "the record keeps one count");
  assert.match(nextOf(next), /^next user: a-one missed 4 reviews/);
});

// --- the count on the ledger ---------------------------------------------------------

test("refused severities and repeats never reach the ledger", () => {
  const fixture = repo();
  refused(fixture, fixReview(finding("")), /BAD_REVIEW.*findings entry 1 severity reads nothing.*blocker.*major.*minor.*send this back/);
  refused(fixture, fixReview(finding("    severity: low\n")), /BAD_REVIEW.*severity reads low; it must be blocker/);
  refused(fixture, fixReview(finding("    severity:\n")), /BAD_REVIEW.*severity reads nothing; it must be blocker.*major.*minor/);
  refused(fixture, fixReview(finding("    severity: [major]\n")), /BAD_REVIEW.*severity reads a list; it must be blocker/);
  refused(fixture, fixReview(finding("    severity: minor\n    repeat: maybe\n")), /BAD_REVIEW.*repeat reads maybe.*write repeat: true/);
  refused(fixture, fixReview(finding("    severity: minor\n    repeat:\n")), /BAD_REVIEW.*repeat reads nothing.*write repeat: true/);
  refused(fixture, fixReview(finding("    severity: minor\n    repeat: [true]\n")), /BAD_REVIEW.*repeat reads a list.*write repeat: true/);
  refused(fixture, fixReview(finding("    severity: minor\n    repeat: true\n")), /BAD_REVIEW.*first review.*drop repeat: true.*send this back/);
});

test("a minor-only fix review is no miss and names the warm builder of the same tier", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, fixReview(MINOR, MINOR));

  const result = review(fixture);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(ledger(fixture), /review_misses: 0/);
  assert.match(ledger(fixture), /review_weight: minor/);
  assert.match(nextOf(result), /^next cheap model-cheap specsmd-inferno-builder-cheap: every finding is minor, so send them to the warm builder of a-one/);
  assert.match(nextOf(result), /run verify-item on it, commit and run review again/);
  assert.equal(run(fixture, ["frontier", "alpha"]).out.includes(nextOf(result)), true);
});

test("a blocker or a major finding is a miss", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, fixReview(MINOR, MAJOR));
  const result = review(fixture);
  assert.match(ledger(fixture), /review_misses: 1/);
  assert.match(nextOf(result), /^next strong model-strong specsmd-inferno-builder: a fresh builder takes a-one over/);
  const blocker = repo();
  write(blocker.root, REVIEW, fixReview(finding("    severity: blocker\n")));
  review(blocker);
  assert.match(ledger(blocker), /review_misses: 1/);
});

test("a surviving mutant is a miss even when every finding is minor", () => {
  const fixture = mutantRepo();
  write(fixture.root, REVIEW, `${fixReview(MINOR)}mutants:\n${SURVIVES_TWO}`);
  const result = review(fixture);
  assert.match(ledger(fixture), /review_misses: 1/);
  assert.match(nextOf(result), /^next strong model-strong specsmd-inferno-builder: a fresh builder/);
});

test("the runner's survivor finding weighs serious, in the runner's shape and in the released flow's", () => {
  const ran = { findings: [{ severity: "major", mutant: "2" }], survivors: [{ criterion: "2", caught: "no" }] };
  assert.deepEqual(weightOf(ran), { serious: true, weight: "serious" });
  assert.deepEqual(weightOf({ findings: [{ severity: "major", mutant: "2" }], survivors: [] }), { serious: true, weight: "serious" });
  assert.deepEqual(weightOf({ findings: [{ severity: "minor" }], survivors: [{ criterion: "AC2", caught: "no" }] }), { serious: true, weight: "serious" });
  assert.deepEqual(weightOf({ findings: [{ severity: "minor" }], survivors: [] }), { serious: false, weight: "minor" });
});

test("the count survives a tier change", () => {
  const fixture = repo();
  write(fixture.root, REVIEW, fixReview(MAJOR));
  review(fixture);
  assert.match(ledger(fixture), /review_tier: cheap\n\s+review_misses: 1/);

  const second = corrected(fixture, fixReview(MAJOR));

  assert.match(ledger(fixture), /review_tier: strong\n\s+review_misses: 2/, "the fresh strong builder's miss counts on");
  assert.match(nextOf(second), /^next escalate model-escalate specsmd-inferno-builder-escalate: a fresh builder takes a-one over/);
  corrected(fixture, fixReview(MINOR));
  assert.match(ledger(fixture), /review_tier: escalate\n\s+review_misses: 2/, "a minor-only round keeps the count on the new tier");
});

test("miss 1 to miss 4 each name the right next actor, from the warm strong builder to the user", () => {
  const fixture = repo({ state: MEDIUM });
  write(fixture.root, REVIEW, fixReview(MAJOR));
  const one = review(fixture);
  assert.match(nextOf(one), /^next strong model-strong specsmd-inferno-builder: send every finding to the warm builder of a-one/);

  const two = corrected(fixture, fixReview(MAJOR));
  assert.match(nextOf(two), /^next escalate model-escalate specsmd-inferno-builder-escalate: a fresh builder takes a-one over/);
  assert.match(nextOf(two), /reproduces what still fails, names its root cause and why both fixes missed, then fixes/);

  const three = corrected(fixture, fixReview(MAJOR));
  assert.match(ledger(fixture), /review_tier: escalate\n\s+review_misses: 3/);
  assert.match(nextOf(three), /^next oracle specsmd-inferno-oracle: a-one missed 3 reviews, so ask it about a-one with every finding so far/);
  assert.match(nextOf(three), /graded complexity "high earlier: /);
  assert.match(nextOf(three), /its decision goes to the warm escalate builder as a correction/);

  const four = corrected(fixture, fixReview(MAJOR));
  assert.equal(four.code, 2, four.out + four.err);
  assert.match(ledger(fixture), /review_tier: escalate\n\s+review_misses: 4/);
  assert.match(nextOf(four), /^next user: a-one missed 4 reviews, so the ladder ends and no builder takes it: put it before the user in two sentences/);
  assert.match(nextOf(four), /with your recommendation, and keep building every item that does not depend on it/);
  assert.equal(JSON.parse(review(fixture, ["--json"]).out).next.actor, "user");
});

test("a repeat finding goes to the oracle at once, and counts as a miss only when it weighs serious", () => {
  const fixture = repo({ state: MEDIUM });
  write(fixture.root, REVIEW, fixReview(MAJOR));
  review(fixture);
  const minor = corrected(fixture, fixReview(finding("    severity: minor\n    repeat: true\n")));

  assert.equal(minor.code, 2, minor.out + minor.err);
  assert.match(ledger(fixture), /review_misses: 1/);
  assert.match(ledger(fixture), /review_weight: repeat/);
  assert.match(nextOf(minor), /^next oracle specsmd-inferno-oracle: a finding repeats an earlier round, so ask it about a-one .*warm strong builder/);

  corrected(fixture, fixReview(finding("    severity: major\n    repeat: true\n")));
  assert.match(ledger(fixture), /review_tier: strong\n\s+review_misses: 2\n\s+review_weight: repeat/, "the oracle's decision was built warm on strong");
  corrected(fixture, fixReview(MAJOR));
  assert.match(ledger(fixture), /review_tier: strong\n\s+review_misses: 3\n\s+review_weight: serious/);
});

// --- miss 4 blocks the item, and only the item ------------------------------------------

const THREE = `${STATE}      - id: a-three
        title: "A three"
        kind: behavior
        complexity: medium
        status: pending
        depends_on: []
`;
const blockedAt = (misses) => THREE.replace(
  "        complexity: low\n        status: pending\n",
  "        complexity: low\n        status: pending\n        review: fix\n        review_hash: " + "a".repeat(64) +
    `\n        review_commit: abc1234\n        review_tier: escalate\n        review_misses: ${misses}\n        review_weight: serious\n`,
);
const A_THREE = `---\nid: a-three\ntitle: "a-three"\nintent: alpha\nstatus: pending\ndepends_on: []\n---\n\n# Work Item: a-three\n\n` +
  "## Execution Manifest\n\ncontext:\n  required:\n    - path: src/b.ts\n      reason: why\n  patterns:\n    - path: src/b.ts\n      reason: why\n" +
  "  tests:\n    - path: src/a.test.ts\n      reason: why\nownership:\n  editable:\n    - docs/three.md\n";

test("miss 4 blocks the item: frontier gives out an unrelated item and holds back a dependent one", () => {
  const fixture = repo({ state: blockedAt(4), files: { ".specs-inferno/intents/alpha/work-items/a-three.md": A_THREE } });

  const result = run(fixture, ["frontier", "alpha"]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^blocked a-one: the ladder ended at miss 4, so no builder takes it until the user answers$/m);
  assert.match(result.out, /^next user: a-one missed 4 reviews/m);
  assert.doesNotMatch(result.out, /^ready a-one/m);
  assert.match(result.out, /^ready a-three medium behavior strong model-strong$/m);
  assert.match(result.out, /^waiting a-two on a-one$/m);
  const payload = JSON.parse(run(fixture, ["frontier", "alpha", "--json"]).out);
  assert.deepEqual(payload.blocked, ["a-one"]);
  assert.deepEqual(payload.ready.map((item) => item.id), ["a-three"]);
  assert.deepEqual(payload.dispatch, ["a-three"]);
  assert.deepEqual(payload.waiting.map((item) => item.id), ["a-two"]);
});

test("an item at miss 3 is no blocked item: frontier gives it out with its oracle line", () => {
  const fixture = repo({ state: blockedAt(3), files: { ".specs-inferno/intents/alpha/work-items/a-three.md": A_THREE } });
  const result = run(fixture, ["frontier", "alpha"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.doesNotMatch(result.out, /^blocked /m);
  assert.match(result.out, /^ready a-one low behavior oracle$/m);
  assert.match(result.out, /^next oracle specsmd-inferno-oracle: a-one missed 3 reviews/m);
});
