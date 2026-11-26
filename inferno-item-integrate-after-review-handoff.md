# Handoff: the orchestrator runs an item's integrate checks only after its reviews are clean, so a red that only the full suites find costs another correction and another review round after two clean reviews

Row 0bu. Met on the first host on 2026-11-26 on Omega and Delta, over the five items it integrated that day, on the build installed there, `a8873ebb`. The tip holds the same `src/`.

`S/` below is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of the tip `49d32594`, whose orchestrator files equal the installed copy byte for byte.

## What is wrong

1. **The text puts the checks last.** The orchestrator commits the item, has it reviewed, and only then integrates (`src/flows/inferno/agents/orchestrator/agent.md:72-76`). A review finding goes back to the warm builder (`:70`), and a red integrate goes back to it again, after the review was clean (`:76`).
2. **The runner prints the same order.** The review's dispatch call ends on the record as its `then` line (`S/run-review.cjs:126-127`). A clean verdict prints `then integrate --item` (`:186-187`). No printed line starts a check before the review is clean.
3. **An item's own check may run nothing.** An item with no `finalize_check` prints `PASS <id> carries no finalize_check` at verify-item and runs no check (`S/run-item-proof.cjs:380-385`, row 0as). For such an item the integrate is the first run of any suite.
4. **The runner already holds what the other order needs.** `integrate` with no `--item` folds the base and runs the checks and completes nothing (usage `S/run.cjs:73`). It asks no review without an id (`S/run-integrate.cjs:222`) and completes nothing (`:325-327`). Each green command leaves a proof keyed by its command, its config and the hash of its scope (`S/run-proofs.cjs:150-158`), in a folder every tree of the repository shares (`S/run-lib.cjs:370-373`). A later run on the same inputs reads that proof as `GREEN` and runs nothing (`S/run-proofs.cjs:179-182`). A clean fold of the base keeps a recorded review current (`S/run-review-hash.cjs:8-12`, `standsSince` at `:206-223`).

## Evidence

The measurements are the item-speed oracle's of 2026-11-26, `/home/ruben/.local/share/skoft-agents/Skoft_CRA/tech-lead/oracle/oracle-item-speed-20261126.md`, over the five items integrated that day. Integrate took 29.3 min an item, 15.6 min of it in red runs, at 2.0 runs an item of 19 to 24 min each. Every first review said fix (5 of 5). Three of the four first integrate runs were red on the branch's own code after the reviews, each time on a pin or guard test outside the builder's budget. The integrate folders are under `~/.cache/specsmd-inferno/Skoft_CRA/inferno-intent/<branch>/` on each machine, read on 2026-11-26.

- **support-period, Omega.** `integrate-20261126T145955Z` ran from 14:59:55Z to 15:23:19Z. Its `cargo test` failed at 15:19:46Z: `wizard::templates::tests::every_template_the_shipped_requirements_point_at_can_be_prefilled` panicked at `src/wizard/templates/tests.rs:283:5`, left 71, right 70. The next run, `integrate-20261126T152516Z`, was green in 1,127 s (15:25:16Z to 15:44:03Z).
- **shell-keeps, Omega.** `integrate-20261126T154708Z` ran from 15:47:08Z to 16:07:32Z. Its `npm test` failed in `src/lib/i18n/restart-advice.test.ts` (2 of 6, the `en` and `nl` catalogues), and its `test:definitions` failed too. The orchestrator had started it at 15:46:44Z in one round with two cold reviewers of its other item (Agent calls at 15:46:56Z and 15:47:06Z, transcript `20958f2c` on Omega), and recorded that review at 16:11:46Z, after the run ended.
- **techdoc, Delta.** `integrate-20261126T172052Z` ran from 17:20:52Z to 17:44:35Z. Its `cargo test` failed after 401 s: `dossier::render::ea13_tests::ea13_annex_vii_risk_assessment_names_vulnerability_handling_requirements` panicked at `src/dossier/render/ea13_tests.rs:6:5`.
- **No check before integrate.** Omega, support-period's transcript `7966642f`, 14:13:17Z: `PASS sup-the-end-date-is-shown-at-purchase-and-its-end-is-notified carries no finalize_check`.
- **The landing reuses proofs.** shell-keeps' `integrate --item shl-a-settings-file-that-does-not-parse-says-to-reopen-the-app` started 17:07:27Z and returned at 17:07:34Z with `completed ... at 650dc47be`, with no command run, on proofs its band item's runs had minted. On Alpha, `tech-lead/w1-integrate-2.log:13` reads `GREEN 605s ... cargo test --manifest-path src-tauri/Cargo.toml (unchanged since 2026-11-26T11:17:08.773Z)`.

## How to fix

1. **The order in the text.** `agent.md:72-78` becomes: commit the item (as `:74`). In one round, start `run.cjs integrate --tree {path} --detach` with no `--item` and dispatch the item's cold reviews (`review --item`). Record the review only once `run.cjs integrate --tree {path} --wait` exits other than 4, as row 0at holds. Send the warm builder one correction that holds every review finding and every red of that run. After the correction's commit, do the same again beside the delta review. When the review is clean and the run was green, `integrate --item {item-id}` lands on the proofs that run minted.
2. **`integrate --detach` returns after its fold.** It folds the base in the foreground, then starts the checks as its own process and returns. The reviewers dispatched after it then read the tree the checks prove. The pair is row 0bo's `integrate --detach` and `--wait`.
3. **The runner prints the order.** The exit 3 lines of `review --item` (`S/run-review.cjs:122-129`) print the `integrate --tree <tree> --detach` start before the lens dispatches, and the record line says to record once its `--wait` exits other than 4. A fix verdict (`:189-200`) adds one line: every FAIL of the last checks-only run of the tree goes in the same correction. Once row 0at is built, the record refuses `TREE_BUSY` while that run is alive, so the order is held by the runner and not only by the text.
4. **No proof moves.** The landing `integrate --item` is unchanged. It reuses each proof whose inputs did not move and runs again each command whose scope a later commit or a moved base reached (`S/run-proofs.cjs:182`).

Tests:

- In `S/run-printed-calls.test.cjs`: `review --item` on a committed item prints the `integrate --tree ... --detach` start before its record line, and a fix verdict prints the line that sends the run's FAIL lines.
- In `S/run-integrate-review.test.cjs`: a checks-only integrate on the item's commit, then a clean record, then `integrate --item` runs no command and completes the item. A commit inside one command's scope after the checks-only run makes the landing run that command alone.
- In `src/__tests__/unit/inferno/inferno-flow.test.ts`: the orchestrator text starts the checks-only run in the review's round, records after its end, and sends one correction.

What it costs: the record now waits for the run, about 8 min an item by the oracle. Row 0bv shortens that run from 19 to 24 min to 12 to 13 min, about the length of the first review round, so most of that wait goes with it (expectation). Row 0bw's proof tree does not remove the wait, since the record's mutants and the run share that tree and row 0at keeps them apart there. The oracle counts 0.25 h an item saved net, and a few tokens saved: one correction fewer, and on one item in five one review round fewer.

Sibling rows: row 0bd is the same fault at the intent's gate. One runner mechanism serves both, a detached checks-only run that folds, runs a command list to verdicts with proofs and completes nothing: here `verification.integrate` at an item's commit, there `verification.finalize` after the last item. Row 0as moves a host guard to verify-item, before the commit, and stays: its red is met before any review round.

## Which part is the flow and which the host

All of it is the flow's. The host's part is its brief line below until the row is built, and the machine list it gives every `run.cjs` call.

## Until it is built

The first host's brief line since 2026-11-26, verbatim: "Item speed relay (oracle 26 Nov). Right after an item's commit, in one round, start `run.cjs integrate --tree <tree>` with no `--item` in the background, with timeout 7200000 and waited on by its log's closing line, and dispatch both cold reviewers. That call folds main, runs the integrate checks and completes nothing. Record the review only after that call has ended. Send the warm builder one correction that holds every review finding and every red of that call. After the correction's commit do the same again beside the delta review. When the review is clean and that call was green, `run.cjs integrate --item <id>` lands on the proofs it minted. Every run.cjs call carries the same REMOTE_RUN_MACHINES as your builders."
