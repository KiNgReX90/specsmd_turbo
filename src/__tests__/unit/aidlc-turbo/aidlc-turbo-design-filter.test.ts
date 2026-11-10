/**
 * Unit tests for the switch "Only new and changed" on the Code Scaffold
 * drawing (design-filter.js):
 * - a part counts as existing when its status is existing and the build did
 *   not mark it (built otherwise, added, not built); before the build its
 *   marks do not count;
 * - left out means laid out again without it: its lines go, a module, a
 *   frame or a lane left empty goes, a story keeps only what still shows,
 *   the steps are numbered again over what shows, the walk over the parts
 *   goes over the shown parts only, and the drawing gets smaller;
 * - nothing to leave out, or nothing left: the same model and no switch;
 * - the switch: on by default, a real switch for the keyboard and a screen
 *   reader, remembered per page where the browser allows it, and a flip draws
 *   the panel again with what showed (the story, what was chosen, the view,
 *   the switch Element | Step);
 * - wired into the panel and the full-screen view, inlined before the panel,
 *   styled from the theme's tokens, every file under 500 lines.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const read = (f: string) => { try { return readFileSync(path.join(DESIGN, f), 'utf8'); } catch { return ''; } };
// loaded per test, so a module that is not there yet fails each test on what it checks
const F = () => req(path.join(DESIGN, 'design-filter.js'));
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const { layout } = req(path.join(DESIGN, 'design-layout.js'));
const Browse = req(path.join(DESIGN, 'design-browse.js'));
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');

const fresh = () => dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
const model = fresh();
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const part = (m: any, id: string) => m.parts.find((p: { id: string }) => p.id === id);
// the parts of the order status drawing that exist and stay as they are
const EXISTING = ['api', 'card', 'orders', 'table', 'whact', 'whread'];
const SHOWN = ids(model.parts).filter((id: string) => !EXISTING.includes(id));
const LABEL = 'Only new and changed';

describe('aidlc-turbo Code Scaffold filter: what counts as existing', () => {
  it('leaves out the parts whose status is existing', () => {
    expect([...F().hidden(model, null)].sort()).toEqual(EXISTING);
  });

  it('after the build shows an existing part the build marked, never one built as planned', () => {
    const m = fresh();
    part(m, 'api').build = { state: 'different', story: '002' };
    part(m, 'card').build = { state: 'gone', story: '002' };
    part(m, 'table').build = { state: 'as_planned', story: '003' };
    const built = { stories: [], different: 1, extra: 0, gone: 1 };
    expect([...F().hidden(m, built)].sort()).toEqual(['orders', 'table', 'whact', 'whread']);
    // before the build (no build to show) the marks do not count
    expect([...F().hidden(m, null)].sort()).toEqual(EXISTING);
  });

  it('shows every new and changed part', () => {
    const off = F().hidden(model, null);
    for (const p of model.parts.filter((x: { status: string }) => x.status !== 'existing')) expect(off.has(p.id), p.id).toBe(false);
  });
});

describe('aidlc-turbo Code Scaffold filter: the drawing without them', () => {
  const less = () => F().only(model, null);

  it('keeps only the shown parts, and leaves the model it got whole', () => {
    expect(ids(less().parts)).toEqual(SHOWN);
    expect(model.parts).toHaveLength(20);
    expect(model.links).toHaveLength(19);
  });

  it('a line with an end left out goes too', () => {
    expect(ids(less().links).sort()).toEqual(['ctrl-uc', 'gw-iface', 'host-page', 'menu-host', 'page-chart', 'page-kpi',
      'page-svc', 'prov-iface', 'routes-ctrl', 'trend-events', 'uc-gw', 'uc-trend']);
  });

  it('a module, a frame or a lane left empty goes too', () => {
    const m = less();
    expect(ids(m.modules)).toEqual(['shop', 'ui', 'setm', 'ad', 'core']);
    expect(ids(m.frames)).toEqual(['shop@screen', 'shop@server', 'ui', 'setm', 'ad', 'core']);
    expect(m.frames.find((f: { id: string }) => f.id === 'ui').parts).toEqual(['chart', 'page', 'kpi', 'svc']);
    expect(ids(m.lanes)).toEqual(['screen', 'server', 'database']);
  });

  it('a module without parts of its own was never drawn: it stays', () => {
    const m = fresh();
    m.modules.push({ id: 'los', name: 'Los', status: 'new' });
    expect(ids(F().only(m, null).modules)).toContain('los');
  });

  it('a story keeps only what still shows', () => {
    const m = fresh();
    m.stories[1].builds.api = 'touches the api';
    const s = F().only(m, null).stories.find((x: { id: string }) => x.id === '002');
    expect(s.parts.filter((id: string) => EXISTING.includes(id))).toEqual([]);
    expect(s.uses).toEqual(['gw']);
    expect(Object.keys(s.builds)).not.toContain('api');
    expect(Object.keys(s.builds)).toContain('ui');
    expect(s.links).toEqual(['menu-host', 'host-page', 'page-svc', 'page-chart', 'page-kpi', 'ctrl-uc', 'uc-gw', 'uc-trend', 'trend-events']);
    expect(s.modules).toEqual(['ui', 'shop']);
    expect(s.n).toBe('2');
  });

  it('keeps the rest of the model: its summary and the build', () => {
    const m = { ...fresh(), build: { stories: [], different: 0, extra: 0, gone: 0 } };
    const out = F().only(m, m.build);
    expect(out.build).toBe(m.build);
    expect(out.summary).toBe(m.summary);
  });

  it('lays out again: the steps numbered over what shows, the drawing smaller', () => {
    const all = layout(model);
    const geo = layout(less());
    expect(geo.blocks).toHaveLength(SHOWN.length);
    expect(geo.flow.order).toHaveLength(11);
    const steps = geo.links.map((l: { step: number | null }) => l.step).filter(Boolean).sort((a: number, b: number) => a - b);
    expect(steps).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
    expect(geo.width * geo.height).toBeLessThan(all.width * all.height);
  });

  it('the walk over the parts goes over the shown parts only', () => {
    expect(Browse.order(layout(less())).sort()).toEqual([...SHOWN].sort());
  });

  it('nothing to leave out, or nothing left: the same model', () => {
    const none = fresh();
    for (const p of none.parts) p.status = 'new';
    expect(F().only(none, null)).toBe(none);
    const all = fresh();
    for (const p of all.parts) p.status = 'existing';
    expect(F().only(all, null)).toBe(all);
  });
});

describe('aidlc-turbo Code Scaffold filter: the switch', () => {
  let store: Map<string, string>;
  let d: ReturnType<typeof fakeDom>;
  const KEY = 'td-only-new:/intent/overview.html';

  beforeEach(() => {
    d = fakeDom();
    store = new Map();
    (globalThis as any).localStorage = { getItem: (k: string) => (store.has(k) ? store.get(k) : null), setItem: (k: string, v: string) => { store.set(k, String(v)); } };
    (globalThis as any).location = { pathname: '/intent/overview.html', hash: '' };
  });
  afterEach(() => {
    delete (globalThis as any).localStorage;
    delete (globalThis as any).location;
  });

  /** Mount through the switch with a panel that only notes what it was asked to draw. */
  function mount(m: any = model, opts: Record<string, unknown> = { phase: 'inception' }) {
    const calls: { m: any; o: any }[] = [];
    const chosen: (string | null)[] = [];
    const paint = (_c: unknown, mm: any, o: any) => {
      calls.push({ m: mm, o });
      const n = calls.length;
      return { geo: { n }, follow() {}, choose: (id: string | null) => chosen.push(`${n}:${id}`), snap: () => ({ story: '002', sel: { kind: 'part', id: 'uc' }, view: null, n }) };
    };
    const api = F().mount(d.node('div'), m, opts, paint);
    return { calls, api, chosen, sw: calls[0].o.filter };
  }

  it('is on by default: the panel draws only what is new or changed, with the switch among its controls', () => {
    const { calls, sw } = mount();
    expect(calls).toHaveLength(1);
    expect(ids(calls[0].m.parts)).toEqual(SHOWN);
    expect(calls[0].o.phase).toBe('inception');
    expect(calls[0].o.start).toBeNull();
    expect(sw.tag).toBe('button');
    expect(sw.type).toBe('button');
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    // its name in full; the short word shows only where the row is tight (aidlc-turbo-design-polish.test.ts)
    expect(sw.getAttribute('aria-label')).toBe(LABEL);
    expect(sw.textContent).toBe(LABEL + 'Changes');
    expect(sw.title).toBe(`${LABEL}: on. Also show the 6 parts that already exist and do not change`);
  });

  it('a flip draws everything again, keeps what showed, and is remembered for this page', () => {
    const { calls, sw, api } = mount();
    sw.click();
    expect(calls).toHaveLength(2);
    expect(calls[1].m).toBe(model);
    expect(calls[1].o.filter).toBe(sw);
    expect(calls[1].o.start).toEqual({ story: '002', sel: { kind: 'part', id: 'uc' }, view: null, n: 1 });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.title).toBe(`${LABEL}: off. Leave out the 6 parts that already exist and do not change`);
    expect(store.get(KEY)).toBe('0');
    // the keyboard stays on the switch
    expect(d.doc.activeElement).toBe(sw);
    sw.click();
    expect(ids(calls[2].m.parts)).toEqual(SHOWN);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(store.get(KEY)).toBe('1');
    // the page keeps talking to the panel drawn last
    expect(api.geo.n).toBe(3);
  });

  it('the page talks to the panel drawn last', () => {
    const { sw, api, chosen } = mount();
    api.choose('001');
    sw.click();
    api.choose(null);
    expect(chosen).toEqual(['1:001', '2:null']);
  });

  it('starts off where the viewer turned it off on this page', () => {
    store.set(KEY, '0');
    const { calls, sw } = mount();
    expect(calls[0].m).toBe(model);
    expect(sw.getAttribute('aria-checked')).toBe('false');
  });

  it('works without storage: on, and a flip still flips', () => {
    (globalThis as any).localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const { calls, sw } = mount();
    expect(ids(calls[0].m.parts)).toEqual(SHOWN);
    sw.click();
    expect(calls[1].m).toBe(model);
  });

  it('nothing to leave out: the panel as it was, without a switch', () => {
    const none = fresh();
    for (const p of none.parts) p.status = 'changed';
    const { calls } = mount(none);
    expect(calls).toHaveLength(1);
    expect(calls[0].m).toBe(none);
    expect(calls[0].o.filter).toBeUndefined();
  });

  it('after the build counts the build\'s marks, before it not', () => {
    const m = { ...fresh(), build: { stories: [], different: 1, extra: 0, gone: 0 } };
    part(m, 'api').build = { state: 'different', story: '002' };
    expect(ids(mount(m, { phase: 'construction' }).calls[0].m.parts)).toContain('api');
    expect(ids(mount(m, { phase: 'inception' }).calls[0].m.parts)).not.toContain('api');
  });
});

describe('aidlc-turbo Code Scaffold filter: wired into the page', () => {
  const PANEL = read('design-panel.js');
  const VIEW = read('design-view.js');
  const CSS = read('design-filter.css');

  it('the panel mounts through the switch and puts it with the walk over the drawing', () => {
    expect(PANEL).toMatch(/root\.TdFilter \? root\.TdFilter\.mount\(container, model, o, paint\) : paint\(container, model, o\)/);
    // beside the walk over the steps (and after the build "Full screen"), else with the way to full screen
    expect(PANEL).toMatch(/if \(o\.filter\) left\.append\(o\.filter\);/);
    expect(PANEL).toMatch(/if \(o\.filter && !ctl\) tools\.prepend\(o\.filter\);/);
  });

  it('a redraw shows what showed: the story, what was chosen, the step held, the zoom on the page and the full-screen view handed over', () => {
    expect(PANEL).toMatch(/const snap = \(\) => \{ hold\(\); return \{ story: story && story\.id, sel: ch\.get\(\), at: steps && steps\.current\(\), zoom: zoom && zoom\.state\(\), view: view\.isOpen\(\) \? view\.close\(true\) : null \}; \};/);
    expect(PANEL).toMatch(/if \(o\.start && o\.start\.zoom\) zoom\.restore\(o\.start\.zoom\);/);
    expect(PANEL).toMatch(/if \(st\.at && steps && !steps\.current\(\) && steps\.ids\(\)\.includes\(st\.at\)\) steps\.pin\(st\.at\);/);
    expect(PANEL).toMatch(/if \(!st\) follow\(location\.hash \|\| ''\);/);
    expect(PANEL).toMatch(/choose\(st\.story\);/);
    expect(PANEL).toMatch(/if \(st && st\.view\) openView\(null, st\.view\);/);
    // what is no longer there gives way to step 1, after what came back
    expect(PANEL).toMatch(/steps\.pin\(st\.at\);\s*\}\s*ch\.ensure\(\);/);
    expect(PANEL).toMatch(/return \{ follow, geo, choose, snap \};/);
  });

  it('the view hands its overlay and the browser\'s full screen over, instead of leaving them', () => {
    expect(VIEW).toMatch(/function close\(keep\) \{/);
    expect(VIEW).toMatch(/if \(!keep && document\.fullscreenElement === f\.ov/);
    expect(VIEW).toMatch(/if \(keep\) return \{ ov: f\.ov, full: f\.full, back: f\.back, x: f\.x, y: f\.y, side: sideOpen \};/);
    expect(VIEW).toMatch(/function open\(at, keep\) \{/);
    expect(VIEW).toMatch(/if \(!keep\) document\.body\.append\(ov\);/);
    expect(VIEW).toMatch(/if \(!touch && !keep\) try \{/);
  });

  it('is inlined after the kit and before the panel, its style before the Maquette look', () => {
    const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
    const js = (f: string) => assets.DESIGN_JS.indexOf(f);
    const css = (f: string) => assets.DESIGN_CSS.indexOf(f);
    expect(js('design-filter.js')).toBeGreaterThan(js('design-kit.js'));
    expect(js('design-filter.js')).toBeLessThan(js('design-panel.js'));
    expect(css('design-filter.css')).toBeGreaterThan(css('design-steps.css'));
    expect(css('design-filter.css')).toBeLessThan(css('maquette.css'));
  });

  it('the switch reads in light and dark, takes a finger, shows the keyboard focus and moves only for who wants motion', () => {
    // colours only from the tokens that switch with the theme
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
    expect(CSS).toMatch(/\.td-only \{[^}]*pointer-events: auto;/);
    expect(CSS).toMatch(/\.td-root\.td-touch \.td-only \{[^}]*min-height: (4[4-9]|5\d)px;/);
    expect(CSS).toMatch(/\.td-only:focus-visible \{[^}]*outline:/);
    expect(CSS).toMatch(/\.td-only\[aria-checked="true"\] \.td-only-k/);
    const move = CSS.indexOf('transition:');
    expect(move).toBeGreaterThan(CSS.indexOf('@media (prefers-reduced-motion: no-preference)'));
  });

  it('keeps every file it touches under 500 lines', () => {
    for (const f of ['design-filter.js', 'design-panel.js', 'design-view.js']) {
      const n = read(f).split('\n').length;
      expect(n, f).toBeGreaterThan(1);
      expect(n, f).toBeLessThanOrEqual(500);
    }
  });
});
