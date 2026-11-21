const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { BRANCH, cacheOf, commit, config, fixture, git, laneRuns, passed, run, write } = require("./run-lanes-fixture.cjs");
const jobs = require("./run-jobs.cjs");
const slot = require("./run-slot.cjs");

// A red the cases check finds needs no command, so `gate --detach` refuses it before it starts a
// lane, takes a gate job or keeps a merge slot ticket. Once the gate process alone checked the
// cases: it died at once, the lanes ran on, and the next detach waited for them to end.
const CASES = `cases:
  files:
    - path: integration/TEST-CASES.md
      case: '^### (TC-\\d+)'
  tests: ["integration/*.test.mjs"]
  sources: ["src/**"]
`;

/** The lanes fixture with a tester case on main and a branch whose brief proves it and changes the lanes' scope. */
function proving(t, extra = "") {
  const f = fixture(t, `${config({ smoke: "0" })}${extra}${CASES}`);
  git(f.tree, "checkout", "-q", "main");
  write(f.tree, "integration/TEST-CASES.md", "### TC-1 The gift card balance\nThe card page shows 25.\n");
  commit(f.tree, "case");
  git(f.tree, "checkout", "-q", BRANCH);
  git(f.tree, "merge", "-q", "--no-edit", "main");
  write(f.tree, ".specs-inferno/intents/demo/brief.md", "# Demo\n\nTester proves: TC-1 (stub at x.md:42)\n");
  write(f.tree, "src/input.txt", "two\n");
  commit(f.tree, "balance");
  return f;
}

const jobFiles = (f) => (fs.existsSync(cacheOf(f)) ? fs.readdirSync(cacheOf(f)).filter((name) => name.endsWith("-job.json")) : []);

function answer(f) {
  git(f.tree, "commit", "-q", "--allow-empty", "-m", "read the balance case", "-m", "Cases: TC-1");
}

test("gate --detach with an unanswered case exits 2 and starts no lane and no gate job", (t) => {
  const f = proving(t);
  // A host without the merge slot leaves the queue alone, a ticket a driver took by hand too.
  process.env.XDG_CACHE_HOME = f.cache;
  slot.take(f.tree, { holder: BRANCH });
  const refused = run(f, "gate", "--detach");
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.out, /^unanswered TC-1 in integration\/TEST-CASES\.md: the brief's Tester proves line names it$/m);
  assert.doesNotMatch(refused.out, /xmd42|x\.md/);
  assert.doesNotMatch(refused.out, /gate started|lane/);
  assert.deepEqual(laneRuns(f), []);
  assert.deepEqual(jobFiles(f), []);
  assert.equal(fs.existsSync(jobs.jobPaths(f.tree).job), false);
  assert.deepEqual(slot.queue(f.tree).tickets.map((ticket) => ticket.holder), [BRANCH]);
});

test("the detach refusal comes after the fold, and the next detach starts as if it had not run", (t) => {
  const f = proving(t);
  const baseMoves = () => {
    git(f.tree, "checkout", "-q", "main");
    write(f.tree, ".specs-inferno/base-note.txt", `${Math.random()}\n`);
    commit(f.tree, "base moves");
    const base = git(f.tree, "rev-parse", "HEAD");
    git(f.tree, "checkout", "-q", BRANCH);
    return base;
  };
  baseMoves();
  const lines = run(f, "gate", "--detach");
  assert.equal(lines.code, 2, lines.out + lines.err);
  assert.match(lines.out, /^folded main into inferno-intent\/demo-00000000T000000Z\nunanswered TC-1 /m);
  const base = baseMoves();
  const refused = run(f, "gate", "--detach", "--json");
  assert.equal(refused.code, 2, refused.out + refused.err);
  const payload = JSON.parse(refused.out);
  assert.equal(payload.folded, true);
  assert.deepEqual(payload.results, []);
  assert.deepEqual(payload.cases.unanswered.map((entry) => entry.case), ["TC-1"]);
  assert.doesNotThrow(() => git(f.tree, "merge-base", "--is-ancestor", base, "HEAD"));
  answer(f);
  const started = run(f, "gate", "--detach");
  passed(started);
  assert.match(started.out, /^gate started pid \d+$/m);
  passed(run(f, "gate", "--wait", "--minutes", "0.5"));
  assert.deepEqual(laneRuns(f), ["smoke"]);
});

test("under the merge slot a refused detach gives its ticket back", (t) => {
  const f = proving(t, "  merge_slot: true\n");
  process.env.XDG_CACHE_HOME = f.cache;
  const holders = () => slot.queue(f.tree).tickets.map((ticket) => ticket.holder);
  const refused = run(f, "gate", "--detach");
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.out, /^unanswered TC-1 /m);
  assert.deepEqual(holders(), []);
  assert.deepEqual(laneRuns(f), []);
  answer(f);
  passed(run(f, "gate", "--detach"));
  assert.deepEqual(holders(), [BRANCH]);
  passed(run(f, "gate", "--wait", "--minutes", "0.5"));
});

test("a gate run in its own process still refuses the unanswered case before any command", (t) => {
  const f = proving(t);
  const refused = run(f, "gate");
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.out, /^unanswered TC-1 /m);
  assert.doesNotMatch(refused.out, /xmd42/);
  assert.equal(fs.existsSync(path.join(f.tree, ".runs")), false, "no command ran");
  answer(f);
  passed(run(f, "gate"));
});
