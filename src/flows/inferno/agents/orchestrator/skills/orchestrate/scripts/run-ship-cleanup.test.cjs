const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { CONFIG, closed, git, repo, run, write } = require("./run-fixture.cjs");
const lib = require("./run-lib.cjs");
const gates = require("./run-config-gates.cjs");

const COMMAND = "bash ship-cleanup.sh";
const withCleanup = (value) => CONFIG.replace("verification:\n", `verification:\n  ship_cleanup: ${value}\n`);

/** What the host script records, into the file CLEANUP_SEEN names, before it prints its own lines. */
const SEEN = `{
  echo "branch=$INFERNO_BRANCH"
  echo "tree=$INFERNO_TREE"
  if [ -e "$INFERNO_TREE" ]; then echo "tree_exists=yes"; else echo "tree_exists=no"; fi
  echo "branch_list=$(git branch --list "$INFERNO_BRANCH")"
  echo "cwd=$(pwd -P)"
} > "$CLEANUP_SEEN"
`;

/** A fixture whose main carries the host script and a config that runs it on ship. */
function hosted(body) {
  const fixture = repo({ config: withCleanup(`"${COMMAND}"`) });
  write(fixture.root, "ship-cleanup.sh", `${SEEN}${body}`);
  git(fixture.root, ["add", "-A"]);
  git(fixture.root, ["commit", "-qm", "host ship cleanup"]);
  const seen = path.join(fixture.dir, "seen.txt");
  return { fixture, seen, env: { CLEANUP_SEEN: seen } };
}

function readSeen(file) {
  const entries = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1)];
  });
  return Object.fromEntries(entries);
}

function gated(fixture, env) {
  const made = closed(fixture);
  const gate = run(fixture, ["gate", "--tree", made.tree], { env });
  assert.equal(gate.code, 0, gate.out + gate.err);
  return made;
}

test("ship runs ship_cleanup once the worktree and branch are gone, with the branch and the tree in its environment", () => {
  const { fixture, seen, env } = hosted('echo "first line"\necho "host cleaned up"\n');
  const { tree, branch } = gated(fixture, env);
  const result = run(fixture, ["ship", "alpha", "--tree", tree], { env });

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /shipped/);
  const saw = readSeen(seen);
  assert.equal(saw.branch, branch);
  assert.equal(saw.tree, path.resolve(tree));
  assert.equal(saw.tree_exists, "no");
  assert.equal(saw.branch_list.trim(), "");
  assert.equal(saw.cwd, fs.realpathSync(fixture.root));
  assert.match(result.out, /^ship cleanup: host cleaned up$/m);
});

test("a failing ship_cleanup prints its line and the ship stands", () => {
  const { fixture, env } = hosted('echo "refused here"\nexit 1\n');
  const { tree } = gated(fixture, env);
  const result = run(fixture, ["ship", "alpha", "--tree", tree], { env });

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /shipped/);
  assert.match(result.out, /^ship cleanup exited 1: refused here$/m);
  assert.match(result.out, /^log .*ship-cleanup.*\.log$/m);
  assert.equal(git(fixture.root, ["rev-parse", "main"]), git(fixture.root, ["rev-parse", "origin/main"]));
  assert.equal(fs.existsSync(tree), false);
});

test("the cleanup's log outlives the branch's cache folder", () => {
  const { fixture, env } = hosted('rm -rf "$XDG_CACHE_HOME/specsmd-inferno/$(basename "$PWD")/$INFERNO_BRANCH"\necho cleaned\n');
  const { tree, branch } = gated(fixture, env);
  const result = run(fixture, ["ship", "alpha", "--tree", tree], { env });

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^ship cleanup: cleaned$/m);
  assert.equal(fs.existsSync(path.join(fixture.cache, "specsmd-inferno", path.basename(fixture.root), branch)), false);
});

test("teardown runs ship_cleanup after removing a merged worktree", () => {
  const { fixture, seen, env } = hosted("echo torn\n");
  const { tree, branch } = closed(fixture);
  git(fixture.root, ["merge", "-q", "--no-ff", "-m", `Merge branch '${branch}'`, branch]);
  git(fixture.root, ["push", "-q", "origin", "main"]);
  const result = run(fixture, ["teardown", "--tree", tree], { env });

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /^removed /m);
  assert.match(result.out, /^deleted /m);
  assert.match(result.out, /^ship cleanup: torn$/m);
  const saw = readSeen(seen);
  assert.equal(saw.branch, branch);
  assert.equal(saw.tree, path.resolve(tree));
  assert.equal(saw.tree_exists, "no");
});

test("without ship_cleanup nothing runs", () => {
  const fixture = repo();
  const { tree } = gated(fixture, {});
  const result = run(fixture, ["ship", "alpha", "--tree", tree]);

  assert.equal(result.code, 0, result.out + result.err);
  assert.match(result.out, /shipped/);
  assert.doesNotMatch(result.out, /ship cleanup/);
});

test("a --config file inherits ship_cleanup, and a blank or non-string value is refused", () => {
  const set = repo({ config: withCleanup(`"  ${COMMAND}  "`) });
  write(set.root, ".specs-inferno/config.codex.yaml", "delivery:\n  base_branch: main\n");
  assert.equal(gates.shipCleanup(lib.readConfig(set.root, ".specs-inferno/config.codex.yaml")), COMMAND);
  assert.equal(gates.shipCleanup(lib.readConfig(set.root)), COMMAND);
  assert.equal(gates.shipCleanup(lib.readConfig(repo().root)), null);

  for (const value of ['""', '["a"]']) {
    const bad = repo({ config: withCleanup(value) });
    assert.throws(
      () => lib.readConfig(bad.root),
      (error) => error.code === "BAD_CONFIG" &&
        error.message.includes("verification.ship_cleanup in ") &&
        error.message.includes('must be one shell command: "ship_cleanup: \\"<command>\\"" under verification:.'),
    );
  }
});
