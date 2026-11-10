/**
 * Unit tests for the tab of the v5 page on the overview (design-tabs.js embed, views, create, route; the page
 * holds the v5 page in `<script type="application/json" id="v5-embed">`, lib/overview-page.cjs):
 * - C4 model when the held model has a system context, in the order Functional, Code Scaffold (Code), C4 model,
 *   Review; without the block, or without a system context, no tab more;
 * - its own section, as wide as the drawing's, hidden until its tab shows; the keys of the tabs and the link (#c4)
 *   reach it;
 * - the frame is made the first time its tab shows, once: the v5 page with C4_EMBED (the switches) right after
 *   <head>, a title naming the tab, no sandbox of its own;
 * - a change of the switches goes to every frame made as a message; a frame made later starts as they stand; on a
 *   desktop the box takes the height under the masthead, as Review's.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';
import { load, dress } from './aidlc-turbo-design-panel-mount';
import { BUILT, clone } from './aidlc-turbo-v5-boot';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const { embedBlock, withEmbed, EMBED_OPEN, EMBED_CLOSE } = req(path.join(FLOW, 'scripts/lib/overview-page.cjs'));
const G = globalThis as any;

let d: ReturnType<typeof fakeDom>;
let hashes: string[];
beforeEach(() => {
  d = fakeDom();
  dress(d);
  hashes = [];
  G.history = { replaceState: (_s: unknown, _t: string, h: string) => { hashes.push(h); } };
  Object.assign(G, { innerWidth: 1600, innerHeight: 900, addEventListener() {} });
  delete G.TdRoom;
  delete G.TdView;
  delete G.matchMedia;
});
const T = () => load('design-tabs.js');
const off = (e: any) => e.classList.contains('view-off');

const blocks = new Map<any, string>();
/** The page holds the block the script writes for this v5 model; its text is the JSON string, as the browser reads it. */
function hold(model: any) {
  if (!blocks.has(model)) blocks.set(model, embedBlock(model));
  const block = blocks.get(model)!;
  const e = d.node('script');
  e.textContent = block.slice(EMBED_OPEN.length, block.length - EMBED_CLOSE.length);
  d.doc.getElementById = (id: string) => (id === 'v5-embed' ? e : null);
}
const NOTHING = (() => { const m = clone(BUILT); m.views = {}; return m; })();

/** The page's main with the drawing's section and Review's, the v5 page held, the tabs made with it. */
function page(model: any = BUILT, review = true, o: any = {}) {
  hold(model);
  const main = d.node('main');
  const s = (id: string) => { const e = d.node('section'); e.id = id; main.append(e); return e; };
  const slices = s('sec-slices'), design = s('sec-design');
  const rv = review ? s('sec-review') : null;
  const host = T().embed({ page: main, ...o });
  const shown: string[] = [];
  const t = T().create({ page: main, flow: design, review: rv, built: review, embed: host, onShow: (v: string) => shown.push(v) });
  const tab = (v: string) => t.el.children.find((b: any) => b && b.getAttribute && b.getAttribute('data-view') === v);
  const sec = (v: string) => host.sections[v];
  const frames = (v: string) => (sec(v) ? d.all(sec(v), 'td-embed-box')[0].children.filter((c: any) => c && c.tag === 'iframe') : []);
  return { main, slices, design, rv, host, t, tab, sec, frames, shown, all: () => t.el.children.filter((b: any) => b && b.tag === 'button') };
}
function press(target: any, key: string) {
  const ev: any = { key, target, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  ev.preventDefault = () => { ev.defaultPrevented = true; };
  ev.stopPropagation = () => {};
  for (const fn of target.listeners.keydown || []) fn(ev);
}
/** What the frame's page holds right after its <head>. */
const afterHead = (srcdoc: string) => srcdoc.slice(srcdoc.indexOf('<head>') + '<head>'.length);
const SET = (state: string) => `<script>window.C4_EMBED = ${state};</script>`;
const text = (e: any) => (e ? e.textContent : null);

describe('aidlc-turbo overview: the tab of the v5 page', () => {
  it('in the order Functional, Code Scaffold, C4 model, Review; only when the page holds it', () => {
    expect(T().views(true, true, true, { c4: true })).toEqual([['functional', 'Functional'], ['flow', 'Code'], ['c4', 'C4 model'], ['review', 'Review']]);
    expect(T().views(false, true, false, { c4: true })).toEqual([['functional', 'Functional'], ['flow', 'Code Scaffold'], ['c4', 'C4 model']]);
    expect(T().views(false, true, false, {})).toEqual([['functional', 'Functional'], ['flow', 'Code Scaffold']]);
    expect(T().views(true)).toEqual([['functional', 'Functional'], ['flow', 'Code'], ['review', 'Review']]);
  });

  it('what the held model has: C4 model for a system context, nothing without one or without the block', () => {
    const has = (m: any) => { hold(m); const h = T().embed({ page: d.node('main') }); return h && h.has; };
    expect(has(BUILT)).toEqual({ c4: true });
    expect(has(NOTHING)).toBeNull();
    d.doc.getElementById = () => null;
    expect(T().embed({ page: d.node('main') })).toBeNull();
  });

  it('a section of the page as wide as the drawing\'s, hidden until its tab shows, no frame yet', () => {
    const p = page();
    const s = p.sec('c4');
    expect(s.parent).toBe(p.main);
    expect([s.id, s.getAttribute('aria-label')]).toEqual(['sec-c4', 'C4 model']);
    expect(['panel', 'td-panel', 'td-embed'].every((c) => s.classList.contains(c))).toBe(true);
    expect(off(s)).toBe(true);
    expect(p.frames('c4')).toEqual([]);
    expect(Object.keys(p.host.sections)).toEqual(['c4']);
  });

  it('a tab, its section only when it shows; the body says it is one', () => {
    const p = page();
    expect(p.all().map(text)).toEqual(['Functional', 'Code', 'C4 model', 'Review']);
    expect(p.tab('c4').getAttribute('aria-controls')).toBe('sec-c4');
    p.t.show('c4');
    expect([p.slices, p.design, p.rv, p.sec('c4')].map(off)).toEqual([true, true, true, false]);
    expect(['view-tech', 'view-embed', 'view-review'].map((c) => d.body.classList.contains(c))).toEqual([true, true, false]);
    p.t.show('functional');
    expect([p.slices, p.design, p.rv, p.sec('c4')].map(off)).toEqual([false, true, true, true]);
    expect(d.body.classList.contains('view-embed')).toBe(false);
    p.t.show('flow');
    expect([p.sec('c4'), p.design].map(off)).toEqual([true, false]);
    expect(d.body.classList.contains('view-embed')).toBe(false);
  });

  it('the keys of the tabs and a click reach it; the link names it', () => {
    const p = page();
    p.t.show('functional');
    press(p.tab('functional'), 'ArrowRight');
    expect(p.t.get()).toBe('flow');
    press(p.tab('flow'), 'ArrowRight');
    expect(p.t.get()).toBe('c4');
    press(p.tab('c4'), 'End');
    expect(p.t.get()).toBe('review');
    press(p.tab('review'), 'ArrowLeft');
    expect(p.t.get()).toBe('c4');
    p.tab('functional').click();
    expect(hashes).toEqual(['#flow', '#c4', '#review', '#c4', '#functional']);
  });

  it('the link opens it: #c4, when the page has it', () => {
    const at = (hash: string, o: any = {}) => T().route(hash, { review: true, built: true, drawing: () => false, func: () => false, ...o }).view;
    expect(at('#c4', { c4: true })).toBe('c4');
    expect([at('#c4'), at('#c4', { built: false, review: false })]).toEqual(['flow', 'functional']);
  });
});

describe('aidlc-turbo overview: the frame of the v5 tab', () => {
  it('made the first time its tab shows, once', () => {
    const p = page();
    p.t.show('c4');
    p.t.show('functional');
    p.t.show('c4');
    expect(p.frames('c4').length).toBe(1);
  });

  it('the v5 page with C4_EMBED right after <head>, a title naming the tab, no sandbox of its own', () => {
    const p = page();
    p.t.show('c4');
    const [c4] = p.frames('c4');
    expect(afterHead(c4.srcdoc).startsWith(SET('{"details":true,"help":false}'))).toBe(true);
    expect(c4.srcdoc.indexOf('<head>')).toBeGreaterThan(0);
    expect(c4.srcdoc).toContain('<script>window.C4 = { model: {');
    expect(c4.title).toBe('C4 model');
    expect(c4.hasAttribute('sandbox')).toBe(false);
  });

  it('the switches as the page gives them; a change goes to every frame made, and a frame made later starts so', () => {
    const p = page(BUILT, true, { details: false, help: true });
    p.t.show('c4');
    const [c4] = p.frames('c4');
    expect(afterHead(c4.srcdoc).startsWith(SET('{"details":false,"help":true}'))).toBe(true);
    const sent: any[] = [];
    c4.contentWindow = { postMessage: (m: unknown, to: string) => sent.push([m, to]) };
    p.host.set({ details: true, help: false });
    expect(sent).toEqual([[{ type: 'turbo-switches', details: true, help: false }, '*']]);
    expect(p.host.state()).toEqual({ details: true, help: false });
    // once loaded the frame hears how they stand, should they have changed while it loaded
    for (const fn of c4.listeners.load) fn({});
    expect(sent.length).toBe(2);
  });

  it('tells the frame nothing of a theme: the page is light, whatever the system prefers', () => {
    G.matchMedia = () => ({ matches: true, addEventListener() {} });
    const p = page();
    p.t.show('c4');
    expect(p.frames('c4')[0].srcdoc).not.toMatch(/"theme"/);
  });

  it('on a desktop the box takes the height the window has under the masthead, as Review\'s', () => {
    G.TdRoom = load('design-room.js');
    G.TdView = { touchy: () => false };
    G.getComputedStyle = () => ({ position: 'static', display: 'block', marginBottom: '0' });
    const p = page();
    const box = d.all(p.sec('c4'), 'td-embed-box')[0];
    Object.assign(box, { offsetTop: 200, offsetHeight: 300, offsetParent: null });
    p.t.show('c4');
    expect(box.style.height).toBe('700px');
  });
});

describe('aidlc-turbo overview: the page wires the tab of the v5 page', () => {
  const html = readFileSync(path.join(FLOW, 'templates/overview/overview-template.html'), 'utf8');

  it('the tabs are made with the held page, and the link knows them', () => {
    expect(html).toMatch(/window\.TdTabs\.embed\(/);
    expect(html).toMatch(/TdTabs\.create\(\{[^}]*embed: v5/);
    expect(html).toMatch(/TdTabs\.route\(location\.hash, \{[^}]*c4: /);
  });

  it('the block is parsed before the page\'s script reads it: right after the data block', () => {
    const page = '<body>\n<script id="overview-data" type="application/json">{}</script>\n<script>run()</script>\n</body>';
    const out = withEmbed(page, BUILT);
    const at = out.indexOf('id="v5-embed"');
    expect(at).toBeGreaterThan(out.indexOf('id="overview-data"'));
    expect(at).toBeLessThan(out.indexOf('<script>run()'));
    expect(withEmbed('<body>\n</body>', BUILT).indexOf('id="v5-embed"')).toBeLessThan(withEmbed('<body>\n</body>', BUILT).lastIndexOf('</body>'));
  });

  it('the frame fills its box; the drawing\'s chips and the way back to Review stay off the masthead there', () => {
    expect(html).toMatch(/\.td-embed-box > iframe \{[^}]*width: 100%; height: 100%;/);
    expect(html).toContain('body.view-tech:not(.view-embed) .mast-chips:not(:empty)');
    expect(html).toContain('body.view-tech:not(.view-review):not(.view-embed) .mast-back:not([hidden])');
  });
});
