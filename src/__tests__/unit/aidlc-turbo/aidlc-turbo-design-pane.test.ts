/**
 * Unit tests for the details of what was clicked in a panel of their own right
 * of the Code Scaffold drawing (design-pane.js), the mirror of the legend left
 * of it:
 * - on a desktop page always beside the drawing, which shrinks to make room;
 *   a phone and the preview keep the details under it (the panel that stays,
 *   its rail on a narrow desktop window and the divider before the code:
 *   aidlc-turbo-design-pane-split.test.ts);
 * - it folds to a slim rail, as the legend folds; another block chosen while
 *   folded keeps it folded; folded or open is remembered per viewer, also
 *   without storage;
 * - its left edge is a handle (a separator): drag it with a mouse, a pen or a
 *   finger, or use the arrow keys, Home and End; it opens at a width that
 *   suits text (OPEN), never narrower than MIN, never so wide the drawing
 *   gets unreadable, inside that room again when the window changes; a
 *   double click puts back the width it opens at; the width is remembered;
 *   no text gets selected and nothing glides while it is dragged;
 * - the details are text only, one column: the change in the code is the
 *   Review tab's;
 * - the keys of the walk are one quiet line along the bottom of the drawing's
 *   frame, on full screen too, no longer a box under the walk.
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
  stored = new Map();
  G.localStorage = { getItem: (k: string) => (stored.has(k) ? stored.get(k)! : null), setItem: (k: string, v: string) => { stored.set(k, String(v)); }, removeItem: (k: string) => { stored.delete(k); } };
  delete G.requestAnimationFrame;
});

/** A pointer event as the handle hears it. */
const ev = (o: Record<string, unknown> = {}) => {
  const e: any = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, defaultPrevented: false, ...o };
  e.preventDefault = () => { e.defaultPrevented = true; };
  return e;
};
const fire = (el: any, type: string, e: any = ev()) => { for (const fn of el.listeners[type] || []) fn(e); return e; };

/** The details of a part named `name`, as design-detail.js heads them. */
function details(detail: any, name: string) {
  const head = d.node('div');
  head.className = 'td-dhead';
  const h3 = d.node('h3');
  h3.textContent = name;
  head.append(d.node('div'), h3);
  detail.replaceChildren(head);
  detail.hidden = false;
  d.observe();
}

/** The panel around the details beside a drawing 900 px wide; the panel itself 460 px wide where the page puts it. */
function pane(o: { draw?: number } = {}) {
  const P = load('design-pane.js');
  const detail = d.node('div');
  detail.className = 'td-detail';
  detail.hidden = true;
  const host = d.node('div'), draw = d.node('div');
  draw.clientWidth = o.draw ?? 900;
  let changes = 0;
  const p = P.create(detail, { host, draw, onChange: () => { changes++; } });
  p.el.offsetWidth = 460;
  p.grip.setPointerCapture = (id: number) => { p.grip.captured = id; };
  return { P, p, detail, host, draw, changes: () => changes };
}
const first = (e: any, cls: string) => d.all(e, cls)[0] || null;

describe('aidlc-turbo Code Scaffold: the details in a panel of their own', () => {
  it('holds the details under a head with its name and the way to fold it, a rail and a handle', () => {
    const { p, detail } = pane();
    expect(p.el.tag).toBe('section');
    expect(p.el.getAttribute('aria-label')).toBe('Details');
    expect(p.el.children).toContain(detail);
    const top = first(p.el, 'td-dpane-top');
    expect(first(top, 'td-dpane-t').textContent).toBe('Details');
    const fold = first(top, 'td-dfold');
    expect(fold.title).toBe('Fold the details');
    expect(fold.getAttribute('aria-label')).toBe('Fold the details');
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(first(p.el, 'td-dpane-rail')).not.toBeNull();
    expect(p.grip.className).toBe('td-dgrip');
  });

  it('stands beside the drawing on a desktop page, under it where the page has no room for both', () => {
    const { P, p, host } = pane();
    expect(p.place(1286)).toBe(true);
    expect(host.classList.contains('td-dbeside')).toBe(true);
    // the preview (0) and a narrow window keep the details under the drawing, as they were
    expect(p.place(0)).toBe(false);
    expect(host.classList.contains('td-dbeside')).toBe(false);
    expect(p.place(P.TIGHT - 1)).toBe(false);
    expect(p.place(P.NEED)).toBe(true);
  });

  it('stays when the details come and go: the room of the drawing never changes for it', () => {
    const { p, detail, changes } = pane();
    p.place(1286);
    details(detail, 'ReturnShipmentProcessor');
    details(detail, 'ShipmentParser');
    detail.hidden = true;
    d.observe();
    expect(changes()).toBe(0);
  });

  it('a new part starts its details at the top', () => {
    const { p, detail } = pane();
    p.place(1286);
    details(detail, 'ReturnShipmentProcessor');
    detail.scrollTop = 300;
    details(detail, 'ShipmentParser');
    expect(detail.scrollTop).toBe(0);
  });
});

describe('aidlc-turbo Code Scaffold: the details panel folds like the legend', () => {
  it('folds to a rail named for the details, and opens again; the focus goes along', () => {
    const { p, detail, changes } = pane();
    p.place(1286);
    details(detail, 'ReturnShipmentProcessor');
    const fold = first(p.el, 'td-dfold'), rail = first(p.el, 'td-dpane-rail');
    fold.click();
    expect(p.el.classList.contains('td-dfolded')).toBe(true);
    expect(p.folded()).toBe(true);
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(rail.getAttribute('aria-expanded')).toBe('false');
    expect(d.doc.activeElement).toBe(rail);
    expect(rail.textContent).toBe('Details');
    expect(rail.title).toBe('Unfold the details: ReturnShipmentProcessor');
    expect(rail.getAttribute('aria-label')).toBe(rail.title);
    expect(changes()).toBe(1);
    rail.click();
    expect(p.el.classList.contains('td-dfolded')).toBe(false);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(d.doc.activeElement).toBe(fold);
  });

  it('another block chosen while folded keeps it folded; the rail\'s tooltip names it', () => {
    const { p, detail } = pane();
    p.place(1286);
    details(detail, 'ReturnShipmentProcessor');
    first(p.el, 'td-dfold').click();
    details(detail, 'ShipmentParser');
    expect(p.folded()).toBe(true);
    expect(first(p.el, 'td-dpane-rail').title).toBe('Unfold the details: ShipmentParser');
  });

  it('remembers folded or open per viewer, and works without storage', () => {
    const one = pane();
    first(one.p.el, 'td-dfold').click();
    expect(stored.get('td-details-folded')).toBe('1');
    expect(pane().p.folded()).toBe(true);
    first(one.p.el, 'td-dpane-rail').click();
    expect(stored.get('td-details-folded')).toBe('0');
    expect(pane().p.folded()).toBe(false);
    // storage refused (a private window, blocked site data): it folds all the same
    G.localStorage = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
    const two = pane();
    expect(two.p.folded()).toBe(false);
    first(two.p.el, 'td-dfold').click();
    expect(two.p.folded()).toBe(true);
    delete G.localStorage;
    expect(pane().p.folded()).toBe(false);
  });
});

describe('aidlc-turbo Code Scaffold: the details panel widens by its left edge', () => {
  it('names its handle in plain words, as a vertical separator the keys reach', () => {
    const { p } = pane();
    const g = p.grip;
    expect(g.getAttribute('role')).toBe('separator');
    expect(g.getAttribute('aria-orientation')).toBe('vertical');
    expect(g.getAttribute('tabindex')).toBe('0');
    expect(g.getAttribute('aria-label')).toBe('Drag to make the panel wider or narrower');
    expect(g.getAttribute('aria-controls')).toBe(p.el.id);
    // a verb first, the keys named the way the page names them
    expect(g.title).toMatch(/^Drag to make the panel wider or narrower \(left or right arrow\)/);
    expect(g.title).toMatch(/[Dd]ouble-click/);
    expect(g.title).not.toMatch(/\u2014/);
  });

  it('opens at a width that suits text, never narrower than its minimum', () => {
    const { P, p, detail } = pane();
    p.place(1286);
    details(detail, 'A');
    expect(P.MIN).toBe(320);
    expect(P.OPEN).toBe(400);
    expect(p.width()).toBe(400);
    expect(p.el.style['--td-dpane-w']).toBe('400px');
    expect(p.grip.getAttribute('aria-valuenow')).toBe('400');
    expect(p.grip.getAttribute('aria-valuemin')).toBe('320');
  });

  it('a drag on the handle to the left makes it wider, to the right narrower, inside its bounds', () => {
    const { P, p, detail, changes } = pane();
    p.place(1286);
    details(detail, 'A');
    const before = changes();
    const down = fire(p.grip, 'pointerdown', ev({ clientX: 1000 }));
    expect(down.defaultPrevented).toBe(true); // no text selected while it moves
    expect(p.grip.captured).toBe(1);
    expect(d.html.classList.contains('td-dresizing')).toBe(true);
    fire(p.grip, 'pointermove', ev({ clientX: 800 }));
    expect(p.width()).toBe(600);
    expect(changes()).toBeGreaterThan(before);
    // never so wide the drawing keeps less than it needs: 460 + 900 - DRAW
    fire(p.grip, 'pointermove', ev({ clientX: 100 }));
    expect(p.width()).toBe(460 + 900 - P.DRAW);
    expect(p.grip.getAttribute('aria-valuemax')).toBe(String(460 + 900 - P.DRAW));
    // never narrower than its minimum
    fire(p.grip, 'pointermove', ev({ clientX: 1400 }));
    expect(p.width()).toBe(P.MIN);
    fire(p.grip, 'pointermove', ev({ clientX: 900 }));
    fire(p.grip, 'pointerup', ev({ clientX: 900 }));
    expect(d.html.classList.contains('td-dresizing')).toBe(false);
    expect(p.width()).toBe(500);
    expect(stored.get('td-details-width')).toBe('500');
    // a move after the drag lets go does nothing
    fire(p.grip, 'pointermove', ev({ clientX: 500 }));
    expect(p.width()).toBe(500);
  });

  it('a pen and a finger drag it too; another mouse button does not', () => {
    const { p, detail } = pane();
    p.place(1286);
    details(detail, 'A');
    fire(p.grip, 'pointerdown', ev({ pointerType: 'mouse', button: 2, clientX: 1000 }));
    fire(p.grip, 'pointermove', ev({ clientX: 900 }));
    expect(p.width()).toBe(400);
    fire(p.grip, 'pointerdown', ev({ pointerType: 'touch', pointerId: 7, clientX: 1000 }));
    fire(p.grip, 'pointermove', ev({ pointerId: 7, clientX: 900 }));
    expect(p.width()).toBe(500);
    fire(p.grip, 'pointercancel', ev({ pointerId: 7 }));
    fire(p.grip, 'pointerdown', ev({ pointerType: 'pen', pointerId: 8, clientX: 1000 }));
    fire(p.grip, 'pointermove', ev({ pointerId: 8, clientX: 960 }));
    fire(p.grip, 'lostpointercapture', ev({ pointerId: 8 }));
    expect(p.width()).toBe(540);
    expect(d.html.classList.contains('td-dresizing')).toBe(false);
  });

  it('the arrow keys widen and narrow it in steps, Home and End go to its bounds', () => {
    const { P, p, detail } = pane();
    p.place(1286);
    details(detail, 'A');
    const key = (k: string) => { const e: any = { key: k, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } }; fire(p.grip, 'keydown', e); return e; };
    expect(key('ArrowLeft').defaultPrevented).toBe(true);
    expect(p.width()).toBe(P.OPEN + P.STEP);
    key('ArrowLeft');
    key('ArrowRight');
    expect(p.width()).toBe(P.OPEN + P.STEP);
    expect(p.grip.getAttribute('aria-valuenow')).toBe(String(P.OPEN + P.STEP));
    key('End');
    expect(p.width()).toBe(460 + 900 - P.DRAW);
    key('Home');
    expect(p.width()).toBe(P.MIN);
    key('ArrowRight');
    expect(p.width()).toBe(P.MIN);
    expect(stored.get('td-details-width')).toBe(String(P.MIN));
    expect(key('a').defaultPrevented).toBe(false);
  });

  it('a double click on the handle puts back the width it opens at and forgets the one chosen', () => {
    const { p, detail } = pane();
    p.place(1286);
    details(detail, 'A');
    fire(p.grip, 'pointerdown', ev({ clientX: 1000 }));
    fire(p.grip, 'pointermove', ev({ clientX: 800 }));
    fire(p.grip, 'pointerup', ev({ clientX: 800 }));
    expect(stored.has('td-details-width')).toBe(true);
    fire(p.grip, 'dblclick', ev());
    expect(p.width()).toBe(400);
    expect(stored.has('td-details-width')).toBe(false);
  });

  it('opens at the width the viewer chose before, inside the room there is now', () => {
    stored.set('td-details-width', '700');
    const { p, detail, draw } = pane();
    p.place(1286);
    details(detail, 'A');
    expect(p.width()).toBe(700);
    // the window gets smaller: inside the room again, the choice kept for when it grows
    draw.clientWidth = 600;
    p.place(1100);
    expect(p.width()).toBe(460 + 600 - 400);
    draw.clientWidth = 1200;
    p.place(1600);
    expect(p.width()).toBe(700);
    expect(stored.get('td-details-width')).toBe('700');
  });

  it('a width it cannot read or a storage it cannot reach opens at the usual width', () => {
    stored.set('td-details-width', 'wide');
    const one = pane();
    one.p.place(1286);
    details(one.detail, 'A');
    expect(one.p.width()).toBe(400);
    G.localStorage = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
    const two = pane();
    two.p.place(1286);
    details(two.detail, 'A');
    fire(two.p.grip, 'pointerdown', ev({ clientX: 1000 }));
    fire(two.p.grip, 'pointermove', ev({ clientX: 900 }));
    fire(two.p.grip, 'pointerup', ev({ clientX: 900 }));
    expect(two.p.width()).toBe(500);
  });

  it('however wide, the details stay one column under each other: no wide layout of their own', () => {
    const { p, detail } = pane({ draw: 1400 });
    p.place(1866);
    details(detail, 'A');
    fire(p.grip, 'pointerdown', ev({ clientX: 1000 }));
    fire(p.grip, 'pointermove', ev({ clientX: 400 }));
    expect(p.el.classList.contains('td-dwide')).toBe(false);
    expect(read('design-pane.css')).toMatch(/\.td-dpane > \.td-detail \.td-dcol > \.td-dgrid \{[^}]*display: flex;[^}]*flex-direction: column;/);
  });

  it('the handle does nothing while the panel is folded or under the drawing', () => {
    const { p, detail } = pane();
    p.place(0);
    details(detail, 'A');
    fire(p.grip, 'pointerdown', ev({ clientX: 1000 }));
    fire(p.grip, 'pointermove', ev({ clientX: 800 }));
    expect(p.width()).toBe(400);
    expect(d.html.classList.contains('td-dresizing')).toBe(false);
  });

  it('the arrows on the handle are its own, not the walk of the parts or the steps', () => {
    expect(read('design-browse.js')).toMatch(/const FIELD = '[^']*\[role="separator"\]/);
    expect(read('design-play.js')).toMatch(/const FIELD = '[^']*\[role="separator"\]/);
  });
});

describe('aidlc-turbo Code Scaffold: where the details panel stands and how it looks', () => {
  const css = read('design-pane.css');
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('under the drawing (a phone, the preview) the details stay as they were, after the legend', () => {
    expect(plain).toMatch(/\.td-dpane \{ display: contents; \}/);
    expect(plain).toMatch(/\.td-dpane > :not\(\.td-detail\) \{ display: none; \}/);
    expect(plain).toMatch(/\.td-stage > \.td-dpane > \.td-detail \{ order: 3; \}/);
  });

  it('beside it: legend, drawing, details in one row; the drawing shrinks, the panel stays in view', () => {
    expect(plain).toMatch(/\.td-dbeside \.td-stage \{[^}]*flex-direction: row;/);
    expect(plain).toMatch(/\.td-dbeside \.td-stage > \.td-dzw \{[^}]*flex: 1 1 0;[^}]*min-width: 0;/);
    expect(plain).toMatch(/\.td-dbeside \.td-stage > \.td-dpane \{[^}]*position: sticky;[^}]*width: var\(--td-dpane-w, 400px\);[^}]*min-width: 320px;/);
    // without the legend beside the drawing, the legend goes under both
    expect(plain).toMatch(/\.td-dbeside:not\(\.td-side\) \.td-stage > \.td-steps \{[^}]*flex: 0 0 100%;/);
  });

  it('folded, a slim rail as tall as the drawing; the details out of sight but still there for the arrows', () => {
    expect(plain).toMatch(/\.td-dbeside \.td-stage > \.td-dpane\.td-dfolded \{[^}]*width: 52px;[^}]*align-self: stretch;/);
    expect(plain).toMatch(/\.td-dpane\.td-dfolded > \.td-detail \{[^}]*visibility: hidden;/);
    expect(plain).toMatch(/\.td-dpane\.td-dfolded > \.td-dpane-rail \{[^}]*display: flex;/);
    expect(plain).toMatch(/writing-mode: vertical-rl;/);
  });

  it('the handle: the whole edge, a resize cursor, no scrolling by a finger; nothing selected or gliding while dragged', () => {
    expect(plain).toMatch(/\.td-dpane > \.td-dgrip \{[^}]*cursor: col-resize;[^}]*touch-action: none;/);
    expect(plain).toMatch(/\.td-dgrip:focus-visible/);
    expect(plain).toMatch(/\.td-dresizing, \.td-dresizing \* \{[^}]*user-select: none !important;/);
    expect(plain).toMatch(/\.td-dresizing \.td-root \* \{ transition: none !important; \}/);
  });

  it('the details under its head, no card of their own, no buttons of their own and no full screen', () => {
    expect(plain).toMatch(/\.td-dpane > \.td-detail:not\(\[hidden\]\) \{[^}]*position: static;[^}]*overflow: hidden;/);
    expect(plain).not.toMatch(/td-dtools|td-dfull/);
  });

  it('text only: no change in the code in the panel, that is the Review tab\'s', () => {
    expect(plain).not.toMatch(/td-split|@container|container:/);
    expect(plain).not.toMatch(/td-dcols|td-diff|td-dsplit|td-df-/);
  });

  it('reads in light and dark by the tokens of the page; the Maquette dresses it as the legend', () => {
    expect(plain).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
    const mq = read('maquette-draw.css');
    expect(mq).toMatch(/\.mq :is\(\.td-steps, \.td-dpane\) \{/);
    expect(mq).toMatch(/\.mq :is\(\.td-steps-t, \.td-dpane-t\) \{/);
    expect(mq).toMatch(/\.td-btn:where\(:not\([^)]*\.td-dpane-rail/);
  });
});

describe('aidlc-turbo Code Scaffold: the panel puts the details beside the drawing', () => {
  const PANEL = read('design-panel.js');

  it('in the stage after the drawing, nothing under the stage', () => {
    expect(PANEL).toMatch(/const pane = root\.TdPane\.create\(detail, \{ host: rootEl, draw: dzw, steps: [^,]+, desk: \(\) => !root\.TdView\.touchy\(\), onChange: \(\) => fitPage\(true\) \}\);/);
    expect(PANEL).toContain('stage.append(dzw, pane.el);');
    expect(PANEL).toContain('main.append(tbar, stage);');
    expect(PANEL).not.toContain('main.append(tbar, stage, detail);');
  });

  it('the fit gives the drawing what the panel leaves it', () => {
    expect(PANEL).toContain('const beside = pane.place(pv ? 0 : full);');
    expect(PANEL).toContain('const avail = side || beside ? dz.clientWidth : full;');
    // the legend and the details as tall as the drawing beside them
    expect(PANEL).toMatch(/stage\.style\.setProperty\('--td-steps-h', /);
  });
});

describe('aidlc-turbo Code Scaffold: the keys are one quiet line along the bottom of the drawing', () => {
  const STEPS = read('design-steps.css').replace(/\/\*[\s\S]*?\*\//g, '');

  it('the panel puts them in the drawing\'s frame, not under the walk; the view takes them along', () => {
    const panel = read('design-panel.js');
    expect(panel).toContain('ctl.append(left);');
    expect(panel).toContain('dzw.append(steps.keys);');
    expect(panel).toMatch(/root\.TdView\.create\(\{[^}]*hint: steps && steps\.keys/);
    const view = read('design-view.js');
    expect(view).toMatch(/\[c\.chips, c\.bar, c\.keys, c\.ctl, dz, detail, c\.hint, c\.box\]/);
    expect(view).toMatch(/const det = touch \? detail : float\.take\(\);/);
    expect(view).toMatch(/view\.append\(dz, det, \.\.\.\(c\.hint \? \[c\.hint\] : \[\]\), \.\.\.\(c\.box \? \[c\.box\] : \[\]\), h\('p', 'td-fs-tip'/);
  });

  it('one line at the bottom left inside the frame, the drawing clear of it; at the bottom on full screen', () => {
    expect(STEPS).toMatch(/:is\(\.td-dzw, \.td-fs-view\) > \.td-steps-keys \{[^}]*position: absolute;[^}]*left: 14px;[^}]*bottom: 6px;/);
    expect(STEPS).toMatch(/\.td-steps-keys \{[^}]*display: flex;[^}]*white-space: nowrap;/);
    expect(STEPS).toMatch(/\.td-dzw > \.td-dz:has\(~ \.td-steps-keys\) \{ padding-bottom: 30px; \}/);
    expect(STEPS).toMatch(/\.td-fs-view > \.td-steps-keys ~ \.td-fs-tip \{ bottom: 40px; \}/);
    // no box of its own any more
    expect(STEPS).not.toMatch(/\.td-ctl \.td-steps-keys/);
    expect(read('maquette-draw.css')).not.toMatch(/\.mq \.td-steps-keys \{/);
  });

  it('hidden on touch, in a narrow frame and in the preview, in light and dark by the page\'s tokens', () => {
    expect(STEPS).toMatch(/\.td-root\.td-touch \.td-steps-keys \{ display: none !important; \}/);
    expect(STEPS).toMatch(/@container td-draw \(max-width: 620px\) \{[^@]*\.td-steps-keys \{ display: none; \}/);
    expect(STEPS).toMatch(/\.td-pv \.td-steps-keys \{ display: none; \}/);
    expect(STEPS).toMatch(/\.td-steps-keys \{[^}]*color: var\(--td-ink-3\);/);
  });

  it('the walk keeps a band only for its own row', () => {
    load('design-steps.js');
    const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
    const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
    const { layout } = req(path.join(DESIGN, 'design-layout.js'));
    const model = dm.designModel(parseYaml(readFileSync(path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml'), 'utf8')));
    const s = G.TdSteps.create(model, layout(model), d.node('svg'), [], []);
    const dzw = d.node('div'), ctl = d.node('div'), left = d.node('div');
    ctl.parentElement = dzw;
    ctl.append(left);
    dzw.append(ctl, s.keys);
    Object.assign(left, { offsetParent: {}, offsetTop: 12, offsetHeight: 48 });
    Object.assign(s.keys, { offsetParent: {}, offsetTop: 700, offsetHeight: 20 });
    expect(s.band(ctl, left)()).toBe(72);
  });
});

describe('aidlc-turbo Code Scaffold: the details panel ships with the drawing', () => {
  it('loads after the kit and before the panel; its style after the details, before the Maquette look', () => {
    const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
    const js = (f: string) => assets.DESIGN_JS.indexOf(f);
    const css = (f: string) => assets.DESIGN_CSS.indexOf(f);
    expect(js('design-pane.js')).toBeGreaterThan(js('design-kit.js'));
    expect(js('design-pane.js')).toBeLessThan(js('design-panel.js'));
    expect(css('design-pane.css')).toBeGreaterThan(css('design-diff.css'));
    expect(css('design-pane.css')).toBeLessThan(css('maquette.css'));
  });

  it('keeps every file it touches under 500 lines, without a long dash', () => {
    for (const f of ['design-pane.js', 'design-pane.css', 'design-panel.js', 'design-view.js', 'design-steps.js', 'design-steps.css', 'design-browse.js', 'design-play.js']) {
      const src = read(f);
      expect(src.length, f).toBeGreaterThan(0);
      expect(src.split('\n').length, f).toBeLessThanOrEqual(500);
      expect(src, f).not.toMatch(/\u2014/);
    }
  });
});
