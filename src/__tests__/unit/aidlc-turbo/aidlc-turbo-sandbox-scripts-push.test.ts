/**
 * Unit tests for push-branch.cjs in sandbox mode, on throwaway git repos.
 *
 * Sandbox is production with story branches off; only the end differs, by
 * `branching.sandbox_finish`:
 * - there are no story branches, so --story is refused;
 * - `merge_request`: the intent branch with one merge request into the base
 *   branch, exactly as production with story branches off;
 * - `push` (the default): the intent branch straight onto the base branch with
 *   a plain push and no merge request, after the same twin check. The remote
 *   base must be an ancestor of the intent branch, else nothing is pushed
 *   (`base_moved`). The local base branch follows when it can, and the brief
 *   records `pushed_to_base` (never the commit: a commit cannot hold its own
 *   sha, so it would leave the brief changed). Without a remote the local
 *   base branch is moved and the output says `local_only`.
 *
 * The fake GitLab is a bare repo whose post-receive hook logs the push options
 * and prints the lines GitLab prints for a new merge request.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const PUSH = path.join(FLOW, 'scripts/push-branch.cjs');
const { run } = createRequire(import.meta.url)(PUSH);

const bases: string[] = [];
afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

const INTENT = 'shop/intent-auth/intent';
const MOVED = 'the base branch moved: merge it into the intent branch first';

const HOOK = `#!/bin/sh
log="$(dirname "$0")/../options.log"
n=0; opts=""
while [ "$n" -lt "\${GIT_PUSH_OPTION_COUNT:-0}" ]; do
  eval "o=\\$GIT_PUSH_OPTION_$n"
  opts="$opts$o|"
  n=$((n+1))
done
while read old new ref; do
  echo "\${ref#refs/heads/} $opts" >> "$log"
  case "$opts" in *merge_request.create*)
    echo "View merge request for \${ref#refs/heads/}:"
    echo "  https://gitlab.example.com/acme/app/-/merge_requests/1" ;;
  esac
done
`;

/**
 * A sandbox project with stories 001 and 002 done, one commit each on the
 * intent branch. `remote`: a fake GitLab as origin holding main, or none.
 */
function project(remote: 'gitlab' | 'none', branching = 'base_branch: main\n') {
  const base = mkdtempSync(path.join(tmpdir(), 'turbo-sandbox-push-'));
  bases.push(base);
  const app = path.join(base, 'app');
  const specs = path.join(app, '.specs-aidlc-turbo');
  const intent = path.join(specs, 'docs/auth/auth');
  mkdirSync(path.join(intent, 'stories'), { recursive: true });
  mkdirSync(path.join(specs, 'repo'), { recursive: true });
  writeFileSync(path.join(specs, 'repo/config.yaml'), `mode: sandbox\nbranching:\n  project_key: shop\n  ${branching}`);
  writeFileSync(path.join(intent, 'brief.md'),
    `---\nid: auth\ntitle: User authentication\nstatus: done\nbranch: ${INTENT}\n---\n\n# User authentication\n`);
  for (const id of ['001', '002']) {
    writeFileSync(path.join(intent, 'stories', `${id}-s${id}.md`),
      `---\nid: "${id}"\ntitle: Story ${id}\nstatus: done\ndepends_on: []\ncommit: null\nbranch: null\n---\n\n# S${id}\n`);
  }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: app, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  writeFileSync(path.join(app, 'app.txt'), 'one\n');
  git('add', 'app.txt');
  git('commit', '-q', '-m', 'init');
  git('switch', '-q', '-c', INTENT);
  for (const id of ['001', '002']) {
    writeFileSync(path.join(app, `s${id}.txt`), `${id}\n`);
    git('add', `s${id}.txt`);
    git('commit', '-q', '-m', `feat(auth): Story ${id} (S${id})`);
  }
  git('add', '.specs-aidlc-turbo');
  git('commit', '-q', '-m', 'docs(auth): close the intent');

  const origin = path.join(base, 'origin.git');
  if (remote === 'gitlab') {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['config', 'receive.advertisePushOptions', 'true'], { cwd: origin });
    writeFileSync(path.join(origin, 'hooks/post-receive'), HOOK);
    chmodSync(path.join(origin, 'hooks/post-receive'), 0o755);
    git('remote', 'add', 'origin', origin);
    git('push', '-q', 'origin', 'main');
    writeFileSync(path.join(origin, 'options.log'), '');
  }
  const briefFm = (key: string) => readFileSync(path.join(intent, 'brief.md'), 'utf8').match(new RegExp(`^${key}: (.*)$`, 'm'))?.[1];
  const options = () => readFileSync(path.join(origin, 'options.log'), 'utf8').trim().split('\n').filter(Boolean);
  const onRemote = (ref: string) => {
    const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`], { cwd: origin, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  return { base, app, intent, git, briefFm, options, onRemote, origin };
}

type P = ReturnType<typeof project>;

const cli = (p: P, ...args: string[]) => {
  const r = spawnSync('node', [PUSH, 'auth', ...args], { cwd: p.app, encoding: 'utf8' });
  return { status: r.status, out: JSON.parse(r.stdout) };
};

/** A commit on main of the remote, made in a clone of its own: the base moved. */
function moveRemoteBase(p: P) {
  const other = path.join(p.base, `other-${Date.now()}`);
  execFileSync('git', ['clone', '-q', p.origin, other]);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: other, encoding: 'utf8' }).trim();
  git('config', 'user.email', 'o@example.com');
  git('config', 'user.name', 'Other');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(other, 'other.txt'), 'other\n');
  git('add', 'other.txt');
  git('commit', '-q', '-m', 'feat: someone else');
  git('push', '-q', 'origin', 'main');
  return git('rev-parse', 'HEAD');
}

describe('aidlc-turbo push-branch, sandbox mode has no story branches', () => {
  it('refuses --story', () => {
    const p = project('gitlab');
    const r = cli(p, '--story', '001');
    expect(r.status).toBe(1);
    expect(r.out).toEqual({ error: 'sandbox mode has no story branches' });
    expect(p.options()).toEqual([]);
  });
});

describe('aidlc-turbo push-branch, sandbox with one merge request', () => {
  it('pushes the intent branch with one merge request into the base branch, as production without story branches', () => {
    const p = project('gitlab', 'base_branch: main\n  sandbox_finish: merge_request\n');
    const base = p.git('rev-parse', 'main');
    const r = cli(p);
    expect(r.status).toBe(0);
    expect(r.out.branch).toBe(INTENT);
    expect(r.out.merge_request).toEqual({ into: 'main', url: 'https://gitlab.example.com/acme/app/-/merge_requests/1' });
    expect(r.out.pushed_to_base).toBeUndefined();
    expect(p.options()[0]).toContain(`${INTENT} merge_request.create|merge_request.title=User authentication|merge_request.target=main|`);
    expect(p.options()[0]).toContain('"User authentication": 2 stories, one commit each, verified and reviewed.');
    expect(p.briefFm('merge_request')).toBe(r.out.merge_request.url);
    expect(p.onRemote(INTENT)).toBe(p.git('rev-parse', INTENT));
    expect(p.onRemote('main')).toBe(base);
  });
});

describe('aidlc-turbo push-branch, sandbox straight onto the base branch', () => {
  const p = project('gitlab');

  it('pushes the intent branch onto the base branch plainly, moves the local base and records it in the brief', () => {
    const tip = p.git('rev-parse', INTENT);
    const r = cli(p);
    expect(r.status).toBe(0);
    expect(r.out).toEqual({
      branch: INTENT, into: 'main', push: { ok: true, lines: expect.any(Array) },
      merge_request: null, pushed_to_base: true, commit: tip,
    });
    expect(p.onRemote('main')).toBe(tip);
    expect(p.onRemote(INTENT)).toBeNull();
    expect(p.options()).toHaveLength(1);
    expect(p.options()[0].trim()).toBe('main');
    expect(p.git('rev-parse', 'main')).toBe(tip);
    expect(p.briefFm('pushed_to_base')).toBe('main');
    expect(p.briefFm('pushed_commit')).toBeUndefined();
    expect(p.briefFm('merge_request')).toBeUndefined();
  });

  it('fast-forwards the base branch again with the commit after the Jira step', () => {
    p.git('commit', '-q', '-am', 'docs(auth): link the Jira items');
    const tip = p.git('rev-parse', INTENT);
    const r = run({ intentSlug: 'auth', cwd: p.app });
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ commit: tip, pushed_to_base: true, push: { ok: true } });
    expect(p.onRemote('main')).toBe(tip);
    expect(p.git('rev-parse', 'main')).toBe(tip);
    expect(p.briefFm('pushed_commit')).toBeUndefined();
    // The brief already held pushed_to_base: the last push leaves the tree clean.
    expect(p.git('status', '--porcelain')).toBe('');
  });

  it('pushes nothing when the remote base moved, and lands once it is merged in', () => {
    p.git('commit', '-q', '--allow-empty', '-m', 'docs(auth): one more commit');
    const local = p.git('rev-parse', 'main');
    const theirs = moveRemoteBase(p);
    const r = cli(p);
    expect(r.status).toBe(1);
    expect(r.out).toEqual({ branch: INTENT, into: 'main', error: MOVED, base_moved: true });
    expect(p.onRemote('main')).toBe(theirs);
    expect(p.git('rev-parse', 'main')).toBe(local);
    expect(p.briefFm('pushed_commit')).toBeUndefined();

    // The finish merges the fetched base into the intent branch and pushes again.
    p.git('merge', '-q', '--no-ff', 'origin/main', '-m', 'merge main into the intent branch');
    const tip = p.git('rev-parse', INTENT);
    const again = cli(p);
    expect(again.status).toBe(0);
    expect(again.out).toMatchObject({ commit: tip, pushed_to_base: true });
    expect(p.onRemote('main')).toBe(tip);
    expect(p.git('rev-parse', 'main')).toBe(tip);
  });

  it('leaves a local base with commits of its own where it is, and says so', () => {
    p.git('commit', '-q', '--allow-empty', '-m', 'docs(auth): one more commit again');
    p.git('switch', '-q', 'main');
    p.git('commit', '-q', '--allow-empty', '-m', 'local only');
    const local = p.git('rev-parse', 'main');
    p.git('switch', '-q', INTENT);
    const tip = p.git('rev-parse', INTENT);
    const r = cli(p);
    expect(r.status).toBe(0);
    expect(r.out).toMatchObject({ commit: tip, pushed_to_base: true });
    expect(r.out.note).toContain('main');
    expect(r.out.note).toContain('not moved');
    expect(p.onRemote('main')).toBe(tip);
    expect(p.git('rev-parse', 'main')).toBe(local);
  });
});

describe('aidlc-turbo push-branch, sandbox with the base checked out elsewhere', () => {
  it('pushes, and leaves a local base that another worktree has checked out', () => {
    const p = project('gitlab');
    const wt = path.join(p.base, 'main-tree');
    p.git('worktree', 'add', '-q', wt, 'main');
    const before = p.git('rev-parse', 'main');
    const r = cli(p);
    expect(r.status).toBe(0);
    expect(r.out.note).toContain('checked out');
    expect(p.onRemote('main')).toBe(p.git('rev-parse', INTENT));
    expect(p.git('rev-parse', 'main')).toBe(before);
  });
});

/** A pre-receive hook that moves main on the remote once, while a push is underway. */
const RACE = `#!/bin/sh
cat >/dev/null
[ -f "$GIT_DIR/raced" ] && exit 0
touch "$GIT_DIR/raced"
unset GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
tree=$(git hash-object -w -t tree /dev/null)
c=$(git commit-tree -p refs/heads/main -m race "$tree")
git update-ref refs/heads/main "$c"
`;

describe('aidlc-turbo push-branch, sandbox with a remote that moves during the push', () => {
  it('says the base moved, not that the push was refused, so finish can merge it in', () => {
    const p = project('gitlab');
    writeFileSync(path.join(p.origin, 'hooks/pre-receive'), RACE);
    chmodSync(path.join(p.origin, 'hooks/pre-receive'), 0o755);
    const local = p.git('rev-parse', 'main');
    const r = cli(p);
    expect(r.status).toBe(1);
    expect(r.out).toEqual({ branch: INTENT, into: 'main', error: MOVED, base_moved: true });
    expect(p.git('rev-parse', 'main')).toBe(local);
    expect(p.briefFm('pushed_to_base')).toBeUndefined();
    // Fetched again: the merge finish runs next takes in the commit that raced the push.
    expect(spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', INTENT], { cwd: p.app }).status).toBe(1);
  });
});

describe('aidlc-turbo push-branch, sandbox without a remote', () => {
  it('moves the local base branch only and says nothing was pushed', () => {
    const p = project('none');
    const tip = p.git('rev-parse', INTENT);
    const r = cli(p);
    expect(r.status).toBe(0);
    expect(r.out).toEqual({
      branch: INTENT, into: 'main', push: { ok: true, lines: [], local_only: true },
      merge_request: null, pushed_to_base: true, commit: tip,
    });
    expect(p.git('rev-parse', 'main')).toBe(tip);
    expect(p.briefFm('pushed_to_base')).toBe('main');
    expect(p.briefFm('pushed_commit')).toBeUndefined();
  });

  it('moves nothing when the local base moved', () => {
    const p = project('none');
    p.git('switch', '-q', 'main');
    p.git('commit', '-q', '--allow-empty', '-m', 'hotfix on main');
    const local = p.git('rev-parse', 'main');
    p.git('switch', '-q', INTENT);
    const r = cli(p);
    expect(r.status).toBe(1);
    expect(r.out).toEqual({ branch: INTENT, into: 'main', error: MOVED, base_moved: true });
    expect(p.git('rev-parse', 'main')).toBe(local);
    expect(p.briefFm('pushed_to_base')).toBeUndefined();
  });
});

describe('aidlc-turbo push-branch, sandbox checks first', () => {
  it('refuses, and pushes nothing, while a test case names a twin the intent branch does not hold', () => {
    const p = project('gitlab');
    const tests = path.join(p.intent, 'tests');
    mkdirSync(tests, { recursive: true });
    writeFileSync(path.join(tests, 'US-001 - Story 001.md'),
      '---\ntest_id: US-001\nintent: auth\ntwin: e2e/aidlc-twins/auth-s001.spec.ts\n---\n\n# US-001\n');
    const base = p.onRemote('main');
    const r = cli(p);
    expect(r.status).toBe(1);
    expect(r.out.error).toContain('test cases name twins the intent branch does not hold');
    expect(r.out.missing_twins).toHaveLength(1);
    expect(p.onRemote('main')).toBe(base);
    expect(p.briefFm('pushed_to_base')).toBeUndefined();
  });

  it('takes the remote default branch when base_branch is empty, and stops without any base', () => {
    const p = project('gitlab', 'base_branch: ""\n');
    const none = cli(p);
    expect(none.status).toBe(1);
    expect(none.out.error).toContain('no base branch');
    expect(p.options()).toEqual([]);
    p.git('fetch', '-q', 'origin');
    p.git('remote', 'set-head', 'origin', 'main');
    const r = cli(p);
    expect(r.status).toBe(0);
    expect(r.out).toMatchObject({ into: 'main', pushed_to_base: true });
    expect(p.onRemote('main')).toBe(p.git('rev-parse', INTENT));
  });
});
