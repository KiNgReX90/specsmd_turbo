# Skill: Render

---

## Role

Turns the record into the spec files by script. All the thinking is done: no model writes a spec
file, so rendering costs no tokens and the brief and the stories always say what the record says.

---

## Goal

The brief and every story on disk, rendered from the record, with `spec-lint.cjs` clean.

---

## Input

- `.specs-aidlc-turbo/docs/{inception}/{intent-slug}/record.yaml`, with the `stories` list from
  `plan.md`

---

## Process

### 1. Render

```bash
node .specsmd/aidlc-turbo/scripts/render-specs.cjs {intent-slug}
```

It writes `brief.md` and `stories/{SSS}-{story-slug}.md` next to the record: the product-team half in
the record's language (`intent.language`), its headings from that language's string table, the agent
half in English, with each integration test as a line
of the story's test plan. The rest of the overview data stays in the record, for the overview page.
It exits non-zero on a record it cannot render and names the key: fix that key in the record and run
it again.

Render only while the brief is `draft`. Once it is approved, construction owns the files (statuses,
`## Lessons`, `### Build notes`, a `D-n` a human decided later), and a change of scope is a new
intent.

### 2. Lint

```bash
node .specsmd/aidlc-turbo/scripts/spec-lint.cjs {intent-slug} --json
```

Form and coverage, the hard gate before the approval: frontmatter, ids and file names, `depends_on`
acyclic, the story map against the files, requirements and stories covering each other, no empty
heading, no `TBD` or `TODO`, `touches` present and never shared by two stories that build at the same
time, every current register id cited or in `deliberately_not`, every cited id existing. On the
record's criteria: every criterion with `observed_via` and, for `none`, exactly one of `why_none` or
`covered_by` (`criteria-via`), a `tester_verifiable` the record still gives equal to the derived one
(`tester-verifiable`), `break_test` only with a criterion observed via `ui` or `api` (`break-test`),
and no story path under `aidlc-twins/` (`twin-dir`). On the overview data: layer ids unique
(`layers`), every slice on a layer with `new` or `used` (`slice`), every integration test with
an earlier story the story reaches through `depends_on`, one per story, with `test`
(`integration`), the lifecycle's steps, lanes, arrows and stories existing (`lifecycle`), and
`short` at most 24 characters (`short`).

### 3. Fix the record, render again

Every finding is fixed in the record, never in a rendered file: the record and the files stay the
same thing. Then render and lint again, until the lint is clean.

- A finding the record already answers (a wrong id, a missing `touches` entry, a shared file between
  parallel stories): fix it yourself. Two stories that share a file get a `depends_on`, or the shared
  change moves into one of them. A criterion without `observed_via`, or with a wrong one, gets it as
  `plan.md` step 3b decides it. An integration test with a story the story does not reach gets the
  `depends_on` (that story lands first), or the test goes.
- An uncovered requirement, or a story that delivers none: fix the split yourself, as `plan.md` does.
- A finding that needs a fact the record does not have (a statement from the documentation that no
  requirement and no story delivers, with no obvious story): ask the user one closed question, with
  the host's multiple-choice prompt where one exists, quoting the statement and naming its page, and
  write the answer into the record.

---

## Output

```text
Rendered user-auth: brief.md and 3 stories. Lint clean after 2 renders (1 shared file fixed with a
dependency).
```

---

## Transitions

- Lint clean -> `cross-check.md`, automatically
- A missing fact turns up -> back to `intake.md` for that one fact, then here again
