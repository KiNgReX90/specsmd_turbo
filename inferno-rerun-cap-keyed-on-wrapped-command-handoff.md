# Handoff: a rerun's cause is counted and written under the finalize command as the host's wrapper spells it, tree path included, so its limit never counts across branches

Found 2026-11-18 for Skoft_CRA, by reading the code of row 0r at `35f12380` against the host's config. It is not met in a run yet: the host still runs the build at `f3be640a`, and the first gate with a cause comes after its next install.

## What is wrong

Row 0r gives a rerun of a red finalize command its cause, an `exception: <command> rerun <json>` line in the merge commit, and a limit: two causes of one command on the base refuse the next, until a commit carries `Fixes-intermittent: <command>`.

The command it counts and writes is the string the gate's config holds. On a host whose wrapper takes the tree as an argument, that string differs per tree. Skoft_CRA gates with a config whose every finalize command reads `bash /home/ruben/.local/share/skoft-agent-hooks/remote-run.sh auto <tree> <command>`. So on that host:

1. The limit never counts. Two branches gated from two trees write two different commands for the same suite, and the third rerun of that suite is not refused. The limit is what makes a flake a row to fix and never a habit, and it is switched off without a word.
2. `Fixes-intermittent:` cannot lift anything a person would write. It would have to carry the whole wrapped string of one tree.
3. The merge commit on the base holds a machine path, the tree of a gate that is gone after the ship. Row 0r took care that the kept log is named relative to the cache for this reason, and the command beside it undoes that.

The flow already knows the name of such a command without its wrapper: the rest after `verification.session.match`. A gate mark may name a command that way since section 18 (`listed`, `S/run-criterion-marks.cjs:57-64`, through `reach`, `S/run-host-session.cjs:43`). The rerun does not use it.

## Evidence

In the flow at `35f12380`:

- `S/run-gate-rerun.cjs:146` writes the record with `command: red.command, tests: [red.command]`. `red.command` is the entry of `verification.finalize` as the gate ran it.
- `S/run-gate-rerun.cjs:88` and `:94` hand those commands to `repeats` at the gate, and `:181` hands `record.tests` to it at ship.
- `S/run-lanes-intermittent.cjs:177` counts an earlier line only when `record.tests.includes(test)`, and `:175` reads a fix only when `commit.fixes.includes(test)`. Both compare whole strings.
- `S/run-gate-rerun.cjs:184` and `rerunLine` (`S/run-lanes-intermittent.cjs:136`) write that command into the merge commit, once as text and once in the JSON.
- Neither `run-gate-rerun.cjs`, `run-gate-rerun.test.cjs` nor `run-ship-rerun.test.cjs` holds the word `session`: no test gates a command the session's match reaches.

On the host, Skoft_CRA at `f1e0237f7`:

- `scripts/remote-config.mjs:45-47` writes each finalize and integrate command as `${REMOTE_RUN} ${tree} ${command}`, and every gate starts with `--config` from that script (`docs/MACHINES.md:37`). A gate of a Delta intent runs from Alpha in a worktree made for that gate.
- `.specs-inferno/config.yaml:446` holds `verification.session.match: '^bash /home/ruben/\.local/share/skoft-agent-hooks/remote-run\.sh auto \S+ '`, which reaches every such command up to and including the tree.

Measured on Alpha, 2026-11-18 10:40Z, with `rerunLine` and `rerunRecord` of the flow at `35f12380` and the same suite gated from two trees:

```
exception: bash /home/ruben/.local/share/skoft-agent-hooks/remote-run.sh auto /home/ruben/dev/Skoft_CRA-gate-intent-a npm run test:definitions rerun {"command":"bash /home/ruben/.local/share/skoft-agent-hooks/remote-run.sh auto /home/ruben/dev/Skoft_CRA-gate-intent-a npm run test:definitions","tests":["bash /home/ruben/.local/share/skoft-agent-hooks/remote-run.sh auto /home/ruben/dev/Skoft_CRA-gate-intent-a npm run test:definitions"], ...}
tests of tree a include the command of tree b: false
rest after verification.session.match, tree a: npm run test:definitions
rest after verification.session.match, tree b: npm run test:definitions
```

## How to fix

Count and write a rerun under the name of its command, and keep the command as written only where a proof is looked up.

1. One function gives a finalize command its name under a config: the rest after `verification.session.match` when the match reaches the command (`reach`), else the command as written. It is the reading `listed` already gives a gate mark, so a mark, a cause and a fix line name one command the same way.
2. A command the match does not reach, on a host with no session or outside its match, may still hold the gate tree's absolute path. Write that path as `{tree}` in the name, the placeholder `mutate.run` and `verification.run` already use.
3. The record's `tests`, both `repeats` calls, the refusal's text and the `exception:` line, text and JSON, use the name. The record file and the proof it sits beside stay keyed by the command as written, since that is how `proofs.commandProof` finds them.
4. `Fixes-intermittent: <name>` lifts the limit. The usage line and the refusal already print whatever the count is keyed on, so they follow.
5. A base may hold lines the build at `35f12380` wrote with the whole command. Read a stored `tests` entry through the same naming, so those lines count with the new ones.

Tests, in `run-gate-rerun.test.cjs` and `run-ship-rerun.test.cjs`, with a `verification.session` whose match ends after a tree argument:

- two branches gated from two trees each ship a rerun of the same check: the base holds two lines whose command is the rest after the match, and neither line holds a tree path;
- the third rerun of that check, from a third tree, is refused at the gate and at ship, and a commit with `Fixes-intermittent: <rest>` lifts it;
- a lane accept of that name still counts in the same ledger;
- a config without a session whose command holds the tree's path writes `{tree}`, and one that holds no path keeps the command as written;
- a base line written with the whole wrapped command counts toward the limit of its name.

## Which part is the flow and which the host

All of it is the flow. The host changes nothing: its wrapper needs the tree as an argument, so `scripts/remote-config.mjs` cannot leave it out, and its `verification.session.match` already tells the flow where the wrapper ends. Once this is built, a fix on that host names the bare command, as in `Fixes-intermittent: npm run test:definitions`.

## Until it is built

The cause, the line and the kept log work as built. Only the count is missing, so the host keeps it by hand: before a third rerun of one suite, read `git log -E --grep='^exception: .+ rerun [{]' origin/main` and count the lines that end in that suite's command.
