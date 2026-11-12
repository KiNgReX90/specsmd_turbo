const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { git, write } = require("./review-fixture.cjs");
const { QUALITY, REVIEW, block, contractFix, firstRound, host, ledger, qualityFix, shown } = require("./run-review-quality-fixture.cjs");

// A file the orchestrator granted a dispatch of the item (run.cjs grant) is the item's as if its
// spec listed it, though the grant sits on the dispatch record and never in the spec. A correction
// round reads every file changed since the review on record that the spec owns, the last review
// lists, or a dispatch of the item claimed, grants included: the step and the record's refusal
// print it under paths for both lenses, a later commit on it owes the review again, and a minor
// correction that touched it never settles unread.

const GUARD = "src/gift-card-guard.ts";
const CONTRACT = "specsmd-inferno-reviewer";
const QUALITY_AGENT = "specsmd-inferno-reviewer-quality";

/** The paths of one lens's range line in `out`. */
function pathsOf(out, agent) {
  const line = block(out, agent).find((entry) => /^ {2}range /.test(entry));
  assert.ok(line, `no range line under ${agent} in: ${out}`);
  return line.replace(/^ {2}range \S+ paths /, "").split(" ");
}

/**
 * A builder's turn: dispatch-log, the grants, the files written, accept-dispatch of what the
 * builder `reported` (every file written unless told), the commit. With `accept: false` the turn
 * is committed while its dispatch is still open.
 */
function builderTurn(h, files, granted = [], { reported = Object.keys(files), accept = true } = {}) {
  const logged = h.at(["dispatch-log", "alpha", "--item", "a-one", "--tier", "cheap", "--agent", "specsmd-inferno-builder-cheap", "--json"]);
  assert.equal(logged.code, 0, shown(logged));
  const id = JSON.parse(logged.out).dispatch_id;
  for (const file of granted) {
    const result = h.at(["grant", id, "--path", file]);
    assert.equal(result.code, 0, shown(result));
  }
  for (const [rel, body] of Object.entries(files)) write(h.tree, rel, body);
  if (accept) {
    const accepted = h.at(["accept-dispatch", id, "--changed-paths", JSON.stringify(reported)]);
    assert.equal(accepted.code, 0, shown(accepted));
  }
  git(h.tree, ["add", "--", ...Object.keys(files)]);
  git(h.tree, ["commit", "-qm", "a builder's turn on a-one"]);
}

/** a-one's first round recorded with both lenses, `contract` and `quality` their bodies. */
function recorded(h, contract = contractFix(), quality = qualityFix()) {
  const result = firstRound(h, contract, quality);
  assert.equal(result.code, 2, shown(result));
  return h;
}

test("a correction that adds a granted file prints it under paths for both lenses", () => {
  const h = recorded(host());
  builderTurn(h, { "src/a.ts": "export const a = 3;\n", [GUARD]: "export const guard = true;\n" }, [GUARD]);

  const result = h.review(["--json"]);

  assert.equal(result.code, 3, shown(result));
  const payload = JSON.parse(result.out);
  assert.deepEqual(payload.paths, ["src/a.ts", GUARD]);
  assert.deepEqual(payload.quality.paths, ["src/a.ts", GUARD]);
  const printed = h.review();
  for (const agent of [CONTRACT, QUALITY_AGENT]) assert.deepEqual(pathsOf(printed.out, agent), ["src/a.ts", GUARD], agent);
});

test("the record's refusal of a lens still unwritten dispatches it again with the granted file under paths", () => {
  const h = recorded(host());
  builderTurn(h, { "src/a.ts": "export const a = 3;\n", [GUARD]: "export const guard = true;\n" }, [GUARD]);
  assert.equal(h.review().code, 3);
  write(h.tree, REVIEW, contractFix().replace("files: [src/a.ts]", `files: [src/a.ts, ${GUARD}]`));

  const waiting = h.review();

  assert.equal(waiting.code, 3, shown(waiting));
  assert.match(waiting.out, /^refusing to record the review of a-one: \S+quality\/a-one\.yaml is not written/m);
  assert.deepEqual(pathsOf(waiting.out, QUALITY_AGENT), ["src/a.ts", GUARD]);
  assert.equal(git(h.tree, ["log", "-1", "--format=%s"]), "a builder's turn on a-one", "nothing is recorded");
});

test("a commit on a granted file after a fix review owes the review again", () => {
  const h = host();
  builderTurn(h, { [GUARD]: "export const guard = 1;\n" }, [GUARD]);
  recorded(h);
  assert.match(ledger(h.tree), /review: fix\n/);
  // The fix of a red integrate, on the granted file alone, which neither lens lists.
  write(h.tree, GUARD, "export const guard = 2;\n");
  git(h.tree, ["commit", "-qam", "the guard answers the red integrate"]);

  const result = h.review();

  assert.equal(result.code, 3, shown(result));
  assert.match(result.out, /^review owed for a-one: the item changed since the last review$/m);
  for (const agent of [CONTRACT, QUALITY_AGENT]) assert.deepEqual(pathsOf(result.out, agent), ["src/a.ts", GUARD], agent);
});

test("a granted file that did not change since the recorded commit is not listed", () => {
  const h = host();
  builderTurn(h, { [GUARD]: "export const guard = 1;\n" }, [GUARD]);
  recorded(h);
  builderTurn(h, { "src/a.ts": "export const a = 3;\n" });

  const result = h.review();

  assert.equal(result.code, 3, shown(result));
  for (const agent of [CONTRACT, QUALITY_AGENT]) assert.deepEqual(pathsOf(result.out, agent), ["src/a.ts"], agent);
});

test("a minor correction that touched a granted file owes a delta review and never settles unread", () => {
  const minor = contractFix("minor");
  const h = recorded(host(), minor, qualityFix("minor"));
  assert.match(ledger(h.tree), /review_weight: minor\n/);
  builderTurn(h, { "src/a.ts": "export const a = 3;\n", [GUARD]: "export const guard = true;\n" }, [GUARD]);
  const proved = h.at(["verify-item", "a-one"]);
  assert.equal(proved.code, 0, shown(proved));

  const result = h.review();

  assert.equal(result.code, 3, shown(result));
  assert.match(result.out, new RegExp(`^review owed for a-one: the correction of the minor findings touches ${GUARD}, which the review does not list$`, "m"));
  for (const agent of [CONTRACT, QUALITY_AGENT]) assert.deepEqual(pathsOf(result.out, agent), ["src/a.ts", GUARD], agent);
  assert.doesNotMatch(ledger(h.tree), /review: settled/);
  assert.ok(fs.existsSync(path.join(h.tree, QUALITY)));
});

// --- what makes a file the item's: the grant, a reported change, a carried one -------------------

const OUTSIDE = "src/stray-helper.ts";

test("a granted file the accept does not report is still read by both lenses, and a later commit on it owes the review again", () => {
  const h = recorded(host());
  builderTurn(h, { "src/a.ts": "export const a = 3;\n", [GUARD]: "export const guard = true;\n" }, [GUARD], { reported: ["src/a.ts"] });

  const correction = h.review();

  assert.equal(correction.code, 3, shown(correction));
  for (const agent of [CONTRACT, QUALITY_AGENT]) assert.deepEqual(pathsOf(correction.out, agent), ["src/a.ts", GUARD], agent);

  // The delta round recorded fix, listing src/a.ts alone; then a commit on the granted file only.
  write(h.tree, REVIEW, contractFix());
  write(h.tree, QUALITY, qualityFix());
  assert.equal(h.review().code, 2);
  write(h.tree, GUARD, "export const guard = false;\n");
  git(h.tree, ["commit", "-qam", "the guard alone changes again"]);

  const again = h.review();

  assert.equal(again.code, 3, shown(again));
  assert.match(again.out, /^review owed for a-one: the item changed since the last review$/m);
  for (const agent of [CONTRACT, QUALITY_AGENT]) assert.deepEqual(pathsOf(again.out, agent), ["src/a.ts", GUARD], agent);
});

test("a granted file committed while its correction dispatch is still open is read by both lenses", () => {
  const h = recorded(host());
  builderTurn(h, { "src/a.ts": "export const a = 3;\n", [GUARD]: "export const guard = true;\n" }, [GUARD], { accept: false });

  const result = h.review();

  assert.equal(result.code, 3, shown(result));
  assert.match(result.out, /^review owed for a-one: the item changed since the last review$/m);
  for (const agent of [CONTRACT, QUALITY_AGENT]) assert.deepEqual(pathsOf(result.out, agent), ["src/a.ts", GUARD], agent);
});

test("a file outside the item that its correction reported, with no grant, is read by both lenses", () => {
  const h = recorded(host());
  builderTurn(h, { "src/a.ts": "export const a = 3;\n", [OUTSIDE]: "export const helper = 1;\n" });

  const result = h.review();

  assert.equal(result.code, 3, shown(result));
  for (const agent of [CONTRACT, QUALITY_AGENT]) assert.deepEqual(pathsOf(result.out, agent), ["src/a.ts", OUTSIDE], agent);
});

test("a file an earlier attempt wrote and the next attempt carries is read by both lenses", () => {
  const h = recorded(host());
  // The first attempt of the correction writes a file outside the item and is never accepted.
  builderTurn(h, { [OUTSIDE]: "export const helper = 1;\n" }, [], { accept: false });
  // The next attempt changes src/a.ts and reports the earlier file too, which it carries.
  builderTurn(h, { "src/a.ts": "export const a = 3;\n" }, [], { reported: ["src/a.ts", OUTSIDE] });

  const result = h.review();

  assert.equal(result.code, 3, shown(result));
  for (const agent of [CONTRACT, QUALITY_AGENT]) assert.deepEqual(pathsOf(result.out, agent), ["src/a.ts", OUTSIDE], agent);
});
