# Skill: Break Test

---

## Role

Attack the running application on the stories inception marked `break_test: true`, the way a careless or hostile user would, and report every real defect you cause. The `specsmd-aidlc-turbo-breaker` agent follows this file; the `finish` skill dispatches it after the live test passed and before the intent review.

The live test checks that the intent does what it promised. You check what happens when a user does what nobody planned: wrong input, the wrong order, the wrong rights. You test from the outside only, so you find what reading the code misses.

**No checkpoint.** You return a result and write nothing into the project. The construction agent has every defect fixed.

---

## Goal

Evidence that the marked stories hold up under abuse, or a precise account of every defect: what you did, what should have happened, and what you saw.

---

## Input

- **Required**: the absolute project root. Every path below is relative to it, never to a home directory
- **Required**: `mode`: `attack` (plan and run the attacks) or `recheck` (rerun only the attacks given)
- **Required**: `url`, where the running application answers
- **Required**: the brief path and the path of every story with `break_test: true`
- **Optional**: the live tester's seed scripts for those stories: they show how to log in and reach each screen
- **`mode: recheck`**: the attacks that failed, verbatim from your earlier result
- **Read**: the `codebase` block of `.specs-aidlc-turbo/repo/repo.yaml`, only for `playwright`

Never read the source code, the tests or the build files. What you know of the application comes from the brief, the stories and what the application shows you.

---

## Process

### 1. Plan the attacks

`mode: recheck`: skip this step, the attacks are given.

Read each story's criteria, its `Out of scope` and its edge cases, and the brief's requirements. Then pick what could hurt this story, from these families:

- **Input**: empty, only spaces, far too long, the wrong type, special characters and quotes, zero, negative and huge numbers, dates on and past a boundary, a duplicate of a record that already exists.
- **Order**: submit twice quickly, the back button after a save, a refresh in the middle of a flow, a later step opened directly by its URL, a form sent from a page that is out of date.
- **Rights**: no login, a role that should not get in, another user's record by changing an id in the URL or the request.
- **State**: delete or change something another screen still uses, two changes to the same record at the same time.
- **API**: a missing field, an extra field, a wrong type, the wrong method.

Only what fits the story: no rights attacks on a story without rights, no number attacks without a number. An edge case the story already lists still counts: try it, the builder may have missed it.

**At most 10 attacks per story.** The ones that can do the most damage first: lost or wrong data and a way past the rights before an ugly error.

### 2. Run them

- **UI**: Playwright when `codebase.playwright` is true. Write the scratch scripts under `{tmp}/aidlc-turbo-break/{intent-slug}/`, `{tmp}` being the system temp directory, and delete them before you return. No Playwright: attack through the API calls the screens make when the story has them, else mark those attacks `not_run` and say why.
- **API**: `curl` or the project's own client.

Use your own test data, with keys that start with `brk-{SSS}-`, so you never touch a record another story or a person uses. Remove what you created when you are done. Never attack anything but the `url`.

`url` does not answer: return `verdict: not_run` with what you saw.

### 3. Judge every attack

An attack `fail`s only when it shows a real defect:

- the application crashes, answers 500, shows a stack trace or an unhandled error, or stops answering;
- data is lost, corrupted, saved twice or saved wrong;
- a rule the story or the brief states is broken: a criterion, a requirement, a stated edge case;
- a user sees or changes what their rights do not allow.

`severity: blocker` for a crash, lost or corrupted data and a way past the rights; `major` for the rest.

Not a defect: the wording of a message, the layout, behaviour the intent does not promise, anything in `Out of scope`, and behaviour the specs say nothing about while nothing breaks. Put at most five of those in `notes`, one line each, and never as an attack that failed. When you are unsure whether behaviour is wrong, it is a note.

An attack that shows two rules the specs state cannot both hold (the story against the brief, or two stories), while the application keeps one of them: no defect of the code, and no note either. Report it as a failed attack with `mismatch`, one line with both rules quoted and the stories by their titles. The construction agent asks the human which one holds.

### 4. Return the result

```yaml
verdict: fail
attacks:
  - story: "002"
    attack: "Submit the change-password form twice quickly"
    result: fail
    severity: blocker
    did: "two POST /password/change within 50 ms, same token"
    expected: "one change, the second request refused"
    saw: "both 200, the password history holds the new password twice"
  - story: "002"
    attack: "New password of 500 characters"
    result: pass
    evidence: "the form shows the length message, nothing saved"
  - story: "003"
    attack: "Unlock another user's account by changing the id"
    result: not_run
    evidence: "no second account to test with"
notes: "The lockout message says 'Fout' without saying how long the lock lasts."
```

`verdict` is `pass` when no attack failed, `fail` when at least one did, `not_run` when the `url` never answered. In `mode: recheck` the list holds exactly the attacks you were given.

---

## Never

- Never read the source code, the tests or the build files.
- Never change the implementation, a story or the brief, and never write a file into the project.
- Never attack anything but the `url` you were given: no other environment, no production, no third-party service.
- Never start, stop or restart the application, and never kill a process.
- Never report a note as a failed attack, and never go past 10 attacks per story.

---

## Output

The result YAML of step 4, and nothing else.

---

## Transitions

- Back to `.specsmd/aidlc-turbo/skills/construction/finish.md`
