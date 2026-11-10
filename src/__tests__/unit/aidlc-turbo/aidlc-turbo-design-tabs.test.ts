/**
 * Unit tests for the views of the overview page before and after the build (design-tabs.js; the C4 model tab,
 * the v5 page in a frame, has its own tests in aidlc-turbo-v5-embed.test.ts):
 * - before the build two tabs, "Functional | Code Scaffold"; after it three, "Functional | Code | Review":
 *   the drawing's tab is the Code Scaffold to approve, and after the build the code as it was built; a
 *   tablist with one tab in the Tab order, the chosen one;
 * - a tab shows its sections only (Functional all but the drawing and Review, the other two only theirs),
 *   the body says which; a click or a key sets the link (#functional, #flow, #review);
 * - left and right on the focused switch go to the tab before or after it (round), Home and End to the first
 *   and the last, and the key goes no further (the drawing and the page keep their own keys);
 * - the link opens a view: #functional, #flow, #review and #review/<part>; a story,
 *   a part or a module opens the flow view there; something on the Functional side opens that; else the
 *   view the page opened on before (the flow view after the build);
 * - Review mounts the other view (window.TdReview) the first time it shows, once, and opens a part on it;
 *   without TdReview a short word in its place; on a desktop it gets the height under the masthead;
 * - it ships with the drawing, after the panel, and the knob of the Maquette slides to the chosen tab.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';
import { load, dress } from './aidlc-turbo-design-panel-mount';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const read = (f: string) => { try { return readFileSync(path.join(DESIGN, f), 'utf8'); } catch { return ''; } };
const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
const G = globalThis as any;

let d: ReturnType<typeof fakeDom>;
let hashes: string[];
beforeEach(() => {
  d = fakeDom();
  dress(d);
  hashes = [];
  G.history = { replaceState: (_s: unknown, _t: string, h: string) => { hashes.push(h); } };
  Object.assign(G, { innerWidth: 1600, innerHeight: 900, addEventListener() {} });
  delete G.TdReview;
});
const text = (e: any) => (e ? e.textContent : null);
const T = () => load('design-tabs.js');

/** The page's main with its sections, the drawing's and Review's among them. */
function page(review = true) {
  const main = d.node('main');
  const s = (id: string) => { const e = d.node('section'); e.id = id; main.append(e); return e; };
  const flowpanel = s('sec-flow'), slices = s('sec-slices'), design = s('sec-design');
  const rv = review ? s('sec-review') : null;
  const tests = s('sec-tests');
  return { main, flowpanel, slices, design, rv, tests };
}
function tabs(review = true, shown: string[] = [], built?: boolean) {
  const p = page(review);
  const t = T().create({ page: p.main, flow: p.design, review: p.rv, built, onShow: (v: string) => shown.push(v) });
  const tab = (v: string) => t.el.children.find((b: any) => b && b.getAttribute && b.getAttribute('data-view') === v);
  return { ...p, t, tab, all: () => t.el.children.filter((b: any) => b && b.tag === 'button') };
}
const off = (e: any) => e.classList.contains('view-off');
function press(target: any, key: string, extra: Record<string, unknown> = {}) {
  const ev: any = { key, target, defaultPrevented: false, stopped: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra };
  ev.preventDefault = () => { ev.defaultPrevented = true; };
  ev.stopPropagation = () => { ev.stopped = true; };
  for (const fn of target.listeners.keydown || []) fn(ev);
  return ev;
}

describe('aidlc-turbo overview: the tabs', () => {
  it('two tabs before the build, Functional and Code Scaffold; three after it, Functional, Code and Review', () => {
    expect(T().views(false)).toEqual([['functional', 'Functional'], ['flow', 'Code Scaffold']]);
    expect(T().views(true)).toEqual([['functional', 'Functional'], ['flow', 'Code'], ['review', 'Review']]);
    expect(tabs(false).all().map(text)).toEqual(['Functional', 'Code Scaffold']);
    expect(tabs(true).all().map(text)).toEqual(['Functional', 'Code', 'Review']);
  });

  it('the drawing\'s tab is named by the build, not by Review: built says it when the page tells', () => {
    expect(T().views(false, true, true)).toEqual([['functional', 'Functional'], ['flow', 'Code']]);
    expect(T().views(true, true, false)).toEqual([['functional', 'Functional'], ['flow', 'Code Scaffold'], ['review', 'Review']]);
    expect(tabs(false, [], true).all().map(text)).toEqual(['Functional', 'Code']);
    expect(tabs(true, [], false).all().map(text)).toEqual(['Functional', 'Code Scaffold', 'Review']);
    // the link stays #flow whatever the tab is called
    expect(tabs(false).tab('flow').id).toBe('tab-flow');
    expect(tabs(true).tab('flow').id).toBe('tab-flow');
  });

  it('a tablist the switch looks as before: the class views, one tab in the Tab order, the chosen one', () => {
    const x = tabs();
    expect(x.t.el.className).toBe('views');
    expect(x.t.el.getAttribute('role')).toBe('tablist');
    expect(x.t.el.getAttribute('aria-label')).toBeTruthy();
    x.t.show('flow');
    for (const b of x.all()) {
      expect(b.getAttribute('role')).toBe('tab');
      expect(b.type).toBe('button');
      const on = b.getAttribute('data-view') === 'flow';
      expect(b.getAttribute('aria-selected')).toBe(String(on));
      expect(b.getAttribute('tabindex')).toBe(on ? '0' : '-1');
    }
    expect(x.tab('flow').getAttribute('aria-controls')).toBe('sec-design');
    expect(x.tab('review').getAttribute('aria-controls')).toBe('sec-review');
  });

  it('each tab shows only its own sections; the body says which', () => {
    const shown: string[] = [];
    const x = tabs(true, shown);
    expect(x.t.show('functional')).toBe(true);
    expect([x.flowpanel, x.slices, x.design, x.rv, x.tests].map(off)).toEqual([false, false, true, true, false]);
    expect(d.body.classList.contains('view-tech')).toBe(false);
    x.t.show('flow');
    expect([x.flowpanel, x.slices, x.design, x.rv, x.tests].map(off)).toEqual([true, true, false, true, true]);
    expect(d.body.classList.contains('view-tech')).toBe(true);
    expect(d.body.classList.contains('view-review')).toBe(false);
    x.t.show('review');
    expect([x.flowpanel, x.slices, x.design, x.rv, x.tests].map(off)).toEqual([true, true, true, false, true]);
    expect(d.body.classList.contains('view-tech')).toBe(true);
    expect(d.body.classList.contains('view-review')).toBe(true);
    expect(x.t.get()).toBe('review');
    expect(shown).toEqual(['functional', 'flow', 'review']);
  });

  it('no Review before the build: show says so and changes nothing', () => {
    const x = tabs(false);
    x.t.show('flow');
    expect(x.t.show('review')).toBe(false);
    expect(x.t.get()).toBe('flow');
    expect(off(x.design)).toBe(false);
  });

  it('a click shows the tab and sets its link', () => {
    const x = tabs();
    x.tab('review').click();
    expect(x.t.get()).toBe('review');
    x.tab('flow').click();
    x.tab('functional').click();
    expect(hashes).toEqual(['#review', '#flow', '#functional']);
  });

  it('a tab clicked with the mouse lets go of the focus, so the arrows walk the drawing; Enter or Space on it keeps it', () => {
    const x = tabs();
    const b = x.tab('flow');
    let blurred = 0;
    b.blur = () => { blurred += 1; };
    const click = (detail: number) => { for (const fn of b.listeners.click) fn({ target: b, detail, preventDefault() {}, stopPropagation() {} }); };
    click(1);
    expect(x.t.get()).toBe('flow');
    expect(blurred).toBe(1);
    click(0); // the keyboard's click
    expect(blurred).toBe(1);
  });

  it('left and right on the focused switch go round the tabs, Home and End to the ends; the key goes no further', () => {
    const x = tabs();
    x.t.show('functional');
    let ev = press(x.tab('functional'), 'ArrowRight');
    expect(x.t.get()).toBe('flow');
    expect(d.doc.activeElement).toBe(x.tab('flow'));
    expect(ev.defaultPrevented && ev.stopped).toBe(true);
    press(x.tab('flow'), 'ArrowRight');
    expect(x.t.get()).toBe('review');
    press(x.tab('review'), 'ArrowRight');
    expect(x.t.get()).toBe('functional');
    press(x.tab('functional'), 'ArrowLeft');
    expect(x.t.get()).toBe('review');
    press(x.tab('review'), 'Home');
    expect(x.t.get()).toBe('functional');
    press(x.tab('functional'), 'End');
    expect(x.t.get()).toBe('review');
    expect(hashes.slice(-1)).toEqual(['#review']);
    ev = press(x.tab('review'), 'a');
    expect(ev.defaultPrevented).toBe(false);
    // with a modifier the browser keeps the key
    ev = press(x.tab('review'), 'ArrowLeft', { altKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(x.t.get()).toBe('review');
  });

  it('the drawing\'s own keys leave a tab alone (a tab is a field to them)', () => {
    for (const f of ['design-play.js', 'design-browse.js']) expect(read(f), f).toContain('[role="tab"]');
  });
});

describe('aidlc-turbo overview: the link opens a view', () => {
  const at = (hash: string, o: any = {}) => T().route(hash, { review: true, built: true, drawing: (h: string) => /^story-\d+$/.test(h) || h === 'trend', func: (h: string) => h === 'sec-tests', ...o });

  it('#functional, #flow, #review and #review/<part>', () => {
    expect(at('#functional')).toEqual({ view: 'functional', part: null, follow: false });
    expect(at('#flow')).toEqual({ view: 'flow', part: null, follow: false });
    expect(at('#review')).toEqual({ view: 'review', part: null, follow: false });
    expect(at('#review/trend')).toEqual({ view: 'review', part: 'trend', follow: false });
  });

  it('a story, a part or a module opens the flow view there; something on the Functional side opens that', () => {
    expect(at('#story-2')).toEqual({ view: 'flow', part: null, follow: true });
    expect(at('#trend')).toEqual({ view: 'flow', part: null, follow: true });
    expect(at('#sec-tests')).toEqual({ view: 'functional', part: null, follow: false });
  });

  it('else the view the page opened on before: the flow view after the build, Functional before it', () => {
    expect(at('').view).toBe('flow');
    expect(at('#nergens').view).toBe('flow');
    expect(at('', { built: false, review: false }).view).toBe('functional');
    // Review asked before the build: there is none
    expect(at('#review/trend', { built: false, review: false }).view).toBe('functional');
    expect(at('#%E0%A4%A').view).toBe('flow');
  });
});

describe('aidlc-turbo overview: Review mounts the other view the first time it shows', () => {
  const model = { parts: [], modules: [], links: [], stories: [] };
  function stub() {
    const calls: any[] = [];
    const opened: string[] = [];
    G.TdReview = { mount: (el: any, m: any, o: any) => { calls.push({ el, m, o }); return { open: (id: string) => opened.push(id) }; } };
    return { calls, opened };
  }

  it('waits until it shows, then mounts once with the model, the titles, the phase and the way back to the flow', () => {
    const s = stub();
    const box = d.node('div');
    const onFlow = () => {};
    const r = T().reviewer(box, { model, titles: { '001': 'One' }, phase: 'construction', onFlow });
    expect(s.calls).toEqual([]);
    r.show();
    r.show();
    expect(s.calls.length).toBe(1);
    expect(s.calls[0].el).toBe(box);
    expect(s.calls[0].m).toBe(model);
    expect(s.calls[0].o).toEqual({ titles: { '001': 'One' }, phase: 'construction', onFlow });
  });

  it('open(part) mounts it when needed and opens that file', () => {
    const s = stub();
    const r = T().reviewer(d.node('div'), { model, titles: {}, phase: 'construction', onFlow() {} });
    r.open('trend');
    r.open('ctrl');
    expect(s.calls.length).toBe(1);
    expect(s.opened).toEqual(['trend', 'ctrl']);
  });

  it('without TdReview on the page a short word stands in its place, and nothing breaks', () => {
    const box = d.node('div');
    const r = T().reviewer(box, { model, titles: {}, phase: 'construction', onFlow() {} });
    r.open('trend');
    expect(text(box)).toMatch(/review/i);
    expect(d.all(box, 'rv-wait').length).toBe(1);
  });

  it('on a desktop the box gets the height the window has under the masthead; elsewhere its own', () => {
    G.TdRoom = load('design-room.js');
    G.TdView = { touchy: () => false };
    G.getComputedStyle = () => ({ position: 'static', display: 'block', marginBottom: '0' });
    const box = d.node('div');
    Object.assign(box, { offsetTop: 200, offsetHeight: 300, offsetParent: null });
    const r = T().reviewer(box, { model, titles: {}, phase: 'construction', onFlow() {} });
    r.show();
    expect(box.style.height).toBe('700px');
    G.innerWidth = 900;
    r.fit();
    expect(box.style.height).toBe('');
  });
});

describe('aidlc-turbo overview: the way back to Review', () => {
  it('a button that waits hidden until the viewer came from Review', () => {
    const b = T().back({ onBack() {} });
    expect(b.el.tag).toBe('button');
    expect(b.el.type).toBe('button');
    expect(b.el.className).toBe('mast-back');
    expect(b.el.hidden).toBe(true);
    expect(b.at()).toBeNull();
  });

  it('set(part, name) shows it with the file it goes back to; clear() hides it again', () => {
    const b = T().back({ onBack() {} });
    b.set('fbeh', 'FbehStatus.java');
    expect(b.el.hidden).toBe(false);
    expect(b.at()).toBe('fbeh');
    expect(text(d.all(b.el, 'mast-back-t')[0])).toBe('Back to Review');
    expect(text(d.all(b.el, 'mast-back-f')[0])).toBe('FbehStatus.java');
    expect(b.el.title).toBe('Back to FbehStatus.java in Review');
    b.clear();
    expect(b.el.hidden).toBe(true);
    expect(b.at()).toBeNull();
  });

  it('without a name it says only where it goes', () => {
    const b = T().back({ onBack() {} });
    b.set('fbeh');
    expect(d.all(b.el, 'mast-back-f')).toHaveLength(0);
    expect(b.el.title).toBe('Back to Review');
  });

  it('a click goes back to the file it came from, however far the viewer walked the drawing', () => {
    const went: string[] = [];
    const b = T().back({ onBack: (id: string) => went.push(id) });
    b.set('fbeh', 'FbehStatus.java');
    b.el.click();
    expect(went).toEqual(['fbeh']);
  });
});

describe('aidlc-turbo overview: design-tabs.js on the page', () => {
  it('ships design-tabs.js with the drawing, after the panel', () => {
    const js = (f: string) => assets.DESIGN_JS.indexOf(f);
    expect(js('design-tabs.js')).toBeGreaterThan(js('design-panel.js'));
    expect(read('design-tabs.js').split('\n').length).toBeLessThanOrEqual(500);
    expect(read('design-tabs.js')).not.toContain('—');
  });

  it('the knob of the Maquette slides to the chosen tab too, and the style marks it', () => {
    expect(read('maquette-page.js')).toMatch(/getAttribute\('aria-selected'\) === 'true'/);
    expect(read('maquette-page.js')).toMatch(/attributeFilter: \['aria-pressed', 'aria-selected', 'class'\]/);
    expect(read('maquette.css')).toMatch(/\.mq \.views\.mq-has-knob button:is\(\[aria-pressed="true"\], \[aria-selected="true"\]\)/);
  });
});
