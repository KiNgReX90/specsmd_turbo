/**
 * Unit tests for push-branch.cjs of the AI-DLC Turbo flow, on throwaway git repos.
 *
 * Every branch the flow pushes gets its merge request in the same push:
 * - GitLab through plain git push options: a story without dependencies into
 *   the intent branch, a stacked story into the branch of the story it builds
 *   on, the intent branch into the base branch (else the remote's default);
 * - a target the remote lacks is pushed first, a story target with its own
 *   merge request;
 * - the merge request is written into the story's or the brief's frontmatter
 *   and read back when a later push sends nothing;
 * - GitHub through gh after the push;
 * - a remote that refuses push options gets a plain push, and the note says
 *   no merge request opened; no remote is a failed push;
 * - the intent branch is refused, and nothing pushed, while a test case names
 *   a twin the branch does not hold; the refusal names the story branches that
 *   hold it. A story branch still goes out;
 * - --all, run once the user approved the intent at finish: the intent branch
 *   first, then every story branch in build order, each with its merge
 *   request; a story branch the intent branch holds already stays; a missing
 *   twin pushes nothing at all.
 *
 * The project and the fake GitLab come from aidlc-turbo-push-branch-fixture.ts.
 * A branch with an open merge request: aidlc-turbo-push-branch-open-mr.test.ts.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { PUSH, INTENT, S1, S3, bases, project } from './aidlc-turbo-push-branch-fixture';

const req = createRequire(import.meta.url);
const { hostOf, run } = req(PUSH);

afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

const push = (p: { app: string }, story: string | null = null) => run({ intentSlug: 'auth', story, cwd: p.app });

describe('aidlc-turbo push-branch, the host', () => {
  it('knows GitHub, GitLab and the rest from the remote url', () => {
    expect(hostOf('git@github.com:acme/app.git')).toBe('github');
    expect(hostOf('https://github.com/acme/app.git')).toBe('github');
    expect(hostOf('git@gitlab.com:acme/shop/app.git')).toBe('gitlab');
    expect(hostOf('https://gitlab.example.com/app.git')).toBe('gitlab');
    expect(hostOf('/srv/git/app.git')).toBe('other');
  });
});

describe('aidlc-turbo push-branch, GitLab', () => {
  const p = project('gitlab');

  it('opens the merge request of a story without dependencies into the intent branch', () => {
    const out = push(p, '002');
    expect(out.push.ok).toBe(true);
    expect(out.merge_request).toEqual({ into: INTENT, url: 'https://gitlab.example.com/acme/app/-/merge_requests/1' });
    expect(p.options()[0]).toBe('shop/intent-auth/story-002-s002 merge_request.create|merge_request.title=Story 002|'
      + `merge_request.target=${INTENT}|merge_request.description=One story of "User authentication".|`);
    expect(p.fm('002', 'merge_request')).toBe(out.merge_request.url);
  });

  it('pushes the story it builds on first, with its own merge request, and stacks on its branch', () => {
    const out = push(p, '003');
    expect(out.target.branch).toBe(S1);
    expect(out.target.merge_request).toEqual({ into: INTENT, url: 'https://gitlab.example.com/acme/app/-/merge_requests/2' });
    expect(out.merge_request).toEqual({ into: S1, url: 'https://gitlab.example.com/acme/app/-/merge_requests/3' });
    expect(p.options()[2]).toContain(`merge_request.target=${S1}|`);
    expect(p.options()[2]).toContain('Builds on "Story 001": merge that one first.');
    expect(p.fm('001', 'merge_request')).toBe(out.target.merge_request.url);
    expect(p.fm('003', 'merge_request')).toBe(out.merge_request.url);
  });

  it('reads the merge request back from the story when the push sends nothing', () => {
    const out = push(p, '003');
    expect(out.push.ok).toBe(true);
    expect(out.target).toBeUndefined();
    expect(out.merge_request).toEqual({ into: S1, url: 'https://gitlab.example.com/acme/app/-/merge_requests/3' });
    expect(p.options()).toHaveLength(3);
  });

  it('opens the intent branch merge request into the base branch', () => {
    p.git('commit', '-q', '--allow-empty', '-m', 'docs(auth): close the intent');
    const out = push(p);
    expect(out.branch).toBe(INTENT);
    expect(out.merge_request).toEqual({ into: 'main', url: 'https://gitlab.example.com/acme/app/-/merge_requests/4' });
    expect(p.options()[3]).toContain('merge_request.title=User authentication|merge_request.target=main|');
    expect(p.options()[3]).toContain('Merge its story merge requests into this branch first.');
    expect(p.briefFm('merge_request')).toBe(out.merge_request.url);
  });

  it('reads the intent merge request back from the brief when the push sends nothing', () => {
    const r = spawnSync('node', [PUSH, 'auth'], { cwd: p.app, encoding: 'utf8' });
    expect({ status: r.status, out: r.stdout }).toMatchObject({ status: 0 });
    const out = JSON.parse(r.stdout);
    expect(out.merge_request).toEqual({ into: 'main', url: 'https://gitlab.example.com/acme/app/-/merge_requests/4' });
    expect(p.options()).toHaveLength(4);
  });

  it('says so when a branch without a merge request was already on the remote', () => {
    p.git('push', '-q', 'origin', 'shop/intent-auth/story-002-s002:refs/heads/elsewhere');
    p.git('branch', '-q', 'elsewhere', 'shop/intent-auth/story-002-s002');
    const { pushBranch } = req(PUSH);
    const out = pushBranch({ cwd: p.app, branch: 'elsewhere', into: INTENT, title: 'Elsewhere' });
    expect(out.push).toMatchObject({ ok: true });
    expect(out.merge_request.url).toBeNull();
    expect(out.merge_request.note).toContain('already on the remote');
  });
});

describe('aidlc-turbo push-branch, the Jira key in the title', () => {
  // Every merge request once came out without its key, while the
  // after-inception sync had written the keys already. The title is the one
  // the record has, in the record's language.
  const p = project('gitlab');
  const specs = path.join(p.app, '.specs-aidlc-turbo');
  writeFileSync(path.join(specs, 'docs/auth/sync.yaml'),
    'confluence:\n  pages: []\njira:\n  project: SHOP\n  intents:\n    auth:\n      epic: SHOP-100\n      stories:\n        "001": SHOP-101\n        "002": SHOP-102\n');
  const story2 = path.join(specs, 'docs/auth/auth/stories/002-s002.md');
  writeFileSync(story2, readFileSync(story2, 'utf8').replace('title: Story 002\n', 'title: Pay with a gift card\n'));
  const brief = path.join(specs, 'docs/auth/auth/brief.md');
  writeFileSync(brief, readFileSync(brief, 'utf8').replace('title: User authentication\n', 'title: Gift card checkout\n'));

  it('starts a story title with its key, and keeps the title as the record wrote it', () => {
    push(p, '002');
    expect(p.options()[0]).toContain('merge_request.title=SHOP-102 - Pay with a gift card|');
  });

  it('names a dependency by its key', () => {
    push(p, '003');
    expect(p.options()[1]).toContain('merge_request.title=SHOP-101 - Story 001|');
    expect(p.options()[2]).toContain('merge_request.title=Story 003|');
    expect(p.options()[2]).toContain('Builds on "SHOP-101 - Story 001": merge that one first.');
  });

  it('starts the intent title with the epic key', () => {
    p.git('commit', '-q', '--allow-empty', '-m', 'docs(auth): close the intent');
    push(p);
    expect(p.options()[3]).toContain('merge_request.title=SHOP-100 - Gift card checkout|merge_request.target=main|');
  });

  it('reads an older sync.yaml with the keys directly under jira', () => {
    const q = project('gitlab');
    writeFileSync(path.join(q.app, '.specs-aidlc-turbo/docs/auth/sync.yaml'), 'jira:\n  project: SHOP\n  epic: SHOP-200\n  stories:\n    "002": SHOP-202\n');
    push(q, '002');
    expect(q.options()[0]).toContain('merge_request.title=SHOP-202 - Story 002|');
  });
});

describe('aidlc-turbo push-branch, the twins the test cases name', () => {
  // On a real run a twin was committed only on its story branch, and the
  // intent branch went out with a test case pointing at a twin it lacked.
  const p = project('gitlab');
  const tests = path.join(p.app, '.specs-aidlc-turbo/docs/auth/auth/tests');
  const TWIN = 'e2e/aidlc-twins/auth-s003.spec.ts';
  const GONE = 'e2e/aidlc-twins/auth-s002.spec.ts';
  const testCase = (name: string, twin: string) => writeFileSync(path.join(tests, `${name}.md`),
    `---\ntest_id: ${name.slice(0, 6)}\nintent: auth\ntwin: ${twin}\ntwin_result: passed\n---\n\n# ${name}\n`);
  const writeTwin = (file: string, text: string | Buffer) => {
    mkdirSync(path.dirname(path.join(p.app, file)), { recursive: true });
    writeFileSync(path.join(p.app, file), text);
  };
  const onRemote = () => execFileSync('git', ['rev-parse', INTENT], { cwd: p.remote, encoding: 'utf8' }).trim();
  let before = '';

  it('refuses the intent branch while a test case names a twin it does not hold, and pushes nothing', () => {
    p.git('switch', '-q', S3);
    writeTwin(TWIN, "test('S003', () => {});\n");
    p.git('add', TWIN);
    p.git('commit', '-q', '-m', 'test(auth): the twin of S003');
    p.git('switch', '-q', INTENT);
    mkdirSync(tests, { recursive: true });
    testCase('US-001 - Story 001', 'null');
    testCase('US-002 - Story 002', GONE);
    testCase('US-003 - Story 003', TWIN);
    p.git('add', '.specs-aidlc-turbo');
    p.git('commit', '-q', '-m', 'docs(auth): close the intent');
    before = onRemote();

    const r = spawnSync('node', [PUSH, 'auth'], { cwd: p.app, encoding: 'utf8' });
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.branch).toBe(INTENT);
    expect(out.error).toContain('test cases name twins the intent branch does not hold');
    expect(out.missing_twins).toEqual([
      { test_case: '.specs-aidlc-turbo/docs/auth/auth/tests/US-002 - Story 002.md', twin: GONE, on: [] },
      { test_case: '.specs-aidlc-turbo/docs/auth/auth/tests/US-003 - Story 003.md', twin: TWIN, on: [S3] },
    ]);
    expect(out.push).toBeUndefined();
    expect(p.options()).toEqual([]);
    expect(onRemote()).toBe(before);
  });

  it('still pushes a story branch while the intent branch lacks a twin', () => {
    const out = push(p, '002');
    expect(out.error).toBeUndefined();
    expect(out.push.ok).toBe(true);
    expect(onRemote()).toBe(before);
  });

  it('pushes the intent branch as before once it holds every twin', () => {
    writeTwin(TWIN, execFileSync('git', ['show', `${S3}:${TWIN}`], { cwd: p.app }));
    testCase('US-002 - Story 002', '"null"');
    p.git('add', TWIN, '.specs-aidlc-turbo');
    p.git('commit', '-q', '-m', 'docs(auth): carry the twins');
    const out = push(p);
    expect(out.error).toBeUndefined();
    expect(out.push.ok).toBe(true);
    expect(out.merge_request).toEqual({ into: 'main', url: 'https://gitlab.example.com/acme/app/-/merge_requests/2' });
    expect(onRemote()).toBe(p.git('rev-parse', INTENT));
  });
});

describe('aidlc-turbo push-branch --all, once the user approved the intent', () => {
  // Nothing leaves the machine during the build: finish pushes every branch
  // in one go, after the user approved the intent on its overview page.
  const S2 = 'shop/intent-auth/story-002-s002';
  const mr = (n: number) => `https://gitlab.example.com/acme/app/-/merge_requests/${n}`;
  const all = (p: { app: string }) => spawnSync('node', [PUSH, 'auth', '--all'], { cwd: p.app, encoding: 'utf8' });
  const onRemote = (p: { remote: string }, branch: string) =>
    execFileSync('git', ['branch', '--list', branch], { cwd: p.remote, encoding: 'utf8' }).trim();
  const p = project('gitlab');

  it('pushes the intent branch first, then every story branch in build order, each with its merge request', () => {
    p.git('push', '-q', 'origin', '--delete', INTENT);
    writeFileSync(path.join(p.remote, 'options.log'), '');
    p.git('commit', '-q', '--allow-empty', '-m', 'docs(auth): close the intent');
    const r = all(p);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.branch).toBe(INTENT);
    expect(out.merge_request).toEqual({ into: 'main', url: mr(1) });
    expect(out.stories.map((s: { story: string; branch: string; merge_request: unknown }) => [s.story, s.branch, s.merge_request])).toEqual([
      ['001', S1, { into: INTENT, url: mr(2) }],
      ['002', S2, { into: INTENT, url: mr(3) }],
      ['003', S3, { into: S1, url: mr(4) }],
    ]);
    expect(p.options().map((l) => l.split(' ')[0])).toEqual([INTENT, S1, S2, S3]);
    expect(p.briefFm('merge_request')).toBe(mr(1));
    expect(p.fm('003', 'merge_request')).toBe(mr(4));
  });

  it('on a second run sends nothing new and reads every merge request back', () => {
    const out = run({ intentSlug: 'auth', all: true, cwd: p.app });
    expect(out.merge_request.url).toBe(mr(1));
    expect(out.stories.map((s: { merge_request: { url: string } }) => s.merge_request.url)).toEqual([mr(2), mr(3), mr(4)]);
    expect(p.options()).toHaveLength(4);
  });

  it('leaves a story branch the intent branch holds already', () => {
    const q = project('gitlab');
    q.git('merge', '-q', '--no-ff', '-m', 'Merge story 002', S2);
    const out = run({ intentSlug: 'auth', all: true, cwd: q.app });
    expect(out.stories.find((s: { story: string }) => s.story === '002')).toEqual({
      story: '002', branch: S2, skipped: 'the intent branch holds it already',
    });
    expect(onRemote(q, S2)).toBe('');
    expect(onRemote(q, S1)).toContain(S1);
  });

  it('sends a story stacked on a merged story into the intent branch, and never pushes the merged one again', () => {
    const q = project('gitlab');
    q.git('merge', '-q', '--no-ff', '-m', 'Merge story 001', S1);
    const out = run({ intentSlug: 'auth', all: true, cwd: q.app });
    expect(out.stories.find((s: { story: string }) => s.story === '001')).toMatchObject({ skipped: 'the intent branch holds it already' });
    const s3 = out.stories.find((s: { story: string }) => s.story === '003');
    expect(s3.merge_request.into).toBe(INTENT);
    expect(s3.target).toBeUndefined();
    expect(onRemote(q, S1)).toBe('');
    expect(q.options().map((l) => l.split(' ')[0])).not.toContain(S1);
  });

  it('knows a merged story by its recorded commit when its branch is gone, and stops on one it cannot place', () => {
    const q = project('gitlab');
    const sha = q.git('rev-parse', S1);
    const story1 = path.join(q.app, '.specs-aidlc-turbo/docs/auth/auth/stories/001-s001.md');
    writeFileSync(story1, readFileSync(story1, 'utf8').replace('commit: null', `commit: ${sha}`));
    q.git('merge', '-q', '--no-ff', '-m', 'Merge story 001', S1);
    q.git('branch', '-q', '-D', S1, S2);
    const r = all(q);
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.stories.find((s: { story: string }) => s.story === '001')).toMatchObject({ skipped: 'the intent branch holds it already' });
    const s2 = out.stories.find((s: { story: string }) => s.story === '002');
    expect(s2.push.ok).toBe(false);
    expect(s2.push.error).toContain('no local branch');
  });

  it('exits 1 when a story branch push fails, after the intent branch went out', () => {
    const q = project('gitlab');
    writeFileSync(path.join(q.remote, 'hooks/pre-receive'),
      '#!/bin/sh\nwhile read o n r; do case "$r" in *story-002*) echo "rejected"; exit 1;; esac; done\n');
    chmodSync(path.join(q.remote, 'hooks/pre-receive'), 0o755);
    q.git('commit', '-q', '--allow-empty', '-m', 'docs(auth): close the intent');
    const r = all(q);
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.push.ok).toBe(true);
    expect(out.stories.find((s: { story: string }) => s.story === '002').push.ok).toBe(false);
  });

  it('pushes nothing at all while the intent branch lacks a twin', () => {
    const q = project('gitlab');
    const tests = path.join(q.app, '.specs-aidlc-turbo/docs/auth/auth/tests');
    mkdirSync(tests, { recursive: true });
    writeFileSync(path.join(tests, 'US-001 - Story 001.md'),
      '---\ntest_id: US-001\nintent: auth\ntwin: e2e/aidlc-twins/auth-s001.spec.ts\ntwin_result: passed\n---\n\n# US-001\n');
    const r = all(q);
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.missing_twins).toHaveLength(1);
    expect(out.stories).toEqual([]);
    expect(q.options()).toEqual([]);
    expect(onRemote(q, S1)).toBe('');
  });

  it('pushes only the intent branch when story branches are off', () => {
    const q = project('gitlab', 'story_branches: false\n  base_branch: main\n');
    q.git('commit', '-q', '--allow-empty', '-m', 'docs(auth): close the intent');
    const out = run({ intentSlug: 'auth', all: true, cwd: q.app });
    expect(out.merge_request).toEqual({ into: 'main', url: mr(1) });
    expect(out.stories).toEqual([]);
    expect(q.options()).toHaveLength(1);
  });
});

describe('aidlc-turbo push-branch, the base branch', () => {
  it('uses the remote default branch when base_branch is empty', () => {
    const p = project('gitlab', 'story_branches: false\n');
    p.git('fetch', '-q', 'origin');
    p.git('remote', 'set-head', 'origin', 'main');
    p.git('commit', '-q', '--allow-empty', '-m', 'docs(auth): close the intent');
    const out = push(p);
    expect(out.merge_request.into).toBe('main');
    expect(p.options()[0]).toContain('merge_request.target=main|');
    expect(p.options()[0]).toContain('"User authentication": 3 stories, one commit each, verified and reviewed.');
  });
});

describe('aidlc-turbo push-branch, GitHub', () => {
  it('opens a pull request with gh after the push', () => {
    const p = project('github');
    const bin = path.join(p.base, 'bin');
    mkdirSync(bin);
    writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${p.base}/gh.log"\necho https://github.com/acme/app/pull/7\n`);
    chmodSync(path.join(bin, 'gh'), 0o755);
    const saved = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${saved}`;
    try {
      const out = push(p, '002');
      expect(out.push.ok).toBe(true);
      expect(out.merge_request).toEqual({ into: INTENT, url: 'https://github.com/acme/app/pull/7' });
    } finally {
      process.env.PATH = saved;
    }
    expect(readFileSync(path.join(p.base, 'gh.log'), 'utf8'))
      .toContain(`pr create --head shop/intent-auth/story-002-s002 --title Story 002 --body One story of "User authentication". --base ${INTENT}`);
    expect(execFileSync('git', ['rev-parse', 'shop/intent-auth/story-002-s002'], { cwd: p.remote, encoding: 'utf8' }).trim())
      .toBe(p.git('rev-parse', 'shop/intent-auth/story-002-s002'));
  });
});

describe('aidlc-turbo push-branch, no merge request', () => {
  it('pushes plainly to a remote that refuses push options and says nothing opened', () => {
    const p = project('plain');
    const out = push(p, '002');
    expect(out.push.ok).toBe(true);
    expect(out.merge_request.url).toBeNull();
    expect(out.merge_request.note).toContain('does not open merge requests');
    expect(existsSync(p.remote)).toBe(true);
    expect(execFileSync('git', ['rev-parse', 'shop/intent-auth/story-002-s002'], { cwd: p.remote, encoding: 'utf8' }).trim())
      .toBe(p.git('rev-parse', 'shop/intent-auth/story-002-s002'));
    expect(p.fm('002', 'merge_request')).toBeUndefined();
  });

  it('fails the push without a remote', () => {
    const p = project('none');
    const r = spawnSync('node', [PUSH, 'auth', '--story', '002'], { cwd: p.app, encoding: 'utf8' });
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.push).toMatchObject({ ok: false, error: 'no remote named origin' });
    expect(out.merge_request.note).toContain('no remote');
  });
});
