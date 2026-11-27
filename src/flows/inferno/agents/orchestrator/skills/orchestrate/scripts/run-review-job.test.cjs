const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { asPrintedByPath, git, run, write } = require("./review-fixture.cjs");
const { CAUGHT_ONE, REVIEW, SURVIVES_TWO, itemReview, mutantRepo, read, record, runs, withMutants } = require("./run-review-mutants-fixture.cjs");

// A review's record runs the review's mutants before it writes anything, and on a cold machine
// that batch outlives the cap a host puts on one tool call. `review ... --detach` starts the
// record as its own process, as `gate --detach` starts the gate, and `review --wait` blocks on it
// under the cap. Once the record ended, the wait ends with the exit code, the lines and the
// payload the record called in the foreground would have given, a refusal on stderr included.

const shown = (result) => result.out + result.err;
const STATE = ".specs-inferno/state.yaml";

/** `text` with the fixture's own dir and every commit id written alike, so two fixtures compare. */
const same = (fixture, text) => text.split(path.dirname(fixture.root)).join("<dir>").replace(/\b[0-9a-f]{7,40}\b/g, "<sha>");

const start = (fixture, tree = fixture.root, args = []) =>
  run(fixture, ["review", "--item", "a-one", "--tree", tree, "--reviewer", "rev-1", "--detach", ...args]);
const wait = (fixture, tree = fixture.root, args = []) => run(fixture, ["review", "--item", "a-one", "--tree", tree, "--wait", "--minutes", "1", ...args]);

test("a record started with --detach ends, through --wait, with the exit code, the lines and the payload of the record called in the foreground", () => {
  const body = withMutants(CAUGHT_ONE, SURVIVES_TWO);
  const [text, json, detached] = [mutantRepo(), mutantRepo(), mutantRepo()];
  for (const fixture of [text, json, detached]) write(fixture.root, REVIEW, body);
  const foreground = record(text);
  const payload = record(json, ["--json"]);
  assert.equal(foreground.code, 2, shown(foreground));
  assert.match(foreground.out, /^mutants: 2 ran, 1 caught, 1 survived/m);

  const started = start(detached, detached.root, ["--json"]);
  assert.equal(started.code, 0, shown(started));
  const job = JSON.parse(started.out);
  assert.equal(job.item, "a-one");
  assert.equal(job.quality, false);
  assert.ok(Number.isInteger(job.pid) && job.pid > 1, started.out);
  assert.ok(Date.parse(job.started) > 0, started.out);
  assert.match(job.result, /\/review-item-a-one-job\.result\.json$/);

  const waited = wait(detached);
  assert.equal(waited.code, foreground.code, shown(waited));
  assert.equal(same(detached, waited.out), same(text, foreground.out));
  assert.equal(waited.err, "");
  assert.deepEqual(runs(detached), ["checks/one.expect", "checks/two.expect"], "the job ran each proposal once");
  const again = wait(detached, detached.root, ["--json"]);
  assert.equal(again.code, payload.code, shown(again));
  assert.deepEqual(JSON.parse(same(detached, again.out)), JSON.parse(same(json, payload.out)));
  assert.match(read(detached.root, STATE), /review: fix\n(?:.*\n)*?\s*review_misses: 1\n/);
  assert.equal(git(detached.root, ["status", "--porcelain"]), "");
});

test("a record with nothing to run starts and waits the same way, on the tree the call named, and its wait line runs as printed", () => {
  const fixture = mutantRepo();
  write(fixture.root, REVIEW, itemReview(""));
  // A tree named through a link: a job that read its tree from its own directory would name the target instead.
  const tree = path.join(path.dirname(fixture.root), "linked");
  fs.symlinkSync(fixture.root, tree);
  const started = start(fixture, tree);
  assert.equal(started.code, 0, shown(started));
  assert.match(started.out, /^record of item a-one started pid \d+$/m);
  assert.match(started.out, /^log \S+\/review-item-a-one-job\.log$/m);
  assert.match(started.out, /^result \S+\/review-item-a-one-job\.result\.json$/m);
  assert.match(started.out, new RegExp(`^wait with: node \\S+/run\\.cjs review --item a-one --wait --tree ${tree}$`, "m"));

  const waited = asPrintedByPath(fixture, started.out);
  assert.equal(waited.code, 0, shown(waited));
  assert.match(waited.out, /^review a-one clean, recorded at [0-9a-f]+ /m);
  assert.match(waited.out, new RegExp(`^then run\\.cjs integrate --item a-one --tree ${tree}$`, "m"));
  assert.deepEqual(runs(fixture), []);
  assert.equal(git(fixture.root, ["status", "--porcelain"]), "");
});

test("a refusal inside the job comes back through the wait as the call itself prints it, with its own exit code, and nothing is recorded", () => {
  const [foreground, detached] = [mutantRepo(), mutantRepo()];
  for (const fixture of [foreground, detached]) {
    write(fixture.root, REVIEW, withMutants(CAUGHT_ONE));
    fs.rmSync(path.join(fixture.root, STATE));
  }
  // The ledger writer's refusal.
  const refused = record(foreground);
  assert.equal(refused.code, 2, shown(refused));
  assert.match(refused.err, /^ERROR \[STATE_MISSING\] state file not found: /);
  assert.equal(start(detached).code, 0);
  const waited = wait(detached);
  assert.equal(waited.code, 2, shown(waited));
  assert.equal(waited.out, "");
  assert.equal(same(detached, waited.err), same(foreground, refused.err));
  assert.deepEqual(runs(detached), []);

  // The runner's own refusal, here the intent review's with exit 1.
  const intent = (fixture, args) => run(fixture, ["review", "--tree", fixture.root, ...args]);
  const bad = intent(foreground, ["--rerun", "all"]);
  assert.equal(bad.code, 1, shown(bad));
  assert.equal(intent(detached, ["--rerun", "all", "--detach"]).code, 0);
  const told = intent(detached, ["--wait", "--minutes", "1"]);
  assert.equal(told.code, 1, shown(told));
  assert.equal(told.err, bad.err);
  assert.match(told.err, /^ERROR \[BAD_ARGS\] --rerun takes survivors, not all$/m);

  // A crash is no refusal: the job wrote no result, so the wait says it did not finish and points at its log.
  fs.mkdirSync(path.join(detached.root, STATE));
  const crashed = start(detached);
  assert.equal(crashed.code, 0, shown(crashed));
  const died = wait(detached);
  assert.equal(died.code, 2, shown(died));
  assert.match(died.out, /^record of item a-one ended without a result, so it did not finish: pid \d+ -> \S+\/review-item-a-one-job\.log$/m);
  assert.match(died.out, /EISDIR/);
  assert.match(died.out, new RegExp(`^start it again with: run\\.cjs review --item a-one --reviewer <agent-id> --detach --tree ${detached.root}$`, "m"));
});

test("misuse is refused before anything starts: both flags, --wait with a reviewer's name, --detach on a call that records nothing", () => {
  const fixture = mutantRepo();
  // A call kept out while a record runs looks for one in a tree whose cache holds nothing yet.
  assert.doesNotMatch(shown(run(fixture, ["verify-item", "a-one"])), /ENOENT|RECORD_RUNNING/);
  write(fixture.root, REVIEW, withMutants(CAUGHT_ONE));
  const refusals = [
    [["--item", "a-one", "--reviewer", "rev-1", "--detach", "--wait"], "review takes --detach or --wait, not both"],
    [["--item", "a-one", "--reviewer", "rev-1", "--wait"], "review takes --wait without --reviewer, --quality-reviewer or --rerun"],
    [["--item", "a-one", "--quality-reviewer", "rev-q", "--wait"], "review takes --wait without --reviewer, --quality-reviewer or --rerun"],
    [["--rerun", "survivors", "--wait"], "review takes --wait without --reviewer, --quality-reviewer or --rerun"],
    [["--item", "a-one", "--detach"], "review takes --detach only on a call that records"],
    [["--detach"], "review takes --detach only on a call that records"],
    [["--item", "a-one", "--wait", "--minutes", "soon"], "review takes --minutes as a number of minutes, not soon"],
  ];
  for (const [args, said] of refusals) {
    const result = run(fixture, ["review", "--tree", fixture.root, ...args]);
    assert.equal(result.code, 1, `${args.join(" ")}\n${shown(result)}`);
    assert.ok(result.err.startsWith(`ERROR [BAD_ARGS] ${said}`), `${args.join(" ")}\n${result.err}`);
  }
  // Nothing started: no job to wait on, no mutant ran, and the reviewer's file waits as it was written.
  const item = wait(fixture);
  assert.equal(item.code, 2, shown(item));
  assert.match(item.err, new RegExp("^ERROR \\[NO_RECORD_JOB\\] no record of item a-one has been started in this tree; " +
    `start one with run\\.cjs review --item a-one --reviewer <agent-id> --detach --tree ${fixture.root}$`, "m"));
  // With no --tree the wait reads the tree it is called in.
  const intent = run(fixture, ["review", "--wait"]);
  assert.equal(intent.code, 2, shown(intent));
  assert.match(intent.err, new RegExp("^ERROR \\[NO_RECORD_JOB\\] no record of the intent review has been started in this tree; " +
    `start one with run\\.cjs review --reviewer <agent-id> --detach --tree ${fixture.root}$`, "m"));
  assert.deepEqual(runs(fixture), []);
  assert.equal(git(fixture.root, ["status", "--porcelain", "-uall"]), `?? ${REVIEW}`);
});

test("the usage names the record's start, its wait, the job's own flag and the exit 4 of a running record", () => {
  const help = run(mutantRepo(), ["--help"]);
  assert.equal(help.code, 0, shown(help));
  for (const line of [
    "  node run.cjs review [--item <id>] --tree <dir> --reviewer <agent-id> [--quality-reviewer <agent-id>] --detach start that record, its mutants first, " +
      "as its own process: 2 while another record runs in the tree",
    "  node run.cjs review [--item <id>] --tree <dir> --wait [--minutes <n>] block on the record started for the item, or for the intent without --item: " +
      "its exit code and output, 4 still running (default 9 min)",
    "                    review --wait: the same for the record",
    "  --job             review: record in this process as review --detach starts it, and print its exit code, lines and payload as one JSON line",
  ]) assert.ok(help.out.split("\n").includes(line), line);
  assert.match(help.out, /^Exit codes: .*, 4 gate, a lane or a review's record still running, /m);
});
