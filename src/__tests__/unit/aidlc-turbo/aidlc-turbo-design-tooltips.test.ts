/**
 * Unit tests for the tooltips and the names of the controls on the Code Scaffold:
 * - the status words follow the phase: before the build they say the plan ("Is changed",
 *   "Exists, is used", "New"), after it what happened ("Was changed", "Existed, was used",
 *   "Built new"), from one lookup, on the part's mark, in the legend and the details;
 *   a part the build left out says what was planned;
 * - the marks of the build use the words of the legend: "Not built", "Not used";
 * - the switch "Element | Step" says what the arrows (and Space) walk, and that each holds until the other is chosen;
 * - the walk under a part's details and the keys over the drawing speak of elements;
 * - an icon-only button carries its tooltip as its name; the keys are named one way: (space), (left arrow), (Esc);
 * - no tooltip or name still speaks of the removed step list or the removed table.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';
const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const EN = req(path.join(FLOW, 'templates/lang/en.json'));
const read = (f: string) => readFileSync(path.join(DESIGN, f), 'utf8');
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');
const fresh = () => dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));

/** A script of the page, run again in this test's fake document. */
function load(f: string) {
  const file = path.join(DESIGN, f);
  delete req.cache[file];
  return req(file);
}
const G = globalThis as any;
let d: ReturnType<typeof fakeDom>;
/** A node the drawing code can draw into and measure (7 px a character, 14 px text). */
const drawable = (n: any) => Object.assign(n, {
  appendChild: (c: any) => { n.append(c); return c; }, style: {}, after: () => {},
  getComputedTextLength: () => String(n.textContent || '').length * 7,
});
beforeEach(() => {
  d = fakeDom();
  d.doc.createElementNS = (_ns: string, tag: string) => drawable(d.node(tag));
  G.getComputedStyle = () => ({ fontSize: '14px' });
  G.TdKit = load('design-kit.js');
  G.TdBuild = load('design-built.js');
  delete G.localStorage;
});
const text = (e: any) => (e ? e.textContent : null);
/** Every <title> drawn under n, as text. */
const titles = (n: any): string[] => (n.children || []).flatMap((c: any) => (c && c.tag === 'title' ? [text(c)] : c && c.children ? titles(c) : []));

describe('aidlc-turbo Code Scaffold: the status words follow the phase', () => {
  it('one lookup: the plan before the build, what happened after it', () => {
    const E = load('design-engine.js');
    const plan = (status: string) => E.statusOf({ status }, false);
    const done = (status: string, state = 'as_planned') => E.statusOf({ status, build: { state } }, true);
    expect([plan('new'), plan('existing'), plan('changed')]).toEqual(['New', 'Exists, is used', 'Is changed']);
    expect([done('new'), done('existing'), done('changed')]).toEqual(['Built new', 'Existed, was used', 'Was changed']);
    // a part the build did not check, or built otherwise, still went through the build
    expect(E.statusOf({ status: 'changed' }, true)).toBe('Was changed');
    expect(done('changed', 'different')).toBe('Was changed');
    // a part the build left out: what it is, never that it was built or used (its mark says not built, not used)
    expect([done('new', 'gone'), done('existing', 'gone'), done('changed', 'gone')]).toEqual(['New', 'Exists', 'Would be changed']);
    // a module the same way
    const mod = (status: string, built: boolean) => E.statusOf({ status, build: built ? { state: 'as_planned' } : undefined }, built, true);
    expect([mod('changed', false), mod('existing', false), mod('new', false)]).toEqual(['Exists, is changed', 'Exists, is used', 'New module']);
    expect([mod('changed', true), mod('existing', true), mod('new', true)]).toEqual(['Existed, was changed', 'Existed, was used', 'Built new']);
  });

  it('a changed part: "Is changed" on its mark before the build, "Was changed" after it', () => {
    G.TdLabels = load('design-labels.js');
    const { layout, SIZE } = load('design-layout.js');
    const E = load('design-engine.js');
    const mark = (built: boolean) => {
      const m = fresh();
      const p = m.parts.find((x: any) => x.status === 'changed');
      if (built) p.build = { state: 'as_planned' };
      const host = drawable(d.node('div'));
      const geo = { ...layout(m), tags: [] }; // the module tags measure their neighbours, which this document cannot
      const drawn = E.draw(host, m, geo, SIZE, { built });
      const n = drawn.nodes.find((x: any) => x.p.id === p.id);
      return { titles: titles(n.g), label: n.g.getAttribute('aria-label') };
    };
    const before = mark(false), after = mark(true);
    // an existing part drawn to be used and not used: no plan word beside its mark
    const m = fresh();
    const q = m.parts.find((x: any) => x.status === 'existing');
    q.build = { state: 'gone' };
    const drawn = E.draw(drawable(d.node('div')), m, { ...layout(m), tags: [] }, SIZE, { built: true });
    const n = drawn.nodes.find((x: any) => x.p.id === q.id);
    // after the build a block says no certainty: the page has none to explain
    expect(n.g.getAttribute('aria-label')).toBe(`${q.name}, ${E.kindOf(q.kind)}, exists, not used`);
    expect(titles(n.g)).toEqual(expect.arrayContaining(['Exists', 'Not used']));
    expect(before.titles).toContain('Is changed');
    expect(before.label).toMatch(/, is changed,/);
    expect(after.titles).toContain('Was changed');
    expect(after.titles).not.toContain('Is changed');
    expect(after.label).toMatch(/, was changed$/);
  });

  it('the legend: the plan before the build, what happened after it', () => {
    G.TdEngine = load('design-engine.js');
    load('design-keys.js');
    const m = fresh();
    const before = G.TdKeys.legend(m, false, false).innerHTML;
    const after = G.TdKeys.legend(m, true, false).innerHTML;
    for (const w of ['New', 'Exists, is used', 'Is changed']) expect(before).toContain(`>${w}<`);
    for (const w of ['Built new', 'Existed, was used', 'Was changed']) expect(after).toContain(`>${w}<`);
    expect(after).not.toContain('Is changed');
    // the approval leaves no choice open: after the build the legend does not name one
    expect(before).toContain('Choice open');
    expect(after).not.toContain('Choice open');
  });

  it('the details: the pill in the tense of the phase, no module row', () => {
    G.TdEngine = load('design-engine.js');
    load('design-detail.js');
    const mod = { id: 'core', name: 'shop-core', status: 'changed' };
    const p = { id: 'p', name: 'Parser', status: 'changed', module: 'core' };
    const pills = (head: any) => d.all(head, 'td-pill').map(text);
    const make = (built: any) => G.TdDetail.create({ parts: [p], modules: [mod], stories: [], links: [] }, { built, titleOf: (s: any) => s.title, order: [] });
    const [h0, dl0] = make(null).part(p);
    expect(pills(h0)).toEqual(['Is changed']);
    expect(text(dl0) || '').not.toContain('shop-core, exists');
    const [h1, dl1] = make({ stories: [] }).part(p);
    expect(pills(h1)).toEqual(['Was changed']);
    expect(dl1).toBeNull();
    expect(pills(make({ stories: [] }).mod(mod)[0])).toEqual(['Existed, was changed']);
  });

  it('the details: what a story will build on the plan page; after the build no rows', () => {
    G.TdEngine = load('design-engine.js');
    load('design-detail.js');
    const mod = { id: 'core', name: 'shop-core', status: 'changed' };
    const p = { id: 'p', name: 'Parser', status: 'changed', module: 'core' };
    const q = { id: 'q', name: 'Store', status: 'existing' };
    const m = { parts: [p, q], modules: [mod], stories: [{ id: 's1', n: 1, title: 'First', parts: ['p'], links: [], builds: { p: 'the parser', core: 'the module' } }],
      links: [{ id: 'l', from: 'p', to: 'q', adds: 'a new method' }] };
    const make = (built: any) => G.TdDetail.create(m, { built, titleOf: (s: any) => s.title, order: [] });
    const txt = (x: any) => text(x[1]);
    const plan = txt(make(null).part(p));
    expect(plan).toContain('Built in');
    // no row per arrow any more: the drawing shows the call
    expect(plan).not.toContain('a new method');
    expect(make({ stories: [] }).part(p)[1]).toBeNull();
    expect(txt(make(null).mod(mod))).toContain('Built in');
    expect(make({ stories: [] }).mod(mod)[1]).toBeNull();
  });

  it('the marks of the build use the words of the legend', () => {
    const E = load('design-engine.js');
    expect(E.buildTitle({ status: 'new', build: { state: 'gone' } })).toBe('Not built');
    expect(E.buildTitle({ status: 'existing', build: { state: 'gone' } })).toBe('Not used');
    expect(E.buildTitle({ status: 'new', build: { state: 'added' } })).toBe('Added during the build');
    // in the legend the mark stands beside its words: no tooltip of its own
    expect(titles(E.buildIcon(drawable(d.node('svg')), 0, 0, 'gone', ''))).toEqual([]);
    expect(read('design-keys.js')).toMatch(/E\(\)\.buildIcon\(sv, 0, 0, sv\.dataset\.s, ''\)/);
  });
});

describe('aidlc-turbo Code Scaffold: the texts around the drawing in the tense of the phase', () => {
  it('the switch: "that already exist and do not change" before the build, "that already existed and did not change" after it', () => {
    const F = load('design-filter.js');
    const m = fresh();
    const sw = (phase: string, build?: any) => {
      let got: any = null;
      F.mount(d.node('div'), build ? { ...m, build } : m, { phase }, (_c: any, _m: any, o: any) => { got = o.filter; return { snap: () => null }; });
      return got;
    };
    const plan = sw('inception'), done = sw('construction', { stories: [] });
    expect(plan.title).toMatch(/^Only new and changed: on\. Also show the \d+ parts that already exist and do not change$/);
    expect(done.title).toMatch(/^Only new and changed: on\. Also show the \d+ parts that already existed and did not change$/);
    done.click();
    expect(done.title).toMatch(/^Only new and changed: off\. Leave out the \d+ parts that already existed and did not change$/);
  });

  it('how to use the drawing: what a story builds before the build, what it built after it', () => {
    const panel = read('design-panel.js');
    expect(panel).toMatch(/t\(built \? 'chooseBuilt' : 'choose'\)/);
    expect(EN.design.panel.choose).toBe('Choose a story to see what it builds.');
    expect(EN.design.panel.chooseBuilt).toBe('Choose a story to see what it built.');
  });
});

describe('aidlc-turbo Code Scaffold: no switch Flow | Review in the drawing any more', () => {
  it('the drawing always follows the flow: no switch, no file of its own', () => {
    expect(() => read('design-mode.js')).toThrow();
  });
});

describe('aidlc-turbo Code Scaffold: the controls name what they do and their key', () => {
  it('the walk over the steps: a verb first, the key in one form', () => {
    load('design-steps.js');
    const m = fresh();
    G.TdLabels = load('design-labels.js');
    const geo = load('design-layout.js').layout(m);
    const steps = G.TdSteps.create(m, geo, d.node('svg'), [], []);
    const [prev, , next] = steps.nav.children;
    expect(prev.title).toBe('Go to the previous step (left arrow)');
    expect(next.title).toBe('Go to the next step (right arrow)');
    expect(prev.getAttribute('aria-label')).toBe(prev.title);
  });

  it('play and pause say what they do, with (space)', () => {
    const play = read('design-play.js');
    expect(play).toContain("b.title = t(on ? 'pauseTip' : 'playTip');");
    expect(EN.design.play.pauseTip).toBe('Pause playing (space)');
    expect(EN.design.play.playTip).toBe('Play the steps, one by one (space)');
  });

  it('the zoom of the full-screen view names its keys; the details have no close button to name', () => {
    const view = read('design-view.js');
    expect(view).toContain("c.btn('td-zb', 'minus', null, tv('zoomOut'))");
    expect(view).toContain("c.btn('td-zb', 'plus', null, tv('zoomIn'))");
    expect(view).toContain("tv('fitTip')");
    expect([EN.design.view.zoomOut, EN.design.view.zoomIn, EN.design.view.fitTip]).toEqual(['Zoom out (-)', 'Zoom in (+)', 'Show the whole drawing (0)']);
    expect(JSON.stringify(EN.design)).not.toContain('Close the details');
  });

  it('the bar over the drawing is named for all it holds, not for playing only', () => {
    expect(read('design-panel.js')).toContain("ctl.setAttribute('aria-label', t('controls'))");
    expect(EN.design.panel.controls).toBe('Controls of the drawing');
  });
});

describe('aidlc-turbo Code Scaffold: no tooltip speaks of what is gone', () => {
  const GONE = [/built otherwise/i, /\bSteps\b/, /step list/i, /Deviations during the build/i];
  // a line that sets a tooltip or a name: title, <title>, aria-label, or a button made with one
  const TIP = /(\.title\s*=|['"]title['"]|\btitle=|<title>|aria-label|\bbtn\(|\bK\.btn\(|\bc\.btn\()/;
  const files = readdirSync(DESIGN).filter((f) => f.endsWith('.js'));

  it('none in the design files', () => {
    const hits: string[] = [];
    const scan = (name: string, src: string) => src.split('\n').forEach((line, i) => {
      if (/^\s*(\*|\/\/|\/\*)/.test(line) || !TIP.test(line)) return;
      for (const b of GONE) if (b.test(line)) hits.push(`${name}:${i + 1}: ${line.trim()}`);
    });
    for (const f of files) scan(f, read(f));
    expect(hits).toEqual([]);
  });

  it('none on the controls as they are made', () => {
    const seen: string[] = [];
    const collect = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (n.title) seen.push(n.title);
      if (n.attrs && n.attrs['aria-label']) seen.push(n.attrs['aria-label']);
      for (const c of n.children || []) collect(c);
    };
    load('design-steps.js');
    const model = fresh();
    G.TdLabels = load('design-labels.js');
    const geo = load('design-layout.js').layout(model);
    const steps = G.TdSteps.create(model, geo, d.node('svg'), [], []);
    collect(steps.box);
    collect(steps.nav);
    collect(steps.keys);
    expect(seen.length).toBeGreaterThan(5);
    for (const s of seen) for (const b of GONE) expect(s).not.toMatch(b);
  });
});
