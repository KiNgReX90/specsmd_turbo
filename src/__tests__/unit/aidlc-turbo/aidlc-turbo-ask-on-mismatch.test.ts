/**
 * AI-DLC Turbo - a mismatch is always put to the user, and reaches Jira.
 *
 * When an agent of the flow really runs into something that is wrong in the
 * project documentation or in the stories, the user decides it through the
 * host's multiple-choice prompt, because the answer has to reach Jira. A
 * mismatch is a page, the code, another page, a story, the brief or the user's
 * own answers that cannot all hold, or a page that states what is not true of
 * the code. A coding rule the new code simply follows is no mismatch. These
 * guards keep that in place:
 * - intake asks every mismatch as a closed question and never settles one by
 *   a precedence rule, a state-back or by following one side in silence;
 * - cross-check fixes only a slip of its own draft from the record; the
 *   cross-checker and the docs-verifier mark a mismatch, never fixed from the
 *   record;
 * - a builder never settles one by which source comes first: it returns
 *   blocked with `Mismatch:`, and a plain coding rule still simply wins;
 * - the reviewers, the live tester, the breaker and the debugger hand a
 *   mismatch back, and the construction agent asks it; only a story whose code
 *   changes with the answer waits;
 * - every answer is a decision with `mismatch` in the record, and the Jira
 *   sync sends it at the existing moments only: a section on the epic after
 *   the inception; after the build a changed story's new text with a comment,
 *   and a comment on the epic for a page that was wrong;
 * - a page that gave way is corrected on Confluence, with its `page_fixes`
 *   written by the resolve and sent by the push: in inception before the
 *   approval's push, at finish only after the approval. Both approvals list
 *   the corrections grouped per page, a large one with its new text, so one
 *   yes covers them all; finish can keep the pages out without a second round.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const read = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8');
/** The file with every run of whitespace collapsed, so a phrase may wrap. */
const flat = (rel: string) => read(rel).replace(/\s+/g, ' ');
const BUILDERS = ['commands/aidlc-turbo-builder.md', 'commands/aidlc-turbo-builder-low.md', 'skills/construction/build-story.md'];

describe('aidlc-turbo: a mismatch is always asked', () => {
  it('intake asks a mismatch as a closed question and never states it back', () => {
    const intake = flat('skills/inception/intake.md');
    expect(intake).toContain('**A mismatch is always asked.**');
    expect(intake).toContain('Never settle one yourself: not by a rule of which source wins, not by stating it back, not by following the code or the page in silence.');
    expect(intake).toContain('A register answer that the code, another page or an answer contradicts is never stated back: it is a mismatch');
    expect(intake).toContain('The answer is a decision with source `user` and a `mismatch`');
    expect(intake).toContain('A statement that agrees with the code and with every other answer is no mismatch');
    expect(intake).not.toContain('Close every conflict between a page and the code');
    // The gate and the write-back know it.
    expect(intake).toContain('Every decision that answers a mismatch has its `mismatch` with `what` and `chosen`');
    expect(intake).toContain('a question from them was answered or a mismatch on one of them decided');
  });

  it('the record carries the mismatch the Jira sync reads', () => {
    const template = read('templates/inception/record-template.yaml');
    expect(template).toMatch(/# mismatch:/);
    for (const key of ['what:', 'chosen:', 'page:', 'story:']) expect(template, key).toMatch(new RegExp(`#\\s+${key}`));
  });

  it('cross-check fixes only a slip of its own draft from the record and asks every mismatch', () => {
    const cc = flat('skills/inception/cross-check.md');
    expect(cc).toContain('**Where asking starts.**');
    expect(cc).toContain('A finding is fixed from the record without a question only when it is a slip of your own draft');
    expect(cc).toContain('`mismatch: true`, or `fix_from_record: false`: ask the user');
    expect(cc).toContain('with its `mismatch` (and `page_fixes`, as there) when the finding was one');
    expect(cc).not.toContain('conflicts fixed from the record');
    for (const rel of ['commands/aidlc-turbo-cross-checker.md', 'commands/aidlc-turbo-docs-verifier.md']) {
      const agent = flat(rel);
      expect(agent, rel).toContain('mismatch: true');
      expect(agent, rel).toContain('A mismatch always has `fix_from_record: false`');
    }
  });

  it('a builder never settles a mismatch by which source comes first, and a coding rule still wins', () => {
    for (const rel of BUILDERS) {
      const text = flat(rel);
      expect(text, rel).toContain('**A mismatch is never yours to settle.**');
      expect(text, rel).toContain('return `blocked` with `notes` starting `Mismatch:`');
      expect(text, rel).toContain('the rule wins, named under Different. That is no mismatch.');
      expect(text, rel).toContain('Only three cases are `blocked`: a mismatch the story rests on');
    }
  });

  it('the reviewers, the live tester, the breaker and the debugger hand a mismatch back', () => {
    const review = flat('skills/construction/review.md');
    expect(review).toContain('a finding with `mismatch: true`');
    expect(review).toContain('A rule the existing code around the change does not keep is no mismatch: the rule is for new code.');
    expect(review).toContain('`mismatch: true` on a finding that shows the story, the brief or a page is wrong, not the code');
    expect(flat('skills/construction/live-test.md')).toContain('add `mismatch` to that check');
    expect(flat('skills/construction/break-test.md')).toContain('with `mismatch`');
    expect(flat('commands/aidlc-turbo-debugger.md')).toContain('mismatch: true');
  });

  it('the construction agent asks every mismatch, records it, and only a story whose code changes waits', () => {
    const dispatch = flat('skills/construction/dispatch.md');
    expect(dispatch).toContain('- **Mismatch**:');
    expect(dispatch).toContain('never settle it by which source comes first');
    expect(dispatch).toContain('(on Claude Code: AskUserQuestion), at most four questions in one prompt');
    expect(dispatch).toContain('The same decision in `record.yaml` under `decisions`');
    expect(dispatch).toContain('`blocked` with `notes` starting `Mismatch:`');
    expect(dispatch).toContain('8. A mismatch');
    const finish = flat('skills/construction/finish.md');
    expect(finish).toContain('ask it as `dispatch` step 4 **Mismatch** says');
    expect(finish).toContain('`record.yaml` when a mismatch answer changed it');
    expect(flat('agents/construction-agent.md')).toContain('A mismatch is always asked');
    expect(flat('agents/inception-agent.md')).toContain('A mismatch is always asked');
  });

  it('Jira gets every mismatch, only at the existing sync moments, never twice', () => {
    const jira = flat('skills/sync/jira.md');
    expect(jira).toContain('mismatches: [D-4]');
    expect(jira).toContain('Never write a mismatch to Jira outside these two moments, and never twice');
    expect(flat('skills/construction/finish.md')).toContain('every mismatch the build decided reaches Jira');
    expect(flat('skills/sync/confluence.md')).toContain('every `page_fixes` entry on this page');
  });

  it('a page found wrong is corrected on Confluence after the one approval, never asked per page', () => {
    const confluence = flat('skills/sync/confluence.md');
    expect(confluence).toContain('## Page corrections');
    expect(confluence).toContain('A correction is small when');
    expect(confluence).toContain('`fixes_only: true`');
    expect(confluence).toContain('`confluence.fixed`');
    expect(confluence).not.toContain('whose choice says the page was wrong');
    expect(read('templates/inception/record-template.yaml')).toMatch(/#\s+page_fixes:/);
    expect(flat('skills/inception/intake.md')).toContain('`page_fixes`');
    expect(flat('skills/construction/dispatch.md')).toContain('`page_fixes`');
    expect(flat('commands/aidlc-turbo-sync.md')).toContain('`fixes_only: true`');
    // One approval covers the corrections, with a way to keep the pages out.
    const finish = flat('skills/construction/finish.md');
    expect(finish).toContain('as `skills/sync/confluence.md` **Page corrections** says');
    expect(finish).toContain('mode `resolve` with `fixes_only: true`, then mode `push`');
    expect(finish).toContain('--file {intent_dir}/overview.html');
    expect(finish).toContain('Never push, open a merge request, correct a page or write to Jira before the user approved the intent in step 8.');
    expect(flat('skills/inception/review.md')).toContain('as `skills/sync/confluence.md` **Page corrections** says');
    expect(flat('README.md')).toContain('corrected on Confluence');
    expect(flat('quick-start.md')).toContain('corrected on Confluence');
  });

  it('writes no em-dash in what it changed', () => {
    const files = [
      'skills/inception/intake.md', 'skills/inception/cross-check.md', 'skills/inception/review.md',
      'skills/construction/dispatch.md', 'skills/construction/review.md', 'skills/construction/finish.md',
      'skills/construction/live-test.md', 'skills/construction/break-test.md',
      'skills/sync/jira.md', 'skills/sync/confluence.md', 'templates/inception/record-template.yaml',
      'agents/inception-agent.md', 'agents/construction-agent.md',
      'commands/aidlc-turbo-cross-checker.md', 'commands/aidlc-turbo-docs-verifier.md', 'commands/aidlc-turbo-debugger.md',
      'commands/aidlc-turbo-sync.md', 'README.md', 'quick-start.md', 'PRD.md', 'skills/master/explain-flow.md',
      ...BUILDERS,
    ];
    for (const rel of files) expect(read(rel), rel).not.toMatch(/\u2014/);
  });
});
