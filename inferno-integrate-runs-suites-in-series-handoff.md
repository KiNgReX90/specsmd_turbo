# Handoff: integrate and the gate run their commands one after another in one host session, so a run takes the sum of its suites where its Rust group and its Node group could run side by side

Row 0bv. Met on the first host on 2026-11-26 on Omega and Delta, in the integrate runs of the five items it integrated that day, on the build installed there, `a8873ebb`. The tip holds the same `src/`.

`S/` below is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of the tip `49d32594`, whose orchestrator files equal the installed copy byte for byte.

## What is wrong

1. **Integrate runs its list in order.** Its plan maps `verification.integrate` one command at a time (`S/run-integrate.cjs:284-290`). Each command goes through `proofs.runCommand` (`S/run-proofs.cjs:179-194`), which blocks on `spawnSync` until the command ends (`S/run-lib.cjs:338-349`).
2. **The gate does the same.** It runs `verification.finalize` in order and stops at the first red (`S/run-gate.cjs:189-195`).
3. **One step has one host session.** `verification.session` opens at the first command its `match` reaches and runs every reached command in it, back to back, until the close (`S/run-check-session.cjs:62-98`, `inSession` at `:104-115`). The config documents it so (`src/flows/inferno/agents/orchestrator/config.example.yaml:64-68`).
4. **No key places them otherwise.** `verification.run` places only an item's own check at verify-item (`S/run-item-check.cjs:45-62`). No key groups the commands of one step, and nothing in the runner starts two at once. So the first host cannot fix this in its config.

## Evidence

The measurements are the item-speed oracle's of 2026-11-26, `/home/ruben/.local/share/skoft-agents/Skoft_CRA/tech-lead/oracle/oracle-item-speed-20261126.md`. One integrate run took 19 to 24 min, at 2.0 runs an item. Its cargo group takes 537 to 605 s, and `npm test`, `test:definitions`, `check` and `test:docs` take 560 to 760 s together. Side by side the run would take 12 to 13 min. The time is test run time, not build time.

- **One run, Omega.** support-period's `integrate-20261126T152516Z` (15:25:16Z to 15:44:03Z, 1,127 s), read from its log times: `check` 31 s, `npm test` 215 s (ended 15:29:31Z), `test:definitions` 300 s (ended 15:34:33Z), `test:docs` 18 s, `cargo check` 4 s, `cargo test` 537 s (ended 15:43:58Z, `6238 passed ... finished in 498.47s`). The Node commands took 564 s and the Rust ones 541 s, run one after the other.
- **One run, Delta.** techdoc's `integrate-20261126T172052Z` (17:20:52Z to 17:44:35Z, 1,423 s): `npm test` 237 s, `test:definitions` 429 s, `cargo test` 401 s, `verify:site` 214 s, one after the other.
- **The host's wrapper holds a machine per session.** support-period's `session-o67eke-open.log` (15:25:22Z) reads `df-stress holds the machine lock for this session`. The wrapper runs one run at a time per machine under a flock (`/home/ruben/.local/share/skoft-agent-hooks/remote-run.sh:30`), a session keeps that lock until its close (`:46-47`), and a second call of one tree on one machine waits for the first (`alpha_lock`, `:336-351`). So two sessions of one tree on one machine queue. Its `auto` pick passes a machine where the tree already runs over for one with room (`:103-105`), so a second session goes to a second machine when the list names one.
- **One machine would contend.** Omega has 6 cores (i7-1185G7) and Delta 4 (Xeon E3-1230 v6), read at 19:19Z. No log records CPU seconds for `cargo test`: the build wrapper's log and the wrapper's run lines hold wall time only. Omega's `sar` averages over ten minutes, in which no other run went through Omega's build wrapper: from 15:00Z to 15:10Z, the first run's `npm test` and `test:definitions`, 53% busy, 4.6% iowait, 41.5% idle; from 15:10Z to 15:20Z, its `cargo test` (15:10:35Z to 15:19:46Z), 34% busy, 19.8% iowait, 45.9% idle. The two groups together would use about 87% of Omega's six cores, and the Rust group already waits on the disk a fifth of its time.

So the 12 to 13 min needs two machines, each with a warm copy of the tree. On one machine the host's lock queues the second session, and with a lock that let both run they would share the cores and the disk (expectation, not measured).

## How to fix

1. **A host key that groups commands.** `verification.groups`, a map from a group's name to a list of command strings out of `verification.integrate` and `verification.finalize`. Each command is in at most one group, and a command no group names runs in the first group the map lists. It is validated beside `verification.session` (`validateChecks`, `S/run-check-session.cjs:49-51`), naming the file.
2. **Integrate and the gate run the groups at once.** Each group runs as its own child process of the step, in the same tree and log folder, with its own `verification.session` open, run and close. Its session commands get `INFERNO_GROUP`, the group's name, beside `INFERNO_TREE` and `INFERNO_SESSION` (`S/run-check-session.cjs:66`), so a host's wrapper can place each group on a machine of its own choice. Within a group the commands run in list order. The step waits for every group.
3. **Proofs and verdicts are unchanged.** Each command keeps its own proof, keyed as today (`S/run-proofs.cjs:150-158`). Integrate still runs every command and names every red in one result (`S/run-integrate.cjs:277-299`). In the gate a red stops its own group at once, and the other group stops after the command it is running, whose proof or red stands. The refused round (`checkRounds`, `S/run-check-session.cjs:128-146`) runs per group, and the moved check (`S/run-integrate.cjs:320-323`) and the browser step after every group passed run as today. The lines print in the config's order.
4. **Without the key nothing changes.** One group holds every command, as today.

Tests, beside `S/run-integrate-session.test.cjs` and `S/run-gate-session.test.cjs`:

- With two groups whose commands each sleep 2 s, an integrate ends in about 2 s and not 4, with a proof for each command.
- Each group opens its own session: two open logs, two close logs, and each session's commands read their own `INFERNO_GROUP`.
- A red in one group leaves the other group's proof, and the result names the red.
- A command in two groups is refused with the file named.
- Without the key, one session runs every command in order, as today.

## Which part is the flow and which the host

The key and the side by side runs are the flow's. The host's part, not for the builder of the row: its config sets two groups, the Rust one (`cargo check ... --features promo-capture --example promo-capture`, `cargo test --manifest-path src-tauri/Cargo.toml`) and the Node one (every other integrate command), and every `run.cjs` call names two machines in `REMOTE_RUN_MACHINES`. Its wrapper reads `INFERNO_GROUP` and keeps the Rust group on the machine that holds the tree's warm target, and sends the Node group to the second machine, which compiles no Rust. A Rust group sent to a machine with no copy of the tree pays a cold compile there (`cargo test` 1,265 s cold against 605 s warm, by the oracle), which takes the whole gain of that run back. A run then holds two locks for about 10 and 12 min instead of one for 19 to 24, so its lock time stays about the same.

With row 0bu, a run of 12 to 13 min that starts at the item's commit ends about when the first review round does, so most of the 8 min the record waits for it there goes (expectation). The same key serves row 0bd's early gate, which runs `verification.finalize`.

## Until it is built

Integrate and the gate run in series. No session splits an integrate's commands by hand, and no host script splits them over two machines: the item-speed oracle refused that as a new reuse key. With row 0bu's brief line the run in series starts at the item's commit, beside the reviews.
