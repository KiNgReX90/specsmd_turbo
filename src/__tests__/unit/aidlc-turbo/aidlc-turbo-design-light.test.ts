/**
 * Unit tests for what lights up in the Code Scaffold drawing (design-light.js)
 * and for the small labels in a block:
 * - a story chosen lights up what it builds and uses, its number on what it
 *   builds;
 * - hovering a block (no story chosen) lights up its neighbours only after a
 *   short rest, and a pointer moving from block to block never puts the
 *   light out in between: no flicker;
 * - while a step is held that light fades nothing further: the block, its
 *   neighbours and the lines between them come up over the fade of the step
 *   (td-lit), no td-focus, and when it goes out the step shows as before;
 * - the module chip and the number in a block are plain labels: no focus
 *   stop, no tooltip, no click or hover of their own; the pointer goes
 *   through them to the block, and a block never jumps under the pointer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';
import { load } from './aidlc-turbo-design-panel-mount';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const read = (f: string) => { try { return readFileSync(path.join(DESIGN, f), 'utf8'); } catch { return ''; } };
const plain = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '');
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const model = dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
const G = globalThis as any;

let d: ReturnType<typeof fakeDom>;
beforeEach(() => {
  d = fakeDom();
  G.TdKit = load('design-kit.js');
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

function drawing(trace = false) {
  const dz = d.node('div');
  const svg = d.node('svg');
  if (trace) svg.classList.add('td-trace');
  const drawn = {
    svg,
    nodes: model.parts.map((p: any) => ({ p, g: d.node('g'), nb: d.node('text') })),
    edges: model.links.map((l: any) => ({ l, g: d.node('g'), lg: d.node('g') })),
    frames: [] as any[],
  };
  const light = load('design-light.js').create(drawn, model, dz);
  const g = (id: string) => drawn.nodes.find((n: any) => n.p.id === id).g;
  const fire = (id: string, type: string) => { for (const fn of g(id).listeners[type] || []) fn({}); };
  /** The ids of the blocks and of the lines (each with its label) that carry `cls`. */
  const marked = (cls: string) => ({
    nodes: drawn.nodes.filter((n: any) => n.g.classList.contains(cls)).map((n: any) => n.p.id).sort(),
    lines: drawn.edges.filter((e: any) => e.g.classList.contains(cls) && e.lg.classList.contains(cls)).map((e: any) => e.l.id).sort(),
  });
  return { dz, drawn, light, g, fire, marked };
}

describe('aidlc-turbo Code Scaffold: what lights up', () => {
  it('a story chosen lights up what it has, its number on the blocks', () => {
    const p = drawing();
    const s = model.stories[0];
    p.light.story(s);
    expect(p.dz.classList.contains('td-focus')).toBe(true);
    expect(p.g(s.parts[0]).classList.contains('td-in')).toBe(true);
    const out = model.parts.find((x: any) => !s.parts.includes(x.id)).id;
    expect(p.g(out).classList.contains('td-in')).toBe(false);
    expect(p.drawn.nodes[0].nb.textContent).toBe(s.n);
    p.light.story(null);
    expect(p.dz.classList.contains('td-focus')).toBe(false);
  });

  it('hovering a block lights its neighbours after a short rest, not at once', () => {
    const p = drawing();
    p.fire('ctrl', 'mouseenter');
    expect(p.dz.classList.contains('td-focus')).toBe(false);
    vi.advanceTimersByTime(200);
    expect(p.dz.classList.contains('td-focus')).toBe(true);
    expect(p.g('ctrl').classList.contains('td-in')).toBe(true);
  });

  it('from block to block the light never goes out in between', () => {
    const p = drawing();
    p.fire('ctrl', 'mouseenter');
    vi.advanceTimersByTime(200);
    const seen: boolean[] = [];
    p.fire('ctrl', 'mouseleave');
    seen.push(p.dz.classList.contains('td-focus'));
    vi.advanceTimersByTime(40);
    seen.push(p.dz.classList.contains('td-focus'));
    p.fire('uc', 'mouseenter');
    vi.advanceTimersByTime(200);
    seen.push(p.dz.classList.contains('td-focus'));
    expect(seen).toEqual([true, true, true]);
    expect(p.g('uc').classList.contains('td-in')).toBe(true);
    // off the blocks, it goes out once, after the rest
    p.fire('uc', 'mouseleave');
    vi.advanceTimersByTime(300);
    expect(p.dz.classList.contains('td-focus')).toBe(false);
  });

  it('a story chosen keeps its light while the pointer moves over the blocks', () => {
    const p = drawing();
    p.light.story(model.stories[1]);
    p.fire('ctrl', 'mouseenter');
    vi.advanceTimersByTime(300);
    p.fire('ctrl', 'mouseleave');
    vi.advanceTimersByTime(300);
    expect(p.dz.classList.contains('td-focus')).toBe(true);
    expect(p.g(model.stories[1].parts[0]).classList.contains('td-in')).toBe(true);
  });
});

describe('aidlc-turbo Code Scaffold: a block hovered while a step is held', () => {
  const near = model.links.filter((l: any) => l.from === 'ctrl' || l.to === 'ctrl');
  const lines = near.map((l: any) => l.id).sort();
  const blocks = [...new Set(['ctrl', ...near.flatMap((l: any) => [l.from, l.to])])].sort();

  it('lights the block, its neighbours and the lines between them over the step, after the rest; nothing fades further', () => {
    const p = drawing(true);
    p.fire('ctrl', 'mouseenter');
    expect(p.marked('td-lit').nodes).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(blocks.length).toBeGreaterThan(2);
    expect(p.marked('td-lit')).toEqual({ nodes: blocks, lines });
    // no focus: the rest keeps the fade of the step, the step's own blocks and line are not faded further
    expect(p.dz.classList.contains('td-focus')).toBe(false);
    expect(p.marked('td-in')).toEqual({ nodes: [], lines: [] });
  });

  it('when the pointer has left, the drawing is the step view again', () => {
    const p = drawing(true);
    p.fire('ctrl', 'mouseenter');
    vi.advanceTimersByTime(200);
    p.fire('ctrl', 'mouseleave');
    vi.advanceTimersByTime(40);
    expect(p.marked('td-lit').nodes).toEqual(blocks);
    vi.advanceTimersByTime(300);
    expect(p.marked('td-lit')).toEqual({ nodes: [], lines: [] });
    expect(p.dz.classList.contains('td-focus')).toBe(false);
  });

  it('a story chosen puts it out and keeps its own light; the hover then adds nothing', () => {
    const p = drawing(true);
    p.fire('ctrl', 'mouseenter');
    vi.advanceTimersByTime(200);
    const s = model.stories[1];
    p.light.story(s);
    expect(p.marked('td-lit')).toEqual({ nodes: [], lines: [] });
    expect(p.dz.classList.contains('td-focus')).toBe(true);
    p.fire('uc', 'mouseenter');
    vi.advanceTimersByTime(300);
    expect(p.marked('td-lit')).toEqual({ nodes: [], lines: [] });
    expect(p.marked('td-in').nodes).toEqual([...s.parts].sort());
  });
});


describe('aidlc-turbo Code Scaffold: the labels in a block are plain labels', () => {
  const ENGINE = read('design-engine.js');

  it('the module chip has no focus stop, no role, no tooltip of its own, and is hidden from a screen reader', () => {
    const line = ENGINE.split('\n').find((l) => l.includes("'td-frame td-mtag") || l.includes('`td-frame td-mtag'))!;
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/tabindex|role: 'button'/);
    expect(ENGINE).not.toMatch(/el\('title', \{\}, g\)\.textContent = `Module /);
    expect(ENGINE).toMatch(/'aria-hidden': 'true'/);
  });

  it('the pointer goes through the chip and the number to the block; the panel wires no click on the chip', () => {
    expect(plain('design-layout.css')).toMatch(/\.td-mtag \{[^}]*pointer-events: none;/);
    expect(plain('design.css')).toMatch(/\.td-nb \{[^}]*pointer-events: none;/);
    for (const f of ['design-layout.css', 'design.css', 'maquette-draw.css']) expect(plain(f), f).not.toMatch(/\.td-mtag:hover|\.td-frame:hover|\+ \.td-mtag:hover/);
    expect(read('design-panel.js')).not.toMatch(/clickable\(f\.g, 'module'/);
  });

  it('a block never moves under the pointer on hover: only the block chosen lifts', () => {
    const css = plain('maquette-draw.css');
    const lift = [...css.matchAll(/([^{}]+)\{([^{}]*transform: translateY\(-4px\)[^{}]*)\}/g)].map((m) => m[1]);
    expect(lift.length).toBeGreaterThan(0);
    for (const sel of lift) expect(sel, sel).not.toMatch(/:hover/);
  });
});