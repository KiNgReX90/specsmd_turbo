# Handoff: the test of a refused grant compares the stat index, which fills in once the files are two seconds old

Found 2026-11-17 in Skoft_CRA, in `npm run test:definitions` of the final gate of the intent `the-definitions-layer-owns-its-models-and-calls-nothing-above-it`, run on Beta. One red in 1765 tests. It turned the gate red, and one more gate of the same tree was green.

## What is wrong

`run-grant.test.cjs:193`, "a grant of a path another open dispatch owns is refused, and the record is left as it was", reads every file of the fixture's cache with `cacheBytes`, makes the grant that is refused, and asserts that the bytes are the same afterwards.

The cache holds more than the record. Beside the signed dispatch files, the sequence and the log it holds `index.json`, the stat index of `run-snapshot.cjs`. A refused grant takes a snapshot (`run-grant.cjs:114`, `captureSnapshot`), and every snapshot saves the stat index. The index keeps a file's hash only once the file's times are more than `RACY_MS` (2000 ms, `run-snapshot.cjs:29`) old. So `index.json` is `{}` while the fixture's files are young and holds eight entries once they are two seconds old.

On a fast machine the whole test ends inside those two seconds, and both reads see `{}`. On a loaded machine the two dispatches before the grant take longer, the grant's snapshot meets files older than two seconds, and `index.json` fills in between the two reads. The grant did what it should: it was refused and it left the record alone. Only the test is wrong, because it holds a cache to the promise made for the record.

The test at `run-grant.test.cjs:162`, "a path the dispatch already owns through a directory entry leaves the signed record as it was", uses the same `cacheBytes` and fails the same way when its one dispatch and its grant straddle the two seconds.

## Evidence

- Alpha, `~/.cache/specsmd-inferno/Skoft_CRA/inferno-intent/the-definitions-layer-owns-its-models-and-calls-nothing-above-it-20261116T174943Z/gate-20261117T124204Z/4.log`, from line 10878: `AssertionError` at `run-grant.test.cjs:201:10`, `pass 1764`, `fail 1`. The only key that differs is `.../index.json`: expected `{}`, actual eight entries. The ship of the intent removed this log with the branch's cache folder, so these lines are the only copy (row 0r).
- The same log gives the times. The fixture's files are stamped `2026-11-17T12:55:47.808Z` to `47.818Z`. The two dispatches are logged at `12:55:48.485Z` and `12:55:49.263Z`. The grant's snapshot ran after `49.81Z`, more than 2000 ms after the files were written. The test took 2363 ms, where it takes 0.8 to 1.3 s on a quiet machine.
- The test and `run-snapshot.cjs` on this branch are the same as the installed ones (`diff` is empty), so the branch holds the defect too.

## How to fix

Compare what the test names: the record. In `cacheBytes`, leave the stat index out (a file named `index.json` in the dispatch directory), so the comparison covers the signed dispatch files, the `current-*` files, the sequence, the log and the proof key. Both tests that use `cacheBytes` are then fixed by the one change.

Do not touch `RACY_MS`, and do not stop a refused grant from saving the index. The index is a cache that every snapshot may warm, and the two seconds guard against a filesystem with coarse file times.

No new test is needed: the two tests are the pin. To see the old one fail on demand, sleep 2100 ms in the test between the last `f.start` and the grant.

## Not the same fix as row 0p

Row 0p (`inferno-first-write-clock-lag-handoff.md`) and this row are both a test that depends on the wall clock, and nothing else is shared. Row 0p compares a stamp from the kernel's coarse clock with `Date.now()`, and is fixed by reading both bounds from one clock. This row compares a cache whose content depends on the age of a file, and is fixed by leaving the cache out of the comparison. They are two small changes in two test files, and one builder can make both in one commit.
