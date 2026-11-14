const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { CONFIG, STATE, git, heldMutate, killedMutate, repo, reviewed, run, write } = require("./review-fixture.cjs");
const origin = require("./run-fixture.cjs");

// Integrate lands a reviewed item while sibling builders and reviewers work in the same tree. It
// refuses only the uncommitted files it would read or commit: what the landing owns, the ledger
// files its completion commits, and what a check it runs reads. One uncommitted sibling file
// anywhere used to hold every landing: a pending review outside every scope refused integrate
// with DIRTY (measured 2026-11-09 at 2205834).

const SIBLINGS = STATE.replace("        depends_on: [a-one]", "        depends_on: []");
const SCOPED = CONFIG.replace("    - echo integrate ran\n", '    - echo scoped\n  finalize_scopes:\n    "echo scoped": ["src/**"]\n');
const UNSCOPED = CONFIG.replace("echo integrate ran", "echo always");
const TWO = SCOPED.replace("    - echo scoped\n", "    - echo scoped\n    - echo docs\n")
  .replace('"echo scoped": ["src/**"]', '"echo scoped": ["src/**"]\n    "echo docs": ["docs/**"]');
const PENDING = ".specs-inferno/intents/alpha/reviews/a-two.yaml";
const LEDGER = ".specs-inferno/state.yaml";

/**
 * a-one commits src/a.ts and is reviewed clean. The fixture is on main with no origin, where
 * integrate would run every scoped check, so every call passes --since the commit before the landing.
 */
function landed(config = SCOPED, options = {}) {
  const fixture = repo({ state: SIBLINGS, config, ...options });
  fixture.since = git(fixture.root, ["rev-parse", "HEAD"]);
  write(fixture.root, "src/a.ts", "export const a = 4;\n");
  git(fixture.root, ["commit", "-qam", "a-one landed"]);
  reviewed(run, fixture, fixture.root, ["a-one"]);
  return fixture;
}

const integrate = (fixture, ...args) => run(fixture, ["integrate", "--tree", fixture.root, "--since", fixture.since, ...args]);
const land = (fixture) => integrate(fixture, "--item", "a-one");
const read = (fixture, rel) => fs.readFileSync(path.join(fixture.root, rel), "utf8");
const proved = (fixture) => /integrated_sha:/.test(read(fixture, LEDGER));
const listed = (text) => text.split("\n").filter(Boolean);
const uncommitted = (fixture) => [
  ...listed(git(fixture.root, ["diff", "--name-only", "HEAD"])),
  ...listed(git(fixture.root, ["ls-files", "--others", "--exclude-standard"])),
].sort();

/** Run `call` while a mutate holds a mutant in `file`, and let the mutate finish whatever happens. */
async function besideMutate(fixture, file, call) {
  const held = await heldMutate(fixture, fixture.root, file, "mutated line");
  try {
    return call();
  } finally {
    await held.release();
  }
}

test("a reviewed item integrates beside a sibling's uncommitted file outside the running scopes", () => {
  const fixture = landed();
  write(fixture.root, "docs/sibling.md", "a sibling's draft\n");
  write(fixture.root, "docs/b.md", "a sibling's edit\n");

  const result = land(fixture);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /PASS \d+s echo scoped/);
  assert.match(result.out, /^completed a-one at \w+$/m);
  assert.ok(proved(fixture));
  assert.deepEqual(uncommitted(fixture), ["docs/b.md", "docs/sibling.md"]);
});

test("a sibling file inside a running check's scope is refused", () => {
  const fixture = landed();
  write(fixture.root, "src/b2.ts", "export const b2 = 0;\n");

  const result = land(fixture);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /ERROR \[DIRTY\] .*a check this landing runs.*: src\/b2\.ts\./);
  assert.doesNotMatch(result.out, /PASS|GREEN/, "no check ran over the sibling's bytes");
  assert.ok(!proved(fixture));

  for (const name of ["b3", "b4", "b5", "b6", "b7"]) write(fixture.root, `src/${name}.ts`, `export const ${name} = 0;\n`);
  const many = land(fixture);
  assert.equal(many.code, 2, many.out + many.err);
  assert.match(many.err, /: src\/b2\.ts, src\/b3\.ts, src\/b4\.ts, src\/b5\.ts, src\/b6\.ts and 1 more\./);
});

test("an uncommitted file the item owns is refused", () => {
  const fixture = landed();
  write(fixture.root, "src/a.ts", "export const a = 5;\n");

  const result = land(fixture);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /ERROR \[DIRTY\] .*this landing owns or commits: src\/a\.ts\./);
  assert.ok(!proved(fixture));
});

// Owned outside every scope, so only the ownership rule can hold it: as a live mutant and as an edit.
test("a file the item owns outside every scope holds the landing, as a live mutant and as an edit", async () => {
  const fixture = landed(SCOPED, { editable: ["src/a.ts", "notes/a-one.md"], files: { "notes/a-one.md": "a one notes\n" } });

  const live = await besideMutate(fixture, "notes/a-one.md", () => land(fixture));
  assert.equal(live.code, 2, live.out + live.err);
  assert.match(live.err, /another mutate \(pid \d+\) is running on notes\/a-one\.md/);

  write(fixture.root, "notes/a-one.md", "an edit after the commit\n");
  const edited = land(fixture);
  assert.equal(edited.code, 2, edited.out + edited.err);
  assert.match(edited.err, /ERROR \[DIRTY\] .*this landing owns or commits: notes\/a-one\.md\./);
  assert.ok(!proved(fixture));
});

test("an unscoped check reads every path outside .specs-inferno", () => {
  const fixture = landed(UNSCOPED);
  write(fixture.root, "docs/sibling.md", "a sibling's draft\n");

  const refused = land(fixture);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /ERROR \[DIRTY\] .*a check this landing runs.*: docs\/sibling\.md\./);

  fs.rmSync(path.join(fixture.root, "docs/sibling.md"));
  write(fixture.root, PENDING, "item: a-two\nverdict: clean\nfiles: [src/b.ts]\n");
  const result = land(fixture);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /PASS \d+s echo always/);
  assert.deepEqual(uncommitted(fixture), [PENDING]);
});

// The selection reads committed paths only: a sibling's edit to a tracked file in the skipped
// check's scope shows in a diff against the working tree, and must not select that check.
test("a file outside a skipped check's scope is tolerated", () => {
  const fixture = landed(TWO);
  write(fixture.root, "docs/sibling.md", "a sibling's draft\n");
  write(fixture.root, "docs/b.md", "a sibling's edit\n");

  const result = land(fixture);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /SKIP echo docs \(no path in scope changed\)/);
  assert.match(result.out, /PASS \d+s echo scoped/);
  assert.deepEqual(uncommitted(fixture), ["docs/b.md", "docs/sibling.md"]);
});

test("a live mutate on a sibling file outside every integrate scope does not hold the landing", async () => {
  const fixture = landed();

  const result = await besideMutate(fixture, "docs/b.md", () => land(fixture));

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /completed a-one at/);
  assert.equal(read(fixture, "docs/b.md"), "docs\n", "the mutate put its own file back");
});

// Before the fold the running set is not known, so a live mutant in any configured scope holds.
test("a live mutate inside a configured scope holds the landing, even one this landing skips", async () => {
  const fixture = landed(TWO);

  const result = await besideMutate(fixture, "docs/b.md", () => land(fixture));

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /another mutate \(pid \d+\) is running on docs\/b\.md/);
  assert.ok(!proved(fixture));
});

test("a landing refuses an uncommitted ledger file it commits, and a fold-and-check call tolerates it", () => {
  const fixture = landed();
  for (const rel of [LEDGER, ".specs-inferno/intents/alpha/work-items/a-one.md"]) {
    const was = read(fixture, rel);
    write(fixture.root, rel, `${was}# an uncommitted note\n`);
    const refused = land(fixture);
    assert.equal(refused.code, 2, refused.out + refused.err);
    assert.match(refused.err, new RegExp(`ERROR \\[DIRTY\\] .*this landing owns or commits: ${rel.replace(/[.]/g, "\\.")}\\.`));
    const checked = integrate(fixture);
    assert.equal(checked.code, 0, checked.out + checked.err);
    write(fixture.root, rel, was);
  }
  assert.ok(!proved(fixture));
});

test("a sibling's uncommitted work-item file stays out of the landing and out of its ledger commit", () => {
  const fixture = landed();
  const sibling = ".specs-inferno/intents/alpha/work-items/a-two.md";
  write(fixture.root, sibling, `${read(fixture, sibling)}# the sibling's planner note\n`);

  const result = land(fixture);

  assert.equal(result.code, 0, result.out + result.err);
  assert.deepEqual(uncommitted(fixture), [sibling]);
});

// A check that writes while it runs stands in for a sibling writing beside the landing. The
// writer's own scope is src/a.ts, so its own proof never sees the write: only the landing's does.
test("a write outside the running scopes leaves the landing standing, and one inside them reds it as moved", () => {
  const writes = (target) => SCOPED.replace("    - echo scoped\n", `    - echo scoped\n    - touch ${target}\n`)
    .replace('"echo scoped": ["src/**"]', `"echo scoped": ["src/**"]\n    "touch ${target}": ["src/a.ts"]`);

  const outside = landed(writes("docs/late.md"));
  const kept = land(outside);
  assert.equal(kept.code, 0, kept.out + kept.err);
  assert.match(kept.out, /PASS \d+s touch docs\/late\.md/);
  assert.ok(proved(outside));

  const inside = landed(writes("src/late.ts"));
  const moved = land(inside);
  assert.match(moved.out, /PASS \d+s touch src\/late\.ts/);
  assert.equal(moved.code, 2, moved.out + moved.err);
  assert.match(moved.out, /the code changed while integrate ran/);
  assert.ok(!proved(inside));
});

// The browser step reads the whole tree whenever it runs, as a check with no scope entry does.
// a-one owns a spec, so the step runs at its landing, while every integrate check is scoped to src/.
const BROWSER = SCOPED.replace("    - echo scoped\n", "    - echo scoped\n    - touch docs/late.md\n")
  .replace("  finalize_scopes:\n", "  integrate_e2e:\n    command: echo ran\n  finalize_scopes:\n")
  .replace('"echo scoped": ["src/**"]', '"echo scoped": ["src/**"]\n    "touch docs/late.md": ["src/a.ts"]');
const OWNS_SPEC = { editable: ["src/a.ts", "e2e/a.spec.ts"] };

test("a browser step that runs reads the whole tree: a sibling file outside every scoped check is refused, and a write there reds the landing", () => {
  const beside = landed(BROWSER, OWNS_SPEC);
  write(beside.root, "docs/sibling.md", "a sibling's draft\n");
  const refused = land(beside);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /ERROR \[DIRTY\] .*a check this landing runs reads: docs\/sibling\.md\./);
  assert.ok(!proved(beside));

  const fixture = landed(BROWSER, OWNS_SPEC);
  const moved = land(fixture);
  assert.match(moved.out, /PASS \d+s touch docs\/late\.md/);
  assert.match(moved.out, /PASS \d+s echo ran e2e\/a\.spec\.ts/);
  assert.equal(moved.code, 2, moved.out + moved.err);
  assert.match(moved.out, /the code changed while integrate ran/);
  assert.ok(!proved(fixture));
});

for (const [name, dirt, said] of [
  ["a check's scope", "src/b2.ts", /a check this landing runs/],
  ["the landing's ledger", LEDGER, /this landing owns or commits/],
]) {
  test(`a refusal over ${name} still says what it restored first`, async () => {
    const fixture = landed();
    await killedMutate(fixture, fixture.root, "src/a.ts", "export const a = 99;");
    write(fixture.root, dirt, `${fs.existsSync(path.join(fixture.root, dirt)) ? read(fixture, dirt) : ""}# uncommitted\n`);

    const result = land(fixture);

    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, said);
    assert.match(result.err, /^restored src\/a\.ts from an interrupted mutate$/m);
    assert.equal(read(fixture, "src/a.ts"), "export const a = 4;\n");
  });
}

// A refusal raised while integrate reads its config or the landing's work-item files comes
// before it knows what the landing reads, and still puts a dead mutant back first.
for (const [name, unread, said] of [
  ["a --config it cannot read", (fixture) => ["--config", path.join(fixture.root, "missing.yaml")], /ERROR \[BAD_CONFIG\]/],
  ["a work-item file it cannot find", (fixture) => {
    fs.rmSync(path.join(fixture.root, ".specs-inferno/intents/alpha/work-items/a-one.md"));
    return [];
  }, /ERROR \[SPEC_MISSING\]/],
]) {
  test(`a refusal over ${name} still puts a killed mutate's leftover back first and says so`, async () => {
    const fixture = landed();
    await killedMutate(fixture, fixture.root, "src/a.ts", "export const a = 99;");

    const result = integrate(fixture, "--item", "a-one", ...unread(fixture));

    assert.equal(result.code, 2, result.out + result.err);
    assert.match(result.err, said);
    assert.match(result.err, /^restored src\/a\.ts from an interrupted mutate$/m);
    assert.equal(read(fixture, "src/a.ts"), "export const a = 4;\n");
  });
}

// The browser step selects from committed paths only: a sibling's uncommitted file its map
// covers never selects it, so that file is never refused for a step that does not run.
const MAPPED = SCOPED.replace("  finalize_scopes:\n",
  '  integrate_e2e:\n    command: echo ran\n    map:\n      "docs/**": [e2e/docs.spec.ts]\n  finalize_scopes:\n');

test("a sibling's uncommitted file never selects the browser step", () => {
  const fixture = landed(MAPPED);
  write(fixture.root, "docs/sibling.md", "a sibling's draft\n");

  const result = land(fixture);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /SKIP e2e \(/);
  assert.doesNotMatch(result.out, /echo ran/);
  assert.deepEqual(uncommitted(fixture), ["docs/sibling.md"]);
});

// The selection reads the intent's committed paths of its own range, which reaches back past the
// landing's --since: a path a-two committed there selects the step, and a sibling's edit on top
// of it is then refused as what the step reads, never dropped to a SKIP.
test("a committed path a sibling has dirty again is refused, never skipped", () => {
  const fixture = repo({ state: SIBLINGS, config: MAPPED });
  git(fixture.root, ["checkout", "-qb", "feature"]);
  write(fixture.root, "docs/b.md", "a-two's committed edit\n");
  git(fixture.root, ["commit", "-qam", "a-two committed docs"]);
  fixture.since = git(fixture.root, ["rev-parse", "HEAD"]);
  write(fixture.root, "src/a.ts", "export const a = 4;\n");
  git(fixture.root, ["commit", "-qam", "a-one landed"]);
  reviewed(run, fixture, fixture.root, ["a-one"]);
  write(fixture.root, "docs/b.md", "a sibling's edit on top\n");

  const result = land(fixture);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /ERROR \[DIRTY\] .*a check this landing runs reads: docs\/b\.md\./);
  assert.doesNotMatch(result.out + result.err, /SKIP e2e/);
  assert.ok(!proved(fixture));
});

/** A clone with a local commit its bare origin lacks, after origin's main moved docs/b.md and added docs/new.md. */
function originMoved() {
  const fixture = origin.repo();
  const other = path.join(fixture.dir, "other");
  origin.git(fixture.dir, ["clone", "-q", "-b", "main", fixture.remote, other]);
  origin.git(other, ["config", "user.email", "test@example.com"]);
  origin.git(other, ["config", "user.name", "Test"]);
  origin.write(other, "docs/b.md", "moved on origin\n");
  origin.write(other, "docs/new.md", "added on origin\n");
  origin.git(other, ["add", "-A"]);
  origin.git(other, ["commit", "-qm", "origin moved the docs"]);
  origin.git(other, ["push", "-q", "origin", "main"]);
  origin.write(fixture.root, "docs/local.md", "committed here, never pushed\n");
  origin.git(fixture.root, ["add", "-A"]);
  origin.git(fixture.root, ["commit", "-qm", "a local commit origin lacks"]);
  return fixture;
}

test("a fold the sibling's file blocks names that file", () => {
  const fixture = originMoved();
  // Only HEAD's side changed docs/local.md since the merge base, and no side changed src/b.ts:
  // both are uncommitted and unstaged, and neither stops the merge, so neither is named.
  origin.write(fixture.root, "docs/local.md", "a sibling's edit on top\n");
  origin.write(fixture.root, "src/b.ts", "export const b = 7;\n");
  origin.write(fixture.root, "docs/b.md", "a sibling's edit\n");
  origin.write(fixture.root, "docs/new.md", "a sibling's new file\n");

  const result = origin.run(fixture, ["integrate", "--tree", fixture.root]);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /ERROR \[DIRTY\] refusing to fold origin\/main into main over .*: docs\/b\.md, docs\/new\.md\. /);
  assert.doesNotMatch(result.err, /docs\/local\.md|src\/b\.ts/);
  assert.doesNotMatch(result.out + result.err, /conflict folding/);
});

// Git refuses a real merge over any staged change, whether the incoming commits touch it or not:
// a sibling caught between its git add and its git commit.
test("a fold a sibling's staged file blocks names that file, though the incoming commits never touch it", () => {
  const fixture = originMoved();
  origin.write(fixture.root, "src/b.ts", "export const b = 7;\n");
  origin.git(fixture.root, ["add", "src/b.ts"]);

  const result = origin.run(fixture, ["integrate", "--tree", fixture.root]);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /ERROR \[DIRTY\] refusing to fold origin\/main into main over .*: src\/b\.ts\. /);
  assert.doesNotMatch(result.out + result.err, /conflict folding/);
});

test("the item review refuses an owned new file inside a new directory", () => {
  const fixture = repo({ editable: ["src/new/a.ts"] });
  write(fixture.root, "src/new/a.ts", "export const fresh = 1;\n");
  write(fixture.root, ".specs-inferno/intents/alpha/reviews/a-one.yaml", "item: a-one\nverdict: clean\nfiles: [src/new/a.ts]\n");

  const result = run(fixture, ["review", "--item", "a-one", "--tree", fixture.root, "--reviewer", "rev-1"]);

  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /ERROR \[DIRTY\] .*src\/new\/a\.ts/);
});
