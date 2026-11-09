/**
 * Unit tests for story-start.cjs of the AI-DLC Turbo flow, on throwaway git repos.
 *
 * story-start claims a story and prints what its builder needs:
 * - it refuses a story that is not todo, or whose depends_on are not done;
 *   --resume reuses the worktree of a story already building;
 * - production mode: a worktree outside the project on the build branch, the
 *   intent branch with its last part swapped for build-{SSS}; a leftover build
 *   branch of a fresh start is removed first, unless it holds work (uncommitted
 *   changes, or commits beyond its base), which is an error and removes nothing;
 * - story branches: the story's own branch, stacked on the dependency built
 *   last, the other dependencies merged in; a merge conflict is a human stop
 *   that keeps the worktree;
 * - sandbox mode: exactly production with story branches off, also when the
 *   config turns story branches on;
 * - the builder type follows complexity, data-stack.md only with db_tables.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/story-start.cjs');
const start = createRequire(import.meta.url)(SCRIPT);

const bases: string[] = [];
afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

type Story = Record<string, string>;
const INTENT = 'shop/intent-auth/intent';

/** A git project with the auth intent on its intent branch; worktrees land next to it. */
function project(stories: Record<string, Story>, config = 'mode: production\nbranching:\n  project_key: shop\n  story_branches: false\n') {
  const base = mkdtempSync(path.join(tmpdir(), 'turbo-start-'));
  bases.push(base);
  const app = path.join(base, 'app');
  const specs = path.join(app, '.specs-aidlc-turbo');
  const intent = path.join(specs, 'docs/auth/auth');
  mkdirSync(path.join(intent, 'stories'), { recursive: true });
  mkdirSync(path.join(specs, 'repo/standards'), { recursive: true });
  writeFileSync(path.join(specs, 'repo/config.yaml'), config);
  writeFileSync(path.join(specs, 'repo/standards/coding-standards.md'), '# Coding\n');
  writeFileSync(path.join(specs, 'repo/standards/data-stack.md'), '# Data\n');
  writeFileSync(path.join(intent, 'brief.md'), [
    '---', 'id: auth', 'title: Auth', 'status: approved', `branch: ${INTENT}`, '---', '',
    '## Verification', '', '- **Test**: `node test.js`', '',
  ].join('\n'));
  for (const [id, fm] of Object.entries(stories)) {
    const lines = Object.entries({ id: `"${id}"`, title: `T${id}`, status: 'todo', depends_on: '[]', db_tables: '[]', touches: '[src/app.txt]', branch: 'null', ...fm })
      .map(([k, v]) => `${k}: ${v}`);
    writeFileSync(path.join(intent, 'stories', `${id}-s${id}.md`), ['---', ...lines, '---', '', `# S${id}`, ''].join('\n'));
  }
  mkdirSync(path.join(app, 'src'));
  writeFileSync(path.join(app, 'src/app.txt'), 'one\ntwo\nthree\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: app, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('switch', '-q', '-c', INTENT);
  return { base, app, intent, git, file: (id: string) => path.join(intent, 'stories', `${id}-s${id}.md`) };
}

const status = (file: string) => readFileSync(file, 'utf8').match(/^status: (.*)$/m)?.[1];
const setFm = (file: string, key: string, value: string) =>
  writeFileSync(file, readFileSync(file, 'utf8').replace(new RegExp(`^${key}: .*$`, 'm'), `${key}: ${value}`));

describe('aidlc-turbo story-start, production mode', () => {
  const p = project({
    '001': { complexity: 'low' },
    '002': { depends_on: '["001"]', complexity: 'hard', db_tables: '[users]' },
  });
  const wt = path.join(p.base, 'app-turbo/auth/story-001');

  it('claims the story, creates the worktree on the build branch and prints the builder input', () => {
    const out = start.startStory({ intentSlug: 'auth', storyId: '1', cwd: p.app });
    expect(out.error).toBeUndefined();
    expect(out).toMatchObject({
      story: '001', slug: 's001', worktree: wt, branch: 'shop/intent-auth/build-001', base: INTENT,
      builder: 'specsmd-aidlc-turbo-builder-low', verification: ['node test.js'], touches: ['src/app.txt'],
      file: p.file('001'), brief: path.join(p.intent, 'brief.md'),
    });
    expect(out.standards).toEqual([path.join(p.app, '.specs-aidlc-turbo/repo/standards/coding-standards.md')]);
    expect(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('shop/intent-auth/build-001');
    expect(status(p.file('001'))).toBe('building');
    expect(status(path.join(p.intent, 'brief.md'))).toBe('building');
  });

  it('refuses a story that is not todo, and a story whose dependency is not done', () => {
    expect(start.startStory({ intentSlug: 'auth', storyId: '001', cwd: p.app }).error).toContain('has status "building"');
    expect(start.startStory({ intentSlug: 'auth', storyId: '002', cwd: p.app }).error).toBe('depends_on not done: 001');
  });

  it('--resume reuses the worktree and keeps the half work', () => {
    writeFileSync(path.join(wt, 'src/half.txt'), 'half\n');
    const out = start.startStory({ intentSlug: 'auth', storyId: '001', resume: true, cwd: p.app });
    expect(out).toMatchObject({ worktree: wt, resumed: true });
    expect(existsSync(path.join(wt, 'src/half.txt'))).toBe(true);
  });

  it('a fresh start never throws away work left in the old worktree or build branch', () => {
    setFm(p.file('001'), 'status', 'todo');
    const dirty = start.startStory({ intentSlug: 'auth', storyId: '001', cwd: p.app });
    expect(dirty.error).toContain(`the old worktree ${wt} holds uncommitted work`);
    expect(dirty.error).toContain('--resume');
    expect(existsSync(path.join(wt, 'src/half.txt'))).toBe(true);

    execFileSync('git', ['add', '-A'], { cwd: wt });
    execFileSync('git', ['commit', '-q', '-m', 'half'], { cwd: wt });
    const ahead = start.startStory({ intentSlug: 'auth', storyId: '001', cwd: p.app });
    expect(ahead.error).toContain('the old branch shop/intent-auth/build-001 has 1 commit(s) beyond');
    expect(p.git('branch', '--list', 'shop/intent-auth/build-001')).toContain('build-001');
  });

  it('a fresh start removes a leftover worktree and build branch that hold no work', () => {
    execFileSync('git', ['reset', '-q', '--hard', INTENT], { cwd: wt });
    const out = start.startStory({ intentSlug: 'auth', storyId: '001', cwd: p.app });
    expect(out.error).toBeUndefined();
    expect(existsSync(path.join(wt, 'src/half.txt'))).toBe(false);
  });

  it('picks the full builder and the data stack from the story', () => {
    setFm(p.file('001'), 'status', 'done');
    const out = start.startStory({ intentSlug: 'auth', storyId: '002', cwd: p.app });
    expect(out.builder).toBe('specsmd-aidlc-turbo-builder');
    expect(out.standards.map((f: string) => path.basename(f))).toEqual(['coding-standards.md', 'data-stack.md']);
  });

  it('prints JSON and exits 1 on a refusal, 2 on a usage error', () => {
    const r = spawnSync('node', [SCRIPT, 'auth', '002'], { cwd: p.app, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).error).toContain('has status "building"');
    expect(spawnSync('node', [SCRIPT, 'auth'], { cwd: p.app, encoding: 'utf8' }).status).toBe(2);
  });
});

describe('aidlc-turbo story-start, story branches', () => {
  const p = project({
    '001': {},
    '002': {},
    '003': { depends_on: '["001", "002"]' },
  }, 'mode: production\nbranching:\n  project_key: shop\n  story_branches: true # stacked\n');

  /** Give a story its own branch with one commit that sets line two of src/app.txt. */
  function doneOnBranch(id: string, line: string) {
    const branch = `shop/intent-auth/story-${id}-s${id}`;
    p.git('switch', '-q', '-c', branch, INTENT);
    writeFileSync(path.join(p.app, 'src/app.txt'), `one\n${line}\nthree\n`);
    p.git('commit', '-q', '-m', `S${id}`, '--', 'src/app.txt');
    p.git('switch', '-q', INTENT);
    setFm(p.file(id), 'status', 'done');
    setFm(p.file(id), 'branch', branch);
    return branch;
  }

  it('starts a story without dependencies on its own branch from the intent branch', () => {
    const out = start.startStory({ intentSlug: 'auth', storyId: '001', cwd: p.app });
    expect(out).toMatchObject({ branch: 'shop/intent-auth/story-001-s001', base: INTENT, story_branches: true });
    execFileSync('git', ['worktree', 'remove', '--force', out.worktree], { cwd: p.app });
    setFm(p.file('001'), 'status', 'todo');
  });

  it('stacks on the last dependency and stops on a merge conflict, keeping the worktree', () => {
    p.git('branch', '-q', '-D', 'shop/intent-auth/story-001-s001');
    doneOnBranch('001', 'two-001');
    const b2 = doneOnBranch('002', 'two-002');
    const out = start.startStory({ intentSlug: 'auth', storyId: '003', cwd: p.app });
    expect(out.error).toContain('conflicts: a human stop');
    expect(out.conflicts).toEqual(['src/app.txt']);
    expect(existsSync(out.worktree)).toBe(true);
    expect(status(p.file('003'))).toBe('building');
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: out.worktree, encoding: 'utf8' }).trim()).toBe('');
    expect(b2).toBe('shop/intent-auth/story-002-s002');
  });
});

describe('aidlc-turbo story-start, stacked without a conflict', () => {
  const p = project({ '001': {}, '002': {}, '003': { depends_on: '["001", "002"]' } },
    'mode: production\nbranching:\n  story_branches: true\n');

  it('starts on the branch of the dependency built last and merges the other in', () => {
    for (const [id, text] of [['001', 'ONE\ntwo\nthree\n'], ['002', 'one\ntwo\nTHREE\n']]) {
      const branch = `shop/intent-auth/story-${id}-s${id}`;
      p.git('switch', '-q', '-c', branch, INTENT);
      writeFileSync(path.join(p.app, 'src/app.txt'), text);
      p.git('commit', '-q', '-m', `S${id}`, '--', 'src/app.txt');
      p.git('switch', '-q', INTENT);
      setFm(p.file(id), 'status', 'done');
      setFm(p.file(id), 'branch', branch);
    }
    const out = start.startStory({ intentSlug: 'auth', storyId: '003', cwd: p.app });
    expect(out.error).toBeUndefined();
    expect(out).toMatchObject({ branch: 'shop/intent-auth/story-003-s003', base: 'shop/intent-auth/story-002-s002' });
    expect(readFileSync(path.join(out.worktree, 'src/app.txt'), 'utf8')).toBe('ONE\ntwo\nTHREE\n');
  });
});

describe('aidlc-turbo story-start, sandbox mode', () => {
  // Sandbox is production with story branches off: story_branches in the config is ignored.
  const p = project({ '001': {} }, 'mode: sandbox\nbranching:\n  project_key: shop\n  story_branches: true\n');
  const wt = path.join(p.base, 'app-turbo/auth/story-001');

  it('creates the worktree on the build branch, never a story branch, and has no sandbox note', () => {
    const out = start.startStory({ intentSlug: 'auth', storyId: '001', cwd: p.app });
    expect(out.error).toBeUndefined();
    expect(out).toMatchObject({
      story: '001', worktree: wt, branch: 'shop/intent-auth/build-001', base: INTENT, mode: 'sandbox', story_branches: false,
    });
    expect(out.note).toBeUndefined();
    expect(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('shop/intent-auth/build-001');
    expect(p.git('branch', '--list', 'shop/intent-auth/story-*')).toBe('');
    expect(status(p.file('001'))).toBe('building');
  });

  it('needs the intent branch in the brief, as production does', () => {
    setFm(p.file('001'), 'status', 'todo');
    setFm(path.join(p.intent, 'brief.md'), 'branch', 'null');
    expect(start.startStory({ intentSlug: 'auth', storyId: '001', cwd: p.app }).error).toContain('the brief has no branch yet');
  });
});

describe('aidlc-turbo story-start, the project\'s rules', () => {
  const p = project({ '001': {} }, 'mode: sandbox\n');
  const specs = path.join(p.app, '.specs-aidlc-turbo');
  for (const f of ['system-architecture.md', 'api-conventions.md', 'ux-guide.md', 'tech-stack.md']) {
    writeFileSync(path.join(specs, 'repo/standards', f), `# ${f}\n`);
  }
  mkdirSync(path.join(specs, 'project/pages/conventions'), { recursive: true });
  writeFileSync(path.join(specs, 'project/pages/index.md'), '# Project Documentation\n');
  writeFileSync(path.join(specs, 'project/pages/conventions/coding-standards.md'), '# Coding standards\n');

  it('gives the builder every standard on how to write the code, and the whole Project Documentation for the docs review', () => {
    const out = start.startStory({ intentSlug: 'auth', storyId: '001', cwd: p.app });
    expect(out.error).toBeUndefined();
    expect(out.standards.map((f: string) => path.basename(f)))
      .toEqual(['coding-standards.md', 'system-architecture.md', 'api-conventions.md', 'ux-guide.md']);
    expect(out.project_docs.index).toBe(path.join(specs, 'project/pages/index.md'));
    expect(out.project_docs.batches.map((b: string[]) => b.map((f) => path.relative(specs, f)))).toEqual([[
      'repo/standards/api-conventions.md', 'repo/standards/coding-standards.md', 'repo/standards/data-stack.md',
      'repo/standards/system-architecture.md', 'repo/standards/tech-stack.md', 'repo/standards/ux-guide.md',
      'project/pages/conventions/coding-standards.md',
    ]]);
  });
});

describe('aidlc-turbo story-start helpers', () => {
  it('reads nested config values and ignores comments', () => {
    expect(start.parseYamlMap('mode: production # m\nbranching:\n  project_key: "shop"\n  story_branches: true\ntester:\n  enabled: false\n'))
      .toEqual({ mode: 'production', branching: { project_key: 'shop', story_branches: true }, tester: { enabled: false } });
  });

  it('takes story branches as on unless the config turns them off', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'turbo-settings-'));
    bases.push(dir);
    expect(start.readSettings(dir).storyBranches).toBe(true);
    mkdirSync(path.join(dir, '.specs-aidlc-turbo', 'repo'), { recursive: true });
    const config = path.join(dir, '.specs-aidlc-turbo', 'repo', 'config.yaml');
    writeFileSync(config, 'mode: production\nbranching:\n  project_key: shop\n');
    expect(start.readSettings(path.join(dir, '.specs-aidlc-turbo')).storyBranches).toBe(true);
    writeFileSync(config, 'mode: production\nbranching:\n  story_branches: false\n');
    expect(start.readSettings(path.join(dir, '.specs-aidlc-turbo')).storyBranches).toBe(false);
  });

  it('has no story branches in sandbox mode and reads the sandbox finish', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'turbo-settings-'));
    bases.push(dir);
    const root = path.join(dir, '.specs-aidlc-turbo');
    mkdirSync(path.join(root, 'repo'), { recursive: true });
    const config = path.join(root, 'repo', 'config.yaml');
    writeFileSync(config, 'mode: sandbox\nbranching:\n  project_key: shop\n  base_branch: develop\n  story_branches: true\n');
    expect(start.readSettings(root)).toEqual({
      mode: 'sandbox', storyBranches: false, projectKey: 'shop', baseBranch: 'develop', sandboxFinish: 'push',
      codeScaffold: true, scaffoldAfterBuild: true,
    });
    writeFileSync(config, 'mode: sandbox\nbranching:\n  sandbox_finish: merge_request\n');
    expect(start.readSettings(root).sandboxFinish).toBe('merge_request');
    writeFileSync(config, 'mode: sandbox\nbranching:\n  sandbox_finish: rebase\n');
    expect(start.readSettings(root).sandboxFinish).toBe('push');
    // The brief's mode snapshot wins over the config.
    writeFileSync(config, 'mode: sandbox\nbranching:\n  story_branches: true\n');
    expect(start.readSettings(root, { mode: 'production' })).toMatchObject({ mode: 'production', storyBranches: true });
    expect(start.readSettings(root, { mode: 'sandbox' })).toMatchObject({ mode: 'sandbox', storyBranches: false });
  });

  it('reads the sandbox parts in sandbox only, each on unless it says false, and no update after the build without the scaffold', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'turbo-settings-'));
    bases.push(dir);
    const root = path.join(dir, '.specs-aidlc-turbo');
    mkdirSync(path.join(root, 'repo'), { recursive: true });
    const config = path.join(root, 'repo', 'config.yaml');
    const parts = (fm = {}) => {
      const s = start.readSettings(root, fm);
      return [s.codeScaffold, s.scaffoldAfterBuild];
    };
    writeFileSync(config, 'mode: sandbox\n');
    expect(parts()).toEqual([true, true]);
    writeFileSync(config, 'mode: sandbox\nsandbox:\n  code_scaffold: true # drawn\n  scaffold_after_build: false\n');
    expect(parts()).toEqual([true, false]);
    writeFileSync(config, 'mode: sandbox\nsandbox:\n  code_scaffold: false\n  scaffold_after_build: true\n');
    expect(parts()).toEqual([false, false]);
    // Production always makes both, whatever the block says, also by the brief's snapshot.
    writeFileSync(config, 'mode: production\nsandbox:\n  code_scaffold: false\n  scaffold_after_build: false\n');
    expect(parts()).toEqual([true, true]);
    writeFileSync(config, 'mode: sandbox\nsandbox:\n  code_scaffold: false\n');
    expect(parts({ mode: 'production' })).toEqual([true, true]);
  });

  it('swaps the last part of the intent branch', () => {
    expect(start.buildBranch('shop/intent-a-2/intent', '003')).toBe('shop/intent-a-2/build-003');
    expect(start.storyBranch('intent-a/intent', { id: '003', slug: 'login' })).toBe('intent-a/story-003-login');
  });
});
