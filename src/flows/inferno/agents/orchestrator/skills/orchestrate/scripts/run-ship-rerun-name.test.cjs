const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { CONFIG, closed, git, repo, run, write } = require("./run-fixture.cjs");
const { writeFile } = require("./test-write.cjs");

// A host whose wrapper takes the tree as an argument gates every tree with a config of its own, so
// one check is spelled differently in every tree. Ship writes a rerun's cause under the check's
// name, the rest after the session's match, so the cap counts it across trees, a person can write
// its fix line, and the base holds no path of a gate tree that is gone after the ship.

const BARE = "node flaky.cjs";
const SESSION = "  session:\n    match: '^tools/remote\\.sh auto \\S+ '\n    open: echo open\n    run: bash -c \"$INFERNO_TEST\"\n    close: echo close\n";
const wrapped = (tree) => `tools/remote.sh auto ${tree} ${BARE}`;
const configText = (tree, extra = "") => `delivery:\n  base_branch: main\nverification:\n  finalize:\n    - ${wrapped(tree)}\n${extra}`;

/** A repo whose main carries the flaky command, red while the mode file outside the tree says so, and the session every tree's config inherits. */
function hosted() {
  const fixture = repo({ config: CONFIG.replace("verification:\n", `verification:\n${SESSION}`) });
  fixture.mode = path.join(fixture.dir, "mode");
  write(fixture.root, "flaky.cjs", `const fs = require("node:fs");\nconst mode = ${JSON.stringify(fixture.mode)};\n` +
    'if (fs.existsSync(mode) && fs.readFileSync(mode, "utf8").trim() === "red") { console.log("  1 failed"); process.exit(1); }\n');
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "flaky command"]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  return fixture;
}

/** The config file the host writes for one gate tree, outside every tree. */
function configure(fixture, made, name) {
  const config = path.join(fixture.dir, `config-${name}.yaml`);
  writeFile(config, configText(made.tree));
  return { ...made, config };
}

/** Another tree of alpha on a branch of its own off the base as it stands, with one commit of its own. */
function branched(fixture, name, stamp) {
  const tree = path.join(fixture.dir, `tree-${name}`);
  const branch = `inferno-intent/alpha-2026010${stamp}T000000Z`;
  git(fixture.root, ["worktree", "add", "-q", "-b", branch, tree, "main"]);
  git(tree, ["commit", "-q", "--allow-empty", "-m", `the work of ${name}`]);
  return configure(fixture, { tree, branch }, name);
}

const gate = (fixture, made, ...extra) => run(fixture, ["gate", "--tree", made.tree, "--config", made.config, ...extra]);
const ship = (fixture, made) => run(fixture, ["ship", "alpha", "--tree", made.tree, "--config", made.config]);

function passed(result) {
  assert.equal(result.code, 0, result.out + result.err);
  return result;
}

/** A red gate on the tree's code, then the gate again on that code with its cause; returns that gate. */
function rerun(fixture, made, cause, ...extra) {
  writeFile(fixture.mode, "red");
  const red = gate(fixture, made, ...extra);
  assert.equal(red.code, 2, red.out + red.err);
  writeFile(fixture.mode, "green");
  return gate(fixture, made, "--cause", cause, "--by", "lead");
}

const greens = (fixture) => path.join(fixture.cache, "specsmd-inferno", "app", "green-commands");
const recordFiles = (fixture) => fs.readdirSync(greens(fixture)).filter((name) => name.endsWith(".rerun")).map((name) => path.join(greens(fixture), name));
const message = (fixture) => git(fixture.root, ["log", "-1", "--format=%B", "main"]);
/** Every rerun line on the base, oldest first, as its command text and its JSON. */
const baseLines = (fixture) => git(fixture.root, ["log", "--reverse", "--format=%B", "main"]).split("\n")
  .filter((line) => line.startsWith("exception: ")).map((line) => /^exception: (.*) rerun (\{.*\})$/.exec(line).slice(1));
/** Every path in a text that starts with a slash: a path of the machine that ran the gate. */
const absolute = (text) => text.match(/(?:^|[\s"'])\/[^\s"']*/gm) || [];

/** The merge commit a ship of `made` just wrote: its rerun line names the bare check, and no part of it a tree's path. */
function shippedBare(fixture, made, cause) {
  const text = message(fixture);
  assert.equal(text.includes(made.tree), false, text);
  assert.deepEqual(absolute(text), []);
  const [[command, json]] = baseLines(fixture).slice(-1);
  const record = JSON.parse(json);
  assert.deepEqual([command, record.command, record.tests, record.cause], [BARE, BARE, [BARE], cause]);
}

test("two trees each ship a rerun of one check under its name, and the third is refused at ship and at the gate until a fix line names it", () => {
  const fixture = hosted();
  const a = configure(fixture, closed(fixture), "a");
  passed(rerun(fixture, a, "the first race"));
  // The record as the build before names wrote it, with the whole command: ship names it.
  const [file] = recordFiles(fixture);
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual([record.command, record.tests], [wrapped(a.tree), [BARE]]);
  writeFile(file, `${JSON.stringify({ ...record, tests: [record.command] })}\n`);
  passed(ship(fixture, a));
  shippedBare(fixture, a, "the first race");

  // Two more trees take their causes while the base holds one line of the check.
  const b = branched(fixture, "b", 2);
  const c = branched(fixture, "c", 3);
  for (const made of [b, c]) {
    const taken = passed(rerun(fixture, made, `the race of ${made.branch}`));
    assert.match(taken.out, new RegExp(`^earlier intermittent accept of ${BARE}: \\S+ \\S+ by lead: the first race$`, "m"));
  }
  // B's config reaches no command at ship: its cause ships under the name its gate gave it.
  writeFile(b.config, configText(b.tree, SESSION.replace("tools/remote", "tools/nowhere")));
  passed(ship(fixture, b));
  shippedBare(fixture, b, `the race of ${b.branch}`);
  assert.equal(baseLines(fixture).length, 2);

  const tip = git(fixture.root, ["rev-parse", "main"]).trim();
  const refused = ship(fixture, c);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, new RegExp(`^ERROR \\[INTERMITTENT_LIMIT\\] refused: ${BARE} was accepted as intermittent 2 times on main `, "m"));
  assert.ok(refused.err.includes(`"Fixes-intermittent: ${BARE}" in its message, then ship again.`), refused.err);
  assert.equal(git(fixture.root, ["rev-parse", "main"]).trim(), tip);
  const again = rerun(fixture, c, "a fourth race", "--force");
  assert.equal(again.code, 2, again.out + again.err);
  assert.ok(again.err.includes(`"Fixes-intermittent: ${BARE}" in its message, then run the gate again with its cause.`), again.err);

  git(fixture.root, ["commit", "-q", "--allow-empty", "-m", "fix the race", "-m", `Fixes-intermittent: ${BARE}`]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  passed(gate(fixture, c, "--cause", "a fourth race", "--by", "lead"));
  passed(ship(fixture, c));
  shippedBare(fixture, c, "a fourth race");
  assert.deepEqual(recordFiles(fixture), []);
});

test("ship counts the base lines the build before names wrote with whole wrapped commands under the check's name, and a whole fix line lifts them", () => {
  const fixture = hosted();
  const a = configure(fixture, closed(fixture), "a");
  passed(rerun(fixture, a, "the race"));
  const { rerunLine } = require("./run-lanes-intermittent.cjs");
  for (const [tree, by] of [["/trees/gate-x", "lead"], ["/trees/gate-y", "release-lead"]]) {
    const command = wrapped(tree);
    git(fixture.root, ["commit", "-q", "--allow-empty", "-m", "an earlier landing", "-m",
      rerunLine({ command, tests: [command], cause: "an earlier race", by, run: "gate-x", log: "rerun-evidence/x/0.log" })]);
  }
  git(fixture.root, ["push", "-q", "origin", "main"]);
  const refused = ship(fixture, a);
  assert.equal(refused.code, 2, refused.out + refused.err);
  assert.match(refused.err, new RegExp(`refused: ${BARE} was accepted as intermittent 2 times on main .* by lead, .* by release-lead\\.`));
  git(fixture.root, ["commit", "-q", "--allow-empty", "-m", "fix the race", "-m", `Fixes-intermittent: ${wrapped("/trees/gate-z")}`]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  passed(ship(fixture, a));
  shippedBare(fixture, a, "the race");
});
