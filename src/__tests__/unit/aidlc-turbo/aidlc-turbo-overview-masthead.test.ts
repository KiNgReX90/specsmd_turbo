/**
 * Unit tests for the masthead of the overview page before the build, the page of
 * templates/overview (written by intent-overview.cjs through
 * lib/overview-page.cjs):
 * - no meta line ("3 stories", "2 build steps", "2 integration tests"): it
 *   holds the logo, the title, the phase, the switches and the summary with
 *   "Read more", nothing else;
 * - the tabs are not written: the page's own switch (templates/design/design-tabs.js)
 *   builds them from the data once it runs;
 * - the window's title names the intent, set from the data once the page runs;
 * - the page carries the data block, with the Turbo logo inlined as SVG.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/intent-overview.cjs');
const req = createRequire(import.meta.url);
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));
const read = (f: string) => readFileSync(path.join(FLOW, f), 'utf8');
const DESIGN = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const PAGE = /<script id="overview-data" type="application\/json">([\s\S]*?)<\/script>/;

/** The template intent with the order status drawing. */
function fixture() {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-mast-')), '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(path.join(root, 'repo'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, 'repo', 'config.yaml'), 'mode: sandbox\n');
  const record = render.parseYaml(read('templates/inception/record-template.yaml'));
  record.intent.language = 'en';
  const src = render.parseYaml(readFileSync(DESIGN, 'utf8'));
  record.technical_design = { ...(record.technical_design || {}), drawing: src.technical_design.drawing };
  record.stories[0].drawing = src.stories[0].drawing;
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  const intent = paths.findIntent(root, 'user-auth');
  render.applyPlan(intent, render.planRender(intent));
  return { root, intent };
}

/** The overview page of the fixture before the build. */
function page() {
  const { root, intent } = fixture();
  const r = spawnSync(process.execPath, [SCRIPT, 'user-auth', '--no-open', '--root', root, '--phase', 'inception'], { encoding: 'utf8' });
  expect(r.status).toBe(0);
  return readFileSync(intent.overview, 'utf8');
}

/** The masthead of a page. */
const mastOf = (html: string) => (/<header class="mast">([\s\S]*?)<\/header>/.exec(html) || [])[1] ?? '';

describe('aidlc-turbo overview masthead: the page before the build', () => {
  it('has no meta line: the logo, the title, the phase, the switches and the summary, nothing else', () => {
    const mast = mastOf(page());
    expect(mast).not.toBe('');
    expect(mast).not.toMatch(/id="meta"|class="meta"/);
    for (const id of ['title', 'phase', 'summary', 'lead', 'more', 'rest']) expect(mast, id).toContain(`id="${id}"`);
  });

  it('has the title on the logo row and Read more right after the lead', () => {
    const mast = mastOf(page());
    expect(mast).toMatch(/<div class="mast-top">\s*<svg class="logo"[\s\S]*?<\/svg>\s*<h1 id="title"><\/h1>\s*<div class="mast-r">/);
    expect(mast).toContain('<p class="summary" id="summary"><span id="lead"></span> <button type="button" class="more" id="more" aria-expanded="false" aria-controls="rest">Read more</button></p>');
    expect(mast).toContain('<p class="rest" id="rest" hidden></p>');
    expect(mast).not.toContain('<details class="more">');
    expect(mast).not.toContain('data:image/png;base64,');
  });

  it('leaves the tabs to the page: the masthead carries no tablist', () => {
    expect(mastOf(page())).not.toContain('role="tablist"');
    expect(read('templates/overview/overview-template.html')).toContain('window.TdTabs.create({');
  });

  it('names the intent in the window title, as the page sets it once it runs', () => {
    const html = page();
    const data = JSON.parse(PAGE.exec(html)![1]);
    expect(data.generated).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
    expect(data.intent.title).toBe('User authentication');
    expect(html).toContain('<title>Intent overview</title>');
    expect(html).toMatch(/<html lang="en">/);
    expect(read('templates/overview/overview-template.html')).toContain('document.title = plain(intent.title) || document.title;');
  });

  it('has no merge request before the push: the data carries none', () => {
    const data = JSON.parse(PAGE.exec(page())![1]);
    expect(data.design.build).toBeUndefined();
  });
});
