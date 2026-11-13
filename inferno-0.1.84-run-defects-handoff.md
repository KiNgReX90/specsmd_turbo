# INFERNO: defects met in real work on a host, and still to build

One file for the defects a host session meets, newest last. Each section says what is wrong, the evidence and how to fix it. Nothing here is built on the host's account: the host works around it and writes the section.

Only what is still to build is in this file. A section leaves it once it is built, and `inferno-build-next.md` keeps its row with the commit. Sections 1 to 11 are built in 0.1.85 and gone from here, and the fourteen sections of the 0.1.83 file before them are built as 0.1.84. Their text is in this branch's history, at `d5d82fa1` and at `912c9feb`. A section keeps its number, so the next one is 13.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`.

## 12. A caught mutant whose line a correction removed still counts, and the intent review may not give its criterion a fresh one

Met 2026-11-13 on the app repo, on an item whose first review sent eight findings back. Not built: the code is the same in the build at `052e3654`.

### What happened

- The item's first review recorded a mutant for criterion 1, `.any(` to `.all(` in the function that decides whether a line names a cited reference. The batch caught it.
- The correction of that review's findings moved the decision into a new type in another file and rewrote the function the mutant named. No line of that file holds the find text any more.
- The two delta reviews that followed carried the entry as `caught: yes`. A delta review proposes no mutant (`refuseNew`, `S/run-review-file.cjs:387`), and it runs only what is due. `due` (`S/run-review-mutants.cjs:68`) is a proposal that never ran or a survivor, so a caught entry is never read against the tree again.
- The intent reviewer read the new code, saw that no mutant had run against it, and proposed one for that criterion. `refuseSecond` (`S/run-review-mutants.cjs:168`) refused the file: the criterion "has a mutant its item review caught".
- `withdrawn` is no way out. It takes a mutant of the last intent review or a proposal an item review left owed (`held` in `carryAside`, `S/run-review-aside.cjs`), never a caught entry of an item review, and a withdrawal closes no gap.
- Measured with the flow's own readers on that tree, in the installed version and in the build at `052e3654`: `itemProofs` (`S/run-mutant-coverage.cjs:106`) counts the entry for criterion 1, and `locate` (`S/run-mutant-runs.cjs:154`) answers for the same entry "changed, and find no longer marks one line of it". The item's five other caught mutants are placed, one of them three lines lower.
- A pin is held differently. `itemProofs` counts an item review's pin only while `pinProblem` finds it standing, and a delta review drops a pin that no longer stands with a line that says the intent review owes the criterion (`carriedPins`, `S/run-review-mutants.cjs:79`). A mutant has neither.

### Why it matters

- The count says the criterion's test is proven to turn red, and the proof is about code that is gone. The one reader that noticed is refused. Nothing fails, so nobody sees it: the review is clean with a criterion whose live code no mutant ran against.

### What the flow should do

- An item review's caught mutant counts while it can be placed on the tree as it is. `itemProofs` keeps an entry only when `locate` answers a line, with the files the item changed since its first review as `elsewhere`, the way `placedOwed` places an owed proposal. `refuseSecond` reads `item.mutants`, so the criterion is then open to the intent review, and `mutantGaps` names it when nothing else holds it.
- A delta item review prints one line for each carried caught entry that can no longer be placed, as `carriedPins` does for a pin: the entry, the why of `locate`, and that the intent review owes the criterion a caught mutant or a checked pin. The entry stays in the file as recorded.
- The reviewer's intent mode text says that a criterion whose item mutant no longer stands is its to cover.
- Tests: an item with one caught mutant, then a commit that rewrites the mutated line. The delta review prints the line, the coverage owes the criterion, and an intent review that proposes a mutant for it is taken and run. With the line only moved (the same text on another line, or in a file the item changed since), the entry counts as today and a second proposal is refused as today.
- One thing to decide while building: `green` reads the same count (`S/run-intent-owed.cjs:94`), so a fold of the base that rewrites a mutated line makes a recorded clean intent review read with a gap. A pin already behaves so. If that costs rounds at the gate that prove nothing, hold the stricter count to the moments a review is recorded.

### How the host gets through

It leaves the fresh mutant out, as the refusal asks, and the criterion keeps the count of the entry that is gone. A host that wants the proof runs that one mutant by hand on a test machine. The flow records nothing of it.
