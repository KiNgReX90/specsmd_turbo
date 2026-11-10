/**
 * Unit tests for review-fix.cjs of the AI-DLC Turbo flow, on throwaway git
 * repos and a fake GitLab:
 * - where: the intent branch names the intent, a story branch the intent and
 *   its story, any other branch lists the done intents with a merge request;
 * - threads: only open threads, without system notes and without a thread
 *   whose last note is a review-fix reply; a thread on the intent's merge
 *   request goes to the story whose changed_files hold its file; a merged
 *   merge request brings none; --story keeps that story's threads;
 * - impact: a fix in the story's own files without a test file is small,
 *   otherwise the test cases of the story and of every story sharing a fix
 *   file are no longer proven;
 * - open and land, story branches on: a worktree on the story branch, first
 *   brought up to the remote; the fix committed there, merged into every
 *   story branch that builds on it, the worktree removed, and on the intent
 *   branch the story file, its proof and the outdated test cases committed;
 *   a changed set that differs from --fix-files stops with nothing committed;
 * - story branches off: the project tree is the code root and the fix lands
 *   on the intent branch;
 * - reply: posts the text with the marker into the thread.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const fix = req(path.join(FLOW, 'scripts/review-fix.cjs'));
const { MARKER } = req(path.join(FLOW, 'scripts/lib/mr-threads.cjs'));
const { verifyStory } = req(path.join(FLOW, 'scripts/story-verify.cjs'));

const bases: string[] = [];
afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

const INTENT = 'shop/intent-auth/intent';
const MR = (n: number) => `https://gitlab.example.com/acme/app/-/merge_requests/${n}`;
const sb = (id: string) => `shop/intent-auth/story-${id}-s${id}`;

const story = (id: string, deps: string, files: string[], mr: number | null) => [
  '---', `id: "${id}"`, `title: Story ${id}`, 'status: done', `depends_on: ${deps}`,
  `branch: ${sb(id)}`, `changed_files: [${files.join(', ')}]`, ...(mr ? [`merge_request: ${MR(mr)}`] : []), '---', '', `# S${id}`, '',
].join('\n');
const testCase = (id: string) => [
  '---', `test_id: US-${id}`, 'intent: auth', `story: ${id}-s${id}`, 'type: ui',
  `twin: tests/aidlc-twins/auth-s${id}.spec.ts`, 'twin_result: passed', '---', '', `# Test ${id}`, '',
].join('\n');

/**
 * A done intent: story 002 stacks on 001, 003 stands alone. Every story has
 * its branch with one commit, and the intent branch carries the done specs.
 */
function project(config: string, remote = false) {
  const base = mkdtempSync(path.join(tmpdir(), 'turbo-review-fix-'));
  bases.push(base);
  const app = path.join(base, 'app');
  const specs = path.join(app, '.specs-aidlc-turbo');
  const intent = path.join(specs, 'docs/auth/auth');
  mkdirSync(path.join(intent, 'stories'), { recursive: true });
  mkdirSync(path.join(intent, 'tests'), { recursive: true });
  mkdirSync(path.join(specs, 'repo'), { recursive: true });
  writeFileSync(path.join(specs, 'repo/config.yaml'), config);
  const brief = (status: string, mr: boolean) => writeFileSync(path.join(intent, 'brief.md'), [
    '---', 'id: auth', 'title: User authentication', `status: ${status}`, `branch: ${INTENT}`, ...(mr ? [`merge_request: ${MR(10)}`] : []), '---', '',
    '## Verification', '', '- **Test**: `node test.js`', '',
  ].join('\n'));
  brief('building', false);
  for (const id of ['001', '002', '003']) {
    writeFileSync(path.join(intent, `stories/${id}-s${id}.md`), `---\nid: "${id}"\ntitle: Story ${id}\nstatus: todo\n---\n\n# S${id}\n`);
  }
  mkdirSync(path.join(app, 'src'));
  for (const f of ['a', 'b', 'c']) writeFileSync(path.join(app, `src/${f}.txt`), `${f}\n`);
  writeFileSync(path.join(app, 'test.js'), "process.exit(require('fs').readFileSync('src/a.txt', 'utf8').includes('BAD') ? 1 : 0);\n");
  const git = (...args: string[]) => execFileSync('git', args, { cwd: app, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('switch', '-q', '-c', INTENT);
  const commitOn = (branch: string, from: string, file: string) => {
    git('switch', '-q', '-c', branch, from);
    writeFileSync(path.join(app, file), `${file} built\n`);
    git('commit', '-q', '-am', `feat: ${branch}`);
  };
  commitOn(sb('001'), INTENT, 'src/a.txt');
  commitOn(sb('002'), sb('001'), 'src/b.txt');
  commitOn(sb('003'), INTENT, 'src/c.txt');
  git('switch', '-q', INTENT);
  brief('done', true);
  writeFileSync(path.join(intent, 'stories/001-s001.md'), story('001', '[]', ['src/a.txt'], 11));
  writeFileSync(path.join(intent, 'stories/002-s002.md'), story('002', '["001"]', ['src/b.txt'], 12));
  writeFileSync(path.join(intent, 'stories/003-s003.md'), story('003', '[]', ['src/c.txt'], 13));
  for (const id of ['001', '002', '003']) writeFileSync(path.join(intent, `tests/US-${id}.md`), testCase(id));
  git('add', '-A');
  git('commit', '-q', '-m', 'docs: done');
  if (remote) {
    execFileSync('git', ['init', '-q', '--bare', path.join(base, 'origin.git')]);
    git('remote', 'add', 'origin', path.join(base, 'origin.git'));
    git('push', '-q', 'origin', INTENT, sb('001'), sb('002'), sb('003'));
  }
  const fm = (rel: string, key: string) => readFileSync(path.join(intent, rel), 'utf8').match(new RegExp(`^${key}: (.*)$`, 'm'))?.[1];
  return { base, app, intent, git, fm };
}

type P = ReturnType<typeof project>;
const ON = 'mode: production\nbranching:\n  project_key: shop\n';

/** Open a story, write the fix and verify it. Returns the open result. */
function fixStory(p: P, id: string, files: Record<string, string>) {
  const opened = fix.open({ intentSlug: 'auth', storyId: id, cwd: p.app });
  expect(opened.error).toBeUndefined();
  for (const [f, text] of Object.entries(files)) writeFileSync(path.join(opened.code_root, f), text);
  const verified = verifyStory({ intentSlug: 'auth', storyId: id, codeRoot: opened.code_root, cwd: p.app });
  expect(verified.error).toBeUndefined();
  return opened;
}

/** A fake GitLab: the merge request state and its discussions, by number. */
function gitlab(mrs: Record<number, { state?: string; discussions?: any[] }>) {
  const calls: any[] = [];
  const transport = async ({ method, url, body }: any) => {
    calls.push({ method, url, body: body ? JSON.parse(String(body)) : null });
    const m = url.match(/merge_requests\/(\d+)(\/discussions)?/);
    const mr = mrs[Number(m[1])] || {};
    if (method === 'POST') return { status: 201, headers: {}, body: Buffer.from(JSON.stringify({ id: 99 })) };
    if (m[2]) return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(mr.discussions || [])) };
    return { status: 200, headers: {}, body: Buffer.from(JSON.stringify({ state: mr.state || 'opened' })) };
  };
  return { transport, calls, lookup: () => 'secret-token' };
}

const note = (id: number, body: string, extra: any = {}) => ({ id, body, system: false, resolvable: true, resolved: false, author: { name: 'Ann' }, created_at: '2026-10-28T10:00:00Z', ...extra });

describe('aidlc-turbo review-fix: where', () => {
  const p = project(ON);

  it('the intent branch names the intent, a story branch also its story', () => {
    expect(fix.where({ cwd: p.app })).toMatchObject({ intent: 'auth', story: null, intent_branch: INTENT });
    p.git('switch', '-q', sb('002'));
    expect(fix.where({ cwd: p.app })).toMatchObject({ intent: 'auth', story: '002' });
    p.git('switch', '-q', INTENT);
  });

  it('another branch lists the done intents with a merge request', () => {
    p.git('switch', '-q', '-c', 'elsewhere');
    expect(fix.where({ cwd: p.app })).toEqual({
      intent: null, story: null, branch: 'elsewhere', candidates: [{ intent: 'auth', title: 'User authentication', merge_request: MR(10) }],
    });
    p.git('switch', '-q', INTENT);
  });
});

describe('aidlc-turbo review-fix: threads', () => {
  const p = project(ON);
  const fake = gitlab({
    10: { discussions: [
      { id: 'd-b', notes: [note(1, 'Make this a helper', { position: { new_path: 'src/b.txt', new_line: 3 } })] },
      { id: 'd-general', notes: [note(2, 'Nice work', { resolvable: false })] },
    ] },
    11: { discussions: [
      { id: 'd-open', notes: [note(3, 'Duplicate code', { position: { new_path: 'src/a.txt', new_line: 1 } }), note(4, 'Agreed', { author: { name: 'Bob' } })] },
      { id: 'd-resolved', notes: [note(5, 'Typo', { resolved: true })] },
      { id: 'd-answered', notes: [note(6, 'Why?'), note(7, `Fixed.\n\n${MARKER}`)] },
      { id: 'd-system', notes: [{ id: 8, body: 'added 1 commit', system: true }] },
    ] },
    13: { state: 'merged', discussions: [{ id: 'd-late', notes: [note(9, 'Too late')] }] },
  });

  it('keeps only the open threads, each with its story', async () => {
    const r = await fix.threads({ intentSlug: 'auth', cwd: p.app, ...fake });
    expect(r.error).toBeUndefined();
    expect(r.threads.map((t: any) => [t.discussion, t.story])).toEqual([['d-b', '002'], ['d-general', null], ['d-open', '001']]);
    const open = r.threads.find((t: any) => t.discussion === 'd-open');
    expect(open).toMatchObject({ mr: MR(11), file: 'src/a.txt', line: 1, url: `${MR(11)}#note_3` });
    expect(open.notes.map((n: any) => [n.author, n.body])).toEqual([['Ann', 'Duplicate code'], ['Bob', 'Agreed']]);
    expect(r.merge_requests.find((m: any) => m.story === '003').state).toBe('merged');
    expect(fake.calls.some((c) => c.url.includes('merge_requests/13/discussions'))).toBe(false);
  });

  it('--story keeps the threads of that story', async () => {
    const r = await fix.threads({ intentSlug: 'auth', storyId: '2', cwd: p.app, ...fake });
    expect(r.threads.map((t: any) => t.discussion)).toEqual(['d-b']);
  });

  it('stops without a key', async () => {
    const r = await fix.threads({ intentSlug: 'auth', cwd: p.app, ...fake, lookup: () => null });
    expect(r.error).toContain('GITLAB_TOKEN');
  });
});

describe('aidlc-turbo review-fix: impact', () => {
  const stories = [
    { id: '001', changed_files: ['src/a.txt', 'src/shared.txt'], touches: [] },
    { id: '002', changed_files: ['src/b.txt'], touches: ['src/shared.txt'] },
  ];

  it('a fix in the story\'s own files without a test file is small', () => {
    expect(fix.impact({ stories, storyId: '001', fixFiles: 'src/a.txt' })).toMatchObject({ small: true, affected: [] });
  });

  it('a shared file reaches the other story, a test file the story itself', () => {
    expect(fix.impact({ stories, storyId: '001', fixFiles: 'src/shared.txt' })).toMatchObject({ small: false, affected: ['001', '002'] });
    expect(fix.impact({ stories, storyId: '001', fixFiles: 'src/a.txt,src/a.test.js' })).toMatchObject({ small: false, affected: ['001'], tests: ['src/a.test.js'] });
  });
});

describe('aidlc-turbo review-fix: open and land, story branches on', () => {
  const p = project(ON, true);

  it('refuses a story whose intent is not done', () => {
    const q = project(ON);
    writeFileSync(path.join(q.intent, 'brief.md'), readFileSync(path.join(q.intent, 'brief.md'), 'utf8').replace('status: done', 'status: building'));
    expect(fix.open({ intentSlug: 'auth', storyId: '001', cwd: q.app }).error).toContain('done intent');
  });

  it('brings the story branch up to the remote before the worktree opens', () => {
    const clone = path.join(p.base, 'clone');
    execFileSync('git', ['clone', '-q', '-b', sb('003'), path.join(p.base, 'origin.git'), clone]);
    const cg = (...args: string[]) => execFileSync('git', args, { cwd: clone, encoding: 'utf8' }).trim();
    cg('config', 'user.email', 'c@example.com');
    cg('config', 'user.name', 'Colleague');
    writeFileSync(path.join(clone, 'src/c.txt'), 'c by a colleague\n');
    cg('commit', '-q', '-am', 'colleague');
    cg('push', '-q', 'origin', sb('003'));
    const opened = fix.open({ intentSlug: 'auth', storyId: '003', cwd: p.app });
    expect(opened).toMatchObject({ story: '003', branch: sb('003'), forwarded: true });
    expect(readFileSync(path.join(opened.code_root, 'src/c.txt'), 'utf8')).toBe('c by a colleague\n');
    expect(fix.open({ intentSlug: 'auth', storyId: '003', cwd: p.app }).resumed).toBe(true);
  });

  it('a small fix lands on the story branch and leaves the test cases proven', () => {
    const opened = fixStory(p, '003', { 'src/c.txt': 'c fixed\n' });
    const r = fix.land({ intentSlug: 'auth', storyId: '003', fixFiles: 'src/c.txt', message: 'c was wrong', cwd: p.app });
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ small: true, carried: [], outdated: [], worktree_removed: true });
    expect(p.git('log', '-1', '--format=%s', sb('003'))).toBe('fix(auth): c was wrong (S003)');
    expect(existsSync(opened.code_root)).toBe(false);
    expect(p.git('log', '-1', '--format=%s')).toBe('docs(auth): review fix S003');
    expect(p.fm('tests/US-003.md', 'twin_result')).toBe('passed');
  });

  it('stops when the changed files differ from --fix-files, and commits nothing', () => {
    fixStory(p, '001', { 'src/a.txt': 'a fixed\n', 'src/a.test.js': 'test\n' });
    const head = p.git('rev-parse', sb('001'));
    const r = fix.land({ intentSlug: 'auth', storyId: '001', fixFiles: 'src/a.txt', message: 'a', cwd: p.app });
    expect(r.error).toContain('differ from --fix-files');
    expect(r.staged).toEqual(['src/a.test.js', 'src/a.txt']);
    expect(p.git('rev-parse', sb('001'))).toBe(head);
  });

  it('a fix with a test lands, reaches the stories built on it and marks its test case outdated', () => {
    const r = fix.land({ intentSlug: 'auth', storyId: '001', fixFiles: 'src/a.txt,src/a.test.js', message: 'a was wrong', cwd: p.app });
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ small: false, affected: ['001'], carried: [sb('002')] });
    expect(r.outdated).toEqual(['.specs-aidlc-turbo/docs/auth/auth/tests/US-001.md']);
    expect(p.git('show', `${sb('002')}:src/a.txt`)).toBe('a fixed');
    expect(p.git('log', '-1', '--format=%P', sb('002')).split(' ')).toHaveLength(2);
    expect(p.fm('tests/US-001.md', 'twin_result')).toBe('outdated');
    expect(p.fm('tests/US-002.md', 'twin_result')).toBe('passed');
    expect(readFileSync(path.join(p.intent, 'stories/001-s001.md'), 'utf8')).toContain('src/a.test.js');
    expect(p.git('status', '--porcelain')).toBe('');
  });
});

describe('aidlc-turbo review-fix: story branches off', () => {
  const p = project('mode: production\nbranching:\n  project_key: shop\n  story_branches: false\n');

  it('fixes in the project tree and lands on the intent branch', () => {
    const opened = fixStory(p, '003', { 'src/c.txt': 'c fixed\n' });
    expect(opened).toMatchObject({ code_root: p.app, worktree: null, branch: INTENT });
    const r = fix.land({ intentSlug: 'auth', storyId: '003', fixFiles: 'src/c.txt', message: 'c was wrong', cwd: p.app });
    expect(r.error).toBeUndefined();
    expect(p.git('log', '-2', '--format=%s')).toBe('docs(auth): review fix S003\nfix(auth): c was wrong (S003)');
  });
});

describe('aidlc-turbo review-fix: reply and the command line', () => {
  it('posts the reply with the marker into the thread', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'turbo-reply-'));
    bases.push(dir);
    writeFileSync(path.join(dir, 'reply.md'), 'Fixed in abc123.\n');
    const fake = gitlab({});
    const r = await fix.reply({ url: MR(11), discussion: 'd-open', bodyFile: path.join(dir, 'reply.md'), ...fake });
    expect(r).toEqual({ ok: true, url: `${MR(11)}#note_99` });
    expect(fake.calls[0].url).toContain('/merge_requests/11/discussions/d-open/notes');
    expect(fake.calls[0].body.body).toBe(`Fixed in abc123.\n\n${MARKER}`);
    writeFileSync(path.join(dir, 'empty.md'), '  \n');
    expect((await fix.reply({ url: MR(11), discussion: 'x', bodyFile: path.join(dir, 'empty.md'), ...fake })).error).toContain('empty');
  });

  it('a usage error exits 2', async () => {
    const printed: string[] = [];
    expect(await fix.main(['land', 'auth', '001'], { print: (t: string) => printed.push(t) })).toBe(2);
    expect(printed[0]).toContain('--fix-files');
  });
});
