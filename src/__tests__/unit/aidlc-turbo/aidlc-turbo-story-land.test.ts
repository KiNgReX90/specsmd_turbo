/**
 * Unit tests for story-land.cjs of the AI-DLC Turbo flow, on throwaway git repos.
 *
 * story-land commits a reviewed story and closes it, or stops and keeps the work:
 * - the staged set (git status of the worktree minus .specs-aidlc-turbo/) must
 *   equal --changed-files, in any order; a mismatch stops with both lists;
 * - it refuses a story without a passing proof, or whose code changed after it;
 * - story branches off: `build S{SSS}` on the build branch, cherry-picked onto
 *   the intent branch as `feat({intent}): {title} (S{SSS})`, then the story file
 *   done and committed; the worktree and build branch go only when all worked;
 * - a cherry-pick conflict is a human stop that keeps the worktree and the
 *   branch, and a rerun after the fix reuses the story's commit;
 * - a rerun never picks a commit the intent branch already has, and a story
 *   already done only gets its docs commit and the cleanup;
 * - story branches on: the commit lands on the story branch, which is kept
 *   and stays local (finish pushes it once the user approved the intent), and
 *   the intent branch gets only the story file;
 * - a story whose --changed-files or staged set holds a path under
 *   aidlc-twins/ is refused and nothing is committed or pushed: that folder
 *   belongs to the test writer at finish;
 * - sandbox mode: exactly production with story branches off, also when the
 *   config turns story branches on: a build branch, the cherry-pick, no push.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const LAND = path.join(FLOW, 'scripts/story-land.cjs');
const { startStory } = req(path.join(FLOW, 'scripts/story-start.cjs'));
const { verifyStory } = req(path.join(FLOW, 'scripts/story-verify.cjs'));
const { landStory } = req(LAND);

const bases: string[] = [];
afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

const INTENT = 'shop/intent-auth/intent';
const TEST_JS = "process.exit(require('fs').readFileSync('src/app.txt', 'utf8').includes('BAD') ? 1 : 0);\n";

/** A git project with stories 001 and 002 (independent) on the intent branch. */
function project(config: string, remote = false) {
  const base = mkdtempSync(path.join(tmpdir(), 'turbo-land-'));
  bases.push(base);
  const app = path.join(base, 'app');
  const specs = path.join(app, '.specs-aidlc-turbo');
  const intent = path.join(specs, 'docs/auth/auth');
  mkdirSync(path.join(intent, 'stories'), { recursive: true });
  mkdirSync(path.join(specs, 'repo'), { recursive: true });
  writeFileSync(path.join(specs, 'repo/config.yaml'), config);
  writeFileSync(path.join(intent, 'brief.md'), [
    '---', 'id: auth', 'status: building', `branch: ${INTENT}`, '---', '',
    '## Verification', '', '- **Test**: `node test.js`', '',
  ].join('\n'));
  for (const id of ['001', '002', '003']) {
    const deps = id === '003' ? '["001"]' : '[]';
    writeFileSync(path.join(intent, 'stories', `${id}-s${id}.md`),
      `---\nid: "${id}"\ntitle: Story ${id}\nstatus: todo\ndepends_on: ${deps}\ncommit: null\nbranch: null\n---\n\n# S${id}\n`);
  }
  mkdirSync(path.join(app, 'src'));
  writeFileSync(path.join(app, 'src/app.txt'), 'one\ntwo\nthree\n');
  writeFileSync(path.join(app, 'test.js'), TEST_JS);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: app, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('switch', '-q', '-c', INTENT);
  if (remote) {
    execFileSync('git', ['init', '-q', '--bare', path.join(base, 'origin.git')]);
    git('remote', 'add', 'origin', path.join(base, 'origin.git'));
  }
  const file = (id: string) => path.join(intent, 'stories', `${id}-s${id}.md`);
  const fm = (id: string, key: string) => readFileSync(file(id), 'utf8').match(new RegExp(`^${key}: (.*)$`, 'm'))?.[1];
  return { base, app, git, file, fm };
}

type P = ReturnType<typeof project>;

/** Start a story, write files in its worktree and verify it. Returns the worktree. */
function build(p: P, id: string, files: Record<string, string>) {
  const started = startStory({ intentSlug: 'auth', storyId: id, cwd: p.app });
  expect(started.error).toBeUndefined();
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(started.worktree, f)), { recursive: true });
    writeFileSync(path.join(started.worktree, f), text);
  }
  const verified = verifyStory({ intentSlug: 'auth', storyId: id, codeRoot: started.worktree, cwd: p.app });
  expect(verified.error).toBeUndefined();
  return started;
}

const land = (p: P, id: string, changedFiles: string, extra = {}) =>
  landStory({ intentSlug: 'auth', storyId: id, changedFiles, cwd: p.app, ...extra });

describe('aidlc-turbo story-land, story branches off', () => {
  const p = project('mode: production\nbranching:\n  project_key: shop\n  story_branches: false\n');

  it('stops on a staged set that differs from --changed-files and keeps everything', () => {
    const s = build(p, '001', { 'src/app.txt': 'ONE\ntwo\nthree\n', 'src/new.txt': 'new\n' });
    const r = spawnSync('node', [LAND, 'auth', '001', '--changed-files', 'src/app.txt'], { cwd: p.app, encoding: 'utf8' });
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.error).toContain('differs from --changed-files');
    expect(out.staged).toEqual(['src/app.txt', 'src/new.txt']);
    expect(out.expected).toEqual(['src/app.txt']);
    expect(existsSync(s.worktree)).toBe(true);
    expect(p.git('log', '-1', '--format=%s')).toBe('init');
    expect(spawnSync('node', [LAND, 'auth', '001'], { cwd: p.app }).status).toBe(2);
  });

  it('refuses code that changed after the proof', () => {
    writeFileSync(path.join(p.base, 'app-turbo/auth/story-001/src/new.txt'), 'changed\n');
    expect(land(p, '001', 'src/new.txt,src/app.txt').error).toContain('changed after story-verify');
  });

  it('commits, carries the commit onto the intent branch, closes the story and cleans up', () => {
    verifyStory({ intentSlug: 'auth', storyId: '001', codeRoot: path.join(p.base, 'app-turbo/auth/story-001'), cwd: p.app });
    const out = land(p, '001', ' src/new.txt, src/app.txt', { tests: '2 passed' });
    expect(out.error).toBeUndefined();
    expect(out).toMatchObject({ story: '001', worktree_removed: true, frontier: ['002', '003'] });
    expect(p.git('log', '-2', '--format=%s').split('\n')).toEqual(['docs(auth): S001 done', 'feat(auth): Story 001 (S001)']);
    expect(p.git('rev-parse', 'HEAD~1')).toBe(out.commit);
    expect(p.git('show', 'HEAD~1', '--name-only', '--format=').split('\n').sort()).toEqual(['src/app.txt', 'src/new.txt']);
    expect(p.git('show', 'HEAD:.specs-aidlc-turbo/docs/auth/auth/stories/001-s001.md')).toContain(`commit: ${out.commit}`);
    expect(p.fm('001', 'status')).toBe('done');
    expect((yaml.load(readFileSync(p.file('001'), 'utf8').split('---')[1]) as any).changed_files).toEqual(['src/app.txt', 'src/new.txt']);
    expect(existsSync(path.join(p.base, 'app-turbo/auth/story-001'))).toBe(false);
    expect(p.git('branch', '--list', 'shop/intent-auth/build-001')).toBe('');
    expect(p.git('status', '--porcelain', '--', 'src')).toBe('');
  });

  it('stops on a cherry-pick conflict, keeps the worktree, and lands on a rerun after the fix', () => {
    // 002 was started before 001 landed, so it still has the old line one.
    p.git('switch', '-q', '-c', 'old', 'HEAD~2');
    p.git('switch', '-q', INTENT);
    const s = build(p, '002', { 'src/app.txt': 'uno\ntwo\nthree\n' });
    execFileSync('git', ['reset', '-q', '--hard', 'old'], { cwd: s.worktree });
    writeFileSync(path.join(s.worktree, 'src/app.txt'), 'uno\ntwo\nthree\n');
    verifyStory({ intentSlug: 'auth', storyId: '002', codeRoot: s.worktree, cwd: p.app });

    const out = land(p, '002', 'src/app.txt');
    expect(out.error).toContain('cherry-pick onto shop/intent-auth/intent conflicts: a human stop');
    expect(out.conflicts).toEqual(['src/app.txt']);
    expect(existsSync(s.worktree)).toBe(true);
    expect(p.git('branch', '--list', 'shop/intent-auth/build-002')).toContain('build-002');
    expect(p.git('status', '--porcelain', '--', 'src')).toBe('');
    expect(existsSync(path.join(p.app, '.git/CHERRY_PICK_HEAD'))).toBe(false);
    expect(p.fm('002', 'status')).toBe('building');

    // The human rebases the build commit onto the intent branch and resolves it.
    execFileSync('git', ['reset', '-q', '--hard', INTENT], { cwd: s.worktree });
    writeFileSync(path.join(s.worktree, 'src/app.txt'), 'ONE uno\ntwo\nthree\n');
    execFileSync('git', ['commit', '-q', '-am', 'build S002'], { cwd: s.worktree });
    const again = land(p, '002', 'src/app.txt');
    expect(again.error).toBeUndefined();
    expect(again.worktree_removed).toBe(true);
    expect(readFileSync(path.join(p.app, 'src/app.txt'), 'utf8')).toBe('ONE uno\ntwo\nthree\n');
  });

  it('refuses a story whose proof failed', () => {
    const s = build(p, '003', { 'src/app.txt': 'BAD\n' });
    const out = land(p, '003', 'src/app.txt');
    expect(out.error).toContain('the proof did not pass');
    expect(existsSync(s.worktree)).toBe(true);
  });
});

describe('aidlc-turbo story-land, a rerun after a partial landing', () => {
  const p = project('mode: production\nbranching:\n  project_key: shop\n  story_branches: false\n');

  it('does not pick the commit again when the intent branch already has it', () => {
    const s = build(p, '001', { 'src/app.txt': 'ONE\ntwo\nthree\n' });
    chmodSync(p.file('001'), 0o444);
    expect(() => land(p, '001', 'src/app.txt')).toThrow();
    chmodSync(p.file('001'), 0o644);
    expect(p.git('log', '-1', '--format=%s')).toBe('feat(auth): Story 001 (S001)');
    expect(p.fm('001', 'status')).toBe('building');

    const again = land(p, '001', 'src/app.txt');
    expect(again.error).toBeUndefined();
    expect(again.resumed).toContain('already on the intent branch');
    expect(p.git('log', '-2', '--format=%s').split('\n')).toEqual(['docs(auth): S001 done', 'feat(auth): Story 001 (S001)']);
    expect(p.git('rev-parse', 'HEAD~1')).toBe(again.commit);
    expect(p.fm('001', 'status')).toBe('done');
    expect(existsSync(s.worktree)).toBe(false);
  });

  it('only commits the story file and cleans up when the story is already done', () => {
    const s = build(p, '002', { 'src/new.txt': 'new\n' });
    const hooks = path.join(p.base, 'hooks');
    mkdirSync(hooks);
    writeFileSync(path.join(hooks, 'commit-msg'), '#!/bin/sh\ngrep -q "^docs(" "$1" && exit 1\nexit 0\n', { mode: 0o755 });
    p.git('config', 'core.hooksPath', hooks);
    const first = land(p, '002', 'src/new.txt');
    expect(first.error).toContain('committing the story file failed');
    expect(p.fm('002', 'status')).toBe('done');
    p.git('config', 'core.hooksPath', '/dev/null');

    const again = land(p, '002', 'src/new.txt');
    expect(again.error).toBeUndefined();
    expect(again.resumed).toContain('already done');
    expect(again.commit).toBe(first.commit);
    expect(p.git('log', '-2', '--format=%s').split('\n')).toEqual(['docs(auth): S002 done', 'feat(auth): Story 002 (S002)']);
    expect(existsSync(s.worktree)).toBe(false);
    expect(p.git('branch', '--list', 'shop/intent-auth/build-002')).toBe('');
    expect(land(p, '002', 'src/new.txt').error).toContain('already done');
  });
});

describe('aidlc-turbo story-land, story branches on', () => {
  const p = project('mode: production\nbranching:\n  project_key: shop\n  story_branches: true\n', true);

  it('commits on the story branch, keeps it local, and commits only the story file on the intent branch', () => {
    p.git('push', '-q', '-u', 'origin', INTENT);
    build(p, '001', { 'src/app.txt': 'ONE\ntwo\nthree\n' });
    const out = land(p, '001', 'src/app.txt');
    expect(out.error).toBeUndefined();
    const branch = 'shop/intent-auth/story-001-s001';
    expect(out).toMatchObject({ branch, worktree_removed: true, frontier: ['002', '003'] });
    // Nothing leaves the machine before the user approves the intent at finish.
    expect(out.push).toBeUndefined();
    expect(out.merge_request).toBeUndefined();
    expect(execFileSync('git', ['branch', '--list', branch], { cwd: path.join(p.base, 'origin.git'), encoding: 'utf8' }).trim()).toBe('');
    expect(p.git('log', '-1', '--format=%s', branch)).toBe('feat(auth): Story 001 (S001)');
    expect(p.git('rev-parse', branch)).toBe(out.commit);
    expect(p.git('show', `${branch}`, '--name-only', '--format=')).toBe('src/app.txt');
    expect(p.git('log', '-1', '--format=%s')).toBe('docs(auth): S001 done');
    expect(p.git('show', 'HEAD', '--name-only', '--format=')).toBe('.specs-aidlc-turbo/docs/auth/auth/stories/001-s001.md');
    expect(p.fm('001', 'branch')).toBe(branch);
    expect(readFileSync(path.join(p.app, 'src/app.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
  });

  it('stacks the next story on that branch', () => {
    const s = startStory({ intentSlug: 'auth', storyId: '003', cwd: p.app });
    expect(s).toMatchObject({ base: 'shop/intent-auth/story-001-s001', branch: 'shop/intent-auth/story-003-s003' });
  });
});

describe('aidlc-turbo story-land, twins belong to the test writer', () => {
  // On a real run a builder wrote a Playwright file under aidlc-twins/ on its
  // story branch, and the intent branch went out without the twin.
  const p = project('mode: production\nbranching:\n  project_key: shop\n  story_branches: true\n', true);
  const branch = 'shop/intent-auth/story-001-s001';
  const TWIN = 'e2e/aidlc-twins/auth-s001.spec.ts';
  const OWN_SPEC = 'e2e/auth-s001.spec.ts';
  const origin = path.join(p.base, 'origin.git');
  let worktree = '';
  const wtGit = (...args: string[]) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8' }).trim();

  /** Nothing of story 001 was committed, staged, marked done or pushed. */
  function nothingLanded() {
    expect(p.git('log', '-1', '--format=%s', branch)).toBe('init');
    expect(p.git('log', '-1', '--format=%s')).toBe('init');
    expect(wtGit('diff', '--cached', '--name-only')).toBe('');
    expect(p.fm('001', 'status')).toBe('building');
    expect(existsSync(path.join(worktree, TWIN))).toBe(true);
    expect(execFileSync('git', ['branch', '--list', branch], { cwd: origin, encoding: 'utf8' }).trim()).toBe('');
  }

  it('refuses a story whose changed files hold a twin, and commits nothing', () => {
    p.git('push', '-q', '-u', 'origin', INTENT);
    worktree = build(p, '001', { 'src/app.txt': 'ONE\ntwo\nthree\n', [TWIN]: "test('S001', () => {});\n" }).worktree;
    const r = spawnSync('node', [LAND, 'auth', '001', '--changed-files', `src/app.txt,${TWIN}`], { cwd: p.app, encoding: 'utf8' });
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.error).toContain('test writer');
    expect(out.error).toContain(TWIN);
    nothingLanded();
  });

  it('refuses it too when only the staged set holds the twin', () => {
    const out = land(p, '001', 'src/app.txt');
    expect(out.error).toContain('test writer');
    expect(out.error).toContain(TWIN);
    expect(out.staged).toEqual([TWIN, 'src/app.txt']);
    nothingLanded();
  });

  it('lands the story once its Playwright spec sits next to the project\'s own specs', () => {
    rmSync(path.join(worktree, TWIN));
    writeFileSync(path.join(worktree, OWN_SPEC), "test('S001', () => {});\n");
    expect(verifyStory({ intentSlug: 'auth', storyId: '001', codeRoot: worktree, cwd: p.app }).error).toBeUndefined();
    const out = land(p, '001', `src/app.txt,${OWN_SPEC}`);
    expect(out.error).toBeUndefined();
    expect(out).toMatchObject({ branch, worktree_removed: true });
    expect(p.git('show', branch, '--name-only', '--format=').split('\n').sort()).toEqual([OWN_SPEC, 'src/app.txt']);
    expect(p.fm('001', 'status')).toBe('done');
  });
});

describe('aidlc-turbo story-land, sandbox mode', () => {
  // Sandbox is production with story branches off: story_branches in the config is ignored.
  const p = project('mode: sandbox\nbranching:\n  project_key: shop\n  story_branches: true\n', true);
  const origin = path.join(p.base, 'origin.git');

  it('commits on the build branch, cherry-picks onto the intent branch and pushes nothing', () => {
    const s = build(p, '001', { 'src/app.txt': 'ONE\ntwo\nthree\n', 'src/new.txt': 'new\n' });
    expect(s).toMatchObject({ branch: 'shop/intent-auth/build-001', story_branches: false });
    const out = land(p, '001', 'src/app.txt,src/new.txt');
    expect(out.error).toBeUndefined();
    expect(out).toMatchObject({ story: '001', worktree_removed: true, frontier: ['002', '003'] });
    expect(out.note).toBeUndefined();
    expect(out.push).toBeUndefined();
    expect(p.git('log', '-2', '--format=%s').split('\n')).toEqual(['docs(auth): S001 done', 'feat(auth): Story 001 (S001)']);
    expect(p.git('rev-parse', 'HEAD~1')).toBe(out.commit);
    expect(p.fm('001', 'status')).toBe('done');
    expect(p.fm('001', 'branch')).toBe('null');
    expect(existsSync(s.worktree)).toBe(false);
    expect(p.git('branch', '--list', 'shop/intent-auth/build-001', 'shop/intent-auth/story-*')).toBe('');
    expect(execFileSync('git', ['branch', '--list'], { cwd: origin, encoding: 'utf8' }).trim()).toBe('');
  });

  it('refuses a twin in --changed-files and leaves the story building', () => {
    const twin = 'e2e/aidlc-twins/auth-s002.spec.ts';
    const s = build(p, '002', { [twin]: "test('S002', () => {});\n" });
    const out = land(p, '002', twin);
    expect(out.error).toContain('test writer');
    expect(out.error).toContain(twin);
    expect(p.fm('002', 'status')).toBe('building');
    expect(existsSync(s.worktree)).toBe(true);
  });
});
