# Handoff: `run.cjs select` can leave out the claimed intent a session is told to resume, so the named resume stops: a busy tree with no live owner on record is in no list, `select` counts its own process as the tree's, and the 30-line cap cuts the recover lines

Row 0ag. Found on the first host on 2026-11-19, while moving a running intent from one machine to another: the intent's tree is made on the new machine from the pushed run branch, and the session that resumes it starts in that tree. Read in the code at `f3be640a`, the build on the first host's main, and at `50721c90`, the tip that holds rows 0ae and 0af, and reproduced on both with the script at the end: the tip behaves the same.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of `50721c90`. Between the two, `S/run-lib.cjs` differs only by the standards helpers of `c1a015a7`, `S/run-owner.cjs` by the state folder of row 0af, which names the same folder for a tree on a branch, and `S/run-intents.cjs` by row 0ae's change to `dispatch-log`, which `select` does not run. `S/run-worktrees.cjs` and `S/run.test.cjs` are byte-identical.

## What is wrong

1. **A busy tree with no owner is in no list.** `select` walks every `in_progress` intent (`S/run-intents.cjs:131-156`). With its branch and tree present, a live owner session or gate job (`ownership`, `S/run-owner.cjs:113-122`) gives a `running` line (`S/run-intents.cjs:143-147`). Otherwise the tree reads busy when any process has its cwd inside (`processesIn`, `S/run-lib.cjs:394-412`), or when its tip commit or a changed or untracked file is younger than `recovery.idle_minutes`, 60 by default (`idleMinutes`, `S/run-lib.cjs:421-437`). A busy tree gets no reason (`S/run-intents.cjs:148-152`), so the intent goes into no list: not `running`, not `recover`. The `parked` list exists because an intent that fell through this loop appeared nowhere (`S/run-intents.cjs:117-121`), and a busy, ownerless one still does. The flow's own test pins only the recovery half: `S/run.test.cjs:62-68` asserts that an edited intent is not in `recovery`, and nothing asserts where it is.
2. **`select` counts its own process.** `processesIn` returns every pid whose cwd is in the tree, the asking `select` and the session above it included. A session that sits in the intent's worktree, or a shell that changed into it, makes the tree busy by asking. In case 3 of the script a tree idle for 180 minutes is in no list when `select` runs inside it, and in `recovery` when it runs from the primary checkout (case 2).
3. **The cap cuts the recover lines.** The human output keeps 29 lines and one `... n more lines` line (`capLines`, `S/run-lib.cjs:445-448`, applied at `S/run.cjs:271`). `select` prints the claimable, blocked and parked lines before the running, recover, leftover and owed ones (`S/run-intents.cjs:167-187`), so on a long ledger the lines a session acts on are the ones cut.
4. **So a named resume stops.** The orchestrator claims or resumes the intent named on invocation only when `select` lists it as claimable or resumable, and stops with the reason when it does not (`src/flows/inferno/agents/orchestrator/agent.md:37`). A run moved to another machine reads busy there until an hour has passed since the other machine's last commit, the tip it carries. Its new session sits in its tree, so the tree reads busy after that hour too, and `select` lists the intent nowhere.

## Evidence

The script's output on Alpha, the first host's desktop, identical on `f3be640a` and `f1c2c772` at 2026-11-19 06:12Z and on `50721c90` at 06:19Z:

```
1. tip 0 min old, select from the primary checkout: alpha in no list
2. tip 180 min old, select from the primary checkout: alpha recovery
3. tip 180 min old, select from inside the worktree: alpha in no list
```

Case 1 is a tree just moved to this machine, and case 3 the session that resumes it, sitting in its tree. Case 2 is the control, the path the flow's own test at `S/run.test.cjs:70-84` takes.

The cap, measured on Alpha at 06:16Z the same day, on the build at `f3be640a`, with `run.cjs select` in the first host's primary checkout. It printed 30 lines: the `claimable` header, five claimable intents, sixteen blocked and five parked ones, two `recover` lines and `... 3 more lines`. `select --json` listed five intents under `recovery`, and the third, the intent being moved to this machine, was among the three lines cut. Its session reads no line for it in the plain output even before its tree exists here.

## How to fix

1. **`select` leaves its own process chain out.** `processesIn` takes a set of pids to skip. `select` passes its own pid and every ancestor's, read from `PPid` in `/proc/<pid>/status` the way `sessionProcess` walks it (`S/run-owner.cjs:46-64`). The asking session and its shell then never make a tree busy, and any other process with its cwd in the tree still does.
2. **A busy tree with no owner gets a list of its own.** `select` puts it in `busy`, with the reason it read: `busy <id>  process <pid>, <pid> in the worktree` or `busy <id>  last work <n> min ago, inside the <m> min recovery window`. The payload gains `busy: [{ id, tree, reason }]`. A `busy` intent is never offered and never recovered on its own.
3. **The lines a session acts on come first.** The human output prints the `running`, `busy`, `recover`, `leftover` and `owed` lines before the `claimable`, `blocked` and `parked` ones, so the cap cuts the least actionable lines first.
4. **The text.** Step 1 of `src/flows/inferno/agents/orchestrator/agent.md` gains one sentence: "A `busy` line is an intent whose worktree shows a process or recent work with no live session on record: never offer it, and resume a named intent from it only when the user says its run moved here or its session is gone." That is about forty-five words. The first host's text budget measured 297 words left under its claude orchestrator ceiling and 73 under its codex orchestrator ceiling, on a scratch install of `ba8a86c2`, whose `agent.md` is the tip's. `CHANGELOG.md` says it.

Tests, in `S/run.test.cjs` with the fixture's `opened()`. Each is red on `50721c90`, and the first two are cases 1 and 3 of the script:

- The test at `S/run.test.cjs:62-68` also asserts that the edited intent is in `busy`, with a reason that names the recent work. Today it is in no list.
- A claimed intent whose tree is idle past the window, asked through a shell started inside its tree (`sh -c` with `cwd: tree`), is in `recovery`. Today it is in no list.
- A process the test starts with its cwd in that tree, a `sleep`, keeps the intent off `recovery` and puts it in `busy` with that pid. Today it is in no list.
- A ledger with more than 29 claimable, blocked and parked intents still prints every `recover` line in the human output. Today they are cut.

## Which part is the flow and which the host

All of it is the flow's. No host file changes. The first host met it by moving a run between machines, which the flow takes without a word.

## Until it is built

A session told to resume a named intent that `select` shows in no line resumes it anyway with `run.cjs worktree <id>`, which prints `resume <path>` for an open tree (`S/run-intents.cjs:318`), and never claims it again. That holds for a busy tree with no owner and for a recover line past the cap; `select --json` shows every list. Whoever moved the run says so in the session's first prompt, after making sure no other session still runs it.

## The script

`node select-repro.cjs <S/ of the version>`. It builds the fixture's host with `S/run-fixture.cjs`, whose temporary folders hold the cache too (`XDG_CACHE_HOME`) and go when the script exits. It takes about two seconds.

```js
'use strict';
// Row 0ag: select shows the claimed intent a session resumes in no list while its tree reads
// busy and no owner is recorded, and it counts its own caller as the tree's process.
// Usage: node select-repro.cjs <the flow's orchestrate/scripts folder of the version to test>
const fs = require('fs');
const path = require('path');

const scripts = path.resolve(process.argv[2]);
const { git, opened, repo, run } = require(path.join(scripts, 'run-fixture.cjs'));

const LISTS = ['claimable', 'blocked', 'parked', 'running', 'recovery'];

function where(fixture, cwd) {
  const result = JSON.parse(run(fixture, ['select', '--json'], { cwd }).out);
  const found = LISTS.filter((list) => (result[list] || []).some((entry) => entry.id === 'alpha'));
  return found.length > 0 ? found.join(', ') : 'in no list';
}

// A claimed run whose tree came from another machine: its tip is that machine's last commit,
// and no session on this machine has stamped the tree as its own yet.
function moved(ageSeconds) {
  const fixture = repo();
  const { tree, branch } = opened(fixture);
  if (ageSeconds > 0) {
    const then = `@${Math.floor(Date.now() / 1000) - ageSeconds} +0000`;
    git(tree, ['commit', '-q', '--amend', '--no-edit', '--date', then], { GIT_COMMITTER_DATE: then });
  }
  fs.rmSync(path.join(fixture.cache, 'specsmd-inferno', 'app', branch, 'owner.json'), { force: true });
  return { fixture, tree };
}

const fresh = moved(0);
console.log(`1. tip 0 min old, select from the primary checkout: alpha ${where(fresh.fixture, fresh.fixture.root)}`);
const old = moved(3 * 3600);
console.log(`2. tip 180 min old, select from the primary checkout: alpha ${where(old.fixture, old.fixture.root)}`);
console.log(`3. tip 180 min old, select from inside the worktree: alpha ${where(old.fixture, old.tree)}`);
```

The fixture's `opened()` runs `claim` and `worktree` from the script, and `worktree` stamps the nearest `claude` or `codex` ancestor as the tree's owner. The script removes that stamp, as `S/run.test.cjs:77-78` does, since a moved tree has no owner on its new machine.
