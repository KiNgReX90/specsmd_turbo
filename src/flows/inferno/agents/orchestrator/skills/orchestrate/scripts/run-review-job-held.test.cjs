const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { INTENT_TREE, asPrinted, git, run, worktree, write } = require("./review-fixture.cjs");
const {
  CAUGHT_ONE, CONFIG, INTENT_REVIEW, REVIEW, SURVIVES_TWO, mutantRepo, proposal, read, record, runs, withMutants,
} = require("./run-review-mutants-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

// A record started with --detach while its first mutant stands in the tree. The batch changes the
// tree's files in place, and the caller no longer blocks on it, so until it ends the record keeps
// out of its tree every call that would race it: a second record, of any item or of the intent,
// verify-item, integrate and the gate, each refused with the wait on the running record. A
// dispatch and the gate's wait stay free. A job stopped by its PID leaves the tree as a record cut
// in the foreground does, and one killed outright is put back by the next wait.

const shown = (result) => result.out + result.err;
const QUALITY = ".specs-inferno/intents/alpha/reviews/quality/a-one.yaml";
const ORIGINAL = "export const a = 1;\n";
const MUTANT = "export const a = 7;\n";
// A host session that logs its open and its close beside the tree, and runs each test in place.
const SESSION = `${CONFIG}mutate:\n  session:\n    match: '^sess '\n    open: 'echo open >> ../sess.log'\n    send: 'true'\n` +
  `    run: 'bash -c "$INFERNO_TEST"'\n    close: 'echo close >> ../sess.log'\n`;
const STRONG_TWO = proposal(2, { line: 2, find: "a2 = 2", replace: "a2 = 8", expect: "checks/a2.expect" });

/** The release file of a fixture's held test, and the file the test touches once it holds, beside its tree. */
const releaseOf = (fixture) => path.join(path.dirname(fixture.root), "release");
const holdingOf = (fixture) => path.join(path.dirname(fixture.root), "holding");

/** Criterion 1's proposal, its test held until the release file appears or its fixture dir is gone. */
function held(fixture, prefix = "") {
  const release = releaseOf(fixture);
  const hold = `touch ${holdingOf(fixture)}; until [ -f ${release} ] || [ ! -d ${path.dirname(release)} ]; do sleep 0.05; done; `;
  return CAUGHT_ONE.replace(/test: (.*)\n/, (line, test) => `test: "${prefix}${hold}${test}"\n`);
}

/** Resolve once the test of criterion 1 holds with its mutant in `tree`'s src/a.ts, so the job's batch is mid-run. */
async function planted(fixture, tree) {
  for (let i = 0; i < 400; i += 1) {
    if (fs.existsSync(holdingOf(fixture)) && read(tree, "src/a.ts").startsWith(MUTANT)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("the job never held its mutant");
}

/** The pid a started record names. */
function pidOf(started) {
  assert.equal(started.code, 0, shown(started));
  const pid = Number(/^record of .+ started pid (\d+)$/m.exec(started.out)[1]);
  assert.ok(pid > 1, started.out);
  return pid;
}

/** Signal the job's whole process group, as a host's cap ends a call and its children. */
function stop(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    assert.equal(error.code, "ESRCH");
  }
}

const quoted = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const journalLeft = (fixture) => fs.readdirSync(fixture.cache, { recursive: true }).some((rel) => String(rel).endsWith("mutate-journal.json"));

test("while a record runs, its wait exits 4 with the call to run again, every call that would race it is refused with that wait, and a dispatch is not", async () => {
  const fixture = mutantRepo();
  const tree = fixture.root;
  write(tree, REVIEW, withMutants(held(fixture), STRONG_TWO));
  const pid = pidOf(run(fixture, ["review", "--item", "a-one", "--tree", tree, "--reviewer", "rev-1", "--detach"]));
  try {
    await planted(fixture, tree);
    const early = run(fixture, ["review", "--item", "a-one", "--tree", tree, "--wait", "--minutes", "0"]);
    assert.equal(early.code, 4, shown(early));
    assert.match(early.out, new RegExp(`^record of item a-one still running pid ${pid}, 0 min so far$`, "m"));
    assert.match(early.out, /^log \S+\/review-item-a-one-job\.log$/m);
    const waitCall = `node \\S+/run\\.cjs review --item a-one --wait --tree ${quoted(tree)}`;
    assert.match(early.out, new RegExp(`^call ${waitCall} again$`, "m"));
    const running = JSON.parse(run(fixture, ["review", "--item", "a-one", "--tree", tree, "--wait", "--minutes", "0", "--json"]).out);
    assert.equal(running.running, true);
    assert.equal(running.pid, pid);
    assert.equal(running.elapsed_minutes, 0);

    const raced = [
      ["review", "--item", "a-one", "--reviewer", "rev-2", "--detach"],
      ["review", "--item", "a-two", "--reviewer", "rev-2"],
      ["review", "--reviewer", "rev-i"],
      ["review", "--rerun", "survivors"],
      ["verify-item", "a-two"],
      ["integrate", "--item", "a-two"],
      ["gate"],
      ["gate", "--detach"],
    ];
    for (const args of raced) {
      const refused = run(fixture, [...args, "--tree", tree]);
      assert.equal(refused.code, 2, `${args.join(" ")}\n${shown(refused)}`);
      assert.match(refused.err, new RegExp(`^ERROR \\[RECORD_RUNNING\\] a record of item a-one is running in this tree \\(pid ${pid}, started [^)]+\\); ` +
        `wait for it: ${waitCall}$`, "m"), args.join(" "));
    }
    // A record's own job meets the running one as a refusal it writes as its result.
    const job = run(fixture, ["review", "--item", "a-two", "--tree", tree, "--reviewer", "rev-2", "--json", "--job"]);
    assert.equal(JSON.parse(job.out).refused.code, "RECORD_RUNNING", shown(job));
    const dispatched = run(fixture, ["review", "--item", "a-two", "--tree", tree]);
    assert.equal(dispatched.code, 3, shown(dispatched));
    assert.match(dispatched.out, /^review owed for a-two: no review yet$/m);
    const gateWait = run(fixture, ["gate", "--wait", "--tree", tree]);
    assert.match(gateWait.err, /^ERROR \[NO_GATE_JOB\]/m, shown(gateWait));
  } finally {
    writeFile(releaseOf(fixture), "");
  }
  // With no --minutes the wait blocks up to its default, far past the rest of this record.
  const done = run(fixture, ["review", "--item", "a-one", "--tree", tree, "--wait"]);
  assert.equal(done.code, 0, shown(done));
  assert.match(done.out, /^mutants: 2 ran, 2 caught, 0 survived, 0 without a verdict$/m);
  assert.equal(read(tree, "src/a.ts"), `${ORIGINAL}export const a2 = 2;\n`);
  assert.equal(git(tree, ["status", "--porcelain"]), "");
  // Once it ended, nothing waits on it.
  assert.doesNotMatch(run(fixture, ["verify-item", "a-two", "--tree", tree]).err, /RECORD_RUNNING/);
});

test("a record job stopped by its PID leaves the tree as a record cut in the foreground does: every file back, the session closed, nothing recorded", async () => {
  const fixture = mutantRepo({ config: SESSION });
  const tree = fixture.root;
  const body = withMutants(held(fixture, "sess "), STRONG_TWO);
  write(tree, REVIEW, body);
  const ledger = read(tree, ".specs-inferno/state.yaml");
  const head = git(tree, ["rev-parse", "HEAD"]);
  const pid = pidOf(run(fixture, ["review", "--item", "a-one", "--tree", tree, "--reviewer", "rev-1", "--detach"]));
  try {
    await planted(fixture, tree);
    stop(pid, "SIGTERM");
    const waited = run(fixture, ["review", "--item", "a-one", "--tree", tree, "--wait", "--minutes", "1"]);
    assert.equal(waited.code, 2, shown(waited));
    assert.match(waited.err, /^ERROR \[MUTATE_STOPPED\] the runner's mutants stopped: .*SIGTERM.*Every file is back and nothing is recorded: run the same command again$/m);
  } finally {
    writeFile(releaseOf(fixture), "");
  }
  assert.equal(read(tree, "src/a.ts"), `${ORIGINAL}export const a2 = 2;\n`);
  assert.equal(fs.readFileSync(path.join(path.dirname(tree), "sess.log"), "utf8"), "open\nclose\n");
  assert.equal(journalLeft(fixture), false, "the batch dropped its journal");
  assert.equal(read(tree, ".specs-inferno/state.yaml"), ledger);
  assert.equal(git(tree, ["rev-parse", "HEAD"]), head);
  assert.equal(read(tree, REVIEW), body, "the reviewer's file is as it wrote it");
});

test("a record job killed outright: the next wait says it did not finish, puts back what it left, closes its session, and names the call that starts it again", async () => {
  const fixture = mutantRepo({ config: SESSION });
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, "src/a.ts", "export const a = 1;\nexport const a2 = 2;\nexport const a3 = 3;\n");
  git(tree, ["commit", "-qam", "a-one built"]);
  write(tree, REVIEW, withMutants(held(fixture, "sess "), STRONG_TWO));
  write(tree, QUALITY, "item: a-one\nverdict: clean\nfiles: [src/a.ts]\n");
  const both = ["review", "--item", "a-one", "--tree", tree, "--reviewer", "rev-1", "--quality-reviewer", "rev-q", "--detach"];
  const pid = pidOf(run(fixture, both));
  let waited;
  try {
    await planted(fixture, tree);
    stop(pid, "SIGKILL");
    waited = run(fixture, ["review", "--item", "a-one", "--tree", tree, "--wait", "--minutes", "1"]);
  } finally {
    writeFile(releaseOf(fixture), "");
  }
  assert.equal(waited.code, 2, shown(waited));
  assert.match(waited.out, new RegExp(`^record of item a-one ended without a result, so it did not finish: pid ${pid} -> \\S+/review-item-a-one-job\\.log$`, "m"));
  assert.match(waited.out, /^restored src\/a\.ts from an interrupted mutate$/m);
  assert.match(waited.out, new RegExp("^start it again with: run\\.cjs review --item a-one --reviewer <agent-id> " +
    `--quality-reviewer <quality-agent-id> --detach --tree ${quoted(tree)}$`, "m"));
  assert.equal(read(tree, "src/a.ts"), "export const a = 1;\nexport const a2 = 2;\nexport const a3 = 3;\n");
  assert.equal(journalLeft(fixture), false);
  assert.match(fs.readFileSync(path.join(path.dirname(tree), "sess.log"), "utf8"), /^open\n(?:.*\n)*close\n$/);
  const told = JSON.parse(run(fixture, ["review", "--item", "a-one", "--tree", tree, "--wait", "--json"]).out);
  assert.deepEqual(told, { ok: false, item: "a-one", died: true });

  const [again] = asPrinted(fixture, waited.out.replace("<agent-id>", "rev-1").replace("<quality-agent-id>", "rev-q"), "review --item");
  assert.equal(again.code, 0, shown(again));
  const done = run(fixture, ["review", "--item", "a-one", "--tree", tree, "--wait", "--minutes", "1"]);
  assert.equal(done.code, 0, shown(done));
  assert.match(read(tree, QUALITY), /^reviewer: rev-q$/m, "the job took both reviewers' ids");
  assert.equal(git(tree, ["status", "--porcelain"]), "");
});

test("the intent review's record runs detached too, and while it runs it keeps an item's record out", async () => {
  const fixture = mutantRepo();
  const tree = worktree(fixture, INTENT_TREE);
  write(tree, ".specs-inferno/intents/alpha/scan.yaml", "lines: []\n");
  git(tree, ["add", "-A"]);
  git(tree, ["commit", "-qm", "scan"]);
  // Recorded beside a sibling's uncommitted work, so both proposals stay owed to the intent review.
  write(tree, "docs/b.md", "a-two is mid-build\n");
  write(tree, REVIEW, withMutants(held(fixture), SURVIVES_TWO));
  assert.match(record(fixture, [], tree).out, /2 proposals stay owed to the intent review/);
  git(tree, ["checkout", "--", "docs/b.md"]);
  assert.equal(run(fixture, ["review", "--tree", tree]).code, 3);
  write(tree, INTENT_REVIEW, "verdict: clean\n");

  const started = run(fixture, ["review", "--tree", tree, "--reviewer", "rev-i", "--detach"]);
  const pid = pidOf(started);
  const waitCall = `node \\S+/run\\.cjs review --wait --tree ${quoted(tree)}`;
  assert.match(started.out, new RegExp(`^wait with: ${waitCall}$`, "m"));
  assert.match(started.out, /^log \S+\/review-intent-job\.log$/m);
  try {
    await planted(fixture, tree);
    const refused = run(fixture, ["review", "--item", "a-one", "--tree", tree, "--reviewer", "rev-2"]);
    assert.equal(refused.code, 2, shown(refused));
    assert.match(refused.err, new RegExp(`^ERROR \\[RECORD_RUNNING\\] a record of the intent review is running in this tree \\(pid ${pid}, ` +
      `started [^)]+\\); wait for it: ${waitCall}$`, "m"));
    const early = run(fixture, ["review", "--tree", tree, "--wait", "--minutes", "0"]);
    assert.equal(early.code, 4, shown(early));
    assert.match(early.out, new RegExp(`^record of the intent review still running pid ${pid}, 0 min so far$`, "m"));
  } finally {
    writeFile(releaseOf(fixture), "");
  }
  const done = run(fixture, ["review", "--tree", tree, "--wait", "--minutes", "1"]);
  assert.equal(done.code, 2, shown(done));
  assert.match(done.out, /^mutants: 2 ran, 1 caught, 1 survived/m);
  assert.match(done.out, /^FIX a-one: a-one:2 src\/a\.ts:2: the runner broke src\/a\.ts:2 /m);
  assert.deepEqual(runs(fixture), ["checks/one.expect", "checks/two.expect"]);
  assert.equal(git(tree, ["status", "--porcelain"]), "");
});
