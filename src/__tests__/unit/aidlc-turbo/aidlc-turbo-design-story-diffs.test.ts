/**
 * Unit tests for the change of a file per story (lib/design-story-diffs.cjs), on throwaway git repos: a file
 * that more than one story changed carries, beside its whole change, what each story did to it, as GitLab
 * shows it per merge request:
 * - a story's commits are those since the base whose subject ends in "(S001)" (feat and fix alike), never a
 *   merge, also when they came in from a story branch;
 * - per story the diff of each of its commits to that file, one after the other, added and removed summed;
 * - a file only one story changed gets none; an omitted file gets none; past the page's budget none;
 * - the Review tab offers "All" and a button per story above such a change, and shows the story's own.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import { reviewDom, reviewModel, mountReview } from './aidlc-turbo-design-review-fixture';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const { designDiffs } = req(path.join(FLOW, 'scripts/lib/design-diffs.cjs'));
const { storyCommits } = req(path.join(FLOW, 'scripts/lib/design-story-diffs.cjs'));

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const ROOT = '.specs-aidlc-turbo';
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

/** A repo on main with A and B; on the intent branch story 1 changes A and B, story 2 changes A, then a fix of story 1 changes A. */
function built() {
  const app = mkdtempSync(path.join(tmpdir(), 'turbo-story-diffs-'));
  dirs.push(app);
  const git = (...a: string[]) => execFileSync('git', a, { cwd: app, encoding: 'utf8' }).trim();
  const write = (f: string, body: string) => { mkdirSync(path.dirname(path.join(app, f)), { recursive: true }); writeFileSync(path.join(app, f), body); };
  git('init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 'Test'], ['commit.gpgsign', 'false'], ['core.hooksPath', '/dev/null']]) git('config', k, v);
  write(`${ROOT}/repo/config.yaml`, 'mode: production\nbranching:\n  base_branch: main\n');
  write('.gitignore', `${ROOT}/\n`);
  write('src/A.java', lines(30));
  write('src/B.java', lines(5));
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('switch', '-q', '-c', 'shop/intent-x/intent');
  const edit = (f: string, from: string, to: string) => { const p = path.join(app, f); writeFileSync(p, require('fs').readFileSync(p, 'utf8').replace(from, to)); };
  edit('src/A.java', 'line 2\n', 'line 2 by story 1\n');
  edit('src/B.java', 'line 1\n', 'line 1 by story 1\n');
  git('commit', '-qam', 'feat(x): first (S001)');
  // story 2 on a story branch of its own, merged in
  git('switch', '-q', '-c', 'shop/intent-x/s002');
  edit('src/A.java', 'line 20\n', 'line 20 by story 2\n');
  git('commit', '-qam', 'feat(x): second (S002)');
  git('switch', '-q', 'shop/intent-x/intent');
  git('merge', '-q', '--no-ff', '-m', 'Merge branch s002', 'shop/intent-x/s002');
  edit('src/A.java', 'line 28\n', 'line 28 fixed by story 1\n');
  git('commit', '-qam', 'fix(x): first (S001)');
  git('commit', '-q', '--allow-empty', '-m', 'docs(x): S001 done');
  return { app, git };
}
const PARTS = [{ id: 'a', path: 'src/A.java' }, { id: 'b', path: 'src/B.java' }];

describe('aidlc-turbo design diffs: per story', () => {
  it('a story\'s commits: the subject ends in (S001), feat or fix, never a merge, also from a story branch', () => {
    const r = built();
    const base = r.git('merge-base', 'HEAD', 'main');
    const by = storyCommits(r.app, base);
    expect([...by.keys()].sort()).toEqual(['001', '002']);
    expect(by.get('001')).toHaveLength(2);
    expect(by.get('002')).toHaveLength(1);
  });

  it('a file more than one story changed: per story the diff of each of its commits, one after the other', () => {
    const r = built();
    const diffs = designDiffs(PARTS, { cwd: r.app, root: ROOT });
    const a = diffs['src/A.java'];
    expect(a.text).toContain('+line 20 by story 2');
    expect(Object.keys(a.stories).sort()).toEqual(['001', '002']);
    const one = a.stories['001'], two = a.stories['002'];
    expect(one.text).toContain('+line 2 by story 1');
    expect(one.text).toContain('+line 28 fixed by story 1');
    expect(one.text).not.toContain('story 2');
    expect(one.text.match(/^@@/gm)).toHaveLength(2);
    expect([one.added, one.removed]).toEqual([2, 2]);
    expect(two.text).toContain('+line 20 by story 2');
    expect(two.text).not.toContain('story 1');
    expect([two.added, two.removed]).toEqual([1, 1]);
  });

  it('a file only one story changed gets none', () => {
    const r = built();
    expect(designDiffs(PARTS, { cwd: r.app, root: ROOT })['src/B.java'].stories).toBeUndefined();
  });
});

describe('aidlc-turbo Review: the change per story', () => {
  let d: any;
  beforeEach(() => { d = reviewDom(); });
  const withStories = () => {
    const m: any = reviewModel();
    const p = m.parts.find((x: any) => x.id === 'loop');
    p.stories = ['001', '002'];
    const e = m.build.diffs[p.path];
    e.stories = { '001': { text: '@@ -1,1 +1,1 @@\n-old one\n+new one', added: 1, removed: 1, truncated: 0 },
      '002': { text: '@@ -9,1 +9,1 @@\n-old two\n+new two', added: 1, removed: 1, truncated: 0 } };
    return m;
  };
  const code = (v: any) => d.all(v.box, 'td-rv-code')[0].textContent;

  it('"All" and a button per story above the change; a story shows its own, All the whole again', () => {
    const v = mountReview(d, { model: withStories() });
    v.api.open('loop');
    const btns = d.all(v.box, 'td-rv-perb');
    expect(btns.map((b: any) => b.textContent)).toEqual(['All', 'US 001', 'US 002']);
    expect(btns.map((b: any) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(d.all(v.box, 'td-rv-per')[0].getAttribute('role')).toBe('group');
    // the page opens a story on a click on anything with data-story: these buttons must never carry it
    expect(btns.map((b: any) => b.getAttribute('data-story'))).toEqual([null, null, null]);
    const whole = code(v);
    btns[2].click();
    expect(code(v)).toContain('new two');
    expect(code(v)).not.toContain('new one');
    expect(d.all(v.box, 'td-rv-perb').map((b: any) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
    d.all(v.box, 'td-rv-perb')[0].click();
    expect(code(v)).toBe(whole);
  });

  it('no buttons for a file one story changed', () => {
    const v = mountReview(d, { model: withStories() });
    v.api.open('check');
    expect(d.all(v.box, 'td-rv-perb')).toHaveLength(0);
  });
});
