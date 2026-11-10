/**
 * Unit tests for how the AI-DLC Turbo questionnaire looks in the terminal.
 *
 * The questions come in three short blocks (Git, Testing, Sync). Every
 * question fits on one line, so the terminal never has to redraw a wrapped
 * line, and the explanation of a choice sits in its description, shown under
 * the choice the cursor is on. How the app starts and where it answers is
 * never asked: the agent always works that out itself.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

const prompts = require('prompts');
const { turboQuestionSections, promptTurboConfig } = require('../../../lib/flow-config');

const questions = () => turboQuestionSections().flatMap((section: any) => section.questions);
const question = (name: string) => questions().find((q: any) => q.name === name);

describe('AI-DLC Turbo questionnaire layout', () => {
  it('asks in three blocks: Git, Testing, Sync, the last in production only', () => {
    expect(turboQuestionSections().map((section: any) => section.title)).toEqual(['Git', 'Testing', 'Sync']);
    const [git, testing, syncBlock] = turboQuestionSections();
    expect(git.when).toBeUndefined();
    expect(testing.when).toBeUndefined();
    expect(syncBlock.when({ mode: 'production' })).toBe(true);
    expect(syncBlock.when({ mode: 'sandbox' })).toBe(false);
  });

  it('never asks for an Atlassian site and suggests no real one', () => {
    const names = questions().map((q: any) => q.name);
    expect(names).not.toContain('site');
    expect(names).not.toContain('atlassian_site');
    expect(question('jira_project_url').initial).toBe('');
  });

  it('never asks how the app starts or where it answers', () => {
    const names = questions().map((q: any) => q.name);
    expect(names).not.toContain('start_command');
    expect(names).not.toContain('url');
  });

  it('asks for the Jira project link, not the key', () => {
    const names = questions().map((q: any) => q.name);
    expect(names).toContain('jira_project_url');
    expect(names).not.toContain('jira_project');
  });

  it('keeps every question on one short line', () => {
    for (const q of questions().filter((q: any) => q.name !== 'base_branch')) {
      expect(q.message.length, q.name).toBeLessThanOrEqual(40);
    }
    // The base branch says what it is for, and still fits an 80-column line
    // with the prompt marks and the suggestion.
    expect(question('base_branch').message.length).toBeLessThanOrEqual(64);
  });

  it('says what the base branch is for and that a name or a link will do', () => {
    const message = question('base_branch').message;
    expect(message).toMatch(/start/);
    expect(message).toMatch(/merge back/);
    expect(message).toMatch(/name or URL/);
  });

  it('turns a GitLab or GitHub branch link into the branch name', () => {
    const format = question('base_branch').format;
    expect(format('https://gitlab.example.com/acme/shop-web/-/tree/development?ref_type=heads')).toBe('development');
    expect(format('https://gitlab.example.com/group/repo/-/tree/feature%2Flogin/')).toBe('feature/login');
    expect(format('https://github.com/org/repo/tree/release/2.0')).toBe('release/2.0');
    expect(format('  develop ')).toBe('develop');
  });

  it('validates the base branch as typed: a name, a branch link, or Enter', () => {
    const validate = question('base_branch').validate;
    expect(validate('')).toBe(true);
    expect(validate('main')).toBe(true);
    expect(validate('release/2.0')).toBe(true);
    expect(validate('https://gitlab.example.com/acme/shop-web/-/tree/development')).toBe(true);
    expect(validate('https://github.com/org/repo/tree/main')).toBe(true);
    for (const wrong of ['my branch', 'feat..x', '-x', 'a/.b', 'x.lock', 'https://gitlab.example.com/g/r/-/merge_requests/3']) {
      expect(validate(wrong), wrong).toMatch(/branch/);
      expect(String(validate(wrong)).length, wrong).toBeLessThanOrEqual(50);
    }
  });

  it('suggests a branch per story, and keeps No for small pieces of work', () => {
    const q = question('story_branches');
    expect(q.choices.map((c: any) => c.value)).toEqual([true, false]);
    expect(q.initial).toBe(0);
    expect(q.choices[1].description).toMatch(/small pieces of work/);
  });

  it('describes the tester answer without naming Playwright', () => {
    const yes = question('tester').choices.find((c: any) => c.value === true);
    expect(yes.description).toMatch(/test case per story/);
    expect(yes.description).not.toMatch(/Playwright|twin/);
  });

  it('never asks for a test-case language: test cases follow the record\'s language', () => {
    expect(questions().map((q: any) => q.name)).not.toContain('language');
  });

  it('never asks about the live test: it always runs', () => {
    expect(questions().map((q: any) => q.name)).not.toContain('live_test');
  });

  it('describes production without promising one commit per story', () => {
    const yes = question('mode').choices.find((c: any) => c.value === 'production');
    expect(yes.description).not.toMatch(/commit per story/);
    expect(yes.description).toMatch(/merge-request link/);
  });

  it('keeps choice titles short and puts the explanation in the description', () => {
    for (const q of questions().filter((q: any) => Array.isArray(q.choices))) {
      for (const choice of q.choices) {
        expect(choice.title.length, `${q.name}: ${choice.title}`).toBeLessThanOrEqual(20);
        expect(choice.description, `${q.name}: ${choice.title}`).toBeTruthy();
      }
    }
  });

  it('accepts an empty Jira link or a project link, and rejects anything else', () => {
    const validate = question('jira_project_url').validate;
    expect(validate('')).toBe(true);
    expect(validate('https://example.atlassian.net/jira/software/projects/SHOP/boards/12')).toBe(true);
    expect(validate('SHOP')).toMatch(/link/);
    // A message that wraps leaves a broken line on every screen after it.
    expect(validate('SHOP').length).toBeLessThanOrEqual(50);
  });
});

describe('AI-DLC Turbo questionnaire answers', () => {
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

  afterEach(() => {
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
    else delete (process.stdin as any).isTTY;
    vi.restoreAllMocks();
  });

  it('collects the answers of every block into one set', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    prompts.inject([
      'production', 'shop', 'development', true,
      true,
      'confluence', 'jira', 'https://example.atlassian.net/jira/software/projects/SHOP/boards/1',
    ]);

    const answers = await promptTurboConfig();

    expect(answers).toEqual({
      mode: 'production',
      project_key: 'shop',
      base_branch: 'development',
      story_branches: true,
      tester: true,
      sync_docs: 'confluence',
      sync_issues: 'jira',
      jira_project_url: 'https://example.atlassian.net/jira/software/projects/SHOP/boards/1',
    });
    const printed = log.mock.calls.map(call => String(call[0])).join('\n');
    expect(printed).toMatch(/Git/);
    expect(printed).toMatch(/Testing/);
    expect(printed).toMatch(/Sync/);
    expect(printed).toMatch(/Project SHOP on example\.atlassian\.net/);
  });
});
