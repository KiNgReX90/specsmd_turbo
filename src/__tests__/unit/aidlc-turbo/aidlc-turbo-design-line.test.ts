/**
 * Unit tests for a step held on the Code Scaffold drawing, now that the
 * details show where a step goes (design-show.js):
 * - a line clicked holds its step: no block is chosen, the details show the
 *   part the step goes to, the box over the drawing the step (design-stepbox.js); the arrows
 *   walk on from it; the line of the step held keeps it; a line clicked while
 *   a block is chosen lets go of the block;
 * - a drawing without steps: a line opens its own details, which carry no
 *   walk of their own (the walk over the drawing does that);
 * - a part dimmed (off the step held and not hovered, or out of the story
 *   chosen) fades into its plate: a new part trades its solid violet for paper first, else a
 *   third of it stays a lilac slab, louder than the parts lit;
 * - the block chosen stays lit while a step is held (a block no step goes to
 *   is chosen with a step still held, design-chosen.js): the step fades every
 *   other block and its module chip, never the block chosen nor its chip, nor
 *   a block hovered with its neighbours and the lines between them (td-lit,
 *   design-light.js).
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
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const { layout } = req(path.join(DESIGN, 'design-layout.js'));
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const model = dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
const geo = layout(model);
const G = globalThis as any;

let d: ReturnType<typeof fakeDom>;
beforeEach(() => {
  d = fakeDom();
  dress(d);
});

const text = (e: any) => (e ? e.textContent : null);
const first = (e: any, cls: string) => (e ? d.all(e, cls)[0] || null : null);
const ORDER: string[] = geo.flow.order;
const link = (id: string) => model.links.find((l: any) => l.id === id);
const nameOf = (id: string) => model.parts.find((x: any) => x.id === id).name;
/** The number of the step held, in the box over the drawing; the name of the part in the details. */
const stepOf = (p: any) => text(first(p.box(), 'td-sbox-n'));
const named = (p: any) => text(first(p.shown(), 'td-dhead')?.children.find((c: any) => c && c.tag === 'h3'));

describe('aidlc-turbo Code Scaffold: a line clicked holds its step', () => {
  it('holds the step; the details show the part it goes to, nothing chosen beside it', () => {
    const p = mountPanel(d, model, geo);
    p.line(ORDER[1]);
    expect(p.steps.current()).toBe(ORDER[1]);
    expect(p.detail.hidden).toBe(false);
    expect(stepOf(p)).toMatch(/^Step 2\b/);
    expect(named(p)).toBe(nameOf(link(ORDER[1]).to));
    expect(p.chosen(link(ORDER[1]).to)).toBe(false);
  });

  it('the arrows walk on from it, the details with them', () => {
    const p = mountPanel(d, model, geo);
    p.line(ORDER[1]);
    d.key('ArrowRight');
    expect(p.steps.current()).toBe(ORDER[2]);
    expect(stepOf(p)).toMatch(/^Step 3\b/);
    expect(named(p)).toBe(nameOf(link(ORDER[2]).to));
  });

  it('the line of the step held keeps it', () => {
    const p = mountPanel(d, model, geo);
    d.key('ArrowRight');
    d.key('ArrowRight');
    p.line(ORDER[1]);
    expect(p.steps.current()).toBe(ORDER[1]);
    expect(stepOf(p)).toMatch(/^Step 2\b/);
    p.line(ORDER[1]);
    expect(p.steps.current()).toBe(ORDER[1]);
    expect(p.detail.hidden).toBe(false);
  });

  it('a line clicked while a block is chosen lets go of the block; the details show where the step goes', () => {
    const p = mountPanel(d, model, geo);
    const l = link(ORDER[0]);
    p.node(l.from).click();
    expect(p.chosen(l.from)).toBe(true);
    p.line(ORDER[0]);
    expect(p.chosen(l.from)).toBe(false);
    expect(p.steps.current()).toBe(ORDER[0]);
    expect(stepOf(p)).toMatch(/^Step 1\b/);
    expect(named(p)).toBe(nameOf(l.to));
  });

  it('without steps a line opens its own details', () => {
    const p = mountPanel(d, model, { ...geo, flow: { ...geo.flow, order: [] } });
    expect(p.steps).toBeNull();
    p.line(model.links[0].id);
    expect(p.detail.hidden).toBe(false);
    expect(first(p.shown(), 'td-dstep')).toBeNull();
  });
});

describe('aidlc-turbo Code Scaffold: the details of a line', () => {
  it('carry no walk of their own: the walk over the drawing does that', () => {
    G.TdBuild = load('design-built.js');
    G.TdEngine = { ...load('design-engine.js'), kindOf: (k: string) => k };
    G.TdAbout = load('design-about.js');
    load('design-detail.js');
    const about = G.TdAbout.create(model, { built: null, order: ORDER });
    const f = G.TdDetail.create(model, { built: null, titleOf: (s: any) => s.title, order: ORDER, about });
    const l = { ...link(ORDER[1]), code: 'HostPage.open()' };
    const [head, dl, more] = f.link(l);
    expect(text(head)).toContain('Step 2');
    expect(text(dl)).toContain('HostPage.open()');
    expect(more).toBeUndefined();
    expect(d.all(head, 'td-walkb')).toEqual([]);
  });
});

describe('aidlc-turbo Code Scaffold: a part dimmed fades into its plate', () => {
  const css = read('maquette-draw.css');
  const DIM = String.raw`\.mq :is\(\.td-trace \.td-node:not\(\.td-hot, \.td-lit\), \.td-focus \.td-node:not\(\.td-in\)\)\.td-st-new:not\(\.td-sel\)`;
  const rule = (el: string, decl: string) => new RegExp(`${DIM} ${el.replace('.', '\\.')}[^{]*\\{ ${decl.replace(/[()]/g, '\\$&')}; \\}`);

  it('a new part off the step held (not hovered) or out of the story chosen trades its solid violet for paper, as a part that changes', () => {
    expect(css).toMatch(rule('.td-fill', 'fill: var(--td-surface)'));
    expect(css).toMatch(rule('.td-pk-r', 'fill: var(--td-chip-mod-bg)'));
    expect(css).toMatch(rule('.td-pk-t', 'fill: var(--td-accent)'));
    expect(css).toMatch(rule('.td-nm', 'fill: var(--td-ink)'));
    expect(css).toMatch(rule('.td-sb', 'fill: var(--td-ink-2)'));
  });

  it('keeps its border: after the build an added part stays dashed green', () => {
    expect(css).not.toMatch(new RegExp(`${DIM} \\.td-outline`));
  });
});

describe('aidlc-turbo Code Scaffold: what is chosen or hovered stays lit while a step is held', () => {
  // the style as the page carries it: every file of the drawing, comments out
  const css = req(path.join(FLOW, 'scripts/lib/design-assets.cjs')).designAssets().css.replace(/\/\*[\s\S]*?\*\//g, '');
  /** A selector list split at its own commas, not at those in :not() or :is(). */
  const split = (sel: string) => {
    const out = [''];
    let depth = 0;
    for (const c of sel) {
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ',' && !depth) out.push(''); else out[out.length - 1] += c;
    }
    return out.map((x) => x.trim());
  };
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) => split(m[1]).map((sel) => ({ sel, body: m[2] })));
  /** Every rule by which the step held fades something: a block or what sits on it, a line or its label. */
  const fades = rules.filter((r) => r.sel.includes('.td-trace') && /opacity: (0|0?\.\d+)\s*(;|$)/.test(r.body));
  const onBlocks = fades.filter((r) => r.sel.includes('.td-node'));

  it('the step fades no block chosen, nor its module chip', () => {
    expect(onBlocks.map((r) => r.sel)).toEqual(expect.arrayContaining([
      '.td-svg.td-trace .td-node:not(.td-hot, .td-sel, .td-lit)',
      '.td-svg.td-trace .td-node:not(.td-hot, .td-sel, .td-lit) + .td-mtag',
    ]));
    for (const r of onBlocks) expect(r.sel, r.sel).toMatch(/\.td-node:not\([^)]*\.td-sel\b[^)]*\)/);
  });

  it('the step fades nothing a hover lit: not the block, its neighbours, their chips, the lines between them', () => {
    expect(fades.map((r) => r.sel)).toEqual(expect.arrayContaining(['.td-svg.td-trace .td-edge:not(.td-hot, .td-lit)', '.td-svg.td-trace .td-elab:not(.td-hot, .td-lit)']));
    for (const r of fades) expect(r.sel, r.sel).toMatch(/\.td-(node|edge|elab):not\([^)]*\.td-lit\b[^)]*\)/);
    // a new part lit by the hover keeps its solid violet: the fade into its plate leaves it too
    const plate = rules.filter((r) => r.sel.includes('.td-trace .td-node') && r.sel.includes('.td-st-new'));
    expect(plate.length).toBe(5);
    for (const r of plate) expect(r.sel, r.sel).toContain('.td-trace .td-node:not(.td-hot, .td-lit)');
  });

  it('the rest keeps its fade: the other blocks and their chips at .35, the other lines at .12', () => {
    expect(css).toMatch(/\.td-svg\.td-trace \.td-node:not\(\.td-hot, \.td-sel, \.td-lit\) \{ opacity: \.35; \}/);
    expect(css).toMatch(/\.td-svg\.td-trace \.td-node:not\(\.td-hot, \.td-sel, \.td-lit\) \+ \.td-mtag \{ opacity: \.35; \}/);
    expect(css).toMatch(/\.td-svg\.td-trace \.td-edge:not\(\.td-hot, \.td-lit\), \.td-svg\.td-trace \.td-elab:not\(\.td-hot, \.td-lit\) \{ opacity: \.12; \}/);
  });
});
