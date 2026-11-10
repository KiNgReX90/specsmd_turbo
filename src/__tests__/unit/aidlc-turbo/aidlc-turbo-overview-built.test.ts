/**
 * Unit tests for the overview page after the build, the page of templates/overview with the build data of
 * buildData(), run through the script on the order status drawing of the fixture:
 * - after the build the page is that page, with or without a drawing, never a v5 page;
 * - its masthead names the intent by its title only, also after the build;
 * - with a drawing its tabs are Functional, Code and Review; without one it has no tabs at all;
 * - every built story carries what it built in the builder's words (the Built line of its build notes), and
 *   nothing before the build, and the build block the Review tab reads keeps the builder's own words.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import { MODEL, PAGE, pageTabs } from './aidlc-turbo-intent-overview-fixture';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/intent-overview.cjs');
const req = createRequire(import.meta.url);
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));
const read = (f: string) => readFileSync(path.join(FLOW, f), 'utf8');
const DESIGN = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');

/** The template intent, with the order status drawing when `drawing`. */
function fixture(drawing: boolean) {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-built-')), '.specs-aidlc-turbo');
  const dir = path.join(root, 'docs', 'user-auth', 'user-auth');
  mkdirSync(path.join(root, 'repo'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, 'repo', 'config.yaml'), 'mode: sandbox\n');
  const record = render.parseYaml(read('templates/inception/record-template.yaml'));
  if (drawing) {
    const src = render.parseYaml(readFileSync(DESIGN, 'utf8'));
    record.technical_design = { ...(record.technical_design || {}), drawing: src.technical_design.drawing };
    record.stories[0].drawing = src.stories[0].drawing;
  }
  record.stories[0].changed_files = ['src/main/java/com/acme/shop/Login.java'];
  writeFileSync(path.join(dir, 'record.yaml'), render.dumpYaml(record));
  const intent = paths.findIntent(root, 'user-auth');
  render.applyPlan(intent, render.planRender(intent));
  return { root, intent };
}

/** Write the build notes of story 001, the last section of its story file. */
function notes(intent: any, body: string) {
  const dir = intent.stories;
  const file = path.join(dir, readdirSync(dir).find((n: string) => n.startsWith('001-'))!);
  const md = readFileSync(file, 'utf8');
  writeFileSync(file, md.replace(/\n### Build notes\n[\s\S]*$/, '') + `\n### Build notes\n\n${body}\n`);
}

/** The page after the build as the script writes it (finish passes --phase construction), and its model. */
const html = (root: string, intent: any, extra: string[] = ['--phase', 'construction']) => {
  const r = spawnSync(process.execPath, [SCRIPT, 'user-auth', '--no-open', '--root', root, ...extra], { encoding: 'utf8', cwd: path.dirname(root) });
  expect(r.status, r.stderr).toBe(0);
  return readFileSync(intent.overview, 'utf8');
};
const dataOf = (page: string) => JSON.parse(PAGE.exec(page)![1].replace(/<\\!--/g, '<!--'));

describe('aidlc-turbo overview after the build: the page', () => {
  it('is the page of templates/overview with the drawing, never a v5 page', () => {
    const { root, intent } = fixture(true);
    const page = html(root, intent);
    expect(page).toContain('<script id="overview-data" type="application/json">');
    expect(page).toContain('<body class="mq">');
    expect(MODEL.test(page)).toBe(false);
    expect(page.match(/<script\b/g)!.length).toBe(page.match(/<\/script>/g)!.length);
    expect(dataOf(page).phase).toBe('construction');
  });

  it('is that page without a drawing too, and then has no tabs at all', () => {
    const { root, intent } = fixture(false);
    const data = dataOf(html(root, intent));
    expect(data.design).toBeNull();
    expect(pageTabs(data)).toEqual([]);
  });

  it('shows Functional, Code and Review with the drawing', () => {
    const { root, intent } = fixture(true);
    const data = dataOf(html(root, intent));
    expect(pageTabs(data)).toEqual(['Functional', 'Code', 'Review']);
    expect(data.design.links.length).toBeGreaterThan(0);
  });
});

describe('aidlc-turbo overview after the build: the masthead', () => {
  it('names the intent by its title only, also after the build', () => {
    const { root, intent } = fixture(true);
    const data = dataOf(html(root, intent));
    expect(data.intent.title).toBeTruthy();
    expect(data.intent.title).not.toMatch(/build result|built/i);
    // what the masthead says beside it is the phase, never part of the title
    expect(data.labels.phase.construction).toBe('Building');
  });
});

describe('aidlc-turbo overview after the build: what a story built', () => {
  it('carries the Built line of the build notes after the build, and nothing before it', () => {
    const { root, intent } = fixture(true);
    notes(intent, '- **Built**: The screen shows the orders.\n  An error shows up in the log.\n- **Outside the Code Scaffold**: none.\n- **Different from the Code Scaffold**: none.\n- **Not built**: none.');
    expect(dataOf(html(root, intent)).stories[0].built).toBe('The screen shows the orders. An error shows up in the log.');
    expect(dataOf(html(root, intent, ['--phase', 'inception'])).stories[0].built).toBeUndefined();
  });

  it('hands it to the build block the Review tab reads, in the builder\'s own words', () => {
    const { root, intent } = fixture(true);
    notes(intent, '- **Built**: The screen shows the `orders`.\n- **Outside the Code Scaffold**: none.\n- **Different from the Code Scaffold**: none.\n- **Not built**: none.');
    expect(dataOf(html(root, intent)).design.build.stories[0].built).toBe('The screen shows the `orders`.');
  });
});
