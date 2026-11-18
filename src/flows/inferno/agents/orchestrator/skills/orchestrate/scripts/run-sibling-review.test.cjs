"use strict";

// What keeps a sibling's `Item:` trailer honest is the item's review. Once verify-item read a
// sibling's commit to a file both items own (run-sibling.test.cjs), the item's review is owed
// over a range that holds that commit, and integrate refuses with ITEM_REVIEW_OWED until that
// review is on record: from a first review on record with every verdict the flow has. A minor
// fix never settles over another item's commit, which no reviewer of this item read.

const assert = require("node:assert/strict");
const test = require("node:test");

const { git, repo, run, write } = require("./review-fixture.cjs");

const REVIEW = ".specs-inferno/intents/alpha/reviews/a-one.yaml";
const SHARED = "docs/b.md";
const CLEAN = `item: a-one\nverdict: clean\nfiles: [src/a.ts, ${SHARED}]\n`;
const fix = (severity) => `item: a-one
verdict: fix
files: [src/a.ts, ${SHARED}]
findings:
  - criterion: AC1 the value reads two
    file: src/a.ts
    line: 1
    evidence: the name a reads as nothing
    fix: name it count
    severity: ${severity}
`;

/** A builder's turn the way the orchestrator runs it: dispatch-log, the files written, accept-dispatch. */
function turn(host, item, files) {
  const logged = host.at("dispatch-log", "alpha", "--item", item, "--tier", "cheap", "--agent", "specsmd-inferno-builder-cheap", "--json");
  assert.equal(logged.code, 0, logged.out + logged.err);
  for (const [file, body] of Object.entries(files)) write(host.tree, file, body);
  const accepted = host.at("accept-dispatch", JSON.parse(logged.out).dispatch_id, "--changed-paths", JSON.stringify(Object.keys(files)));
  assert.equal(accepted.code, 0, accepted.out + accepted.err);
}

/** Commit the files under `item`'s trailer and the `extra` trailer lines, the way the orchestrator lands an item. Returns the commit. */
function land(host, item, files, extra = []) {
  git(host.tree, ["add", "--", ...files]);
  git(host.tree, ["commit", "-q", "-m", `land ${item}`, "-m", [`Item: ${item}`, ...extra].join("\n")]);
  return git(host.tree, ["rev-parse", "HEAD"]);
}

const verified = (host) => {
  const result = host.at("verify-item", "a-one");
  assert.equal(result.code, 0, result.out + result.err);
  return result;
};

/**
 * Item a-one, which owns the shared file beside a-two, built, proved, landed, and its first review
 * recorded from `body`, after `before` ran on the landed host.
 */
function reviewed(body, code, before = () => {}) {
  const fixture = repo({ editable: ["src/a.ts", SHARED] });
  const host = { fixture, tree: fixture.root, at: (...args) => run(fixture, [...args, "--tree", fixture.root]) };
  turn(host, "a-one", { "src/a.ts": "export const a = 1; // built\n", [SHARED]: "docs\nby a-one\n" });
  verified(host);
  host.landed = land(host, "a-one", ["src/a.ts", SHARED]);
  before(host);
  write(host.tree, REVIEW, body);
  const recorded = host.at("review", "--item", "a-one", "--reviewer", "rev-1");
  assert.equal(recorded.code, code, recorded.out + recorded.err);
  return host;
}

/** Sibling a-two changes the shared file after a-one's accept and lands under its own trailer and the `extra` lines. */
function siblingLands(host, extra = []) {
  turn(host, "a-two", { [SHARED]: "docs\nby a-one\nby a-two\n", "src/b.ts": "export const b = 3;\n" });
  return land(host, "a-two", [SHARED, "src/b.ts"], extra);
}

/** The lines an item commit carries beside its Item line: the builder's cases and a host's co-author. */
const BESIDE = ["Cases: TC-1", "Co-Authored-By: A Builder <builder@example.test>"];

/**
 * The sibling's commit read by verify-item owes a-one's review over a range from the commit the
 * review read that holds the sibling's commit, integrate refuses until it is on record, and lands once it is.
 */
function owedUntilReviewed(host, sibling, reason) {
  assert.match(verified(host).out, /^docs\/b\.md: commit [0-9a-f]+ of a-two changed it after the accepted dispatch of a-one, .* is owed for /m);
  const owed = host.at("review", "--item", "a-one", "--json");
  assert.equal(owed.code, 3, owed.out + owed.err);
  const payload = JSON.parse(owed.out);
  assert.match(payload.owed, reason);
  const [from] = payload.range.split("..");
  assert.equal(git(host.tree, ["rev-parse", from]), host.landed);
  assert.ok(git(host.tree, ["rev-list", payload.range]).split("\n").includes(sibling), `${payload.range} holds ${sibling}`);
  const refused = host.at("integrate", "--item", "a-one");
  assert.equal(refused.code, 3, refused.out + refused.err);
  assert.match(refused.err, /ERROR \[ITEM_REVIEW_OWED\]/);
  write(host.tree, REVIEW, CLEAN);
  const recorded = host.at("review", "--item", "a-one", "--reviewer", "rev-2");
  assert.equal(recorded.code, 0, recorded.out + recorded.err);
  const landed = host.at("integrate", "--item", "a-one");
  assert.equal(landed.code, 0, landed.out + landed.err);
}

test("a clean review on record is owed again over the sibling's commit, and integrate waits for it", () => {
  const host = reviewed(CLEAN, 0);
  owedUntilReviewed(host, siblingLands(host), /^the item changed since the last review$/);
});

test("a serious fix review on record is owed again over the sibling's commit, and integrate waits for it", () => {
  const host = reviewed(fix("major"), 2);
  owedUntilReviewed(host, siblingLands(host), /^the item changed since the last review$/);
});

test("a minor fix review on record never settles over the sibling's commit: its review is owed, and integrate waits for it", () => {
  const host = reviewed(fix("minor"), 2);
  const sibling = siblingLands(host);
  owedUntilReviewed(host, sibling, new RegExp(`^commit ${sibling.slice(0, 7)}[0-9a-f]* of a-two changed a file the review lists, and a settle takes only the warm builder's correction$`));
});

test("a settled review on record is owed again over the sibling's commit, and integrate waits for it", () => {
  const host = reviewed(fix("minor"), 2);
  // The warm builder's correction, landed under the item's own trailer, settles as before.
  turn(host, "a-one", { "src/a.ts": "export const count = 1; // built\n" });
  verified(host);
  land(host, "a-one", ["src/a.ts"]);
  const settled = host.at("review", "--item", "a-one");
  assert.equal(settled.code, 0, settled.out + settled.err);
  assert.match(settled.out, /^review a-one settled at /m);
  owedUntilReviewed(host, siblingLands(host), /^a file the settled review lists changed since it settled$/);
});

test("a sibling's commit to its own files only leaves a minor fix to settle", () => {
  const host = reviewed(fix("minor"), 2);
  turn(host, "a-two", { "src/b.ts": "export const b = 3;\n" });
  land(host, "a-two", ["src/b.ts"]);
  turn(host, "a-one", { "src/a.ts": "export const count = 1; // built\n" });
  verified(host);
  land(host, "a-one", ["src/a.ts"]);
  const settled = host.at("review", "--item", "a-one");
  assert.equal(settled.code, 0, settled.out + settled.err);
  assert.match(settled.out, /^review a-one settled at /m);
});

test("a sibling's commit the fix review already read leaves the minor fix to settle", () => {
  const host = reviewed(fix("minor"), 2, siblingLands);
  turn(host, "a-one", { "src/a.ts": "export const count = 1; // built\n", [SHARED]: "docs\nby a-one\nby a-two\nnamed by a-one\n" });
  verified(host);
  land(host, "a-one", ["src/a.ts", SHARED]);
  const settled = host.at("review", "--item", "a-one");
  assert.equal(settled.code, 0, settled.out + settled.err);
  assert.match(settled.out, /^review a-one settled at /m);
});

test("a minor fix whose correction touches a file named with a leading dash settles as before", () => {
  const fixture = repo({ editable: ["src/a.ts", "-notes.md"], files: { "-notes.md": "notes\n" } });
  const host = { fixture, tree: fixture.root, at: (...args) => run(fixture, [...args, "--tree", fixture.root]) };
  turn(host, "a-one", { "src/a.ts": "export const a = 1; // built\n", "-notes.md": "notes\nby a-one\n" });
  verified(host);
  land(host, "a-one", ["src/a.ts", "-notes.md"]);
  write(host.tree, REVIEW, fix("minor").replace(`files: [src/a.ts, ${SHARED}]`, "files: [src/a.ts, -notes.md]"));
  assert.equal(host.at("review", "--item", "a-one", "--reviewer", "rev-1").code, 2);
  turn(host, "a-one", { "-notes.md": "notes\nby a-one, named\n" });
  verified(host);
  land(host, "a-one", ["-notes.md"]);
  const settled = host.at("review", "--item", "a-one");
  assert.equal(settled.code, 0, settled.out + settled.err);
  assert.match(settled.out, /^review a-one settled at /m);
});

test("a sibling's commit naming another item beside its Cases and co-author lines still owes the minor fix a review", () => {
  const host = reviewed(fix("minor"), 2);
  const sibling = siblingLands(host, BESIDE);
  owedUntilReviewed(host, sibling, new RegExp(`^commit ${sibling.slice(0, 7)}[0-9a-f]* of a-two changed a file the review lists, and a settle takes only the warm builder's correction$`));
});

test("a correction landed with its Cases and co-author lines beside the item's own Item line still settles", () => {
  const host = reviewed(fix("minor"), 2);
  turn(host, "a-one", { "src/a.ts": "export const count = 1; // built\n" });
  verified(host);
  land(host, "a-one", ["src/a.ts"], BESIDE);
  const settled = host.at("review", "--item", "a-one");
  assert.equal(settled.code, 0, settled.out + settled.err);
  assert.match(settled.out, /^review a-one settled at /m);
});
