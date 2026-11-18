# Handoff: every detached worktree of a repository keeps its gate, lane and owner records in one folder, `<cache>/HEAD/`, so a gate in one detached tree answers another's wait and retires or refuses its accept

Row 0af. Met on the first host on 2026-11-18, in its release gate on the build at `fa5eea22` that its release line carries (the lines named here are the same at `f3be640a`, the build on its main). Read in the code there and at `892dbf69`, and reproduced on all three with the script at the end: the tip behaves the same.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `892dbf69`.

## What is wrong

A tree's records are filed under its branch name, and git calls every detached checkout `HEAD`.

1. **One folder for every detached tree.** `jobPaths` (`S/run-jobs.cjs:19-20`) and `ownerFile` (`S/run-owner.cjs:66-67`) join `cacheDir(tree)`, which names the repository's primary checkout, with `currentBranch(tree)`. That is `git rev-parse --abbrev-ref HEAD` (`S/run-lib.cjs:64-66`), and it prints `HEAD` in any detached checkout. Twelve more places build a folder the same way (listed under "How to fix"). So on one machine every detached tree of a repository shares `<cache>/HEAD/`: the gate job and its result, each lane's job, run file and result, `owner.json`, the check sessions, the mutate journal, the scan folder and, at the tip, the rerun verdict and the lane accept record itself (`placeOf`, `S/run-lanes-fix.cjs:25`). Git checks a branch out in one worktree at a time, so the name is unique for a tree on a branch. Only a detached tree meets this.
2. **A wait answers with another tree's verdict.** `gateWait` (`S/run-gate.cjs:348`) reads the gate job in that folder, and `waitAll` then reads `job.tree` and the lane jobs of the same folder (`laneState`, `S/run-lanes.cjs:172`). After a gate of tree B, `gate --wait --tree A` prints B's lane lines. A smoke instrument red that A walked and nobody accepted reads `GREEN lane smoke`, exit 0.
3. **An accept is retired by another tree's lane.** An accepted instrument red holds only while the lane's latest result in that folder is the run it accepted (`readAccepted`, `S/run-lanes-fix.cjs:50-59`, and `S/run-lanes.cjs:64-70` in the installed build). Any lane run of B replaces that result, and A's next gate walks its lane again.
4. **An accept is refused.** `accept` reads the same result (`S/run-lanes.cjs:323`). When a lane of B ran after A's red, A's accept ends `NOTHING_TO_ACCEPT`.
5. **A start is refused, and a supersede would stop another tree's lanes.** `refusePlain` (`S/run-supersede.cjs:43-49`) refuses B's `gate --detach` while A's lane walks, as "already running for this tree". `gate --detach --supersede` in B takes A's live lanes as its own targets (`everyJob`).
6. **One merge slot ticket.** A detached tree's default holder is `HEAD` (`S/run-slot.cjs:120`, `:140`, `:151`, `:174`), so two detached trees hold one ticket, and a release by one drops the other's. Read in the code only: the first host sets no `merge_slot`.

Nothing in the flow says a detached tree is not supported. `--tree` takes any tree, `gate --detach --lanes-only` is there for a driver on the base, and a gate on one fixed commit, as a release gate is, runs in a detached checkout by nature. Only `teardown` refuses one (`S/run-ship.cjs:232`).

## Evidence

The first host's last release gate, on Alpha, in the detached worktree `/home/ruben/dev/Skoft_CRA-gate-release-0.2-692bee318` at `692bee318`, started 2026-11-18 16:01:00Z as `gate --detach --lanes-only --since 7dd497838 --config <release config>`. Read on Alpha on 2026-11-18 between 19:42Z and 19:52Z, nothing run in the tree. Its records, all in `~/.cache/specsmd-inferno/Skoft_CRA/HEAD/` but the accept:

| File | Written (UTC) | What it holds |
| --- | --- | --- |
| `gate-job.json` | 16:01:02 | `"lanes_only":true`, `"lanes":["smoke","windows"]`, `"tree":"/home/ruben/dev/Skoft_CRA-gate-release-0.2-692bee318"`, `"branch":"HEAD"` |
| `lane-smoke-job.json` | 16:01:01 | pid 1906903, head `692bee318`, the same tree |
| `lane-windows-job.result.json` | 16:44:29 | run `20261118T160103Z-1906947`, `green`, 2606 s |
| `lane-smoke-job.result.json` | 18:41:31 | run `20261118T160102Z-1906903`, `instrument-red`, code 11, hash `a9e449fb` |
| `../green-commands/1ff85b78....instrument-red` | 19:35:18 | harness fix `6c11a107`, run `20261118T160102Z-1906903`, `"branch":"HEAD"` |
| `owner.json` | 19:35:18 | step `gate` |

The accept printed "accepted smoke instrument red against harness fix 6c11a10 for this tree", and the wait after it exited 0 with "ACCEPTED lane smoke instrument red, harness fix 6c11a10". Each record is the gate tree's own: the files show no gate or lane of another detached tree from 16:01Z to that wait, and from 19:15Z the host's lead held them on purpose. The flow alone would not have kept them out: it refuses a gate only while a job of that folder walks, and `gate --detach --lane <name>` only while that lane walks (`refuseOneLane`, `S/run-lanes-only.cjs:106-119`), and the Windows lane had ended at 16:44Z.

Three detached worktrees of that repository stood on Alpha at 19:52Z, and the installed `jobPaths` and `ownerFile` give each the same two files:

```
Skoft_CRA-gate-release-0.2-692bee318 -> ~/.cache/specsmd-inferno/Skoft_CRA/HEAD/lane-smoke-job.result.json | ~/.cache/specsmd-inferno/Skoft_CRA/HEAD/owner.json
Skoft_CRA-redfirst-xvfb-noreset      -> ~/.cache/specsmd-inferno/Skoft_CRA/HEAD/lane-smoke-job.result.json | ~/.cache/specsmd-inferno/Skoft_CRA/HEAD/owner.json
Skoft_CRA-winui                      -> ~/.cache/specsmd-inferno/Skoft_CRA/HEAD/lane-smoke-job.result.json | ~/.cache/specsmd-inferno/Skoft_CRA/HEAD/owner.json
```

The folder already holds other detached trees' work. Two `run.cjs integrate` runs, of `Skoft_CRA-winfix-rel` and of `Skoft_CRA-winfix-main`, started a second apart on 2026-11-18 (`integrate-20261118T042918Z` and `integrate-20261118T042919Z`, each log names its tree), and both kept their check sessions in the one `check-sessions/` folder. Beside them lie lane logs of 2026-11-17 09:28Z and mutate batch logs of 2026-11-10 and 2026-11-11.

Reproduced on Alpha on 2026-11-18 between 19:55Z and 19:56Z with the script below, against the scripts of `fa5eea22`, `f3be640a` and `892dbf69`. All three print the same lines, pids, times and shas aside:

```
one lane result for both trees: true (cache/specsmd-inferno/host/HEAD/lane-smoke-job.result.json)
one owner file for both trees: true
1 A gate, smoke instrument red after 2 s: exit 0 | smoke lane started pid 2464875
2 B gate while A walks: exit 2 | ERROR [GATE_RUNNING] a smoke lane is already running for this tree (pid 2464875, started 2026-11-18T19:55:40.761Z); wait for it: node <scripts>/run.cjs gate --wait --tree <root>/B
3 A wait: exit 3 | INSTRUMENT RED lane smoke (exit 11) -> <root>/cache/specsmd-inferno/host/HEAD/lane-smoke-20261118T195540Z.log
4 A accept: exit 0 | accepted smoke instrument red against harness fix e7dc5c7 for this tree
5 A wait: exit 0 | ACCEPTED lane smoke instrument red, harness fix e7dc5c7
6 B gate, smoke green: exit 0 | smoke lane started pid 2465079
7 B wait: exit 0 | GREEN lane smoke 0s
8 A wait, after B walked: exit 0 | GREEN lane smoke 0s
9 A gate again, accept on record: exit 0 | smoke lane started pid 2465222
10 A wait: exit 3 | INSTRUMENT RED lane smoke (exit 11) -> <root>/cache/specsmd-inferno/host/HEAD/lane-smoke-20261118T195545Z.log
11 B walks its smoke lane again, green: exit 0 | smoke lane started pid 2465306
12 B wait: exit 0 | GREEN lane smoke 0s
13 A accept the red it walked in 9: exit 2 | ERROR [NOTHING_TO_ACCEPT] no instrument red of the smoke lane on this tree to accept: run run.cjs gate --detach --tree <root>/A, then node <scripts>/run.cjs gate --wait --tree <root>/A.
14 A wait (its red of 9 never accepted): exit 0 | GREEN lane smoke 0s
```

Step 14 is a false green: A walked an instrument red in step 9 that nobody accepted, and its wait exits 0 on B's green lane. Step 9 is the retired accept, step 13 the refused one and step 2 the refused start.

## How to fix

1. **One owner for a tree's folder**, in `S/run-lib.cjs` beside `cacheDir`, called `stateDir(tree)` here. On a branch it is `path.join(cacheDir(tree), currentBranch(tree))`, as today. On a detached HEAD it is named by the tree, never by its commit: `path.join(cacheDir(tree), '.detached', <the basename of the tree's top level, reduced to [A-Za-z0-9._-]>-<the first 8 hex of sha256 of its real path>)`. No branch name can map onto it, since a ref's path component cannot start with a dot (`git check-ref-format`). Two detached trees at one commit are two trees and get two folders.
2. **Every place that builds the folder takes it**: `S/run-jobs.cjs:20`, `S/run-owner.cjs:67`, `S/run-lanes.cjs:128` and `:288`, `S/run-check-session.cjs:53`, `S/run-mutate-journal.cjs:36`, `S/run-slot.cjs:46`, `S/run-scan.cjs:264`, `S/run-item-proof.cjs:382`, `S/run-item-check.cjs:51`, `S/run-real-app-prove.cjs:57`, `S/run-gate-rerun.cjs:60`, `S/run-integrate.cjs:240-241` and `S/run-gate.cjs:178-179`. Through `jobPaths` the rest follow: the accept record (`S/run-lanes-fix.cjs:25`), the review jobs (`S/run-review-job.cjs:51`, `:57`) and the supersede file (`S/run-supersede.cjs:32`). Afterwards no file of `S/` joins `cacheDir(tree)` with `currentBranch(tree)`.
3. **The merge slot's default holder** for a detached tree is the same name (`S/run-slot.cjs:120`, `:140`, `:151`, `:174`), so two detached trees never share a ticket.
4. **A wait reads its own tree's job only.** The job file names its tree (`S/run-jobs.cjs:86`). `gateWait` (`S/run-gate.cjs:348`) compares the real paths and refuses a job of another tree, naming both, so a folder shared by any other route never answers another tree's wait.
5. **Nothing a host reads moves.** A tree on a branch keeps `<cache>/<branch>/`, so a running intent finds its jobs across the install. The records keep `branch` as written today, `HEAD` for a detached tree: a host may read it (the first host's commit guard skips a gate job whose `refs/heads/<branch>` does not exist). Jobs a detached tree started before the install stay in `<cache>/HEAD/`, and nothing reads them after it. Nothing removes a `.detached/` folder, as nothing removes `HEAD/` today.
6. **The text.** The gate line of `src/flows/inferno/agents/orchestrator/skills/orchestrate/SKILL.md` says in one clause that a detached tree's records sit in `<cache>/.detached/<tree>/`, and `CHANGELOG.md` says it.

Tests, beside the lanes fixture (`S/run-lanes-fixture.cjs`), on two detached worktrees A and B of the fixture's host. Each is red on `892dbf69`, and the script below shows how:

- `jobPaths`, `ownerFile` and the check session folder of A differ from B's, and a tree on a branch still gets `<cache>/<branch>/`.
- A walks an instrument red that nobody accepts, then B walks a green lane: A's `gate --wait` exits 3 with `INSTRUMENT RED lane smoke` (today 0 with `GREEN lane smoke`), and A's `smoke --accept --harness-fix <sha>` exits 0 (today `NOTHING_TO_ACCEPT`).
- A accepts its instrument red, then B walks its lane: A's `gate --detach` prints `ACCEPTED lane smoke instrument red` and starts no lane (today it walks again), and A's wait still exits 0 on that line.
- B's `gate --detach` while A's lane walks starts B's lane (today `GATE_RUNNING`).
- A gate job whose `tree` is B, written into A's folder by hand, makes A's `gate --wait` refuse and name both trees.
- With `merge_slot` set, `slot --take` in A and in B gives two tickets.

## Which part is the flow and which the host

All of it is the flow's. The first host gated its release in a detached tree, which the flow takes without a word, and no host file changes. After the install, a host tool that builds `<cache>/HEAD/` by hand reads the flow's new function, or the `log` line a gate prints, instead. On the first host that is a check script of its test manager and the lead's notes, no part of this row.

## Until it is built

On one machine, one detached tree at a time runs `gate --detach` in any form, a lane or a lane accept. Another detached tree there starts none of them until the first tree's `gate --wait` has printed its verdict and that verdict is written down outside the cache: the second tree's first gate replaces what the first tree's wait and accept read. A host that needs two at once runs the second on another machine, whose cache is its own.

## The script

`node detached-repro.cjs <S/ of the version> <an empty scratch folder>`. It writes only under the scratch folder, the cache included (`XDG_CACHE_HOME`), and takes about ten seconds.

```js
'use strict';
// Two detached worktrees of one repo share the flow's per-tree state in <cache>/HEAD/.
// Usage: node detached-repro.cjs <orchestrate/scripts dir of a flow version> <empty scratch dir>
// Everything it writes stays under the scratch dir: the cache too (XDG_CACHE_HOME).
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const [S, scratch] = process.argv.slice(2).map((p) => path.resolve(p));
const root = fs.mkdtempSync(path.join(scratch, 'detached-'));
process.env.XDG_CACHE_HOME = path.join(root, 'cache');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (file, body) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };

// A host on main with a smoke lane whose exit is LANE_CODE, after LANE_SLEEP seconds.
const host = path.join(root, 'host');
fs.mkdirSync(host);
git(host, 'init', '-q', '-b', 'main');
git(host, 'config', 'user.email', 'repro@example.invalid');
git(host, 'config', 'user.name', 'repro');
put(path.join(host, 'lane.cjs'), 'setTimeout(() => process.exit(Number(process.env.LANE_CODE || 0)), 1000 * Number(process.env.LANE_SLEEP || 0));\n');
put(path.join(host, '.specs-inferno/config.yaml'),
  'delivery:\n  base_branch: main\nverification:\n  finalize:\n    - node lane.cjs\n  smoke:\n    command: node lane.cjs\n    scope: ["src/**"]\n');
put(path.join(host, 'src/a.txt'), 'a\n');
git(host, 'add', '-A');
git(host, 'commit', '-qm', 'base');
const base = git(host, 'rev-parse', 'HEAD');
// Tree A and tree B: each a detached worktree one in-scope commit past the base.
const tree = (name) => {
  put(path.join(host, `src/${name}.txt`), `${name}\n`);
  git(host, 'add', '-A');
  git(host, 'commit', '-qm', name);
  const dir = path.join(root, name);
  git(host, 'worktree', 'add', '-q', '--detach', dir, 'HEAD');
  return dir;
};
const A = tree('A');
const B = tree('B');

const run = (label, at, args, env = {}) => {
  const r = spawnSync(process.execPath, [path.join(S, 'run.cjs'), ...args, '--tree', at],
    { encoding: 'utf8', env: { ...process.env, ...env } });
  const said = `${r.stdout}${r.stderr}`.split(root).join('<root>').split(S).join('<scripts>').split('\n')
    .filter((l) => /lane|accept|ERROR/.test(l) && !/^wait with|^log |^lanes only|^land the/.test(l));
  console.log(`${label}: exit ${r.status} | ${said.slice(0, 1).join('')}`);
};
const gate = ['gate', '--detach', '--lanes-only', '--since', base];
const wait = ['gate', '--wait', '--minutes', '1'];
const accept = ['smoke', '--accept', '--harness-fix', base];

const jobs = require(path.join(S, 'run-jobs.cjs'));
const owner = require(path.join(S, 'run-owner.cjs'));
console.log(`one lane result for both trees: ${jobs.jobPaths(A, 'smoke').result === jobs.jobPaths(B, 'smoke').result} (${path.relative(root, jobs.jobPaths(A, 'smoke').result)})`);
console.log(`one owner file for both trees: ${owner.ownerFile(A) === owner.ownerFile(B)}`);

run('1 A gate, smoke instrument red after 2 s', A, gate, { LANE_CODE: '11', LANE_SLEEP: '2' });
run('2 B gate while A walks', B, gate);
run('3 A wait', A, wait);
run('4 A accept', A, accept);
run('5 A wait', A, wait);
run('6 B gate, smoke green', B, gate, { LANE_CODE: '0' });
run('7 B wait', B, wait);
run('8 A wait, after B walked', A, wait);
run('9 A gate again, accept on record', A, gate, { LANE_CODE: '11' });
run('10 A wait', A, wait);
run('11 B walks its smoke lane again, green', B, ['gate', '--detach', '--lane', 'smoke'], { LANE_CODE: '0' });
run('12 B wait', B, wait);
run('13 A accept the red it walked in 9', A, accept);
run('14 A wait (its red of 9 never accepted)', A, wait);
```
