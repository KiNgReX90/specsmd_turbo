/**
 * Unit tests for the details as a card over the drawing's full-screen view (design-float.js), on a desktop:
 * - the card holds a head of its own (a grip, "Details", a fold button) and the details under it;
 * - dragged by its head it goes anywhere in the view, 12 px inside, also after the view got smaller, and is
 *   remembered per viewer; a press that hardly moves stays a click; a double click on its head puts it back
 *   top right and forgets it;
 * - its button folds it to the head, remembered; it works without a localStorage;
 * - the view wraps the details in it on a desktop only (a finger keeps the sheet), never pans or zooms under
 *   it; hidden while the details are; inlined before the view, under 500 lines.
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
const read = (f: string) => readFileSync(path.join(DESIGN, f), 'utf8');
const G = globalThis as any;
const VW = 1400, VH = 860, CW = 460, CH = 300;
const px = (v: string) => parseFloat(v);

let d: ReturnType<typeof fakeDom>;
let store: Map<string, string>;
beforeEach(() => {
  d = fakeDom();
  dress(d);
  const make = d.doc.createElement;
  d.doc.createElement = (t: string) => {
    const e = make(t);
    e.closest = (sel: string) => { for (let n = e; n && n.tag; n = n.parent) if (sel.split(',').some((s) => n.classList.contains(s.trim().slice(1)) || n.tag === s.trim())) return n; return null; };
    return e;
  };
  store = new Map();
  G.localStorage = { getItem: (k: string) => (store.has(k) ? store.get(k) : null), setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); } };
  G.addEventListener = () => {};
  G.TdFloat = load('design-float.js');
});

/** The card in a view of 1400 x 860 that starts 60 px down the window. */
function mount() {
  const view = d.node('div');
  view.className = 'td-fs-view';
  Object.assign(view, { clientWidth: VW, clientHeight: VH });
  view.getBoundingClientRect = () => ({ left: 0, top: 60, right: VW, bottom: 60 + VH, width: VW, height: VH });
  const detail = d.node('div');
  detail.className = 'td-detail';
  const f = G.TdFloat.create({ detail });
  const el = f.take();
  view.append(el);
  Object.assign(el, { offsetWidth: CW, offsetHeight: CH, setPointerCapture() {} });
  // where the stylesheet puts it: top right of the view, or where its left and top say
  el.getBoundingClientRect = () => {
    const at = el.classList.contains('td-fdet-at');
    const x = at ? px(el.style.left) : VW - 14 - CW, y = (at ? px(el.style.top) : 14) + 60;
    return { left: x, top: y, right: x + CW, bottom: y + CH, width: CW, height: CH };
  };
  f.place();
  const head = d.all(el, 'td-fdet-head')[0];
  const fold = d.all(el, 'td-fdet-fold')[0];
  const fire = (t: string, target: any, x: number, y: number) => {
    for (const fn of el.listeners[t] || []) fn({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, target, preventDefault() {}, stopPropagation() {} });
  };
  const drag = (x0: number, y0: number, x1: number, y1: number) => { fire('pointerdown', head, x0, y0); fire('pointermove', el, x1, y1); fire('pointerup', el, x1, y1); };
  const at = () => [px(el.style.left), px(el.style.top)];
  return { f, el, view, detail, head, fold, fire, drag, at };
}

describe('aidlc-turbo full screen: the details as a card that floats', () => {
  it('a head of its own (the grip, "Details", the fold button), the details under it', () => {
    const c = mount();
    expect(c.el.children.map((x: any) => x.className.split(' ')[0])).toEqual(['td-fdet-head', 'td-detail']);
    expect(c.head.children.map((x: any) => x.className.split(' ')[0])).toEqual(['td-fdet-grip', 'td-fdet-t', 'td-btn']);
    expect(d.all(c.el, 'td-fdet-t')[0].textContent).toBe('Details');
    expect(c.head.title).toBe('Drag the details wherever you like. A double-click puts them back.');
    expect(c.fold.getAttribute('aria-expanded')).toBe('true');
    expect(c.fold.getAttribute('aria-controls')).toBe(c.detail.id);
  });

  it('dragged by its head it lies where it was let go in the view, remembered; a press that hardly moves stays a click', () => {
    const c = mount();
    c.drag(1000, 100, 1002, 101);
    expect(c.el.classList.contains('td-fdet-at')).toBe(false);
    c.drag(1000, 100, 600, 300);
    expect(c.el.classList.contains('td-fdet-at')).toBe(true);
    expect(c.at()).toEqual([926 - 400, 14 + 200]);
    expect(JSON.parse(store.get('td-detail-at')!)).toEqual({ x: 526, y: 214 });
    // a new view starts where it was let go
    const again = mount();
    expect(again.el.classList.contains('td-fdet-at')).toBe(true);
    expect(again.at()).toEqual([526, 214]);
  });

  it('never out of the view: 12 px inside, also after the view got smaller; lower down shorter, never under 160 px', () => {
    const c = mount();
    c.drag(1000, 100, 3000, 3000);
    expect(c.at()).toEqual([VW - CW - 12, VH - 160 - 12]);
    expect(c.el.style.maxHeight).toBe('160px');
    c.drag(1000, 100, -3000, -3000);
    expect(c.at()).toEqual([12, 12]);
    expect(c.el.style.maxHeight).toBe(`${VH - 24}px`);
    c.drag(100, 100, 900, 500);
    Object.assign(c.view, { clientWidth: 800, clientHeight: 500 });
    c.f.place();
    expect(c.at()).toEqual([800 - CW - 12, 500 - 160 - 12]);
  });

  it('a double click on its head puts it back top right and forgets it; not on its button, not in the details', () => {
    const c = mount();
    c.drag(1000, 100, 600, 300);
    const dbl = (target: any) => { for (const fn of c.el.listeners.dblclick || []) fn({ target, preventDefault() {} }); };
    dbl(c.fold);
    dbl(c.detail);
    expect(c.el.classList.contains('td-fdet-at')).toBe(true);
    // the pointer is captured by the card: the double click on its head comes to the card itself
    dbl(c.el);
    expect(c.el.classList.contains('td-fdet-at')).toBe(false);
    expect([c.el.style.left, c.el.style.top, c.el.style.maxHeight]).toEqual(['', '', '']);
    c.drag(1000, 100, 600, 300);
    dbl(c.head);
    expect(c.el.classList.contains('td-fdet-at')).toBe(false);
    expect(store.has('td-detail-at')).toBe(false);
  });

  it('its button folds it to the head and opens it again, remembered', () => {
    const c = mount();
    c.fold.click();
    expect(c.el.classList.contains('td-fdet-folded')).toBe(true);
    expect(c.fold.getAttribute('aria-expanded')).toBe('false');
    expect(c.fold.title).toBe('Unfold the details');
    expect(store.get('td-detail-folded')).toBe('1');
    expect(mount().el.classList.contains('td-fdet-folded')).toBe(true);
    c.fold.click();
    expect(c.el.classList.contains('td-fdet-folded')).toBe(false);
    expect(c.fold.title).toBe('Fold the details');
  });

  it('works without a localStorage, and with one that throws', () => {
    G.localStorage = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
    const c = mount();
    c.drag(1000, 100, 600, 300);
    c.fold.click();
    expect(c.el.classList.contains('td-fdet-at')).toBe(true);
    expect(c.el.classList.contains('td-fdet-folded')).toBe(true);
  });
});

describe('aidlc-turbo full screen: the view wraps the details', () => {
  const view = read('design-view.js');

  it('on a desktop only, never panning or zooming under the card', () => {
    expect(view).toMatch(/const det = touch \? detail : float\.take\(\);/);
    expect(view).toMatch(/view\.append\(dz, det, /);
    expect(view.match(/\.td-detail, \.td-fdet, /g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('the card in the view top right, its place when dragged, hidden with the details, folded to its head', () => {
    const css = read('design.css');
    expect(css).toMatch(/\.td-fs \.td-fdet \{[^}]*position: absolute;[^}]*top: 14px;[^}]*right: 14px;/);
    expect(css).toMatch(/\.td-fs \.td-fdet\.td-fdet-at \{[^}]*right: auto;/);
    expect(css).toMatch(/\.td-fs \.td-fdet:has\(> \.td-detail\[hidden\]\) \{ display: none; \}/);
    expect(css).toMatch(/\.td-fs \.td-fdet\.td-fdet-folded > \.td-detail \{ display: none; \}/);
    expect(css).toMatch(/\.td-fdet-head \{[^}]*cursor: grab;[^}]*touch-action: none;/);
  });

  it('is inlined before the view, under 500 lines, and so is the view', () => {
    const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
    const at = (f: string) => assets.DESIGN_JS.indexOf(f);
    expect(at('design-float.js')).toBeGreaterThan(-1);
    expect(at('design-float.js')).toBeLessThan(at('design-view.js'));
    for (const f of ['design-float.js', 'design-view.js']) expect(read(f).split('\n').length).toBeLessThanOrEqual(500);
  });
});
