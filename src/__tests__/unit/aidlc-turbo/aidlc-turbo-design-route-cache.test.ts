/**
 * Unit tests for the lines a page brings along (design-layout.js with
 * scripts/lib/design-routes.cjs): routing the lines of a large Code
 * Scaffold takes seconds, so the page that inlines the drawing brings the
 * lines of what it can show, worked out where the page is made, and the
 * drawing in the browser only routes what it did not bring:
 * - layout() hands the lines of its two calmest variants to `keep`, under a
 *   key of the router's own code and everything the router reads;
 * - a model that brings them is laid out without routing, to the same
 *   drawing; lines under another key (another drawing) are left alone;
 * - designRoutes() brings the lines of both views of the switch "Only new
 *   and changed" (what it leaves out after the build too), one view
 *   when there is nothing to leave out, nothing for a design that is no
 *   whole model;
 * - the overview page carries them, and the drawing of the page's own model
 *   then routes nothing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const TdRoute = req(path.join(FLOW, 'templates/design/design-route.js'));
const { layout } = req(path.join(FLOW, 'templates/design/design-layout.js'));
const { only } = req(path.join(FLOW, 'templates/design/design-filter.js'));
const { designRoutes } = req(path.join(FLOW, 'scripts/lib/design-routes.cjs'));
const overview = req(path.join(FLOW, 'scripts/intent-overview.cjs'));

const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const fresh = () => dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
const json = (x: unknown) => JSON.stringify(x);

// count the routings; layout() reaches the router through its module, so this sees every call
const routeLinks = TdRoute.routeLinks;
let routed = 0;
TdRoute.routeLinks = (...args: unknown[]) => { routed += 1; return routeLinks(...args); };
afterEach(() => { routed = 0; });

describe('design layout: the lines a page brings', () => {
  it('keeps the lines of the two variants it routes, under a key of the router and what it reads', () => {
    const keep: Record<string, [string, [number, number][]][]> = {};
    const geo = layout(fresh(), { keep });
    const keys = Object.keys(keep);
    expect(keys).toHaveLength(2);
    expect(routed).toBe(2);
    for (const k of keys) expect(k).toMatch(/^[0-9a-z]+\.[0-9a-z]+$/);
    // the router's part of the key is the same, the drawing's part differs per variant
    expect(new Set(keys.map((k) => k.split('.')[0])).size).toBe(1);
    // the lines drawn are those of one of the variants kept
    const drawn = new Map(geo.links.map((l: { id: string; points: unknown }) => [l.id, l.points]));
    expect(keys.some((k) => keep[k].every(([id, pts]) => json(drawn.get(id)) === json(pts)))).toBe(true);
  });

  it('lays out a model that brings its lines without routing, to the same drawing', () => {
    const keep = {};
    const plain = layout(fresh(), { keep });
    routed = 0;
    const brought = layout({ ...fresh(), routes: keep });
    expect(routed).toBe(0);
    expect(json(brought)).toBe(json(plain));
  });

  it('routes what it did not bring: lines of another drawing are left alone', () => {
    const model = fresh();
    const keep = {};
    layout(model, { keep });
    // the same lines under keys of another drawing: a part moved, a link more
    const other: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(keep)) other[`${k.split('.')[0]}.other${k.length}`] = v;
    routed = 0;
    const g = layout({ ...model, routes: other, parts: model.parts.slice().reverse() });
    expect(routed).toBe(2);
    expect(g.links.length).toBe(model.links.filter((l: { from: string; to: string }) => l.from !== l.to).length);
  });
});

describe('design routes: what the page brings', () => {
  it('brings the lines of both views of the switch, and only those', () => {
    const model = fresh();
    const routes = designRoutes(model, 'inception');
    const less = only(model, null);
    expect(less).not.toBe(model);
    // the lines each view routes on its own: one routing for the small view (its variants are one drawing), two for all
    const keep = {};
    layout(less, { keep });
    layout(model, { keep });
    expect(Object.keys(routes).sort()).toEqual(Object.keys(keep).sort());
    expect(Object.keys(routes)).toHaveLength(3);
    routed = 0;
    layout({ ...less, routes });
    layout({ ...model, routes });
    expect(routed).toBe(0);
  });

  it('brings one view when the switch leaves nothing out', () => {
    const model = fresh();
    const all = { ...model, parts: model.parts.map((p: object) => ({ ...p, status: 'new' })) };
    const keep = {};
    layout(all, { keep });
    expect(Object.keys(designRoutes(all, 'inception')).sort()).toEqual(Object.keys(keep).sort());
  });

  it('brings nothing for a design that is no whole model: the page is made as before', () => {
    expect(designRoutes({ parts: [] }, 'inception')).toEqual({});
    expect(designRoutes({ ...fresh(), links: undefined }, 'inception')).toEqual({});
  });

  it('after the build leaves out only what the build did not mark, as the page does', () => {
    const model = fresh();
    const marked = { ...model, build: { stories: [] }, parts: model.parts.map((p: { id: string }) => (p.id === 'card' ? { ...p, build: { state: 'different' } } : p)) };
    const routes = designRoutes(marked, 'construction');
    routed = 0;
    layout({ ...only(marked, marked.build), routes });
    expect(routed).toBe(0);
    // before the build the mark does not count: that view is another drawing
    layout({ ...only(marked, null), routes });
    expect(routed).toBeGreaterThan(0);
  });

  it('is what the overview page carries: its drawing routes nothing', () => {
    const page = { phase: 'inception', design: fresh() };
    const html = overview.render(page);
    const data = JSON.parse(html.match(/<script id="overview-data" type="application\/json">\n?([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, '</'));
    expect(Object.keys(data.design.routes)).toHaveLength(3);
    routed = 0;
    layout(only(data.design, null));
    layout(data.design);
    expect(routed).toBe(0);
    // the page data it was given stays as it was
    expect(page.design).not.toHaveProperty('routes');
  });
});
