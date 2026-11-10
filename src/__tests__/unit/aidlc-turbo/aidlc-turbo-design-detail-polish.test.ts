/**
 * Unit tests for the finish of the details, the change in the code, the
 * story buttons and the walk over the Code Scaffold drawing:
 * - the walk over the drawing (play, "Full screen", the switch "Only new
 *   and changed") keeps its own band at the top of the drawing: the drawing starts under
 *   it, also where its row wraps (design-steps.js measures it, --td-ctl-h);
 * - the story buttons under the details show the pointer, from the tokens of the page;
 * - unchanged lines of a change read as code, not as the dim context of a
 *   hunk header; a count of nothing ("−0" on a new file) is left out; the
 *   hunks join without a gap in the line-number rule; one focus colour;
 * - a line range ("lines 37-68", "File.java:12-13") never breaks at its dash;
 * - the details have no full screen of their own any more, nor buttons at
 *   their top that the text keeps clear of.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const read = (f: string) => { try { return readFileSync(path.join(DESIGN, f), 'utf8'); } catch { return ''; } };
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const { layout } = req(path.join(DESIGN, 'design-layout.js'));
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const model = dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
const geo = layout(model);

/** A script of the page, run again in this test's fake document (it reads its globals when it loads). */
function load(f: string) {
  const file = path.join(DESIGN, f);
  delete req.cache[file];
  return req(file);
}

let d: ReturnType<typeof fakeDom>;
beforeEach(() => {
  d = fakeDom();
  (globalThis as any).TdKit = load('design-kit.js');
  delete (globalThis as any).localStorage;
});

describe('aidlc-turbo Code Scaffold: the walk keeps a band of its own over the drawing', () => {
  function walk() {
    load('design-steps.js');
    const s = (globalThis as any).TdSteps.create(model, geo, d.node('svg'), [], []);
    const dzw = d.node('div'), ctl = d.node('div'), left = d.node('div');
    ctl.parentElement = dzw;
    ctl.append(left);
    dzw.append(ctl, s.keys);
    return { s, dzw, ctl, left };
  }

  it('reserves the row of the walk, wrapped or not, and keeps that height while the walk is hidden', () => {
    const { s, dzw, ctl, left } = walk();
    Object.assign(left, { offsetParent: {}, offsetTop: 12, offsetHeight: 48 });
    const held = s.band(ctl, left);
    expect(dzw.style['--td-ctl-h']).toBe('72px');
    expect(held()).toBe(72);
    // the row wrapped to two lines
    Object.assign(left, { offsetHeight: 104 });
    s.band(ctl, left);
    expect(dzw.style['--td-ctl-h']).toBe('128px');
    // the walk hidden (the preview): the height stays what it was, so the fit never flips
    Object.assign(left, { offsetParent: null });
    const h2 = s.band(ctl, left);
    expect(h2()).toBe(128);
  });

  it('the drawing starts under the band on the page, the panel fits it under the band', () => {
    const css = read('design-steps.css');
    expect(css).toMatch(/\.td-ctl \{[^}]*position: sticky;[^}]*height: var\(--td-ctl-h, 72px\);/);
    expect(css).toMatch(/\.td-root:not\(\.td-pv\) \.td-dzw > \.td-ctl \+ \.td-dz \{ margin-top: calc\(-1 \* var\(--td-ctl-h, 72px\)\); padding-top: var\(--td-ctl-h, 72px\); \}/);
    expect(css).not.toMatch(/margin-top: -72px|margin-top: -80px/);
    const panel = read('design-panel.js');
    expect(panel).toMatch(/ctlH = steps\.band\(ctl, left\);/);
    expect(panel).toMatch(/const room = \(one \? H - below : innerHeight - 32\) - ctlH\(\);/);
    // the keys are no longer under the walk: one line along the bottom of the drawing (design-pane.test.ts)
    expect(css).not.toMatch(/\.td-ctl \.td-steps-keys/);
  });
});

describe('aidlc-turbo Code Scaffold: the story buttons under the details', () => {
  it('shows the pointer on its story buttons by a magenta tint, not by a tint darker than the details', () => {
    const css = read('design-about.css');
    expect(css).not.toMatch(/:is\(\.td-cs-s, \.td-cs-name\):hover \{ background: var\(--td-tint-2\); \}/);
    expect(css).toMatch(/:is\(\.td-cs-s, \.td-cs-name\):hover \{ background: color-mix\(in srgb, var\(--td-accent\) 12%, transparent\); \}/);
  });
});

describe('aidlc-turbo Code Scaffold: the change in the code reads clean', () => {
  const Diff = () => load('design-diff.js');
  const TEXT = '@@ -10,3 +10,3 @@ class Task {\n     a();\n-    b();\n+    c();\n';

  it('gives an unchanged line a class of its own, apart from the context of a hunk header', () => {
    const v = Diff().view({ text: TEXT, added: 1, removed: 1 }, { path: 'src/Task.java', name: 'Task' });
    const rows = d.all(v, 'td-df-l');
    expect(String(rows[0].className)).toBe('td-df-l td-df-same');
    expect(d.all(v, 'td-df-ctx').map((e: any) => e.textContent)).toEqual(['class Task {']);
    const css = read('design-diff.css');
    expect(css).toMatch(/\.td-df-hh \.td-df-ctx \{/);
    expect(css).not.toMatch(/^\.td-df-ctx \{/m);
  });

  it('leaves a count of nothing out: no "−0" on a new file, no "+0" on a removed one', () => {
    const fresh = Diff().view({ text: '@@ -0,0 +1,2 @@\n+a\n+b\n', added: 2, removed: 0 }, { path: 'src/A.java' });
    expect(d.all(fresh, 'td-df-plus')[0].textContent).toBe('+2');
    expect(d.all(fresh, 'td-df-min')).toHaveLength(0);
    const gone = Diff().view({ text: '@@ -1,2 +0,0 @@\n-a\n-b\n', added: 0, removed: 2 }, { path: 'src/A.java' });
    expect(d.all(gone, 'td-df-plus')).toHaveLength(0);
    expect(d.all(gone, 'td-df-min')[0].textContent).toBe('−2');
    const both = Diff().view({ text: TEXT, added: 1, removed: 1 }, { path: 'src/Task.java' });
    expect(d.all(both, 'td-df-count')[0].textContent).toBe('+1−1');
  });

  it('joins the hunks without a gap in the rule of the numbers, and shows the keyboard focus in the one focus colour', () => {
    const css = read('design-diff.css');
    expect(css).toMatch(/\.td-df-hunk \+ \.td-df-hunk \{ border-top: 1px dashed var\(--td-line-strong\); \}/);
    expect(css).toMatch(/\.td-df-body:focus-visible \{ outline: 2px solid var\(--td-orange\);/);
  });
});

describe('aidlc-turbo Code Scaffold: a line range stays whole', () => {
  it('keeps "lines 37-68" and "File.java:12-13" on one line, the path wrapping between its parts', () => {
    (globalThis as any).TdBuild = load('design-built.js');
    (globalThis as any).TdEngine = { ...load('design-engine.js'), kindOf: (k: string) => k };
    load('design-detail.js');
    const p = { id: 'p', name: 'Parser', status: 'changed', path: 'shop/core/src/Parser.java', lines: '37-68', module: 'none',
      follows: { file: 'shop/core/src/Other.java', lines: '29-109', note: 'just the same' } };
    const m = { parts: [p], modules: [], stories: [], links: [{ id: 'l', from: 'p', to: 'q', proof: { file: 'shop/api/OrderName.java', lines: '12-13' } }] };
    const f = (globalThis as any).TdDetail.create(m, { built: null, titleOf: (s: any) => s.title, order: [], play: null, onStep() {} });
    const [, dl] = f.part(p);
    const kept = d.all(dl, 'td-nw').map((e: any) => e.textContent);
    expect(kept).toEqual(expect.arrayContaining(['37-68', '29-109']));
    expect(dl.textContent).toContain('shop/core/src/Parser.java, lines\u00a037-68');
  });
});

describe('aidlc-turbo Code Scaffold: the build word in the details', () => {
  it('says not used for a part that already existed and was not used in the card, not in a pill of the head', () => {
    (globalThis as any).TdBuild = load('design-built.js');
    (globalThis as any).TdEngine = { ...load('design-engine.js'), kindOf: (k: string) => k };
    load('design-detail.js');
    const p = { id: 'ordn', name: 'OrderName', status: 'existing', path: 'shop/common/OrderName.java', lines: '1-9', module: 'none',
      build: { state: 'gone', story: '003', plan: 'The applications.', why: 'It is on the order already.' } };
    const m = { parts: [p], modules: [], stories: [], links: [] };
    const f = (globalThis as any).TdDetail.create(m, { built: { stories: [] }, titleOf: (s: any) => s.title, order: [], play: null, onStep() {} });
    const [head] = f.part(p);
    expect(d.all(head, 'td-built')).toEqual([]);
    expect(d.all(head, 'td-ddev-t').map((e: any) => e.textContent)).toEqual(['Not used']);
  });

  it('asks the build for no block under the drawing any more', () => {
    expect(read('design-panel.js')).not.toContain('B().block(');
    expect(read('design-built.js')).not.toMatch(/\bblock\b/);
  });
});

describe('aidlc-turbo Code Scaffold: no full screen of the details, no buttons at their top', () => {
  const browse = read('design-browse.css');
  const diff = read('design-diff.css');

  it('no heading over the change, no rule for details on full screen, nothing that keeps clear of buttons', () => {
    expect(diff).not.toMatch(/\.td-df-t\b/);
    for (const [f, css] of [['design-browse.css', browse], ['design-diff.css', diff]]) expect(css, f).not.toMatch(/td-dfull|td-dtools|--td-tools-w/);
  });

  it('keeps its files under 500 lines', () => {
    for (const f of ['design-panel.js', 'design-steps.js', 'design-show.js', 'design-detail.js', 'design-diff.js', 'design-steps.css', 'design-browse.css', 'design-diff.css', 'design-about.css']) {
      const n = read(f).split('\n').length;
      expect(n, f).toBeGreaterThan(1);
      expect(n, f).toBeLessThanOrEqual(500);
    }
  });
});
