# Skill: Plan

---

## Role

Splits the record into stories. This is the only place where the shape of the build is decided: what
a builder gets in one session, which stories build side by side, and in which order. You decide it:
the user is not asked about the split, the order or the lane.

---

## Goal

The record's `stories` list: vertical slices that together cover every requirement, each sized for
one builder session, with an acyclic dependency graph and no file shared by two stories that can build
at the same time. Then the record's overview data: what the pictures on the overview page draw. Then
the Code Scaffold: the code the stories build, drawn before anything is built. Then the C4 model
around it and the plain texts the page opens with.

---

## Input

- `.specs-aidlc-turbo/docs/{inception}/{intent-slug}/record.yaml`, complete after `intake.md`. Its
  `reading_list` and its `decisions` hold the `seen_at` answers of intake's locating pass and of the
  explorers, where a user sees or starts what the intent changes: each `reading_list` row's `why`
  names the change, where a user sees or starts it and its via. The `hangs_on` rows name the
  existing structure a need reuses: a story uses that one and creates only what a decision says.
  The `lands_in` rows name the module a part goes in, where it is registered and the example a new
  part copies
- `.specs-aidlc-turbo/repo/repo.yaml` for `codebase.has_ui`, `codebase.playwright` and the stacks
- `.specs-aidlc-turbo/repo/config.yaml` for `tester.enabled`, and in sandbox mode the `sandbox` block:
  `code_scaffold: false` means no Code Scaffold (step 4c is skipped, and step 4d writes no C4
  model). A missing key is `true`, and production always makes it

---

## Process

### 1. Draft the slices

Group the requirements into behaviours a user or a caller can observe, end to end. One behaviour is
one story.

A story is a vertical slice. The repository, the endpoint and the screen that serve one behaviour
belong to the same story. Splitting by layer produces stories nobody can verify and builders that
block on each other, so never do it.

### 2. Apply the sizing rule

A story is one builder session: roughly 8 files at most, and verifiable on its own.

- Too big (more than about 8 files, or more than two distinct concerns): split it, and record the
  order with `depends_on`.
- Too small: every story costs one cold builder start. A chain of tiny stories in the same code path
  buys no parallelism and wastes a full context each time. Merge them until each story carries
  enough work to earn its dispatch.
- Split for real size, never for tidiness.

### 2b. Put every breaking test in the story that breaks it

A story that changes a value or a behaviour breaks the existing tests that assert the old one, and it breaks them **at that story**, not later. When the brief asks for a green build after every story, those tests have to be fixed in the same story as the change. Tell the two kinds of breakage apart, because they land at different moments:

- **A test asserts the old value or behaviour**: it fails the moment the value changes. It belongs to the story that makes the change.
- **A test's fixture is rejected by a later guard or validation**: it fails only when that guard lands. It can be swept in the stories before the guard, or in the guard's own story.

Go through the tests in the reading list for every story and ask which of them assert what this story changes. Name them in that story's `touches` and test plan. On a real run the planner put the fix for two tests that asserted an old key value in a later cleanup story, although the reading list already said they keyed off that value. The first builder broke them, could not fix them outside its scope, and the run stopped for the human.

### 3. Fill every story in the record

Write each story into the record's `stories` list with the keys of the record template.

| Key | How it is decided |
| --- | ----------------- |
| `id` | 3-digit, sequential within the intent, in dependency order |
| `slug`, `title` | The behaviour, in the product team's words; the `title` in the record's language (`intent.language`), the `slug` in English |
| `complexity` | `low`, `medium` or `hard`: how much reasoning the build takes, not how many files. `low` is a known pattern with little logic, `medium` carries real business rules, `hard` is novel or intricate logic. It picks the builder in construction. Split every `hard`; keep one only when it cannot be cut into slices that each verify on their own. |
| `depends_on` | Only real ordering constraints. Acyclic. |
| `touches` | Every repo-relative file the story will change or create, tests included. Two stories with no `depends_on` path between them build at the same time, so they never share a file: make one depend on the other, or move the shared change into one story. |
| `sources` | The register ids this story delivers |
| `requirements` | The requirement ids this story delivers, at least one |
| `tester_verifiable` | Not decided: leave the key out. `render-specs.cjs` derives it from the criteria, `true` when at least one has `observed_via` other than `none` (step 3b) |
| `break_test` | `true` when a user puts something in or changes something through the story: forms and input fields, amounts and calculations, saving or deleting data, roles and rights, a flow of several steps or a status change, an import. `false` for a screen that only shows data, a text or layout change, a setting, a refactor without new behaviour. Only when at least one criterion is observed via `ui` or `api`: it follows the criteria, never the surface. Finish lets the breaker attack the stories marked `true`, in both modes, never in the quick lane |
| `surface` | Where the change lives in the code, nothing more: `ui` screen code, `api` an endpoint or a message handler, `job` a scheduled or background job, `data` a migration, a query, a stored procedure or a data change, `none` a library change or a refactor. It never decides what a tester checks |
| `db_tables` | The tables the behaviour writes. Empty when none. |
| `test_data` | The records the story's tests create or change, each with a key unique to the story, so stories built side by side never touch each other's rows. Two stories that truly share records: make one depend on the other and say why in the story. |
| `short`, `slice`, `integration` | Not yet: step 4b writes them once every story is final |
| `product` | The product-team half, in the record's language: `as_a`, `i_want`, `so_that`, `why` (optional: one or two sentences on why the story exists, for a reader who missed the conversation; it renders as Why this story), the criteria as `given`, `when`, `then` with `observed_via` (step 3b), and `out_of_scope`. A label on screen stays exactly as the application shows it; ids and code spans stay as they are. |
| `agent` | The agent half, in English: its own reading-list rows as `context`, the design (the `D-n` it honours, module, data changes, API shape), implementation notes (classes, functions and routes to create or change), edge cases with the expected behaviour, and the test plan (a Playwright spec when `codebase.playwright` is true and a criterion is observed via `ui`, next to the project's own specs and never under `aidlc-twins/`: that folder belongs to the test writer at finish) |

Nothing in a story may be new: everything comes from the record. A fact the record lacks sends you
back to `intake.md` for that one fact. Builders never read the pages or the register, so every
statement a story delivers is written out in its criteria or notes, not only cited in `sources`.

### 3b. Decide where a tester checks each criterion

Every criterion gets `observed_via`: where a tester checks it, never where the code lives. Take it
from intake's locating pass and the explorers' `seen_at` answers, which name for every changed job,
package, service, query or table the screen, menu entry, tab, button, route or API that starts it or
shows its result. They sit in the record: in its `reading_list`, where each row's `why` names the
change, where a user sees or starts it and its via, and in its `decisions`. A fact they do not give
sends you back to `intake.md` for that one fact.

| Value | When |
| ----- | ---- |
| `ui` | Any part of the check runs on a screen: the user starts it there or sees the result there |
| `api` | The tester calls an endpoint (REST, SOAP, a message) and reads the answer; no screen shows it |
| `db` | The tester checks a record, a field or a status in the database; no screen or API shows it |
| `log` | The tester reads it in a log that no screen shows |
| `none` | A tester cannot check it: code level, or another story's test case covers it |

- This classification decides what a tester can check: screen behaviour, database state and
  record changes, log output, observable data and API responses are tester-verifiable. Unit tests,
  internal functions or classes, code-coverage thresholds, refactors, "no annotation or dependency
  remains" and a build or compile that passes are code level: `none`.
- When several apply, the first in the order `ui`, `api`, `db`, `log` wins: a screen that shows a
  job's log is `ui`.
- Look past the layer where the change sits: a job a user starts or watches on an admin screen, a
  result on a tab, a file made on a screen are all `ui`, also when the code lives in a job, a PL/SQL
  package, a query or a migration, and when the result lands in the database as well.
- `none` needs exactly one of `why_none`, a sentence in the record's language that says why a tester cannot check it
  (code level, and what), or `covered_by`, the quoted id of another story of this intent whose test
  case covers it, a story with at least one criterion that is not `none`.

On a real run the story's surface decided all of this: a job story whose file a user makes on a
screen and whose result shows on a tab got no test case, while data and job stories that ran
entirely through screens got no twin.

### 4. Check coverage both ways

- Every requirement appears in at least one story. One with no story means a story is missing: add
  it. A requirement that turns out to be none goes back to `intake.md` for that one item.
- Every story lists at least one requirement. One with none is scope creep: drop it or find the
  requirement it really serves.
- Every current register id is cited by a requirement or a story, or sits in `deliberately_not`.
  `spec-lint.cjs` checks this too; getting it right here saves a round.

### 4b. Write the overview data

The overview page draws three pictures from the record, and only you know what goes in them. Write
them now that the stories are final, always in the record's language, in words a product person
understands: a class name or an id is never a label.

- **`short`** per story: its name in the pictures, at most 24 characters.
- **`overview.layers`**: the parts of the system the stories cut through, bottom to top: the tables,
  then the code parts by module or feature, then the screens. `group` names the kind (tables, code
  or screens) in the record's language, `label` the name a product person knows, `tip` the technical
  name (the table, the class, the route).
- **`slice`** per story: every layer it cuts through, `new` where the story creates that part,
  `used` where it uses or changes it.
- **`integration`** per story: for every earlier story it overlaps (a shared table, class or rule),
  one test that runs against that story's real code, never a mock of it: `with` the earlier story,
  `test` one line in the record's language, for the builder and the page. The earlier story must land
  first: when this story does not reach it through `depends_on`, directly or through other stories,
  add the dependency or drop the overlap.
- **`overview.lifecycle`**: the life of the main thing the intent builds, its `subject`. `lanes` for
  who or what acts, top to bottom (a role, the system with `tone: strong`, a check with
  `tone: alert`); `steps` in order, each on a lane and in a column, with the `stories` that build it;
  `states` for the status band when the subject has states; `arrows` between the steps; `under_all`
  for a story every step stands on, such as the table they all read and write.

The record template shows every key. `spec-lint.cjs` checks the ids, the values and the dependencies.

### 4c. Draw the Code Scaffold

Skip this step in sandbox mode with `sandbox.code_scaffold: false`: write no
`technical_design.drawing` and no story `drawing`, and dispatch no place check. Nothing is missing
then: spec-lint, the cross-checker, the approval and the builders go without a Code Scaffold.

The Code Scaffold is a drawing of the code the stories build, on the overview page at the
approval, where a tech lead or architect corrects it before anything is built. It is the starting
point of the code, roughly how it is built, not a source of truth: it is never updated after the
build, and the overview after the build shows where the build deviated from it. Write it into the
record as `technical_design.drawing` and one `drawing` per story, with the keys of the record
template. Nothing is invented: every module, part and link comes from the reading list and the
decisions, so from the locating pass and the explorers' `hangs_on` and `lands_in` answers.

- **`modules`**: every module a part lives in, `new`, `changed` or `existing`. A new one has
  `follows`, the module it copies, and `registered_in`, every build file that lists it, with lines.
- **`parts`**: every class, file, table or endpoint the stories create, change or use, each with its
  `layer` (`screen`, `server`, `database`, `external`) and `kind`, in the order they call each other:
  the screen first, down to the tables and the systems outside. Each has `sub`, a few words
  under its name in the drawing, and `what`, two to four plain sentences on what the part
  is and does and its role in the application, for every part, new, changed or existing: what it
  gets, what it does with it, what it hands on, for someone who does not read the code. A click on
  the part shows them under "What it does", before the build and after it. What this intent changes
  in the part is not in it: that is the story's `builds`. An `existing` or `changed` part has
  the `path` and `lines` its row gives. A `new` part has the `path` where it comes and `follows`, the
  example of `lands_in`, when there is one; without one it is still green. Never a `.md` file:
  documentation (a `project-docs/` page, a README, a guide) is no part of the drawing, even when a
  story changes it; the story's `touches` names it. `spec-lint.cjs` refuses one.
- **`links`**: one per call between two parts, `label` what it does in a few words on the line,
  `step`, one plain sentence on what happens in this step for someone who does not read
  code, which the card over the drawing shows when the step is picked, and `code` the call;
  `kind: builds_on` where a part extends or implements another. A call into an `existing` part has
  `proof`: the `file` and `lines` where the callee already offers what is called (the method, the
  endpoint, the column), with an optional `note`. A call into a `changed` part has `proof`, or
  `adds` when the change to the callee adds what is called, in a few words. An existing
  part changes nothing, so a call it does not offer makes it `changed`, with `adds` on the link.
  A call into a `new` part needs neither, and a `builds_on` link needs no proof: the part's own
  `path` and `lines` prove the base.
- **`summary`**: three or four plain sentences on the whole. Per story `drawing`:
  `summary`, what it builds; `builds`, per part or module id what this story builds there, in a
  few words; `uses`, the ids it only uses. Every text of the drawing is in the record's language.

The colour of a part follows from these fields by fixed rules, never from your feeling, and you can
only lower it:

- A technical choice the code and the decisions do not settle (which library, which of two
  modules): `open`, the short question, with `open_detail`, the whole question. The part turns
  red and the approval asks it. A question on behaviour goes back to `intake.md` instead.
- Real doubt that it is right: `doubt`. Resting on a decision on an assumption: `assumption`.
  Known only from documentation: `source`, its register id. Each turns it orange.
- A deliberate difference from the example: `deviates`, with the reason. That is no doubt: the
  part stays green.
- A right: `right`, with its `status`. A new right always names the decision that creates it
  (`decision`), asked as intake step 5 asks a proposal.

Every `existing` or `changed` part has its place checked: `path` and `lines` from a row the locating
pass or an explorer read, never from memory or from a name alone. Every arrow is proven the same
way: the `proof` of a call comes from a row, never from a name alone. For the parts no row places
and the calls no row proves, dispatch one explorer (`specsmd-aidlc-turbo-explorer`) as a place
check, with per part its name and what the record says it is, and per call the two parts and what
is called; its answers become rows of the reading list, and it does not count toward intake's
explorers. A part it does not find goes back to `intake.md` as a question. A call it does not find
makes the callee `changed`, with `adds` on the link; when that is a real choice (another part
could offer it, or the change is not obviously this intent's), it goes back to `intake.md` as a
question instead. An arrow is never invented.

Every `new` or `changed` part and module is in the `builds` of at least one story, and its `path` is
in that story's `touches`, exactly or as a folder. A changed table is the exception: it changes through
a new script, which is in `touches` instead. `spec-lint.cjs` checks the places, the proofs, the
stories and the touches.

### 4d. Write the C4 model and the plain texts

The overview page also shows the C4 model, the application in its surroundings, and opens with the
intent and every story in plain words. Write both now that the stories and the drawing are final,
with the keys of the record template. Nothing is invented: every person, system, container and edge
comes from the reading list, the decisions, the pulled pages and the drawing, so from the locating
pass and the explorers' answers, and every sentence says only what the record says. A fact the
record lacks sends you back to `intake.md` for that one fact. In sandbox mode with
`sandbox.code_scaffold: false` there is no drawing: write the plain texts only, and no C4 model.

- **`technical_design.c4`**: `persons`, who uses the application, named as the business names
  them; `systems`, the application and every system outside it that it talks to (`ext: true`);
  `containers`, what the application is made of (a web application, a service, a database with
  `kind: db`), each with its `tech`; `components`, the groups of drawing parts inside a container,
  `parts` the ids of the parts each holds, every part in exactly one; `edges`, who uses what and
  what talks to what that the drawing does not show, `label` in a few words, `tech` how, and
  `intent: true` where this intent adds or changes it; `outside`, every external part of the
  drawing with the system it stands for. Leave out what follows from the parts: the status and the
  stories of an element.
- **`intent.plain`**: three to five sentences, at most 700 characters, on what the intent does,
  in the words of the people who use it.
- **`plain` per story**: at most 450 characters, what the story builds and how it serves the
  intent.

All of it is plain words in the record's language: no code, no file names, no markdown, no em-dash. `spec-lint.cjs` checks
what the record gives. The page names what it lacks: `intent-overview.cjs` prints one
`Missing: record.yaml {path} ({id}): {what}` line per gap when `review.md` step 2 renders it. Write
what each line names into the record as above, render and lint as in `render.md`, and render the
page again, until no `Missing` line is left.

### 5. Pick the lane

`lane: quick` when the intent has at most 2 stories, none `hard`, and no source the user had to
settle against another (a page against the code, or two pages against each other). Otherwise
`lane: full`. Inception runs every gate in both lanes. The quick lane skips only the separate intent
review in construction (the last story review covers the requirements) and allows building in this
same session after the approval.

### 6. Show the map and go on

Show the story map once, as information: number, title, depends on, complexity, tester verifiable
(yes when a criterion is observed via anything but `none`), and the lane. Titles and order only, no
detail, and no question: go straight on to `render.md`.

The user sees every story again on the overview page at the approval, in `review.md`. A different
split asked for there is a change like any other.

---

## Output

```text
Story map for user-auth (3 stories, lane full)

| # | Title | Depends on | Complexity | Tester verifiable |
|---|-------|------------|------------|-------------------|
| 001 | Sign in with a valid password | - | low | yes |
| 002 | Reject a wrong password | 001 | low | yes |
| 003 | Login with expired password | 001 | medium | yes |

Coverage: 9 of 9 requirements; every statement from the documentation is built or left out on
purpose (2 left out). Rendering the specs now.
```

---

## Transitions

- Map shown -> `render.md`, automatically, without a question
- A different split asked for at the approval -> redo steps 1 to 5, then `render.md`
- **The Code Scaffold is wrong** at the approval -> step 4c with the correction, and every story,
  `touches` or decision it moves, and step 4d where it moves the C4 model, then `render.md`
- A `Missing:` line when the page renders -> step 4d for what it names, then `render.md`
- A missing fact turns up -> back to `intake.md` for that one fact, then return here
