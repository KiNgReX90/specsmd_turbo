/**
 * Unit tests for the technical view in one look on a desktop (design-room.js):
 * - the legend, the drawing and the details panel take the height the window
 *   has left under what stands above them and over what stands below them
 *   (the masthead, the footer line); with too much above them (the plan page)
 *   the window's height less what stands below, never less than a floor;
 * - the drawing shrinks to fit that height and the width, never grows past
 *   its own size;
 * - it holds on a desktop only: a window of 1280 or wider without a finger;
 * - what stands above and below is measured from the page as laid out (a
 *   block the intro still slides in counts where it will stand), fixed
 *   overlays left out;
 * - the legend, the drawing's frame and the details panel take that height;
 * - a new height of the masthead (--masthead-h, kept by the page) fits it again.
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

let d: ReturnType<typeof fakeDom>;
beforeEach(() => { d = fakeDom(); });

describe('aidlc-turbo Code Scaffold: the technical view in one look', () => {
  const R = () => load('design-room.js');

  it('takes the height the window has left, above and below counted', () => {
    expect(R().fit({ inner: 900, top: 300, after: 90 })).toBe(510);
    expect(R().fit({ inner: 1080, top: 180, after: 60 })).toBe(840);
  });

  it('too much above it (the plan page: its note and the story): the window less what is below, so one scroll shows it whole', () => {
    // 1000 high, 460 above and 180 below leave 360: too low; it takes 1000 less the 180 and a small gap
    expect(R().fit({ inner: 1000, top: 460, after: 180 })).toBe(1000 - 180 - R().GAP);
    expect(R().GAP).toBeGreaterThan(0);
    expect(R().GAP).toBeLessThanOrEqual(24);
  });

  it('never less than the floor: a low window lets the page scroll', () => {
    expect(R().fit({ inner: 500, top: 400, after: 90 })).toBe(R().FLOOR);
    expect(R().FLOOR).toBeGreaterThanOrEqual(360);
  });

  it('the drawing shrinks to the height and the width, and never grows past its own size', () => {
    const vb = { w: 2000, h: 1000 };
    expect(R().scale(1000, 800, vb)).toBe(0.5);
    expect(R().scale(1600, 400, vb)).toBe(0.4);
    expect(R().scale(4000, 4000, vb)).toBe(1);
  });

  it('holds on a desktop only: 1280 wide or more, no finger', () => {
    expect(R().on({ view: 1440, touch: false })).toBe(true);
    expect(R().on({ view: 1279, touch: false })).toBe(false);
    expect(R().on({ view: 1920, touch: true })).toBe(false);
  });

  it('measures what stands above and below the stage by the layout, a fixed overlay left out', () => {
    const doc = G.document;
    // where the layout puts it: its offset in its offset parent, as the browser gives it without any transform
    const el = (top: number, bottom: number, position = 'static', mb = 0, parent: any = null) =>
      ({ offsetTop: top, offsetHeight: bottom - top, offsetParent: parent, position, mb, getBoundingClientRect: () => ({ top, bottom, height: bottom - top }) });
    const main = el(150, 700);
    const stage = el(100, 500, 'static', 0, main); // 100 into main: 250 on the page
    doc.body.children = [el(0, 140), main, el(728, 750, 'static', 40), el(0, 900, 'fixed')];
    G.getComputedStyle = (x: any) => ({ position: x.position, marginBottom: (x.mb || 0) + 'px', display: 'block' });
    expect(R().measure(stage)).toEqual({ top: 250, after: 140 });
  });

  it('a block still moving in (the intro of the page slides it by a transform) measures where it will stand', () => {
    const doc = G.document;
    const main = { offsetTop: 150, offsetHeight: 550, offsetParent: null, getBoundingClientRect: () => ({ top: 184, bottom: 734, height: 550 }) };
    const stage = { offsetTop: 100, offsetHeight: 400, offsetParent: main, getBoundingClientRect: () => ({ top: 284, bottom: 684, height: 400 }) };
    doc.body.children = [main, { offsetTop: 728, offsetHeight: 22, offsetParent: null, getBoundingClientRect: () => ({ top: 762, bottom: 784, height: 22 }) }];
    G.getComputedStyle = () => ({ position: 'static', marginBottom: '40px', display: 'block' });
    expect(R().measure(stage)).toEqual({ top: 250, after: 140 });
  });

  it('the legend, the drawing\'s frame and the panel take that height; what is longer scrolls inside them', () => {
    const css = read('design-pane.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.td-one \.td-stage > \.td-dzw \{ height: var\(--td-one-h\); \}/);
    expect(css).toMatch(/\.td-one\.td-side \.td-stage > \.td-steps:not\(\.td-folded\), \.td-one\.td-dbeside \.td-stage > \.td-dpane:not\(\.td-dfolded\) \{[^}]*height: var\(--td-one-h\);[^}]*max-height: var\(--td-one-h\);/);
    const panel = read('design-panel.js');
    expect(panel).toMatch(/rootEl\.classList\.toggle\('td-one', one && !pv\);/);
    expect(panel).toMatch(/stage\.style\.setProperty\('--td-one-h', one && !pv \? H \+ 'px' : ''\);/);
  });

  it('fits again when the page gives the masthead another height (--masthead-h on :root)', () => {
    const doc = G.document;
    const heights: string[] = [];
    doc.documentElement.style = { getPropertyValue: (k: string) => (k === '--masthead-h' ? heights[heights.length - 1] || '' : '') };
    let fits = 0;
    R().watch(() => { fits += 1; });
    heights.push('180px');
    d.observe();
    expect(fits).toBe(1);
    d.observe(); // another change of the style, the same height: nothing to fit
    expect(fits).toBe(1);
    heights.push('132px');
    d.observe();
    expect(fits).toBe(2);
    expect(read('design-panel.js')).toMatch(/root\.TdRoom\.watch\(\(\) => fitPage\(true\)\);/);
  });

  it('is inlined before the panel and used by it', () => {
    const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
    expect(assets.DESIGN_JS.indexOf('design-room.js')).toBeGreaterThan(-1);
    expect(assets.DESIGN_JS.indexOf('design-room.js')).toBeLessThan(assets.DESIGN_JS.indexOf('design-panel.js'));
    expect(read('design-panel.js')).toMatch(/root\.TdRoom\.measure\(stage\)/);
  });
});
