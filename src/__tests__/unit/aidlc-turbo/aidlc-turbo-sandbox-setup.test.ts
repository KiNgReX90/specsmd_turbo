/**
 * Unit tests for the setup side of the git-based sandbox mode.
 *
 * Sandbox mode used to mean no git at all: one story at a time, no mutants,
 * no breaker, an optional live test and nothing committed. Now sandbox is
 * production without story branches. The only differences:
 * - sandbox never has story branches (`story_branches` is ignored there);
 * - at the end of an intent sandbox does what `branching.sandbox_finish`
 *   says: `push` (the default) puts the intent straight onto the base branch,
 *   `merge_request` pushes the intent branch with one merge request into it.
 * The live test always runs, so the `live_test` setting is gone: the
 * installer no longer asks it or writes it, and an old config that still has
 * it is no error. Turbo needs git in both modes: a folder without git, or a
 * repository without a commit, gets one first commit after the user agrees,
 * at the start of an inception and at construction startup.
 * Inception creates the intent branch and commits the specs in both modes,
 * and the brief documents the one field a push onto the base branch writes,
 * `pushed_to_base`; the commit it pushed lives only in the script's output.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const prompts = require('prompts');
const yaml = require('js-yaml');
const { renderTurboConfig, turboQuestionSections, promptTurboConfig } = require('../../../lib/flow-config');

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const read = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8');
/** The file with every run of whitespace collapsed, so a phrase may wrap. */
const flat = (rel: string) => read(rel).replace(/\s+/g, ' ');
/** A YAML file's comments as running text: the `#` that opens each line is dropped. */
const comments = (rel: string) => read(rel).replace(/\n\s*#\s*/g, ' ').replace(/\s+/g, ' ');

const questions = () => turboQuestionSections().flatMap((section: any) => section.questions);
const question = (name: string) => questions().find((q: any) => q.name === name);
/** The prompt type a question gets after the given answers, null when it is skipped. */
const asked = (name: string, values: object) => {
  const type = question(name).type;
  return typeof type === 'function' ? type(undefined, values) : type;
};

describe('the config the installer writes', () => {
  it('writes branching.sandbox_finish, push by default', () => {
    const parsed = yaml.load(renderTurboConfig({})) as any;
    expect(parsed.branching).toEqual({ project_key: '', base_branch: 'main', story_branches: true, sandbox_finish: 'push' });
  });

  it('writes merge_request when that is the answer, and push for anything else', () => {
    const finish = (answer: unknown) => (yaml.load(renderTurboConfig({ mode: 'sandbox', sandbox_finish: answer } as any)) as any).branching.sandbox_finish;
    expect(finish('merge_request')).toBe('merge_request');
    expect(finish('push')).toBe('push');
    expect(finish('nonsense')).toBe('push');
    expect(finish('')).toBe('push');
  });

  it('writes no live_test block, also when an old answer asks for one', () => {
    for (const answers of [{}, { live_test: false }, { live_test: true, mode: 'sandbox' }]) {
      const rendered = renderTurboConfig(answers as any);
      expect(rendered).not.toMatch(/live_test/);
      expect((yaml.load(rendered) as any).live_test).toBeUndefined();
    }
  });

  it('says what sandbox is, and which branching key each mode reads', () => {
    const rendered = renderTurboConfig({});
    const line = (key: string) => rendered.split('\n').find((l: string) => l.trimStart().startsWith(`${key}:`)) ?? '';
    expect(line('mode')).toMatch(/production \| sandbox/);
    expect(line('mode')).toMatch(/no story branches/);
    expect(line('mode')).toMatch(/base branch/);
    expect(line('mode')).toMatch(/one merge request/);
    expect(line('story_branches')).toMatch(/production only/);
    expect(line('sandbox_finish')).toMatch(/sandbox only/);
    expect(line('sandbox_finish')).toMatch(/push = straight onto the base branch/);
    expect(line('sandbox_finish')).toMatch(/merge_request = one merge request/);
    expect(rendered).not.toMatch(/no git/);
  });
});

describe('the installer questions', () => {
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

  afterEach(() => {
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
    else delete (process.stdin as any).isTTY;
    vi.restoreAllMocks();
  });

  it('never asks about the live test', () => {
    expect(questions().map((q: any) => q.name)).not.toContain('live_test');
  });

  it('describes sandbox as git without story branches, never as no git', () => {
    const sandbox = question('mode').choices.find((c: any) => c.value === 'sandbox');
    expect(sandbox.description).not.toMatch(/no git/);
    expect(sandbox.description).toMatch(/branch per story/);
    expect(sandbox.description).toMatch(/base branch/);
  });

  it('asks the finish choice right after the sandbox parts, and only in sandbox', () => {
    const git = turboQuestionSections()[0].questions.map((q: any) => q.name);
    expect(git.indexOf('sandbox_finish')).toBe(git.indexOf('mode') + 3);
    expect(asked('sandbox_finish', { mode: 'sandbox' })).toBe('select');
    expect(asked('sandbox_finish', { mode: 'production' })).toBeNull();
    const q = question('sandbox_finish');
    expect(q.choices.map((c: any) => c.value)).toEqual(['push', 'merge_request']);
    expect(q.initial).toBe(0);
    expect(q.message.length).toBeLessThanOrEqual(40);
    expect(q.choices[0].description).toMatch(/base branch/);
    expect(q.choices[1].description).toMatch(/one merge request/);
  });

  it('asks the branch prefix and the base branch in both modes, a branch per story only in production', () => {
    for (const mode of ['production', 'sandbox']) {
      expect(asked('project_key', { mode }), mode).toBe('text');
      expect(asked('base_branch', { mode }), mode).toBe('text');
    }
    expect(asked('story_branches', { mode: 'production' })).toBe('select');
    expect(asked('story_branches', { mode: 'sandbox' })).toBeNull();
  });

  it('collects the sandbox answers: the finish choice, the prefix and the base branch, no branch per story, no sync', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    prompts.inject(['sandbox', true, true, 'merge_request', 'shop', 'develop', false]);

    const answers = await promptTurboConfig();

    expect(answers).toEqual({
      mode: 'sandbox',
      code_scaffold: true,
      scaffold_after_build: true,
      sandbox_finish: 'merge_request',
      project_key: 'shop',
      base_branch: 'develop',
      tester: false,
    });
    // The Sync block is not shown at all in sandbox mode.
    const printed = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed).toMatch(/Testing/);
    expect(printed).not.toMatch(/Sync/);
    const parsed = yaml.load(renderTurboConfig(answers)) as any;
    expect(parsed.mode).toBe('sandbox');
    expect(parsed.branching).toMatchObject({ project_key: 'shop', base_branch: 'develop', sandbox_finish: 'merge_request' });
    expect(parsed.sandbox).toEqual({ code_scaffold: true, scaffold_after_build: true });
    expect(parsed.sync).toEqual({ docs: 'none', issues: 'none' });
  });

  it('asks the sync questions in production only, and a sandbox config syncs with nothing', () => {
    const syncBlock = turboQuestionSections().find((section: any) => section.title === 'Sync');
    expect(syncBlock.when({ mode: 'production' })).toBe(true);
    expect(syncBlock.when({ mode: 'sandbox' })).toBe(false);
    const parsed = yaml.load(renderTurboConfig({ mode: 'sandbox', sync_docs: 'confluence', sync_issues: 'jira' })) as any;
    expect(parsed.sync).toEqual({ docs: 'none', issues: 'none' });
  });

  it('asks only the two sandbox parts: the Code Scaffold and its update after the build', () => {
    const names = questions().map((q: any) => q.name);
    expect(names).not.toContain('functional_design');
    expect(asked('code_scaffold', { mode: 'sandbox' })).toBe('select');
    expect(asked('code_scaffold', { mode: 'production' })).toBeNull();
    expect(asked('scaffold_after_build', { mode: 'sandbox', code_scaffold: false })).toBeNull();
    const parsed = yaml.load(renderTurboConfig({ mode: 'sandbox', code_scaffold: false, scaffold_after_build: true })) as any;
    expect(parsed.sandbox).toEqual({ code_scaffold: false, scaffold_after_build: false });
    expect((yaml.load(renderTurboConfig({})) as any).sandbox).toBeUndefined();
  });
});

describe('the config template and the config command', () => {
  it('the template documents sandbox_finish and has no live_test block', () => {
    const example = yaml.load(read('templates/config.example.yaml')) as any;
    expect(example.branching.sandbox_finish).toBe('push');
    expect(example.live_test).toBeUndefined();
    const text = comments('templates/config.example.yaml');
    expect(text).not.toMatch(/no git at all/);
    expect(text).not.toMatch(/Only used in production mode/);
    expect(text).toMatch(/push = when the intent is finished, it goes straight onto the base branch/);
    expect(text).toMatch(/merge_request = the intent branch is pushed with one merge request into the base branch/);
    expect(text).toMatch(/The live test always runs/);
  });

  it('the config command offers the two finish choices, push first', () => {
    const config = read('commands/aidlc-turbo-config.md');
    const push = config.indexOf('**Push to the base branch**');
    const mr = config.indexOf('**One merge request into the base branch**');
    expect(push).toBeGreaterThan(-1);
    expect(mr).toBeGreaterThan(push);
    expect(config).toContain('`branching.sandbox_finish`');
  });

  it('the config command has no live-test setting and no git-free sandbox', () => {
    const config = flat('commands/aidlc-turbo-config.md');
    expect(config).not.toContain('**Live test at the end**');
    expect(config).not.toMatch(/no git at all/);
    expect(config).not.toMatch(/Skip the branching questions in sandbox mode/);
    expect(config).toContain('Drop a `live_test` block from an older file');
    // The tag at the end of each setting's own bullet, never the next one's.
    const tag = (label: string) => config.match(new RegExp(`\\*\\*${label}\\*\\*(?:(?! - \\*\\*).)*?\\*\\(([^)]*)\\)\\*`))?.[1];
    expect(tag('Mutants per story')).toBe('default: 3');
    expect(tag('Branch prefix')).toBe('both modes, default: empty');
    expect(tag('Base branch')).toBe('both modes, default: `main`');
    expect(tag('A branch per story')).toBe('production only, default: yes');
  });

  it('memory-bank.yaml names sandbox_finish, no live_test setting, and the intent branch in both modes', () => {
    const bank = yaml.load(read('memory-bank.yaml')) as any;
    const fields = Object.assign({}, ...bank.flow_config.fields);
    expect(fields.live_test).toBeUndefined();
    expect(fields.branching).toMatch(/sandbox_finish/);
    expect(bank.naming.branches.note).not.toMatch(/Production mode only/);
    expect(bank.naming.story_branches.note).toMatch(/production/i);
  });
});

describe('inception in both modes', () => {
  it('review creates the intent branch and commits the specs in both modes', () => {
    const review = read('skills/inception/review.md');
    expect(review).toContain('### 6. Branch and commit');
    expect(review).not.toMatch(/Production mode: branch and commit/);
    expect(review).not.toMatch(/Sandbox never touches version control/);
    expect(review).not.toMatch(/no branch, no commits/);
    expect(review).not.toMatch(/\*\*Production mode, first\*\*/);
  });

  it('the brief keeps the branch in both modes and documents the push onto the base branch', () => {
    const brief = read('templates/inception/brief-template.md');
    const row = (field: string) => brief.split('\n').find((l) => l.startsWith(`| \`${field}\` |`)) ?? '';
    expect(row('branch')).not.toMatch(/sandbox/);
    expect(row('pushed_to_base')).toMatch(/push-branch\.cjs/);
    expect(row('pushed_to_base')).toMatch(/sandbox_finish: push/);
    // The commit sha lives only in push-branch.cjs's output, never in the brief.
    expect(brief).not.toMatch(/pushed_commit/);
  });

  it('a story has a commit in both modes, and the breaker is no production-only step', () => {
    const story = read('templates/inception/story-template.md');
    const row = (field: string) => story.split('\n').find((l) => l.startsWith(`| \`${field}\` |`)) ?? '';
    expect(row('commit')).not.toMatch(/sandbox/);
    expect(row('break_test')).not.toMatch(/In production/);
    expect(read('skills/inception/plan.md')).not.toMatch(/In production, finish lets the breaker/);
    expect(read('templates/inception/record-template.yaml')).not.toMatch(/production finish lets the breaker/);
  });
});

describe('a folder without git', () => {
  const CHECK = 'skills/master/git-check.md';

  it('the git check asks in the session language, makes the repository and its one first commit', () => {
    expect(existsSync(path.join(FLOW, CHECK))).toBe(true);
    const check = read(CHECK);
    expect(check).toContain('git rev-parse --show-toplevel');
    expect(check).toContain('prints another folder (the project sits inside another repository');
    expect(check).toContain('git rev-parse --verify --quiet HEAD');
    expect(check).toMatch(/AskUserQuestion/);
    expect(check).toContain('in the language the user speaks in this session');
    const yes = check.indexOf('**Make it a git repository**');
    const stop = check.indexOf('**Stop**');
    expect(yes).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(yes);
    expect(check).toContain('git init -b {base_branch}');
    expect(check).toContain('git status --short');
    expect(check).toContain('git add -A');
    expect(check).toContain('git commit -m "chore: start the repository"');
    expect(check).toContain('the only place the flow runs `git add -A`');
    expect(check).toMatch(/no remote/);
  });

  it('the inception start and the master analysis run it, and the branch line is no sandbox excuse', () => {
    for (const rel of ['agents/inception-agent.md', 'commands/aidlc-turbo-inception.md', 'skills/master/analyze-context.md', 'agents/master-agent.md']) {
      expect(read(rel), rel).toContain('.specsmd/aidlc-turbo/skills/master/git-check.md');
    }
    const analyze = read('skills/master/analyze-context.md');
    expect(analyze).not.toContain('none (sandbox)');
    expect(analyze).not.toMatch(/`done` intent in production mode/);
  });
});

describe('the docs describe the new sandbox once and plainly', () => {
  const OWNED = [
    'README.md', 'PRD.md', 'quick-start.md', 'memory-bank.yaml', 'templates/config.example.yaml',
    'agents/master-agent.md', 'agents/inception-agent.md',
    'commands/aidlc-turbo.md', 'commands/aidlc-turbo-config.md', 'commands/aidlc-turbo-inception.md',
    'skills/master/analyze-context.md', 'skills/master/answer-question.md', 'skills/master/explain-flow.md',
    'skills/master/project-init.md', 'skills/master/route-request.md',
    'skills/inception/intake.md', 'skills/inception/plan.md', 'skills/inception/review.md',
    'templates/inception/brief-template.md', 'templates/inception/story-template.md',
    'templates/inception/record-template.yaml',
  ];
  const OLD = [
    /no git at all/i,
    /sandbox[^.]*one at a time/i,
    /one at a time[^.]*sandbox/i,
    /sandbox (mode )?(has|touches) (no )?git/i,
    /live_test\.enabled/,
    /in sandbox when enabled/i,
    /with the live test on/i,
    /\(sandbox only, default: yes\)/,
    /breaker[^.]*in production\b/i,
    /in production[^.]*breaker/i,
  ];

  it('no owned file still describes the old sandbox', () => {
    const offenders = OWNED.flatMap((rel) => OLD.filter((re) => re.test(flat(rel))).map((re) => `${rel}: ${re}`));
    expect(offenders).toEqual([]);
  });

  it('the README config block has sandbox_finish and no live_test', () => {
    const readme = read('README.md');
    const block = readme.slice(readme.indexOf('```yaml'), readme.indexOf('```', readme.indexOf('```yaml') + 7));
    expect(block).toMatch(/^ {2}sandbox_finish: push/m);
    expect(block).not.toMatch(/live_test/);
  });

  it('README, quick start and explain-flow say sandbox is production without story branches', () => {
    for (const rel of ['README.md', 'quick-start.md', 'skills/master/explain-flow.md', 'PRD.md']) {
      expect(flat(rel), rel).toMatch(/production without story branches/);
    }
  });

  it('the live test always runs, and the breaker in both modes', () => {
    expect(flat('README.md')).toContain('**The live test** runs at the end of every intent');
    expect(flat('quick-start.md')).toContain('a fresh agent starts the app and tries every acceptance criterion a user can see');
    expect(flat('PRD.md')).toContain('| `live-tester` | subagent | Sonnet, high | The live test at finish, in both modes. |');
  });
});
