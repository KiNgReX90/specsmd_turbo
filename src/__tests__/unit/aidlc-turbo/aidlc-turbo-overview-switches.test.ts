/**
 * Unit tests for the switches Details and ? on the overview's masthead (templates/design/design-switches.js, on
 * the page of templates/overview):
 * - a fresh page: Details on, ? off; both remembered per viewer (localStorage c4-details, c4-help) and both
 *   working when the storage throws;
 * - Details off hides only the plain texts (html.plain-off, class plain): the intent's under the masthead
 *   summary (which stays, with Read more), each story's under its title in the slices and in the Code panel;
 *   the data carries them (page.intent.plain, page.stories[].plain) only when the record has them;
 * - ? on shows the page's own explanations (html.help-on, class how): the intros, the legends, the keys along
 *   the drawing, the note on the Code Scaffold; and the help of the tab shown hangs under the ?, in that tab's
 *   words from the string table; a tab chosen redraws it, Escape or a click outside closes it;
 * - a change goes to every frame of the v5 tab as { type: 'turbo-switches', details, help };
 * - a page without a drawing carries the tabs too, so it shows C4 model when the record has a C4 block.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';
import { load, dress } from './aidlc-turbo-design-panel-mount';
import { BUILT } from './aidlc-turbo-v5-boot';
import { fixture, run, pageOf, EMBED } from './aidlc-turbo-intent-overview-fixture';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const req = createRequire(import.meta.url);
const read = (f: string) => readFileSync(path.join(FLOW, f), 'utf8');
const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
const { embedBlock, EMBED_OPEN, EMBED_CLOSE } = req(path.join(FLOW, 'scripts/lib/overview-page.cjs'));
const G = globalThis as any;
const TEMPLATE = read('templates/overview/overview-template.html');
const EN = JSON.parse(read('templates/lang/en.json'));
const HELP = EN.design.switches.text;
const ALL = ['functional', 'flow', 'c4', 'review'];

let d: ReturnType<typeof fakeDom>;
let win: Record<string, ((ev: any) => void)[]>;
let stored: Map<string, string>;
beforeEach(() => {
  d = fakeDom();
  dress(d);
  win = {};
  G.addEventListener = (t: string, fn: (ev: any) => void) => { (win[t] ||= []).push(fn); };
  Object.assign(G, { innerWidth: 1600, innerHeight: 900 });
  delete G.matchMedia;
  delete G.TdRoom;
  delete G.TdView;
  stored = new Map();
  G.localStorage = { getItem: (k: string) => (stored.has(k) ? stored.get(k)! : null), setItem: (k: string, v: string) => { stored.set(k, String(v)); } };
});
const S = () => load('design-switches.js');
const has = (c: string) => d.html.classList.contains(c);

/** The switches mounted in a masthead slot; `go(view)` shows another tab as the page's tabs do. */
function mount(o: { built?: boolean; plan?: boolean; tabs?: string[]; onChange?: (s: any) => void } = {}) {
  const slot = d.node('div');
  const changes: any[] = [];
  let now = 'functional';
  const sw = S().mount({ slot, built: !!o.built, plan: !!o.plan, code: true, tabs: () => o.tabs || ['functional', 'flow'], now: () => now,
    onChange: (s: any) => { changes.push(s); if (o.onChange) o.onChange(s); } });
  const [dsw, btn, box] = slot.children;
  const items = () => d.all(box, 'help-list')[0].children.map((li: any) => li.textContent);
  const title = () => d.all(box, 'help-t')[0].textContent;
  return { sw, slot, dsw, btn, box, changes, items, title, go: (v: string) => { now = v; sw.shown(v); } };
}
const escape = () => { const ev: any = { key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} }; for (const fn of win.keydown || []) fn(ev); };
const down = (target: any) => { for (const l of d.docListeners.filter((x) => x.type === 'pointerdown')) l.fn({ target }); };

describe('aidlc-turbo overview: Details and ? on the masthead', () => {
  it('a fresh page: Details on, ? off, nothing stored yet', () => {
    const m = mount();
    expect([m.dsw.tag, m.dsw.getAttribute('role'), m.dsw.getAttribute('aria-checked'), m.dsw.textContent]).toEqual(['button', 'switch', 'true', 'Details']);
    expect([m.btn.textContent, m.btn.getAttribute('aria-pressed'), m.btn.getAttribute('aria-controls')]).toEqual(['?', 'false', 'help']);
    expect([has('plain-off'), has('help-on')]).toEqual([false, false]);
    expect(m.sw.state()).toEqual({ details: true, help: false });
    expect([m.sw.open(), m.box.hidden]).toEqual([false, true]);
    expect([...stored.keys()]).toEqual([]);
  });

  it('a click turns a switch, keeps it under its own key and tells the page', () => {
    const m = mount();
    m.dsw.click();
    expect([has('plain-off'), m.dsw.getAttribute('aria-checked'), stored.get('c4-details')]).toEqual([true, 'false', '0']);
    m.btn.click();
    expect([has('help-on'), m.btn.getAttribute('aria-pressed'), stored.get('c4-help')]).toEqual([true, 'true', '1']);
    m.dsw.click();
    m.btn.click();
    expect([has('plain-off'), has('help-on'), stored.get('c4-details'), stored.get('c4-help')]).toEqual([false, false, '1', '0']);
    expect(m.changes).toEqual([{ details: false, help: false }, { details: false, help: true }, { details: true, help: true }, { details: true, help: false }]);
  });

  it('remembered after a reload: the page opens as the viewer left it, the help itself closed', () => {
    stored.set('c4-details', '0');
    stored.set('c4-help', '1');
    const m = mount();
    expect([has('plain-off'), has('help-on')]).toEqual([true, true]);
    expect(m.sw.state()).toEqual({ details: false, help: true });
    expect(m.sw.open()).toBe(false);
  });

  it('storage that throws: the defaults, and both switches still work for the visit', () => {
    Object.defineProperty(G, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    try {
      const m = mount();
      expect(m.sw.state()).toEqual({ details: true, help: false });
      expect(() => { m.dsw.click(); m.btn.click(); }).not.toThrow();
      expect([m.sw.state(), has('plain-off'), has('help-on')]).toEqual([{ details: false, help: true }, true, true]);
    } finally {
      delete G.localStorage;
    }
    G.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const m = mount();
    expect(() => m.dsw.click()).not.toThrow();
    expect(m.sw.state()).toEqual({ details: false, help: false });
  });

  it('? on: the help of the tab shown hangs under it, the tab named as its button shows it; another tab redraws it', () => {
    const m = mount({ tabs: ['functional', 'flow'] });
    m.btn.click();
    expect([m.sw.open(), m.box.hidden, m.box.classList.contains('is-open')]).toEqual([true, false, true]);
    expect(m.title()).toBe('How to use Functional');
    expect(m.items()[0]).toContain('Under the title is what the intent will do');
    expect(d.all(m.box, 'help-foot')[0].textContent).toContain('Details turns the explanations in plain words');
    m.go('flow');
    expect(m.title()).toBe('How to use Code Scaffold');
    expect(m.items().join(' ')).toContain('Play');
    d.doc.getElementById = (id: string) => (id === 'tab-functional' ? { textContent: ' Functional ' } : id === 'tab-flow' ? { textContent: 'Drawing' } : null);
    m.go('functional');
    m.go('flow');
    expect(m.title()).toBe('How to use Drawing');
    expect(m.box.getAttribute('data-tab')).toBe('flow');
  });

  it('Escape closes the help and leaves the explanations on; a click outside closes it, a tab does not', () => {
    const m = mount();
    m.btn.click();
    escape();
    expect([m.sw.open(), m.box.hidden, has('help-on')]).toEqual([false, true, true]);
    m.sw.show();
    down({ closest: (sel: string) => (sel === '[role="tab"]' ? {} : null) });
    expect(m.sw.open()).toBe(true);
    down(d.node('div'));
    expect(m.sw.open()).toBe(false);
    m.sw.show();
    m.btn.click();
    expect([m.sw.open(), has('help-on')]).toEqual([false, false]);
  });

  it('a change goes to every frame of the v5 tabs, which open as the switches stand', () => {
    stored.set('c4-details', '0');
    const block = embedBlock(BUILT);
    const src = d.node('script');
    src.textContent = block.slice(EMBED_OPEN.length, block.length - EMBED_CLOSE.length);
    d.doc.getElementById = (id: string) => (id === 'v5-embed' ? src : null);
    let host: any = null;
    const m = mount({ onChange: (s) => host && host.set(s) });
    host = load('design-tabs.js').embed({ page: d.node('main'), ...m.sw.state() });
    host.show('c4');
    const frame = d.all(host.sections.c4, 'td-embed-box')[0].children.find((c: any) => c && c.tag === 'iframe');
    expect(frame.srcdoc).toContain('window.C4_EMBED = {"details":false,"help":false};');
    const sent: any[] = [];
    frame.contentWindow = { postMessage: (msg: unknown, to: string) => sent.push([msg, to]) };
    m.dsw.click();
    m.btn.click();
    expect(sent).toEqual([
      [{ type: 'turbo-switches', details: true, help: false }, '*'],
      [{ type: 'turbo-switches', details: true, help: true }, '*'],
    ]);
  });
});

describe('aidlc-turbo overview: the help of each tab', () => {
  const L = (v: string, o: any = {}) => S().lines(v, { tabs: ALL, ...o });
  const words = (v: string, o: any = {}) => L(v, o).join(' ');

  it('every tab of the page has its own words, without an em-dash', () => {
    for (const v of ALL) expect(L(v).length, v).toBeGreaterThan(1);
    expect(read('templates/design/design-switches.js')).not.toContain('—');
  });

  it('Functional and the drawing speak of what will come before the build, of what was built after it', () => {
    expect(words('functional')).toContain('what the intent will do');
    expect(words('functional', { built: true })).toContain('what the intent built');
    expect(words('flow')).toContain('The starting point of the code');
    expect(words('flow')).toContain('The Code Scaffold is wrong');
    expect(words('flow', { built: true })).toContain('The code as it was built');
    expect(words('flow', { built: true })).toContain('deviated from the starting point');
    expect(words('flow', { built: true, plan: true })).toContain('the change that is open');
    expect(words('flow', { built: true, plan: true })).not.toContain('deviated');
    expect(words('review')).toContain('Viewed');
  });

  it('a line naming a tab the page does not show is left out', () => {
    const only = L('functional', { tabs: ['functional'] });
    expect(only.length).toBeLessThan(L('functional').length);
    expect(only.join(' ')).not.toMatch(/\{\w+\}/);
    expect(L('functional', { built: true, tabs: ['functional', 'flow', 'review'] }).join(' ')).toContain('{review}');
  });

  it('the C4 model speaks the words of the string table, before the build and after it, with and without code', () => {
    const plainOf = (t: string) => t.replace(/\*/g, '');
    const said = [...L('c4'), ...L('c4', { built: true }), ...L('c4', { code: true })].map(plainOf).join(' ');
    for (const k of ['zoom', 'zoomCode', 'card', 'cardBuilt']) expect(said, k).toContain(plainOf(HELP.c4[k]).split(' | ')[0]);
  });
});

describe('aidlc-turbo overview: the page carries the switches', () => {
  it('in the masthead, beside the phase, no theme switch; the plain intent under the summary, which stays', () => {
    expect(TEMPLATE).toMatch(/<div class="mast-r">\s*<span class="phase" id="phase"><\/span>\s*<div class="mast-sw" id="mast-sw"[^>]*><\/div>\s*<\/div>/);
    expect(TEMPLATE).not.toContain('<div class="theme"');
    expect(TEMPLATE).toMatch(/<p class="rest" id="rest" hidden><\/p>\s*<p class="plain plain-intent" id="plain-intent"><\/p>/);
    expect(TEMPLATE).toMatch(/<p class="summary" id="summary">/);
    expect(TEMPLATE).toMatch(/window\.TdSwitches\.mount\(\{/);
  });

  it('the explanations are class how, the Legend is not; the styles hide them', () => {
    for (const id of ['x-flow', 'x-slices', 'x-tests']) expect(TEMPLATE, id).toContain(`<p class="explain how" id="${id}"></p>`);
    expect(TEMPLATE).toContain('<div class="legend how" id="lg-slices"></div>');
    expect(TEMPLATE).toContain('<p class="tkey how" id="tkey"></p>');
    expect(TEMPLATE).toContain('<p class="explain how" id="x-slices2">');
    expect(read('templates/design/design-steps.js')).toContain("h('p', 'td-steps-keys how')");
    expect(read('templates/design/design-steps.js')).toContain("btn('td-steps-rail', 'side', t('legend'), t('openLegend'))");
    expect(TEMPLATE).toMatch(/\.plain-off \.plain \{ display: none !important; \}/);
    expect(TEMPLATE).toMatch(/:root:not\(\.help-on\) \.how \{ display: none !important; \}/);
  });

  it('the note on the Code Scaffold is class how; while a change is open it says so whatever the switch', () => {
    const B = load('design-built.js');
    expect(B.note('inception', false).classList.contains('how')).toBe(true);
    expect(B.note('construction', true).classList.contains('how')).toBe(false);
    expect(B.note('construction', true).className).toBe('td-note');
  });

  it('the Code panel tells a story in plain words right under its title, class plain', () => {
    G.TdKit = load('design-kit.js');
    const s1 = { id: '001', n: '1', title: 'Log in' };
    const st = load('design-stories.js').create({ model: { stories: [s1] }, built: null, told: { '001': { plain: 'Whoever logs in chooses a new password.' } },
      titleOf: (x: any) => x.title, story: () => null, choose() {} });
    const f = st.foot([s1]);
    d.all(f, 'td-cs-s')[0].click();
    const more = d.all(f, 'td-cs-more')[0].children;
    expect(more.map((e: any) => e.className)).toEqual(['td-cs-name', 'td-cs-plain plain']);
    expect(more[1].textContent).toBe('Whoever logs in chooses a new password.');
  });

  it('the switches hand their state to the v5 tabs, and a change after', () => {
    expect(TEMPLATE).toMatch(/TdTabs\.embed\(\{ page: main, \.\.\.\(sw \? sw\.state\(\) : \{\}\) \}\)/);
    expect(TEMPLATE).toMatch(/onChange: \(s\) => \{ if \(v5\) v5\.set\(s\); \}/);
    expect(TEMPLATE).toMatch(/if \(sw\) sw\.shown\(v\);/);
  });
});

describe('aidlc-turbo overview: the data of the plain texts', () => {
  it('the intent\'s and every story\'s plain text, from the record', () => {
    const { root, intent, record } = fixture({ overview: true, drawing: true, plain: true });
    expect(run(root, ['user-auth', '--phase', 'inception']).code).toBe(0);
    const page = pageOf(intent);
    expect(page.intent.plain).toBe(record.intent.plain);
    expect(page.stories.map((s: any) => s.plain)).toEqual(record.stories.map((s: any) => s.plain));
    expect(page.stories.every((s: any) => typeof s.plain === 'string' && s.plain.length > 0)).toBe(true);
    const html = readFileSync(intent.overview, 'utf8');
    expect(html).toContain('<span class="sl-hp plain">');
    expect(TEMPLATE).toContain('built: s.built, plain: s.plain }');
  });

  it('none where the record has none', () => {
    const { root, intent } = fixture({ overview: true });
    expect(run(root, ['user-auth', '--phase', 'inception']).code).toBe(0);
    const page = pageOf(intent);
    expect('plain' in page.intent).toBe(false);
    expect(page.stories.some((s: any) => 'plain' in s)).toBe(false);
  });
});

describe('aidlc-turbo overview: a page without a drawing', () => {
  it('carries the tabs and the switches, so it shows C4 model when the record has a C4 block', () => {
    const { root, intent } = fixture({ overview: true, c4: true, plain: true });
    expect(run(root, ['user-auth', '--phase', 'inception']).code).toBe(0);
    const html = readFileSync(intent.overview, 'utf8');
    expect(pageOf(intent).design).toBeNull();
    const js = assets.pageAssets().js;
    for (const f of ['design-tabs.js', 'design-switches.js']) expect(js, f).toContain(read(`templates/design/${f}`));
    expect(html).toContain(read('templates/design/design-switches.js'));
    // the tabs as the page makes them there: no drawing, no Review, the v5 page it holds
    const src = d.node('script');
    src.textContent = EMBED.exec(html)![1];
    d.doc.getElementById = (id: string) => (id === 'v5-embed' ? src : null);
    const T = load('design-tabs.js');
    const main = d.node('main');
    const t = T.create({ page: main, flow: null, review: null, built: false, embed: T.embed({ page: main }) });
    expect(t.el.children.map((b: any) => b.textContent)).toEqual(['Functional', 'C4 model']);
    expect(TEMPLATE).toMatch(/if \(withDrawing \|\| v5\) \{/);
  });

  it('ships the tabs and the switches once on a page with a drawing, after the panel', () => {
    const js = (f: string) => assets.DESIGN_JS.indexOf(f);
    expect(assets.DESIGN_JS.filter((f: string) => f === 'design-tabs.js')).toHaveLength(1);
    expect(js('design-switches.js')).toBeGreaterThan(js('design-tabs.js'));
    expect(js('design-tabs.js')).toBeGreaterThan(js('design-panel.js'));
  });
});
