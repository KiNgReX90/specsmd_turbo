/**
 * Unit tests for templates/design/design-layout.js, the pure layout behind
 * the Code Scaffold drawing: the model from lib/design-model.cjs turned
 * into geometry (bands, blocks with their module tag, link paths with their
 * label boxes). The fixture is the order status intent of Acme Shop, an
 * invented webshop. What the drawing promises:
 * - flow first: a band per start, the start in the first column of its band
 *   (the best trigger first), the parts by call depth from left to right;
 * - every part once as a block of the sketch's width, its body a line taller
 *   for each of its name and its summary that needs two lines, a band for an
 *   open choice or a right, its module (or its lane) as a tag inside it, at the bottom of
 *   its body, with room for the story number beside it; no module frames;
 * - no two blocks overlap, no tag sits over another block or tag, every block
 *   sits inside its band, and a later start tucked under the columns it uses
 *   sits at the bottom, with no empty room under it; the drawing holds every
 *   band, also one that went below the first before a later one tucked in;
 * - every link is orthogonal, starts and ends on its own blocks, keeps room
 *   for its arrow head and never runs through another block;
 * - a numbered or named link gets a label: a plate with its own text, or a
 *   badge with only its step number (a quiet lookup never shows text); no
 *   label sits over a block or over another label, or on an arrow head, and
 *   a plate keeps other lines farther off than its own; two stacked parts
 *   joined by a numbered call keep room between them for the number;
 * - the same model gives the same drawing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const { layout, flowOf, quietOf, SIZE } = req(path.join(FLOW, 'templates/design/design-layout.js'));
const place = req(path.join(FLOW, 'templates/design/design-place.js'));

const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const model = dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
const geo = layout(model);

type Rect = { x: number; y: number; w: number; h: number };
type Pt = [number, number];

/** Two rectangles share some area (touching edges do not count). */
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
/** An orthogonal segment runs through the inside of a rectangle. */
function crosses([x1, y1]: Pt, [x2, y2]: Pt, r: Rect) {
  const [lx, hx] = [Math.min(x1, x2), Math.max(x1, x2)];
  const [ly, hy] = [Math.min(y1, y2), Math.max(y1, y2)];
  return lx < r.x + r.w && hx > r.x && ly < r.y + r.h && hy > r.y;
}
const onBorder = ([x, y]: Pt, r: Rect) => {
  const inX = x >= r.x && x <= r.x + r.w;
  const inY = y >= r.y && y <= r.y + r.h;
  return (inX && (y === r.y || y === r.y + r.h)) || (inY && (x === r.x || x === r.x + r.w));
};
const block = (id: string) => geo.blocks.find((b: { id: string }) => b.id === id);

const tag = (id: string) => geo.tags.find((t: { part: string }) => t.part === id);
const bandOf = (b: { band: number }) => geo.lanes.find((l: { id: string }) => l.id === `band-${b.band}`);

describe('design layout: bands, blocks and tags', () => {
  it('draws a band per start, the first one spanning the drawing, and every block inside its own band', () => {
    // two starts and a contract no start reaches: three bands
    const groups = [...new Set(geo.blocks.map((b: { band: number }) => b.band))].sort((a: any, b: any) => a - b);
    expect(groups).toEqual([0, 1, 2]);
    expect(geo.lanes.map((l: { id: string }) => l.id)).toEqual(['band-0', 'band-1', 'band-2']);
    expect(geo.lanes[0]).toMatchObject({ x: 0, y: 0, w: geo.width, h: geo.height });
    for (const lane of geo.lanes) expect(inside(lane, { x: 0, y: 0, w: geo.width, h: geo.height }), lane.id).toBe(true);
    for (const b of geo.blocks) expect(inside(b, bandOf(b)), `${b.id} in band ${b.band}`).toBe(true);
    // the parts of one start share its band
    for (const id of ['host', 'page', 'api', 'ctrl', 'uc', 'gw', 'whread']) expect(block(id).band).toBe(block('menu').band);
    expect(block('routes').band).not.toBe(block('menu').band);
  });

  it('starts the flow at the left: the best trigger first, in the first column, every start first in its band', () => {
    expect(geo.flow.starts.map((s: any) => [s.id, s.trigger, s.n])).toEqual([['menu', 'screen', 1], ['routes', 'starts here', 2]]);
    expect(geo.flow.visit[0]).toBe('menu');
    expect(block('menu').col).toBe(0);
    expect(block('menu').x).toBe(Math.min(...geo.blocks.map((b: Rect) => b.x)));
    for (const s of geo.flow.starts) {
      const b = block(s.id);
      expect(b.start, s.id).toEqual(s);
      const band = geo.blocks.filter((x: { band: number }) => x.band === b.band);
      expect(Math.min(...band.map((x: { col: number }) => x.col)), s.id).toBe(b.col);
      // the start marker on top of the block
      expect(b.h).toBe(b.body + SIZE.START + SIZE.BAND * b.bands.length);
    }
    expect(geo.blocks.filter((b: { start: unknown }) => b.start).map((b: { id: string }) => b.id).sort()).toEqual(['menu', 'routes']);
  });

  it('reads from left to right: the parts by call depth, no call in a band pointing back', () => {
    // menu opens host, host loads page, page asks svc, ... one column further each time
    const chain = ['menu', 'host', 'page', 'svc', 'api', 'ctrl', 'uc', 'gw'].map((id) => block(id).col);
    expect(chain).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const l of geo.links) {
      if (l.kind === 'builds_on') continue;
      const [a, b] = [block(l.from), block(l.to)];
      if (a.band === b.band) expect(b.col, l.id).toBeGreaterThanOrEqual(a.col);
    }
  });

  it('draws every part once, as a block of the sketch size in the lane of its layer', () => {
    expect(geo.blocks.map((b: { id: string }) => b.id).sort()).toEqual(model.parts.map((p: { id: string }) => p.id).sort());
    for (const b of geo.blocks) {
      const part = model.parts.find((p: { id: string }) => p.id === b.id);
      expect(b.lane).toBe(part.layer);
      expect(b.w).toBe(SIZE.BW);
    }
  });

  it('gives a block a band for an open choice or a right, and nothing else', () => {
    expect(block('chart').bands).toEqual(['open']);
    expect(block('menu').bands).toEqual(['right']);
    expect(block('ctrl').bands).toEqual(['right']);
    expect(block('page').bands).toEqual([]);
    expect(block('chart').h).toBe(block('chart').body + SIZE.BAND);
    expect(block('page').h).toBe(block('page').body);
    for (const b of geo.blocks) expect([SIZE.NH, SIZE.NH + SIZE.LINE2, SIZE.NH + 2 * SIZE.LINE2], b.id).toContain(b.body);
  });

  it('gives a block a line more for a name, and one for a summary, that needs two lines', () => {
    const p = (id: string, name: string, sub: string) => ({ id, name, sub: sub, layer: 'server', status: 'new', kind: 'class', module: null, right: null, open: null, confidence: { level: 'green', reasons: [] }, stories: [] });
    const two = {
      summary: null, lanes: [{ id: 'server', name: 'Server' }], modules: [], frames: [], stories: [],
      parts: [p('a', 'Job', 'start'), p('b', 'LedgerAccountShipmentProcessorFactoryImpl', 'sets a shipment that hangs too long to failed, per application'),
        p('c', 'LedgerAccountShipmentProcessorFactoryImpl', 'short'), p('d', 'Short', 'sets a shipment that hangs too long to failed, per application')],
      links: [{ id: 'a-b', from: 'a', to: 'b', kind: 'calls', label: 'calls', code: null }, { id: 'a-c', from: 'a', to: 'c', kind: 'calls', label: 'calls', code: null },
        { id: 'a-d', from: 'a', to: 'd', kind: 'calls', label: 'calls', code: null }],
    };
    const g = layout(two);
    const body = (id: string) => g.blocks.find((b: { id: string }) => b.id === id).body;
    expect([body('a'), body('b'), body('c'), body('d')]).toEqual([SIZE.NH, SIZE.NH + 2 * SIZE.LINE2, SIZE.NH + SIZE.LINE2, SIZE.NH + SIZE.LINE2]);
    expect(g.blocks.find((b: { id: string }) => b.id === 'b').h).toBe(SIZE.NH + 2 * SIZE.LINE2);
  });

  it('keeps blocks at least a column gap apart, so no two blocks overlap', () => {
    for (const a of geo.blocks) {
      for (const b of geo.blocks) {
        if (a === b) continue;
        expect(overlaps(a, b), `${a.id} and ${b.id}`).toBe(false);
      }
    }
  });

  it('gives a block a second row for its labels when they do not fit on one row beside the status icon', () => {
    const p = (id: string, kind: string, extra: object) => ({ id, name: id.toUpperCase(), sub: 'short', layer: 'server', status: 'new', kind, module: null, right: null, open: null, confidence: { level: 'green', reasons: [] }, stories: [], ...extra });
    const other = { build: { state: 'different' } };
    const rows = {
      summary: null, lanes: [{ id: 'server', name: 'Server' }], modules: [], frames: [], stories: [],
      parts: [p('a', 'job', {}), p('b', 'class', { deviates: 'otherwise' }), p('c', 'class', other), p('d', 'abstract class', { deviates: 'otherwise', ...other }), p('e', 'web component', other),
        p('f', 'abstract class', { build: { state: 'added' } })],
      links: ['b', 'c', 'd', 'e', 'f'].map((to) => ({ id: `a-${to}`, from: 'a', to, kind: 'calls', label: 'calls', code: null })),
    };
    const g = layout(rows);
    const body = (id: string) => g.blocks.find((b: { id: string }) => b.id === id).body;
    // a short kind label with "differs" or "different" fits on one row; a build state that does not fit goes to a
    // second row, clear of a story number
    expect([body('a'), body('b'), body('c'), body('d'), body('e'), body('f')])
      .toEqual([SIZE.NH, SIZE.NH, SIZE.NH, SIZE.NH + SIZE.PILL2, SIZE.NH + SIZE.PILL2, SIZE.NH + SIZE.PILL2]);
  });

  it('shows the module of a part as a tag inside it, a part without a module its lane, and draws no frames', () => {
    expect(geo.frames).toEqual([]);
    expect(geo.tags.map((t: { part: string }) => t.part).sort()).toEqual(geo.blocks.map((b: { id: string }) => b.id).sort());
    for (const p of model.parts) {
      const t = tag(p.id);
      const b = block(p.id);
      // at the bottom of the body, above the bands, clear of the confidence bar and the border
      const body = b.y + b.top + b.body;
      expect(t.y + t.h, p.id).toBe(body - SIZE.TAG_PAD);
      expect(t.h, p.id).toBe(SIZE.TAG_H);
      expect(t.x, p.id).toBe(b.x + SIZE.ZB + 14);
      // the story number of the module goes right of the tag, inside the part
      expect(t.x + t.w + SIZE.TAG_NB, `${p.id} tag and its number within the part`).toBeLessThanOrEqual(b.x + b.w - 14);
      if (p.module) {
        expect(t, p.id).toMatchObject({ module: p.module, lane: false, name: model.modules.find((m: { id: string }) => m.id === p.module).name });
      } else {
        expect(t, p.id).toMatchObject({ module: null, lane: true, name: model.lanes.find((l: { id: string }) => l.id === p.layer).name });
      }
    }
    // the two tables have no module
    expect(geo.tags.filter((t: { lane: boolean }) => t.lane).map((t: { part: string }) => t.part).sort()).toEqual(['events', 'orders']);
  });

  it('keeps every tag clear of the other blocks and of the other tags', () => {
    for (const t of geo.tags) {
      for (const b of geo.blocks) if (b.id !== t.part) expect(overlaps(t, b), `tag of ${t.part} over ${b.id}`).toBe(false);
      for (const u of geo.tags) if (u !== t) expect(overlaps(t, u), `tag of ${t.part} over tag of ${u.part}`).toBe(false);
    }
  });

  it('puts a later start tucked under the columns it uses at the bottom, with no empty room under it', () => {
    const first = geo.lanes[0];
    const tucked = geo.lanes.filter((l: Rect) => l !== first && l.w < first.w);
    expect(tucked.length).toBeGreaterThan(0);
    for (const l of tucked) {
      const below = geo.lanes.filter((o: Rect) => o !== first && o !== l && o.y >= l.y + l.h && o.x < l.x + l.w && l.x < o.x + o.w).map((o: Rect) => o.y);
      const floor = Math.min(first.y + first.h - SIZE.FOOT, ...below);
      expect(floor - (l.y + l.h), l.id).toBeLessThanOrEqual(SIZE.BAND_GAP);
    }
  });
});

describe('design layout: links', () => {
  it('routes every link, orthogonal, starting and ending on its own blocks', () => {
    expect(geo.links.map((l: { id: string }) => l.id)).toEqual(model.links.map((l: { id: string }) => l.id));
    for (const link of geo.links) {
      const pts: Pt[] = link.points;
      expect(pts.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < pts.length; i += 1) {
        const [a, b] = [pts[i - 1], pts[i]];
        expect(a[0] === b[0] || a[1] === b[1], `${link.id} segment ${i} is orthogonal`).toBe(true);
      }
      expect(onBorder(pts[0], block(link.from)), `${link.id} starts on ${link.from}`).toBe(true);
      expect(onBorder(pts[pts.length - 1], block(link.to)), `${link.id} ends on ${link.to}`).toBe(true);
    }
  });

  it('leaves room for the arrow head: the last segment is at least 12 long', () => {
    for (const link of geo.links) {
      const [a, b] = link.points.slice(-2);
      expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), link.id).toBeGreaterThanOrEqual(12);
    }
  });

  it('never runs a link through a block other than its own ends', () => {
    for (const link of geo.links) {
      const pts: Pt[] = link.points;
      for (const b of geo.blocks) {
        if (b.id === link.from || b.id === link.to) continue;
        for (let i = 1; i < pts.length; i += 1) {
          expect(crosses(pts[i - 1], pts[i], b), `${link.id} through ${b.id}`).toBe(false);
        }
      }
    }
  });

  it('never runs a link back through its own blocks', () => {
    for (const link of geo.links) {
      const pts: Pt[] = link.points;
      for (let i = 2; i < pts.length - 1; i += 1) {
        for (const id of [link.from, link.to]) {
          expect(crosses(pts[i - 1], pts[i], block(id)), `${link.id} back through ${id}`).toBe(false);
        }
      }
    }
  });

  it('labels every numbered or named link: a plate with its own text, else a badge with its step number', () => {
    for (const link of geo.links) {
      const m = model.links.find((l: { id: string }) => l.id === link.id);
      expect(link.step, link.id).toBe(geo.flow.steps.get(link.id) || null);
      if (!m.label && !link.step) {
        expect(link.label, link.id).toBeNull();
        continue;
      }
      expect(link.label, link.id).not.toBeNull();
      expect(link.label.n, link.id).toBe(link.step);
      if (link.label.kind === 'plate') expect(link.label.lines.join(' '), link.id).toBe(m.label);
      else expect([link.label.kind, link.label.lines], link.id).toEqual(['badge', []]);
    }
    const plates = geo.links.filter((l: any) => l.label && l.label.kind === 'plate').map((l: { id: string }) => l.id);
    expect(plates).toEqual(expect.arrayContaining(['page-svc', 'api-ctrl', 'gw-iface']));
    // a link without a text and outside the flow (prov builds on iface) has no label
    expect(geo.links.find((l: { id: string }) => l.id === 'prov-iface').label).toBeNull();
  });

  it('draws a lookup quiet: thin, only its number, never its text', () => {
    const quiet = geo.links.filter((l: { quiet: boolean }) => l.quiet);
    expect(quiet.map((l: { id: string }) => l.id).sort()).toEqual(['gw-whread', 'trend-events', 'trend-orders']);
    for (const l of quiet) expect([l.label.kind, l.label.lines, l.label.n], l.id).toEqual(['badge', [], l.step]);
  });

  it('never puts a label on an arrow head, or closer than 4 to a block', () => {
    const heads = geo.links.map((l: { id: string; points: Pt[] }) => {
      const [a, b] = l.points.slice(-2);
      const d = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
      const c = [b[0] - d[0] * 14, b[1] - d[1] * 14];
      return { id: l.id, box: { x: Math.min(c[0], b[0]) - 7 * Math.abs(d[1]), y: Math.min(c[1], b[1]) - 7 * Math.abs(d[0]), w: Math.abs(b[0] - c[0]) + 14 * Math.abs(d[1]), h: Math.abs(b[1] - c[1]) + 14 * Math.abs(d[0]) } };
    });
    for (const l of geo.links.filter((x: { label: unknown }) => x.label)) {
      const box = l.label.box;
      for (const h of heads) expect(overlaps(box, h.box), `label ${l.id} on the head of ${h.id}`).toBe(false);
      for (const b of geo.blocks) expect(overlaps(box, { x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }), `label ${l.id} near ${b.id}`).toBe(false);
    }
  });

  it('keeps other lines farther from a plate than its own', () => {
    for (const l of geo.links.filter((x: { label: any }) => x.label && x.label.kind === 'plate')) {
      const b = l.label.box;
      const near = { x: b.x - 6, y: b.y - 6, w: b.w + 12, h: b.h + 12 };
      for (const o of geo.links) {
        if (o.id === l.id) continue;
        for (let i = 1; i < o.points.length; i += 1) expect(crosses(o.points[i - 1], o.points[i], near), `${o.id} near the plate of ${l.id}`).toBe(false);
      }
    }
  });

  it('never puts a label over a block or over another label', () => {
    const boxes = geo.links.filter((l: { label: unknown }) => l.label).map((l: { id: string; label: { box: Rect } }) => ({ id: l.id, box: l.label.box }));
    for (const { id, box } of boxes) {
      for (const b of geo.blocks) expect(overlaps(box, b), `label ${id} over ${b.id}`).toBe(false);
      for (const other of boxes) {
        if (other.id !== id) expect(overlaps(box, other.box), `label ${id} over label ${other.id}`).toBe(false);
      }
      expect(inside(box, { x: 0, y: 0, w: geo.width, h: geo.height }), `label ${id} inside the drawing`).toBe(true);
    }
  });
});

describe('design layout: any model', () => {
  it('gives the same drawing for the same model', () => {
    const again = layout(JSON.parse(JSON.stringify(model)));
    expect(JSON.stringify(again)).toBe(JSON.stringify(geo));
    // the step numbers live in a Map, which JSON leaves out
    expect([...again.flow.steps]).toEqual([...geo.flow.steps]);
  });

  it('draws a single part without links, and skips a link to an unknown part', () => {
    const one = {
      summary: null,
      lanes: [{ id: 'server', name: 'Server' }],
      modules: [],
      frames: [],
      parts: [{ id: 'a', name: 'A', layer: 'server', status: 'new', kind: 'class', module: null, right: null, open: null, confidence: { level: 'green', reasons: [] }, stories: [] }],
      links: [{ id: 'a-x', from: 'a', to: 'x', kind: 'calls', label: 'calls', code: null }],
      stories: [],
    };
    const g = layout(one);
    expect(g.blocks).toHaveLength(1);
    expect(g.links).toEqual([]);
    expect(inside(g.blocks[0], g.lanes[0])).toBe(true);
    expect(g.width).toBeGreaterThan(SIZE.BW);
  });
});

describe('design layout: a later band below the first', () => {
  const part = (id: string, kind: string) => ({
    id, name: id.toUpperCase(), layer: 'server', status: 'new', kind, module: null, right: null, open: null,
    confidence: { level: 'green', reasons: [] }, stories: [],
  });
  const link = (from: string, to: string) => ({ id: `${from}-${to}`, from, to, kind: 'calls', label: 'calls', code: null });
  // a job calling four parts; a migration with four parts of its own, too tall to tuck in; a part no start reaches, that does
  const three = {
    summary: null, lanes: [{ id: 'server', name: 'Server' }], modules: [], frames: [], stories: [],
    parts: [part('job', 'job'), ...['a', 'b', 'c', 'd', 'z'].map((id) => part(id, 'class')), part('fix', 'migration'),
      ...['g1', 'g2', 'g3', 'g4', 'x'].map((id) => part(id, 'class'))],
    links: [...['a', 'b', 'c', 'd'].map((id) => link('job', id)), link('a', 'z'), link('fix', 'z'), ...['g1', 'g2', 'g3', 'g4'].map((id) => link('fix', id))],
  };

  it('holds every band and every block, also when a band tucks in after one went below', () => {
    const flow = flowOf(three);
    const ids = three.parts.map((p) => p.id);
    const quiet = quietOf(three, three.links, flow);
    const variants = [() => 3, () => 4, () => Infinity].flatMap((cap) => [1, 0].map((across) => place.arrange(three, flow, ids, three.links, quiet, { cap, hard: true, across }, SIZE)));
    for (const g of [layout(three), ...variants]) {
      const all = { x: 0, y: 0, w: g.width, h: g.height };
      for (const l of g.lanes) expect(inside(l, all), `${l.id} at ${l.y}-${l.y + l.h} in ${g.height}`).toBe(true);
      for (const b of g.blocks) expect(inside(b, all), b.id).toBe(true);
      // a band below the first spans the drawing and never runs into the first
      const first = g.lanes[0];
      for (const l of g.lanes.slice(1).filter((o: Rect) => o.w === first.w)) expect(l.y, l.id).toBeGreaterThanOrEqual(first.y + first.h);
    }
  });
});

describe('design layout: the flow of a small model', () => {
  const part = (id: string, layer: string, kind: string) => ({
    id, name: id.toUpperCase(), layer, status: 'new', kind, module: null, right: null, open: null,
    confidence: { level: 'green', reasons: [] }, stories: [],
  });
  const link = (from: string, to: string, label: string) => ({ id: `${from}-${to}`, from, to, kind: 'calls', label: label, code: null });
  const small = {
    summary: null,
    lanes: [{ id: 'screen', name: 'Screen' }, { id: 'server', name: 'Server' }, { id: 'database', name: 'Database' }],
    modules: [],
    frames: [],
    // the screen comes first in the model, the job first in the flow
    parts: [part('scr', 'screen', 'JSP'), part('svc', 'server', 'class'), part('job', 'server', 'job'), part('rep', 'server', 'class'), part('tab', 'database', 'table')],
    links: [link('scr', 'svc', 'calls'), link('svc', 'tab', 'writes'), link('job', 'rep', 'start'), link('rep', 'tab', 'reads rows')],
    stories: [],
  };

  it('starts at a part nothing calls, a scheduled task before a screen, and numbers the steps from there', () => {
    const flow = flowOf(small);
    expect(flow.starts.map((s: any) => [s.id, s.trigger, s.first, s.n])).toEqual([['job', 'scheduled job', 1, 1], ['scr', 'screen', 3, 2]]);
    expect([...flow.steps]).toEqual([['job-rep', 1], ['rep-tab', 2], ['scr-svc', 3], ['svc-tab', 4]]);
    expect(flow.visit).toEqual(['job', 'rep', 'tab', 'scr', 'svc']);
  });

  it('draws a call quiet when its target is read by more than one part, never a start\'s own call', () => {
    const flow = flowOf(small);
    expect([...quietOf(small, small.links, flow)].sort()).toEqual(['rep-tab', 'svc-tab']);
    // one reader of a plain class and no reading word: bold
    const one = { ...small, links: [link('scr', 'svc', 'calls'), link('svc', 'rep', 'calls')], parts: small.parts.slice(0, 4) };
    expect([...quietOf(one, one.links, flowOf(one))]).toEqual([]);
    // a reading word makes it quiet
    const read = { ...one, links: [link('scr', 'svc', 'calls'), link('svc', 'rep', 'reads the state')] };
    expect([...quietOf(read, read.links, flowOf(read))]).toEqual(['svc-rep']);
  });

  it('places the first start in the first column, the later one first in a band of its own, the calls to the right', () => {
    const g = layout(small);
    const b = (id: string) => g.blocks.find((x: { id: string }) => x.id === id);
    expect(b('job').col).toBe(0);
    expect(b('job').x).toBe(Math.min(...g.blocks.map((x: Rect) => x.x)));
    expect([b('job').band, b('rep').band, b('tab').band]).toEqual([0, 0, 0]);
    expect([b('scr').band, b('svc').band]).toEqual([1, 1]);
    expect(b('scr').col).toBe(Math.min(b('scr').col, b('svc').col));
    expect(b('rep').col).toBeGreaterThan(b('job').col);
    expect(b('tab').col).toBeGreaterThan(b('rep').col);
    expect(b('svc').col).toBeGreaterThan(b('scr').col);
    expect(g.lanes.map((l: { id: string }) => l.id)).toEqual(['band-0', 'band-1']);
    for (const x of g.blocks) expect(inside(x, g.lanes[x.band]), x.id).toBe(true);
    for (const x of g.blocks) for (const y of g.blocks) if (x !== y) expect(overlaps(x, y), `${x.id} and ${y.id}`).toBe(false);
    for (const l of g.links) {
      for (let i = 1; i < l.points.length; i += 1) {
        const [p, q] = [l.points[i - 1], l.points[i]];
        expect(p[0] === q[0] || p[1] === q[1], `${l.id} segment ${i}`).toBe(true);
      }
    }
    expect(JSON.stringify(layout(small))).toBe(JSON.stringify(g));
  });

  it('keeps room for the step number between a reader and the lookup stacked under it', () => {
    // a column of four tables is too full: one joins the part that reads it, under it
    const stack = {
      ...small,
      parts: [part('job', 'server', 'job'), part('rep', 'server', 'class'), ...['t1', 't2', 't3', 't4'].map((id) => part(id, 'server', 'table'))],
      links: [link('job', 'rep', 'start'), ...['t1', 't2', 't3', 't4'].map((id) => link('rep', id, 'reads rows'))],
    };
    const flow = flowOf(stack);
    const ids = stack.parts.map((p: { id: string }) => p.id);
    const g = place.arrange(stack, flow, ids, stack.links, quietOf(stack, stack.links, flow), { cap: () => 3, hard: true, across: 1 }, SIZE);
    const b = (id: string) => g.blocks.find((x: { id: string }) => x.id === id);
    const under = ['t1', 't2', 't3', 't4'].filter((id) => b(id).col === b('rep').col);
    expect(under.length).toBeGreaterThan(0);
    for (const id of under) {
      const [hi, lo] = [b('rep'), b(id)].sort((x, y) => x.y - y.y);
      expect(lo.y - (hi.y + hi.h), id).toBeGreaterThanOrEqual(SIZE.STACK_NUM);
    }
    // and the whole drawing puts that number clear of both parts and of its arrow head
    const whole = layout(stack);
    for (const l of whole.links) {
      const [p, q] = l.points.slice(-2);
      if (p[0] !== q[0]) continue;
      // a vertical head: the last 14 units, 7 to each side
      const d = Math.sign(q[1] - p[1]);
      const head = { x: q[0] - 7, y: d > 0 ? q[1] - 14 : q[1], w: 14, h: 14 };
      for (const o of whole.links) if (o.label) expect(overlaps(o.label.box, head), `label ${o.id} on the head of ${l.id}`).toBe(false);
    }
    for (const o of whole.links) {
      if (!o.label) continue;
      for (const x of whole.blocks) expect(overlaps(o.label.box, { x: x.x - 4, y: x.y - 4, w: x.w + 8, h: x.h + 8 }), `label ${o.id} near ${x.id}`).toBe(false);
    }
  });
});

describe('design layout: the rhythm inside a block', () => {
  it('gives a part room to breathe: 14 / label / 10 / name / 9 / summary / 10 / tag / 12', () => {
    expect({ NH: SIZE.NH, LINE2: SIZE.LINE2, TAG_PAD: SIZE.TAG_PAD, PILL2: SIZE.PILL2 }).toEqual({ NH: 128, LINE2: 20, TAG_PAD: 12, PILL2: 27 });
  });
});
