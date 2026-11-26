# Handoff: a mutant whose host session did not open is recorded as run with no verdict, so no later record runs it, though the flow keeps every other mutant that never ran owed

Row 0bx. Met on the first host on 2026-11-26 on Omega, at the item review of `scn-a-two-document-pnpm-lock-reads-each-document` in the intent `the-scan-files-what-each-lock-names-and-keeps-its-own-scanner-database`, on the build installed there, `a8873ebb`. The tip holds the same `src/`.

`S/` below is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of the tip `a722f0ba`, whose scripts equal the installed copy byte for byte.

## What is wrong

1. **A lost session gives its entries no verdict without a run.** An open that exits non-zero sets `hs.lost` (`S/run-mutate-session.cjs:111`), as a send back that failed does (`:159`, `:194`). Every entry the session serves after that gets `{ caught: null, ...hs.lost }` and runs nothing (`:209-211`; `S/run-mutate-batch.cjs:140`).
2. **The record writes it as an entry that ran.** `runEntries` gives every row without `skipped` its verdict and `ran: true` (`S/run-mutant-runs.cjs:221-227`), and `verdictOf` writes `caught: null` as `caught: none` (`:167`).
3. **No later record runs a `none` entry.** A delta item record runs only an entry with no `caught` or with `caught: no` (`due`, `S/run-review-mutants.cjs:75`). `rearm` (`:239-245`) runs one again only when it is a bare check written again with `check: true`. The intent review takes over only an item's entries with no `caught` (`owedProposals`, `S/run-mutant-coverage.cjs:101-106`), and a `none` counts for nothing (`:10-11`).
4. **The flow's own rule keeps a mutant that never ran owed.** An entry the batch skipped, because an earlier run of its test found no command, "never ran: it keeps no caught and stays owed" (`S/run-mutant-runs.cjs:221`, `:224-226`; `S/run-mutate-batch.cjs:27-29`, `:199-204`). On a busy tree "nothing runs and each entry loses any verdict it had, so it reads owed" (`S/run-mutant-runs.cjs:172-173`, `:235-238`). An entry whose session never opened did not run either, yet it takes the other path.
5. **So its criterion falls to a hand step.** The record prints `the intent review owes criterion <n> a caught mutant or a checked pin` (`S/run-review-mutants.cjs:112`). The intent reviewer must then write the same mutant again as its own `<item>:<n>` proposal, which `refuseSecond` lets through because it skips `none` entries (`:281`). A reviewer who misses it costs one more intent record, refused for the gap.

## Evidence

Omega, branch `inferno-intent/the-scan-files-what-each-lock-names-and-keeps-its-own-scanner-database-20261126T142628Z`, read 2026-11-26 between 21:40Z and 22:05Z.

- The batch's open log, `~/.cache/specsmd-inferno/Skoft_CRA/inferno-intent/<branch>/mutate-batch-20261126T213624Z-1913171-host-session-open.log`, mtime 21:37:05.70Z, whole:

  ```
  remote-run: auto picked beta (beta=QUEUE 0)
  protocol version mismatch -- is your shell clean?
  (see the rsync manpage for an explanation)
  rsync error: protocol incompatibility (code 2) at compat.c(622) [sender=3.2.7]
  remote-run: rsync failed
  ```

- The record, commit `a60eee915` on that branch, `.specs-inferno/intents/<intent>/reviews/scn-a-two-document-pnpm-lock-reads-each-document.yaml`: `verdict: clean`, and the mutants of criteria 1 and 2 each hold `caught: none` with `why: "the session did not open (exit 2 -> <that log>)"`. Neither test ran.
- The open failed on the host, not in the flow, and the host fixes that part. Beta's WSL kernel refused an order-7 allocation for the hv_sock channel of the wsl.exe that the sync's rsync started. Beta's dmesg shows `[520099.573198] kworker/0:0: page allocation failure: order:7`, with `vmbus_alloc_ring` and `hvs_probe` in its trace, at 21:36:35Z after calibration. The host's wrapper then ended with exit 2.
- It was 1 of 13 session opens on Beta from Omega. Three earlier opens of this branch passed: 16:47:04Z and 17:15:26Z on Omega, and 20:52:55Z on Beta. Any host whose machine drops a single open meets this row.

Hours: none counted yet. The intent review of that intent has not run, and its reviewer owes the two proposals by hand.

## How to fix

- Mark each entry a lost session never ran as not run, as `skipped` does. At `S/run-mutate-session.cjs:210`, and wherever `noVerdict(hs)` stands for a run that never started (`S/run-mutate-batch.cjs:140`), give the row a mark the record reads the way it reads `skipped`. Then `S/run-mutant-runs.cjs:224-226` clears the entry and it stays owed, and `ranLines` (`:246`) prints `MUTANT <n> <why>, so it stays owed to the intent review`. The item's next delta record and the intent record run it (`due`, `owedProposals`), with no act by the reviewer. An entry that ran keeps what it read.
- Tests. In `S/run-mutate-session.test.cjs:110-118` ("a session that does not open reads no verdict for its mutants, runs none of them, and still closes"), the rows also carry the mark. Beside it, a record test with `act: "open@1=fail"` leaves the item's entries without `caught` and prints `stays owed to the intent review`. An intent review record after it runs both and writes `caught: yes`, with no proposal in the intent reviewer's file.
- The host's workaround until then. When an item record prints `MUTANT <n> no verdict: the session did not open` or a failed send back, the intent reviewer writes that entry again, word for word, as its own `<item>:<n>` proposal. No session records the item again for it, because a delta record never runs a `none` entry.
