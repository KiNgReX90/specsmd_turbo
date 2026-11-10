/**
 * Unit tests for the flow view of the Code Scaffold (the tab "Code Scaffold", after the build "Code"):
 * - no switch Flow | Review over the drawing any more (design-mode.js is gone): the drawing is always in
 *   step mode, step 1 held when the page opens, before and after the build; the arrows and Space walk and
 *   play the steps from the start; Escape, the empty drawing and walking past an end never leave it
 *   without a step;
 * - a click on a block chooses it (lit in the drawing) and shows its details, the step into it held where
 *   there is one; the next step walked to shows where that step goes;
 * - a block with the focus keeps the four arrows (design-near.js);
 * - the details: the head (state pill, kind, the name as plain text: no dropdown, design-pick.js is gone),
 *   what it does, what changed, the deviation, its flow, its stories and the walk; never the change in the
 *   code (that is the Review tab's), no divider, no full screen of the details;
 * - "See the change" after the build, only for a part with a change in the code or a deviation, calls
 *   onReview(partId); never before the build;
 * The texts are those of the English string table (design.* of templates/lang/en.json).
 * - the panel's rail reads "Details", its width suits text.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';
import { load, dress, mountPanel } from './aidlc-turbo-design-panel-mount';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const read = (f: string) => { try { return readFileSync(path.join(DESIGN, f), 'utf8'); } catch { return ''; } };
const plain = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '');
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const { layout } = req(path.join(DESIGN, 'design-layout.js'));
const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const EN = JSON.parse(readFileSync(path.join(FLOW, 'templates/lang/en.json'), 'utf8')).design;
const fresh = () => dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
const model = fresh();
const geo = layout(model);
const ORDER: string[] = geo.flow.order;

let d: ReturnType<typeof fakeDom>;
beforeEach(() => {
  d = fakeDom();
  dress(d);
});
const text = (e: any) => (e ? e.textContent : null);
const first = (e: any, cls: string) => (e ? d.all(e, cls)[0] || null : null);
const link = (id: string) => model.links.find((l: any) => l.id === id);
const nameOf = (id: string) => model.parts.find((p: any) => p.id === id).name;
/** The name in the details shown: the h3 of the head. */
const h3 = (p: any) => { const head = first(p.shown(), 'td-dhead'); return head && head.children.find((c: any) => c && c.tag === 'h3'); };
const named = (p: any) => text(h3(p));
/** "Step n" of the step held, in the box over the drawing; null while it is hidden. */
const stepOf = (p: any) => (p.box() && !p.box().hidden ? text(first(p.box(), 'td-sbox-n')) : null);
const playing = (p: any) => first(p.root, 'td-steps-play').classList.contains('td-playing');

/** The model after the build: `trend` built otherwise, `ctrl` with a change in the code, the rest as planned. */
function built() {
  const m = fresh();
  for (const x of [...m.parts, ...m.modules]) x.build = { state: 'as_planned' };
  m.parts.find((x: any) => x.id === 'trend').build = { state: 'different', plan: 'Per day.', built: 'Per hour.', why: 'Too coarse.' };
  const c = m.parts.find((x: any) => x.id === 'ctrl');
  c.path = c.path || 'src/Ctrl.java';
  delete c.repo;
  m.build = { stories: [], different: 1, extra: 0, gone: 0, diffs: { [c.path]: { text: '@@ -1,1 +1,1 @@\n-a\n+b\n', added: 1, removed: 1 } } };
  return m;
}

describe('aidlc-turbo flow view: no switch, always a step held', () => {
  it('has no switch Flow | Review: design-mode.js is gone, nothing carries it', () => {
    const p = mountPanel(d, model, geo);
    expect(d.all(p.root, 'td-mode')).toEqual([]);
    expect(d.all(p.root, 'td-mode-b')).toEqual([]);
    expect(existsSync(path.join(DESIGN, 'design-mode.js'))).toBe(false);
    expect(assets.DESIGN_JS).not.toContain('design-mode.js');
    for (const f of ['design-panel.js', 'design-chosen.js', 'design-browse.js', 'design-pane.js', 'design-show.js', 'design-play.js']) {
      expect(read(f), f).not.toMatch(/TdMode|design-mode\.js|mode\.get\(\)/);
    }
    expect(plain('design-steps.css') + plain('maquette-draw.css')).not.toContain('td-mode');
  });

  it('holds step 1 when the page opens, the part it goes to in the details, the step in the box', () => {
    const p = mountPanel(d, model, geo);
    expect(p.steps.current()).toBe(ORDER[0]);
    expect(named(p)).toBe(nameOf(link(ORDER[0]).to));
    expect(stepOf(p)).toMatch(/^Step 1\b/);
  });

  it('holds step 1 after the build as well, never the first changed file', () => {
    const m = built();
    const p = mountPanel(d, m, layout(m), { phase: 'construction' });
    expect(p.steps.current()).toBe(layout(m).flow.order[0]);
    expect(d.all(p.root, 'td-sel')).toEqual([]);
    expect(read('design-chosen.js') + read('design-browse.js')).not.toMatch(/first changed file|TdDiff\.entry/);
  });

  it('the arrows walk the steps from the start, Space plays and pauses', () => {
    const p = mountPanel(d, model, geo);
    d.key('ArrowRight');
    expect(p.steps.current()).toBe(ORDER[1]);
    expect(named(p)).toBe(nameOf(link(ORDER[1]).to));
    d.key('ArrowLeft');
    expect(p.steps.current()).toBe(ORDER[0]);
    d.key(' ');
    expect(playing(p)).toBe(true);
    d.key(' ');
    expect(playing(p)).toBe(false);
  });

  it('Escape, the empty drawing and walking past an end keep a step held', () => {
    const p = mountPanel(d, model, geo);
    d.key('Escape');
    p.blank();
    expect(p.steps.current()).toBe(ORDER[0]);
    d.key('ArrowLeft');
    expect(p.steps.current()).toBe(ORDER[0]);
    for (let i = 0; i < ORDER.length + 2; i += 1) d.key('ArrowRight');
    expect(p.steps.current()).toBe(ORDER[ORDER.length - 1]);
    expect(p.detail.hidden).toBe(false);
  });

  it('a block clicked is chosen and shows its details, the step into it held; the next step shows where it goes', () => {
    const p = mountPanel(d, model, geo);
    p.node('trend').click();
    expect(p.chosen('trend')).toBe(true);
    expect(named(p)).toBe('OrderTrendQuery');
    expect(link(p.steps.current()).to).toBe('trend');
    expect(stepOf(p)).toMatch(/^Step \d+\b/);
    d.key('ArrowRight');
    expect(p.chosen('trend')).toBe(false);
    expect(named(p)).toBe(nameOf(link(p.steps.current()).to));
  });

  it('a block no step goes to is chosen and shows, a step still held', () => {
    const p = mountPanel(d, model, geo);
    p.node('menu').click();
    expect(p.chosen('menu')).toBe(true);
    expect(named(p)).toBe(nameOf('menu'));
    expect(p.steps.current()).toBeTruthy();
  });

  it('a block with the focus keeps the four arrows: they go to the block in that direction, not to a step', () => {
    const p = mountPanel(d, model, geo);
    const blocks = geo.blocks.filter((b: any) => model.parts.some((x: any) => x.id === b.id));
    const near = (from: string, dir: string) => load('design-near.js').pick(blocks, from, dir);
    const from = blocks.find((b: any) => near(b.id, 'down'))!.id;
    const to = near(from, 'down');
    p.node(from).focus();
    const ev: any = { key: 'ArrowDown', target: p.node(from), defaultPrevented: false, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {} };
    for (const fn of p.node(from).listeners.keydown) fn(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(d.doc.activeElement).toBe(p.node(to));
    const l = link(p.steps.current());
    expect(p.chosen(to) || l.to === to).toBe(true);
  });

  it('the keys along the drawing say the steps, never the elements', () => {
    const p = mountPanel(d, model, geo);
    const keys = d.all(p.root, 'td-steps-keys')[0];
    expect(text(keys.lastElementChild)).toBe(EN.steps.prevNext);
    p.node('menu').click();
    expect(text(keys.lastElementChild)).toBe(EN.steps.prevNext);
  });
});

describe('aidlc-turbo flow view: the details panel', () => {
  it('the name is plain text, no dropdown: design-pick.js and its style are gone', () => {
    const p = mountPanel(d, model, geo);
    p.node('trend').click();
    expect(h3(p)).toBeTruthy();
    expect(d.all(h3(p), 'td-pick')).toEqual([]);
    expect(named(p)).toBe('OrderTrendQuery');
    for (const f of ['design-pick.js', 'design-pick.css']) expect(existsSync(path.join(DESIGN, f)), f).toBe(false);
    expect(assets.DESIGN_JS).not.toContain('design-pick.js');
    expect(assets.DESIGN_CSS).not.toContain('design-pick.css');
    for (const f of ['design-panel.js', 'design-detail.js', 'design-browse.js']) expect(read(f), f).not.toMatch(/TdPick|design-pick/);
  });

  it('after the build the details never hold the change in the code: no diff, no divider, no full screen', () => {
    const m = built();
    const p = mountPanel(d, m, layout(m), { phase: 'construction' });
    p.node('ctrl').click();
    expect(String(p.shown().className)).toBe('td-dcol');
    for (const gone of ['td-diff', 'td-dsplit', 'td-dsep', 'td-dfb', 'td-dtools']) expect(d.all(p.detail, gone), gone).toEqual([]);
    expect(read('design-show.js')).not.toMatch(/TdDiff/);
    for (const f of ['design-browse.js', 'design-pane.js']) expect(read(f), f).not.toMatch(/td-dfull|td-dsep/);
  });

  it('"See the change" for a part with a change in the code or a deviation, calling onReview with its id', () => {
    const m = built();
    const asked: string[] = [];
    const p = mountPanel(d, m, layout(m), { phase: 'construction', onReview: (id: string) => asked.push(id) });
    const go = () => first(p.shown(), 'td-dreview');
    p.node('ctrl').click();
    expect(text(go())).toBe(EN.detail.review);
    expect(go().tag).toBe('button');
    go().click();
    expect(asked).toEqual(['ctrl']);
    p.node('trend').click();
    expect(go()).toBeTruthy();
    go().click();
    expect(asked).toEqual(['ctrl', 'trend']);
    p.node('menu').click(); // built as planned, no change in the code on the page
    expect(go()).toBeNull();
  });

  it('no "See the change" before the build, nor without a way to Review', () => {
    const p = mountPanel(d, model, geo, { onReview: () => {} });
    p.node('trend').click();
    expect(first(p.shown(), 'td-dreview')).toBeNull();
    d = fakeDom();
    dress(d);
    const m = built();
    const q = mountPanel(d, m, layout(m), { phase: 'construction' });
    q.node('ctrl').click();
    expect(first(q.shown(), 'td-dreview')).toBeNull();
  });

  it('the rail reads "Details", also after the build; the panel opens at a width that suits text', () => {
    const P = load('design-pane.js');
    const detail = d.node('div');
    detail.className = 'td-detail';
    const p = P.create(detail, { host: d.node('div'), draw: d.node('div'), steps: true, desk: () => true, onChange() {} });
    expect(text(first(p.el, 'td-dpane-name'))).toBe(EN.pane.rail);
    expect(read('design-pane.js')).not.toContain('Diffs');
    expect(P.OPEN).toBeGreaterThanOrEqual(380);
    expect(P.OPEN).toBeLessThanOrEqual(420);
    expect(P.MIN).toBeLessThan(P.OPEN);
    expect(P.MIN_CODE).toBeUndefined();
    expect(plain('design-pane.css')).not.toMatch(/\.td-dsep|td-dcode|td-dfull/);
  });

  it('keeps the files of the flow view under 500 lines, without a long dash', () => {
    for (const f of ['design-panel.js', 'design-chosen.js', 'design-show.js', 'design-browse.js', 'design-pane.js', 'design-detail.js']) {
      expect(read(f).split('\n').length, f).toBeLessThanOrEqual(500);
      expect(read(f), f).not.toContain('—');
    }
  });
});

describe('aidlc-turbo flow view: what the details say after the build', () => {
  /** The model after the build, `trend` built otherwise, the steps around it told in plain sentences. */
  function after() {
    const m = fresh();
    for (const x of [...m.parts, ...m.modules]) x.build = { state: 'as_planned' };
    m.parts.find((x: any) => x.id === 'trend').build = { state: 'different', plan: 'Gives the trend per day.', built: 'Gives the trend per hour.', why: 'Per day was too coarse.' };
    m.links.find((l: any) => l.id === 'uc-trend').step = 'The use cases ask for the trend.';
    m.build = { stories: [], different: 1, extra: 0, gone: 0 };
    return m;
  }

  it('a part that deviated: the head, its description with the flow, one card of the deviation and its stories; no rows', () => {
    const m = after();
    const p = mountPanel(d, m, layout(m), { phase: 'construction' });
    p.node('trend').click();
    const g = p.shown();
    expect(d.all(g, 'td-dl')).toEqual([]);
    const head = first(g, 'td-dhead');
    expect(text(first(head, 'td-dwhat'))).toBe(m.parts.find((x: any) => x.id === 'trend').what);
    expect(text(first(head, 'td-dflow'))).toBe(EN.about.inFlowOne.replace('{text}', 'the use cases ask for the trend').replace('{n}', '11'));
    expect(text(first(head, 'td-ddev-t'))).toBe(EN.about.different);
    expect(d.all(head, 'td-ddev-p').map(text)).toEqual([`${EN.built.planned} Gives the trend per day.`, `${EN.built.builtLabel} Gives the trend per hour.`, `${EN.built.why} Per day was too coarse.`]);
    expect(d.all(g, 'td-cs-s').map((b: any) => text(first(b, 'td-badge')))).toEqual(['2', '3']);
    for (const gone of [EN.detail.builtIn, EN.detail.inCode, 'Module']) expect(text(g), gone).not.toContain(gone);
  });

  it('a part built as planned: only its description and its stories', () => {
    const m = after();
    const p = mountPanel(d, m, layout(m), { phase: 'construction' });
    p.node('ctrl').click();
    const g = p.shown();
    expect(d.all(g, 'td-dl')).toEqual([]);
    expect(first(g, 'td-ddev')).toBeNull();
    expect(text(first(g, 'td-dwhat'))).toBe(m.parts.find((x: any) => x.id === 'ctrl').what);
    expect(d.all(g, 'td-cs-s').length).toBeGreaterThan(0);
  });

  it('the walk is the footer of the details\' column, after the body that scrolls, never inside it', () => {
    const p = mountPanel(d, model, geo);
    p.node('trend').click();
    const col = p.shown();
    expect(String(col.className)).toBe('td-dcol');
    expect(col.children.map((c: any) => String(c.className).split(' ')[0])).toEqual(['td-dgrid', 'td-walk']);
    expect(first(first(col, 'td-dgrid'), 'td-walk')).toBeNull();
  });
});

describe('aidlc-turbo flow view: the details before the build keep the rows of the review', () => {
  it('the plan page: the description with the flow, then the rows that matter to approve the design', () => {
    const m = fresh();
    m.links.find((l: any) => l.id === 'uc-trend').step = 'The use cases ask for the trend.';
    const p = mountPanel(d, m, layout(m));
    p.node('trend').click();
    const g = p.shown();
    expect(text(first(g, 'td-dflow'))).toBe(EN.about.inFlowOne.replace('{text}', 'the use cases ask for the trend').replace('{n}', '11'));
    const terms = d.all(g, 'td-dl')[0].children.filter((c: any) => c.tag === 'dt').map(text);
    expect(terms[0]).toBe(EN.detail.certainty);
    expect(terms).toContain(EN.detail.builtIn);
    expect(terms).not.toContain('Module');
  });
});

describe('aidlc-turbo flow view: the row over the drawing without the switch', () => {
  it('shortens only where the walk, "Full screen" and "Only new and changed" no longer fit', () => {
    // the pills measured: the walk 214, "Full screen" 159 (its icon 40), the switch 235; gaps 6, edges 24, margin 7
    const css = read('design-steps.css');
    expect(css).toMatch(/@container td-draw \(max-width: 651px\) \{\s*\.td-ctl-l \.td-fsb > span \{ display: none; \}/);
    expect(css).toMatch(/@container td-draw \(max-width: 532px\) \{\s*\.td-ctl-l:has\(> \.td-fsb\) \.td-only-t \{ display: none; \}/);
    expect(css).toMatch(/@container td-draw \(max-width: 486px\) \{\s*\.td-ctl-l \.td-only-t \{ display: none; \}/);
    expect(css).not.toMatch(/Flow \| Review/);
  });
});
