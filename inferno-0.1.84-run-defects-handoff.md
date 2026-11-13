# INFERNO: defects met in real work on a host, and still to build

One file for the defects a host session meets, newest last. Each section says what is wrong, the evidence and how to fix it. Nothing here is built on the host's account: the host works around it and writes the section.

Only what is still to build is in this file. A section leaves it once it is built, and `inferno-build-next.md` keeps its row with the commit. Sections 1 to 11 are built in 0.1.85 and gone from here, and the fourteen sections of the 0.1.83 file before them are built as 0.1.84. Their text is in this branch's history, at `d5d82fa1` and at `912c9feb`. A section keeps its number, so the next one is 15.

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

## 13. verify-item runs an item's own check on the machine the orchestrator sits on, and a host that sends its tests elsewhere cannot route it

Met 2026-11-13 on the app repo. Not built: the code is the same in the build at `052e3654`.

### What happened

- An item's manifest holds `finalize_check: "npx vitest run src/lib/sbom/"`, a directory of test files, 757 tests.
- `verify-item` hands that string to `lib.runShell` in the tree (`S/run-item-proof.cjs:381`). No host key reaches it. `mutate.run` places a mutant's test, the host's own config wraps the integrate and gate commands, and `real_app.prove` has its own command. The item's check is the one test command of the flow that always runs where the orchestrator runs.
- This host's main machine is out of memory by its own measure and sends every suite to its test machines. Its low-memory guard ended the check with SIGTERM after 6 seconds, twice in a row. Each log holds the runner's first line and no result.
- `verify-item` printed FAIL both times and wrote a proof that did not pass. The check of a sibling item, one test file, passed on the same machine the same hour in under 3 seconds.
- The same check through the host's wrapper: 757 passed on a test machine.
- What the failed proof costs: the reviewer's brief carries a FAIL that is no fact about the code, and `settle` refuses a minor-only correction of such an item with "its verify-item proof failed" (`proofProblem`, `S/run-review.cjs:363`), so the item pays a second review.

### What the flow should do

- One host key says how an item's check goes to the host's test machine, in the shape `mutate.run` already has: `{tree}` and `{test}`, each one quoted shell word, and a check that already starts with the wrapper's own words, or that the host's wrapped pattern reaches, runs as written (`commandOf`, `S/run-mutate-host.cjs:100`). Suggested name: `verification.run`, beside `verification.session`. `verify-item` reads it for `finalize_check`. Without the key the check runs as today.
- The placed check runs through the shell the integrate step uses. With `verification.session` it then takes the session's slot, and with `verification.refused` a check the wrapper refused is no verdict: `verify-item` ends with exit 5 and leaves the last proof as it was, as integrate and gate do since `2bb00704`.
- The proof records the command as it ran.
- Tests: with the key, `verify-item` on an item with a bare check runs the placed command and records it. A check that is already wrapped runs as written. A run that ends on a refused line exits 5 and writes no failed proof. Without the key nothing changes.

### How the host gets through

It runs the item's check through its wrapper by hand and tells the reviewers the result. A minor-only correction of such an item goes to the short second review, since `settle` refuses the failed proof.

## 14. An accepted instrument red does not survive the fold of the fix it was accepted against

Met 2026-11-13 on the app repo. Not built: the code is the same in the build at `052e3654`.

### What happened

- The smoke lane of an intent at its final gate ended instrument red. The fix was one commit to a walk script of the lane's own harness. This host keeps its harness in the lane's scope on purpose, so that a change to the lane walks the lane.
- `accept` wants the fix on the base (`S/run-lanes.cjs:319`) and binds its record to the lane's proof hash of the tree as it stands (`:325`, `:331`). `readAccepted` holds the record for that same hash and no other (`:68`).
- The lane's hash covers every file in its scope (`laneProof`, `scopeHash`). So the fold that brings the fix into the tree changes the hash. Measured on a copy of the intent's tree with the installed readers: the smoke hash read `9dfb9d98` before the fix and `1b9af566` with it. With the one harness file left out it read `736729a3` both times.
- Both orders end the same. Accept first: the accept passes on the tree before the fold, `ship` folds the base (`S/run-ship.cjs:100`), `green` owes the smoke lane and `ship` stops with exit 3 (`:109`). Fold first: the tree's last lane result holds the old hash, and `accept` answers "no instrument red of the smoke lane on this tree to accept".
- After the fold nothing can be accepted, because the folded tree has no lane run. The one way on is to walk the lane again, which is the walk the accept exists to save.
- The flow's tests do not meet this. Their harness fix is a file outside the lane's scope, folded into the branch before the gate (`harnessFix`, `S/run-lanes-fixture.cjs:210`).

### Why it matters

A harness fix lies in the lane's scope on every host that lets a change to its harness walk the lane. There an accept can never reach a ship, and each instrument red costs a second walk of the lane. On this host that is about an hour and a half of its test machines.

### What the flow should do

- An accept holds for a tree that differs from the accepted tree only by the fix. One rule, read by `accept` and `readAccepted`, and through them by `smokeOwed`, the lane start of `gate` and `gate --wait`.
- The record keeps, beside the hash, the files of the lane's scope that the fix commit changed, and the lane's scope hash with those files left out (`scopeHash` takes `skip`).
- The record holds for a later tree when three things are true. That hash, with the same files left out, reads the same. The fix is an ancestor of HEAD. Each of those files is at HEAD what the fix commit left, the same blob. A later change to one of them retires the accept, as any other change in the lane's scope does today.
- The record has to be found for a tree whose proof hash moved. Today its file name is the proof's key (`${file}${ACCEPTED}`, `S/run-lanes.cjs:331`), so it needs a place by lane, or a reader that looks through the lane's records.
- `accept` on a tree that already holds the fix passes when the last lane result is an instrument red of a tree that differs from this one only by the fix, by the same rule.
- The accept prints the files it leaves out, one line, so that whoever accepts sees what ships unwalked.
- `accept_check` gets the fix sha, as `INFERNO_HARNESS_FIX` beside `INFERNO_LANE_RUN` (`S/run-lanes.cjs:290`), so that a host can refuse a fix that changes more than its harness.
- What stays: the latest lane result must still be the accepted run, and a fix outside the lane's scope works as today.
- Tests: an accept on a red tree with the fix inside the lane's scope on the base, then `ship` folds and merges with the ACCEPTED line. The fold-first order accepts. A second base commit to the same file retires the accept and `green` owes the lane. A base commit to another file in scope retires it. A fix outside the scope reads as today.

### How the host gets through

It folds the fix into the tree with `gate --detach` and walks the lane again.
