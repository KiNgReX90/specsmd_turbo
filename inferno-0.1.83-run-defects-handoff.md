# INFERNO 0.1.83: defects met in real work on the first host

One file for the defects a host session meets on 0.1.83, newest last. Each section says what is wrong, the evidence and how to fix it. Nothing here is built on the host's account: the host works around it and writes the section.

`S/` is `src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/`. Line numbers are those of this branch at `958ecc1d`.

## 1. An item review cannot be asked for once a correction deleted a file its last review lists

Seen 2026-11-11 on the app repo, intent `the-declaration-of-conformity-is-complete-for-every-stated-law`, item `doc-the-toy-image-is-owed-on-the-declaration-and-filed-with-it`. First met on 0.1.82. The code is the same on 0.1.83.

### What happens

- Round 1 of the item was recorded. Its contract review lists `src-tauri/src/dossier/attachments/image_kind/png_chunks.rs` under `files`.
- The correction that answers the round 1 findings deleted that file.
- `run.cjs review --item <id>` then exits 2 and prints no dispatch:

  ```text
  ERROR [BAD_REVIEW] .specs-inferno/intents/<intent>/reviews/<item>.yaml: files lists src-tauri/src/dossier/attachments/image_kind/png_chunks.rs, which is not in the tree. send this back to the reviewer that wrote the file, then run the same command again.
  ```

- The advice in that line cannot be followed. The file is the recorded review of the earlier round. Its reviewer listed a file that was in the tree when it read it, so there is nothing to send back.

### Why

- `boundFiles` (`S/run-review-file.cjs:125-137`) refuses a listed file that is not on disk. It is called from `parseItemReview` (`:164`) and from `parseQualityReview` (`S/run-review-quality.cjs:220`) for a recorded file as for a fresh one. The `recorded` option does not reach it.
- `review --item` reads the recorded review first, with no pending file in the tree: `const current = exists && !pending ? lens.readItemReview(tree, intent.id, item.id, { recorded: true }) : null` (`S/run-review.cjs:307`). Nothing catches the throw, so the command ends before it can say what is owed.
- The two other readers of a recorded review do catch it and then point at the command that cannot run. The check over all items says "`<id>` has no readable review file, run `<the item review call>`" (`S/run-review.cjs:432-437`). `review-item` says the file "cannot be read" and asks for the record call (`S/state-review.cjs:186-191`).
- A rename by a correction is the same case: the old path leaves the tree.
- A later item that deletes a file an earlier, completed item's clean review lists meets the same readers. That was not seen on the host, so it is named here only as where to look.

### What the flow should do

A file that left the tree since a review was recorded is a file that changed since the review. It makes the review stale. It does not make the review file malformed.

- `boundFiles` checks that a file is on disk only for a fresh review file. For a recorded one it keeps the path in `files`.
- A recorded review whose listed file is gone then reads as "a file it lists changed since its review" through the hash that already decides this (`itemReviewCurrent`, `S/run-review-hash.cjs:230`), and `review --item` goes on to print the dispatch of the lenses that are owed.
- The delta rule needs one line for this case: the reviewer of the next round is told that the file is gone, so it does not look for it.
- Tests: a recorded contract review and a recorded quality review that each list a deleted file, then `review --item` exits 3 with the dispatch. The same for a renamed file. The check over all items names the item as stale, with no "no readable review file".

### How the host got through

It dispatched both lenses by hand, with the brief the dispatch would have printed. A fresh review file lists only files that exist, and with a pending file in the tree `review --item` reads the pending files (`pendingFiles`, `S/run-review.cjs:270-273`) and not the recorded one (`:307`), so the record goes through. Seen on the host on 2026-11-11, with 0.1.82 still in that tree: `review --item <id> --reviewer <id> --quality-reviewer <id>` exited 0 and printed "review `<item>` clean, recorded at `d7fb1afba`". These lines are the same on 0.1.83.

## 2. A helper named `fit` in a Rust test file reads as a switched-off test

Seen 2026-11-11 on the app repo, intent `the-declaration-of-conformity-is-complete-for-every-stated-law`, item `doc-a-toy-declaration-carries-its-image`, on 0.1.83. The rule came with `verify-item`'s proof in 0.1.82 (`df9f5119`).

### What happens

`run.cjs verify-item` fails the item on four added lines of a Rust test file, none of which switches a test off:

```text
switched off: src-tauri/src/dossier/graphics/image_tests.rs:332: assert_eq!(fit(400, 300), (4_800_000, MAX_HEIGHT_EMU));
switched off: src-tauri/src/dossier/graphics/image_tests.rs:335: assert!(fit(0, 300).0 > 0 && fit(400, 0).1 > 0, "never a box of zero");
```

`fit` is the function under test: it fits an image into a box.

### Why

- `SWITCH_OFF` (`S/run-test-files.cjs:28-42`) is one list for every language, and `isSwitchOff(line)` (`:62-65`) reads the line alone. Its third pattern, `/(?<![\w$.])(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(/` (`:31`), is Jasmine's and Jest's focused and excluded tests. It matches any bare call of a function named `fit`, in any test file.
- The caller knows the file: `if (isSwitchOff(added.text)) changed.switched_off.push({ file, ... })` (`S/run-item-proof.cjs:268`). It does not pass it on.
- The suite pins `model.fit(data)` and `outfit(x)` as no marker (`S/run-test-files.test.cjs:84-85`). It has no bare `fit(` outside a JS or TS file.
- The same holds for every marker: each is read in every language. `@Ignore` in a comment of a TS test file and `t.skip(` in a Go test file are refused the same way. Only the `fit` case was met.
- The list is fixed and has no host setting, so a host cannot answer a false refusal.

### What the flow should do

- A marker is read only in the languages whose runner knows it. `isSwitchOff(line, file)` picks the markers by the test file's extension: the JS and TS markers for `.js`, `.cjs`, `.mjs`, `.jsx`, `.ts`, `.tsx` and the like, `@Disabled` and `@Ignore` for Java and Kotlin, the pytest and unittest markers for `.py`, `t.Skip` for `.go`, `#[ignore]` for `.rs`. A file of another extension is read against all of them, as today.
- Tests: `assert_eq!(fit(400, 300), ...)` in `image_tests.rs` is no marker. `fit('focused', () => {` in `a.test.ts` is one. `#[ignore]` in a `.rs` file is one and in a `.ts` file is not.
- A bare `fit(` call of a helper in a JS or TS test file stays refused. That is the price of reading lines and not syntax, and the refusal line already names the file and the line.

### How the host got through

It renamed the helper in the test file, so no added line calls a bare `fit(`.

## 3. A ship says nothing when the host set no ship cleanup, so a host runs for days without one

Seen 2026-11-11 on the app repo, on 0.1.83. The code is the same on every version that has `verification.ship_cleanup`.

### What happens

- `removeWorktree` (`S/run-ship.cjs:153`) removes the tree and the branch and then runs the host's cleanup only when the config sets one. With no `verification.ship_cleanup` it returns null at `:164` and prints nothing.
- The flow's own folder for the branch, `<cacheDir>/<branch>/` (`cacheDir`, `S/run-lib.cjs:363`), holds the gate, lane, verify and mutate logs of the run. The flow never removes it. The comment above `shipCleanup` (`S/run-ship.cjs:172`) leaves that folder to the host.
- So a host without the key keeps one folder per shipped intent for ever, and every ship prints a clean result.

### Evidence

- The host wrote its cleanup on 2026-11-06 (`scripts/ship-cleanup.mjs`, built to run as `verification.ship_cleanup`) and never set the key: `git log -S ship_cleanup -- .specs-inferno/config.yaml` is empty on the host.
- On the host's main machine `~/.cache/specsmd-inferno/Skoft_CRA/inferno-intent/` holds 136 branch folders, 4.6 GB. 123 of them belong to intents that are archived on `origin/main`.
- Nobody noticed for five days, because nothing the flow printed differed from a host that cleans up.

### What the flow should do

- When `ship` or `teardown` ends with no `verification.ship_cleanup` set and the branch's cache folder is still there, it prints one line that names the folder it leaves and the key that would remove it. It refuses nothing: the ship stands.
- Test: a ship on a fixture host without the key prints that line and exits 0. With the key it prints the cleanup's last line, as today.

### How the host got through

It sets the key, and a timer on each machine removes the folders of intents that are already archived.

## 4. A test for the real binary is written by a builder that never runs it, and the final gate's lane is the first to execute it

Seen 2026-11-06 to 2026-11-11 on the app repo, on 0.1.82 and 0.1.83.

### What happens

- `src/flows/inferno/agents/planner/agent.md:155`: what only the real binary shows becomes "a tester case, written in the run and proved by hand afterwards, never asked to be green".
- `src/flows/inferno/agents/builder/agent.md:41` sends "anything only the real binary shows" to the project's integration case list "with a test beside it, proved on the built binary by the harness that owns it". The builder's verification names its unit test. Nothing runs the new case.
- `S/run-real-app.cjs:5-6` says it outright: "No gate runs those journeys inside an agent run, so the review is where a stale one is caught". The command reads which test ids, labels and routes a diff took away. It executes nothing.
- So on a host with real-app lanes (`verification.smoke`, `verification.windows`) the first execution of a new or changed case is the final gate's lane walk, after every item is built and reviewed. A test that is wrong is found there, one lane walk per find.

### Evidence

All on the host's intent `the-confirmed-launch-findings-are-fixed-before-the-freeze`, whose complete lane walk takes 1.9 to 4.2 hours.

- TC-368: the new test looked for a test id in the tester's snapshot, which never lists a node without a role. Its first run was the Windows lane on 2026-11-11, which called it PRODUCT RED (host fix `34b3e91bc`).
- TC-159: the helper waited for a cell the board does not draw when no duty applies. First run: the same lane walk (`b9ad2bc8a`).
- TC-034 (twice) and TC-035: assertions that could not fail. The fix then met the host's red-first rule and was reverted to ship (`1c313cf86`).
- TC-024 on 2026-11-08: waited for text the screen already showed (`1f6ea42aa`, `f480cd366`), 8.4 hours.
- On 2026-11-11 that intent's four complete lane walks were all red, none on a product defect.

### What the flow should do

- A host can name a command that proves real-app journeys: `real_app.prove`, which gets the journey files an item changed. When it is set, an item whose diff touches `real_app.paths` owes that proof before its review. `verify-item` runs it and records the result with the item's other proofs, and a red goes back to the warm builder like any failing verification.
- The planner's and the builder's text follow: on a host with `real_app.prove` a tester case runs in the item and is green there. "Proved by hand afterwards, never asked to be green" stays only for a host without the key.
- `run.cjs real-app` keeps what it does. Its header stops saying that no gate runs the journeys.
- Tests: on a fixture host with the key, an item that touches a real-app path cannot complete without the recorded proof. Without the key the flow behaves as today.

### How the host got through

It plans a scoped check in `verification.integrate` that walks only the journey files an item changed (host statement of 2026-11-11, not built yet). Until then its lanes stay the first to run a new case.

## 5. A review file that folds a value with `>-` is refused, and the refusal names the wrong line

Seen 2026-11-11 on the app repo, intent `every-machine-removes-what-finished-work-left-behind`, item `rpr-the-reaper-removes-dead-scratchpads-and-old-tmp-entries`, on 0.1.83.

### What happens

The quality reviewer wrote a finding's text as a folded block scalar with the strip marker, `>-`, which is plain YAML. `run.cjs review --item` refused the file as `BAD_REVIEW` and sent it back to the reviewer. That cost one more round of the quality lens for a file whose content was right.

### Why

- The reader takes three block scalar markers and no other: `if (value === '|' || value === '>' || value === '|-')` (`S/run-yaml.cjs:196`). Measured on this branch with `parseYaml`: `|`, `|-` and `>` are read. `>-`, `>+`, `|+` and a marker with an indentation digit such as `|2` throw.
- The refusal points away from the cause. For `what: >-` over two body lines it prints "cannot parse line 3: one. This YAML subset reads maps, block and inline lists, quoted scalars and block scalars; nothing was read past that line." It names the first body line, not the marker, and it says block scalars are read.
- `>` is read as `|`: the line breaks of the body are kept, where YAML folds them into spaces. No reader of a review depends on that today.
- Neither reviewer text says which markers the reader takes (`src/flows/inferno/agents/reviewer/agent.md`, `src/flows/inferno/agents/reviewer-quality/agent.md`). Both show a template and leave the scalar style to the model.

### What the flow should do

- `parseYaml` reads every block scalar header YAML allows: `|` or `>`, with an optional chomping marker `-` or `+` and an optional indentation digit, in either order. Folding `>` into spaces is the correct reading and may come with it.
- When a marker is still refused, the error names the line of the marker and the marker itself.
- No sentence is added to the reviewer texts: they are near the host's word ceiling, and a reader that takes plain YAML needs none.
- Tests: `>-`, `>+`, `|+`, `|2` and `>2-` each parse to their text in a map value and in a list item. A review file with a `>-` finding is recorded.

### How the host got through

The orchestrator sent the file back and the reviewer rewrote the value with `|`. Until the fix, an orchestrator can add one sentence to each reviewer dispatch: write a multi-line value with `|` or `|-`, never `>-`.

## 6. A reviewer that lists an owned ledger file under `files`, as its text tells it to, is refused

Seen 2026-11-11 on the app repo, intent `a-lane-run-needs-no-hands-and-a-wrong-test-is-fixed-in-one-landing`, item `lnh-every-lane-red-and-refusal-names-its-class`, on 0.1.83. It is what the fix for an item that owns a file under `.specs-inferno/` left open.

### What happens

- The item owns `.specs-inferno/config.yaml` in `ownership.editable` and changed it.
- Both reviewer texts say `files: [<every file the item changed>]` (`src/flows/inferno/agents/reviewer/agent.md:46`, `src/flows/inferno/agents/reviewer-quality/agent.md:62`). The contract reviewer did that and listed the config.
- `run.cjs review --item` refused the file: "files lists .specs-inferno/config.yaml; the ledger is never part of the code a review binds". The file went back to the reviewer for one more round, though its content was right.

### Why

- 0.1.83 decided that an owned file under `.specs-inferno/` stays outside the item's proof and outside what its review binds (`CHANGELOG.md`, "an item may own a file under `.specs-inferno/`"). The proof side follows that: `inLedger` in `S/run-item-proof.cjs:68` leaves those paths out of the proof and out of what changed since.
- The review side still refuses where it should leave out: `boundFiles` throws on any listed path under `.specs-inferno/` (`S/run-review-file.cjs:131-133`).
- The dispatch names the proof's paths, so it does not list the config (`S/run-review.cjs:166`). The reviewer reads the range all the same, sees the change, and its own text tells it to list every changed file.

### What the flow should do

- `boundFiles` leaves a listed path under `.specs-inferno/` out of the bound files and does not throw. The review is recorded, and what it binds is the same set the proof holds.
- Or the two reviewer texts say it in their template: every file the item changed, except a path under `.specs-inferno/`. That costs words in two texts that are near a host's ceiling, so the first is the better one.
- Not the way: counting only `state.yaml` and the intent folders as ledger. A host config would then be bound by the review and left out of the proof, and the two would disagree again.
- Tests: an item review that lists an owned `.specs-inferno/config.yaml` beside its code files is recorded, and its bound files are the code files. A review that lists only ledger paths is still refused, with "files must list every file the review read for this item".

### How the host got through

The reviewer rewrote the file without the config. Until the fix, an orchestrator adds one sentence to the reviewer dispatch of an item that owns a file under `.specs-inferno/`: leave paths under `.specs-inferno/` out of `files`.

## 7. A file granted to a correction is left out of the review dispatch, so new code can pass unread

Seen 2026-11-11 on the app repo, intent `every-machine-removes-what-finished-work-left-behind`, item `rpr-the-reaper-removes-dead-scratchpads-and-old-tmp-entries`, on 0.1.83. This one is not a lost round. It is a hole in what a review covers.

### What happens

- Round 1 of the item was recorded with findings. The correction needed three new files outside the item's `ownership.editable`: `scripts/machines/reaper-guard.mjs`, `scripts/machines/reaper-lock.mjs` and `scripts/machines/reaper-guard.test.mjs`. The orchestrator added them to the correction's dispatch with `run.cjs grant` (dispatch `263b3707`), as the flow asks.
- `run.cjs review --item` then printed both reviewer dispatches for range `23ebd3dbd..6b8be0350` with a `paths` list that holds none of the three files.
- A reviewer that follows its dispatch reads the fix without the code the fix moved into the new files.
- Two more hits the same day, on two other intents of the app repo. In each, a fix for a red integrate landed on granted files after the item's review was recorded, and nothing asked for a new review: item `td-item-2a-asks-the-system-architecture`, commit `c72816ef6` (three Rust files), and item `sf-a-manifest-saved-with-a-byte-order-mark-or-as-utf-16-is-read`, commit `a902a96f5` (a lint script and its test). Both were re-reviewed by hand once the hole was known.

### Why

- In a correction round a lens reads `span.paths`, not the proof's paths: `const read = own ? proof.paths : whole ? context.editable : span.paths`, and `own` is false once a review is on record (`S/run-review.cjs:162-166`).
- The span keeps a changed file only when the item spec owns it or the last review listed it: `.filter((file) => lib.ownedBy(file, editable) || current.files.includes(file))` (`S/run-review.cjs:337-338`), and the same filter in `lensesWaiting` (`S/run-review-quality.cjs:177-180`). `editable` is the spec's list (`S/run-review.cjs:294`).
- A grant is not in the spec. It is on the dispatch record, under `assignment.ownership.granted` (`S/run-grant.cjs:28-34`). So a file that is new in the correction and came by grant passes neither test.
- The first round does not have the hole: it reads the proof's paths, and the proof takes every file a dispatch claimed (`itemFiles`, `S/run-item-proof.cjs:279-284`).
- The same filter decides whether a fix review is owed again (`since`, `S/run-review.cjs:337`). A later commit that touches only granted files therefore does not make the review owed again either.

### What the flow should do

- The paths of a correction round are the files changed since the review on record that the item spec owns, the last review listed, or any dispatch of the item claimed, grants included. The proof already holds that set when it is current, so the span can take the proof's paths that changed since the recorded commit.
- The same set decides whether a fix review is owed again.
- Tests: a correction that adds a granted file prints it under `paths` for both lenses, in `step` and in `lensesWaiting`. A commit on a granted file after a fix review makes the review owed again. A granted file that did not change since the recorded commit is not listed.

### How the host got through

The orchestrator named the three granted files in the brief of both reviewers. Until the fix, an orchestrator does that for every correction round whose dispatch carries a grant.

## 8. A late correction of a completed item cannot be verified once a later item changed a file both own

Seen 2026-11-11 on the app repo, intent `the-declaration-of-conformity-is-complete-for-every-stated-law`, items `doc-each-stated-law-prints-its-notified-body-in-point-7` and `doc-a-toy-declaration-carries-its-image`, on 0.1.83. Both were `completed`. Both got a correction after the re-reviews that section 7 made necessary.

### What happens

`run.cjs verify-item` refuses the correction's dispatch:

```text
ERROR [DISPATCH_PROOF] dispatch ownership overlaps at definitions/intake/product-facts.json with dispatch 6f987e43-d7af-4a26-b192-55b6dce66603: a serial chain one builder builds takes one dispatch-log for all its items, with --items a,b
ERROR [DISPATCH_PROOF] dispatch ownership overlaps at definitions/notes/single-declaration.md with dispatch 603f8a98-84f5-47fa-9423-68efd080a948: a serial chain one builder builds takes one dispatch-log for all its items, with --items a,b
```

The named dispatch is that of a later item of the same intent, which owns the same file and was built, accepted and integrated after the first item. The advice cannot be followed: one `dispatch-log` for both items is a choice made before the first of them is built.

### Why

- `unexplainedChanges` reads the tree's timeline from the item's first baseline, `const root = seqOf(dispatch.checkSnapshot(own.before))`, and takes every other dispatch that ended after it: `.filter((run) => run.end > root)` (`S/run-peers.cjs:100`, `:105`).
- A change of such a dispatch to a file this item owns or claimed is refused as an overlap (`checkPeerChange`, `S/run-peers.cjs:82-92`, called at `:129`).
- In the planned order that never fires. The earlier item is verified and integrated before the later item is dispatched, so the later dispatch is not on the timeline yet.
- A correction of the earlier item after the later one ran puts the later dispatch between the item's first baseline and now. Its change to the shared file is then read as two dispatches racing on one file, though they ran one after the other.
- So an intent whose items share a file in sequence, which the plan lint allows along a dependency path, cannot verify a late correction of any item but the last that touched the file.

### What the flow should do

- The overlap refusal is for dispatches that ran beside each other. A dispatch whose whole window lies between two of the item's own dispatches, after one was accepted and before the next began, ran after the item and not beside it. Its change to a shared file is that dispatch's own, with no refusal.
- The refusal keeps its present text for a real overlap, and for the late correction case it has nothing to say.
- Tests: item A accepted, item B (same file, depends on A) accepted, then a correction dispatch of A that changes the shared file: `verify-item` passes and attributes B's change to B. The same with B still open is refused as today.

### How the host got through

No way through inside the flow was found. Each correction's builder ran the item's own narrow check and reported it in its result (commits `ead393607` and `3a4519a86`). The corrections were committed without a `verify-item` proof, and both lenses read each one with every changed file named in their brief.

## 9. A sibling item that writes in the tree during a mutant batch throws the whole batch away

Seen 2026-11-12 on the app repo, intent `a-lane-run-needs-no-hands-and-a-wrong-test-is-fixed-in-one-landing`, on 0.1.83. It comes from the 0.1.83 check that names a test command which leaves the tree changed.

### What happens

- `run.cjs review --item` ran the item's ten mutants in one batch. All ten were caught. The batch took eleven minutes.
- While it ran, the two reviewers of a sibling item wrote their review files into the same intent worktree.
- The record was refused with `MUTATE_RESTORE`: "the runner's mutants could not put every file back: ... Nothing is recorded". Every file the batch broke was back. The ten verdicts were lost to the record.

### Why

- `snapshot` reads every path git calls changed or new in the whole tree before the first write, and `leftBehind` names every path whose bytes differ after the last restore (`S/run-mutate-left.cjs:31-40`). It cannot tell who wrote a path. A write by anyone during the batch reads as "the test command left it changed".
- A batch with one such path records nothing: `if (payload.restored === false) throw ... 'MUTATE_RESTORE'` (`S/run-mutant-runs.cjs:172-174`).
- One intent worktree holds several items at once by design. The review step says so itself: "another builder may be editing beside it, and another item's reviewer may be running a mutant beside it" (`S/run-review.cjs:309`).
- The check before the batch has the same reach. `busy` ends the run when the tree holds any uncommitted work but the review files being signed (`S/run-mutant-runs.cjs:51-53`), and the proposals then wait for the intent review. So with two items in flight, an item's mutants run only when no sibling has uncommitted work at the start, and are recorded only when none writes for the whole batch.

### What the flow should do

- A verdict stands when the file the mutant broke and the paths the host's reseal changed are back. That is what the record should require.
- Any other path that moved during the batch is printed as a warning, with the line that it may be another dispatch's work, and the verdicts are recorded.
- The lines that tell a host to set `mutate.sealed` stay for the case they were written for: a path the batch's own reseal or test command is known to write. A path that an open dispatch of another item owns or claims, or a review file of another item, is never named as left behind.
- Tests: a batch during which another path of the tree changes records its verdicts and prints the path as a warning. A batch whose own mutated file is not back still records nothing.

### How the host got through

The batch writes its verdicts to a file beside its logs (`mutate-batch-<stamp>-mutants.yaml` in the tree's cache folder). The host put those ten verdicts into the review file and recorded again.

## 10. A Rust build that the machine killed reads as a mutant that does not build, and a host cannot say where mutant tests run

Seen 2026-11-11 on the app repo, intent `the-support-period-the-user-information-and-the-printed-dossier-are-right`, item `sup-the-end-date-counts-from-the-first-covered-unit`, on 0.1.83. Two gaps met in one record.

### What happens

- The contract reviewer proposed nine mutants. Six carry a bare `cargo test --manifest-path src-tauri/Cargo.toml <name>` as their test.
- `run.cjs review --item` ran the batch on the machine the orchestrator runs on. On this host that machine is short of memory and its tests are sent to other machines through a wrapper. The out-of-memory guard killed the compilers.
- The record printed "mutants: 9 ran, 2 caught, 0 survived, 7 without a verdict", with "no verdict: did not build" for all six Rust mutants, and recorded the review clean. Six criteria now wait for the intent review.
- The logs show what broke. The control run, with every switch off, ends on `sccache: Compiler killed by signal 15` and `error: could not compile` for a dependency crate (`tauri-utils`). Each of the six runs that followed ends the same way on `gtk` or `gio`. No mutant touched those crates.

### Why, the kill

- `verdictOf` reads a kill from the exit codes 130, 137 and 143 and from cargo's `(signal: N, SIG...` line of a killed test binary (`S/run-mutate-verdict.cjs:28`, `:78-84`). A compiler that a signal ended makes cargo exit 101 with `error: could not compile`, which `rustBuildFailed` reads as a failed build (`:43-45`, `:85`).
- A control run that "did not build" is taken as proof that one of the switched mutants breaks the build: `if (verdict.why === 'did not build') return { text }` (`S/run-mutate-batch.cjs:88`). The batch then builds each mutant alone. On a machine that just killed a build for memory, that is six more full builds.

### Why, the place

- The test of a mutant is the command the reviewer wrote, run in place. `mutate.session` only groups commands that already start with the host's wrapper (`S/run-mutate-session.cjs`, `match`). A command that does not match "runs in place as before".
- A host has no key that says where a mutant's test runs, and no text that reaches every reviewer: `dispatch.constraints` goes to builders only. So the rule lives in each orchestrator's brief, and a reviewer that leaves the wrapper out runs a full Rust build beside the orchestrator.
- Until 0.1.83 an item with two lenses ran no mutant at the item, so this stayed out of sight. It now runs on every item review.

### What the flow should do

- A build that a signal ended is a kill, not a failed build. `verdictOf` reads `killed by signal` in a compiler line the way it reads a killed test binary, and a `could not compile` of a crate other than the one a mutated file belongs to is never the mutant's doing.
- A control run that was killed stops the batch with `MUTATE_STOPPED` and "run the same command again". It does not start the one build per mutant.
- A host key under `mutate` holds the wrapper every mutant test runs through, with the tree and the test as its two parts, for example `mutate.run: "bash <wrapper> auto {tree} {test}"`. A reviewer then writes the bare test, the host decides the machine, and `mutate.session` can match on the same key. A host text for reviewer dispatches (`review.constraints`) would cover it by recall only, so the key is the better of the two.
- Tests: a control log that holds `Compiler killed by signal 15` above `error: could not compile` stops the batch and builds nothing more. With `mutate.run` set, a bare `cargo test x` runs through the wrapper, and a test that already starts with the wrapper is not wrapped twice.

### How the host got through

The record stands with seven criteria owed to the intent review. The orchestrators now tell every reviewer to start each mutant's test with the wrapper.

## 11. A mutant whose test is a check, not a test runner, can never read caught, and nothing tells the reviewer

Seen twice on 2026-11-11 on the app repo, on 0.1.83: item `doc-a-typed-law-carries-its-publication-reference` (criterion 6, test `npm run check:wire`) and item `sup-the-end-date-counts-from-the-first-covered-unit` (criterion 10, test `node scripts/clause-article-map.mjs`).

### What happens

The reviewer names a check script as the mutant's test. The check goes red on the mutant, exit 1, with its own line that names the fault. The runner records `caught: none`, why "no test summary reports a failure (exit 1)", and the criterion waits for the intent review, where the same test gives the same answer.

### Why

- This is the verdict rule working as written: a red run is caught only when it printed a test runner's summary with a failure count, so that a wrapper that refused or a missing binary never reads as caught (`S/run-mutate-verdict.cjs:5-15`, `:86-89`). A contract check or a lint prints no such summary.
- The reviewer is not told. Its text says "`test` runs only the tests that should notice" (`src/flows/inferno/agents/reviewer/agent.md:20`) and nothing about what the runner can read. The answer the flow does have for such a criterion, the gate mark, is in the orchestrator's text only.
- So each such proposal costs one mutant run for no verdict and one criterion pushed to the intent review, and it repeats there.

### What the flow should do

- The reviewer's rule says in one clause what a mutant's test must be: a test runner's command, whose summary counts a failure. A criterion that only a check proves is named to the orchestrator for a gate mark, with no mutant proposed.
- Or a host names its checks: a key under `mutate` that lists command patterns with the line each prints on a finding, and a red run of such a command that prints that line reads caught. A wrapper error prints no such line, so the rule that guards against it holds.
- The refusal line names the way out: for "no test summary reports a failure" on a command that is no known runner, it says that a check cannot prove a mutant and names the gate mark.
- Tests: a mutant whose test is a listed check that prints its finding line reads caught. The same command ended by a wrapper error reads no verdict.

### How the host got through

For a check that a gate command runs, the orchestrator ends the criterion's line with `(gate: <that finalize command>)` in a commit that changes the spec alone, and the criterion owes no mutant. For any other check the reviewer names a runner test that covers the same line.

## 12. After a fold, a line the base added to a file the item owns reads as the item's own

Seen 2026-11-12 on the app repo, intent `the-declaration-of-conformity-is-complete-for-every-stated-law`, item `doc-a-typed-law-carries-its-publication-reference`, on 0.1.83.

### What happens

- The base branch gained a commit that puts `#[ignore = "regenerates only the policy export goldens; review the diff"]` on one test of `src-tauri/src/dossier/render/tests/changed_document_goldens.rs`. The item also changes that file. The intent folded the base in while the item was open.
- `run.cjs verify-item` then failed the item on a line it never wrote:

  ```text
  switched off: src-tauri/src/dossier/render/tests/changed_document_goldens.rs:144: #[ignore = "regenerates only the policy export goldens; review the diff"]
  ```

- The fold also changed bytes the item's accepted dispatch had recorded, and `verify-item` asked for the dispatch again. The host answered with an empty `dispatch-log` and its accept.

### Why

- `readDiff` reads the lines an item added to a test file from one diff, the baseline `from` to the tree: `parseAddedLines(git([...DIFF, '-U0', from, '--', literal(file)]))` (`S/run-item-proof.cjs:253-270`). A fold between `from` and now is inside that diff, so the base's lines in that file are in it.
- The flow knows a fold, at the level of whole paths: `foldedSince` lists the paths the base brought in "and nothing changed since" (`S/run-attribute.cjs:43-59`), and the ownership check skips such a path when the item does not claim it. A file that both the base and the item changed is not such a path, and nothing reads it line by line.
- The same diff is the item's proof and the range a first review reads, so a reviewer of that item is shown the base's lines as the item's too.

### What the flow should do

- For a file the item owns that the fold also changed, the lines the base added are the base's. `foldedSince` already finds the two commits that bound them: the last base commit the baseline held, and the base tip that was folded. A line added between those two is left out of `tests_changed.switched_off`.
- A fold that changes bytes of a path an accepted dispatch recorded is attributed to the fold, with no new dispatch asked for, when the path's change is the base's alone.
- Tests: the base adds `#[ignore]` to a test in a file the item also edits, the intent folds, and `verify-item` passes. The item adding its own `#[ignore]` to the same file after the fold is still refused.

### How the host got through

It ran `verify-item --since <the fold's merge commit>`, so the baseline starts after the fold, behind an empty `dispatch-log` and its accept. That is safe only for an item whose review on record already read its work from before the fold: check that the review range the runner prints still starts at or before the item's first commit, and name the item's earlier files in the brief when it does not.
