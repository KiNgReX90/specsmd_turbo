/**
 * Unit tests for push-branch.cjs of the AI-DLC Turbo flow: a later
 * push of a branch whose merge request is open leaves its title and
 * description alone.
 *
 * GitLab applies the title and the description of the push options to a merge
 * request that is already open for the branch, so every later push (finish
 * step 10's second push, a review fix, finish again) reset the full
 * description to the one line.
 *
 * - a merge request recorded in the story file or the brief that is open: a
 *   plain push, no push options at all, and the recorded link stays;
 * - one whose state cannot be read (no GITLAB_TOKEN, no network, not a GitLab
 *   link): the same plain push;
 * - one that is merged or closed: the push options as before, so a new merge
 *   request opens and is recorded;
 * - none recorded: the push options as before, and no lookup at all.
 *
 * The state lookup is a fake: no test asks the real GitLab.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { rmSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { PUSH, INTENT, S1, S3, bases, project } from './aidlc-turbo-push-branch-fixture';

const req = createRequire(import.meta.url);
const { run, requestState } = req(PUSH);

afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

const S2 = 'shop/intent-auth/story-002-s002';
const mr = (n: number) => `https://gitlab.example.com/acme/app/-/merge_requests/${n}`;

/** A fake lookup that answers `state` and remembers every link it was asked. */
function lookup(state: string | null) {
  const asked: string[] = [];
  return { asked, mrState: (url: string) => { asked.push(url); return state; } };
}

/** One new commit on `branch`, without switching to it. */
function advance(p: ReturnType<typeof project>, branch: string) {
  const sha = p.git('commit-tree', `${branch}^{tree}`, '-p', branch, '-m', `fix: one more commit on ${branch}`);
  p.git('update-ref', `refs/heads/${branch}`, sha);
}

/** The push options GitLab got for the n-th push, by branch: '' when there were none. */
const sent = (p: ReturnType<typeof project>, n: number) => p.options()[n].split(' ').slice(1).join(' ');

describe('aidlc-turbo push-branch, a story branch whose merge request is open', () => {
  const p = project('gitlab');
  const first = lookup('opened');

  it('opens the merge request on the first push without asking anything', () => {
    const out = run({ intentSlug: 'auth', story: '002', cwd: p.app, mrState: first.mrState });
    expect(out.merge_request).toEqual({ into: INTENT, url: mr(1) });
    expect(sent(p, 0)).toContain('merge_request.create|');
    expect(first.asked).toEqual([]);
  });

  it('pushes the new commits of a later push with no push options at all, so the title and description stay', () => {
    advance(p, S2);
    const open = lookup('opened');
    const out = run({ intentSlug: 'auth', story: '002', cwd: p.app, mrState: open.mrState });
    expect(out.push.ok).toBe(true);
    expect(out.merge_request).toEqual({ into: INTENT, url: mr(1) });
    expect(open.asked).toEqual([mr(1)]);
    expect(p.options()).toHaveLength(2);
    expect(p.options()[1].split(' ')[0]).toBe(S2);
    expect(sent(p, 1)).toBe('');
    expect(p.fm('002', 'merge_request')).toBe(mr(1));
    expect(p.git('ls-remote', 'origin', S2).split('\t')[0]).toBe(p.git('rev-parse', S2));
  });

  it('asks nothing when the push sends nothing', () => {
    const open = lookup('opened');
    const out = run({ intentSlug: 'auth', story: '002', cwd: p.app, mrState: open.mrState });
    expect(out.merge_request.url).toBe(mr(1));
    expect(open.asked).toEqual([]);
  });
});

describe('aidlc-turbo push-branch, the intent branch whose merge request is open', () => {
  it('sends no push options on the second push of finish step 10', () => {
    const p = project('gitlab', 'story_branches: false\n  base_branch: main\n');
    p.git('commit', '-q', '--allow-empty', '-m', 'docs(auth): close the intent');
    const first = run({ intentSlug: 'auth', cwd: p.app, mrState: lookup('opened').mrState });
    expect(first.merge_request).toEqual({ into: 'main', url: mr(1) });
    p.git('commit', '-q', '--allow-empty', '-m', 'docs(auth): record the merge request and the Jira sync');
    const open = lookup('opened');
    const out = run({ intentSlug: 'auth', cwd: p.app, mrState: open.mrState });
    expect(out.merge_request).toEqual({ into: 'main', url: mr(1) });
    expect(open.asked).toEqual([mr(1)]);
    expect(sent(p, 1)).toBe('');
    expect(p.briefFm('merge_request')).toBe(mr(1));
  });

  it('sends no push options for any branch when --all runs again with new commits (finish again)', () => {
    const p = project('gitlab');
    p.git('commit', '-q', '--allow-empty', '-m', 'docs(auth): close the intent');
    const once = run({ intentSlug: 'auth', all: true, cwd: p.app, mrState: lookup('opened').mrState });
    expect(once.stories.map((s: { merge_request: { url: string } }) => s.merge_request.url)).toEqual([mr(2), mr(3), mr(4)]);
    for (const branch of [INTENT, S1, S2, S3]) advance(p, branch);
    const open = lookup('opened');
    const again = run({ intentSlug: 'auth', all: true, cwd: p.app, mrState: open.mrState });
    expect(again.merge_request.url).toBe(mr(1));
    expect(again.stories.map((s: { merge_request: { url: string } }) => s.merge_request.url)).toEqual([mr(2), mr(3), mr(4)]);
    expect(open.asked).toEqual([mr(1), mr(2), mr(3), mr(4)]);
    expect(p.options().slice(4).map((l) => l.split(' ')[0])).toEqual([INTENT, S1, S2, S3]);
    for (let n = 4; n < 8; n += 1) expect(sent(p, n)).toBe('');
  });
});

describe('aidlc-turbo push-branch, a recorded merge request whose state cannot be read', () => {
  it('pushes plainly and keeps the recorded link', () => {
    const p = project('gitlab');
    run({ intentSlug: 'auth', story: '002', cwd: p.app, mrState: lookup(null).mrState });
    advance(p, S2);
    const unknown = lookup(null);
    const out = run({ intentSlug: 'auth', story: '002', cwd: p.app, mrState: unknown.mrState });
    expect(out.push.ok).toBe(true);
    expect(out.merge_request).toEqual({ into: INTENT, url: mr(1) });
    expect(unknown.asked).toEqual([mr(1)]);
    expect(sent(p, 1)).toBe('');
  });

  it('reads no state from a link that is not a GitLab merge request, without asking anyone', () => {
    expect(requestState('https://github.com/acme/app/pull/7', tmpdir())).toBeNull();
  });
});

describe('aidlc-turbo push-branch, a recorded merge request that is merged or closed', () => {
  it.each(['merged', 'closed'])('%s: sends the push options, so a new one opens and is recorded', (state) => {
    const p = project('gitlab');
    run({ intentSlug: 'auth', story: '002', cwd: p.app, mrState: lookup('opened').mrState });
    advance(p, S2);
    const done = lookup(state);
    const out = run({ intentSlug: 'auth', story: '002', cwd: p.app, mrState: done.mrState });
    expect(done.asked).toEqual([mr(1)]);
    expect(sent(p, 1)).toBe(`merge_request.create|merge_request.title=Story 002|merge_request.target=${INTENT}|`
      + 'merge_request.description=One story of "User authentication".|');
    expect(out.merge_request).toEqual({ into: INTENT, url: mr(2) });
    expect(p.fm('002', 'merge_request')).toBe(mr(2));
  });
});

describe('aidlc-turbo push-branch, no merge request recorded', () => {
  it('sends the push options as before and asks nothing', () => {
    const p = project('gitlab');
    const none = lookup('opened');
    const out = run({ intentSlug: 'auth', story: '002', cwd: p.app, mrState: none.mrState });
    expect(none.asked).toEqual([]);
    expect(sent(p, 0)).toBe(`merge_request.create|merge_request.title=Story 002|merge_request.target=${INTENT}|`
      + 'merge_request.description=One story of "User authentication".|');
    expect(out.merge_request).toEqual({ into: INTENT, url: mr(1) });
  });
});
