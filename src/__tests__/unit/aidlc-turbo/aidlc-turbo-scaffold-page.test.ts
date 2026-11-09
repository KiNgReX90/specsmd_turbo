/**
 * The Code Scaffold page, saved next to the specs and published.
 *
 * `intent-overview.cjs <intent> --scaffold` writes the overview page opening
 * on its technical view (the Code Scaffold):
 * - after the inception as code-scaffold.html;
 * - after the build as code-scaffold-built.html, the drawing as built, and
 *   never over code-scaffold.html;
 * - nothing without a Code Scaffold: none drawn, a sandbox that switched it
 *   off, or, after the build, a sandbox without its update.
 *
 * The inception review and finish save it, commit it and publish both to one
 * artifact link, the second as a new version.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));
const overview = req(path.join(FLOW, 'scripts/intent-overview.cjs'));
const SCRIPT = path.join(FLOW, 'scripts/intent-overview.cjs');
const read = (rel: string) => readFileSync(path.join(FLOW, rel), 'utf8');
const flat = (rel: string) => read(rel).replace(/\s+/g, ' ');
const load = (f: string) => { const file = path.join(FLOW, 'templates/design', f); delete req.cache[file]; return req(file); };
const DATA = /<script[^>]*id="overview-data"[^>]*>([\s\S]*?)<\/script>/;
const pageOf = (file: string) => JSON.parse(DATA.exec(readFileSync(file, 'utf8'))![1]);

/** The template intent with a small drawing: story 001 builds a new module and part; built, it touched one more file. */
function project(config: string, opts: { drawn?: boolean } = {}) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-scaffold-')), '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(path.join(root, 'repo'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, 'repo', 'config.yaml'), config);
  const record = render.parseYaml(read('templates/inception/record-template.yaml'));
  delete record.technical_design?.drawing;
  for (const s of record.stories) delete s.drawing;
  if (opts.drawn !== false) {
    record.technical_design = {
      ...(record.technical_design || {}),
      drawing: {
        summary: 'The login code gets a check.',
        modules: [{ id: 'auth', name: 'auth', status: 'new', path: 'src/auth' }],
        parts: [{ id: 'login', name: 'login.ts', module: 'auth', layer: 'server', status: 'new', kind: 'service', path: 'src/auth/login.ts' }],
        links: [],
      },
    };
    record.stories[0].drawing = { summary: 'The check.', builds: { auth: 'new', login: 'new' }, uses: [] };
  }
  record.stories[0].changed_files = ['src/auth/login.ts', 'src/auth/extra.ts'];
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  const intent = paths.findIntent(root, 'user-auth');
  render.applyPlan(intent, render.planRender(intent));
  return { root, intent };
}

const run = (root: string, ...args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, 'user-auth', '--no-open', '--root', root, '--scaffold', ...args], { encoding: 'utf8' });

describe('intent-overview.cjs --scaffold', () => {
  it('after the inception writes code-scaffold.html, opening on the technical view, and leaves the overview alone', () => {
    const { root, intent } = project('mode: production\n');
    expect(intent.scaffold).toBe(path.join(intent.dir, 'code-scaffold.html'));
    const r = run(root, '--phase', 'inception');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`Code Scaffold page: ${intent.scaffold}`);
    const page = pageOf(intent.scaffold);
    expect(page.scaffold).toBe(true);
    expect(page.phase).toBe('inception');
    expect(page.design).toBeTruthy();
    expect(page.design.build).toBeUndefined();
    expect(existsSync(intent.scaffoldBuilt)).toBe(false);
    expect(existsSync(intent.overview)).toBe(false);
  });

  it('the page opens on the technical view when it is the saved scaffold page, and the overview still on the functional one', () => {
    const template = read('templates/overview/overview-template.html');
    // the route opens a link-less page on the drawing when it is built or the saved scaffold page
    expect(template).toContain('window.TdTabs.route(location.hash, { review: !!rvSec, built: !!(asBuilt || D.scaffold), flow: drawn,');
    expect(load('design-tabs.js').route('', { built: true, flow: true }).view).toBe('flow');
    expect(load('design-tabs.js').route('', { built: false, flow: true }).view).toBe('functional');
    const { root, intent } = project('mode: production\n');
    expect(spawnSync(process.execPath, [SCRIPT, 'user-auth', '--no-open', '--root', root, '--phase', 'inception'], { encoding: 'utf8' }).status).toBe(0);
    expect(pageOf(intent.overview).scaffold).toBeUndefined();
  });

  it('after the build writes code-scaffold-built.html with the drawing as built, and never touches code-scaffold.html', () => {
    const { root, intent } = project('mode: production\n');
    expect(run(root, '--phase', 'inception').status).toBe(0);
    const approved = readFileSync(intent.scaffold, 'utf8');
    const r = run(root, '--phase', 'construction');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`Code Scaffold page: ${intent.scaffoldBuilt}`);
    expect(intent.scaffoldBuilt).toBe(path.join(intent.dir, 'code-scaffold-built.html'));
    const built = pageOf(intent.scaffoldBuilt);
    expect(built.scaffold).toBe(true);
    expect(built.phase).toBe('construction');
    expect(built.design.build).toBeTruthy();
    expect(readFileSync(intent.scaffold, 'utf8')).toBe(approved);
  });

  it('a sandbox writes both the same way when its parts are on', () => {
    const { root, intent } = project('mode: sandbox\n');
    expect(run(root, '--phase', 'inception').status).toBe(0);
    expect(run(root, '--phase', 'construction').status).toBe(0);
    expect(pageOf(intent.scaffold).scaffold).toBe(true);
    expect(pageOf(intent.scaffoldBuilt).design.build).toBeTruthy();
  });

  it('writes nothing, and says so, without a Code Scaffold', () => {
    const cases: Array<[string, string, { drawn?: boolean }, RegExp]> = [
      ['none drawn', 'mode: production\n', { drawn: false }, /the intent has no Code Scaffold/],
      ['a sandbox without it', 'mode: sandbox\nsandbox:\n  code_scaffold: false\n', {}, /off in this sandbox \(sandbox\.code_scaffold: false\)/],
    ];
    for (const [name, config, opts, why] of cases) {
      for (const phase of ['inception', 'construction']) {
        const { root, intent } = project(config, opts);
        const r = run(root, '--phase', phase);
        expect(r.status, `${name} ${phase}`).toBe(0);
        expect(r.stdout, `${name} ${phase}`).toMatch(/^Code Scaffold page: not written, /m);
        expect(r.stdout, `${name} ${phase}`).toMatch(why);
        expect(existsSync(intent.scaffold), `${name} ${phase}`).toBe(false);
        expect(existsSync(intent.scaffoldBuilt), `${name} ${phase}`).toBe(false);
      }
    }
  });

  it('a sandbox without the update after the build keeps only the inception page', () => {
    const { root, intent } = project('mode: sandbox\nsandbox:\n  scaffold_after_build: false\n');
    expect(run(root, '--phase', 'inception').status).toBe(0);
    expect(existsSync(intent.scaffold)).toBe(true);
    const r = run(root, '--phase', 'construction');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Code Scaffold page: not written, the Code Scaffold is not updated after the build in this sandbox (sandbox.scaffold_after_build: false)');
    expect(existsSync(intent.scaffoldBuilt)).toBe(false);
  });

  it('scaffoldTarget picks the file per phase, or why there is none', () => {
    const intent = { scaffold: 'a/code-scaffold.html', scaffoldBuilt: 'a/code-scaffold-built.html' };
    const all = { codeScaffold: true, scaffoldAfterBuild: true };
    expect(overview.scaffoldTarget(intent, { phase: 'inception', design: {} }, all)).toEqual({ file: intent.scaffold });
    expect(overview.scaffoldTarget(intent, { phase: 'construction', design: {} }, all)).toEqual({ file: intent.scaffoldBuilt });
    expect(overview.scaffoldTarget(intent, { phase: 'construction', design: {} }, { ...all, scaffoldAfterBuild: false }).none).toBeTruthy();
    expect(overview.scaffoldTarget(intent, { phase: 'inception', design: null }, all).none).toBeTruthy();
    expect(overview.scaffoldTarget(intent, { phase: 'inception', design: {} }, { codeScaffold: false }).none).toBeTruthy();
  });
});

describe('the inception and finish save, commit and publish it', () => {
  it('the inception review saves code-scaffold.html and publishes it to a link it keeps in sync.yaml', () => {
    const review = flat('skills/inception/review.md');
    expect(review).toContain('intent-overview.cjs {intent-slug} --phase inception --scaffold --no-open');
    expect(review).toContain('It writes `code-scaffold.html` next to `overview.html`: the same page, opening on the Code Scaffold, the technical view.');
    expect(review).toContain('write the link it returns into `sync.yaml` under `overview.{intent-slug}.scaffold`');
    expect(review).toContain('No Artifact tool, or the publish fails or is refused: run the script again without `--no-open`, so the file opens in the browser, and name in one line why there is no artifact.');
    expect(review).toMatch(/`code-scaffold\.html`,? when step 5 saved it/);
  });

  it('finish saves code-scaffold-built.html, never over the first, and publishes a new version to the same link', () => {
    const finish = flat('skills/construction/finish.md');
    expect(finish).toContain('intent-overview.cjs {intent} --phase construction --scaffold --no-open');
    expect(finish).toContain('It never writes `code-scaffold.html`: the scaffold the inception saved stays as it was approved.');
    expect(finish).toContain('Publish it to the same artifact link as the inception\'s scaffold page, so that link gets a new version');
    expect(finish).toContain('under `overview.{intent-slug}.scaffold`');
    expect(finish).toContain('`code-scaffold-built.html` when step 8 wrote it');
    expect(finish).toContain('Never write or publish over `code-scaffold.html`');
  });

  it('memory-bank.yaml, the README and the PRD name both files', () => {
    const bank = read('memory-bank.yaml');
    expect(bank).toContain('code-scaffold: ".specs-aidlc-turbo/docs/{inception}/{intent-slug}/code-scaffold.html"');
    expect(bank).toContain('code-scaffold-built: ".specs-aidlc-turbo/docs/{inception}/{intent-slug}/code-scaffold-built.html"');
    for (const rel of ['README.md', 'PRD.md']) {
      expect(read(rel), rel).toContain('code-scaffold.html');
      expect(read(rel), rel).toContain('code-scaffold-built.html');
    }
  });
});
