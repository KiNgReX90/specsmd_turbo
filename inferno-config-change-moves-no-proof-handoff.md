# Handoff: a host file under `.specs-inferno/` that a check reads never moves the check's proof, even when the check's scope names it, so a commit of the config alone that breaks the check is answered green until a later commit moves the key

Row 0bg. Met on the first host on 2026-11-23 by a direct build that changed the host's config alone, on the build at `a8873ebb`; the tip `71746911` holds the same code.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of the tip.

## What is wrong

1. **Every proof leaves out the whole ledger, the host's config included.** `scopeHash` drops each path `lib.inLedger` names before it reads the command's scope (`S/run-proofs.cjs:27-30`). `inLedger` names all of `.specs-inferno/` but the rule files (`S/run-lib.cjs:96-103`), and the comment at `:99` counts `config.yaml` as ledger on purpose. So a command's key (`commandProof`, `S/run-proofs.cjs:150-158`) holds across a commit that changes only `config.yaml` or `config.codex.yaml`, and `runCommand` answers `green` from the proof before it, without running (`:182`). Integrate and the gate run their commands through `runCommand` (`S/run-integrate.cjs:286`, `S/run-gate.cjs:192`), and `green` and ship read the same key (`S/run-gate.cjs:399`).
2. **A host cannot name the file.** Integrate selects a scoped command against a diff that holds the config (`S/run-integrate.cjs:251-253`), so a scope that names the config selects the command. The proof then answers for it all the same, since the hash drops the path the scope named. `dirt.reads` (`S/run-dirt.cjs:55-58`) leaves the path out the same way, so an uncommitted config never stops an integrate whose check reads it.
3. **A check that reads the host's config is common.** On the first host, eleven test files under `npm run test:definitions` read the host's configs from the tree, among them the parity of the two verification blocks. A commit of the config alone that breaks one stays green at every integrate, gate and ship. The red shows when a commit inside the command's other paths moves the key, and it lands on whoever made that commit, as a red that commit did not cause.
4. **The gate's rerun line reads it the same way.** `rerunOf` takes "unchanged code" from `codeTreeHash` (`S/run-gate-rerun.cjs:76-79` and `:86`), which drops the whole `.specs-inferno` entry (`S/run-lib.cjs:376-391`). So the gate after a commit of the config alone that fixes a red the config caused prints the no-cause line of a rerun on unchanged code.

## Evidence

- The direct build's FLOW line, verbatim: "flow defect (handoff): `run-lib.cjs:103` inLedger keeps all of .specs-inferno/ out of every scope hash. A landing that changes only the config therefore never reruns test:definitions, whose parity tests read both configs, so owed 1 would only show up at some later scripts/ change." Owed 1 is the host's `config.codex.yaml`, which must carry the verification block its `config.yaml` carries.
- The script below, on Alpha 2026-11-23 08:22Z, on the tip's `S/`, which is byte for byte the host's installed copy of `a8873ebb`: with a scope that names both configs, a commit of `config.yaml` alone keeps the key, `runCommand` answers `green`, and the check run by hand exits 1. The next commit under `scripts/` makes `runCommand` answer `fail`.
- The host's files that read its configs, on its main `7872503be`, all under `test:definitions`: `scripts/inferno-config.test.mjs:235-241` (both host configs carry the same verification block), `scripts/inferno-config-lanes.test.mjs:28-33`, `scripts/lint-ratchet-base.test.mjs:150-155`, `scripts/free-tools-licence.test.mjs:110-115`, `scripts/terms-version.test.mjs:52-57`, `scripts/consumer-edges.test.mjs:64-68`, `scripts/item-guards.test.mjs:171`, `scripts/site-deps.test.mjs:66-75`, `scripts/integrate-direct.test.mjs:497-498`, `scripts/refs/search-doc.test.mjs:60-64` and `scripts/real-app-lane-fresh-tree.test.mjs:147`. One more reads the ledger itself: `scripts/tester/findings-lint.test.mjs:28-29` (`state.yaml` and the archive's).
- How often: 57 commits on the host's main, merges aside, changed a host config from 2026-11-09 to 2026-11-23, and 7 of them changed nothing else outside the ledger.

## How to fix

1. **A command's own scope may take a ledger path in.** In `scopeHash`, a path `lib.inLedger` names stays out unless a glob of the command's own scope that starts with `.specs-inferno/` matches it. An unscoped command and the exact list of an item review keep leaving the whole ledger out, so no record moves a proof that did not ask for it. `dirt.reads` follows the same rule. A host that names `state.yaml` pays a rerun per record, and that trade is its own.
2. **The rerun line reads what the command reads.** `rerunOf` compares each red command's own scope hash, recorded with the red, rather than `codeTreeHash`, so a fix of the config alone is a new run and not a rerun on unchanged code.

Build it beside row 0bf: both change `included` in `scopeHash` (`S/run-proofs.cjs:29-30`). Row 0bf leaves host-named paths out of every proof, and this row lets a command's own scope take a ledger path in.

Tests, beside `S/run-proofs.test.cjs`, `S/run-integrate.test.cjs` and `S/run-gate-rerun.test.cjs`:

- With a scope that names `.specs-inferno/config.yaml`, a commit of that file alone moves the command's key, and integrate and the gate run the command again, red when the check fails. The script below then fails at its first "today" assert, and these tests replace it.
- The same commit keeps the key of a command whose scope does not name the file, and of an unscoped command, as today.
- A commit of `.specs-inferno/state.yaml` or of an intent's file keeps the key of every command whose scope does not name it, as today.
- An exact list that holds a ledger path hashes without it, as today.
- A gate after a fix of the config alone, on a branch whose last gate was red on that command, prints no rerun line.

## Which part is the flow and which the host

The flow's part is points 1 and 2. The host's part: name both host configs in the scope of each command whose check reads them, which on the first host is `npm run test:definitions` in both configs. Before this row is built, that selects the check at a landing of the config alone, and the check runs where no proof holds its key. Once it is built, every commit to a config the scope names runs the check.

## Until it is built

On the host: a landing that changes a host config and nothing else in the scope of `test:definitions` runs that command on its test machine before it lands.

## The script

Copy it to `S/` as `repro-config-proof.test.cjs` and run `node --test repro-config-proof.test.cjs` there. About half a second on Alpha. Today it passes. Once the fix holds, it fails at its first "today" assert, and the tests above replace it.

```js
'use strict';

// Reproduction for row 0bg: a host file under .specs-inferno/ that a check reads never moves the
// check's proof, even when the command's finalize_scopes entry names it. A commit of the config
// alone that breaks the check is answered green from the proof before it, and the red shows only
// when a commit inside the check's other paths moves the key.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync, spawnSync } = require('node:child_process');
const lib = require('./run-lib.cjs');
const proofs = require('./run-proofs.cjs');

// The check holds both host configs equal, as a host's parity test does.
const CHECK = 'node scripts/parity.cjs';
const PARITY = [
  "const fs = require('fs');",
  "const read = (name) => fs.readFileSync(`.specs-inferno/${name}`, 'utf8');",
  "process.exit(read('config.yaml') === read('config.codex.yaml') ? 0 : 1);",
  '',
].join('\n');
const config = (extra = '') => [
  'verification:',
  '  integrate:',
  `    - ${CHECK}`,
  '  finalize_scopes:',
  `    "${CHECK}":`,
  '      - "scripts/**"',
  '      - ".specs-inferno/config.yaml"',
  '      - ".specs-inferno/config.codex.yaml"',
  extra,
].join('\n');

test('a commit of the config alone that breaks the check its scope names is answered green', (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-0bg-'));
  const cache = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = path.join(work, 'cache');
  t.after(() => {
    if (cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = cache;
    fs.rmSync(work, { recursive: true, force: true });
  });
  const tree = path.join(work, 'host');
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
    fs.writeFileSync(path.join(tree, file), text);
  };
  const git = (...args) => execFileSync('git', args, { cwd: tree, encoding: 'utf8' }).trim();
  fs.mkdirSync(tree);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'repro@example.invalid');
  git('config', 'user.name', 'repro');
  write('scripts/parity.cjs', PARITY);
  write('.specs-inferno/config.yaml', config());
  write('.specs-inferno/config.codex.yaml', config());
  git('add', '-A');
  git('commit', '-qm', 'base');

  const selected = '.specs-inferno/config.yaml';
  const key = () => proofs.commandProof(tree, lib.readConfig(tree, selected), selected, CHECK).file;
  const run = (name) => proofs.runCommand(tree, lib.readConfig(tree, selected), selected, CHECK, path.join(work, `${name}.log`)).result;

  assert.equal(lib.inLedger('.specs-inferno/config.yaml'), true);
  assert.equal(run('base'), 'pass');
  const before = key();

  // config.yaml gains a finalize list and config.codex.yaml does not: the check fails on this tree.
  write('.specs-inferno/config.yaml', config('  finalize:\n    - node other.cjs\n'));
  git('commit', '-qam', 'the config alone');
  assert.equal(spawnSync('node', ['scripts/parity.cjs'], { cwd: tree }).status, 1, 'the check fails when run');
  assert.equal(key(), before, 'today: the key holds across a commit to a path the scope names');
  assert.equal(run('config'), 'green', 'today: the proof before the commit answers for the broken tree');

  // A commit inside the check's other paths moves the key, and the red lands on it.
  fs.appendFileSync(path.join(tree, 'scripts/parity.cjs'), '// an unrelated edit\n');
  git('commit', '-qam', 'scripts');
  assert.equal(run('scripts'), 'fail');
});
```
