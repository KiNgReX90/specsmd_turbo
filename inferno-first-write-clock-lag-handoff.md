# Handoff: the test of a first write reads two clocks, and fails when they straddle a second

Built in `7b3df6ef`, as row 0p of `inferno-build-next.md`. This file can be removed from the branch; its text stays in history.

Found 2026-11-17 in Skoft_CRA, in `npm run test:definitions` of the intent `the-product-page-wears-chapter-arcs`, run on Delta. One red in 1765 tests. It blocked one integrate, and the next run of the same tree was green.

## What is wrong

`test-write.test.cjs:106`, "a rewrite never keeps a second the file had before, and a first write keeps its own", takes `before = second(Date.now())`, writes the file, and asserts `seen[0] >= before`, where `seen[0]` is the second of the file's `mtimeMs`.

The two times come from two clocks. `Date.now()` reads the precise clock. Linux stamps a file with the kernel's coarse clock, which is the time of the last timer tick and so lags the precise one by up to a tick (4 ms on Delta, `CONFIG_HZ=250`). When `before` is read just after a second starts and the write lands before the next tick, the file's second is the one before `before`, and the assertion fails. The helper is right. Only the test is wrong.

## Evidence

- Delta, `~/.cache/specsmd-inferno/Skoft_CRA/inferno-intent/the-product-page-wears-chapter-arcs-20261117T050347Z/integrate-20261117T095108Z/2.log`, lines 10853 to 10884: `AssertionError: the first write keeps the time it was made` at `test-write.test.cjs:112:10`, `pass 1764`, `fail 1`. The test ran for 1.19 ms.
- Delta: kernel `6.12.48+deb13-amd64`, `CONFIG_HZ=250`.
- The file on this branch is the same as the installed one (`diff` is empty), so the branch holds the defect too.

## How to fix

Read `before` from the clock the file is stamped with. Write a sibling file with the plain write first and take the second of its `mtimeMs` as `before`. Both stamps then come from the coarse clock, which never runs backwards between two writes. Read the upper bound after the write from `Date.now()` as today: the precise clock is never behind the coarse one.

Allowing one second of slack (`seen[0] >= before - 1`) would also pass, but it would no longer tell a first write that kept its time from one the helper moved back a second, which is what the assertion is for.

No new test is needed: the changed assertion is the pin. To see the old one fail on demand, loop the test body until a run starts within a few milliseconds after a second boundary.
