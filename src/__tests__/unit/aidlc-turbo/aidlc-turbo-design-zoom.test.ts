/**
 * Unit tests for the drawing on a desktop page at a readable size (design-room.js, design-zoom.js):
 * - the zoom it opens at: the whole drawing where it fits the free room at a readable size (never larger
 *   than drawn), else readable (READ), never the whole drawing shrunk until nobody can read it;
 * - where the drawing lies for what is to be shown: in the middle of the room aimed at, an axis where it
 *   fits centred, never an empty strip along an edge where it is larger;
 * - the drawing follows the step: the step's two parts and its line in sight, the zoom kept; a step in
 *   sight already moves nothing; too large for the room, the part the step goes to;
 * - the controller on the page: opens readable on the step held, centred where the whole fits, pans along
 *   when the step changes (with a glide), "Fit" shows the whole and back, the buttons, the field and
 *   Ctrl with the wheel zoom (the wheel alone scrolls the page), a drag pans and is never a click; it aims
 *   above the box of the step at the bottom; off, it leaves the drawing as the page and the view size it;
 * - the panel wires it on a desktop page, the full-screen view and the phone stay as they are.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';
import { load } from './aidlc-turbo-design-panel-mount';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const read = (f: string) => { try { return readFileSync(path.join(DESIGN, f), 'utf8'); } catch { return ''; } };
const G = globalThis as any;
const R = () => load('design-room.js');

let d: ReturnType<typeof fakeDom>;
beforeEach(() => { d = fakeDom(); });

/** A drawing of two columns of blocks far apart: START 1 top left, a step to its right, one far down right. */
const GEO = {
  width: 2000, height: 2000,
  flow: { starts: [{ id: 'a' }] },
  blocks: [
    { id: 'a', x: 40, y: 60, w: 236, h: 160 },
    { id: 'b', x: 400, y: 60, w: 236, h: 160 },
    { id: 'c', x: 1700, y: 1700, w: 236, h: 160 },
    { id: 'e', x: 40, y: 1700, w: 236, h: 160 },
    { id: 'd', x: 860, y: 60, w: 236, h: 160 },
  ],
  links: [
    { id: 'ab', from: 'a', to: 'b', points: [[276, 140], [400, 140]], label: { box: { x: 300, y: 120, w: 60, h: 20 } } },
    { id: 'bc', from: 'b', to: 'c', points: [[636, 140], [1800, 140], [1800, 1700]], label: { box: { x: 1000, y: 120, w: 60, h: 20 } } },
    { id: 'ae', from: 'a', to: 'e', points: [[150, 220], [150, 1700]], label: null },
    { id: 'ad', from: 'a', to: 'd', points: [[276, 100], [860, 100]], label: null },
  ],
  tags: [],
};
const FREE = { x0: 0, x1: 800, y0: 64, y1: 564 };

describe('aidlc-turbo Code Scaffold on a desktop page: the zoom it opens at', () => {
  it('a drawing that does not fit at a readable size opens readable, not shrunk to the whole', () => {
    const z = R().zoom(FREE, { w: 1930, h: 1918 });
    expect(z.whole).toBe(false);
    expect(z.s).toBe(R().READ);
    // readable: the smallest text of a block (11 to 12.5 px drawn) stays around 9 to 10 px
    expect(R().READ).toBeGreaterThanOrEqual(0.75);
    expect(R().READ).toBeLessThanOrEqual(0.95);
  });

  it('a drawing that fits whole at a readable size shows whole, never larger than drawn', () => {
    expect(R().zoom(FREE, { w: 900, h: 520 })).toEqual({ s: Math.min(800 / 900, 500 / 520), whole: true });
    expect(R().zoom(FREE, { w: 600, h: 300 })).toEqual({ s: 1, whole: true });
  });
});

describe('aidlc-turbo Code Scaffold on a desktop page: where the drawing lies', () => {
  const vb = { w: 2000, h: 2000 };

  it('the box asked for in the middle of the room, the zoom kept', () => {
    const s = 0.8, box = { x: 900, y: 900, w: 200, h: 200 };
    const p = R().place(FREE, FREE, vb, s, box);
    expect(p.tx + (box.x + box.w / 2) * s).toBeCloseTo(400);
    expect(p.ty + (box.y + box.h / 2) * s).toBeCloseTo(314);
  });

  it('never an empty strip along an edge: near a corner the drawing stops at the edge of the room', () => {
    const p = R().place(FREE, FREE, vb, 0.8, { x: 40, y: 60, w: 236, h: 160 });
    expect(p).toEqual({ tx: 0, ty: 64 });
    const q = R().place(FREE, FREE, vb, 0.8, { x: 1900, y: 1900, w: 100, h: 100 });
    expect(q.tx).toBeCloseTo(800 - 2000 * 0.8);
    expect(q.ty).toBeCloseTo(564 - 2000 * 0.8);
  });

  it('an axis where the drawing fits is centred in the room', () => {
    const p = R().place(FREE, FREE, { w: 600, h: 3000 }, 0.8, { x: 0, y: 1500, w: 100, h: 100 });
    expect(p.tx).toBeCloseTo((800 - 480) / 2);
    const q = R().place(FREE, FREE, { w: 600, h: 300 }, 1, { x: 0, y: 0, w: 10, h: 10 });
    expect(q).toEqual({ tx: 100, ty: 64 + 100 });
  });

  it('a room aimed at (above the box of the step) gets the box in its middle', () => {
    const aim = { x0: 0, x1: 800, y0: 64, y1: 360 };
    const p = R().place(FREE, aim, vb, 0.8, { x: 900, y: 900, w: 200, h: 200 });
    expect(p.ty + 1000 * 0.8).toBeCloseTo(212);
  });

  it('kept inside: a drag never pulls the drawing off its room', () => {
    expect(R().keep(FREE, vb, 0.8, 300, 400)).toEqual({ tx: 0, ty: 64 });
    expect(R().keep(FREE, vb, 0.8, -5000, -5000)).toEqual({ tx: 800 - 1600, ty: 564 - 1600 });
    expect(R().keep(FREE, { w: 600, h: 300 }, 1, 0, 0)).toEqual({ tx: 100, ty: 164 });
  });
});

describe('aidlc-turbo Code Scaffold on a desktop page: the drawing follows the step', () => {
  const vb = { w: 2000, h: 2000 };

  it('a step: its two parts and its line, else the part it goes to', () => {
    const [both, , to] = R().boxes(GEO, { link: 'bc' });
    expect(both.x).toBeLessThanOrEqual(400);
    expect(both.x + both.w).toBeGreaterThanOrEqual(1936);
    expect(both.y + both.h).toBeGreaterThanOrEqual(1860);
    expect(to.x).toBeLessThanOrEqual(1700);
    expect(to.x + to.w).toBeGreaterThanOrEqual(1936);
    expect(to.w).toBeLessThan(400);
    // a part, nothing asked: START 1
    expect(R().boxes(GEO, { part: 'e' })[0].y).toBeLessThanOrEqual(1700);
    expect(R().boxes(GEO, null)[0].x).toBeLessThanOrEqual(40);
  });

  it('a step in sight moves nothing', () => {
    const at = { s: 0.8, tx: 0, ty: 64 };
    expect(R().follow(at, FREE, FREE, vb, R().boxes(GEO, { link: 'ab' }))).toEqual({ tx: 0, ty: 64, moved: false });
  });

  it('a step out of sight: the drawing pans to it, the zoom stays', () => {
    const at = { s: 0.8, tx: 0, ty: 64 };
    const f = R().follow(at, FREE, FREE, vb, R().boxes(GEO, { link: 'bc' }));
    expect(f.moved).toBe(true);
    // the part the step goes to is in sight
    const c = GEO.blocks[2];
    expect(f.tx + c.x * 0.8).toBeGreaterThanOrEqual(0);
    expect(f.tx + (c.x + c.w) * 0.8).toBeLessThanOrEqual(800);
    expect(f.ty + c.y * 0.8).toBeGreaterThanOrEqual(64);
    expect(f.ty + (c.y + c.h) * 0.8).toBeLessThanOrEqual(564);
  });

  it('a step too wide for the room: the part it goes to whole, and as much of its line as the room takes', () => {
    const narrow = { x0: 0, x1: 500, y0: 64, y1: 564 };
    const f = R().show(narrow, null, vb, 0.8, R().boxes(GEO, { link: 'ab' }))!;
    const b = GEO.blocks[1];
    expect(f.tx + b.x * 0.8).toBeGreaterThanOrEqual(0);
    expect(f.tx + (b.x + b.w) * 0.8).toBeLessThanOrEqual(500);
    // leaning towards the part it comes from, more than the part it goes to in the middle would
    expect(f.tx).toBeGreaterThan(250 - (b.x + b.w / 2) * 0.8 + 50);
  });

  it('too tall for the room above the box of the step: beside it, never under it', () => {
    const cover = { l: 12, r: 352, top: 400, bottom: 560 };
    const tall = { x: 900, y: 900, w: 236, h: 400 };
    const p = R().show(FREE, cover, vb, 0.8, [tall])!;
    expect(p.tx + tall.x * 0.8).toBeGreaterThanOrEqual(352);
    expect(p.tx + (tall.x + tall.w) * 0.8).toBeLessThanOrEqual(800);
    expect(p.ty + tall.y * 0.8).toBeGreaterThanOrEqual(64);
    expect(p.ty + (tall.y + tall.h) * 0.8).toBeLessThanOrEqual(564);
    // in sight there already: it stays
    expect(R().follow({ s: 0.8, ...p }, FREE, cover, vb, [tall]).moved).toBe(false);
  });

  it('at the drawing\'s left edge under the box of the step: the drawing moves right of the box, a drag keeps that', () => {
    const cover = { l: 12, r: 352, top: 400, bottom: 560 };
    const edge = { x: 40, y: 900, w: 236, h: 400 };
    const p = R().show(FREE, cover, vb, 0.8, [edge])!;
    expect(p.tx + edge.x * 0.8).toBeGreaterThanOrEqual(352);
    expect(p.tx).toBeLessThanOrEqual(360); // no further than the room right of the box
    // a drag from there: back towards the edge is fine, further out is not
    expect(R().keep(FREE, vb, 0.8, p.tx + 50, p.ty, p).tx).toBe(p.tx);
    expect(R().keep(FREE, vb, 0.8, p.tx - 100, p.ty, p).tx).toBe(p.tx - 100);
    // without where it was, the edge holds as always
    expect(R().keep(FREE, vb, 0.8, p.tx, p.ty).tx).toBe(0);
  });

  it('a step that just fits above the box of the step goes there, its margin cut rather than its parts covered', () => {
    // the two parts side by side, 160 high: 128 at 80 percent; the room above the box 136 high, too low with the margin
    const cover = { l: 12, r: 352, top: 208, bottom: 560 };
    const two = { width: 2000, height: 2000, flow: { starts: [] }, tags: [],
      blocks: [{ id: 'p', x: 40, y: 900, w: 236, h: 160 }, { id: 'q', x: 500, y: 900, w: 236, h: 160 }],
      links: [{ id: 'pq', from: 'p', to: 'q', points: [[276, 980], [500, 980]], label: null }] };
    const p = R().show(FREE, cover, vb, 0.8, R().boxes(two, { link: 'pq' }))!;
    for (const b of two.blocks) {
      expect(p.ty + b.y * 0.8).toBeGreaterThanOrEqual(64);
      expect(p.ty + (b.y + b.h) * 0.8).toBeLessThanOrEqual(208);
      expect(p.tx + b.x * 0.8).toBeGreaterThanOrEqual(0);
      expect(p.tx + (b.x + b.w) * 0.8).toBeLessThanOrEqual(800);
    }
  });

  it('a step too large for any room clear of the box of the step: the part it goes to clear, the other lifted out as far as that allows', () => {
    // a low frame at 1366 x 768: 729 by 491, the box of the step 210 high at the bottom left
    const low = { x0: 0, x1: 729, y0: 64, y1: 461 };
    const cover = { l: 12, r: 352, top: 247, bottom: 457 };
    const two = { width: 2000, height: 2000, flow: { starts: [] }, tags: [],
      blocks: [{ id: 'p', x: 30, y: 300, w: 236, h: 190 }, { id: 'q', x: 480, y: 230, w: 236, h: 176 }],
      links: [{ id: 'pq', from: 'p', to: 'q', points: [[266, 380], [480, 320]], label: null }] };
    const f = R().show(low, cover, vb, 0.8, R().boxes(two, { link: 'pq' }))!;
    const [p, q] = two.blocks;
    expect(f.ty + q.y * 0.8).toBeGreaterThanOrEqual(64);
    expect(f.tx + q.x * 0.8).toBeGreaterThanOrEqual(352);
    const under = Math.max(0, f.ty + (p.y + p.h) * 0.8 - 247) / (p.h * 0.8);
    expect(under).toBeLessThan(0.3);
  });

  it('a part whose edge (its plinth, its tag) is cut off at the edge of the room counts as out of sight', () => {
    const b = GEO.blocks[1];
    const at = { s: 0.8, tx: 798 - (b.x + b.w) * 0.8, ty: 64 };
    expect(R().follow(at, FREE, null, vb, R().boxes(GEO, { part: 'b' })).moved).toBe(true);
  });

  it('the whole drawing in sight: nothing to follow', () => {
    const small = { w: 700, h: 400 };
    const at = { s: 1, ...R().place(FREE, FREE, small, 1, { x: 0, y: 0, w: 0, h: 0 }) };
    expect(R().follow(at, FREE, FREE, small, [{ x: 600, y: 300, w: 80, h: 80 }]).moved).toBe(false);
  });
});

describe('aidlc-turbo Code Scaffold on a desktop page: a step shows both its parts', () => {
  it('a step: its two parts and its line; a part is no step', () => {
    const e = R().ends(GEO, { link: 'ad' });
    expect(e.from.id).toBe('a');
    expect(e.to.id).toBe('d');
    expect(e.points).toEqual([[276, 100], [860, 100]]);
    // with the room around the parts
    expect(e.box.x).toBeLessThan(40);
    expect(e.box.x + e.box.w).toBeGreaterThan(1096);
    expect(R().ends(GEO, { part: 'a' })).toBe(null);
    expect(R().ends(GEO, null)).toBe(null);
  });

  it('the zoom for a step: readable where its two parts fit, else less, down to 65 percent, else readable', () => {
    const { READ, LOW } = R();
    // under 65 percent the names of the parts get too small to read with ease
    expect(LOW).toBeCloseTo(0.65, 3);
    expect(R().fitZoom(FREE, null, R().ends(GEO, { link: 'ab' }).box)).toBe(READ);
    // a wide step: zoomed out until both parts and the room around them fit the width
    const box = R().ends(GEO, { link: 'ad' }).box, s = R().fitZoom(FREE, null, box);
    expect(s).toBeLessThan(READ);
    expect(s).toBeGreaterThanOrEqual(LOW);
    expect(box.w * s).toBeLessThanOrEqual(800);
    expect(box.w * (s + 0.02)).toBeGreaterThan(800 - 16);
    // not even at LOW: readable (the part it goes to whole, the other one found by its marker)
    expect(R().fitZoom(FREE, null, R().ends(GEO, { link: 'bc' }).box)).toBe(READ);
    // never larger than readable, however small the step
    expect(R().fitZoom(FREE, null, { x: 0, y: 0, w: 100, h: 50 })).toBe(READ);
    // the room around the parts counts half: a step whose parts need just a little less than the full room
    // around them (a corner icon, a plinth) still fits at the floor rather than falling back to its marker
    const tight = { x: 0, y: 0, w: 1212, h: 192, pad: 16 };
    expect(784 / tight.w).toBeLessThan(LOW);
    expect(R().fitZoom(FREE, null, tight)).toBe(LOW);
  });

  it('the box of the step counts: the step fits in the room clear of it', () => {
    const box = { x: 0, y: 0, w: 900, h: 390 };
    expect(R().fitZoom(FREE, null, box)).toBe(R().READ);
    // bottom left 360 wide, from 364 down: above it 64..356 is left, too low for 390 at READ
    const s = R().fitZoom(FREE, { l: 0, r: 360, top: 364, bottom: 564 }, box);
    expect(s).toBeLessThan(R().READ);
    expect(390 * s).toBeLessThanOrEqual(356 - 64 - 16);
  });

  it('the zoom buttons count too: the zoom for a step that only fits beside the box of the step, over them', () => {
    const cover = { l: 0, r: 360, top: 364, bottom: 564 }, box = { x: 0, y: 0, w: 400, h: 560 };
    // right of the box of the step, the whole height: readable
    expect(R().fitZoom(FREE, cover, box)).toBe(R().READ);
    // the zoom bottom right: right of the box and over the zoom, 64..512, zoomed out for it
    const s = R().fitZoom(FREE, { ...cover, also: [{ l: 560, r: 800, top: 520, bottom: 564 }] }, box);
    expect(s).toBeLessThan(R().READ);
    expect(560 * s).toBeLessThanOrEqual(512 - 64 - 16);
    expect(560 * (s + 0.02)).toBeGreaterThan(512 - 64 - 16);
  });

  it('where the line of a step leaves the room toward its part out of sight', () => {
    const e = { from: { id: 'f', x: 0, y: 300, w: 236, h: 160 }, to: { id: 't', x: 1500, y: 300, w: 236, h: 160 }, points: [[236, 380], [1500, 380]] };
    const room = { x0: 0, x1: 800, y0: 64, y1: 564 };
    // the part it goes to in sight, the part it comes from far left: on the left edge, at the height of the line
    expect(R().exit(e, 'from', 0.8, -1000, 0, room)).toEqual({ edge: 'l', x: 0, y: 304 });
    // and the other way round: the part it goes to far right
    expect(R().exit(e, 'to', 0.8, 0, 0, room)).toEqual({ edge: 'r', x: 800, y: 304 });
    // nothing of the line in sight: the way from the middle of the room to the part
    const far = R().exit(e, 'from', 0.8, -3000, 0, room);
    expect(far.edge).toBe('l');
    expect(far.x).toBe(0);
  });

  it('the marker sits at that edge inside the room, clear of the box of the step and the zoom', () => {
    const room = { x0: 0, x1: 800, y0: 64, y1: 564 };
    expect(R().spot({ edge: 'l', x: 0, y: 304 }, { w: 140, h: 28 }, room, [])).toEqual({ left: 6, top: 290 });
    expect(R().spot({ edge: 'r', x: 800, y: 304 }, { w: 140, h: 28 }, room, [])).toEqual({ left: 654, top: 290 });
    expect(R().spot({ edge: 't', x: 400, y: 64 }, { w: 140, h: 28 }, room, [])).toEqual({ left: 330, top: 70 });
    // under the box of the step at the bottom left: moved up above it
    expect(R().spot({ edge: 'l', x: 0, y: 500 }, { w: 140, h: 28 }, room, [{ l: 0, r: 360, top: 400, bottom: 564 }])).toEqual({ left: 6, top: 366 });
    // at the bottom edge under the zoom bottom right: just over it, nearer than along the edge past it
    expect(R().spot({ edge: 'b', x: 760, y: 564 }, { w: 140, h: 28 }, room, [{ l: 560, r: 800, top: 520, bottom: 564 }])).toEqual({ left: 654, top: 486 });
    // only over what is in its way, not over a part higher up
    const zoomAndPart = [{ l: 560, r: 800, top: 520, bottom: 564 }, { l: 600, r: 790, top: 100, bottom: 200 }];
    expect(R().spot({ edge: 'b', x: 760, y: 564 }, { w: 140, h: 28 }, room, zoomAndPart)).toEqual({ left: 654, top: 486 });
    // no room along the bottom edge between the box of the step and the zoom: the nearest place clear of both,
    // right of the box of the step and just over the zoom
    const both = [{ l: 0, r: 500, top: 400, bottom: 564 }, { l: 560, r: 800, top: 520, bottom: 564 }];
    expect(R().spot({ edge: 'b', x: 520, y: 564 }, { w: 140, h: 28 }, room, both)).toEqual({ left: 506, top: 486 });
    // a tall box of the step and the part the step goes to over it: never on that part, next to them
    const tall = [{ l: 10, r: 350, top: 180, bottom: 564 }, { l: 290, r: 480, top: 90, bottom: 200 }, { l: 480, r: 800, top: 520, bottom: 564 }];
    const p = R().spot({ edge: 'b', x: 250, y: 564 }, { w: 130, h: 28 }, room, tall);
    for (const o of tall) expect(p.left < o.r && p.left + 130 > o.l && p.top < o.bottom && p.top + 28 > o.top).toBe(false);
    expect(p.top).toBeGreaterThan(300);
  });
});

const NAMES: Record<string, string> = { a: 'Alpha', b: 'Beta', c: 'Gamma', d: 'Delta', e: 'Epsilon' };

/** The drawing's box on the page as the controller reads it: 800 wide, 600 high, the walk 64 over it, the keys 36 under it. */
function mountZoom(o: { vb?: { w: number; h: number }; box?: any; current?: () => any } = {}) {
  G.TdRoom = R();
  load('design-view.js'); // it sets TdView itself
  G.TdKit = load('design-kit.js');
  const vb = o.vb || { w: 2000, h: 2000 };
  const dz = d.node('div');
  Object.assign(dz, { clientWidth: 800, clientHeight: 600, clientLeft: 0, clientTop: 0 });
  dz.getBoundingClientRect = () => ({ left: 100, top: 200, right: 900, bottom: 800, width: 800, height: 600 });
  dz.setPointerCapture = () => {};
  const svg = d.node('svg');
  dz.append(svg);
  G.getComputedStyle = (el: any) => (el === dz ? { paddingTop: '64px', paddingBottom: '36px', paddingLeft: '0px', paddingRight: '0px' } : { position: 'static' });
  const sizes: number[] = [];
  let held = 0;
  const z = G.TdZoom.create({
    dz, geo: GEO, box: o.box || null,
    svgOf: () => svg, vbOf: () => vb,
    size: (_svg: any, _vb: any, s: number) => { sizes.push(s); },
    btn: G.TdKit.btn, hold: () => { held += 1; }, live: () => true, name: (id: string) => NAMES[id] || id,
    current: o.current || (() => ({ link: 'ab' })),
  });
  const at = () => { const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(svg.style.transform || ''); return m ? { tx: +m[1], ty: +m[2] } : null; };
  const fire = (t: string, ev: any) => { for (const fn of dz.listeners[t] || []) fn(ev); return ev; };
  return { z, dz, svg, sizes, at, fire, held: () => held, s: () => sizes[sizes.length - 1] };
}

describe('aidlc-turbo Code Scaffold on a desktop page: the zoom controller', () => {
  beforeEach(() => { G.TdZoom = load('design-zoom.js'); });

  it('opens readable on the step held, the drawing at its top left, the room filled', () => {
    const m = mountZoom();
    m.z.layout();
    expect(m.s()).toBe(G.TdRoom.READ);
    expect(m.at()).toEqual({ tx: 0, ty: 64 });
    expect(m.z.state().whole).toBe(false);
  });

  it('a drawing that fits whole at a readable size: whole and centred, no empty half', () => {
    const m = mountZoom({ vb: { w: 700, h: 400 } });
    m.z.layout();
    expect(m.s()).toBe(1);
    expect(m.at()).toEqual({ tx: 50, ty: 64 + 50 });
    expect(m.z.state().whole).toBe(true);
  });

  it('the step changes: the drawing pans along to it with a glide, the zoom stays', () => {
    const m = mountZoom();
    m.z.layout();
    m.z.reveal({ link: 'bc' });
    const s = m.s(), p = m.at()!;
    expect(s).toBe(G.TdRoom.READ);
    expect(p.tx + 1700 * s).toBeGreaterThanOrEqual(0);
    expect(p.tx + 1936 * s).toBeLessThanOrEqual(800);
    expect(p.ty + 1700 * s).toBeGreaterThanOrEqual(64);
    expect(p.ty + 1860 * s).toBeLessThanOrEqual(564);
    expect(m.dz.classList.contains('td-glide')).toBe(true);
    // back to the first step: in sight again
    m.z.reveal({ link: 'ab' });
    expect(m.at()).toEqual({ tx: 0, ty: 64 });
  });

  it('"Fit" shows the whole drawing; pressed again it goes back to readable on the step', () => {
    const m = mountZoom();
    m.z.layout();
    const fit = d.all(m.z.el, 'td-fitb')[0];
    expect(fit.textContent).toBe('Fit');
    fit.click();
    expect(m.s()).toBeCloseTo(500 / 2000);
    expect(m.z.state().whole).toBe(true);
    expect(fit.getAttribute('aria-pressed')).toBe('true');
    // the whole of a square drawing in a wide room: centred, never a strip at one side only
    expect(m.at()!.tx).toBeCloseTo((800 - 500) / 2);
    fit.click();
    expect(m.s()).toBe(G.TdRoom.READ);
    expect(fit.getAttribute('aria-pressed')).toBe('false');
  });

  it('the buttons step 10 percent and pause playing; the field shows the zoom', () => {
    const m = mountZoom();
    m.z.layout();
    const [out, inn] = d.all(m.z.el, 'td-zb');
    inn.click();
    expect(m.s()).toBeCloseTo(0.9);
    out.click();
    out.click();
    expect(m.s()).toBeCloseTo(0.7);
    expect(m.held()).toBe(3);
    expect(d.all(m.z.el, 'td-pct')[0].value).toBe('70%');
  });

  it('Ctrl with the wheel zooms at the pointer; the wheel alone leaves the page to scroll', () => {
    const m = mountZoom();
    m.z.layout();
    const plain = m.fire('wheel', { deltaY: 100, deltaMode: 0, ctrlKey: false, clientX: 500, clientY: 500, target: m.svg, preventDefault() { this.stopped = true; } });
    expect(plain.stopped).toBeUndefined();
    expect(m.s()).toBe(G.TdRoom.READ);
    const zoom = m.fire('wheel', { deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: 500, clientY: 500, target: m.svg, preventDefault() { this.stopped = true; } });
    expect(zoom.stopped).toBe(true);
    expect(m.s()).toBeGreaterThan(G.TdRoom.READ);
  });

  it('a drag pans the drawing and is never a click on what it started on', () => {
    const m = mountZoom();
    m.z.layout();
    m.z.reveal({ link: 'bc' });
    const was = m.at()!;
    const ev = (x: number, y: number, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, target: m.svg, preventDefault() {}, ...extra });
    m.fire('pointerdown', ev(500, 500));
    m.fire('pointermove', ev(540, 530));
    m.fire('pointerup', ev(540, 530));
    expect(m.at()).toEqual({ tx: was.tx + 40, ty: was.ty + 30 });
    expect(m.held()).toBeGreaterThan(0); // a drag pauses playing, as in the full-screen view
    let stopped = false;
    m.fire('click', { target: m.svg, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; }, preventDefault() {} });
    expect(stopped).toBe(true);
    // a press that hardly moves stays a click
    m.fire('pointerdown', ev(500, 500));
    m.fire('pointermove', ev(502, 501));
    m.fire('pointerup', ev(502, 501));
    stopped = false;
    m.fire('click', { target: m.svg, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; }, preventDefault() {} });
    expect(stopped).toBe(false);
  });

  it('a part under the box of the step (bottom left) comes out above it; a part beside it stays put', () => {
    const box = d.node('div');
    box.getBoundingClientRect = () => ({ left: 112, top: 600, right: 452, bottom: 760, width: 340, height: 160 });
    const m = mountZoom({ box });
    m.z.layout();
    m.z.reveal({ part: 'e' });
    const s = m.s(), p = m.at()!;
    // the part in the room above the box: from under the walk to 8 px over the box (600 - 200 - 8)
    expect(p.ty + 1860 * s).toBeLessThanOrEqual(392);
    expect(p.ty + 1700 * s).toBeGreaterThanOrEqual(64);
    // bottom right, beside the box: the drawing keeps its bottom edge at the bottom of its room
    m.z.reveal({ part: 'c' });
    expect(m.at()!.ty).toBeCloseTo(564 - 2000 * s);
  });

  it('the zoom buttons over the bottom right count too: a part never lies under them', () => {
    const box = d.node('div');
    box.getBoundingClientRect = () => ({ left: 112, top: 600, right: 452, bottom: 760, width: 340, height: 160 });
    const m = mountZoom({ box, vb: { w: 1936, h: 1860 } });
    m.z.el.getBoundingClientRect = () => ({ left: 660, top: 740, right: 900, bottom: 800, width: 240, height: 40 });
    m.z.layout();
    m.z.reveal({ part: 'c' }); // bottom right, in the corner of the drawing
    const s = m.s(), p = m.at()!, c = GEO.blocks[2];
    const l = p.tx + c.x * s, r = p.tx + (c.x + c.w) * s, t = p.ty + c.y * s, e = p.ty + (c.y + c.h) * s;
    expect(r <= 560 || e <= 540 || l >= 800 || t >= 600).toBe(true);
    expect(whole(m, 'c')).toBe(true);
  });

  it('a tall box of the step (a long step in a low frame) counts too: the part comes out beside it', () => {
    const box = d.node('div');
    box.getBoundingClientRect = () => ({ left: 112, top: 300, right: 452, bottom: 760, width: 340, height: 460 });
    const m = mountZoom({ box });
    m.z.layout();
    m.z.reveal({ part: 'e' });
    expect(m.at()!.tx + 40 * m.s()).toBeGreaterThanOrEqual(352);
  });

  it('its box changes size before the viewer moved the drawing: it lies on the step held again; once dragged it stays', () => {
    let held: any = { link: 'ab' };
    const m = mountZoom({ current: () => held });
    m.dz.clientHeight = 300; // the page opens before the stage has its height
    m.z.layout();
    held = { link: 'bc' };
    m.z.reveal(held);
    m.dz.clientHeight = 600;
    m.z.layout();
    const want = G.TdRoom.show(FREE, null, { w: 2000, h: 2000 }, G.TdRoom.READ, G.TdRoom.boxes(GEO, held));
    expect(m.at()!.tx).toBeCloseTo(want.tx, 0);
    expect(m.at()!.ty).toBeCloseTo(want.ty, 0);
    const ev = (x: number, y: number) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, target: m.svg, preventDefault() {} });
    m.fire('pointerdown', ev(500, 500));
    m.fire('pointermove', ev(540, 530));
    m.fire('pointerup', ev(540, 530));
    const was = m.at();
    m.dz.clientHeight = 640;
    m.z.layout();
    expect(m.at()).toEqual(was);
  });

  /** Block `id` at the zoom and place of the drawing now: whole in the free room. */
  const whole = (m: any, id: string) => {
    const b = GEO.blocks.find((x) => x.id === id)!, s = m.s(), p = m.at()!;
    return p.tx + b.x * s >= -0.5 && p.tx + (b.x + b.w) * s <= 800.5 && p.ty + b.y * s >= 63.5 && p.ty + (b.y + b.h) * s <= 564.5;
  };
  const marks = (m: any) => d.all(m.dz, 'td-src').filter((x: any) => !x.hidden);

  it('a step whose two parts fit only zoomed out a little: it opens there, both parts whole, no marker', () => {
    const m = mountZoom({ current: () => ({ link: 'ad' }) });
    m.z.layout();
    expect(m.s()).toBeLessThan(G.TdRoom.READ);
    expect(m.s()).toBeGreaterThanOrEqual(G.TdRoom.LOW);
    expect(whole(m, 'a')).toBe(true);
    expect(whole(m, 'd')).toBe(true);
    expect(marks(m)).toEqual([]);
    expect(m.z.state().s).toBe(m.s());
  });

  it('each step gets its own zoom: back to readable for a step that fits, with a glide from where it was', () => {
    let held: any = { link: 'ad' };
    const m = mountZoom({ current: () => held });
    m.z.layout();
    held = { link: 'ab' };
    m.z.reveal(held);
    expect(m.s()).toBe(G.TdRoom.READ);
    expect(whole(m, 'a') && whole(m, 'b')).toBe(true);
    expect(m.dz.classList.contains('td-glide')).toBe(true);
    // the box of the step clear: the two parts placed out of its way
    held = { link: 'ad' };
    m.z.reveal(held);
    expect(m.s()).toBeLessThan(G.TdRoom.READ);
    expect(whole(m, 'a') && whole(m, 'd')).toBe(true);
  });

  it('zoomed by the viewer: the steps keep that zoom', () => {
    const m = mountZoom();
    m.z.layout();
    d.all(m.z.el, 'td-zb')[1].click(); // +
    m.z.reveal({ link: 'ad' });
    expect(m.s()).toBeCloseTo(0.9);
  });

  it('a step too large even at the floor: the part it goes to whole and readable, a marker at the edge names the part it comes from and goes there', () => {
    const m = mountZoom({ current: () => ({ link: 'bc' }) });
    m.z.layout();
    expect(m.s()).toBe(G.TdRoom.READ);
    expect(whole(m, 'c')).toBe(true);
    expect(whole(m, 'b')).toBe(false);
    const [mk] = marks(m);
    expect(mk.textContent).toContain('Beta');
    expect(mk.textContent).toMatch(/[←→↑↓]/);
    expect(mk.getAttribute('aria-label')).toContain('Beta');
    expect(marks(m)).toHaveLength(1);
    // a click goes there, the zoom kept; then a marker names where the step goes
    const held = m.held();
    mk.click();
    expect(m.s()).toBe(G.TdRoom.READ);
    expect(whole(m, 'b')).toBe(true);
    expect(m.held()).toBeGreaterThan(held);
    const back = marks(m);
    expect(back).toHaveLength(1);
    expect(back[0].textContent).toContain('Gamma');
  });

  it('a part of the step that mostly shows (cut at an edge) needs no marker; one that hardly shows gets one, never on the parts of the step', () => {
    const m = mountZoom();
    m.z.layout();
    const ev = (x: number) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: 500, target: m.svg, preventDefault() {} });
    const drag = (dx: number) => { m.fire('pointerdown', ev(500)); m.fire('pointermove', ev(500 + dx)); m.fire('pointerup', ev(500 + dx)); };
    drag(-60); // Alpha cut at the left edge, most of it in sight
    expect(whole(m, 'a')).toBe(false);
    expect(marks(m)).toEqual([]);
    drag(-140); // a strip of Alpha left
    const [mk] = marks(m);
    expect(mk.textContent).toContain('Alpha');
    const s = m.s(), p = m.at()!, top = parseFloat(mk.style.top), left = parseFloat(mk.style.left);
    const on = (b: any) => left < p.tx + (b.x + b.w) * s && left >= p.tx + b.x * s && top < p.ty + (b.y + b.h) * s && top >= p.ty + b.y * s;
    expect(on(GEO.blocks[0])).toBe(false);
    expect(on(GEO.blocks[1])).toBe(false);
  });

  it('off: the drawing goes back to the page and the full-screen view to size and place', () => {
    const m = mountZoom({ current: () => ({ link: 'bc' }) });
    m.z.layout();
    expect(marks(m)).toHaveLength(1);
    m.z.off();
    expect(m.svg.style.transform).toBe('');
    expect(m.z.isOn()).toBe(false);
    m.z.reveal({ link: 'bc' });
    expect(m.svg.style.transform).toBe('');
    expect(marks(m)).toEqual([]);
  });
});

describe('aidlc-turbo Code Scaffold on a desktop page: wired by the panel', () => {
  it('on a desktop page the drawing pans inside its box; the step walked, played or picked pans it along', () => {
    const panel = read('design-panel.js');
    expect(panel).toMatch(/root\.TdZoom\.create\(/);
    expect(panel).toMatch(/rootEl\.classList\.toggle\('td-pan', pan\);/);
    expect(panel).toMatch(/zoom\.reveal\(\{ link: id \}/);
    // the marker names a part as the drawing does
    expect(panel).toMatch(/TdZoom\.create\(\{[^}]*name: /);
    // the full-screen view takes the drawing as it always did
    expect(panel).toMatch(/zoom\.off\(\);\s*view\.open\(/);
  });

  it('its box clips the drawing, a grab hand where it can be dragged, a glide for the step', () => {
    const css = read('design-zoom.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.td-pan \.td-dzw > \.td-dz \{[^}]*overflow: clip;/);
    expect(css).toMatch(/\.td-pan \.td-dz > svg\.td-svg \{[^}]*position: absolute;/);
    expect(css).toMatch(/\.td-pan \.td-dzw > \.td-dz\.td-grab \{[^}]*cursor: grab;/);
    expect(css).toMatch(/\.td-dz\.td-glide > svg\.td-svg \{[^}]*transition: transform/);
    expect(css).toMatch(/prefers-reduced-motion/);
    // the marker of a part out of sight: only on the desktop page, in the colour of the step's line
    expect(css).toMatch(/\.td-src \{[^}]*display: none;/);
    expect(css).toMatch(/\.td-pan \.td-dz > \.td-src:not\(\[hidden\]\) \{[^}]*position: absolute;[^}]*var\(--td-hot\)/);
  });

  it('is inlined after the room and before the panel, its style after the steps', () => {
    const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
    const js = assets.DESIGN_JS;
    expect(js.indexOf('design-zoom.js')).toBeGreaterThan(js.indexOf('design-room.js'));
    expect(js.indexOf('design-zoom.js')).toBeLessThan(js.indexOf('design-panel.js'));
    expect(assets.DESIGN_CSS.indexOf('design-zoom.css')).toBeGreaterThan(assets.DESIGN_CSS.indexOf('design-steps.css'));
  });

  it('every file it touches stays under 500 lines', () => {
    for (const f of ['design-zoom.js', 'design-room.js', 'design-panel.js', 'design-input.js', 'design-zoom.css']) {
      const n = read(f).split('\n').length;
      expect(n, f).toBeGreaterThan(1);
      expect(n, f).toBeLessThan(500);
    }
  });
});
