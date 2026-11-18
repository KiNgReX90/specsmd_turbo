const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { CONFIG, closed, git, repo, run, write } = require("./run-fixture.cjs");
const { writeFile } = require("./test-write.cjs");
const { tempDir } = require("./test-temp.cjs");
const { exceptionRecord, repeats, rerunLine, rerunRecord } = require("./run-lanes-intermittent.cjs");

// A gate run again on the code a finalize command was red on, with its cause, reaches the base as
// one `exception: <command> rerun <json>` line in the ship commit, under the cap a lane accept has.
// The red run's log lives in the branch's cache folder, which the ship cleanup removes, so ship
// copies that one log out of it first and the line names the copy.

const FLAKY = "node flaky.cjs";
const CAUSE = 'the "shared" port {8080} was taken\nby another suite';
const BY = 'release "lead" {one}\nsecond line';
/** The cleanup a host runs: the branch's folder of the flow's cache, and nothing else of it. */
const CLEANUP = 'rm -rf "$XDG_CACHE_HOME/specsmd-inferno/$(basename "$PWD")/$INFERNO_BRANCH"\necho cleaned\n';

/**
 * A repo whose main carries the flaky command, red while the mode file outside the tree says so,
 * the host cleanup when `cleanup`, and the command scoped to `src/**` when `scoped`.
 */
function hosted(cleanup = true, scoped = false) {
  const config = CONFIG.replace("    - echo always\n", `    - ${FLAKY}\n`)
    .replace("verification:\n", `verification:\n${cleanup ? '  ship_cleanup: "bash ship-cleanup.sh"\n' : ""}`)
    .replace('    "echo scoped": ["docs/**"]\n', `    "echo scoped": ["docs/**"]\n${scoped ? `    "${FLAKY}": ["src/**"]\n` : ""}`);
  const fixture = repo({ config });
  fixture.mode = path.join(fixture.dir, "mode");
  write(fixture.root, "flaky.cjs", `const fs = require("node:fs");\nconst mode = ${JSON.stringify(fixture.mode)};\n` +
    'if (fs.existsSync(mode) && fs.readFileSync(mode, "utf8").trim() === "red") { console.log("  1 failed"); process.exit(1); }\n');
  write(fixture.root, "ship-cleanup.sh", CLEANUP);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "flaky command"]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  return fixture;
}

/** Close alpha, gate it red, then gate it again on the same code with the cause; returns the worktree, branch and red log. */
function rerun(fixture) {
  const made = closed(fixture);
  writeFile(fixture.mode, "red");
  const red = run(fixture, ["gate", "--tree", made.tree]);
  assert.equal(red.code, 2, red.out + red.err);
  writeFile(fixture.mode, "green");
  const again = run(fixture, ["gate", "--tree", made.tree, "--cause", CAUSE, "--by", BY]);
  assert.equal(again.code, 0, again.out + again.err);
  return { ...made, log: /^FAIL \d+s node flaky\.cjs -> (\S+)$/m.exec(red.out)[1] };
}

/** An empty commit on the primary's main, pushed, whose message carries `body`; returns its short sha. */
function landed(fixture, body) {
  git(fixture.root, ["commit", "-q", "--allow-empty", "-m", "another landing", "-m", body]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  return git(fixture.root, ["rev-parse", "--short", "HEAD"]).trim();
}

const message = (fixture) => git(fixture.root, ["log", "-1", "--format=%B", "main"]);
const exceptionLines = (fixture) => message(fixture).split("\n").filter((line) => line.startsWith("exception:"));
const cacheOf = (fixture) => path.join(fixture.cache, "specsmd-inferno", "app");
const evidence = (fixture) => path.join(cacheOf(fixture), "rerun-evidence");
const outLines = (result) => result.out.split("\n").filter(Boolean);
const greens = (fixture) => path.join(cacheOf(fixture), "green-commands");
/** The rerun records beside the command proofs, by file name. */
const recordFiles = (fixture) => (fs.existsSync(greens(fixture)) ? fs.readdirSync(greens(fixture)).filter((name) => name.endsWith(".rerun")) : []);
/** The flaky command's green proofs, by file name. */
const flakyProofs = (fixture) => fs.readdirSync(greens(fixture)).filter((name) => !name.includes("."))
  .filter((name) => JSON.parse(fs.readFileSync(path.join(greens(fixture), name), "utf8")).command === FLAKY);
/** A hook of the primary's repository, which its linked worktrees share. */
function hook(fixture, name, body) {
  const file = path.join(fixture.root, ".git", "hooks", name);
  writeFile(file, body);
  fs.chmodSync(file, 0o755);
  return file;
}
/** Every path in a text that starts with a slash: a path of the machine that ran the gate. */
const absolute = (text) => text.match(/(?:^|[\s"'])\/[^\s"']*/gm) || [];

function shippedRecord(fixture) {
  const lines = exceptionLines(fixture);
  assert.equal(lines.length, 1, lines.join("\n"));
  const [, json] = /^exception: node flaky\.cjs rerun (\{.*\})$/.exec(lines[0]);
  return JSON.parse(json);
}

test("ship writes the rerun's cause into the ship commit, and the red log it keeps stands after the cleanup removed the branch's folder", () => {
  const fixture = hosted();
  const { tree, branch, log } = rerun(fixture);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.match(shipped.out, /^ship cleanup: cleaned$/m);
  assert.equal(fs.existsSync(path.join(cacheOf(fixture), branch)), false);

  const record = shippedRecord(fixture);
  const run_ = path.basename(path.dirname(log));
  // The branch's slash is encoded, so the kept log sits one folder deep, a folder no other branch names.
  const kept = `rerun-evidence/${encodeURIComponent(branch)}-${run_}/0.log`;
  assert.deepEqual(record, { command: FLAKY, tests: [FLAKY], cause: CAUSE, by: BY, run: run_, log: kept });
  assert.equal(record.log.split("/").length, 3);
  assert.deepEqual(absolute(message(fixture)), []);
  assert.match(fs.readFileSync(path.join(cacheOf(fixture), kept), "utf8"), /1 failed/);
  assert.ok(outLines(shipped).includes(`kept the red log of ${FLAKY} at ${path.join(cacheOf(fixture), kept)}`), shipped.out);
  assert.deepEqual(fs.readdirSync(path.join(evidence(fixture), path.dirname(kept).split("/")[1])), ["0.log"]);

  // The line ship wrote is the one a later gate and ship read back from the base.
  const sha = git(fixture.root, ["rev-parse", "--short", "main"]).trim();
  assert.deepEqual(repeats(fixture.root, "main", [FLAKY]).map((line) => line.replace(/ \d{4}-\d\d-\d\d /, " <date> ")),
    [`earlier intermittent accept of ${FLAKY}: ${sha} <date> by ${BY.trim()}: ${CAUSE}`]);
});

test("without ship_cleanup the kept log stands beside the branch's folder ship names as left", () => {
  const fixture = hosted(false);
  const { tree, branch } = rerun(fixture);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  const folder = path.join(cacheOf(fixture), branch);
  assert.ok(outLines(shipped).includes(`left ${folder}: set verification.ship_cleanup to remove it`), shipped.out);
  const record = shippedRecord(fixture);
  fs.rmSync(folder, { recursive: true, force: true });
  assert.match(fs.readFileSync(path.join(cacheOf(fixture), record.log), "utf8"), /1 failed/);
});

test("a red log gone before ship still ships, and the line and one output line say it was not kept", () => {
  const fixture = hosted();
  const { tree, log } = rerun(fixture);
  fs.rmSync(log);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.equal(shippedRecord(fixture).log, "not kept: gone before ship");
  assert.ok(outLines(shipped).includes(`the red log of ${FLAKY} was gone before ship, so its exception line keeps none: ${log}`), shipped.out);
  assert.equal(fs.existsSync(evidence(fixture)), false);
  assert.deepEqual(recordFiles(fixture), []);
});

test("ship refuses a third cause of the command until a commit on the base names its fix, and keeps no log before", () => {
  const fixture = hosted();
  const { tree } = rerun(fixture);
  const line = (by) => rerunLine({ command: FLAKY, tests: [FLAKY], cause: "an earlier race", by, run: "gate-earlier", log: "rerun-evidence/x/0.log" });
  const first = landed(fixture, line("lead"));
  const second = landed(fixture, line("release-lead"));
  const tip = git(fixture.root, ["rev-parse", "main"]).trim();
  const refused = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, /INTERMITTENT_LIMIT/);
  assert.match(refused.err, new RegExp(`2 times on main since a commit there last named its fix: ${first} .* by lead, ${second} .* by release-lead`));
  assert.ok(refused.err.includes(`"Fixes-intermittent: ${FLAKY}" in its message, then ship again.`), refused.err);
  assert.equal(git(fixture.root, ["rev-parse", "main"]).trim(), tip);
  assert.equal(fs.existsSync(tree), true);
  assert.equal(fs.existsSync(evidence(fixture)), false);

  landed(fixture, `Fixes-intermittent: ${FLAKY}`);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.equal(shippedRecord(fixture).cause, CAUSE);
});

test("a later commit makes new code: its green gate carries no cause and ship writes no line", () => {
  const fixture = hosted();
  const { tree } = rerun(fixture);
  write(tree, "src/b.ts", "export const b = 3;\n");
  git(tree, ["commit", "-qam", "more work"]);
  const gate = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gate.code, 0, gate.out + gate.err);
  assert.doesNotMatch(gate.out, /^RERUN /m);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.deepEqual(exceptionLines(fixture), []);
  assert.equal(fs.existsSync(evidence(fixture)), false);
});

// The cause sits beside the proof the rerun's green minted, so it lives as long as that green: a
// commit outside a scoped command's scope keeps both, and one inside it makes the command run again.
test("a commit outside a scoped command's scope keeps the green its rerun minted, and with it the cause, the line and the kept log", () => {
  const fixture = hosted(true, true);
  const { tree } = rerun(fixture);
  write(tree, "docs/b.md", "more docs\n");
  git(tree, ["commit", "-qam", "docs"]);
  const gate = run(fixture, ["gate", "--tree", tree]);
  assert.equal(gate.code, 0, gate.out + gate.err);
  assert.match(gate.out, /^GREEN \d+s node flaky\.cjs \(unchanged since /m);
  assert.match(gate.out, new RegExp(`^RERUN node flaky\\.cjs: red in gate-\\S+, cause by `, "m"));
  const payload = JSON.parse(run(fixture, ["gate", "--tree", tree, "--json"]).out);
  assert.deepEqual(payload.rerun.map((record) => [record.command, record.cause, record.by]), [[FLAKY, CAUSE, BY]]);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  const record = shippedRecord(fixture);
  assert.equal(record.cause, CAUSE);
  assert.match(fs.readFileSync(path.join(cacheOf(fixture), record.log), "utf8"), /1 failed/);
});

test("a commit inside a scoped command's scope runs it again: that gate carries no cause and ship writes no line", () => {
  const fixture = hosted(true, true);
  const { tree } = rerun(fixture);
  write(tree, "src/b.ts", "export const b = 3;\n");
  git(tree, ["commit", "-qam", "more work"]);
  const gate = run(fixture, ["gate", "--tree", tree, "--json"]);
  assert.equal(gate.code, 0, gate.out + gate.err);
  const payload = JSON.parse(gate.out);
  assert.equal(payload.results.find((entry) => entry.command === FLAKY).result, "pass");
  assert.equal("rerun" in payload, false);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.deepEqual(exceptionLines(fixture), []);
  assert.equal(fs.existsSync(evidence(fixture)), false);
});

// The merge commit carries the line, so ship spends the record then: a later branch of the same name
// that reads the same green holds no cause, and the cap never counts one flake twice.
test("ship spends the record its line carries: the proof stands, and a later branch of the same name on that green holds no cause", () => {
  const fixture = hosted(true, true);
  const { tree, branch } = rerun(fixture);
  assert.equal(recordFiles(fixture).length, 1);
  const proofs = flakyProofs(fixture);
  assert.equal(proofs.length, 1);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.equal(shippedRecord(fixture).cause, CAUSE);
  assert.deepEqual(recordFiles(fixture), []);
  assert.deepEqual(flakyProofs(fixture), proofs);

  const again = path.join(fixture.dir, "again");
  git(fixture.root, ["worktree", "add", "-q", "-b", branch, again, "main"]);
  write(again, "docs/c.md", "later docs\n");
  git(again, ["add", "-A"]);
  git(again, ["commit", "-qm", "later docs"]);
  const gate = run(fixture, ["gate", "--tree", again]);
  assert.equal(gate.code, 0, gate.out + gate.err);
  assert.match(gate.out, /^GREEN \d+s node flaky\.cjs \(unchanged since /m);
  assert.doesNotMatch(gate.out, /^RERUN /m);
  const later = run(fixture, ["ship", "alpha", "--tree", again]);
  assert.equal(later.code, 0, later.out + later.err);
  assert.deepEqual(exceptionLines(fixture), []);
});

test("a ship whose merge is refused keeps the record, and the ship after it writes the line and spends it", () => {
  const fixture = hosted();
  const { tree } = rerun(fixture);
  const refusing = hook(fixture, "pre-merge-commit", "#!/bin/sh\necho the hook refused the merge\nexit 1\n");
  const tip = git(fixture.root, ["rev-parse", "main"]).trim();
  const refused = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.equal(git(fixture.root, ["rev-parse", "main"]).trim(), tip);
  assert.equal(recordFiles(fixture).length, 1);
  fs.rmSync(refusing);
  git(fixture.root, ["merge", "--abort"]);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.equal(shippedRecord(fixture).cause, CAUSE);
  assert.deepEqual(recordFiles(fixture), []);
});

test("a record already gone when the merge lands does not stop the ship", () => {
  const fixture = hosted();
  const { tree } = rerun(fixture);
  hook(fixture, "post-merge", `#!/bin/sh\nrm -f ${JSON.stringify(greens(fixture))}/*.rerun\n`);
  const shipped = run(fixture, ["ship", "alpha", "--tree", tree]);
  assert.equal(shipped.code, 0, shipped.out + shipped.err);
  assert.match(shipped.out, /^shipped$/m);
  assert.equal(shippedRecord(fixture).cause, CAUSE);
});

test("teardown ships nothing and keeps nothing", () => {
  const fixture = hosted();
  const { tree, branch } = rerun(fixture);
  git(fixture.root, ["merge", "-q", "--no-ff", "-m", "by hand", branch]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  const down = run(fixture, ["teardown", "--tree", tree]);
  assert.equal(down.code, 0, down.out + down.err);
  assert.equal(fs.existsSync(evidence(fixture)), false);
  assert.deepEqual(exceptionLines(fixture), []);
});

// A finalize command holds spaces and quotes, and may hold the words rerun and intermittent and a
// brace. Each line still reads back as the record it was written from, the released flow's lane
// reader on another host takes none of them, and today's reader takes each as a rerun's.
const COMMANDS = [
  'npm run test -- --grep "a rerun {x}" && echo intermittent {',
  "echo 'a rerun {\"command\":\"x\",\"tests\":[]}'",
  'x intermittent {"tests":["t"]} rerun {',
  "node a.cjs\nnode b.cjs",
  "node a.cjs\r\nnode b.cjs",
];
const RELEASED = /^exception: (\S+) intermittent (\{.*\})\s*$/;

function releasedRead(line) {
  const match = RELEASED.exec(line);
  if (!match) return null;
  try {
    const record = JSON.parse(match[2]);
    return record && Array.isArray(record.tests) ? record : null;
  } catch (error) {
    return null;
  }
}

test("a rerun line reads back as its record whatever the command holds, and no lane reader takes it for a lane's", () => {
  for (const command of COMMANDS) {
    const record = { command, tests: [command], cause: CAUSE, by: BY, run: "gate-20260101T000000Z", log: "rerun-evidence/a/0.log" };
    const line = rerunLine(record);
    assert.equal(/[\r\n]/.test(line), false, line);
    assert.ok(line.startsWith(`exception: ${command.replace(/\r?\n/, " ")} rerun {`), line);
    assert.deepEqual(rerunRecord(line), record);
    assert.deepEqual(exceptionRecord(line), record);
    assert.equal(releasedRead(line), null, line);
    assert.equal(rerunRecord(`${line.slice(0, -1)}`), null);
    assert.equal(rerunRecord(line.replace("exception: ", "Exception: ")), null);
  }
  // A line that shows another command than its record names is no rerun line.
  assert.equal(rerunRecord(`exception: node other.cjs rerun ${JSON.stringify({ command: FLAKY, tests: [FLAKY] })}`), null);
  assert.equal(rerunRecord(`exception: ${FLAKY} rerun ${JSON.stringify({ command: FLAKY })}`), null);
  assert.equal(rerunRecord(`exception: ${FLAKY} rerun ${JSON.stringify({ tests: [FLAKY] })}`), null);
  // A lane line still reads as the lane's, and the released reader reads it as before.
  const lane = `exception: smoke intermittent ${JSON.stringify({ tests: ["t"], reason: "a rerun {x}", by: "lead" })}`;
  assert.deepEqual(exceptionRecord(lane), { tests: ["t"], reason: "a rerun {x}", by: "lead" });
  assert.deepEqual(releasedRead(lane), { tests: ["t"], reason: "a rerun {x}", by: "lead" });
});

test("a base holding lane lines, rerun lines of any command and the released flow's lines reads each and counts them in one ledger", () => {
  const dir = tempDir("inferno-rerun-ledger-");
  try {
    const root = path.join(dir, "app");
    fs.mkdirSync(root);
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test"]);
    const commit = (body) => git(root, ["commit", "-q", "--allow-empty", "-m", "a landing", "-m", body]);
    for (const command of COMMANDS) commit(rerunLine({ command, tests: [command], cause: `why ${command}`, by: "lead", run: "gate-a", log: "rerun-evidence/a/0.log" }));
    commit(`exception: smoke intermittent ${JSON.stringify({ tests: ["checkout.test.mjs"], reason: "a lane race", by: "lead", run: "r", log: "lane.log" })}`);
    commit(rerunLine({ command: FLAKY, tests: ["checkout.test.mjs"], cause: "the same race", by: "release-lead", run: "gate-b", log: "not kept: gone before ship" }));
    for (const command of COMMANDS) {
      assert.deepEqual(repeats(root, "main", [command]).map((line) => line.replace(/: \S+ \d{4}-\d\d-\d\d by /, ": <sha> by ")),
        [`earlier intermittent accept of ${command}: <sha> by lead: why ${command}`]);
    }
    assert.throws(() => repeats(root, "main", ["checkout.test.mjs"]), /accepted as intermittent 2 times on main .* by lead, .* by release-lead/s);
    assert.throws(() => repeats(root, "main", ["checkout.test.mjs"], "ship again"), /in its message, then ship again\.$/);
    assert.throws(() => repeats(root, "main", ["checkout.test.mjs"]), /in its message, then accept again\.$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
