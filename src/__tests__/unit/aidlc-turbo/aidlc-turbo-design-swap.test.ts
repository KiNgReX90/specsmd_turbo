/**
 * Unit tests for one element's details giving way to the next (design-swap.js)
 * and the panel that swaps them (design-panel.js):
 * - another element chosen: the old details (and their change in the code)
 *   stay frozen where they were, cut to the box, while they fade out; the new
 *   ones fade in under them in their own place; only opacity moves, short and
 *   easing out;
 * - a new choice while one still fades ends it at once and shows the newest
 *   whole: presses in a row never stack, the last choice wins;
 * - without motion (prefers-reduced-motion, no animations), and for the first
 *   details, the swap is instant;
 * - the panel never closes the details between two elements (no empty word,
 *   no full-screen entrance again, no page that shrinks), and the Maquette
 *   no longer lifts the details alone while their code pops in.
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
const G = globalThis as any;

function load(f: string) {
  const file = path.join(DESIGN, f);
  delete req.cache[file];
  return req(file);
}

type R = { top: number; left: number; width: number; height: number };
/** Just enough of an element for the swap: children, a box on screen, inline style, animations it records. */
function el(rect: R = { top: 100, left: 900, width: 460, height: 600 }): any {
  const e: any = { children: [] as any[], parentNode: null, hidden: false, style: {}, attrs: {}, cls: new Set<string>(), anims: [] as any[], rect };
  e.classList = { add: (...c: string[]) => c.forEach((x) => e.cls.add(x)), remove: (...c: string[]) => c.forEach((x) => e.cls.delete(x)), contains: (c: string) => e.cls.has(c) };
  e.setAttribute = (k: string, v: string) => { e.attrs[k] = String(v); };
  e.getAttribute = (k: string) => (k in e.attrs ? e.attrs[k] : null);
  const out = (x: any) => { if (x.parentNode) x.parentNode.children = x.parentNode.children.filter((c: any) => c !== x); x.parentNode = null; };
  e.append = (...xs: any[]) => { for (const x of xs) { out(x); x.parentNode = e; e.children.push(x); } };
  e.insertBefore = (x: any, ref: any) => { out(x); const i = e.children.indexOf(ref); e.children.splice(i < 0 ? e.children.length : i, 0, x); x.parentNode = e; };
  e.replaceChildren = (...xs: any[]) => { for (const c of [...e.children]) out(c); e.append(...xs); };
  e.remove = () => out(e);
  e.getBoundingClientRect = () => { const r = e.rect; return { ...r, right: r.left + r.width, bottom: r.top + r.height }; };
  e.getClientRects = () => (e.hidden ? [] : [{}]);
  e.animate = (kf: any[], o: any) => {
    const a: any = { kf, o, cancelled: false, onfinish: null, cancel() { a.cancelled = true; }, finish() { if (a.onfinish) a.onfinish(); } };
    e.anims.push(a);
    return a;
  };
  return e;
}

let reduce = false;
let S: any;
beforeEach(() => {
  reduce = false;
  G.matchMedia = (q: string) => ({ matches: /prefers-reduced-motion: reduce/.test(q) && reduce });
  S = load('design-swap.js');
});

/** A box that shows the details of a first element (instant), as the panel's first choice does. */
function shown() {
  const box = el({ top: 100, left: 900, width: 460, height: 500 });
  const f0 = el(), b0 = el();
  S.put(box, f0, b0);
  return { box, f0, b0 };
}

describe('aidlc-turbo Code Scaffold: one element\'s details give way to the next', () => {
  it('the first details come at once: nothing to fade from', () => {
    const { box, f0, b0 } = shown();
    expect(box.children).toEqual([f0, b0]);
    expect(b0.anims).toHaveLength(0);
  });

  it('the old details fade out frozen where they were, the new fade in under them in their place, only by opacity', () => {
    const { box, b0 } = shown();
    const f1 = el(), b1 = el();
    expect(S.put(box, f1, b1)).toBe(b1);
    expect(box.children).toEqual([f1, b1, b0]);
    expect(b0.cls.has('td-dgone')).toBe(true);
    expect(b0.attrs['aria-hidden']).toBe('true');
    expect(b0.inert).toBe(true);
    expect(b0.style).toMatchObject({ position: 'fixed', top: '100px', left: '900px', width: '460px', height: '600px', margin: '0px', boxSizing: 'border-box', pointerEvents: 'none' });
    // cut to the box: the part below it stays out of sight
    expect(b0.style.clipPath).toBe('inset(0px 0px 100px 0px)');
    const [out] = b0.anims, [inn] = b1.anims;
    expect(out.kf).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(inn.kf).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    for (const a of [out, inn]) {
      expect(a.o.easing).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
      const end = (a.o.delay || 0) + a.o.duration;
      expect(end).toBeGreaterThanOrEqual(90);
      expect(end).toBeLessThanOrEqual(200);
    }
    expect((inn.o.delay || 0) + inn.o.duration).toBeGreaterThanOrEqual(150);
    expect(inn.o.fill).toBe('backwards');
    // done: the old details go, the new stay as they are
    inn.finish();
    expect(box.children).toEqual([f1, b1]);
    expect(b0.parentNode).toBeNull();
  });

  it('presses in a row never stack: a new choice while one fades ends it at once and shows the newest whole', () => {
    const { box, b0 } = shown();
    const b1 = el(), b2 = el(), f2 = el();
    S.put(box, el(), b1);
    S.put(box, f2, b2);
    expect(box.children).toEqual([f2, b2]);
    expect(b0.parentNode).toBeNull();
    expect(b0.anims[0].cancelled).toBe(true);
    expect(b1.anims[0].cancelled).toBe(true);
    expect(b2.anims).toHaveLength(0);
    // the old run ending late changes nothing
    b1.anims[0].finish();
    expect(box.children).toEqual([f2, b2]);
    // a choice after the calm fades again
    const b3 = el();
    S.put(box, el(), b3);
    expect(b2.cls.has('td-dgone')).toBe(true);
    expect(b3.anims).toHaveLength(1);
  });

  it('instant without motion: the viewer\'s reduced motion, a browser without animations, details not shown', () => {
    reduce = true;
    let { box, b0 } = shown();
    const b1 = el();
    S.put(box, el(), b1);
    expect(b1.anims).toHaveLength(0);
    expect(b0.parentNode).toBeNull();
    reduce = false;
    ({ box, b0 } = shown());
    const b2 = el();
    delete b2.animate;
    S.put(box, el(), b2);
    expect(b0.parentNode).toBeNull();
    ({ box, b0 } = shown());
    box.hidden = true;
    const b3 = el();
    S.put(box, el(), b3);
    expect(b3.anims).toHaveLength(0);
    expect(b0.parentNode).toBeNull();
  });

  it('a parent that moves fixed boxes along (a transform) leaves the frozen details where they were', () => {
    const { box, b0 } = shown();
    const at = b0.rect;
    b0.getBoundingClientRect = () => {
      const r = b0.style.position === 'fixed' ? { ...at, top: at.top + 40, left: at.left + 30 } : at;
      return { ...r, right: r.left + r.width, bottom: r.top + r.height };
    };
    S.put(box, el(), el());
    expect(b0.style.top).toBe('60px');
    expect(b0.style.left).toBe('870px');
  });

  it('is on the page before the panel, small and without a long dash', () => {
    const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
    const js = (f: string) => assets.DESIGN_JS.indexOf(f);
    expect(js('design-swap.js')).toBeGreaterThan(-1);
    expect(js('design-swap.js')).toBeLessThan(js('design-panel.js'));
    for (const f of ['design-swap.js', 'design-panel.js', 'maquette-draw.js']) {
      const src = read(f);
      expect(src.split('\n').length, f).toBeLessThanOrEqual(500);
      expect(src, f).not.toMatch(/\u2014/);
    }
  });
});

describe('aidlc-turbo Code Scaffold: the panel swaps the details, never closing them between two elements', () => {
  it('shows the details by the swap from the start, keeps them open from one block to the next and on the same block', () => {
    const d = fakeDom();
    const model = req(path.join(FLOW, 'scripts/lib/design-model.cjs')).designModel(
      req(path.join(FLOW, 'scripts/render-specs.cjs')).parseYaml(readFileSync(path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml'), 'utf8')));
    const geo = req(path.join(DESIGN, 'design-layout.js')).layout(model);
    const make = d.doc.createElement;
    d.doc.createElement = (t: string) => {
      const e = make(t);
      e.remove = () => { if (e.parent) e.parent.children = e.parent.children.filter((c: any) => c !== e); };
      e.insertBefore = (x: any, ref: any) => { const i = e.children.indexOf(ref); e.children.splice(i < 0 ? e.children.length : i, 0, x); x.parent = e; };
      if (t === 'button') { const i = make('svg'), s = make('span'); Object.defineProperty(e, 'firstChild', { get: () => i }); Object.defineProperty(e, 'lastChild', { get: () => s }); }
      return e;
    };
    G.Element = { [Symbol.hasInstance]: (x: any) => !!(x && x.tag) };
    G.TdKit = load('design-kit.js');
    delete G.localStorage;
    for (const f of ['design-steps.js', 'design-play.js', 'design-detail.js']) load(f);
    G.TdInput = load('design-input.js');
    for (const [k, f] of [['TdBuild', 'design-built.js'], ['TdAbout', 'design-about.js'], ['TdStories', 'design-stories.js'], ['TdShow', 'design-show.js'],
      ['TdLight', 'design-light.js'], ['TdRoom', 'design-room.js'], ['TdNear', 'design-near.js'], ['TdBrowse', 'design-browse.js'], ['TdChosen', 'design-chosen.js']]) G[k] = load(f);
    const real = load('design-pane.js');
    const sets: boolean[] = [];
    G.TdPane = { ...real, create: (det: any, o: any) => {
      let hid = det.hidden;
      Object.defineProperty(det, 'hidden', { get: () => hid, set: (v: boolean) => { hid = v; sets.push(v); } });
      return real.create(det, o);
    } };
    G.TdLayout = { layout: () => geo, SIZE: {} };
    const drawn: any = {};
    G.TdEngine = {
      ...load('design-engine.js'), kindOf: (k: string) => k,
      draw: () => {
        drawn.nodes = model.parts.map((p: any) => ({ p, g: d.node('g'), nb: d.node('text') }));
        drawn.edges = geo.links.map((l: any) => ({ l, g: d.node('g'), lg: d.node('g') }));
        drawn.frames = [];
        drawn.steps = G.TdSteps.create(model, geo, d.node('svg'), drawn.edges, drawn.nodes);
        return drawn;
      },
    };
    G.TdKeys = { legend: () => d.node('div'), asks: () => d.node('div') };
    G.TdView = { touchy: () => false, create: () => ({ isOpen: () => false, open() {}, close() {}, reveal() {}, roomFor() {}, focus() {}, refit() {} }) };
    const puts: any[] = [];
    G.TdSwap = { put: (box: any, fixed: any, body: any) => { puts.push(body); box.replaceChildren(fixed, body); return body; } };
    delete G.TdFilter;
    Object.assign(G, { innerWidth: 1800, innerHeight: 1000, addEventListener() {}, location: { hash: '' } });
    load('design-panel.js');
    const box = d.node('div');
    G.CodeScaffold.mount(box, model, { titles: {}, phase: 'inception' });
    const detail = d.all(box, 'td-detail')[0];
    // the part step 1 goes to shows from the start; then a block clicked
    const b = drawn.nodes.find((n: any) => n.p.id === 'trend');
    expect(detail.hidden).toBe(false);
    expect(puts).toHaveLength(1);
    sets.length = 0;
    b.g.click();
    expect(puts).toHaveLength(2);
    expect(sets).not.toContain(true);
    expect(detail.hidden).toBe(false);
    b.g.click();
    expect(detail.hidden).toBe(false);
    expect(puts).toHaveLength(2);
  });

  it('the Maquette no longer lifts the details alone on a swap; the details and their code fade together', () => {
    const mq = read('maquette-draw.js');
    expect(mq).not.toMatch(/querySelector\('\.td-dgrid'\)[\s\S]{0,120}K\.rise/);
  });
});
