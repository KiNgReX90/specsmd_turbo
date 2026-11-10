# Skill: Sync again

---

## Role

Finishes a sync or an upload of the overview that could not run, or runs it again after a failure.
First it gives every intent of the inception its own Confluence page when one is missing.
Started with `/specsmd-aidlc-turbo-inception --skill sync {intent-slug}` and run by the inception
agent, which dispatches the sync agent (`specsmd-aidlc-turbo-sync`) for each step. Safe to run any
number of times: both sync skills update what `sync.yaml` already names and never create anything
twice.

---

## Process

1. Find the intent: `docs/{inception}/{intent-slug}/` under `.specs-aidlc-turbo/`. Read its
   `brief.md` and `docs/{inception}/sync.yaml`.
2. **Every intent its own page**: when `sync.docs` is `confluence`, first follow
   `.specsmd/aidlc-turbo/skills/sync/intent-pages.md`, whatever the status of the brief. It is also
   how an inception that was cut into intents before each had its own page is put right: its story
   pages move under their own intents, and the overviews of its approved intents go to their own
   pages. While its check fails, steps 4 and 5 push and upload nothing.
3. A brief that is still `draft`: nothing else may be synced before the approval. Say so and stop.
4. **Confluence**: when `sync.docs` is `confluence` and a page row has `changed: true`, dispatch the
   sync agent with `.specsmd/aidlc-turbo/skills/sync/confluence.md`, the intent slug, the inception
   slug and mode `push`. When it returns `documentation_pushed: true` or `intent_pages_pushed`, run
   the `confluence-attach.cjs links` of `review.md` step 4.
5. **The overview on Confluence**: when `pending_upload` under `confluence:` names the intent, run the
   `confluence-attach.cjs upload` of `review.md` step 5 again: it goes to the intent's own page.
   Done: take the slug off the list, and drop the key when the list is empty. Failed again: keep it
   and name its `detail`.
6. **Jira**: when `sync.issues` is `jira`, dispatch it with `.specsmd/aidlc-turbo/skills/sync/jira.md`,
   the intent slug and the inception slug:
   - no epic for the intent yet, or `pending: after-inception`: mode `after-inception`.
   - brief `done`, and the story issues are not closed yet or `pending: after-build`: mode
     `after-build` as well, with `tests_only: true` when the block has it.
7. **The overview on Jira**: when `pending_jira` under `overview.{intent-slug}` is set and the
   intent has its epic, run the `jira-attach.cjs upload` of `review.md` step 5 again, with the
   artifact link when there is one. Done: drop the key. Failed again: keep it and name its `detail`.
8. A result with `status: needs_input` or `no_tools`: ask the user its question, then dispatch the
   same step again with the answer. Delete the files a result names in `stale`.
9. In both modes, commit the updated `sync.yaml` on the intent branch, with the inception's
   `pages/` when step 2 moved pages: `docs({intent-slug}): sync with Confluence and Jira`. Push with
   `node .specsmd/aidlc-turbo/scripts/push-branch.cjs {intent-slug}` only when the brief has a
   `merge_request` or `pushed_to_base`: the intent went out before. In sandbox mode with `push` that
   puts the commit on the base branch too.
10. Say in one line per tool what was done, the intent pages and the overview uploads
    included.
