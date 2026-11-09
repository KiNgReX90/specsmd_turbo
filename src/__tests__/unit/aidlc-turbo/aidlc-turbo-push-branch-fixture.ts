/**
 * Shared fixture of the push-branch tests of the AI-DLC Turbo flow: a git
 * project with the auth intent and stories 001, 002 (independent) and 003 (on
 * 001), each done on its own story branch, and a remote to push to. The fake
 * GitLab is a bare repo whose post-receive hook logs the push options and
 * prints the lines GitLab prints for a new merge request.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';

export const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
export const PUSH = path.join(FLOW, 'scripts/push-branch.cjs');

export const bases: string[] = [];

export const INTENT = 'shop/intent-auth/intent';
export const S1 = 'shop/intent-auth/story-001-s001';
export const S3 = 'shop/intent-auth/story-003-s003';

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
    count=$(wc -l < "$log")
    echo ""
    echo "View merge request for \${ref#refs/heads/}:"
    echo "  https://gitlab.example.com/acme/app/-/merge_requests/$count"
    echo "" ;;
  esac
done
`;

/**
 * A project with stories 001, 002 (independent) and 003 (on 001), all done on
 * their own story branches. `kind`: gitlab (push options and a hook), plain
 * (refuses push options), github (gh after the push) or none (no remote).
 */
export function project(kind: 'gitlab' | 'plain' | 'github' | 'none', config = 'story_branches: true\n  base_branch: main\n') {
  const base = mkdtempSync(path.join(tmpdir(), 'turbo-push-'));
  bases.push(base);
  const app = path.join(base, 'app');
  const specs = path.join(app, '.specs-aidlc-turbo');
  const intent = path.join(specs, 'docs/auth/auth');
  mkdirSync(path.join(intent, 'stories'), { recursive: true });
  mkdirSync(path.join(specs, 'repo'), { recursive: true });
  writeFileSync(path.join(specs, 'repo/config.yaml'), `mode: production\nbranching:\n  project_key: shop\n  ${config}`);
  writeFileSync(path.join(intent, 'brief.md'),
    `---\nid: auth\ntitle: User authentication\nstatus: done\nbranch: ${INTENT}\n---\n\n# User authentication\n`);
  const branches: Record<string, string> = { '001': S1, '002': 'shop/intent-auth/story-002-s002', '003': S3 };
  for (const id of ['001', '002', '003']) {
    const deps = id === '003' ? '["001"]' : '[]';
    writeFileSync(path.join(intent, 'stories', `${id}-s${id}.md`),
      `---\nid: "${id}"\ntitle: Story ${id}\nstatus: done\ndepends_on: ${deps}\ncommit: null\nbranch: ${branches[id]}\n---\n\n# S${id}\n`);
  }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: app, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  writeFileSync(path.join(app, 'app.txt'), 'one\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('switch', '-q', '-c', INTENT);
  for (const id of ['001', '002', '003']) {
    git('switch', '-q', '-c', branches[id], id === '003' ? S1 : INTENT);
    writeFileSync(path.join(app, `s${id}.txt`), `${id}\n`);
    git('add', `s${id}.txt`);
    git('commit', '-q', '-m', `feat(auth): Story ${id} (S${id})`);
  }
  git('switch', '-q', INTENT);

  const remote = path.join(base, kind === 'gitlab' ? 'gitlab-origin.git' : 'origin.git');
  if (kind !== 'none') {
    execFileSync('git', ['init', '-q', '--bare', remote]);
    if (kind === 'gitlab') {
      execFileSync('git', ['config', 'receive.advertisePushOptions', 'true'], { cwd: remote });
      writeFileSync(path.join(remote, 'hooks/post-receive'), HOOK);
      chmodSync(path.join(remote, 'hooks/post-receive'), 0o755);
    }
    if (kind === 'github') {
      git('remote', 'add', 'origin', 'https://github.com/acme/app.git');
      git('config', `url.${remote}.pushInsteadOf`, 'https://github.com/acme/app.git');
    } else {
      git('remote', 'add', 'origin', remote);
    }
    git('push', '-q', 'origin', 'main', INTENT);
    if (kind === 'gitlab') writeFileSync(path.join(remote, 'options.log'), '');
  }
  const file = (id: string) => path.join(intent, 'stories', `${id}-s${id}.md`);
  const fm = (id: string, key: string) => readFileSync(file(id), 'utf8').match(new RegExp(`^${key}: (.*)$`, 'm'))?.[1];
  const briefFm = (key: string) => readFileSync(path.join(intent, 'brief.md'), 'utf8').match(new RegExp(`^${key}: (.*)$`, 'm'))?.[1];
  const options = () => readFileSync(path.join(remote, 'options.log'), 'utf8').trim().split('\n').filter(Boolean);
  return { base, app, git, fm, briefFm, options, remote };
}
