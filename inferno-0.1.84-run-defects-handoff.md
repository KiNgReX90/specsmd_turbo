# INFERNO: defects met in real work on a host, and still to build

One file for the defects a host session meets, newest last. Each section says what is wrong, the evidence and how to fix it. Nothing here is built on the host's account: the host works around it and writes the section.

Only what is still to build is in this file. A section leaves it once it is built, and `inferno-build-next.md` keeps its row with the commit. Sections 1 to 23 are built in 0.1.85 and gone from here, and the fourteen sections of the 0.1.83 file before them are built as 0.1.84. Their text is in this branch's history: sections 15 to 23 at `1aa836a2`, sections 12 to 14 at `120be9b4`, sections 1 to 11 at `d5d82fa1`, and the 0.1.83 file at `912c9feb`. A section keeps its number, so the next one is 27.

Three sections are open: 24, 25 and 26. They are rows 0y, 0z and 0aa of `inferno-build-next.md`.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

## 24. A count probe that shows 0 reads as drift, because grep exits 1 on no match

**What is wrong.** `measure` (`S/run-probes.cjs:120`) returns `exit <code>` for any non-zero exit, so `run.cjs probes` (`:192-198`) compares a probe's output with its `shows` only when the command exits 0. A probe of the form `grep -c X file` whose plan says `shows: "0"` prints `0` and exits 1, since grep exits 1 when nothing matches. It is then reported as `drift ... expected 0 got exit 1`, although the output is exactly what the plan says. Plan-lint accepts the probe, so the plan carries a probe that can never pass.

**Evidence.** Skoft_CRA, intent `a-journeys-green-moves-only-with-what-it-runs-and-the-testers-own-rules-are-checks`, item `jgm-the-tester-and-the-journeys-are-type-checked`, 2026-11-16. The probe `grep -c tester scripts/tsconfig.checkjs.json` with `shows: "0"` was reported as drift before the item's builder was dispatched, and the orchestrator had to read the drift by hand to tell it apart from a moved tree.

**How to fix.** Plan-lint runs each probe the way `probes` runs it and refuses one whose exit is non-zero while its output matches `shows`, so the planner writes `grep -c X file || true` or `git grep -c`. Or `probes` compares stdout first and reads a non-zero exit as drift only when the output differs too. Test: a probe printing `0` with exit 1 against `shows: "0"` is no drift, or plan-lint names it.

## 25. A sibling's correction to a file two items own fails the other item's proof with a message that names a correction it never had

**What is wrong.** When two items of one intent both own a file, and a correction of one of them changes it after the other's dispatch was accepted, the other item's `verify-item` stops with `DISPATCH_PROOF accepted dispatch bytes changed at <file>: run dispatch-log before a correction resumes the builder` (`S/run-attribute.cjs:100`). The item had no correction. The only way on is a `dispatch-log` with no builder behind it, accepted with the shared path, then the item's delta review of a change it did not make. `integrate` meanwhile refuses with `ITEM_REVIEW_OWED`.

**Evidence.** Skoft_CRA, same intent, 2026-11-16. `jgm-a-selector-src-drops-fails-the-unit-gate` and `jgm-a-lane-names-the-tester-changes-main-took-under-its-walk` both own `docs/TESTING.md`. The lane item's correction `e2b0757a9` (its `Item:` trailer names the lane item) changed the file. The selector item's integrate then refused, and its `verify-item` gave the DISPATCH_PROOF line. The empty dispatch `78491fe4-3ef7-4353-b7f8-20e5985a24c0` and two delta reviews of range `068b02062..3ad4b65cc` cleared it. Both reviews read only the sibling's paragraph and were clean.

**How to fix.** When the bytes of an accepted path changed, `verify-item` reads the `Item:` trailer of the commit that changed them. When it names a sibling, it takes the proof again itself and says the item's review is owed for that range, with no new dispatch. The DISPATCH_PROOF line stays for bytes no item's commit explains. Test: two items owning one file, a committed change to it carrying the other item's trailer, gives a fresh proof and an owed review, never DISPATCH_PROOF.

## 26. A delta reviewer whose verdict still holds leaves its file unwritten, and the record refuses it

**What is wrong.** A delta review whose earlier verdict still stands can leave its review file as it was. The record then refuses: `refusing to record the review of <item>: <file> is not written` (`S/run-review-quality.cjs:186`). The reviewer cannot stamp the file instead, because the schema refuses `commit:` and has no field for a line of reading. The "Delta review" sections of `agents/reviewer/agent.md:31` and `agents/reviewer-quality/agent.md:51` say how to treat each earlier finding, but not that the file must be written again when nothing in it changes.

**Evidence.** Skoft_CRA, same intent, 2026-11-16, the quality review of `jgm-a-selector-src-drops-fails-the-unit-gate`, range `068b02062..3ad4b65cc`. The reviewer answered "clean, the file stays as written", and the record refused. The reviewer had to be resumed only to write the same file again.

**How to fix.** The two "Delta review" sections say a delta review always writes its file again, even when nothing in it changes. Or the record accepts an unchanged file whose verdict is clean and whose earlier findings are all resolved, and stamps the new range itself.
