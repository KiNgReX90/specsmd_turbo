const assert = require("node:assert/strict");
const test = require("node:test");
const { CONFIG, git, repo, run, write } = require("./run-fixture.cjs");

// A direct build commits on the base branch of the primary checkout and runs integrate there.
// The merge base with the base is HEAD on that branch, so a selection anchored on it skipped
// every scoped check right after a commit that touched its scope (measured 2026-11-09 at
// 2205834). Integrate diffs from --since, else from origin/<base>, as a lanes-only start does.
const BASE = CONFIG.replace(
  '  finalize_scopes:\n    "echo scoped": ["docs/**"]',
  '  integrate:\n    - echo always\n    - echo scoped\n  finalize_scopes:\n    "echo scoped": ["src/**"]',
);
const DOUBLES = `${BASE}doubles:\n  pattern: 'FAKE'\n  paths: ['src/**']\n`;

const integrate = (fixture, ...args) => run(fixture, ["integrate", "--tree", fixture.root, ...args]);

function commit(fixture, rel, body) {
  write(fixture.root, rel, body);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", `landed ${rel}`]);
}

test("a commit on the base selects its scoped checks", () => {
  const fixture = repo({ config: BASE });
  commit(fixture, "src/a.ts", "export const a = 4;\n");
  const result = integrate(fixture);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /PASS \d+s echo scoped/);
  assert.match(result.out, /PASS \d+s echo always/);
});

test("a docs commit on the base still skips the src check", () => {
  const fixture = repo({ config: BASE });
  commit(fixture, "docs/b.md", "docs moved\n");
  const result = integrate(fixture);
  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /SKIP echo scoped \(no path in scope changed\)/);
  assert.match(result.out, /PASS \d+s echo always/);
});

test("after a push --since names the landing, and without it every scoped check runs", () => {
  const fixture = repo({ config: BASE });
  commit(fixture, "src/a.ts", "export const a = 4;\n");
  git(fixture.root, ["push", "-q", "origin", "main"]);
  const named = integrate(fixture, "--since", "HEAD~1");
  assert.equal(named.code, 0, named.out + named.err);
  assert.match(named.out, /PASS \d+s echo scoped/);
  const bare = integrate(fixture);
  assert.equal(bare.code, 0, bare.out + bare.err);
  assert.match(bare.out, /^on main with no unpushed commit and no --since: every scoped check runs$/m);
  assert.doesNotMatch(bare.out, /SKIP echo scoped/);
  // The tree --since just proved is unchanged, so the scoped check answers from its proof.
  assert.match(bare.out, /^(PASS|GREEN) \d+s echo scoped/m);
});

test("--since naming no commit is refused", () => {
  const fixture = repo({ config: BASE });
  commit(fixture, "src/a.ts", "export const a = 4;\n");
  const result = integrate(fixture, "--since", "nosuchref");
  assert.equal(result.code, 2, result.out + result.err);
  assert.match(result.err, /BAD_REF/);
  assert.doesNotMatch(result.out, /echo scoped/);
});

test("doubles on the base counts HEAD against the landing", () => {
  const rose = repo({ config: DOUBLES });
  commit(rose, "src/fake.ts", "export const fake = 'FAKE';\n");
  const refused = integrate(rose);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.out, /FAIL doubles 0 -> 1/);
  assert.doesNotMatch(refused.out, /echo scoped/);

  const held = repo({ config: DOUBLES });
  commit(held, "src/a.ts", "export const a = 4;\n");
  const passed = integrate(held);
  assert.equal(passed.code, 0, passed.out + passed.err);
  assert.match(passed.out, /PASS doubles/);
  assert.match(passed.out, /PASS \d+s echo scoped/);
});

test("run.cjs doubles on the base counts against --since and refuses without a landing to count from", () => {
  const fixture = repo({ config: DOUBLES });
  commit(fixture, "src/fake.ts", "export const fake = 'FAKE';\n");
  git(fixture.root, ["push", "-q", "origin", "main"]);
  const since = run(fixture, ["doubles", "--tree", fixture.root, "--since", "HEAD~1"]);
  assert.equal(since.code, 2, since.out + since.err);
  assert.match(since.out, /FAIL doubles 0 -> 1/);
  const bare = run(fixture, ["doubles", "--tree", fixture.root]);
  assert.equal(bare.code, 2, bare.out + bare.err);
  assert.match(bare.err, /BAD_CONFIG/);
  assert.match(bare.err, /or pass --since <the commit before your edit>/);
});
