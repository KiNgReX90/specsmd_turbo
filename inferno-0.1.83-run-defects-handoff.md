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

It dispatched both lenses by hand, with the brief the dispatch would have printed. A fresh review file lists only files that exist, and with a pending file in the tree `review --item` reads the pending files (`pendingFiles`, `S/run-review.cjs:270-273`) and not the recorded one (`:307`), so the record is expected to go through. The host's own line on that record is added here when it has run.
