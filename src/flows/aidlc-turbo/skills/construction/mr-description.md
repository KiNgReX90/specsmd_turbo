# Skill: MR Description

---

## Role

Write the reviewer description of a merge request the flow opened. It is Turbo's own reviewer-narrative template, with fixed rules and a state marker, so every merge request the flow opened reads the same way.

`push-branch.cjs` opens the merge request in the push and gives it its title: the Jira key and the title in the record's language (`SHOP-642 - Gift cards without a code`). A push option carries one line, so the description it sends is one placeholder sentence. This skill replaces that sentence with the full description. It never touches the title. A later push leaves the title and the description alone: while the merge request is open, `push-branch.cjs` pushes without push options.

The construction agent follows this file. No checkpoint: a description that could not be written is named in the summary, never a stop.

---

## When

- **Finish**, after step 10 and its last push: run it for the intent's merge request and for every story merge request in the frontmatter. The build loop pushes nothing, so this is the only moment. The create flow fills a description that is still the one line; the update flow adjusts one whose branch moved since its marker (a fix, the twins, finish again), only in the sections that change makes wrong or incomplete. A description whose marker already names the branch head is left alone, apart from a Jira link or a Documentation line that came since.
- Only GitLab: the link holds `/-/merge_requests/`. A GitHub pull request already got `push-branch.cjs`'s description through `gh`. Sandbox mode pushes nothing.

---

## The template

```markdown
**Link to the world:** {Jira link, see "Link to the world"}
**Documentation:** {the intent's own Documentation page from sync.yaml; drop the line when there is none}

## Summary

{The smallest view that makes the change clear, next to a sentence or two.}

## Evidence

{Before and after: a screenshot for a visible change, else the test that
fails before and passes after.}

## Merge danger

{One-way or two-way door, then the blast radius in one word and each
plausible ramification.}
```

End every description with the state marker (invisible when rendered):

```
<!-- turbo-mr-desc synced:{full-head-sha} jira:{ok|pending|none} -->
```

The template is the PR skill of Dex Horthy (HumanLayer), published as the `pr` skill in Matt Pocock's skills collection, [mattpocock/skills](https://github.com/mattpocock/skills). The link lines and the state marker are the Turbo additions.

`mr-description-example.md` next to this file shows a worked before and after; read it before the first description of a session. It is the tone and depth anchor.

---

## Writing the three sections

**Summary.** The first sentence says what changes and why, in the project's own domain words. No preamble. Then the smallest view that makes the key point clear, with a short explanation next to it:

- pseudocode, for logic or an algorithm;
- a call tree, for runtime control flow;
- a component tree, for UI structure, with the state and module boundaries that matter;
- a shallow file tree or a two-column table, for what each file or place does, or for a broad refactor;
- a Mermaid diagram, for how components interact, or for control or data flow;
- a `diff` block, when the point is what changes and the structure around it already exists;
- a full code block, when most of the code is new, when a cut would hide who owns what or in which order it runs, or when the reader needs a copyable shape.

Show only the calls, files, props, states or boundaries the point needs. One view, two at most. A change outside the main point (a deleted folder, a moved file) gets one line, so nothing in the diff goes unnamed. The intent's merge request lists its story merge requests here, with their links, merge order first.

**Evidence.** A before and after.

- A visible change: a screenshot before and after is the strongest evidence. When the session has none, write one line that names the screen, e.g. "Screenshot of the settling page notice: to add."
- Otherwise evidence from a run: the specific test that fails before the change and passes after, in pseudocode (given, when, then), with the real run counts; then the verification, review, live test or break test results the flow recorded.
- One line on what is not covered.

**Merge danger.**

- **One-way door** or **two-way door**. A two-way door can be reversed: a revert undoes it. A one-way door cannot: destructive actions and hard-to-reverse decisions, such as a data conversion, deleted data, a sent mail or a published contract. A merge request with both names each part. A cheap rollback means lower risk.
- The blast radius in one word (for example none, local, module, broad), then each plausible ramification as a bullet: consumer breakage, a behavior change for users, layout shifts, config or data effects. A refactor with no ramification writes "Behavior changes: none."

---

## Rules

1. Short. Plain spoken English, short sentences, no preamble. No "we", "you", "this MR". Banned words (rewrite the sentence, don't swap synonyms): comprehensive, robust, seamless, ensure(s), leverage(s), facilitate(s), introduces, encompasses, holistic, end-to-end, streamlined, scalable. No em-dash.
2. Reference, don't duplicate: commits by SHA, the story and the brief by path, Jira by link. No per-file, per-commit or per-review-round walkthroughs: the diff, the commits and the merge request discussion already hold those. Only reference paths tracked at the merge request's head: check with `git cat-file -e {head-sha}:{path}`. `.specs-aidlc-turbo/` files that never reach the branch do not exist for the reviewer; write their substance into the Summary.
3. Never fabricate: every claim comes from the diff, the story, the brief, the proof files, or commands that ran in this session. The verification, the review and the live test of the flow count when their result is in `{intent_dir}/proof/` or was shown in this session; name what ran. A test that did not run is not "green".
4. Describe only this merge request's own delta (`{into}...{branch}`). A story stacked on another story never re-describes its parent's changes.
5. English. The user story line and acceptance criteria may be quoted as written, in the record's language.
6. Never send a title, labels or assignees. `mr-describe.cjs` sends the description only.

---

## Context sources

| Merge request | Read |
| --- | --- |
| A story's | The story file, both halves: the user story line and the acceptance criteria for the Summary's first sentence; Design, Implementation notes and Build notes for the Summary's view; the out-of-scope list and the brief's decisions (`D-n`) the story cites for Merge danger. `git log --oneline {into}..{branch}` and `git diff {into}...{branch}`. Its proof file `{intent_dir}/proof/{SSS}.json`. |
| The intent's | The brief (Intent, Design decisions, Verification, Lessons), every story file with its `merge_request`, the test cases in `{intent_dir}/tests/` and the finish results of this session (verification, intent review, live test, break test). `git log --oneline {into}..{branch}`. With story branches the intent branch holds the specs and the test cases; the code is in the story merge requests: list them with their links, merge order first. |

`{into}` is the merge request's target as `push-branch.cjs` printed it; fetch it first when it is a remote branch you do not have.

---

## Link to the world

The Jira keys are in `.specs-aidlc-turbo/docs/{inception}/sync.yaml`, under `jira.intents.{intent-slug}`: `epic` for the intent, `stories."{SSS}"` for a story. The site comes from `jira_project_url` in `.specs-aidlc-turbo/project/project.yaml`, else `sync.jira_project_url` in the config. Neither has one: write the key without a link.

1. The key is there: `[{KEY}](https://{site}/browse/{KEY})`. Marker `jira:ok`.
2. No key, and the intent's sync block says `pending`: "Jira issue pending: the Jira sync of this intent has not finished". Marker `jira:pending`.
3. No key and no Jira sync (`sync.issues` is not `jira`): "no ticket ref". Marker `jira:none`.

**Documentation:** the intent's own page, `confluence.intents.{intent-slug}.url` in the same `sync.yaml`, else `confluence.documentation.url`. Drop the line when both are absent.

---

## Process

1. **Read**: `node .specsmd/aidlc-turbo/scripts/mr-describe.cjs read --url {url}`. It prints `{ ok, url, title, description, state }`.
   - `ok: false` naming `GITLAB_TOKEN`: the user has no GitLab key. Write no description in this session, keep going, and say it once in the summary: the merge requests keep their one line until a `GITLAB_TOKEN` is set in the environment, the project's `.env` (git-ignored) or `~/.claude/.env`.
   - Any other `ok: false`: name it in the summary for that merge request and go on.
2. **Pick the flow** from the description that came back:
   - **Create**: it is empty, or one line without the marker (the sentence `push-branch.cjs` sent).
   - **Update**: it carries the marker. Its `synced:` sha equals the branch head: no section changes, only the top lines below when a Jira key or a Documentation page came since. Else the delta is `git diff --name-status {synced-sha}..{branch}` plus `git log --oneline {synced-sha}..{branch}`. When the sha is unknown or not an ancestor of the branch (`git merge-base --is-ancestor`), take the whole `{into}...{branch}` delta and only add or correct what is plainly wrong. Per section, decide whether the delta makes it wrong or incomplete. A section the delta does not touch is never sent. Fold the delta into the section it changes; never append a "round 2" or "review findings" block. **Never delete or rewrite a sentence the delta doesn't contradict**: a reviewer may have edited it. No section needs a change: write nothing at all, not even the marker, and the description stays exactly as it was.
   - **Hand-written**: no marker and more than one line. Only add the missing sections below the existing text, change nothing else, and append the marker.
3. **Render**:
   - **Create**: the template from the context sources. All three sections always appear; Evidence with nothing run yet says verification is pending.
   - **Hand-written**: the missing sections.
   - **Update**: only each section that needs a change: its live text from the description, with the delta folded in.
4. **Write**: put the text in a file outside the repository (the system temp folder), send it, and delete the file.
   - **Create** and **Hand-written**: `node .specsmd/aidlc-turbo/scripts/mr-describe.cjs write --url {url} --body-file {file}`, the whole description.
   - **Update**: one `node .specsmd/aidlc-turbo/scripts/mr-describe.cjs patch --url {url} --section "{heading}" --body-file {file}` per section that changed, the file holding that section's text without its heading line; the last one adds `--synced {full-head-sha}`. It replaces that one section and keeps every other byte, a reviewer's edits included. A top line goes the same way: when the marker says `jira:pending` or `jira:none` and the Jira key now exists, one `mr-describe.cjs patch --url {url} --line "Link to the world" --text "{link}" --jira ok`; when the Documentation page now exists, one `mr-describe.cjs patch --url {url} --line "Documentation" --text "{link}"`. It replaces only the value after the label, and a missing line goes in at the top. Never `write` on an update, never the whole text.

   It prints `{ ok, url, written }`, with `unchanged: true` when the text was there already and nothing was sent, or `{ ok: false, detail }`: name that in the summary.
5. One line per merge request: its link and `description written`, `description updated`, `description unchanged` or why it kept the one line. At finish these lines go into the summary of step 12 and are never shown before it: that summary is where the user learns they can merge.
