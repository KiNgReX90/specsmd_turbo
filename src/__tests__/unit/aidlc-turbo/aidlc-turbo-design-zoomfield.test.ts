/**
 * Unit tests for the zoom as a field on the full-screen view (design-view.js, TdView.zoomField):
 * - between the zoom buttons a field that reads as the percentage did ("100%"), named from the string table;
 * - a typed number, with or without %, a comma for the decimals too, sets the zoom on Enter or on leaving
 *   the field (the view clamps it and zooms around the middle, as its buttons do); anything else reverts;
 * - Escape puts back the zoom and leaves the field, and goes no further (the view stays open);
 * - the up and down arrows step as the buttons, 10 percent (110%, 120%), from an odd zoom to the round ten
 *   first; the buttons and the keys + and - the same; the focus selects the text;
 * - the zoom by wheel, pinch or buttons shows in it, never over what is being typed;
 * - the view wires it, the drawing's keys leave it alone, and it looks as the percentage did.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';
import { load } from './aidlc-turbo-design-panel-mount';

const DESIGN = path.resolve(__dirname, '../../../flows/aidlc-turbo/templates/design');
const EN = JSON.parse(readFileSync(path.resolve(DESIGN, '../lang/en.json'), 'utf8'));
const read = (f: string) => readFileSync(path.join(DESIGN, f), 'utf8');
const G = globalThis as any;

let d: ReturnType<typeof fakeDom>;
beforeEach(() => {
  d = fakeDom();
  const make = d.doc.createElement;
  d.doc.createElement = (t: string) => {
    const e = make(t);
    e.select = () => { e.selected = true; };
    e.blur = () => { if (d.doc.activeElement === e) d.doc.activeElement = null; for (const fn of e.listeners.blur || []) fn({ target: e }); };
    return e;
  };
  delete G.TdView;
  load('design-view.js');
});

/** The field with a zoom the test holds: set() clamps as the view does. */
function field(start = 1) {
  const z = { s: start, sets: [] as number[] };
  const f = G.TdView.zoomField({ get: () => z.s, set: (s: number) => { z.sets.push(s); z.s = Math.min(3, Math.max(0.15, s)); } });
  return { z, f, el: f.el };
}
function press(el: any, key: string) {
  const ev: any = { key, target: el, defaultPrevented: false, stopped: false };
  ev.preventDefault = () => { ev.defaultPrevented = true; };
  ev.stopPropagation = () => { ev.stopped = true; };
  for (const fn of el.listeners.keydown || []) fn(ev);
  return ev;
}
function type(el: any, text: string) {
  el.focus();
  for (const fn of el.listeners.focus || []) fn({ target: el });
  el.value = text;
}

describe('aidlc-turbo full screen: the zoom as a field', () => {
  it('a text field that reads as the percentage did, named in the page\'s language, a number pad on a phone', () => {
    const { f, el } = field();
    expect(el.tag).toBe('input');
    expect(el.type).toBe('text');
    expect(el.className).toBe('td-pct');
    expect(el.getAttribute('aria-label')).toBe(EN.design.view.zoomField);
    expect(el.getAttribute('inputmode')).toBe('decimal');
    expect(el.getAttribute('autocomplete')).toBe('off');
    expect(el.title).toBe(EN.design.view.zoomFieldTip);
    f.show(1);
    expect(el.value).toBe('100%');
    f.show(1.234);
    expect(el.value).toBe('123%');
  });

  it('a number typed, with or without %, sets the zoom on Enter and shows what the view made of it', () => {
    const { z, f, el } = field();
    f.show(1);
    type(el, '150');
    const ev = press(el, 'Enter');
    expect(ev.defaultPrevented).toBe(true);
    expect(z.sets).toEqual([1.5]);
    expect(el.value).toBe('150%');
    type(el, ' 62,5 % ');
    press(el, 'Enter');
    expect(z.sets[1]).toBeCloseTo(0.625);
    expect(el.value).toBe('63%');
    // past the largest zoom: the view clamps it, the field says so
    type(el, '500%');
    press(el, 'Enter');
    expect(el.value).toBe('300%');
  });

  it('leaving the field sets it too; leaving it unchanged sets nothing', () => {
    const { z, f, el } = field();
    f.show(1);
    type(el, '80');
    el.blur();
    expect(z.sets).toEqual([0.8]);
    expect(el.value).toBe('80%');
    type(el, '80%');
    el.blur();
    expect(z.sets).toEqual([0.8]);
  });

  it('anything else puts the zoom back and sets nothing', () => {
    const { z, f, el } = field(1.25);
    f.show(1.25);
    for (const bad of ['abc', '0', '-20', '', '%', '1.2.3']) {
      type(el, bad);
      press(el, 'Enter');
      expect(el.value, bad).toBe('125%');
    }
    expect(z.sets).toEqual([]);
  });

  it('Escape puts the zoom back, leaves the field and goes no further, so the view stays open', () => {
    const { z, f, el } = field();
    f.show(1);
    type(el, '220');
    const ev = press(el, 'Escape');
    expect(ev.defaultPrevented).toBe(true);
    expect(el.value).toBe('100%');
    expect(d.doc.activeElement).toBeNull();
    expect(z.sets).toEqual([]);
  });

  it('a step is 10 percent: up to the next ten, down to the one before, from any zoom', () => {
    const step = G.TdView.stepZoom;
    expect([step(1, 1), step(1.1, 1), step(1, -1), step(0.9, -1)]).toEqual([1.1, 1.2, 0.9, 0.8]);
    // an odd zoom (the wheel, a pinch, the fit) goes to the round ten first
    expect([step(1.37, 1), step(1.37, -1), step(0.333, 1), step(0.333, -1)]).toEqual([1.4, 1.3, 0.4, 0.3]);
    // the rounding of the floats never skips a ten
    expect([step(0.7, 1), step(1.2, -1), step(2.9, 1)]).toEqual([0.8, 1.1, 3]);
  });

  it('the up and down arrows step as the buttons do, 10 percent', () => {
    const { z, f, el } = field();
    f.show(1);
    type(el, '100%');
    expect(press(el, 'ArrowUp').defaultPrevented).toBe(true);
    expect(z.s).toBeCloseTo(1.1);
    expect(el.value).toBe('110%');
    press(el, 'ArrowUp');
    expect(el.value).toBe('120%');
    press(el, 'ArrowDown');
    press(el, 'ArrowDown');
    expect(z.s).toBeCloseTo(1);
    expect(el.value).toBe('100%');
    // another key is the field's own
    expect(press(el, '5').defaultPrevented).toBe(false);
  });

  it('the focus selects the text, so a number typed replaces it', () => {
    const { el } = field();
    type(el, '100%');
    expect(el.selected).toBe(true);
  });

  it('the zoom by wheel, pinch or buttons shows in it, never over what is being typed', () => {
    const { f, el } = field();
    f.show(1);
    type(el, '17');
    f.show(2);
    expect(el.value).toBe('17');
    el.blur();
    f.show(0.5);
    expect(el.value).toBe('50%');
  });
});

describe('aidlc-turbo full screen: the view wires the field', () => {
  const view = read('design-view.js');

  it('stands between the zoom buttons, sets the zoom by the view\'s own zoom around the middle, shows it on every move', () => {
    expect(view).toMatch(/const zf = zoomField\(\{ get: \(\) => \(fs \? fs\.s : 1\), set: \(s\) => \{ if \(fs\) \{ hold\(\); zoomBy\(s \/ fs\.s\); \} \} \}\);/);
    expect(view).toMatch(/zoom\.append\(out, zf\.el, inn, fitB\);/);
    expect(view).toMatch(/fs\.pct\.show\(fs\.s\);/);
    expect(view).not.toMatch(/h\('span', 'td-pct'\)/);
    expect(view).toMatch(/root\.TdView = \{ create, touchy, touched, zoomField, stepZoom \};/);
  });

  it('the buttons and the keys + and - step 10 percent too; the wheel and a pinch stay smooth', () => {
    expect(view).toMatch(/out\.onclick = \(\) => \{ hold\(\); zoomStep\(-1\); \};/);
    expect(view).toMatch(/inn\.onclick = \(\) => \{ hold\(\); zoomStep\(1\); \};/);
    expect(view).toMatch(/const k = \{ '\+': 1, '=': 1, '-': -1, _: -1 \}\[ev\.key\];/);
    expect(view).toMatch(/const zoomStep = \(dir\) => fs && zoomBy\(stepZoom\(fs\.s, dir\) \/ fs\.s\);/);
    expect(view).not.toMatch(/zoomBy\(1\.25\)|zoomBy\(0\.8\)/);
  });

  it('the drawing\'s keys leave a field alone: the zoom keys, play and the walk', () => {
    expect(view).toMatch(/\/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(ev\.target\.tagName\)/);
    for (const f of ['design-play.js', 'design-browse.js']) expect(read(f)).toMatch(/const FIELD = 'input, /);
  });

  it('looks as the percentage did: no box until the pointer or the focus is on it', () => {
    const css = read('design.css');
    expect(css).toMatch(/\.td-pct \{[^}]*border: 1px solid transparent;[^}]*background: transparent;[^}]*text-align: center;[^}]*cursor: text;/);
    expect(css).toMatch(/\.td-pct:hover \{[^}]*border-color: var\(--td-line-strong\);/);
    expect(css).toMatch(/\.td-pct:focus \{[^}]*outline: none;[^}]*border-color: var\(--td-accent\);[^}]*background: var\(--td-surface\);/);
  });

  it('on a touch screen as high as the buttons, and large enough text that a phone does not zoom in on it', () => {
    expect(read('design-touch.css')).toMatch(/\.td-fs\.td-touch \.td-pct \{[^}]*min-height: 40px;[^}]*font-size: 16px;/);
  });

  it('keeps design-view.js under 500 lines, without an em-dash', () => {
    expect(view.split('\n').length).toBeLessThanOrEqual(500);
    expect(view).not.toContain('—');
  });
});
