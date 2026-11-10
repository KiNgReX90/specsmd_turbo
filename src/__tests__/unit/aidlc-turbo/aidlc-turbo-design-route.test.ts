/**
 * Unit tests for templates/design/design-route.js, the router of the Code
 * Scaffold's arrows:
 * - a link the grid has no way through for still gets its line (the fallback
 *   down, across and down), also in the rounds after the first, where every
 *   link is lifted off the grid and routed again;
 * - a generated drawing gets exactly the lines the router drew before it was
 *   made faster (route-golden.json, recorded from that router): every point
 *   of every line, also around lines already drawn;
 * - that drawing (48 blocks, 60 links, 6 lines already drawn) is routed in
 *   at most thirteen times the processor time of a fixed piece of plain
 *   work (sorting a million and a half numbers), measured in the same
 *   process so a busy or slow machine slows both: this router takes about
 *   six times that (eight and a half while the whole suite runs), the
 *   router before about eighteen.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { bigDrawing } from './aidlc-turbo-design-route-fixture';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const TdRoute = req(path.join(FLOW, 'templates/design/design-route.js'));
const GOLDEN = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/route-golden.json');

describe('design route: a link without a way through', () => {
  it('gets the fallback line and the rounds after it do not trip over it', () => {
    const a = { id: 'a', x: 40, y: 40, w: 120, h: 60 };
    const b = { id: 'b', x: 40, y: 260, w: 120, h: 60 };
    // every port of b lies under something drawn on it: no grid point to start or end on
    const geo = {
      width: 400, height: 400, blocks: [a, b], frames: [],
      obstacles: [{ x: 0, y: 220, w: 400, h: 140 }],
      tracks: { xs: [20, 100, 200, 300], ys: [20, 150, 200, 380] },
      inner: { x0: 0, x1: 400 }, half: 30,
    };
    const routes = TdRoute.routeLinks(geo, [{ id: 'a-b', from: 'a', to: 'b' }, { id: 'a-b-2', from: 'a', to: 'b' }]);
    expect(routes.get('a-b')[0]).toEqual([100, 100]);
    expect(routes.get('a-b').at(-1)).toEqual([100, 260]);
  });
});

describe('design route: the same lines, fast', () => {
  it('draws every line of a generated drawing exactly as the router before', () => {
    const { geo, links, fixed } = bigDrawing(8, 6, 60, 3, true);
    const routes = TdRoute.routeLinks(geo, links, fixed);
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    expect(Object.keys(golden)).toHaveLength(60);
    expect(Object.fromEntries(routes)).toEqual(golden);
  }, 60000);

  it('routes it fast: at most thirteen times a fixed piece of plain work', () => {
    const cpu = (f: () => unknown) => {
      const u0 = process.cpuUsage();
      f();
      const u = process.cpuUsage(u0);
      return (u.user + u.system) / 1000;
    };
    const plainWork = () => {
      let s = 7;
      const a = new Float64Array(1500000);
      for (let i = 0; i < a.length; i += 1) { s = (s * 16807) % 2147483647; a[i] = s; }
      return a.sort()[0];
    };
    const unit = Math.min(cpu(plainWork), cpu(plainWork));
    const { geo, links, fixed } = bigDrawing(8, 6, 60, 3, true);
    let size = 0;
    const t = cpu(() => { size = TdRoute.routeLinks(geo, links, fixed).size; });
    expect(size).toBe(60);
    expect(t / unit).toBeLessThan(13);
  }, 120000);
});
