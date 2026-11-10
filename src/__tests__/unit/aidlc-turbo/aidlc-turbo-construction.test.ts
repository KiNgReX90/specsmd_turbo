/**
 * Unit tests for the aidlc-turbo construction flow files.
 *
 * Construction runs through scripts and pinned agents. These guards keep the
 * flow files in line with that design:
 * - Every construction role has its own agent file with a pinned model and
 *   effort, and the read-only roles cannot write.
 * - The two builders share one body, and build-story.md, the inline procedure
 *   for hosts without subagents, uses the same step headings.
 * - No builder calls a skill: the TDD loop is written out in the body.
 * - The construction agent claims, verifies and lands through the scripts,
 *   never by hand, and follows the escalation ladder.
 * - Finish keeps its order: verification, live test, break test, intent
 *   review, fix loop, test cases, and the application stays running until the
 *   end. The live test always runs, in both modes; the breaker attacks only
 *   the stories inception marked with break_test, never in the quick lane.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const read = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8');
const frontmatter = (rel: string) => read(rel).split(/^---\s*$/m)[1] ?? '';
const body = (rel: string) => read(rel).split(/^---\s*$/m).slice(2).join('---');
const headings = (text: string) => text.split('\n').filter((l) => /^## /.test(l));

describe('aidlc-turbo construction agents', () => {
  it.each([
    ['commands/aidlc-turbo-builder.md', 'claude-opus-5-5', 'high', 'Read, Write, Edit, MultiEdit, Bash, Grep, Glob, TodoWrite, LSP'],
    ['commands/aidlc-turbo-builder-low.md', 'claude-sonnet-5-5', 'high', 'Read, Write, Edit, MultiEdit, Bash, Grep, Glob, TodoWrite, LSP'],
    ['commands/aidlc-turbo-reviewer.md', 'claude-opus-5-5', 'high', 'Read, Grep, Glob, Bash, LSP'],
    ['commands/aidlc-turbo-intent-reviewer.md', 'claude-opus-5-5', 'xhigh', 'Read, Grep, Glob, Bash, LSP'],
    ['commands/aidlc-turbo-debugger.md', 'claude-opus-5-5', 'high', 'Read, Grep, Glob, Bash, LSP'],
    ['commands/aidlc-turbo-test-writer.md', 'claude-sonnet-5-5', 'high', 'Read, Write, Edit, Bash, Grep, Glob'],
    ['commands/aidlc-turbo-live-tester.md', 'claude-sonnet-5-5', 'high', 'Read, Write, Bash, Grep, Glob'],
    ['commands/aidlc-turbo-breaker.md', 'claude-opus-5-5', 'high', 'Read, Write, Bash'],
  ])('%s pins %s at effort %s with its tools', (rel, model, effort, tools) => {
    const fm = frontmatter(rel);
    expect(fm).toMatch(new RegExp(`^model: ${model}$`, 'm'));
    expect(fm).toMatch(new RegExp(`^effort: ${effort}$`, 'm'));
    expect(fm).toMatch(new RegExp(`^tools: ${tools}$`, 'm'));
    expect(fm).not.toMatch(/omitClaudeMd/);
  });

  it('the two builders share one body and build-story.md uses its step headings', () => {
    expect(body('commands/aidlc-turbo-builder-low.md')).toBe(body('commands/aidlc-turbo-builder.md'));
    const builder = headings(body('commands/aidlc-turbo-builder.md'));
    expect(builder).toContain('## Fix mode');
    expect(headings(read('skills/construction/build-story.md'))).toEqual(builder);
  });

  it('no builder calls a skill, and builders never read the source pages', () => {
    for (const rel of ['commands/aidlc-turbo-builder.md', 'skills/construction/build-story.md']) {
      const text = read(rel);
      expect(text).not.toMatch(/superpowers/);
      expect(text).toContain('Never read `.specs-aidlc-turbo/docs/{inception}/pages/`, `register.yaml`');
      expect(text).toContain('**Stop once both pass.**');
    }
  });

  it('the reviewers never rerun the suite and never write', () => {
    const review = read('skills/construction/review.md');
    expect(review).toContain('**Never rerun the suite**');
    expect(review).not.toMatch(/rerun the verification commands yourself/i);
    expect(review).toContain('Never a new `minor` on a line the fix did not change.');
    for (const rel of ['commands/aidlc-turbo-reviewer.md', 'commands/aidlc-turbo-intent-reviewer.md']) {
      expect(read(rel)).toContain('Never edit or write a file');
    }
  });

  it('the debugger returns a plan or a stop and never edits', () => {
    const debuggerFile = read('commands/aidlc-turbo-debugger.md');
    expect(debuggerFile).toContain('verdict: plan');
    expect(debuggerFile).toContain('verdict: stop');
    expect(debuggerFile).toMatch(/root_cause:/);
    expect(debuggerFile).toMatch(/steps:/);
    expect(debuggerFile).toMatch(/question:/);
  });
});

describe('aidlc-turbo construction loop', () => {
  it('dispatch starts, verifies and lands every story through the scripts', () => {
    const dispatch = read('skills/construction/dispatch.md');
    expect(dispatch).toContain('story-start.cjs {intent} {SSS}');
    expect(dispatch).toContain('story-verify.cjs {intent} {SSS} --code-root {worktree}');
    expect(dispatch).toContain('story-land.cjs {intent} {SSS} --changed-files');
    expect(dispatch).not.toMatch(/git cherry-pick|git commit -m/);
  });

  it('dispatch carries the escalation ladder', () => {
    const dispatch = read('skills/construction/dispatch.md');
    expect(dispatch).toContain('| `pass` with minors only | Builder fix mode with the minors, verify, land. No second review, never a miss |');
    expect(dispatch).toContain('| Miss 2 | `specsmd-aidlc-turbo-debugger`.');
    expect(dispatch).toContain('| Miss 3 | The story is blocked |');
    expect(dispatch).toContain('**Fix mode** always goes to `specsmd-aidlc-turbo-builder`, also for a low story.');
    expect(dispatch).toContain('`## Lessons`');
  });

  it('the construction agent reads only the status JSON, never compacts and retries Sonnet on Opus once', () => {
    const agent = read('agents/construction-agent.md');
    expect(agent).toContain('intent-status.cjs {intent} --json');
    expect(agent).toContain('Never run `/compact` and never switch model mid-run');
    expect(agent).toContain('`model: opus` override');
  });

  it('finish keeps its order and the application runs until the end', () => {
    const finish = read('skills/construction/finish.md');
    const order = ['### 1. Full verification', '### 2. Live test', '### 3. Break test', '### 4. Intent review', '### 5. Fix loop',
      '### 6. Test cases', '### 8. Overview', '### 9. Ship', '### 10. Jira', '### 11. Stop the application', '### 12. Summary'];
    const at = order.map((h) => finish.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(finish).toContain('**stays running for the rest of finish**');
    expect(finish).toContain('`specsmd-aidlc-turbo-test-writer`');
    expect(finish).toContain('`specsmd-aidlc-turbo-sync`');
    expect(read('skills/construction/test-cases.md')).toContain('**Never start the application**');
    expect(read('skills/construction/test-cases.md')).not.toMatch(/general-purpose/);
    expect(read('skills/construction/live-test.md')).not.toMatch(/general-purpose/);
  });

  it('both modes always test live, then the breaker attacks the marked stories, before the intent review', () => {
    const finish = read('skills/construction/finish.md');
    const live = finish.slice(finish.indexOf('### 2. Live test'), finish.indexOf('### 3. Break test'));
    expect(live).toContain('**The live test always runs**, in sandbox mode as in production');
    expect(live).not.toMatch(/unless `live_test\.enabled`/);
    const brk = finish.slice(finish.indexOf('### 3. Break test'), finish.indexOf('### 4. Intent review'));
    expect(brk).toContain('`specsmd-aidlc-turbo-breaker`');
    expect(brk).toContain('`break_test: true`');
    expect(brk).toContain('`brief.lane: quick`');
    expect(brk).not.toMatch(/sandbox/i);
    expect(brk).toContain('`mode: recheck`');

    const skill = read('skills/construction/break-test.md');
    expect(skill).toContain('**At most 10 attacks per story.**');
    expect(skill).toContain('Never read the source code');
    expect(skill).toMatch(/verdict: fail/);
    const agent = read('commands/aidlc-turbo-breaker.md');
    expect(agent).toContain('.specsmd/aidlc-turbo/skills/construction/break-test.md');
    expect(agent).toContain('Never read the source code');

    const plan = read('skills/inception/plan.md');
    expect(plan).toContain('| `break_test` |');
    expect(read('templates/inception/story-template.md')).toContain('| `break_test` |');
  });
});
