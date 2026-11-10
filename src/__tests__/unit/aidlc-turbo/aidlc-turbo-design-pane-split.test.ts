/**
 * Unit tests for the details panel right of the Code Scaffold drawing that is
 * always there (design-pane.js):
 * - on a desktop page the panel never goes: nothing to choose it says so,
 *   calmly; letting go of a block leaves the drawing as wide as it was;
 *   folded, the rail reads "Details", before and after the build, its
 *   tooltip names what is chosen;
 * - a desktop window too narrow for the panel beside the drawing keeps it at
 *   the side as its rail, opening over the drawing; a phone and the preview
 *   keep the details under the drawing;
 * - no divider before a change in the code in the panel any more (that is
 *   the Review tab's); the edge moves by the one way to drag (design-grip.js),
 *   and the divider of TdDiff.split keeps its look in design-diff.css.
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

let d: ReturnType<typeof fakeDom>;
let stored: Map<string, string>;
beforeEach(() => {
  d = fakeDom();
  G.TdKit = load('design-kit.js');
  G.TdGrip = load('design-grip.js');
  stored = new Map();
  G.localStorage = { getItem: (k: string) => (stored.has(k) ? stored.get(k)! : null), setItem: (k: string, v: string) => { stored.set(k, String(v)); }, removeItem: (k: string) => { stored.delete(k); } };
  delete G.requestAnimationFrame;
});

const ev = (o: Record<string, unknown> = {}) => {
  const e: any = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, defaultPrevented: false, ...o };
  e.preventDefault = () => { e.defaultPrevented = true; };
  return e;
};
const fire = (el: any, type: string, e: any = ev()) => { for (const fn of el.listeners[type] || []) fn(e); return e; };
const key = (el: any, k: string) => fire(el, 'keydown', ev({ key: k }));
const first = (e: any, cls: string) => d.all(e, cls)[0] || null;

/** The details of a part named `name`. */
function details(detail: any, name: string) {
  const head = d.node('div');
  head.className = 'td-dhead';
  const h3 = d.node('h3');
  h3.textContent = name;
  head.append(h3);
  const g = d.node('div');
  g.className = 'td-dgrid';
  g.append(head);
  detail.replaceChildren(g);
  detail.hidden = false;
  d.observe();
}

function pane(o: { draw?: number; steps?: boolean; desk?: boolean } = {}) {
  const P = load('design-pane.js');
  const detail = d.node('div');
  detail.className = 'td-detail';
  detail.hidden = true;
  const host = d.node('div'), draw = d.node('div');
  draw.clientWidth = o.draw ?? 900;
  let changes = 0;
  const desk = o.desk ?? true;
  const p = P.create(detail, { host, draw, steps: o.steps, desk: () => desk, onChange: () => { changes++; } });
  p.el.offsetWidth = 460;
  p.grip.setPointerCapture = () => {};
  return { P, p, detail, host, draw, changes: () => changes };
}

describe('aidlc-turbo Code Scaffold: the details panel is always there on a desktop page', () => {
  it('nothing to choose, it says so calmly, and the drawing keeps its width when the details come and go', () => {
    const { p, detail, changes } = pane();
    p.place(1286);
    expect(p.el.classList.contains('td-dpane-none')).toBe(true);
    const empty = first(p.el, 'td-dpane-empty');
    expect(empty).not.toBeNull();
    expect(empty.textContent).toBe('This drawing has no blocks.');
    details(detail, 'ReturnShipmentProcessor');
    expect(p.el.classList.contains('td-dpane-none')).toBe(false);
    detail.hidden = true;
    d.observe();
    expect(p.el.classList.contains('td-dpane-none')).toBe(true);
    expect(changes()).toBe(0);
    expect(read('design-pane.js')).not.toContain('td-dpane-off');
  });

  it('the calm word never asks to choose: something is always chosen where something can be', () => {
    const { p } = pane({ steps: true });
    expect(first(p.el, 'td-dpane-empty').textContent).toBe('This story has no steps.');
    expect(JSON.stringify(req(path.join(FLOW, 'templates/lang/en.json')).design.pane)).not.toMatch(/choose a block|choose a step/i);
  });

  it('the rail reads only "Details"', () => {
    const { p, detail } = pane();
    p.place(1286);
    const rail = first(p.el, 'td-dpane-rail');
    expect(rail.textContent).toBe('Details');
    details(detail, 'ShipmentParser');
    first(p.el, 'td-dfold').click();
    expect(rail.textContent).toBe('Details');
    expect(rail.title).toBe('Unfold the details: ShipmentParser');
  });

  it('has no close button anywhere, nor its style: something is always chosen', () => {
    for (const f of ['design-pane.css', 'design-browse.css', 'design.css', 'design-touch.css', 'maquette-draw.css', 'design-show.js']) expect(read(f), f).not.toContain('td-dx');
  });

  it('beside the drawing never display: none; the empty word shows only there and open', () => {
    const plain = read('design-pane.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(plain).not.toMatch(/td-dpane-off/);
    expect(plain).toMatch(/\.td-dbeside \.td-dpane\.td-dpane-none:not\(\.td-dfolded\) > \.td-dpane-empty \{ display: flex; \}/);
    expect(plain).toMatch(/\.td-dpane-empty \{[^}]*color: var\(--td-ink-[23]\);/);
  });
});

describe('aidlc-turbo Code Scaffold: a narrow desktop window keeps the details at the side', () => {
  it('a desktop too narrow for both keeps the panel beside, as its rail; a phone and the preview put the details under', () => {
    const { P, p, host } = pane();
    expect(p.place(P.NEED - 1)).toBe(true);
    expect(host.classList.contains('td-dbeside')).toBe(true);
    expect(host.classList.contains('td-dtight')).toBe(true);
    expect(p.folded()).toBe(true);
    expect(p.place(P.TIGHT - 1)).toBe(false);
    expect(p.place(0)).toBe(false);
    expect(host.classList.contains('td-dtight')).toBe(false);
    const touch = pane({ desk: false });
    expect(touch.p.place(P.NEED - 1)).toBe(false);
    expect(touch.host.classList.contains('td-dbeside')).toBe(false);
  });

  it('opened from the rail it lies over the drawing; the viewer\'s own fold stays as it was; no resizing there', () => {
    const { P, p, host } = pane();
    p.place(P.NEED - 1);
    first(p.el, 'td-dpane-rail').click();
    expect(p.folded()).toBe(false);
    expect(stored.has('td-details-folded')).toBe(false);
    fire(p.grip, 'pointerdown', ev({ clientX: 1000 }));
    fire(p.grip, 'pointermove', ev({ clientX: 800 }));
    expect(p.width()).toBe(P.OPEN);
    expect(d.html.classList.contains('td-dresizing')).toBe(false);
    // room again: the panel opens as the viewer left it; narrow again: the rail first
    p.place(1286);
    expect(host.classList.contains('td-dtight')).toBe(false);
    expect(p.folded()).toBe(false);
    p.place(P.NEED - 1);
    expect(p.folded()).toBe(true);
  });

  it('the panel asks the page whether it is a desktop (no finger)', () => {
    expect(read('design-panel.js')).toMatch(/root\.TdPane\.create\(detail, \{[^}]*desk: \(\) => !root\.TdView\.touchy\(\)/);
    const plain = read('design-pane.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(plain).toMatch(/\.td-dbeside\.td-dtight \.td-stage \{[^}]*position: relative;[^}]*padding-right: 68px;/);
    expect(plain).toMatch(/\.td-dbeside\.td-dtight \.td-stage > \.td-dpane \{[^}]*position: absolute;/);
  });
});

describe('aidlc-turbo Code Scaffold: one way to drag', () => {
  it('design-grip.js holds the drag, the keys and the double click; the panel uses it for its edge only', () => {
    const pane = read('design-pane.js');
    expect(pane.match(/TdGrip\.bind\(/g) || []).toHaveLength(1);
    expect(pane).not.toMatch(/td-dsep|SPLIT/);
    expect(pane).not.toMatch(/pointermove|setPointerCapture/);
    const grip = read('design-grip.js');
    expect(grip).toMatch(/pointermove/);
    expect(grip).toMatch(/setPointerCapture/);
    expect(grip).toMatch(/dblclick/);
    const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
    const js = (f: string) => assets.DESIGN_JS.indexOf(f);
    expect(js('design-grip.js')).toBeGreaterThan(js('design-kit.js'));
    expect(js('design-grip.js')).toBeLessThan(js('design-pane.js'));
  });

  it('the panel\'s edge shows a grip at rest, lit under the pointer and the focus', () => {
    const plain = read('design-pane.css').replace(/\/\*[\s\S]*?\*\//g, '');
    // a tab with grip dots, not a bar that reads as a scrollbar
    expect(plain).toMatch(/\.td-dgrip::after \{[^}]*border: 1px solid var\(--td-line-strong\);[^}]*background: radial-gradient\(circle, var\(--td-ink-3\)/);
    expect(plain).not.toMatch(/td-dsep/);
    expect(plain).toMatch(/\.td-dresizing\.td-dresizing-y, \.td-dresizing\.td-dresizing-y \* \{ cursor: row-resize !important; \}/);
    expect(plain).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });

  it('the divider of TdDiff.split keeps its look with the diff: a hairline with a grip, from a tablet up', () => {
    const diff = read('design-diff.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(diff).toMatch(/@media \(min-width: 601px\) \{[^@]*\.td-dcols > \.td-dsep \{[^}]*display: block;[^}]*cursor: col-resize;[^}]*touch-action: none;/);
    expect(diff).toMatch(/\.td-dsep \{ display: none; \}/);
    expect(diff).toMatch(/\.td-dsep::after \{[^}]*radial-gradient/);
    expect(diff).toMatch(/\.td-dsep:focus-visible/);
    expect(diff).not.toMatch(/td-detail|td-dfull/);
  });

  it('keeps its files under 500 lines, without a long dash', () => {
    for (const f of ['design-grip.js', 'design-pane.js', 'design-pane.css', 'design-diff.js', 'design-panel.js']) {
      const src = read(f);
      expect(src.length, f).toBeGreaterThan(0);
      expect(src.split('\n').length, f).toBeLessThanOrEqual(500);
      expect(src, f).not.toMatch(/\u2014/);
    }
  });
});
