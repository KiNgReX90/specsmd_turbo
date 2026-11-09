/**
 * Unit tests for the Code Scaffold flow view that always has something chosen:
 * - a step is always held: step 1 when the page opens (before and after the build, never a "first changed
 *   file"), taken without the focus and without a move of the page; Escape, a click on the empty drawing,
 *   walking past an end and play never leave it empty; a story chosen holds its first step when it lacks the
 *   one held; a drawing made again keeps the step held, else holds step 1;
 * - a block clicked is chosen (lit) with the step into it held; a second click, Escape and the empty drawing
 *   keep it; a line clicked and the walk over the steps let go of the block and show where the step goes;
 * - a drawing without steps keeps a block chosen instead: the first of the walk;
 * - the calm word of the panel, a close button of the details and "Choose a step" are gone; a calm word is
 *   left only where nothing can be chosen (a story without steps).
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
const read = (f: string) => readFileSync(path.join(DESIGN, f), 'utf8');
/** Every text of the drawing in the string table, as one string. */
const TABLE = JSON.stringify(req(path.join(FLOW, 'templates/lang/en.json')).design);
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const { layout } = req(path.join(DESIGN, 'design-layout.js'));
const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const fresh = () => dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
const model = fresh();
const geo = layout(model);
const ORDER: string[] = geo.flow.order;
const READ: string[] = load('design-browse.js').order(geo).filter((id: string) => model.parts.some((p: any) => p.id === id));

let d: ReturnType<typeof fakeDom>;
beforeEach(() => {
  d = fakeDom();
  dress(d);
});
const text = (e: any) => (e ? e.textContent : null);
const first = (e: any, cls: string) => (e ? d.all(e, cls)[0] || null : null);
const link = (id: string) => model.links.find((l: any) => l.id === id);
const nameOf = (id: string) => model.parts.find((p: any) => p.id === id).name;
/** The name in the details shown: the h3 of the head. */
const named = (p: any) => {
  const head = first(p.shown(), 'td-dhead');
  return text(head && head.children.find((c: any) => c && c.tag === 'h3'));
};
const sel = (p: any) => READ.filter((id) => p.chosen(id));
const walkN = (p: any) => text(first(first(p.shown(), 'td-walk'), 'td-walkn'));
const at = (p: any) => text(first(p.root, 'td-steps-at'));

/** The model after the build, every part as planned, with a change in the code for the files of `diffs`. */
function built(diffs: string[]) {
  const m = fresh();
  for (const x of [...m.parts, ...m.modules]) x.build = { state: 'as_planned' };
  m.build = { stories: [], different: 0, extra: 0, gone: 0, diffs: {} };
  for (const id of diffs) {
    const p = m.parts.find((x: any) => x.id === id);
    m.build.diffs[p.path] = { text: '@@ -1,1 +1,1 @@\n-a\n+b\n', added: 1, removed: 1 };
  }
  return m;
}

describe('aidlc-turbo Code Scaffold: a step is always held', () => {
  it('step 1 when the page opens, after the build too: no block chosen, its part in the details, the step in the box', () => {
    const m = built(['trend', 'ctrl']);
    const p = mountPanel(d, m, layout(m), { phase: 'construction' });
    expect(p.steps.current()).toBe(ORDER[0]);
    expect(sel(p)).toEqual([]);
    expect(p.detail.hidden).toBe(false);
    expect(named(p)).toBe(nameOf(link(ORDER[0]).to));
    expect(walkN(p)).toBe(`Step 1 of ${ORDER.length}`);
    expect(p.box().hidden).toBe(false);
  });

  it('it takes no focus and never moves the page', () => {
    const p = mountPanel(d, model, geo);
    expect(d.doc.activeElement).toBeNull();
    expect(p.detail.scrolled).toBeUndefined();
  });

  it('Escape and a click on the empty drawing keep the step', () => {
    const p = mountPanel(d, model, geo);
    d.key('ArrowRight');
    const held = p.steps.current();
    d.key('Escape');
    p.blank();
    expect(p.steps.current()).toBe(held);
    expect(p.detail.hidden).toBe(false);
  });

  it('walking past either end keeps the first or the last step', () => {
    const p = mountPanel(d, model, geo);
    d.key('ArrowLeft');
    expect(p.steps.current()).toBe(p.steps.ids()[0]);
    for (let i = 0; i < ORDER.length + 2; i += 1) d.key('ArrowRight');
    expect(p.steps.current()).toBe(ORDER[ORDER.length - 1]);
  });

  it('play from the last step starts again at step 1 without a moment of nothing held', () => {
    const p = mountPanel(d, model, geo);
    for (let i = 0; i < ORDER.length; i += 1) d.key('ArrowRight');
    const pins: any[] = [];
    const pin = p.steps.pin;
    p.steps.pin = (id: any) => { pins.push(id); return pin(id); };
    p.play();
    expect(p.steps.current()).toBe(ORDER[0]);
    expect(pins).not.toContain(null);
    p.play();
    expect(p.steps.current()).toBe(ORDER[0]);
  });

  it('a story chosen that lacks the step held: its first step held', () => {
    const p = mountPanel(d, model, geo);
    const s1 = model.stories.find((s: any) => s.id === '001');
    expect(s1.links).not.toContain(p.steps.current());
    p.api.choose('001');
    expect(p.steps.current()).toBe(p.steps.ids()[0]);
    expect(s1.links).toContain(p.steps.current());
  });

  it('a drawing made again keeps the step held, else holds step 1', () => {
    const kept = mountPanel(d, model, geo, { start: { story: null, sel: null, at: ORDER[3] } });
    expect(kept.steps.current()).toBe(ORDER[3]);
    d = fakeDom();
    dress(d);
    const lost = mountPanel(d, model, geo, { start: { story: null, sel: null, at: 'weg' } });
    expect(lost.steps.current()).toBe(ORDER[0]);
  });

  it('a drawing made again without the block chosen holds a step and chooses no other block; a block still there stays', () => {
    const m = built(['trend']);
    const gone = mountPanel(d, m, layout(m), { phase: 'construction', start: { story: null, sel: { kind: 'part', id: 'weg' }, at: null } });
    expect(sel(gone)).toEqual([]);
    expect(gone.steps.current()).toBe(ORDER[0]);
    d = fakeDom();
    dress(d);
    const kept = mountPanel(d, m, layout(m), { phase: 'construction', start: { story: null, sel: { kind: 'part', id: 'ctrl' }, at: null } });
    expect(sel(kept)).toEqual(['ctrl']);
  });

  it('a story without steps: the one calm word left, nothing else to choose', () => {
    const m = fresh();
    m.stories.push({ ...m.stories[0], id: '009', n: '9', links: [], parts: ['menu'], builds: {} });
    const p = mountPanel(d, m, layout(m));
    p.api.choose('009');
    d.observe();
    expect(p.detail.hidden).toBe(true);
    expect(text(first(p.pane, 'td-dpane-empty-t'))).toBe('This story has no steps.');
    expect(at(p)).toBe('No steps');
  });
});

describe('aidlc-turbo Code Scaffold: a block clicked is chosen', () => {
  it('lit, its details shown, the step into it held, its step in the box', () => {
    const p = mountPanel(d, model, geo);
    p.node('trend').click();
    expect(sel(p)).toEqual(['trend']);
    expect(link(p.steps.current()).to).toBe('trend');
    expect(named(p)).toBe(nameOf('trend'));
    expect(text(first(p.box(), 'td-sbox-n'))).toMatch(/^Step \d+\b/);
    expect(walkN(p)).toBe(`${READ.indexOf('trend') + 1} of ${READ.length}`);
  });

  it('Escape, a click on the empty drawing and a click on the block again keep it', () => {
    const p = mountPanel(d, model, geo);
    p.node('trend').click();
    d.key('Escape');
    expect(sel(p)).toEqual(['trend']);
    p.blank();
    expect(sel(p)).toEqual(['trend']);
    p.node('trend').click();
    expect(sel(p)).toEqual(['trend']);
    expect(named(p)).toBe(nameOf('trend'));
  });

  it('a line clicked lets go of it: its step held, the part it goes to in the details', () => {
    const p = mountPanel(d, model, geo);
    p.node('ctrl').click();
    p.line(ORDER[1]);
    expect(sel(p)).toEqual([]);
    expect(p.steps.current()).toBe(ORDER[1]);
    expect(named(p)).toBe(nameOf(link(ORDER[1]).to));
    expect(walkN(p)).toBe(`Step 2 of ${ORDER.length}`);
  });

  it('the walk over the drawing and play let go of it too', () => {
    const p = mountPanel(d, model, geo);
    p.node('trend').click();
    first(p.root, 'td-steps-next').click();
    expect(sel(p)).toEqual([]);
    p.node('trend').click();
    p.play();
    expect(sel(p)).toEqual([]);
    expect(named(p)).toBe(nameOf(link(p.steps.current()).to));
    p.play();
  });
});

describe('aidlc-turbo Code Scaffold: a drawing without steps keeps a block chosen', () => {
  it('the first block of the walk from the start; the arrows walk the blocks', () => {
    const m = fresh();
    m.links = [];
    for (const s of m.stories) s.links = [];
    const g = layout(m);
    const order = load('design-browse.js').order(g).filter((id: string) => m.parts.some((x: any) => x.id === id));
    const p = mountPanel(d, m, g);
    expect(p.steps).toBeFalsy();
    expect(sel(p)).toEqual([order[0]]);
    d.key('ArrowRight');
    expect(sel(p)).toEqual([order[1]]);
  });
});

describe('aidlc-turbo Code Scaffold: nothing left that lets go', () => {
  it('no calm word on the panel once the page has opened', () => {
    const p = mountPanel(d, model, geo);
    d.observe();
    expect(p.pane.classList.contains('td-dpane-none')).toBe(false);
    expect(p.detail.hidden).toBe(false);
  });

  it('the details have no close button and no full screen of their own', () => {
    const p = mountPanel(d, model, geo);
    for (const gone of ['td-dx', 'td-dtools', 'td-dfb']) expect(d.all(p.detail, gone), gone).toEqual([]);
    expect(TABLE).not.toContain('Close the details');
  });

  it('no "Choose a step" and no calm word to choose a block or a step', () => {
    for (const gone of ['Choose a step', 'Choose a block in the drawing', 'Play the steps or choose a step']) expect(TABLE, gone).not.toContain(gone);
  });

  it('nothing lets go of the block: no toggle on a second click, Escape only closes the view', () => {
    expect(read('design-panel.js')).not.toMatch(/selected\.id === id\) \{ clearSel\(\); return; \}/);
    expect(read('design-input.js')).toMatch(/if \(ev\.key !== 'Escape' \|\| ev\.defaultPrevented\) return;\s*if \(view\.isOpen\(\)\) view\.close\(\);/);
  });

  it('the page inlines what is chosen before the panel; its files stay under 500 lines', () => {
    const js = (f: string) => assets.DESIGN_JS.indexOf(f);
    expect(js('design-chosen.js')).toBeGreaterThan(-1);
    expect(js('design-chosen.js')).toBeLessThan(js('design-panel.js'));
    for (const f of ['design-chosen.js', 'design-panel.js', 'design-show.js', 'design-browse.js', 'design-input.js']) expect(read(f).split('\n').length, f).toBeLessThanOrEqual(500);
  });
});
