/**
 * Unit tests for lib/design-diffs.cjs of the AI-DLC Turbo flow, on throwaway
 * git repos: after the build the overview carries, per part of the Code
 * Scaffold, the git diff of its file (model.build.diffs, keyed by part.path):
 * - the diff of the working tree against the merge-base of HEAD and the base
 *   branch (config base_branch, else origin/HEAD), so a commit and an
 *   uncommitted change both show and a later commit on the base does not;
 * - a new untracked file shows as all added;
 * - the body starts at the first @@ line, git's "\ No newline" lines kept;
 * - added / removed count the whole diff, a file is cut at 400 lines;
 * - past 250 KB of text the later files are omitted;
 * - no entry for an unchanged file, a part in another repo, or a folder;
 * - sandbox mode diffs against HEAD; no git repo, or a git error, is no diffs;
 * - the rendered overview of a built intent carries them in its data block
 *   (design.build.diffs), also for a part the build added; before the build
 *   none.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const { designDiffs, addDiffs, fileDiff } = req(path.join(FLOW, 'scripts/lib/design-diffs.cjs'));
const SCRIPT = path.join(FLOW, 'scripts/intent-overview.cjs');
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));
const DESIGN = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
/** The data the script wrote into the page: its block `<script id="overview-data">`. */
const pageOf = (intent: any) => JSON.parse(/<script id="overview-data" type="application\/json">([\s\S]*?)<\/script>/.exec(readFileSync(intent.overview, 'utf8'))![1].replace(/<\\!--/g, '<!--'));

const bases: string[] = [];
afterAll(() => bases.forEach((d) => rmSync(d, { recursive: true, force: true })));

const ROOT = '.specs-aidlc-turbo';
const lines = (n: number, w = 'line') => Array.from({ length: n }, (_, i) => `${w} ${i + 1}`).join('\n') + '\n';

/** A git repo on main with A, B and D committed, `config` as its repo/config.yaml. */
function repo(config = 'mode: production\nbranching:\n  base_branch: main\n') {
  const app = mkdtempSync(path.join(tmpdir(), 'turbo-diffs-'));
  bases.push(app);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: app, encoding: 'utf8' }).trim();
  const write = (f: string, body: string) => {
    mkdirSync(path.dirname(path.join(app, f)), { recursive: true });
    writeFileSync(path.join(app, f), body);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  write(`${ROOT}/repo/config.yaml`, config);
  write('.gitignore', `${ROOT}/\n`);
  for (const f of ['src/A.java', 'src/B.java', 'src/D.java']) write(f, lines(5));
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return { app, git, write };
}

const part = (id: string, p: string | null, extra: Record<string, unknown> = {}) => ({ id, name: id, path: p, ...extra });
const PARTS = [
  part('a', 'src/A.java'), part('b', 'src/B.java'), part('c', 'src/C.java'), part('d', 'src/D.java'),
  part('ext', 'src/X.java', { repo: 'other-repo' }), part('map', 'src'), part('none', null),
];

describe('aidlc-turbo design diffs: which diff', () => {
  it('diffs the working tree against the merge-base with the base branch', () => {
    const r = repo();
    r.git('switch', '-q', '-c', 'shop/intent-x/intent');
    r.write('src/A.java', lines(5).replace('line 2\n', 'line two\n'));
    r.git('commit', '-qam', 'build A');
    r.write('src/B.java', lines(6));
    r.write('src/C.java', 'new\n');
    r.write('src/X.java', 'elders\n');
    // the base moves on after the intent branched off: not part of this build
    r.git('switch', '-q', 'main');
    r.write('src/D.java', lines(7));
    r.git('commit', '-qm', 'elsewhere', '--', 'src/D.java');
    r.git('switch', '-q', 'shop/intent-x/intent');

    const diffs = designDiffs(PARTS, { cwd: r.app, root: ROOT });
    expect(Object.keys(diffs)).toEqual(['src/A.java', 'src/B.java', 'src/C.java']);
    expect(diffs['src/A.java']).toEqual({ text: '@@ -1,5 +1,5 @@\n line 1\n-line 2\n+line two\n line 3\n line 4\n line 5', added: 1, removed: 1, truncated: 0 });
    expect(diffs['src/B.java']).toMatchObject({ added: 1, removed: 0, truncated: 0 });
    expect(diffs['src/B.java'].text).toMatch(/^@@ -3,3 \+3,4 @@/);
    expect(diffs['src/C.java']).toEqual({ text: '@@ -0,0 +1 @@\n+new', added: 1, removed: 0, truncated: 0 });
  });

  it('takes the remote default branch when base_branch is empty', () => {
    const r = repo('mode: production\nbranching:\n  base_branch: ""\n');
    const remote = path.join(r.app, '..', `${path.basename(r.app)}-origin.git`);
    bases.push(remote);
    execFileSync('git', ['init', '-q', '--bare', remote]);
    r.git('remote', 'add', 'origin', remote);
    r.git('push', '-q', 'origin', 'main');
    r.git('remote', 'set-head', 'origin', 'main');
    r.git('switch', '-q', '-c', 'feature');
    r.write('src/A.java', lines(4));
    r.git('commit', '-qam', 'build A');
    r.git('branch', '-f', 'main', 'HEAD');
    // local main now holds the build; origin/main is the base
    expect(Object.keys(designDiffs(PARTS, { cwd: r.app, root: ROOT }))).toEqual(['src/A.java']);
    r.write(`${ROOT}/repo/config.yaml`, 'mode: production\nbranching:\n  base_branch:\n  story_branches: true\n');
    expect(Object.keys(designDiffs(PARTS, { cwd: r.app, root: ROOT }))).toEqual(['src/A.java']);
  });

  it('reads an Oracle script in Windows-1252 as such, a UTF-8 file as UTF-8, never a broken letter', () => {
    const r = repo();
    r.git('switch', '-q', '-c', 'feature');
    const cp = (f: string, text: string) => writeFileSync(path.join(r.app, f), Buffer.from(text, 'latin1'));
    cp('src/A.java', 'line 1\nNaïve façade\n');
    r.write('src/B.java', 'line 1\ncafé\n');
    cp('src/C.java', 'Crème brûlée\n');
    const diffs = designDiffs(PARTS, { cwd: r.app, root: ROOT });
    expect(diffs['src/A.java'].text).toContain('+Naïve façade');
    expect(diffs['src/B.java'].text).toContain('+café');
    expect(diffs['src/C.java'].text).toBe('@@ -0,0 +1 @@\n+Crème brûlée');
    for (const d of Object.values(diffs) as any[]) expect(d.text).not.toContain('\uFFFD');
  });

  it('diffs against HEAD in sandbox mode: only what is not committed', () => {
    const r = repo('mode: sandbox\n');
    r.write('src/A.java', lines(4));
    r.git('commit', '-qam', 'committed');
    r.write('src/B.java', lines(4));
    expect(Object.keys(designDiffs(PARTS, { cwd: r.app, root: ROOT }))).toEqual(['src/B.java']);
  });

  it('lets the brief\'s mode snapshot win over the config', () => {
    const r = repo();
    r.git('switch', '-q', '-c', 'feature');
    r.write('src/A.java', lines(4));
    r.git('commit', '-qam', 'committed');
    expect(Object.keys(designDiffs(PARTS, { cwd: r.app, root: ROOT, brief: { mode: 'sandbox' } }))).toEqual([]);
  });

  it('falls back to HEAD when the base branch is nowhere', () => {
    const r = repo('mode: production\nbranching:\n  base_branch: does-not-exist\n');
    r.write('src/B.java', lines(4));
    expect(Object.keys(designDiffs(PARTS, { cwd: r.app, root: ROOT }))).toEqual(['src/B.java']);
  });

  it('is no diffs outside a git repo, and never throws', () => {
    const app = mkdtempSync(path.join(tmpdir(), 'turbo-nogit-'));
    bases.push(app);
    mkdirSync(path.join(app, 'src'));
    writeFileSync(path.join(app, 'src/A.java'), 'a\n');
    expect(designDiffs(PARTS, { cwd: app, root: ROOT })).toEqual({});
    expect(designDiffs(PARTS, { cwd: path.join(app, 'gone'), root: ROOT })).toEqual({});
    expect(designDiffs(null, { cwd: app, root: ROOT })).toEqual({});
  });

  it('is no diffs in a repo without a commit yet', () => {
    const app = mkdtempSync(path.join(tmpdir(), 'turbo-empty-'));
    bases.push(app);
    execFileSync('git', ['init', '-q'], { cwd: app });
    mkdirSync(path.join(app, 'src'));
    writeFileSync(path.join(app, 'src/A.java'), 'a\n');
    expect(designDiffs(PARTS, { cwd: app, root: ROOT })).toEqual({});
  });
});

describe('aidlc-turbo design diffs: one file', () => {
  it('keeps git\'s no-newline line and strips the header', () => {
    const r = repo();
    r.write('src/A.java', 'line 1\nline 2\nline 3\nline 4\nother');
    const d = designDiffs(PARTS, { cwd: r.app, root: ROOT })['src/A.java'];
    expect(d.text).toContain('\n\\ No newline at end of file');
    expect(d.text).not.toMatch(/^(diff --git|index |--- |\+\+\+ |new file mode)/m);
    expect(d).toMatchObject({ added: 1, removed: 1, truncated: 0 });
  });

  it('cuts a file at 400 diff lines, counting the whole diff', () => {
    const r = repo();
    r.write('src/C.java', lines(500));
    const d = designDiffs(PARTS, { cwd: r.app, root: ROOT })['src/C.java'];
    expect(d.text.split('\n')).toHaveLength(400);
    expect(d).toMatchObject({ added: 500, removed: 0, truncated: 101 });
  });

  it('parses a raw diff: no hunk is no diff', () => {
    expect(fileDiff('diff --git a/x b/x\nBinary files a/x and b/x differ\n')).toBeNull();
    expect(fileDiff('')).toBeNull();
    expect(fileDiff('diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n'))
      .toEqual({ text: '@@ -1 +1 @@\n-a\n+b', added: 1, removed: 1, truncated: 0 });
  });
});

describe('aidlc-turbo design diffs: the size of the page', () => {
  it('omits the later files once the diffs pass 250 KB, in drawing order', () => {
    const r = repo();
    const wide = (n: number) => lines(n, 'x'.repeat(400));
    r.write('src/C.java', wide(390));
    r.write('src/E.java', wide(390));
    r.write('src/F.java', 'klein\n');
    const parts = [part('c', 'src/C.java'), part('e', 'src/E.java'), part('f', 'src/F.java')];
    const diffs = designDiffs(parts, { cwd: r.app, root: ROOT });
    expect(diffs['src/C.java'].added).toBe(390);
    expect(diffs['src/E.java']).toEqual({ omitted: true });
    expect(diffs['src/F.java']).toEqual({ omitted: true });
  });
});

describe('aidlc-turbo design diffs: on the model', () => {
  it('goes on model.build only after a build, and only when there is one', () => {
    const r = repo();
    r.write('src/B.java', lines(4));
    const built = { parts: PARTS, build: { stories: [] } };
    expect(addDiffs(built, { cwd: r.app, root: ROOT }).build.diffs['src/B.java'].removed).toBe(1);
    const before: any = { parts: PARTS };
    expect(addDiffs(before, { cwd: r.app, root: ROOT }).build).toBeUndefined();
    const clean = repo();
    const none: any = { parts: PARTS, build: { stories: [] } };
    expect(addDiffs(none, { cwd: clean.app, root: ROOT }).build.diffs).toBeUndefined();
    expect(addDiffs(null, { cwd: r.app, root: ROOT })).toBeNull();
  });
});

const CONTROLLER = 'shop-orderstatus-adapters/src/main/java/com/acme/shop/orderstatus/adapters/inbound/web/OrderStatusController.java';
const FILTER = 'shop-orderstatus-adapters/src/main/java/com/acme/shop/orderstatus/adapters/inbound/web/OrderStatusFilter.java';

/** A git project holding the template intent with the order status drawing, its controller built. */
function builtProject() {
  const r = repo();
  r.write(CONTROLLER, lines(5));
  r.git('add', '-A');
  r.git('commit', '-qm', 'controller');
  r.git('switch', '-q', '-c', 'shop/intent-user-auth/intent');
  const root = path.join(r.app, ROOT);
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(dir, { recursive: true });
  const record = render.parseYaml(readFileSync(path.join(FLOW, 'templates/inception/record-template.yaml'), 'utf8'));
  const src = render.parseYaml(readFileSync(DESIGN, 'utf8'));
  record.technical_design = { ...(record.technical_design || {}), drawing: src.technical_design.drawing };
  record.stories[0].drawing = src.stories[0].drawing;
  record.stories[0].changed_files = [CONTROLLER, FILTER];
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  const intent = paths.findIntent(root, 'user-auth');
  render.applyPlan(intent, render.planRender(intent));
  const story = path.join(intent.stories, readdirSync(intent.stories).find((n: string) => n.startsWith('001-'))!);
  writeFileSync(story, readFileSync(story, 'utf8').replace(/\n### Build notes\n[\s\S]*$/, '')
    + `\n### Build notes\n\n- **Built**: The screen.\n- **Outside the Code Scaffold**:\n  - \`${FILTER}\`: Built: a filter. Why: needed.\n`
    + '- **Different from the Code Scaffold**: none.\n- **Not built**: none.\n');
  r.write(CONTROLLER, lines(6));
  r.write(FILTER, 'class OrderStatusFilter {}\n');
  return { ...r, root, intent };
}

describe('aidlc-turbo overview: the diffs on the page', () => {
  it('carries the diff of a changed part, and of a part the build added, after the build', () => {
    const p = builtProject();
    const res = spawnSync(process.execPath, [SCRIPT, 'user-auth', '--no-open', '--phase', 'construction', '--root', p.root],
      { cwd: p.app, encoding: 'utf8' });
    expect(res.status).toBe(0);
    const { diffs } = pageOf(p.intent).design.build;
    expect(diffs[CONTROLLER].text).toMatch(/^@@ -3,3 \+3,4 @@/);
    expect(diffs[FILTER]).toEqual({ text: '@@ -0,0 +1 @@\n+class OrderStatusFilter {}', added: 1, removed: 0, truncated: 0 });
  });

  it('carries none before the build', () => {
    const p = builtProject();
    const res = spawnSync(process.execPath, [SCRIPT, 'user-auth', '--no-open', '--phase', 'inception', '--root', p.root],
      { cwd: p.app, encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(pageOf(p.intent).design).not.toHaveProperty('build');
    expect(readFileSync(p.intent.overview, 'utf8')).not.toContain('"diffs":');
  });
});
