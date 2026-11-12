const assert = require("node:assert/strict");
const test = require("node:test");

const { ITEMS, STATE, item, repo, run } = require("./run-fixture.cjs");

// A later item may name under context.required or reads a file an item it depends on, directly
// or through others, creates: that item owns it under ownership.editable and has not completed.
// Once it completed the existence check holds again, so a file it never made is caught before
// the later item starts. The same plan without the dependency is refused as before.

const NEW = "src/coupon.ts";
const owner = item({ id: "a-one", intent: "alpha", editable: ["src/a.ts", NEW] });
const needs = (field, depends = ["a-one"], id = "a-two") =>
  item({ id, intent: "alpha", depends_on: depends, editable: [`src/${id}.ts`], [field]: [NEW] });
const plan = (field = "required", state = STATE, extra = {}) =>
  repo({ state, items: { ...ITEMS, "alpha/a-one": owner, "alpha/a-two": needs(field), ...extra } });

const COMPLETED = "        status: completed\n        completed_at: 2026-11-10T08:00:00Z\n        integrated_sha: abc1234\n        review: clean\n        depends_on: []\n      - id: a-two";
const completed = STATE.replace("        status: pending\n        depends_on: []\n      - id: a-two", COMPLETED);
const deferred = STATE.replace("        status: pending\n        depends_on: []\n      - id: a-two", "        status: deferred\n        depends_on: []\n      - id: a-two");
const unordered = STATE.replace("        depends_on: [a-one]\n  - id: beta", "        depends_on: []\n  - id: beta");
const THIRD = "      - id: a-three\n        title: \"A three\"\n        kind: behavior\n        complexity: low\n        status: pending\n        depends_on: [a-two]\n";
const chained = STATE.replace("        depends_on: [a-one]\n  - id: beta", `        depends_on: [a-one]\n${THIRD}  - id: beta`);

for (const field of ["required", "reads"]) {
  const label = field === "required" ? "context.required" : "reads";

  test(`a later item whose ${label} names a file its dependency owns and has not made gives a frontier of that dependency`, () => {
    const result = run(plan(field), ["frontier", "alpha"]);
    assert.equal(result.code, 0, result.out + result.err);
    assert.match(result.out, /^ready a-one /m);
    assert.match(result.out, /^waiting a-two on a-one$/m);
    assert.doesNotMatch(result.out, /INVALID/);
  });

  test(`the same ${label} without the depends_on is refused`, () => {
    const result = run(plan(field, unordered), ["frontier", "alpha"]);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.out, new RegExp(`^INVALID a-two: ${label} path does not exist: src/coupon\\.ts, and no item a-two depends on owns it$`, "m"));
    assert.doesNotMatch(result.out, /^ready /m);
  });

  test(`once the dependency completed without making the file, the frontier refuses the later item's ${label}`, () => {
    const result = run(plan(field, completed), ["frontier", "alpha"]);
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.out, new RegExp(`^INVALID a-two: ${label} path does not exist: src/coupon\\.ts, and a-one, which owns it, completed without creating it$`, "m"));
  });
}

test("a dependency through a third item counts: the owner is reached through the item between", () => {
  const fixture = plan("required", chained, {
    "alpha/a-two": item({ id: "a-two", intent: "alpha", depends_on: ["a-one"], editable: ["src/b.ts"] }),
    "alpha/a-three": needs("required", ["a-two"], "a-three"),
  });
  const result = run(fixture, ["frontier", "alpha"]);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^ready a-one /m);
  assert.match(result.out, /^waiting a-three on a-two$/m);
});

test("an item whose own file does not exist yet is still refused: only a dependency creates for it", () => {
  const fixture = repo({ items: { ...ITEMS, "alpha/a-one": item({ id: "a-one", intent: "alpha", editable: [NEW], required: [NEW] }) } });
  const result = run(fixture, ["frontier", "alpha"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^INVALID a-one: context\.required path does not exist: src\/coupon\.ts, and no item a-one depends on owns it$/m);
});

test("a deferred owner creates nothing, so it never excuses the missing path, and the refusal says so", () => {
  const result = run(plan("required", deferred), ["frontier", "alpha"]);
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.out, /^INVALID a-two: context\.required path does not exist: src\/coupon\.ts, and a-one, which owns it, is deferred, so nothing creates it$/m);
});
