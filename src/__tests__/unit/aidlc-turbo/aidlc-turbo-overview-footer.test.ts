/**
 * Unit tests for the footer of the overview page:
 * - no feedback block under the drawing, on the page before the build nor
 *   after it; "Is this wrong?" stays while the inception waits;
 * - no feedback command anywhere: the footer is one quiet row with the
 *   "Updated" date in its own span.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';
const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const SCRIPT = path.join(FLOW, 'scripts/intent-overview.cjs');
const req = createRequire(import.meta.url);
const render = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const paths = req(path.join(FLOW, 'scripts/lib/paths.cjs'));
const read = (f: string) => readFileSync(path.join(FLOW, f), 'utf8');
const TEMPLATE = read('templates/overview/overview-template.html');
const EN = JSON.parse(read('templates/lang/en.json'));
const DESIGN = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');

/** The template intent with the order status drawing. */
function fixture() {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'turbo-foot-')), '.specs-aidlc-turbo');
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

/** The overview page of the fixture in one phase. */
function page(phase: 'inception' | 'construction') {
  const { root, intent } = fixture();
  const r = spawnSync(process.execPath, [SCRIPT, 'user-auth', '--no-open', '--root', root, '--phase', phase], { encoding: 'utf8' });
  expect(r.status).toBe(0);
  return readFileSync(intent.overview, 'utf8');
}

const footerOf = (html: string) => {
  const m = /<footer\b[^>]*\bid="foot"[^>]*>([\s\S]*?)<\/footer>/.exec(html);
  expect(m).not.toBeNull();
  return m![1];
};
const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

describe.each(['inception', 'construction'] as const)('aidlc-turbo overview footer: the page in phase %s', (phase) => {
  it('has no feedback block under the drawing', () => {
    const html = page(phase);
    expect(html).not.toContain('td-fb');
    expect(html).not.toContain('<dt>AI-DLC Turbo</dt>');
  });

  it('names no feedback command: the footer holds only the date', () => {
    const html = page(phase);
    const foot = footerOf(html);
    expect(foot).toContain('id="foot-at"');
    expect(foot).not.toContain('foot-fb');
    expect(html).not.toMatch(/-feedback\b/);
  });
});

describe('aidlc-turbo overview footer: the date and the row', () => {
  it('the date fills its own span', () => {
    expect(TEMPLATE).toContain("$('#foot-at').textContent = D.generated ? TT('updated', { at: D.generated }) : '';");
    expect(EN.overview.updated).toBe('Updated {at}');
    expect(TEMPLATE).not.toMatch(/\$\('#foot'\)\.textContent/);
  });

  it('one quiet row, from the page tokens', () => {
    const rule = /\n {2}footer \{([^}]*)\}/.exec(TEMPLATE)![1];
    expect(rule).toMatch(/display: flex;/);
    expect(rule).toMatch(/color: var\(--ink-3\);/);
    expect(TEMPLATE).not.toMatch(/\.foot-fb/);
  });
});

describe('aidlc-turbo Code Scaffold: the asks under the drawing', () => {
  const G = globalThis as any;
  const load = (f: string) => {
    const file = path.join(FLOW, 'templates/design', f);
    delete req.cache[file];
    return req(file);
  };
  beforeEach(() => {
    fakeDom();
    G.TdKit = load('design-kit.js');
  });

  it('only "Is this wrong?" while the inception waits, nothing after it', () => {
    load('design-keys.js');
    const K = G.TdKeys;
    const waiting = K.asks(true).innerHTML;
    expect(waiting).toContain(EN.design.legend.asks.title);
    expect(EN.design.legend.asks.title).toBe('Is this wrong?');
    expect(waiting).not.toMatch(/-feedback\b|td-fb/);
    expect(K.asks(false).innerHTML).toBe('');
  });

  it('an empty wrap takes no room under the drawing', () => {
    expect(read('templates/design/design.css')).toMatch(/\.td-st-wrap:empty \{ display: none; \}/);
  });
});
