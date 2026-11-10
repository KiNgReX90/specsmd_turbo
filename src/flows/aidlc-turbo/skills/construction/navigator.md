# Skill: Construction Navigator

---

## Role

Entry point of the Construction Agent. Shows where the intent stands and routes to the right skill.

**No checkpoint.** Routing only.

---

## Goal

Get the user into the right skill in one step, with the suggested action already picked out.

---

## Input

- **Optional**: the intent slug. Without one, list the intents whose brief is `approved` or `building`, and every `done` intent whose intent branch is not merged into the base branch yet.
- **Required**: `.specs-aidlc-turbo/repo/config.yaml`

---

## Process

1. Resolve the intent. Several candidates: present them with the host's multiple-choice prompt where one exists (on Claude Code: AskUserQuestion), otherwise a numbered list. Never auto-select when more than one intent is open.
2. Run `node .specsmd/aidlc-turbo/scripts/intent-status.cjs {intent} --json` for the current picture. A `done` intent: check whether its intent branch is merged and whether every test case is proven, both as `.specsmd/aidlc-turbo/skills/construction/finish.md` says under `## Finish again`.
3. Present the menu below, with the suggested step already named, in the session language: the menu below is in English.
4. On a selection, load that skill file and execute it with the intent slug.

---

## Output

```markdown
## Construction: user-auth

**Brief**: building   **Stories**: 2/3 done   **Frontier**: 003   **Blocked**: none

### Skills

1 - **Build**: run the loop until every story is done (`dispatch`)
2 - **Status**: where the intent stands (`status`)
3 - **Finish**: review, push and close the intent (`finish`)

### Suggested next step

Build story 003, the only one on the frontier.

Pick a number, or say which story to build.
```

When every story is done, the suggestion is **Finish**. When the frontier is empty and stories are still open, the suggestion is to resolve the blocked story, and the menu says which one.

A `done` intent whose intent branch is not merged yet gets **Finish again** and **Handle review comments** instead of building and finishing:

```markdown
## Construction: user-auth

**Brief**: done   **Stories**: 3/3 done   **Merged**: not yet   **Test cases not proven**: 1

### Skills

1 - **Finish again**: finish the intent again, so every test case is proven before the merge (`finish`, `## Finish again`)
2 - **Handle review comments**: fix or answer the review comments on its merge requests, story by story (`/specsmd-aidlc-turbo-review-fix`)
3 - **Status**: where the intent stands (`status`)

### Suggested next step

Finish again: the twin of the test case for Lockout counter never reached the application.

Pick a number.
```

**Finish again** is the suggestion when a test case is not proven, and the suggestion names what is not proven by its story title; a test case with `twin_result: outdated` is not proven because a review fix changed its code since its twin ran, and the suggestion says so. It is the suggestion too when the intent is not pushed yet (the brief has no `merge_request` and no `pushed_to_base`), and then the suggestion says it was kept local and nothing has been pushed. When every test case is proven and the intent is pushed, the suggestion is to let a human review and merge the merge request, and **Finish again** stays on the menu. Once a reviewer has commented, **Handle review comments** handles the comments; it works with GitLab merge requests only. In sandbox mode with `push` it is not on the menu: there is no merge request to comment on. In sandbox mode with `push` there is no merge request: until the intent is on the base branch, the suggestion is **Finish again**, which puts it there. A `done` intent that is merged is finished: say so, and point at `/specsmd-aidlc-turbo-inception` for the next intent.

---

## Transitions

- 1 to `.specsmd/aidlc-turbo/skills/construction/dispatch.md`
- 2 to `.specsmd/aidlc-turbo/skills/construction/status.md`
- 3 to `.specsmd/aidlc-turbo/skills/construction/finish.md`
- **Finish again**, 1 on the menu of a `done` intent, to `.specsmd/aidlc-turbo/skills/construction/finish.md`, under `## Finish again`
- **Handle review comments**, 2 on the menu of a `done` intent: tell the user to run `/specsmd-aidlc-turbo-review-fix {intent-slug}`, in this session or a new one, and stop
- Another phase to the Master Agent, `/specsmd-aidlc-turbo`
