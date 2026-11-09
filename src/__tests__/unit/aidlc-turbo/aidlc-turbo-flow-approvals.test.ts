/**
 * AI-DLC Turbo - the flow texts behind the approvals, the reuse check and a
 * long phase. The big flow test holds the older invariants; these are newer:
 * - A phase that runs long reads its agent and its skill again after a
 *   summary, from the paths of this session, never from a path the summary
 *   names. A real run followed a stale rule from its own summary.
 * - Nothing leaves the machine before the user approved the intent on its
 *   overview page at finish. The build loop pushes nothing and opens no merge
 *   request; finish shows the overview, asks, and then pushes every branch in
 *   one go. A free answer that declines the push keeps the intent local.
 * - Inception checks what already exists before it proposes something new.
 *   Every explorer asks which existing structure the work hangs on, a proposal
 *   that comes up later in the questions is checked by an explorer before it
 *   is asked, and an answer no code backs is recorded as an `assumption`,
 *   marked in the brief, checked again by the cross-checker and listed at the
 *   approval. On a real run the agent proposed two new rights for an order
 *   status screen while the application already had a view right on the menu
 *   next to it and a role for admin screens.
 * - The overview opens as an artifact, and after the inception approval goes
 *   onto the epic with that link.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const FLOW = path.join(ROOT, 'flows/aidlc-turbo');
const read = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8');
const flat = (rel: string) => read(rel).replace(/\s+/g, ' ');

/** The text of one `### n.` section of a skill, whitespace collapsed. */
const section = (rel: string, heading: string) => {
  const text = flat(rel);
  const at = text.indexOf(heading);
  expect(at, `${rel}: ${heading}`).toBeGreaterThan(-1);
  const next = text.indexOf('### ', at + heading.length);
  return text.slice(at, next === -1 ? undefined : next);
};

describe('aidlc-turbo after a summary', () => {
  it('a phase that runs long reads its agent and its skill again after a summary, from its own paths', () => {
    for (const rel of ['commands/aidlc-turbo.md', 'commands/aidlc-turbo-inception.md', 'commands/aidlc-turbo-construction.md']) {
      const text = flat(rel);
      expect(text, rel).toContain('**After a summary**');
      expect(text, rel).toContain('read the agent definition and the skill you were in again');
      expect(text, rel).toContain('never from a path the summary names');
    }
  });
});

describe('aidlc-turbo approval before anything leaves the machine', () => {
  it('nothing leaves the machine before the user approved the intent on its overview page', () => {
    const dispatch = read('skills/construction/dispatch.md');
    const finish = read('skills/construction/finish.md');
    const describe = read('skills/construction/mr-description.md');
    // The build loop pushes nothing and opens no merge request.
    expect(dispatch).not.toMatch(/git push|push-branch|`push\.lines`|mr-description/);
    expect(describe).not.toContain('**Build loop**');
    // A fix or a twin commit on a story branch at finish is not pushed on its own either.
    expect(finish).not.toMatch(/and push (the branch|it)\b|push the story branch when/);
    // Finish shows the overview, asks, and only then pushes every branch in one go.
    const overview = finish.indexOf('intent-overview.cjs {intent} --phase construction');
    const ask = finish.indexOf('**Approve, push to remote**');
    const pushAll = finish.indexOf('push-branch.cjs {intent} --all');
    expect(overview).toBeGreaterThan(0);
    expect(ask).toBeGreaterThan(overview);
    expect(pushAll).toBeGreaterThan(ask);
    expect(finish).toContain('**Change first**');
    expect(finish).toContain('**Questions about the code**');
    // Keeping it local is still possible, through a free answer that declines the push.
    expect(finish).toContain('Any other answer that declines the push');
    expect(finish).toContain('Never push, open a merge request, correct a page or write to Jira before the user approved the intent in step 8.');
  });

  it('the approval loop and a kept-local intent hold together', () => {
    const finish = flat('skills/construction/finish.md');
    // A change the user asks for is no miss of the story.
    expect(finish).toContain('A change the user asks for is not a miss');
    expect(finish).toContain('when `tester.enabled` is true, item 6 of step 6');
    expect(finish).toContain('or after **Change first** in step 8');
    expect(finish).toContain('step 9 commits but pushes nothing');
    // Finish again on an intent that was never pushed.
    expect(finish).toContain('when it has an upstream');
    expect(finish).toContain('the brief has no `merge_request`');
    for (const f of ['skills/construction/navigator.md', 'skills/master/route-request.md', 'skills/master/analyze-context.md']) {
      expect(flat(f), f).toContain('not pushed yet');
    }
  });

  it('a remark of the user is noted and shown on the overview, and built only after an explicit go', () => {
    // On a real run the user asked how a class worked and said what they would rather have; the agent
    // read that as a yes and started a builder at finish, before the plan was changed or approved.
    const inception = flat('agents/inception-agent.md');
    expect(inception).toContain('**A remark is noted and shown before anything is built.**');
    expect(inception).toContain('A remark, a question, a wish or an answer to a question is never a go.');
    // No discussion round of its own: weighed, taken when it holds, pushed back once when it does not.
    const change = section('skills/inception/review.md', '### 4. On change, route back');
    expect(change).toContain('**First weigh it.**');
    expect(change).toContain('When it holds, take it without a discussion.');
    expect(change).toContain('Discuss it further only when the user asks about it.');
    expect(change).toContain('so the user checks exactly that on the page');
    expect(flat('skills/inception/review.md')).toContain('is no yes, and neither is an answer to a question you asked about a change');
    // At finish: weighed, planned as at the inception, shown on the page of the build (its Review of what was
    // built stays) with only the drawings as the plan, no build marks over it, and the go before any builder.
    const finish = flat('skills/construction/finish.md');
    const step8 = finish.slice(finish.indexOf('### 8. Overview and approval'), finish.indexOf('### 9. Ship'));
    const weigh = step8.indexOf('Weigh each change as');
    const note = step8.indexOf('**Plan it first, as at the inception**, before any code changes');
    const again = step8.indexOf('intent-overview.cjs {intent} --phase construction --plan --no-open');
    expect(step8).not.toContain('--phase inception');
    expect(step8).toContain('The Code Scaffold shows what will be built');
    const go = step8.indexOf('**Only on Build the changes**');
    const fix = step8.indexOf('through the fix loop of step 5', go);
    expect(weigh).toBeGreaterThan(0);
    expect(note).toBeGreaterThan(weigh);
    expect(again).toBeGreaterThan(note);
    expect(go).toBeGreaterThan(again);
    expect(fix).toBeGreaterThan(go);
    expect(step8).toContain('A remark the user types instead of picking an option goes as **Change first**');
    expect(step8).toContain('A question is answered, never acted on');
    expect(finish).toContain('Never build or fix a change the user asked for before it is noted, shown on the overview again');
    expect(flat('agents/construction-agent.md')).toContain('Never start a builder on a remark or a question of the user.');
  });

  it('finish shows the merge requests only in the summary, after Jira and the descriptions, ending with the merge signal', () => {
    // On a real run the user saw the merge request right after the push, while the pages, Jira, the overview links
    // and the description still had to land: merging then is too early, the pipeline packs and removes the specs.
    const finish = flat('skills/construction/finish.md');
    const step9 = finish.slice(finish.indexOf('### 9. Ship'), finish.indexOf('### 10. Jira'));
    expect(step9).toContain('**show no merge request to the user yet**');
    expect(step9).not.toContain('Show every `url`');
    expect(step9).not.toContain('show every merge request');
    const step10 = finish.slice(finish.indexOf('### 10. Jira'), finish.indexOf('### 11. Stop the application'));
    expect(step10).toContain('Keep its one line per merge request for the summary.');
    const step12 = finish.slice(finish.indexOf('### 12. Summary'), finish.indexOf('## Finish again'));
    expect(step12).toContain('Print it only after step 10 and the descriptions are done');
    expect(step12).toContain('`**All done, you can merge.**`');
    expect(step12).toContain('`**Do not merge yet**:');
    const output = finish.slice(finish.indexOf('## Output'), finish.indexOf('## Never'));
    expect(output).not.toContain('**Next**');
    expect(output).toContain('**All done, you can merge.**');
    expect(finish).toContain('Never show a merge request before the summary of step 12');
    expect(flat('skills/construction/mr-description.md')).toContain('At finish these lines go into the summary of step 12 and are never shown before it');
  });

  it('no text still says a story is pushed when it is done, or that construction asks nothing', () => {
    const stale = /pushed (as soon as|the moment|when) (the story is |it is )?done|pushed when it is done/;
    for (const f of ['quick-start.md', 'templates/config.example.yaml', 'README.md', 'commands/aidlc-turbo-config.md', 'skills/master/explain-flow.md']) {
      expect(flat(f), f).not.toMatch(stale);
    }
    expect(readFileSync(path.join(ROOT, 'lib/flow-config.js'), 'utf8')).not.toMatch(stale);
    const once = /only approval in the whole flow|only checkpoint in the flow|Construction has none|Why only one approval|\*\*One approval\.\*\*|and the one approval/;
    for (const f of ['quick-start.md', 'skills/inception/review.md', 'skills/master/explain-flow.md', 'PRD.md', 'README.md']) {
      expect(flat(f), f).not.toMatch(once);
    }
    for (const f of ['README.md', 'agents/construction-agent.md']) expect(flat(f), f).toMatch(/approv/);
  });

  it('finish shows the overview as the artifact, the same link as the approval page, and the file only without one', () => {
    const finish = read('skills/construction/finish.md');
    const step8 = finish.slice(finish.indexOf('### 8. Overview and approval'), finish.indexOf('### 9. Ship'));
    expect(step8).toContain('intent-overview.cjs {intent} --phase construction --no-open');
    expect(step8).toContain('`overview.{intent-slug}.artifact`');
    expect(step8).toContain('open that link in the browser with `node .specsmd/aidlc-turbo/scripts/open-browser.cjs {artifact link}`, always');
    expect(step8).toContain('No Artifact tool, or the publish fails or is refused: run the script again without `--no-open`');
    expect(step8.indexOf('open-browser.cjs {artifact link}')).toBeLessThan(step8.indexOf('**Approve, push to remote**'));
  });
});

describe('aidlc-turbo reuse before create', () => {
  it('inception checks what already exists before it proposes something new', () => {
    const intake = flat('skills/inception/intake.md');
    // Every explorer asks it, next to where a user sees or starts the change.
    expect(intake).toContain(
      "What existing structure does this area's work hang on? For every right or role, menu place, screen, table, service or job it needs, name the existing one that fits, or the closest example, with file and lines, or say that none fits.",
    );
    expect(intake).toContain('Ask what exists, not only how it works');
    // A proposal that comes up later is checked before it is asked, on a budget of its own.
    expect(intake).toContain('**Check before you propose.**');
    expect(intake).toContain('at most three such checks in all, not counted toward the three explorers of step 4');
    expect(intake).toContain('a decision that picks it has source `assumption`');
    expect(intake).toContain('Every decision that names or creates a code structure has its source in the code');

    const explorer = flat('commands/aidlc-turbo-explorer.md');
    expect(explorer).toContain('## What the work hangs on');
    expect(explorer).toContain('hangs_on:');
    expect(explorer).toContain('A **proposal check**');
    expect(explorer).toContain('unanswered: which existing {structure} fits {need}');

    // The brief marks it, the cross-checker checks it, the approval lists it.
    const checker = flat('commands/aidlc-turbo-cross-checker.md');
    expect(checker).toContain('**The assumption check**');
    expect(checker).toContain('builds new what already exists and fits');
    expect(flat('skills/inception/review.md')).toContain('Then every decision with source `assumption`');
    expect(flat('agents/inception-agent.md')).toContain('**Reuse before create.**');
  });
});

describe('aidlc-turbo overview as an artifact', () => {
  it('the overview opens as an artifact, and after the approval goes onto the epic with that link', () => {
    const open = section('skills/inception/review.md', '### 2. Open the overview');
    expect(open).toContain('intent-overview.cjs {intent-slug} --phase inception --no-open');
    expect(open).toContain('Read `overview.html` in full');
    expect(open).toContain('`overview.{intent-slug}.artifact`');
    expect(open).toContain('Open that link in the browser, always, also when the host shows the artifact itself');
    expect(open).toContain('node .specsmd/aidlc-turbo/scripts/open-browser.cjs {artifact link}');
    // Without the tool the local file opens as before.
    expect(open).toContain('run the script again without `--no-open`');

    const approve = section('skills/inception/review.md', '### 5. On approve, stamp and sync');
    const jira = approve.indexOf('mode `after-inception`');
    const attach = approve.indexOf(
      'node .specsmd/aidlc-turbo/scripts/jira-attach.cjs upload --issue {epic} --file .specs-aidlc-turbo/docs/{inception}/{intent-slug}/overview.html --name overview-{intent-slug}.html --link {artifact link}',
    );
    expect(attach).toBeGreaterThan(jira);
    expect(approve).toContain('publish it again to the same link, without opening it');
    expect(approve).toContain('set `pending_jira: true` under `overview.{intent-slug}` in `sync.yaml`');
    expect(flat('skills/inception/review.md')).toContain('the artifact is private until the user shares it on claude.ai');

    const rerun = flat('skills/sync/rerun.md');
    expect(rerun).toContain('when `pending_jira` under `overview.{intent-slug}` is set');
    expect(rerun).toContain('`jira-attach.cjs upload` of `review.md` step 5 again');
    expect(flat('skills/inception/intent-list.md')).toContain('`pending_jira` under `overview.{id}`');
  });
});
