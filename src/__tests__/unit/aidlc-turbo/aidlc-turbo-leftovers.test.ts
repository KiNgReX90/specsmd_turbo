/**
 * Unit tests for leftovers.cjs of the AI-DLC Turbo flow, on throwaway git repos,
 * and for its place at the start of a new inception.
 *
 * On a real run a new Turbo inception started on the base branch of a repo that
 * still held an old AI-DLC memory bank and a finished Turbo inception folder.
 * Nothing warned, and they were removed by hand. So a new inception starts with:
 * - a report of the leftovers: the old AI-DLC paths at the project root (the
 *   memory bank and the FIRE folder, nothing that belongs to another tool), and
 *   every Turbo inception whose intents are all done. An inception with an
 *   intent that is still draft, approved or building, one that has no intent
 *   yet, or a done intent of the branch the user is on, is open work: named
 *   with how to continue it, never removable. repo/, project/ and a plain
 *   docs/ folder are never named;
 * - --remove: tracked paths go with git rm, untracked ones from disk, and the
 *   removal is one local pathspec commit that leaves other staged work alone,
 *   never pushed. Sandbox mode commits as production does, since both use
 *   git; without git: from disk, no commit. Open work is
 *   refused, also by id, and then nothing is removed;
 * - the remove says whether the commit goes along: the intent branch is cut
 *   from the base branch, so only a commit on that branch goes along.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/leftovers.cjs');
const DOCS = '.specs-aidlc-turbo/docs';
const MESSAGE = 'chore: remove leftovers of earlier AI-DLC work';

const bases: string[] = [];
afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Write one file, creating its folder. */
function put(root: string, file: string, text = 'x\n') {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

/** One intent: a record, and a brief with this status unless it is null. */
function intent(app: string, inception: string, slug: string, status: string | null, branch?: string) {
  const dir = `${DOCS}/${inception}/${slug}`;
  put(app, `${dir}/record.yaml`, `intent:\n  slug: ${slug}\n  inception: ${inception}\n`);
  if (status) {
    put(app, `${dir}/brief.md`, ['---', `id: ${slug}`, `status: ${status}`, `branch: ${branch ?? 'null'}`, '---', '', `# ${slug}`, ''].join('\n'));
  }
}

type Options = { mode?: string; git?: boolean; base?: string; branch?: string; remote?: boolean };

/**
 * A project with the shared Turbo folders, a plain docs/ folder and some code.
 * `setup` adds the leftovers before the first commit; `after` adds what stays
 * untracked.
 */
function project(setup: (app: string) => void, opts: Options = {}, after?: (app: string) => void) {
  const { mode = 'production', git: useGit = true, base = 'development', branch = base, remote = false } = opts;
  const dir = mkdtempSync(path.join(tmpdir(), 'turbo-leftovers-'));
  bases.push(dir);
  const app = path.join(dir, 'app');
  put(app, '.specs-aidlc-turbo/repo/config.yaml', `mode: ${mode}\nbranching:\n  project_key: shop\n  base_branch: ${base}\n`);
  put(app, '.specs-aidlc-turbo/repo/repo.yaml', 'codebase:\n  scanned_at: 2026-10-20T08:00:00Z\n');
  put(app, '.specs-aidlc-turbo/project/project.yaml', 'project_type: other\n');
  put(app, '.specs-aidlc-turbo/project/pages/index.md', '# Project Documentation\n');
  put(app, 'docs/handleiding.md', '# Handleiding\n');
  put(app, 'src/app.txt', 'one\n');
  setup(app);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: app, encoding: 'utf8' }).trim();
  if (useGit) {
    git('init', '-q', '-b', base);
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.hooksPath', '/dev/null');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    if (remote) {
      execFileSync('git', ['init', '-q', '--bare', path.join(dir, 'origin.git')]);
      git('remote', 'add', 'origin', path.join(dir, 'origin.git'));
      git('push', '-q', '-u', 'origin', base);
    }
    if (branch !== base) git('switch', '-q', '-c', branch);
  }
  after?.(app);
  return { app, git, dir };
}

const run = (cwd: string, ...args: string[]) => spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
const json = (cwd: string, ...args: string[]) => {
  const r = run(cwd, ...args, '--json');
  return { status: r.status, out: JSON.parse(r.stdout) };
};
const lines = (text: string) => text.trim().split('\n');

/** The old AI-DLC memory bank at the root, tracked. */
function oldAidlc(app: string) {
  put(app, 'memory-bank/intents/001-giftcards/bolts/bolt-1.md');
  put(app, 'memory-bank/standards/tech-stack.md');
}

describe('aidlc-turbo leftovers.cjs: the report', () => {
  it('says "No leftovers." when there is nothing, and never names repo/, project/ or a plain docs/ folder', () => {
    const { app } = project(() => {});
    const r = run(app);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('No leftovers.');
    expect(json(app).out).toMatchObject({ leftovers: [], open: [], lines: [] });
  });

  it('names every old AI-DLC path at the root, with whether it is in git', () => {
    const { app } = project(oldAidlc, {}, (a) => put(a, '.specs-fire/intents/one/brief.md'));
    const r = run(app);
    expect(r.status).toBe(0);
    expect(lines(r.stdout)).toEqual([
      'leftover memory-bank: old AI-DLC work, in git',
      'leftover .specs-fire: old FIRE work, not in git',
    ]);
  });

  it('names only the old AI-DLC paths, never a folder of another tool such as .tests', () => {
    const { app } = project((a) => { oldAidlc(a); put(a, '.tests/US-001.md'); });
    expect(lines(run(app).stdout)).toEqual(['leftover memory-bank: old AI-DLC work, in git']);
    expect(run(app, '--remove', '.tests').status).toBe(1);
    expect(existsSync(path.join(app, '.tests/US-001.md'))).toBe(true);
  });

  it('a finished Turbo inception is a leftover; open Turbo work is named with how to continue it', () => {
    const { app } = project((a) => {
      intent(a, 'giftcards', 'giftcards', 'done', 'shop/intent-giftcards/intent');
      put(a, `${DOCS}/giftcards/pages/documentation.md`);
      intent(a, 'drafty', 'drafty', null);
      put(a, `${DOCS}/drafty/pages/documentation.md`);
      intent(a, 'review', 'review', 'draft');
      intent(a, 'mixed', 'one', 'done');
      intent(a, 'mixed', 'two', 'building');
      put(a, `${DOCS}/pulled/sync.yaml`, 'confluence: {}\n');
    });
    const { status, out } = json(app);
    expect(status).toBe(0);
    expect(out.leftovers).toEqual([{
      id: `${DOCS}/giftcards`,
      kind: 'turbo',
      what: 'finished Turbo inception (giftcards done)',
      tracked: true,
      inception: 'giftcards',
      intents: [{ slug: 'giftcards', status: 'done' }],
    }]);
    expect(out.open.map((o: any) => [o.id, o.continue])).toEqual([
      [`${DOCS}/drafty`, '/specsmd-aidlc-turbo-inception'],
      [`${DOCS}/mixed`, '/specsmd-aidlc-turbo-construction two'],
      [`${DOCS}/pulled`, '/specsmd-aidlc-turbo-inception'],
      [`${DOCS}/review`, '/specsmd-aidlc-turbo-inception'],
    ]);
    expect(out.open[0].intents).toEqual([{ slug: 'drafty', status: 'draft' }]);
    expect(lines(run(app).stdout)).toEqual([
      `leftover ${DOCS}/giftcards: finished Turbo inception (giftcards done), in git`,
      `open ${DOCS}/drafty: Turbo inception still open (drafty draft), continue with /specsmd-aidlc-turbo-inception`,
      `open ${DOCS}/mixed: Turbo inception still open (one done, two building), continue with /specsmd-aidlc-turbo-construction two`,
      `open ${DOCS}/pulled: Turbo inception started, no intent yet, continue with /specsmd-aidlc-turbo-inception`,
      `open ${DOCS}/review: Turbo inception still open (review draft), continue with /specsmd-aidlc-turbo-inception`,
    ]);
  });

  it('a done intent of the branch the user is on is open work, also on one of its story branches', () => {
    const own = 'shop/intent-auth/intent';
    for (const branch of [own, 'shop/intent-auth/story-001-login']) {
      const { app } = project((a) => intent(a, 'auth', 'auth', 'done', own), { branch });
      const { out } = json(app);
      expect(out.leftovers).toEqual([]);
      expect(out.open).toHaveLength(1);
      expect(run(app).stdout.trim()).toBe(
        `open ${DOCS}/auth: Turbo inception of this branch (auth done), continue with /specsmd-aidlc-turbo-construction auth`,
      );
    }
  });

  it('--json carries the mode, the branch and whether it is the base branch', () => {
    const { app } = project(oldAidlc, { branch: 'feature/x' });
    const { out } = json(app);
    expect(out).toMatchObject({ mode: 'production', git: true, branch: 'feature/x', base_branch: 'development', on_base: false });
    expect(out.leftovers.map((l: any) => [l.id, l.kind, l.tracked])).toEqual([
      ['memory-bank', 'aidlc', true],
    ]);
    expect(out.lines).toEqual(lines(run(app).stdout));
  });

  it('stops on the old Turbo layout with the move instruction', () => {
    const { app } = project((a) => put(a, '.specs-aidlc-turbo/intents/x/brief.md'));
    const r = run(app);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('migrate-layout.cjs --write');
  });
});

describe('aidlc-turbo leftovers.cjs: --remove', () => {
  it('removes every leftover in one pathspec commit, leaves staged work and open work alone, and never pushes', () => {
    const { app, git } = project((a) => {
      oldAidlc(a);
      intent(a, 'giftcards', 'giftcards', 'done');
      intent(a, 'drafty', 'drafty', 'draft');
    }, { remote: true }, (a) => {
      put(a, '.specs-fire/intents/one/brief.md');
      put(a, 'memory-bank/scratch.md');
      put(a, `${DOCS}/giftcards/pages/new.md`);
    });
    writeFileSync(path.join(app, 'src/app.txt'), 'two\n');
    git('add', 'src/app.txt');
    const head = git('rev-parse', 'HEAD');

    const r = run(app, '--remove');
    expect(r.status, r.stderr).toBe(0);
    const sha = git('rev-parse', '--short', 'HEAD');
    expect(lines(r.stdout)).toEqual([
      'removed memory-bank, in git',
      'removed .specs-fire, not in git',
      `removed ${DOCS}/giftcards, in git`,
      `commit ${sha} on development, not pushed: ${MESSAGE}`,
      'development is the base branch: the intent branch is cut from it, so this commit goes along',
    ]);
    // Exactly one commit, holding only the removal.
    expect(git('rev-parse', 'HEAD~1')).toBe(head);
    expect(git('log', '-1', '--format=%s')).toBe(MESSAGE);
    const files = lines(git('show', '--name-status', '--format=', 'HEAD'));
    expect(files.every((f) => f.startsWith('D\t'))).toBe(true);
    expect(files.some((f) => f.includes('src/app.txt'))).toBe(false);
    // The staged work is still staged, and nothing else is.
    expect(git('diff', '--cached', '--name-only')).toBe('src/app.txt');
    // Gone from disk, tracked and untracked alike; the rest stays.
    for (const p of ['memory-bank', '.specs-fire', `${DOCS}/giftcards`]) {
      expect(existsSync(path.join(app, p)), p).toBe(false);
    }
    for (const p of [`${DOCS}/drafty/drafty/brief.md`, '.specs-aidlc-turbo/repo/config.yaml', '.specs-aidlc-turbo/project/pages/index.md', 'docs/handleiding.md']) {
      expect(existsSync(path.join(app, p)), p).toBe(true);
    }
    // Never pushed.
    expect(git('rev-parse', 'origin/development')).toBe(head);
    expect(git('ls-remote', 'origin', 'refs/heads/development').split('\t')[0]).toBe(head);
  });

  it('removes only the ids it is given, with or without a trailing slash', () => {
    const { app, git } = project((a) => {
      oldAidlc(a);
      put(a, '.specs-fire/intents/one/brief.md');
      intent(a, 'old', 'old', 'done');
    });
    const { status, out } = json(app, '--remove', 'memory-bank/', './.specs-fire');
    expect(status).toBe(0);
    expect(out.removed).toEqual([{ id: 'memory-bank', tracked: true }, { id: '.specs-fire', tracked: true }]);
    expect(out.commit).toMatchObject({ branch: 'development', message: MESSAGE });
    expect(git('rev-parse', '--short', 'HEAD')).toBe(out.commit.sha);
    expect(out.on_base).toBe(true);
    expect(existsSync(path.join(app, `${DOCS}/old/old/brief.md`))).toBe(true);
    expect(lines(git('show', '--name-only', '--format=', 'HEAD')).sort()).toEqual([
      '.specs-fire/intents/one/brief.md', 'memory-bank/intents/001-giftcards/bolts/bolt-1.md', 'memory-bank/standards/tech-stack.md',
    ]);
  });

  it('refuses open Turbo work, also by id, and then removes nothing', () => {
    const { app, git } = project((a) => {
      oldAidlc(a);
      intent(a, 'drafty', 'drafty', 'approved');
    });
    const head = git('rev-parse', 'HEAD');
    const r = run(app, '--remove', `${DOCS}/drafty`, 'memory-bank');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${DOCS}/drafty is open Turbo work (drafty approved), never removed: continue with /specsmd-aidlc-turbo-construction drafty`);
    expect(existsSync(path.join(app, `${DOCS}/drafty/drafty/brief.md`))).toBe(true);
    expect(existsSync(path.join(app, 'memory-bank'))).toBe(true);
    expect(git('rev-parse', 'HEAD')).toBe(head);
    // A plain --remove leaves it alone too.
    expect(run(app, '--remove').status).toBe(0);
    expect(existsSync(path.join(app, `${DOCS}/drafty/drafty/brief.md`))).toBe(true);
  });

  it('refuses an id that is not a leftover, such as the repo layer or a plain folder', () => {
    const { app } = project(oldAidlc);
    for (const id of ['.specs-aidlc-turbo/repo', '.specs-aidlc-turbo/project', 'docs', 'src', '.specs-fire']) {
      const r = run(app, '--remove', id);
      expect(r.status, id).toBe(1);
      expect(r.stderr, id).toContain(`not a leftover: ${id}`);
    }
    expect(existsSync(path.join(app, 'memory-bank'))).toBe(true);
  });

  it('removes untracked leftovers from disk without a commit', () => {
    const { app, git } = project(() => {}, {}, (a) => {
      put(a, '.specs-fire/intents/one/brief.md');
      intent(a, 'old', 'old', 'done');
    });
    const head = git('rev-parse', 'HEAD');
    const r = run(app, '--remove');
    expect(r.status).toBe(0);
    expect(lines(r.stdout)).toEqual([
      'removed .specs-fire, not in git',
      `removed ${DOCS}/old, not in git`,
      'no commit: nothing removed was in git',
    ]);
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(existsSync(path.join(app, '.specs-fire'))).toBe(false);
  });

  it('sandbox mode commits the removal as production does: both use git', () => {
    const { app, git } = project(oldAidlc, { mode: 'sandbox' });
    const head = git('rev-parse', 'HEAD');
    expect(lines(run(app).stdout)[0]).toBe('leftover memory-bank: old AI-DLC work, in git');
    const { status, out } = json(app, '--remove');
    expect(status).toBe(0);
    expect(out.commit.sha).toBe(git('rev-parse', '--short', 'HEAD'));
    expect(out.commit.message).toBe('chore: remove leftovers of earlier AI-DLC work');
    expect(git('rev-parse', 'HEAD~1')).toBe(head);
    expect(git('log', '-1', '--format=%s')).toBe('chore: remove leftovers of earlier AI-DLC work');
    expect(existsSync(path.join(app, 'memory-bank'))).toBe(false);
    // The working tree is clean again: construction needs that in both modes.
    expect(git('status', '--porcelain')).toBe('');
  });

  it('without a git repository removes from disk and commits nothing', () => {
    const { app } = project(oldAidlc, { git: false });
    const r = run(app, '--remove');
    expect(r.status).toBe(0);
    expect(lines(r.stdout)).toEqual([
      'removed memory-bank',
      'no commit: not a git repository',
    ]);
    expect(existsSync(path.join(app, 'memory-bank'))).toBe(false);
  });

  it('off the base branch, says the commit stays on this branch', () => {
    const { app } = project(oldAidlc, { branch: 'feature/x' });
    const r = run(app, '--remove', 'memory-bank');
    expect(r.status).toBe(0);
    expect(lines(r.stdout).at(-1)).toBe(
      'the base branch is development, not feature/x: this commit stays on feature/x until you push or merge it',
    );
  });

  it('says "Nothing to remove." when there is nothing', () => {
    const { app } = project(() => {});
    const r = run(app, '--remove');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('Nothing to remove.');
  });
});

describe('aidlc-turbo leftovers in the inception', () => {
  const read = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8');
  const flat = (rel: string) => read(rel).replace(/\s+/g, ' ');

  it('intake checks for leftovers first, only for a new inception, before the scan and the pull', () => {
    const intake = flat('skills/inception/intake.md');
    const step = intake.indexOf('### 0. Leftovers of earlier work');
    expect(step).toBeGreaterThan(-1);
    expect(step).toBeLessThan(intake.indexOf('### 1. Load the project'));
    expect(step).toBeLessThan(intake.indexOf('codebase-scan.cjs'));
    expect(step).toBeLessThan(intake.indexOf('skills/sync/confluence.md'));
    const section = intake.slice(step, intake.indexOf('### 1. Load the project'));
    expect(section).toContain('node .specsmd/aidlc-turbo/scripts/leftovers.cjs --json');
    expect(section).toContain('node .specsmd/aidlc-turbo/scripts/leftovers.cjs --remove');
    expect(section).toContain('Resuming a draft intent skips this step');
    expect(section).toContain('Nothing named: say nothing');
    expect(section).toContain('never offered for removal');
    expect(section).toContain('**Clean them up**');
    expect(section).toContain('**Leave them**');
    expect(section).toContain('in the session language');
    expect(section).toContain('the host\'s multiple-choice prompt');
    // What the user hears about the commit is what the script found.
    expect(section).toContain('a local commit on the current branch');
    expect(section).toContain('never pushed');
    expect(section).toContain('`on_base`');
  });

  it('the agent, the command and the docs name the check', () => {
    expect(flat('agents/inception-agent.md')).toContain('leftovers.cjs');
    expect(flat('commands/aidlc-turbo-inception.md')).toContain('leftovers of earlier work');
    for (const rel of ['README.md', 'quick-start.md', 'skills/master/explain-flow.md']) {
      expect(flat(rel), rel).toMatch(/leftovers of earlier work/i);
    }
    expect(read('PRD.md')).toMatch(/^\| `leftovers\.cjs` \|/m);
    expect(read('README.md')).toMatch(/^\| `leftovers\.cjs` \|/m);
  });
});
