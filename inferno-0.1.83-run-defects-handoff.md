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
