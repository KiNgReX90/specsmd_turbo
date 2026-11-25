# Handoff: the settle of a minor-only fix review reads only the review's `files` list, so a correction in the file a minor finding names, outside the reviewed diff, is owed a delta review

Row 0bs. Met on the first host on 2026-11-25 on Delta, on the build installed there, `a8873ebb`. The tip holds the same `src/`.

## What is wrong

`S/` below is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

1. **A minor-only fix review settles when the correction stays inside the review's files.** `review --item` settles such an item with no second review when every path the correction touched is in the review's `files` (`unlisted`, `S/run-review.cjs:351-356`).
2. **A finding may name a file the diff did not touch.** A reviewer reads more than the diff, and a minor finding on a doc comment in a file outside the diff names that file in its `file` field. The review's `files` list holds the reviewed diff, not that file.
3. **So the one-line correction the finding asks for reads as unlisted.** The step owes a delta review: "the correction of the minor findings touches <file>, which the review does not list" (`:356`). The review that asked for the change cannot settle it.

## Evidence

- The FLOW line, Delta outbox line 365, 2026-11-25T06:11:26Z, intent `the-vulnerability-policy-prints-each-commitment-on-its-own-answer`, verbatim: "review: a minor finding that names a file outside the reviewed diff (item 6: a doc comment at render/document.rs:22) forces two delta reviews after a one-comment correction, because the settle rule reads only the review's files list and not the files its findings name; fix: count a finding's own file as listed."
- Read in the code at the tip. Not re-measured on the host.

## How to fix

1. **A finding's own file counts as listed.** In the settle check (`S/run-review.cjs:352`), the listed set is the review's `files` plus the `file` of each of its findings. The delta that a correction outside both still owes reads as today.
2. **The test.** Beside `S/run-review-settle.test.cjs`: a minor-only fix review whose one finding names a file outside its `files`, then a correction in that file alone and a passing verify-item, settles with no delta review. A correction in a file named by neither the `files` nor a finding is still owed one.

## Until it is built

A minor finding on a file outside the reviewed diff costs a delta review after its correction. Take that review; nothing on the host avoids it.
