/**
 * Unit tests for the step held in a small box over the Code Scaffold drawing
 * (design-stepbox.js), so the step is always readable where the drawing
 * leaves the label of its arrow out:
 * - shown whenever a step is held (always, only a story without steps
 *   holds none), hidden while none is; "Step n", at
 *   the end of its head a small label per story ("US 003", its title in
 *   its tooltip and its name), its plain sentence (its label without one),
 *   and a small line from -> to with the call in code type; one line for a
 *   screen reader (role status) says the step once when it changes;
 * - another step fades over: the old one fades out over the new one in the
 *   new one's size, opacity only, the last step wins; at once with reduced
 *   motion and when the box was hidden;
 * - it starts in the drawing's frame, bottom left; dragged by its head it
 *   floats over the page, 12 px inside the window, also after a resize, and
 *   is remembered per viewer; a double click or two taps on its head put it
 *   back in its place and forget it; a press that hardly moves stays a click;
 * - its button folds it to a pill "Step n", remembered; it works without
 *   localStorage;
 * - in the drawing's full-screen view it stays inside the view, which takes
 *   it along and never pans or resets under it; in the preview of a phone it
 *   stays a bar in the frame;
 * - the details panel has no step box of its own any more.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
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
const fresh = () => dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
const model = fresh();
const geo = layout(model);
const ORDER: string[] = geo.flow.order;
const G = globalThis as any;
const HEAD = 'Drag the step wherever you like. A double-click puts it back.';
const W = 1400, H = 900, BW = 340, BH = 120;

let d: ReturnType<typeof fakeDom>;
let resized: (() => void)[];
let store: Map<string, string>;
/** A selector of plain classes and tags, separated by commas: does el match one of them? */
const matches = (el: any, sel: string) => sel.split(',').map((s) => s.trim()).some((s) => (s.startsWith('.')
  ? String(el.className || '').split(' ').includes(s.slice(1)) : el.tag === s));
beforeEach(() => {
  d = fakeDom();
  dress(d);
  // an element moves when it is put elsewhere, and closest() looks up through its parents, as in a browser
  const make = d.doc.createElement;
  d.doc.createElement = (t: string) => {
    const e = make(t);
    const add = e.append;
    e.append = (...xs: any[]) => { for (const x of xs) if (x && x.parent && x.parent !== e && x.parent.children) x.parent.children = x.parent.children.filter((c: any) => c !== x); add(...xs); };
    e.closest = (sel: string) => { for (let n = e; n && n.tag; n = n.parent) if (matches(n, sel)) return n; return null; };
    return e;
  };
  Object.assign(d.html, { clientWidth: W, clientHeight: H });
  resized = [];
  G.addEventListener = (t: string, fn: () => void) => { if (t === 'resize') resized.push(fn); };
  store = new Map();
  G.localStorage = { getItem: (k: string) => (store.has(k) ? store.get(k) : null), setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); } };
  delete G.TdSwap; // the box fades on its own
  delete G.matchMedia;
  G.TdStepBox = load('design-stepbox.js');
  load('design-steps.js');
});

const text = (e: any) => (e ? e.textContent : null);
const first = (e: any, cls: string) => (e ? d.all(e, cls)[0] || null : null);
const px = (v: string) => parseFloat(v);

/** The box over a drawing in a window of 1400 x 900: its frame (bottom left at 24, 760) and the page it floats in. */
function mount(m: any = model, o: { page?: string } = {}, titleOf?: (s: any) => string) {
  const page = d.node('div'), frame = d.node('div');
  page.className = 'td-root' + (o.page ? ' ' + o.page : '');
  frame.className = 'td-dzw';
  page.append(frame);
  const steps = G.TdSteps.create(m, layout(m), d.node('svg'), [], []);
  const b = G.TdStepBox.create({ model: m, steps, frame, page, titleOf });
  const el = b.el;
  // where the stylesheet puts it: in its place bottom left of the frame, floating where its left and top say
  // (on the window on the page, in the view inside the view)
  Object.assign(el, { offsetWidth: BW, offsetHeight: BH, setPointerCapture() {} });
  el.getBoundingClientRect = () => {
    const v = el.parent && el.parent.classList.contains('td-fs-view') ? el.parent.getBoundingClientRect() : { left: 0, top: 0 };
    const float = el.classList.contains('td-sbox-float');
    const x = float ? px(el.style.left) + v.left : 24, y = float ? px(el.style.top) + v.top : 760 - BH;
    return { left: x, top: y, right: x + BW, bottom: y + BH, width: BW, height: BH };
  };
  const head = () => first(el, 'td-sbox-head');
  const fold = () => first(el, 'td-sbox-fold');
  const fire = (t: string, target: any, x: number, y: number, type = 'mouse') => {
    for (const fn of el.listeners[t] || []) fn({ pointerId: 1, pointerType: type, button: 0, clientX: x, clientY: y, target, preventDefault() {}, stopPropagation() {} });
  };
  // the box captures the pointer: what follows the press comes to the box itself
  const drag = (target: any, x0: number, y0: number, x1: number, y1: number) => { fire('pointerdown', target, x0, y0); fire('pointermove', el, x1, y1); fire('pointerup', el, x1, y1); };
  const tap = (target: any, x: number, y: number, type = 'mouse') => { fire('pointerdown', target, x, y, type); fire('pointerup', el, x, y, type); };
  const at = () => [px(el.style.left), px(el.style.top)];
  return { b, el, steps, frame, page, head, fold, fire, drag, tap, at };
}
const said = (sentences: Record<string, string>) => {
  const m = fresh();
  for (const l of m.links) if (sentences[l.id]) l.step = sentences[l.id];
  return m;
};
/** The labels of the stories in the head: their text, and the tooltip and name each carries. */
const labels = (el: any) => d.all(el, 'td-sbox-us').map(text);
const named = (el: any) => d.all(el, 'td-sbox-us').map((x: any) => [x.title, x.getAttribute('aria-label')]);

describe('aidlc-turbo Code Scaffold: the step box shows the step held', () => {
  it('hidden while no step is held, shown when one is, hidden again when it is let go', () => {
    const s = mount();
    expect(s.el.hidden).toBe(true);
    s.steps.pin(ORDER[1]);
    expect(s.el.hidden).toBe(false);
    s.steps.pin(null);
    expect(s.el.hidden).toBe(true);
  });

  it('"Step n", a label per story at the end of the head, the plain sentence, from -> to and the call in code type', () => {
    const m = said({ 'api-ctrl': 'the order status API hands the request to the controller' });
    const s = mount(m);
    s.steps.pin('api-ctrl');
    expect(text(first(s.el, 'td-sbox-n'))).toBe('Step 5');
    expect(labels(s.el)).toEqual(['US 002', 'US 003', 'US 004', 'US 005']);
    expect(d.all(s.el, 'td-badge')).toEqual([]); // no round number beside "Step n"
    // "Step n" first, the labels after it, at the end of the head just before the fold button
    const t = first(s.el, 'td-sbox-t');
    expect(t.children.map((c: any) => c.className)).toEqual(['td-sbox-n', 'td-sbox-st']);
    const head = s.head().children.filter((c: any) => c && c.tag).map((c: any) => String(c.className).split(' ').find((x: string) => x.startsWith('td-sbox-')));
    expect(head).toEqual(['td-sbox-grip', 'td-sbox-name', 'td-sbox-fold']);
    expect(text(first(s.el, 'td-sbox-s'))).toBe('The order status API hands the request to the controller.');
    expect(text(first(s.el, 'td-sbox-r'))).toMatch(/^api-client\.js\s*→\s*OrderStatusController\b/);
    expect(first(s.el, 'td-sbox-c').tag).toBe('code');
    expect(text(first(s.el, 'td-sbox-c'))).toBe('/api/admin/orderstatus');
  });

  it('each story label names its story in its tooltip and its name, by the page\'s title where it has one', () => {
    const m = fresh();
    const s = mount(m, {}, (st: any) => (st.id === '003' ? 'Search the orders of the warehouse' : st.title));
    s.steps.pin('api-ctrl');
    expect(named(s.el)).toEqual([
      ['User story 2: Overview', 'User story 2: Overview'],
      ['User story 3: Search the orders of the warehouse', 'User story 3: Search the orders of the warehouse'],
      ['User story 4: Failed', 'User story 4: Failed'],
      ['User story 5: Admin', 'User story 5: Admin'],
    ]);
  });

  it('a step without a plain sentence says its label; one no story has carries no story labels', () => {
    const m = fresh();
    for (const st of m.stories) st.links = st.links.filter((id: string) => id !== 'api-ctrl');
    const s = mount(m);
    s.steps.pin('api-ctrl');
    expect(text(first(s.el, 'td-sbox-n'))).toBe('Step 5');
    expect(text(first(s.el, 'td-sbox-s'))).toBe('Calls.');
    expect(labels(s.el)).toEqual([]);
  });

  it('follows the walk over the steps; a screen reader hears each step once, in one line', () => {
    const s = mount();
    s.steps.pin(ORDER[0]);
    s.steps.walk(1);
    expect(text(first(s.el, 'td-sbox-n'))).toBe('Step 2');
    const live = d.all(s.el, 'td-sbox-live')[0];
    expect(live.getAttribute('role')).toBe('status');
    expect(text(live)).toMatch(/^Step 2\b/);
    // the parts that fade over are not read out again
    for (const cls of ['td-sbox-name', 'td-sbox-body']) expect(first(s.el, cls).getAttribute('aria-live')).toBeNull();
  });

  /** Elements that animate, as a browser's do: what they were asked, and a way to end them. */
  function animating() {
    const anims: any[] = [];
    const make = d.doc.createElement;
    d.doc.createElement = (t: string) => {
      const e = make(t);
      e.animate = (kf: any[], opt: any) => { const a: any = { e, kf, opt, onfinish: null, cancel() {} }; anims.push(a); return a; };
      return e;
    };
    return anims;
  }
  const kids = (el: any, cls: string) => first(el, cls).children.filter((c: any) => c && c.tag);

  it('another step fades over in the new one\'s size: opacity only, the old one out of reach and gone after', () => {
    const anims = animating();
    const s = mount();
    s.steps.pin(ORDER[0]);
    expect(anims).toEqual([]); // it was hidden: the first step comes at once
    s.steps.walk(1);
    const body = kids(s.el, 'td-sbox-body');
    expect(body.map((c: any) => c.className)).toEqual(['td-sbox-in', 'td-sbox-in td-sbox-gone']);
    const ghost = body[1];
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.inert).toBe(true);
    expect(kids(s.el, 'td-sbox-name').map((c: any) => c.className)).toEqual(['td-sbox-t', 'td-sbox-t td-sbox-gone']);
    for (const a of anims) for (const k of a.kf) expect(Object.keys(k)).toEqual(['opacity']);
    const out = anims.find((a) => a.e === ghost);
    expect(out.kf.map((k: any) => k.opacity)).toEqual([1, 0]);
    expect(out.opt.duration).toBeLessThanOrEqual(160);
    expect(anims.find((a) => a.e === body[0]).kf.map((k: any) => k.opacity)).toEqual([0, 1]);
    out.onfinish();
    expect(kids(s.el, 'td-sbox-body').map((c: any) => c.className)).toEqual(['td-sbox-in']);
  });

  it('steps in a row never stack: the last one wins whole', () => {
    animating();
    const s = mount();
    s.steps.pin(ORDER[0]);
    s.steps.walk(1);
    s.steps.walk(1);
    s.steps.walk(1);
    const body = kids(s.el, 'td-sbox-body');
    expect(body.length).toBe(2);
    expect(text(first(s.el, 'td-sbox-n'))).toBe('Step 4');
  });

  it('at once with reduced motion', () => {
    const anims = animating();
    G.matchMedia = (q: string) => ({ matches: /prefers-reduced-motion: reduce/.test(q) });
    const s = mount();
    s.steps.pin(ORDER[0]);
    s.steps.walk(1);
    expect(anims).toEqual([]);
    expect(kids(s.el, 'td-sbox-body').length).toBe(1);
  });

  it('names its head and its fold button in plain words', () => {
    const s = mount();
    s.steps.pin(ORDER[0]);
    expect(s.head().title).toBe(HEAD);
    expect(s.fold().title).toBe('Fold the step');
    expect(s.fold().getAttribute('aria-label')).toBe('Fold the step');
    expect(s.fold().getAttribute('aria-expanded')).toBe('true');
  });
});

describe('aidlc-turbo Code Scaffold: the step box goes where the viewer puts it', () => {
  it('starts in its place in the drawing\'s frame', () => {
    const s = mount();
    s.steps.pin(ORDER[0]);
    expect(s.el.parent).toBe(s.frame);
    expect(s.el.classList.contains('td-sbox-float')).toBe(false);
    expect(s.el.style.left || '').toBe('');
  });

  it('dragged by its head it floats over the page where it was let go', () => {
    const s = mount();
    s.steps.pin(ORDER[0]);
    s.drag(s.head(), 40, 650, 340, 350);
    expect(s.el.parent).toBe(s.page);
    expect(s.el.classList.contains('td-sbox-float')).toBe(true);
    expect(s.at()).toEqual([24 + 300, 640 - 300]);
  });

  it('stays fully inside the window, 12 px from its edges', () => {
    const s = mount();
    s.steps.pin(ORDER[0]);
    s.drag(s.head(), 40, 650, 3000, 3000);
    expect(s.at()).toEqual([W - BW - 12, H - BH - 12]);
    s.drag(s.head(), W - BW, H - BH, -3000, -3000);
    expect(s.at()).toEqual([12, 12]);
  });

  it('a press that hardly moves stays a click; the body and the fold button never drag it', () => {
    const s = mount();
    s.steps.pin(ORDER[0]);
    s.drag(s.head(), 40, 650, 42, 652);
    expect(s.el.classList.contains('td-sbox-float')).toBe(false);
    s.drag(first(s.el, 'td-sbox-body'), 40, 680, 400, 300);
    s.drag(s.fold(), 300, 650, 600, 300);
    expect(s.el.classList.contains('td-sbox-float')).toBe(false);
    expect(store.has('td-stepbox-at')).toBe(false);
  });

  it('keeps inside the window when it gets smaller', () => {
    const s = mount();
    s.steps.pin(ORDER[0]);
    s.drag(s.head(), 40, 650, 1100, 700);
    Object.assign(d.html, { clientWidth: 800, clientHeight: 600 });
    for (const fn of resized) fn();
    expect(s.at()).toEqual([800 - BW - 12, 600 - BH - 12]);
  });

  it('is remembered: a new page puts it where it was let go', () => {
    const s = mount();
    s.steps.pin(ORDER[0]);
    s.drag(s.head(), 40, 650, 540, 250);
    expect(JSON.parse(store.get('td-stepbox-at')!)).toEqual({ x: 524, y: 240 });
    const again = mount();
    again.steps.pin(ORDER[2]);
    expect(again.el.parent).toBe(again.page);
    expect(again.at()).toEqual([524, 240]);
  });

  it('a double click or two taps on its head put it back in its place and forget where it was', () => {
    const s = mount();
    s.steps.pin(ORDER[0]);
    s.drag(s.head(), 40, 650, 540, 250);
    s.tap(s.head(), 540, 250);
    expect(s.el.classList.contains('td-sbox-float')).toBe(true);
    s.tap(s.head(), 541, 251);
    expect(s.el.parent).toBe(s.frame);
    expect(s.el.classList.contains('td-sbox-float')).toBe(false);
    expect(s.el.style.left || '').toBe('');
    expect(store.has('td-stepbox-at')).toBe(false);
    // a finger the same way, and the browser's own double click
    s.drag(s.head(), 40, 650, 540, 250);
    s.tap(s.head(), 540, 250, 'touch');
    s.tap(s.head(), 540, 250, 'touch');
    expect(s.el.parent).toBe(s.frame);
    s.drag(s.head(), 40, 650, 540, 250);
    for (const fn of s.head().listeners.dblclick || []) fn({ target: s.head(), preventDefault() {}, stopPropagation() {} });
    expect(s.el.parent).toBe(s.frame);
  });

  it('folds to a pill "Step n" and opens again; the choice is remembered', () => {
    const s = mount();
    s.steps.pin(ORDER[3]);
    s.fold().click();
    expect(s.el.classList.contains('td-sbox-folded')).toBe(true);
    expect(text(first(s.el, 'td-sbox-n'))).toBe('Step 4');
    expect(s.fold().title).toBe('Unfold the step');
    expect(s.fold().getAttribute('aria-label')).toBe('Unfold the step');
    expect(s.fold().getAttribute('aria-expanded')).toBe('false');
    expect(store.get('td-stepbox-folded')).toBe('1');
    const again = mount();
    expect(again.el.classList.contains('td-sbox-folded')).toBe(true);
    again.fold().click();
    expect(again.el.classList.contains('td-sbox-folded')).toBe(false);
    expect(store.get('td-stepbox-folded')).toBe('0');
  });

  it('works where the browser keeps nothing', () => {
    G.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    const s = mount();
    s.steps.pin(ORDER[0]);
    expect(s.el.hidden).toBe(false);
    s.drag(s.head(), 40, 650, 540, 250);
    expect(s.at()).toEqual([524, 240]);
    s.fold().click();
    expect(s.el.classList.contains('td-sbox-folded')).toBe(true);
    s.tap(s.head(), 540, 250);
    s.tap(s.head(), 540, 250);
    expect(s.el.parent).toBe(s.frame);
    delete G.localStorage;
    expect(() => mount().steps.pin(ORDER[0])).not.toThrow();
  });

  it('in the preview of a phone it stays a bar in the frame: what was remembered waits, a drag does nothing', () => {
    store.set('td-stepbox-at', JSON.stringify({ x: 500, y: 300 }));
    const s = mount(model, { page: 'td-pv' });
    s.steps.pin(ORDER[0]);
    expect(s.el.parent).toBe(s.frame);
    expect(s.el.classList.contains('td-sbox-float')).toBe(false);
    s.drag(s.head(), 40, 650, 540, 250);
    expect(s.el.parent).toBe(s.frame);
    expect(JSON.parse(store.get('td-stepbox-at')!)).toEqual({ x: 500, y: 300 });
  });
});

describe('aidlc-turbo Code Scaffold: the step box in the drawing\'s full-screen view', () => {
  /** The view the full-screen view puts it in: under its bar of 60 px, the whole window wide. */
  function inView(s: any) {
    const view = d.node('div');
    view.className = 'td-fs-view';
    view.getBoundingClientRect = () => ({ left: 0, top: 60, right: W, bottom: H, width: W, height: H - 60 });
    view.append(s.el);
    s.el.tdPlace();
    return view;
  }

  it('comes along and stays inside the view, where it was put on the page', () => {
    store.set('td-stepbox-at', JSON.stringify({ x: 1300, y: 20 }));
    const s = mount();
    s.steps.pin(ORDER[0]);
    const view = inView(s);
    expect(s.el.parent).toBe(view);
    expect(s.el.classList.contains('td-sbox-float')).toBe(true);
    // left and top in the view: its right edge and its top 12 px inside it
    expect(s.at()).toEqual([W - BW - 12, 12]);
  });

  it('dragged in the view it stays in the view, inside it; put back it waits in the view\'s own place', () => {
    const s = mount();
    s.steps.pin(ORDER[0]);
    const view = inView(s);
    expect(s.el.classList.contains('td-sbox-float')).toBe(false);
    s.drag(s.head(), 40, 650, 40, -500);
    expect(s.el.parent).toBe(view);
    expect(s.at()).toEqual([24, 12]);
    s.tap(s.head(), 50, 80);
    s.tap(s.head(), 50, 80);
    expect(s.el.parent).toBe(view);
    expect(s.el.classList.contains('td-sbox-float')).toBe(false);
  });

  it('the view takes it along and gives it back, and never pans, zooms or lets go under it', () => {
    const view = read('design-view.js');
    expect(view).toMatch(/const moved = \[[^\]]*c\.box[^\]]*\]/);
    expect(view).toMatch(/view\.append\([^;]*c\.box/);
    expect(view).toMatch(/tdPlace/);
    // the pointer, the wheel and a click on it are its own
    expect((view.match(/'\.td-detail, \.td-fdet, \.td-fs-ctl, \.td-ctl, \.td-sbox'/g) || []).length).toBe(2);
    expect(view).toMatch(/closest\('\.td-fs-ctl, \.td-ctl, \.td-sbox'\)/);
    const panel = read('design-panel.js');
    expect(panel).toMatch(/TdView\.create\(\{[^\n]*box: sbox && sbox\.el/);
  });
});

describe('aidlc-turbo Code Scaffold: the panel shows the step in the box, not in the details', () => {
  const box = (p: any) => d.all(p.root, 'td-sbox')[0] || null;

  it('step 1 in the box from the start; the walk moves it on', () => {
    const p = mountPanel(d, model, geo);
    const b = box(p);
    expect(b).not.toBeNull();
    expect(b.parent.classList.contains('td-dzw')).toBe(true);
    expect(b.hidden).toBe(false);
    expect(text(first(b, 'td-sbox-n'))).toBe('Step 1');
    d.key('ArrowRight');
    expect(text(first(b, 'td-sbox-n'))).toBe('Step 2');
  });

  it('the story labels carry the page\'s own titles of the stories', () => {
    expect(read('design-panel.js')).toMatch(/TdStepBox\.create\(\{[^\n]*titleOf: \(s\) => titleOf\(s\)/);
    const p = mountPanel(d, model, geo);
    p.line('api-ctrl');
    expect(d.all(p.box(), 'td-sbox-us')[0].title).toBe('User story 2: Overview');
  });

  it('a line clicked and play show their step in the box; a story without steps hides it', () => {
    const m = dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
    m.stories.push({ ...m.stories[0], id: '009', n: '9', links: [], parts: ['menu'], builds: {} });
    const p = mountPanel(d, m, layout(m));
    p.line(ORDER[2]);
    expect(box(p).hidden).toBe(false);
    expect(text(first(box(p), 'td-sbox-n'))).toBe('Step 3');
    p.api.choose(null);
    for (let i = 0; i < ORDER.length; i += 1) d.key('ArrowRight');
    p.play();
    expect(text(first(box(p), 'td-sbox-n'))).toBe('Step 1');
    p.play();
    p.api.choose('009');
    expect(box(p).hidden).toBe(true);
  });

  it('the details show the part only: no step box at their top', () => {
    const p = mountPanel(d, model, geo);
    expect(first(p.shown(), 'td-dstep')).toBeNull();
    expect(read('design-about.js')).not.toMatch(/td-dstep|function step\(/);
    expect(read('design-show.js')).not.toMatch(/about\.step\(/);
    for (const f of ['design-about.css', 'design-diff.css', 'design-browse.css', 'maquette-draw.css']) expect(plain(f), f).not.toContain('td-dstep');
  });
});
