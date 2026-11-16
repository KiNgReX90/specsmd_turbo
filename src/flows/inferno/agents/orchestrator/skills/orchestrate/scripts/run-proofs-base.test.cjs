const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { CONFIG, git, repo, run, write } = require("./run-fixture.cjs");
const lib = require("./run-lib.cjs");
const gates = require("./run-config-gates.cjs");
const proofs = require("./run-proofs.cjs");

// A ratchet whose verdict is the head's count against the merge base's count reads the base,
// so a green it earned at one base says nothing at another. A host lists such a command under
// verification.base_scoped, and its proof key carries the merge base's sha.
const RATCHET = "node ratchet.cjs";
const STAND_IN = `const fs = require('fs');
const { execFileSync } = require('child_process');
fs.appendFileSync(process.env.RATCHET_SPAWNS, 'spawn\\n');
const count = (text) => (text.match(/FIX/g) || []).length;
const base = execFileSync('git', ['merge-base', 'HEAD', 'main'], { encoding: 'utf8' }).trim();
const before = count(execFileSync('git', ['show', base + ':src/a.ts'], { encoding: 'utf8' }));
const now = count(fs.readFileSync('src/a.ts', 'utf8'));
console.log('findings ' + now + ' against ' + before + ' at the merge base');
process.exit(now > before ? 1 : 0);
`;
const RATCHETED = CONFIG.replace(
  '  finalize_scopes:\n    "echo scoped": ["docs/**"]',
  `  integrate:\n    - ${RATCHET}\n  finalize_scopes:\n    "${RATCHET}": ["src/**"]`,
);
const LISTED = RATCHETED.replace("verification:\n", `verification:\n  base_scoped: ["${RATCHET}"]\n`);
const TWO = "// FIX one\n// FIX two\nexport const a = 1;\n";
const REWORDED = "// FIX the first\n// FIX the second\nexport const a = 1;\n";

function commit(root, rel, body) {
  write(root, rel, body);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", `changed ${rel}`]);
}

/** A host whose main holds two findings and the stand-in ratchet that counts them against the merge base. */
function ratcheted(config) {
  const fixture = repo({ config });
  write(fixture.root, "ratchet.cjs", STAND_IN);
  commit(fixture.root, "src/a.ts", TWO);
  const spawns = path.join(fixture.dir, "spawns.txt");
  return { fixture, spawns, env: { RATCHET_SPAWNS: spawns } };
}

const spawned = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0);

/**
 * Two landings with the same scoped content: the first off main as it holds two findings, the
 * second off main after a commit took them to none. Each lands on its own branch.
 */
function twoLandings(config) {
  const { fixture, spawns, env } = ratcheted(config);
  const integrate = () => run(fixture, ["integrate", "--tree", fixture.root], { env });
  git(fixture.root, ["checkout", "-qb", "one"]);
  commit(fixture.root, "src/a.ts", REWORDED);
  const first = integrate();
  git(fixture.root, ["checkout", "-q", "main"]);
  commit(fixture.root, "src/a.ts", "export const a = 1;\n");
  git(fixture.root, ["checkout", "-qb", "two"]);
  commit(fixture.root, "src/a.ts", REWORDED);
  const second = integrate();
  return { first, second, spawns };
}

test("a base_scoped ratchet spawns at a new base with the same scoped content and goes red when the base count is lower", () => {
  const { first, second, spawns } = twoLandings(LISTED);
  assert.equal(first.code, 0, first.out + first.err);
  assert.match(first.out, new RegExp(`^PASS \\d+s ${RATCHET}$`, "m"));
  assert.equal(second.code, 2, second.out + second.err);
  assert.match(second.out, new RegExp(`^FAIL \\d+s ${RATCHET} -> `, "m"));
  assert.match(second.out, /findings 2 against 0 at the merge base/);
  assert.equal(spawned(spawns), 2);
});

test("an unlisted command keeps the key it had, so its green stands at any base", () => {
  const { first, second, spawns } = twoLandings(RATCHETED);
  assert.equal(first.code, 0, first.out + first.err);
  assert.equal(second.code, 0, second.out + second.err);
  assert.match(second.out, new RegExp(`^GREEN \\d+s ${RATCHET} \\(unchanged since `, "m"));
  assert.equal(spawned(spawns), 1);
});

/** In-process proofs read the fixture's cache, as the CLI's do. */
function inProcess(fixture) {
  process.env.XDG_CACHE_HOME = fixture.cache;
  return lib.readConfig(fixture.root);
}

const sha = (root, ref) => git(root, ["rev-parse", ref]).trim();

test("an unlisted command's proof is keyed by its command, config and scope hash alone", () => {
  const { fixture } = ratcheted(LISTED);
  const config = inProcess(fixture);
  git(fixture.root, ["checkout", "-qb", "one"]);
  const proof = proofs.commandProof(fixture.root, config, undefined, "echo always");
  const hash = proofs.scopeHash(fixture.root, undefined);
  const key = createHash("sha256").update(JSON.stringify(["echo always", ".specs-inferno/config.yaml", hash])).digest("hex");
  assert.equal(path.basename(proof.file), key);
  assert.deepEqual(Object.keys(proof).sort(), ["command", "config", "file", "hash"]);
});

test("a listed command's proof carries the merge base, follows it, and a record of another base is not read", () => {
  const { fixture } = ratcheted(LISTED);
  const config = inProcess(fixture);
  const plain = proofs.commandProof(fixture.root, {}, undefined, RATCHET, ["src/**"]);
  git(fixture.root, ["checkout", "-qb", "one"]);
  commit(fixture.root, "docs/b.md", "moved\n");
  const proof = proofs.commandProof(fixture.root, config, undefined, RATCHET);
  assert.equal(proof.base, sha(fixture.root, "main"));
  assert.equal(proof.rerun, undefined);
  assert.equal(proof.hash, plain.hash);
  assert.notEqual(proof.file, plain.file);
  assert.equal(proofs.commandProof(fixture.root, config, undefined, RATCHET).file, proof.file);

  const log = path.join(fixture.dir, "ran.log");
  const result = proofs.runCommand(fixture.root, config, undefined, RATCHET, log, false,
    (command, cwd, file) => lib.runShell("true", cwd, file));
  assert.equal(result.result, "pass");
  const record = proofs.readProof(proof);
  assert.equal(record.base, proof.base);
  assert.equal(proofs.readProof({ ...proof, base: "another" }), null);

  git(fixture.root, ["checkout", "-q", "main"]);
  commit(fixture.root, "docs/c.md", "main moved\n");
  git(fixture.root, ["checkout", "-q", "one"]);
  git(fixture.root, ["merge", "-q", "--no-edit", "main"]);
  const moved = proofs.commandProof(fixture.root, config, undefined, RATCHET);
  assert.equal(moved.base, sha(fixture.root, "main"));
  assert.equal(moved.hash, proof.hash);
  assert.notEqual(moved.file, proof.file);
  assert.equal(proofs.readProof(moved), null);
});

/** Runs the listed command twice through runCommand, counting the runs, and reads its proof after. */
function twice(fixture, config) {
  let runs = 0;
  const shell = (command, cwd, file) => {
    runs += 1;
    return lib.runShell("true", cwd, file);
  };
  const log = path.join(fixture.dir, "ran.log");
  const results = [1, 2].map(() => proofs.runCommand(fixture.root, config, undefined, RATCHET, log, false, shell).result);
  const proof = proofs.commandProof(fixture.root, config, undefined, RATCHET);
  return { runs, results, proof, held: proofs.readProof(proof) !== null };
}

test("with no merge base to read, a listed command reruns every time and its proof binds HEAD", () => {
  // On the base branch the tree's own branch is the base.
  const onBase = ratcheted(LISTED).fixture;
  const own = twice(onBase, inProcess(onBase));
  assert.deepEqual(own.results, ["pass", "pass"]);
  assert.equal(own.runs, 2);
  assert.equal(own.proof.rerun, true);
  assert.equal(own.proof.base, sha(onBase.root, "HEAD"));
  assert.equal(own.held, true, "green reads the proof the last run minted at this HEAD");

  // A base branch the repository does not have.
  const missing = ratcheted(LISTED.replace("base_branch: main", "base_branch: trunk")).fixture;
  git(missing.root, ["checkout", "-qb", "one"]);
  const none = twice(missing, inProcess(missing));
  assert.equal(none.runs, 2);
  assert.equal(none.proof.rerun, true);
  assert.equal(none.proof.base, sha(missing.root, "HEAD"));

  // A detached tree with no configured base and no origin HEAD falls back to its own branch name.
  const detached = ratcheted(LISTED.replace("  base_branch: main\n", "")).fixture;
  git(detached.root, ["checkout", "-q", "--detach"]);
  const loose = twice(detached, inProcess(detached));
  assert.equal(loose.runs, 2);
  assert.equal(loose.proof.rerun, true);
  const record = JSON.parse(fs.readFileSync(loose.proof.file, "utf8"));
  assert.equal(record.rerun, undefined);
  assert.equal(record.base, sha(detached.root, "HEAD"));
});

test("an unlisted command still answers from its proof on the base", () => {
  const { fixture } = ratcheted(RATCHETED);
  const { runs, results } = twice(fixture, inProcess(fixture));
  assert.deepEqual(results, ["pass", "green"]);
  assert.equal(runs, 1);
});

test("base_scoped is a list of finalize or integrate commands, and a --config file inherits it", () => {
  const withScoped = (value) => RATCHETED.replace("verification:\n", `verification:\n  base_scoped: ${value}\n`);
  for (const value of ['"node ratchet.cjs"', "[]", '[""]', '["  "]']) {
    assert.throws(
      () => lib.readConfig(repo({ config: withScoped(value) }).root),
      (error) => error.code === "BAD_CONFIG" &&
        error.message.includes("verification.base_scoped in ") &&
        error.message.includes('must be a list of commands, each one not empty: "base_scoped: [\\"<command>\\"]" under verification:.'),
      value,
    );
  }
  assert.throws(
    () => lib.readConfig(repo({ config: withScoped('["node other.cjs"]') }).root),
    (error) => error.code === "BAD_CONFIG" &&
      error.message.includes('verification.base_scoped "node other.cjs" in ') &&
      error.message.includes("names no command in verification.finalize or verification.integrate: list one verbatim or remove it."),
  );
  assert.deepEqual(gates.baseScoped(lib.readConfig(repo({ config: withScoped('["echo always"]') }).root)), ["echo always"]);
  assert.deepEqual(gates.baseScoped(lib.readConfig(repo({ config: RATCHETED }).root)), []);

  const set = repo({ config: LISTED });
  write(set.root, "scratch.yaml", "verification:\n  finalize:\n    - echo scratch\n");
  assert.deepEqual(gates.baseScoped(lib.readConfig(set.root, "scratch.yaml")), [RATCHET]);
  write(set.root, "own.yaml", "verification:\n  finalize:\n    - echo scratch\n  base_scoped: [\"echo scratch\"]\n");
  assert.deepEqual(gates.baseScoped(lib.readConfig(set.root, "own.yaml")), ["echo scratch"]);
  write(set.root, "integrate.yaml", "verification:\n  integrate:\n    - echo landed\n  base_scoped: [\"echo landed\"]\n");
  assert.deepEqual(gates.baseScoped(lib.readConfig(set.root, "integrate.yaml")), ["echo landed"]);
  write(set.root, "stray.yaml", "verification:\n  finalize:\n    - echo scratch\n  base_scoped: [\"node ratchet.cjs\"]\n");
  assert.throws(() => lib.readConfig(set.root, "stray.yaml"), (error) => error.code === "BAD_CONFIG");
});

test("the config example's base_scoped line reads as the key once uncommented", () => {
  const example = fs.readFileSync(path.join(__dirname, "../../../config.example.yaml"), "utf8");
  const line = /^ {2}# (base_scoped: \[.*?\])\s+# optional: commands of finalize or integrate, named verbatim, whose verdict reads the merge base/m.exec(example);
  assert.ok(line, "the example documents verification.base_scoped");
  const [command] = JSON.parse(line[1].slice("base_scoped: ".length));
  const fixture = repo({ config: CONFIG.replace("verification:\n", `verification:\n  ${line[1]}\n  integrate:\n    - ${command}\n`) });
  assert.deepEqual(gates.baseScoped(lib.readConfig(fixture.root)), [command]);
});
