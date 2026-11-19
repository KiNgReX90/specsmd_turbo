# Handoff: integrate takes no cause for a red that is not the branch's work, so the green of its rerun reaches the gate and the ship as an ordinary green

Row 0ai. Found on the first host on 2026-11-19, at an item integrate of `every-inventory-is-filed-through-one-store-register`, on the build at `a8873ebb`, the tip. Reproduced on `a8873ebb` with the script at the end.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `a8873ebb`.

It is the step row 0r left out. Row 0r (built in `7fdf4b8b`, `a0eb164b` and `f6ad13a7`, text in history at `f0f06aaf`) gave a gate run again on unchanged code its cause, its line in the merge commit and its cap. It asked nothing of integrate, whose commands run first, item by item.

## What is wrong

1. **A red integrate names only the builder.** It ends with `<n> of <m> integrate command(s) failed; send every failure above to the builder in one correction.` (`S/run-integrate.cjs:292-300`), and the orchestrator's text sends every integrate red to the builder (`agents/orchestrator/agent.md:76`). A red that is not the branch's work, such as an intermittent of the base, has no call. A red gate prints one (`S/run-gate-rerun.cjs:149`).
2. **Integrate refuses a cause and writes no verdict.** `causeUsage` refuses `--cause` on every step but the gate (`S/run-gate-rerun.cjs:65-73`), and `S/run-gate-rerun.test.cjs:327-331` pins that for integrate. Only the gate writes the verdict a rerun is read from (`settle`, `S/run-gate-rerun.cjs:143-164`), so nothing records that an integrate command was red on this code.
3. **The plain rerun's green is the gate's green.** Integrate run again on the unchanged code runs only the red command, since the others read their proofs, and mints an ordinary proof (`S/run-proofs.cjs:179-194`). A command that both `verification.integrate` and `verification.finalize` list has one proof for both, keyed on the command, the config path and its scope (`S/run-proofs.cjs:150-158`). The gate on that code reads it as `GREEN <s>s <command> (unchanged since <the rerun's stamp>)` (`S/run-proofs.cjs:182`, `S/run-gate.cjs:116`). No verdict holds the red, so the gate prints no `RERUN`, refuses a `--cause` with NO_RERUN (`S/run-gate-rerun.cjs:86-92`), and ship writes no `exception:` line (`shipReruns`, `S/run-gate-rerun.cjs:188-201`).
4. **The cap never counts it.** The limit of two causes of a command on the base until a commit names its fix (`repeats`, `S/run-lanes-intermittent.cjs:215-227`) reads `exception:` lines only. A flake met at integrate can be run again intent after intent, and the base never shows it. A command that only `verification.integrate` lists would have no record even with a cause: `heldReruns` reads the records of the finalize commands only (`S/run-gate-rerun.cjs:131-136`).

## Evidence

The first host's Delta (Debian), intent `every-inventory-is-filed-through-one-store-register`, tree `/home/ruben/dev/Skoft_CRA-inferno-every-inventory-is-filed-through-one-store-register`, its `flow.lock` at `a8873ebb`, every step run with `--config <tree>/.cache/gate-config.yaml`. The host's integrate list holds 20 commands, 7 of them finalize commands too, `npm run verify:site` among them. Times UTC, from the session's transcript and the cache files.

- 21:11:15Z, `run.cjs integrate --items reg-the-scanner-database-setup-lives-in-the-watch,reg-the-stores-refusal-words-live-in-the-store` at `247939d3b`, folder `~/.cache/specsmd-inferno/Skoft_CRA/inferno-intent/every-inventory-is-filed-through-one-store-register-20261117T095335Z/integrate-20261119T211117Z/`: 18 PASS, 1 SKIP and `FAIL 589s bash .../remote-run.sh auto <tree> npm run verify:site -> .../integrate-20261119T211117Z/7.log`. The log's red is the site test `test/buy-step.spec.mjs:112:2`, "/buy/maintain-annual/ holds the press and ticks off each asked field until the order is complete", with `Error: the press did not lead to the first empty field`, `1 failed`, `280 passed (3.3m)`. The run's last line is `1 of 20 integrate command(s) failed; send every failure above to the builder in one correction.`, exit 2. No line names a cause.
- `site/` was the same tree at the session's last green integrate, and the lead read `verify:site` green on the base an hour before: an intermittent of the base. The lead's go, 21:50:55Z, was to run that integrate again on the unchanged code "with the --cause call the red run prints". There was none to take, and `integrate --cause` exits 1 with `ERROR [BAD_ARGS] integrate takes no --cause: only a gate run again on the code a finalize command was red on records one`.
- 21:51:06Z, the same call again, folder `integrate-20261119T215107Z/`, which holds one log, `7.log`: 19 commands read `GREEN ... (unchanged since ...)` or `SKIP`, then `PASS 185s ... npm run verify:site`, exit 0. Its proof is `~/.cache/specsmd-inferno/Skoft_CRA/green-commands/fa80aee3e78f37b51ad365ab054d18f03bcfd7b0ef33c90028c6f284063bb175`, with `"config":".cache/gate-config.yaml"`, `"stamp":"2026-11-19T21:55:01.703Z"` and `"seconds":185`. No `.rerun` file stands in `green-commands/`.
- The intent review was recorded clean as `a97ef9978`, a commit of one file under `.specs-inferno/`.
- 22:07:02Z to 22:33:50Z, a foreground `run.cjs gate` at `a97ef9978`: `GREEN 185s bash .../remote-run.sh auto <tree> npm run verify:site (unchanged since 2026-11-19T21:55:01.703Z)`, and no `RERUN` line. `gate-verdict.json` then reads `{"hash":"1bbc82bef4054e8dfe444053aa67d1aa0c154c44"}`. That is `codeTreeHash` (`S/run-lib.cjs:376-390`) of `a97ef9978` and of `247939d3b` alike, computed on Alpha: by the flow's own identity the gate ran on the code the integrate's `npm run verify:site` was red on, and took the plain rerun's green for its own.
- A ship from that gate would have merged with no `exception:` line. This one will not: the host fixed the test on its base as `8817da906` (22:24:24Z, with `Fixes-intermittent: npm run verify:site`), the branch folded it, and the next gate ran `npm run verify:site` again on the new code.

The script's output on Alpha, 2026-11-19 22:47Z, the same on the host's installed scripts and on the tip `05f27a2b`, which are byte-identical: case 1, the red integrate prints only `1 of 1 integrate command(s) failed; send every failure above to the builder in one correction.`; case 2, `integrate --cause` exits 1 with the BAD_ARGS line above; case 3, the plain rerun prints `PASS 0s node flaky.cjs` and nothing about a cause; case 4 passes: the gate prints `GREEN ... (unchanged since ...)`, the command ran twice, both times at integrate, and `shipReruns` returns no line; case 5, the control, the same red met at the gate, passes.

## How to fix

1. **Integrate keeps the verdict the gate keeps.** After its commands, an integrate that reached a verdict writes it with the code tree hash past its fold, as `settle` does: each red command with its folder and its log, never one whose inputs moved while it ran. A refused or moved integrate writes none. A green step, integrate or gate, clears the reds of its own commands and keeps any other red on that code, so a green gate keeps the red of a command only integrate runs, and a green integrate keeps that of a finalize-only one.
2. **A rerun is any step on the code its command was red on.** `rerunOf` reads the reds of the commands the step runs. Integrate takes `--cause "<why>" --by <who>` on such a rerun (`causeUsage` admits `integrate`), refuses one on code no red of its commands stands on (NO_RERUN, before any command runs), and refuses one past the cap (`repeats` under the command's name, so causes given at integrate and at the gate count together). Without one it prints the gate's line: `no --cause on a rerun of the red <command> on unchanged code: its green records no cause, and ship writes no exception line`.
3. **A red integrate prints the call.** After the line that sends the failures to the builder: `if this red is not this branch's work, integrate the same code again with its cause: <call>`, the call `integrateAgainCall` (`S/run-call.cjs:104-106`) with `--cause "<why>" --by <who>`, so it keeps the items and the `--since` it was called with.
4. **The cause rides its green.** A green rerun of integrate writes its record beside the proof each red command's green minted (`<proof>.rerun`), as the gate's `settle` does. `heldReruns` reads the records beside the proofs of `verification.integrate`'s commands as well as `verification.finalize`'s. A gate that reads that green then prints `RERUN <command>: red in integrate-<stamp>, cause by <who>: <cause>`, and ship writes `exception: <name> rerun <json>` and keeps the red integrate's log under `<cache>/rerun-evidence/`, as it does for a red gate.
5. **The texts, in no more words.** `agents/orchestrator/agent.md:111` and `codex/skills/specsmd-inferno/references/procedure.md:135` hold the one sentence that names the cause call, 35 words: "On a finalize command red for a cause that is not the branch's work, gate the unchanged code again with the `--cause` call the red gate prints; ship writes that cause into the merge commit." Replace it in both with one that names both steps, for example, in 34 words: "On a red integrate or gate whose cause is not the branch's work, run it again on the unchanged code with the `--cause` call it prints; ship writes that cause into the merge commit." The flow's own budget binds first: at `814b3c28` the codex orchestrator had 6 words left (PR 5's text), and row 0ag asks for words there too. The usage text of `run.cjs` names `--cause` and `--by` on the integrate lines and in the two option lines.

Tests, beside `S/run-gate-rerun.test.cjs`, with its fixture and a `verification.integrate` list. The script's cases 1 to 3 are red on `a8873ebb`, and cases 4 and 5 green; after the fix all five are green, and:

- `integrate --cause` on code no red of its commands stands on exits with NO_RERUN before any command runs. The integrate half of `S/run-gate-rerun.test.cjs:327-331` turns into this case, and `verify-item --cause` stays refused.
- A gate on the code an integrate command was red on, where the command is a finalize command too, is that red's rerun: without `--cause` it prints the line of point 2, and with one it writes the record.
- A green integrate keeps a gate's red of a finalize-only command on the same code, and a green gate keeps the red of a command only integrate runs.
- Two `exception: <name> rerun` lines on the base, written after integrate or after the gate, refuse a third cause at integrate until a commit carries `Fixes-intermittent: <name>`.
- The cause of a command only integrate runs reaches ship's line.

## Which part is the flow and which the host

All of it is the flow. The red was the host's own intermittent, fixed on its base as `8817da906`. Its integrate list holds seven of its finalize commands by design, which is how a rerun's green reaches the gate, and nothing there changes. Nothing here is for the builder of the row on the host's side.

## Until it is built

On the host: a red integrate command whose red is not the branch's work goes to no builder. The session mails it as BLOCKED with the cause and the red log's failing lines, since ship removes that log. On the lead's go it runs the same integrate call again without `--cause`, and only the red command runs again. The cause then lives in that mail and the lead's log alone, since the gate reads that green as unchanged and ship writes no line for it. The fix of the flake on the base carries `Fixes-intermittent: <command>`, the command bare.

## The script

Run with `S=<scripts folder of the flow> node --test --test-reporter=tap <file>`. About 4 seconds on Alpha.

```js
'use strict';

// A command red at integrate on code that is not the branch's work, as the store intent met it:
// the red integrate, the integrate run again on the unchanged code, then the gate on that code,
// whose green ship merges. The same red met at the gate takes the gate's cause call (the control).
// Run with S=<the scripts folder of the flow to test> node --test --test-reporter=tap <file>.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execFileSync, spawnSync } = require('node:child_process');

const S = process.env.S;
const RUN = path.join(S, 'run.cjs');
const { tempDir } = require(path.join(S, 'test-temp.cjs'));
const { writeFile } = require(path.join(S, 'test-write.cjs'));
const { reviewBefore } = require(path.join(S, 'review-fixture.cjs'));
const { shipReruns } = require(path.join(S, 'run-gate-rerun.cjs'));

const BRANCH = 'inferno-intent/demo-00000000T000000Z';
const FLAKY = 'node flaky.cjs';
const CAUSE = 'an intermittent on main: site/test/buy-step.spec.mjs:112';
const NO_CAUSE = `no --cause on a rerun of the red ${FLAKY} on unchanged code: its green records no cause, and ship writes no exception line`;
const FLAKY_JS = `const fs = require('node:fs');
fs.appendFileSync('.runs', 'flaky\\n');
const mode = fs.existsSync('../mode') ? fs.readFileSync('../mode', 'utf8').trim() : 'green';
if (mode === 'red') { console.log('  1 failed'); process.exit(1); }
`;

const git = (tree, ...args) => execFileSync('git', args, { cwd: tree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (tree, file, body) => {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
  writeFile(path.join(tree, file), body);
};

function fixture(t) {
  const dir = tempDir('inferno-integrate-cause-');
  const f = { dir, tree: path.join(dir, 'app'), cache: path.join(dir, 'cache') };
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(f.tree);
  git(f.tree, 'init', '-q', '-b', 'main');
  git(f.tree, 'config', 'user.email', 'test@example.com');
  git(f.tree, 'config', 'user.name', 'Test');
  write(f.tree, '.gitignore', '.runs\n');
  write(f.tree, 'src/input.txt', 'one\n');
  write(f.tree, 'flaky.cjs', FLAKY_JS);
  // The command sits in both lists, as npm run verify:site does on the host.
  write(f.tree, '.specs-inferno/config.yaml',
    `delivery:\n  base_branch: main\nverification:\n  integrate:\n    - ${FLAKY}\n  finalize:\n    - ${FLAKY}\n`);
  git(f.tree, 'add', '-A');
  git(f.tree, 'commit', '-qm', 'fixture');
  git(f.tree, 'checkout', '-qb', BRANCH);
  return f;
}

function run(f, ...args) {
  reviewBefore(args, f.tree);
  const result = spawnSync(process.execPath, [RUN, ...args], {
    cwd: f.tree, encoding: 'utf8', env: { ...process.env, CLAUDE_BUILD_WRAPPED: '1', XDG_CACHE_HOME: f.cache },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const mode = (f, value) => writeFile(path.join(f.dir, 'mode'), value);
const runs = (f) => (fs.existsSync(path.join(f.tree, '.runs')) ? fs.readFileSync(path.join(f.tree, '.runs'), 'utf8').trim().split('\n') : []);

/** The exception lines ship would write into the merge commit for this tree, read as ship reads them. */
function shipLines(f) {
  const was = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = f.cache;
  try {
    return shipReruns(f.tree, 'main', f.tree, undefined, []).lines;
  } finally {
    if (was === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = was;
  }
}

/** The red integrate of the flaky command on the code as it stands. */
function redIntegrate(f) {
  mode(f, 'red');
  const red = run(f, 'integrate');
  assert.equal(red.code, 2, red.out);
  mode(f, 'green');
  return red;
}

test('a red integrate prints the call that runs it again with its cause', (t) => {
  const f = fixture(t);
  const red = redIntegrate(f);
  assert.match(red.out, /run\.cjs integrate\b.*--cause "<why>" --by <who>/, red.out);
});

test('integrate run again with --cause on the code its command was red on records the cause, and the gate and ship carry it', (t) => {
  const f = fixture(t);
  redIntegrate(f);
  const again = run(f, 'integrate', '--cause', CAUSE, '--by', 'lead');
  assert.equal(again.code, 0, again.out);
  const gate = run(f, 'gate');
  assert.equal(gate.code, 0, gate.out);
  assert.match(gate.out, /^RERUN node flaky\.cjs: red in integrate-\d{8}T\d{6}Z, cause by lead: /m, gate.out);
  const lines = shipLines(f);
  assert.equal(lines.length, 1, JSON.stringify(lines));
  assert.match(lines[0], /^exception: node flaky\.cjs rerun \{/);
});

test('integrate run again without --cause on the code its command was red on says its green records no cause', (t) => {
  const f = fixture(t);
  redIntegrate(f);
  const again = run(f, 'integrate');
  assert.equal(again.code, 0, again.out);
  assert.ok(again.out.includes(NO_CAUSE), again.out);
});

test('today: the plain rerun\'s green is the gate\'s green on the same code, and ship writes nothing', (t) => {
  const f = fixture(t);
  redIntegrate(f);
  assert.equal(run(f, 'integrate').code, 0);
  const gate = run(f, 'gate');
  assert.equal(gate.code, 0, gate.out);
  // The gate ran nothing: the flaky command ran twice, both times at integrate.
  assert.deepEqual(runs(f), ['flaky', 'flaky']);
  assert.match(gate.out, /^GREEN \d+s node flaky\.cjs \(unchanged since \S+\)$/m, gate.out);
  assert.doesNotMatch(gate.out, /^RERUN /m, gate.out);
  assert.deepEqual(shipLines(f), []);
});

test('control: the same red met at the gate takes the gate\'s cause call, and ship writes its line', (t) => {
  const f = fixture(t);
  mode(f, 'red');
  const red = run(f, 'gate');
  assert.equal(red.code, 2, red.out);
  assert.match(red.out, /^if this red is not this branch's work, gate the same code again with its cause: /m, red.out);
  mode(f, 'green');
  const again = run(f, 'gate', '--cause', CAUSE, '--by', 'lead');
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /^RERUN node flaky\.cjs: red in gate-\d{8}T\d{6}Z, cause by lead: /m, again.out);
  assert.equal(shipLines(f).length, 1);
});
```
