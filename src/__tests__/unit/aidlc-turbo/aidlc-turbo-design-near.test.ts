/**
 * Unit tests for the arrows on a block with the focus (design-near.js and
 * the panel, design-panel.js):
 * - the four arrows go to the nearest block in that direction, by the
 *   centres of the blocks, inside a cone around the direction (a block off
 *   to the side counts double; one more to the side than ahead is out);
 *   none that way, the focus stays;
 * - the block it goes to gets the focus and is chosen as a click does (its
 *   details show, the step into it held); without a block in the focus the
 *   arrows walk the steps, as before;
 * - the keys along the drawing say it while a block has the focus, and a
 *   block shows a clear ring for the focus.
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
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const model = dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
const geo = layout(model);

/** A block of 100 by 60 with its centre at x, y. */
const at = (id: string, x: number, y: number) => ({ id, x: x - 50, y: y - 30, w: 100, h: 60 });
const PLAN = [at('a', 0, 0), at('right', 200, 10), at('far', 500, 0), at('down', 0, 200), at('up', 10, -200), at('left', -200, 0)];

describe('aidlc-turbo Code Scaffold: the block in a direction', () => {
  const pick = (blocks: any[], from: string, dir: string) => load('design-near.js').pick(blocks, from, dir);

  it('goes up, down, left and right to the nearest block that way', () => {
    expect(pick(PLAN, 'a', 'right')).toBe('right');
    expect(pick(PLAN, 'a', 'down')).toBe('down');
    expect(pick(PLAN, 'a', 'up')).toBe('up');
    expect(pick(PLAN, 'a', 'left')).toBe('left');
    // from there on, the next one that way
    expect(pick(PLAN, 'right', 'right')).toBe('far');
  });

  it('stays where no block is in that direction', () => {
    expect(pick(PLAN, 'left', 'left')).toBeNull();
    expect(pick(PLAN, 'far', 'right')).toBeNull();
    expect(pick(PLAN, 'up', 'up')).toBeNull();
    expect(pick(PLAN, 'nowhere', 'up')).toBeNull();
  });

  it('a block off to the side counts double: the one on the line wins, though it is a little further', () => {
    const blocks = [at('a', 0, 0), at('line', 200, 10), at('side', 150, 120)];
    expect(pick(blocks, 'a', 'right')).toBe('line');
  });

  it('the cone leaves out a block more to the side than ahead, however near', () => {
    const blocks = [at('a', 0, 0), at('diag', 120, 140), at('far', 900, 0)];
    expect(pick(blocks, 'a', 'right')).toBe('far');
    expect(pick(blocks, 'a', 'down')).toBe('diag');
    expect(pick([at('a', 0, 0), at('diag', 300, 300)], 'a', 'right')).toBeNull();
  });
});

describe('aidlc-turbo Code Scaffold: the arrows on a block with the focus', () => {
  let d: ReturnType<typeof fakeDom>;
  beforeEach(() => {
    d = fakeDom();
    dress(d);
  });
  /** A key on `target` as a browser fires it: the document's capture listeners, the target's own, then the document's others. */
  function press(target: any, key: string) {
    const ev: any = { key, target, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, propagationStopped: false };
    ev.preventDefault = () => { ev.defaultPrevented = true; };
    ev.stopPropagation = () => { ev.propagationStopped = true; };
    const ls = d.docListeners.filter((l: any) => l.type === 'keydown');
    for (const l of ls.filter((x: any) => x.capture)) l.fn(ev);
    for (const fn of target.listeners.keydown || []) fn(ev);
    if (!ev.propagationStopped) for (const l of ls.filter((x: any) => !x.capture)) l.fn(ev);
    return ev;
  }
  const focusin = (target: any) => { for (const l of d.docListeners.filter((x: any) => x.type === 'focusin')) l.fn({ target }); };
  const blocks = geo.blocks.filter((b: any) => model.parts.some((p: any) => p.id === b.id));
  const near = (from: string, dir: string) => load('design-near.js').pick(blocks, from, dir);
  const text = (e: any) => (e ? e.textContent : null);

  it('the arrows on a block choose the block in that direction, which gets the focus', () => {
    const p = mountPanel(d, model, geo);
    p.node('ctrl').click();
    p.node('ctrl').focus();
    const down = near('ctrl', 'down') || near('ctrl', 'up');
    const dir = near('ctrl', 'down') ? 'ArrowDown' : 'ArrowUp';
    expect(down).toBeTruthy();
    expect(press(p.node('ctrl'), dir).defaultPrevented).toBe(true);
    expect(p.chosen(down)).toBe(true);
    expect(p.chosen('ctrl')).toBe(false);
    expect(d.doc.activeElement).toBe(p.node(down));
    // right and left too, by the drawing, not by the list
    const right = near(down, 'right');
    if (right) { press(p.node(down), 'ArrowRight'); expect(p.chosen(right)).toBe(true); }
  });

  it('nothing in that direction: the block keeps the focus and stays chosen', () => {
    const p = mountPanel(d, model, geo);
    const edge = blocks.find((b: any) => !near(b.id, 'left'))!.id;
    p.node(edge).click();
    p.node(edge).focus();
    press(p.node(edge), 'ArrowLeft');
    expect(p.chosen(edge)).toBe(true);
    expect(d.doc.activeElement).toBe(p.node(edge));
  });

  it('as a click: the block chosen, the step into it held where one goes there', () => {
    const p = mountPanel(d, model, geo);
    const from = blocks.find((b: any) => near(b.id, 'right'))!.id;
    const to = near(from, 'right')!;
    p.node(from).focus();
    press(p.node(from), 'ArrowRight');
    expect(p.chosen(to)).toBe(true);
    const l = model.links.find((x: any) => x.id === p.steps.current());
    expect(l).toBeTruthy();
    expect(d.doc.activeElement).toBe(p.node(to));
  });

  it('without a block in the focus the arrows walk the steps, as before', () => {
    const p = mountPanel(d, model, geo);
    p.node('ctrl').click();
    const at = p.steps.current();
    expect(at).toBeTruthy();
    const ids = p.steps.ids(), i = ids.indexOf(at), back = i === ids.length - 1;
    d.key(back ? 'ArrowLeft' : 'ArrowRight');
    expect(p.steps.current()).toBe(ids[back ? i - 1 : i + 1]);
    expect(p.chosen('ctrl')).toBe(false);
  });

  it('the keys along the drawing say where the arrows go while a block has the focus', () => {
    const p = mountPanel(d, model, geo);
    const keys = d.all(p.root, 'td-steps-keys')[0];
    expect(text(keys.lastElementChild)).toBe('previous or next step');
    focusin(p.node('ctrl'));
    expect(text(keys.lastElementChild)).toBe('to the block in that direction');
    expect(keys.classList.contains('td-near')).toBe(true);
    focusin(d.node('button'));
    expect(text(keys.lastElementChild)).toBe('previous or next step');
    expect(keys.classList.contains('td-near')).toBe(false);
  });

  it('a block shows a clear ring for the focus, in light and dark, and the up and down keys only with a block in the focus', () => {
    const css = plain('design.css');
    expect(css).toMatch(/\.td-svg \.td-node:focus-visible \.td-outline \{[^}]*stroke: var\(--td-orange\);[^}]*stroke-width: 4/);
    expect(plain('design-steps.css')).toMatch(/\.td-steps-keys:not\(\.td-near\) \.td-k-ud \{ display: none; \}/);
  });

  it('the module chip in a block is no stop of its own', () => {
    expect(read('design-engine.js')).not.toMatch(/td-frame td-mtag[^\n]*tabindex/);
  });
});
