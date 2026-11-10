# Skill: Every intent its own page

---

## Role

Keeps every intent of an inception on its own Confluence page, so the story pages of two intents
never hang under one page and every overview lands on the page of its own intent. Followed by the
inception agent wherever the pages are about to matter: in `intake.md` right after the pull, in
`review.md` before the approval question and again before the push and the upload, and in the sync
rerun (`rerun.md`). An inception that was cut into intents before this step existed is put right by
the same step: it is the migration too.

The rule is in the Confluence sync skill (`skills/sync/confluence.md`), under **Every intent has
its own page**. In short: an inception of one intent keeps its documentation page as the intent's
page. One that holds more than one intent folder gives each intent a documentation page of its own
under the inception's page, with its own stories page, where its story pages hang. Their titles
follow `sync.page_names` of the config (defaults `{intent-slug} - Documentation` and
`{intent-slug} - Stories`); the check prints them.

Runs only when `sync.docs` in `.specs-aidlc-turbo/repo/config.yaml` is `confluence`. `none`, the
default when the key is missing, means it never runs.

---

## Process

### 1. The check

```bash
node .specsmd/aidlc-turbo/scripts/intent-pages.cjs check --inception {inception}
```

It prints one JSON object. `ok: true` (exit 0): nothing to do, say nothing. Exit 2 is a usage
error: name its `detail` and treat the check as failed (step 5).

### 2. Pull first

`ok: false`, and this session did not pull the inception yet (intake step 3 did; a review or a rerun
in a new session did not): a page may have been removed or moved on Confluence since the last pull.
Pull first: dispatch the sync agent (`specsmd-aidlc-turbo-sync`) with
`.specsmd/aidlc-turbo/skills/sync/confluence.md`, the intent slug, the inception slug, mode `pull`
and the link `confluence.documentation.url` of `sync.yaml`, and delete every file in `stale`. Then
run the check again. `ok: true` now: done.

### 3. One question

Still `ok: false`: ask one question with the host's multiple-choice prompt (on Claude Code:
AskUserQuestion), in the user's language. Say first, in one line, why: the intents of this
inception share one page on Confluence, and every intent gets its own. Then name, from `plan`,
grouped per intent:

- every page it will create: each `create` with its `title` and its `stories_title` under the
  inception's page (`parent.title`), or only a `stories_title` under an intent page that exists;
- every story page it will move, and where: each `move` with its `title` and the stories page it
  goes under, matched by the record (`by: match`, with its story number) or by the user;
- every story page it could not place: each `unmatched` with its `title` and what was found (its
  `hints`: the same title under another number, a story that cites its statements), never as a
  guess. It stays where it is, and the check keeps failing on it until the user names its intent or
  removes the page on Confluence, which the next pull then drops.

`lines` says each of them in one line. Name pages by their titles, never by a page id. The options,
in this order:

- **Yes, do it** (recommended): step 4.
- **Change the mapping**: the user says which page belongs to which intent. Run the check again with
  `--map {page_id}={intent-slug}` for every page the user named, and ask again with the new plan.
- **Not now**: nothing is created or moved: step 5.

### 4. The sync agent

Dispatch the sync agent with `.specsmd/aidlc-turbo/skills/sync/confluence.md`, the intent slug, the
inception slug, mode `intent-pages` and `plan`, the `plan` block of the last check exactly as it was
printed (with the user's `--map` in it). Handle its result as the agent file says, delete every file
in `stale`, and name what `not_synced` says. Then run the check of step 1 again.

The overview of an intent that was approved before it had a page of its own goes to its page, as
`review.md` step 5 sends it: for every intent that got its page in this run (a `create` with
`page: true`) whose brief is `approved`, `building` or `done` and whose `overview.html` is on disk:

```bash
node .specsmd/aidlc-turbo/scripts/confluence-attach.cjs upload --intent {intent-slug} --file .specs-aidlc-turbo/docs/{inception}/{intent-slug}/overview.html
```

The script names the attachment by `sync.page_names.overview_file` (default
`overview-{intent-slug}.html`). Done: take the slug off `pending_upload` under `confluence:` in
`sync.yaml`. A failed upload (exit 1) is not a stop: add the slug to `pending_upload` and name its
`detail`; the rerun sends it later. An older file on the inception's page stays where it is: the
flow removes nothing.

### 5. Still failing

The check still fails after step 4, or the user picked **Not now**: name each problem in one line,
from `lines`. Then:

- In intake: go on with the next step. Review runs this step again, and the approval waits for it.
- In review: never ask the approval question, and push or upload nothing. Say that every intent
  needs its own page first, and that `/specsmd-aidlc-turbo-inception --skill sync {intent-slug}`
  puts it right.
- In the rerun: push and upload nothing, and say so.

---

## Never

- Never create or move a page without the user's yes to the plan that names it.
- Never delete a page or an attachment on Confluence.
- Never put the story pages of two intents under one page, and never put the overview of an
  intent on another intent's page, or on the shared page of an inception with several intents.
