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
