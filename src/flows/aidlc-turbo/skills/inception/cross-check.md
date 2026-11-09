# Skill: Cross-Check

---

## Role

The lint checks the form; this step checks the meaning, with fresh eyes. You wrote the record, so you
are the worst reader to spot its contradictions. Two agents read it instead, side by side: the
cross-checker (stories against each other and the code) and the docs-verifier (register statements
against the text that cites them).

---

## Goal

Every finding of both agents fixed in the record, the specs rendered and linted again, and no finding
open when the user sees the specs.

---

## Input

- The rendered brief and stories, `spec-lint.cjs` clean
- `record.yaml`, `register.yaml` and the pages of the inception

---

## Process

### 1. Dispatch both, in the same turn

- **Cross-checker** (`specsmd-aidlc-turbo-cross-checker`): the brief path, every story path, and the standards paths the stories refer to.
  It also checks, per criterion, where the tester checks it (`observed_via`) against the screen code,
  and returns a mismatch as a `channel` finding. And it checks every decision on an assumption, and
  every right, menu entry, table or service a story creates, for an existing one that fits. And it
  checks the Code Scaffold against the code and the stories: a part drawn new that already
  exists, a part a story builds whose path is outside that story's `touches`, two parts that call
  each other without a link, and an arrow whose proof does not show what is called. Without a Code
  Scaffold (a sandbox that switched it off) it skips that check, and reports nothing missing.
- **Docs-verifier** (`specsmd-aidlc-turbo-docs-verifier`), only when the register has current items: the inception and intent slugs, the
  paths of `register.yaml`, the pages folder and the brief, the id-to-story map, and the record's
  `deliberately_not` list. Build the map from the record: per register id, the requirement ids and
  the story files whose `sources` cite it. Never pass the story bodies: the verifier opens the ones
  it needs.

Both return compact YAML; the contracts are in their agent files.

### 1b. The C4 model against the drawing

The cross-checker reads only the specs, and the C4 model is not in them. So while the two agents
read, check the record's `technical_design.c4` against its drawing yourself, when the record has
both, the way the cross-checker checks the drawing against the code. It costs no code reading:
`spec-lint.cjs` has checked the references already, so look only at what they mean:

- a component that holds parts of another container: a table in a component of the web
  application, a screen in one of the database;
- a container whose `tech` the paths of its parts contradict;
- a system in `outside` that is not the one its external part calls, or a system with `ext: true`
  that no external part and no decision names;
- an edge with `intent: true` that no link of the drawing and no story's `builds` carries.

### 2. Fix every finding

`verdict: clean` from both and nothing from step 1b: done. Otherwise every finding is fixed, small
ones included. A story is never shown to the user with a known conflict in it. Your own findings of
step 1b are fixed in the record, or go back to `intake.md` for a fact the record lacks.

**Where asking starts.** A finding is fixed from the record without a question only when it is a
slip of your own draft: the brief or a story says something other than the record holds, while that
record entry is the user's own answer, or a page statement that no answer, no other page and no code
contradicts; or a gap the record or the code fills without changing what anyone reads in a story's
product-team half or on a page (a file missing from `touches`, a link of the Code Scaffold with its
proof, a reading-list row). Everything else is asked: a mismatch (a page, the code and the user's
answers do not agree, or a page or an answer turns out not to be true of the code) and every
finding that needs a choice.

- `fix_from_record: true` and no `mismatch`: apply the `fix` to the record. A `fix` that would
  change what a page, a decision with source `user` or the code says is a mismatch after all: ask it.
- `mismatch: true`, or `fix_from_record: false`: ask the user the finding's closed question as
  `intake.md` step 5 asks a mismatch: in plain words in the record's language, an id in it rewritten into what it names, both
  sides quoted and named (a requirement that rests on a register id quotes that statement and names
  its page), the proposed option first, with the host's multiple-choice prompt where one exists, at
  most four questions in one prompt. Write the answer into the record as a decision, with its
  `mismatch` (and `page_fixes`, as there) when the finding was one, and the requirement or story
  change it brings. An answer on a mismatch with a pulled page: run the resolve of `intake.md` step 7
  again before the review, so the push carries the corrected page.

Then render and lint as in `render.md`, until the lint is clean.

### 3. Second round

Dispatch again only the agents that had findings, each with its round-1 findings and the files that
changed. At most two rounds. A finding still there after the second round goes to the user as one
closed question, and the answer goes into the record, then render and lint once more. Never hand the
specs to `review.md` with a finding open.

Neither agent writes a file, and neither do you: the findings live only in this turn and end as fixes
in the record.

---

## Output

```text
Cross-check user-auth: 2 slips fixed from the record, 1 mismatch answered by you; docs-verifier 41
statements checked, 1 partial fixed; second round clean.
```

---

## Transitions

- Both clean -> `review.md`, automatically
