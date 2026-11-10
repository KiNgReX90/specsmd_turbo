/**
 * AI-DLC Turbo - sandbox mode builds with git, like production.
 *
 * Sandbox mode used to mean no git, one story at a time in the project tree,
 * no diff, no mutants, no breaker, a live test that could be switched off and
 * nothing committed. Now sandbox is production without story branches: the
 * same intent branch, worktrees side by side, one commit per story, committed
 * fixes, a real diff, the mutants, the live test and the breaker. Only the end
 * differs: `branching.sandbox_finish` puts the intent straight onto the base
 * branch (`push`, the default) or opens one merge request (`merge_request`).
 * These guards keep the construction texts in line with that:
 * - no construction text keeps an old sandbox exception;
 * - construction startup turns a folder without git into a repository, or stops;
 * - finish step 9 ships per `branching.sandbox_finish`, merges a moved base
 *   branch in and verifies again, and a second move is a human stop;
 * - the Jira comments name the base branch and the commit when there is no
 *   merge request;
 * - finish again applies in both modes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');

const read = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8');
/** The file with every run of whitespace collapsed, so a phrase may wrap. */
const flat = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8').replace(/\s+/g, ' ');
/** The part of a flattened text from one heading up to the next one given. */
const section = (text: string, from: string, to: string) => {
  const start = text.indexOf(from);
  expect(start, from).toBeGreaterThan(-1);
  const end = text.indexOf(to, start + from.length);
  return text.slice(start, end === -1 ? undefined : end);
};

const CONSTRUCTION = [
  'skills/construction/break-test.md',
  'skills/construction/build-story.md',
  'skills/construction/dispatch.md',
  'skills/construction/finish.md',
  'skills/construction/live-test.md',
  'skills/construction/navigator.md',
  'skills/construction/review.md',
  'skills/construction/status.md',
  'skills/construction/test-cases.md',
  'agents/construction-agent.md',
  'commands/aidlc-turbo-builder.md',
  'commands/aidlc-turbo-builder-low.md',
  'commands/aidlc-turbo-reviewer.md',
  'commands/aidlc-turbo-intent-reviewer.md',
  'commands/aidlc-turbo-live-tester.md',
  'commands/aidlc-turbo-breaker.md',
  'commands/aidlc-turbo-test-writer.md',
  'commands/aidlc-turbo-debugger.md',
  'commands/aidlc-turbo-construction.md',
  'skills/sync/jira.md',
];
const BUILDERS = ['commands/aidlc-turbo-builder.md', 'commands/aidlc-turbo-builder-low.md', 'skills/construction/build-story.md'];

describe('aidlc-turbo sandbox construction', () => {
  it('no construction text keeps an old sandbox exception', () => {
    const gone = [
      /no git/i,
      /one at a time in the current tree/,
      /sandbox mode excepted/i,
      /project root in sandbox mode/,
      /Sandbox mode adds the builder's last `changed_files`/,
      /In sandbox mode also write the builder's `changed_files`/,
      /in sandbox mode `changed_files`/,
      /Mutants first\*\*, in production mode/,
      /in production mode `story-mutate\.cjs`/,
      /Skip this step in sandbox mode/,
      /breaker in sandbox mode/,
      /live_test\.enabled` (is )?false/,
      /Production mode always runs it/,
      /Sandbox mode commits nothing/,
      /Sandbox mode has no commits to diff/,
      /no usable diff/,
      /`tests_changed: null`/,
      /always in sandbox mode/,
      /Sandbox mode: the same summary without the commit column/,
      /in production mode,? the link to/,
      /Production mode only\./,
      /at finish in production mode/,
    ];
    for (const rel of CONSTRUCTION) {
      const text = flat(rel);
      for (const re of gone) expect(text, `${rel} ${re}`).not.toMatch(re);
    }
  });

  it('the construction agent says the one difference once, and runs the git check first', () => {
    const agent = flat('agents/construction-agent.md');
    expect(agent).toContain('**Sandbox mode builds exactly like production mode without story branches**: the same intent branch, worktrees side by side, one commit per story, reviews, mutants, live test and break test.');
    expect(agent).toContain('Only the end differs: `finish` puts the intent straight onto the base branch (`branching.sandbox_finish: push`, the default) or opens one merge request into it (`merge_request`).');
    expect(agent).toContain('tester and sync as the installer writes them');
    expect(agent).not.toContain('tester, live test and sync');

    const git = section(agent, '**Git**:', '3. ');
    expect(git).toContain('follow `.specsmd/aidlc-turbo/skills/master/git-check.md`.');
    expect(git).toContain('Turbo needs git in both modes, so a folder without it gets a repository and a first commit, or construction stops.');
    expect(git).toContain('A repository without a remote works: the work stays local.');
    // It comes before the intent is resolved, so every route through construction has git.
    expect(agent.indexOf('**Git**:')).toBeLessThan(agent.indexOf('Resolve the intent'));
    expect(agent).toContain('| `breaker` | Opus, high | Attacks the running application at finish, on the stories marked `break_test` |');
  });

  it('dispatch builds in both modes on the intent branch, every frontier story at once, each in its own worktree', () => {
    const dispatch = flat('skills/construction/dispatch.md');
    expect(dispatch).toContain('2. **The intent branch**, in both modes: the working tree must be clean outside `.specs-aidlc-turbo/`');
    expect(dispatch).toContain('Sandbox mode is production mode without story branches: `branching.story_branches` is ignored there, and only the end of `finish` differs.');
    expect(dispatch).toContain('- **Every story on the frontier starts at once**, each in its own worktree, in both modes.');
    expect(dispatch).not.toMatch(/\*\*Sandbox mode\*\*/);
    expect(dispatch).toContain('take them from `git -C {worktree} status --porcelain -uall`, minus `.specs-aidlc-turbo/`, the same set `story-land.cjs` checks.');
    expect(dispatch).toContain('- **Mutants first**, unless `construction.mutants` in the config is 0');
    expect(dispatch).toContain('Delete the `.diff` files and the index once the story lands.');
    expect(dispatch).toContain('never build one story at a time while the frontier holds more.');
    expect(dispatch).toContain('You write only statuses, `misses`, `D-n` decisions and `## Lessons` lines.');
  });

  it('the reviewers always read a real diff, and the story lens always proposes mutants', () => {
    const review = flat('skills/construction/review.md');
    expect(review).toContain('the code root (the story\'s worktree, or the project root at finish), the story path, the proof `{intent_dir}/proof/{SSS}.json`.');
    expect(review).toContain('and the diff command, which leaves out `.specs-aidlc-turbo/`. `coverage_only: true` for a quick-lane intent');
    expect(review).toContain('Return `mutants: []` when no criterion has a test. Never run a mutant yourself');
    expect(review).not.toMatch(/sandbox/i);
  });

  it('the builders work in the worktree they are given, and the mutants run in both modes', () => {
    for (const rel of BUILDERS) {
      const text = flat(rel);
      expect(text, rel).toContain('- **Code root**: the worktree your assignment names, or the project root for a fix at finish.');
      expect(text, rel).toContain('that run costs a test run and proves little, and `story-mutate.cjs` breaks the story\'s lines one at a time');
      expect(text, rel).not.toMatch(/sandbox/i);
    }
  });

  it('finish tests live and breaks in both modes', () => {
    const finish = flat('skills/construction/finish.md');
    expect(finish).toContain('Sandbox mode runs every step below as production mode without story branches. Only step 9 differs: `branching.sandbox_finish` says whether the intent goes straight onto the base branch (`push`, the default) or gets one merge request (`merge_request`).');
    expect(finish).toContain('(mode, branching, tester, sync)');
    expect(finish).toContain('Skip this step unless story branches are on.');

    const live = section(finish, '### 2. Live test', '### 3. Break test');
    expect(live).toContain('**The live test always runs**, in sandbox mode as in production: an intent is finished only once it was tried on the running application.');
    expect(live).toContain('An old `live_test.enabled` in the config is ignored.');

    const brk = section(finish, '### 3. Break test', '### 4. Intent review');
    expect(brk).toContain('Skip this step for a quick-lane intent (`brief.lane: quick`), and when no story has `break_test: true` in the status JSON');

    const review = section(finish, '### 4. Intent review', '### 5. Fix loop');
    expect(review).toContain('git diff {base_branch}...HEAD');
    expect(review).not.toMatch(/sandbox/i);

    const cases = section(finish, '### 6. Test cases', '### 7. Close the brief');
    expect(cases).toContain('No application runs, because the user decided in step 2 that the intent cannot be tested live: the writers get `url: none`');

    expect(finish).toContain('The brief rides in the commit of step 9.');
    expect(finish).toContain('- Never skip the live test, and never run the breaker on a quick-lane intent.');
    expect(read('skills/construction/break-test.md')).toContain('the `finish` skill dispatches it after the live test passed');
    expect(read('commands/aidlc-turbo-breaker.md')).toContain('description: Use when the AI-DLC Turbo construction agent, at finish, asks to attack the running application');
  });

  it('finish commits every fix in both modes', () => {
    const fix = section(flat('skills/construction/finish.md'), '### 5. Fix loop', '### 6. Test cases');
    expect(fix).toContain('A fix that passes is committed on its story, and only the fix');
    expect(fix).not.toMatch(/sandbox/i);
  });

  it('finish step 9 ships per branching.sandbox_finish', () => {
    const ship = section(flat('skills/construction/finish.md'), '### 9. Ship', '### 10. Jira');
    expect(ship).toContain('Production mode, and sandbox mode with `branching.sandbox_finish: merge_request`. Items 1 to 3 commit locally; item 4 and on run only when the user approved in step 8.');
    expect(ship).toContain('6. The flow never merges. Merging is the user\'s call.');

    const push = ship.slice(ship.indexOf('Sandbox mode with `push`'));
    expect(push).toContain('Sandbox mode with `push`, the default (`branching.sandbox_finish` missing or `push`), puts the intent straight onto the base branch, without a merge request.');
    expect(push).toContain('That is the one place the flow puts work on the base branch itself: the user chose it.');
    expect(push).toContain('1. Items 1 to 3 above: stage, commit, the twins on the intent branch.');
    expect(push).toContain('2. Only after the approval: `node .specsmd/aidlc-turbo/scripts/push-branch.cjs {intent}`.');
    expect(push).toContain('a plain push, never `--force`');
    expect(push).toContain('`{ branch, into, push: { ok, lines, local_only }, merge_request: null, pushed_to_base: true, commit, note }`');
    expect(push).toContain('and writes only `pushed_to_base` into the brief: the commit is in its output, never in the brief.');
    expect(push).not.toContain('pushed_commit');
    expect(push).toContain('3. `base_moved: true` (exit 1): the base branch has commits the intent branch lacks, and nothing was pushed.');
    expect(push).toContain('`git merge --no-ff origin/{base}`, or the local `{base}` when there is no remote.');
    expect(push).toContain('A conflict is a human stop: `git merge --abort`, and name the conflicting files.');
    expect(push).toContain('Otherwise run step 1, the full verification, again; a red tree goes through the fix loop of step 5. Commit the new proof, `{intent_dir}/proof/`, as `docs({intent-slug}): verify on the moved base`. Then run `push-branch.cjs {intent}` once more. A second `base_moved` is a human stop.');
    expect(push).toContain('4. Show `commit` and `into`, and a `note` verbatim: the local base branch was left where it was.');
    expect(push).toContain('An exit 1 with only `error`, without `base_moved` or `push` (the fetch failed, no base branch, no intent branch, or without a remote the local base could not move), is a human stop: show the `error`.');
    expect(push).toContain('A refused push (exit 1 with `push`) is a human stop: show every line of `push.lines`.');
    expect(push).toContain('With `push.local_only: true` say plainly that this repository has no remote: the work is only on the local base branch, and nothing was pushed.');
    // The order: merge the moved base in, verify again, then push once more.
    expect(push.indexOf('git merge --no-ff origin/{base}')).toBeLessThan(push.indexOf('run step 1, the full verification, again'));
    expect(push.indexOf('run step 1, the full verification, again')).toBeLessThan(push.indexOf('once more'));
  });

  it('finish step 10 records the push in both modes and the Jira sync names the base branch without a merge request', () => {
    const jira = section(flat('skills/construction/finish.md'), '### 10. Jira', '### 11. Stop the application');
    expect(jira).toContain('In sandbox mode with `push` there is no merge request: the brief holds `pushed_to_base` instead.');
    expect(jira).toContain('the mode `after-build`, plus in sandbox mode with `push` the `commit` that `push-branch.cjs` printed');
    expect(jira).toContain('In both modes, with or without Jira: the push wrote the merge requests, or `pushed_to_base`, into the brief');
    expect(jira).not.toContain('pushed_commit');
    expect(jira).toContain('In sandbox mode with `push`, it fast-forwards the base branch again; its `commit` is the one the summary shows, and a `base_moved` or an `error` there goes as in step 9.');
    expect(jira).not.toContain('Production mode, with or without Jira');

    const skill = flat('skills/sync/jira.md');
    const after = section(skill, '## After the build', '## Never');
    expect(after).toContain('A brief with `pushed_to_base` has no merge request (sandbox mode with `push`): name that base branch and the `commit` finish passed instead of a link, the base branch alone when no `commit` came along.');
    expect(skill).not.toContain('pushed_commit');
    expect(after).toContain('or with `pushed_to_base` the base branch and the commit');
    expect(after).toContain('A merge request that is not in the frontmatter, without `pushed_to_base` (none opened): leave its link out and say so in `note`.');
    expect(skill).toContain("the link to the intent's own documentation page (`confluence.intents.{intent-slug}.url`), else to the inception's (`confluence.documentation.url`), from `sync.yaml` when there is one, and the intent branch from the brief.");
    expect(skill).not.toMatch(/production mode|sandbox mode,/);
  });

  it('finish again applies in both modes, and the summary says where a pushed intent went', () => {
    const finish = flat('skills/construction/finish.md');
    const again = section(finish, '## Finish again', '## Output');
    expect(again).toContain('In both modes, for a `done` intent whose intent branch (the brief\'s `branch`) is not on the base branch yet');
    expect(again).toContain('No remote: leave out the fetch and check against the local `{base branch}`.');
    expect(again).toContain('An intent kept local has none, and neither has the intent branch in sandbox mode with `push`: skip the pull there.');
    expect(again).toContain('In sandbox mode with `push`, step 9 puts the intent onto the base branch as there.');
    expect(again).not.toContain('Production mode, for a `done` intent');

    const output = section(finish, '## Output', '## Never');
    expect(output).toContain('Sandbox mode with `merge_request`: the same summary.');
    expect(output).toContain('`{intent branch}` pushed onto `{base}` at `{sha}`.');
    expect(output).toContain('`{intent branch}` is only on the local `{base}` branch: this repository has no remote.');

    const never = section(finish, '## Never', '## Transitions');
    expect(never).toContain('Never merge a merge request, and never write a link that `push-branch.cjs` did not print.');
    expect(never).toContain('Only `push-branch.cjs` puts an intent on the base branch, in sandbox mode with `push`, and never with `--force`.');

    const navigator = flat('skills/construction/navigator.md');
    expect(navigator).toContain('In sandbox mode with `push` there is no merge request: until the intent is on the base branch, the suggestion is **Finish again**, which puts it there.');
  });
});

