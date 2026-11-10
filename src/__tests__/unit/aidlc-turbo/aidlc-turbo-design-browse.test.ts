/**
 * Unit tests for the Code Scaffold's details, part by part (design-browse.js):
 * - the order of the parts: the drawing's reading order, band by band from
 *   the top, column by column from the left, top to bottom in a column;
 * - previous and next under the details of a part, with where it is in
 *   that order; none past the first or the last part (no wrap);
 * - the arrow keys walk the steps (play); only a drawing without steps lets
 *   them walk the parts while a part is chosen;
 * - no full screen of the details any more;
 * - the panel, the view and play wired to it, and the files under 500 lines.
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
// loaded per test, so a module that is not there yet fails each test on what it checks
const Browse = () => req(path.join(DESIGN, 'design-browse.js'));
const dm = req(path.join(FLOW, 'scripts/lib/design-model.cjs'));
const { parseYaml } = req(path.join(FLOW, 'scripts/render-specs.cjs'));
const { layout } = req(path.join(DESIGN, 'design-layout.js'));
const FIXTURE = path.resolve(__dirname, '../../fixtures/aidlc-turbo-design/drawing.yaml');

/** Five parts in two bands: three columns in the first, one part in a later band higher up than another. */
const model = {
  parts: [
    { id: 'a', name: 'Alfa' }, { id: 'b', name: 'Bravo' }, { id: 'c', name: 'Charlie' },
    { id: 'd', name: 'Delta' }, { id: 'e', name: 'Echo' },
  ],
};
const geo = {
  lanes: [{ id: 'band-0', y: 0 }, { id: 'band-1', y: 900 }, { id: 'band-2', y: 600 }],
  blocks: [
    { id: 'c', band: 0, x: 400, y: 20 },
    { id: 'a', band: 0, x: 28, y: 300 },
    { id: 'd', band: 1, x: 28, y: 920 },
    { id: 'b', band: 0, x: 28, y: 40 },
    { id: 'e', band: 2, x: 28, y: 620 },
  ],
};

describe('aidlc-turbo Code Scaffold: the order of the parts', () => {
  it('reads band by band from the top, column by column from the left, top to bottom in a column', () => {
    expect(Browse().order(geo)).toEqual(['b', 'a', 'c', 'e', 'd']);
  });

  it('holds every part of the drawing once, the columns of a band from left to right', () => {
    const m = dm.designModel(parseYaml(readFileSync(FIXTURE, 'utf8')));
    const g = layout(m);
    const ids = Browse().order(g);
    expect([...ids].sort()).toEqual(m.parts.map((p: any) => p.id).sort());
    const at = new Map(g.blocks.map((b: any) => [b.id, b]));
    for (let i = 1; i < ids.length; i += 1) {
      const [p, q]: any[] = [at.get(ids[i - 1]), at.get(ids[i])];
      if (p.band === q.band) expect(q.x > p.x || (q.x === p.x && q.y > p.y), `${p.id} before ${q.id}`).toBe(true);
    }
  });
});

/** A browse on a fake detail, with the part chosen in `sel` and every go() remembered; `steps` a walk over the steps. */
function setup(sel: { kind: string; id: string } | null = { kind: 'part', id: 'a' }, steps: any = null) {
  const dom = fakeDom();
  const detail = dom.node('div');
  detail.className = 'td-detail';
  const keys = dom.node('p');
  keys.append(dom.node('span'), dom.node('span'));
  keys.lastElementChild.textContent = 'previous or next step';
  const went: string[] = [];
  const state: any = { sel };
  const b = Browse().create({ detail, geo, model, keys, steps, selected: () => state.sel, go: (id: string) => { went.push(id); state.sel = { kind: 'part', id }; if (state.after) state.after(id); } });
  return { ...dom, detail, keys, went, state, b };
}
const walkOf = (w: any) => w.children.map((c: any) => [String(c.className), c.textContent, c.title, c.getAttribute('aria-label')]);

describe('aidlc-turbo Code Scaffold: previous and next under a part', () => {
  it('two chevrons around where the part is, as the walk of the steps: the part before and after named in their tooltip and label', () => {
    const { b } = setup();
    // a is the second part in reading order: b, a, c, e, d
    const w = b.nav('a');
    expect(String(w.className)).toBe('td-walk td-browse');
    const prev = 'Go to the previous element: Bravo (left arrow)', next = 'Go to the next element: Charlie (right arrow)';
    expect(walkOf(w)).toEqual([
      ['td-btn td-walkb td-prev', '', prev, prev],
      ['td-walkn', '2 of 5', '', 'Element 2 of 5'],
      ['td-btn td-walkb td-next', '', next, next],
    ]);
  });

  it('with steps the arrows walk the steps: the chevrons name no arrow key', () => {
    const { b } = setup({ kind: 'part', id: 'a' }, { ids: () => [], number: () => null, total: 0 });
    expect(walkOf(b.nav('a')).map((x) => x[2])).toEqual(['Go to the previous element: Bravo', '', 'Go to the next element: Charlie']);
  });

  it('the chevrons are compact round buttons, comfortable to hit: 36 px, 44 under a finger', () => {
    const css = readFileSync(path.join(DESIGN, 'design-browse.css'), 'utf8');
    expect(css).toMatch(/\.td-walk\.td-browse \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.td-walk\.td-browse \.td-walkb \{[^}]*width: 36px;[^}]*min-height: 36px;[^}]*padding: 0;[^}]*border-radius: 50%;/);
    expect(css).toMatch(/\.td-walk\.td-browse \.td-walkb\.td-prev \{[^}]*justify-self: end;/);
    expect(css).toMatch(/\.td-walk\.td-browse \.td-walkb\.td-next \{[^}]*justify-self: start;/);
    expect(css).toMatch(/:is\(\.td-pv, \.td-touch\) \.td-walk\.td-browse \.td-walkb \{[^}]*width: 44px;[^}]*min-height: 44px;/);
  });

  it('has no previous on the first part and no next on the last: the walk stops at the ends', () => {
    const { b } = setup();
    expect(walkOf(b.nav('b')).map((x) => x[0])).toEqual(['td-walkn', 'td-btn td-walkb td-next']);
    expect(walkOf(b.nav('d')).map((x) => x[0])).toEqual(['td-btn td-walkb td-prev', 'td-walkn']);
    expect(b.nav('zz')).toBeNull();
  });

  it('a button goes to that part, as a click on it would, and the focus moves to its twin in the new details', () => {
    const s = setup();
    // the panel shows the details of the part gone to, with a new walk
    s.state.after = (id: string) => { s.state.shown = s.b.nav(id); };
    s.b.nav('a').children[2].click();
    expect(s.went).toEqual(['c']);
    expect(s.doc.activeElement).toBe(s.state.shown.children[2]);
    expect(String(s.doc.activeElement.className)).toContain('td-next');
    // at the first part there is no previous: the focus goes to next
    s.state.shown.children[0].click();
    s.state.shown.children[0].click();
    expect(s.went).toEqual(['c', 'a', 'b']);
    expect(String(s.doc.activeElement.className)).toContain('td-next');
  });

  it('walk(dir) goes from the part chosen, never past an end, and does nothing for a line', () => {
    const s = setup({ kind: 'part', id: 'b' });
    expect(s.b.walk(-1)).toBeNull();
    expect(s.b.walk(1)).toBe('a');
    s.state.sel = { kind: 'link', id: 'x' };
    expect(s.b.walk(1)).toBeNull();
    expect(s.went).toEqual(['a']);
  });
});

describe('aidlc-turbo Code Scaffold: the arrow keys with a part chosen, on a drawing without steps', () => {
  it('ArrowRight and ArrowLeft go to the next and the previous part and keep the key from the steps', () => {
    const s = setup();
    const ev = s.key('ArrowRight');
    expect(ev.defaultPrevented).toBe(true);
    expect(s.key('ArrowLeft').defaultPrevented).toBe(true);
    expect(s.went).toEqual(['c', 'a']);
  });

  it('listens in the capture phase, ahead of play, which leaves a key that was handled alone', () => {
    const s = setup();
    expect(s.docListeners.filter((l) => l.type === 'keydown').every((l) => l.capture)).toBe(true);
    expect(read('design-play.js')).toMatch(/if \(ev\.defaultPrevented \|\|/);
  });

  it('at the last part the key is still taken, so the steps do not move under it', () => {
    const s = setup({ kind: 'part', id: 'd' });
    expect(s.key('ArrowRight').defaultPrevented).toBe(true);
    expect(s.went).toEqual([]);
  });

  it('leaves the arrows to the steps with a line, a module or nothing chosen', () => {
    for (const sel of [{ kind: 'link', id: 'l1' }, { kind: 'module', id: 'm' }, null]) {
      const s = setup(sel);
      expect(s.key('ArrowRight').defaultPrevented).toBe(false);
      expect(s.went).toEqual([]);
    }
  });

  it('leaves the arrows alone in a field, with a modifier, or while the details are not on screen', () => {
    let s = setup();
    const field = s.node('input');
    field.matches = (sel: string) => (sel.includes('input') ? field : null);
    expect(s.key('ArrowRight', { target: field }).defaultPrevented).toBe(false);
    for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) expect(s.key('ArrowRight', { [mod]: true }).defaultPrevented).toBe(false);
    s.detail.offscreen = true; // the functional view shows, or the page has no room for the details
    expect(s.key('ArrowRight').defaultPrevented).toBe(false);
    s = setup();
    s.detail.hidden = true;
    expect(s.key('ArrowLeft').defaultPrevented).toBe(false);
    expect(s.went).toEqual([]);
  });

  it('tells the keys over the drawing what the arrows do: the elements without steps, the steps with them', () => {
    expect(setup().keys.lastElementChild.textContent).toBe('previous or next element');
    expect(setup(null, { ids: () => [], number: () => null, total: 0 }).keys.lastElementChild.textContent).toBe('previous or next step');
  });

  it('a drawing with steps leaves the arrows to the steps, a part chosen or not', () => {
    const s = setup({ kind: 'part', id: 'a' }, { ids: () => [], number: () => null, total: 0 });
    expect(s.key('ArrowRight').defaultPrevented).toBe(false);
    expect(s.went).toEqual([]);
  });
});

describe('aidlc-turbo Code Scaffold: no full screen of the details', () => {
  it('no button, no dialog, no lock of the page, in the code nor the style', () => {
    const s = setup();
    expect((s.b as any).tools).toBeUndefined();
    expect((s.b as any).enter).toBeUndefined();
    for (const f of ['design-browse.js', 'design-show.js', 'design-pane.js', 'design-panel.js']) expect(read(f), f).not.toMatch(/td-dfull|td-dfb|td-dfs-lock|td-dtools/);
    for (const f of ['design-browse.css', 'design.css', 'design-about.css', 'design-pane.css', 'design-diff.css', 'design-touch.css', 'maquette-draw.css']) {
      expect(read(f).replace(/\/\*[\s\S]*?\*\//g, ''), f).not.toMatch(/td-dfull|td-dfb|td-dfs-lock|td-dtools|--td-tools-w/);
    }
  });
});

describe('aidlc-turbo Code Scaffold: the panel, the view and play wired to the browse', () => {
  const PANEL = read('design-panel.js');
  const VIEW = read('design-view.js');
  const PLAY = read('design-play.js');

  it('the panel makes the browse and goes to a part as a click does', () => {
    expect(PANEL).toMatch(/const browse = root\.TdBrowse\.create\(\{ detail, geo, model, keys: steps && steps\.keys, steps, selected: \(\) => ch\.get\(\), go: \(id\) => clicked\('part', id\) \}\);/);
    // what the details show puts the walk under them: element by element, or step by step for the part of the step held
    const SHOW = read('design-show.js');
    expect(SHOW).toContain('root.TdSwap.put(detail, null, build(sub));');
    expect(SHOW).toContain("const nav = sub.walk === 'step' ? o.browse.stepNav(step.id) : kind === 'part' ? o.browse.nav(id) : null;");
  });

  it('Escape on the page leaves an open list or dialog alone first', () => {
    expect(read('design-input.js')).toContain("if (ev.key !== 'Escape' || ev.defaultPrevented) return;");
  });

  it('leaving the browser\'s full screen closes the drawing\'s view', () => {
    expect(PANEL).not.toContain('onFullExit');
    expect(VIEW).not.toContain('onFullExit');
    expect(VIEW).toMatch(/else if \(fs\.full\) \{ fs\.full = false; close\(\); \}/);
  });

  it('play keeps its keys inside the drawing\'s view, never in another dialog', () => {
    expect(PLAY).toContain('[role="dialog"]:not(.td-fs)');
  });

  it('the kit has the icon to go back from full screen', () => {
    expect(req(path.join(DESIGN, 'design-kit.js')).ICON.shrink).toMatch(/^<path d="/);
  });

  it('the walk reads in light and dark by the tokens of the page', () => {
    expect(read('design-browse.css')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });

  it('keeps every file it touches under 500 lines', () => {
    for (const f of ['design-browse.js', 'design-panel.js', 'design-view.js', 'design-play.js', 'design-kit.js']) {
      const n = read(f).split('\n').length;
      expect(n, f).toBeGreaterThan(1);
      expect(n, f).toBeLessThanOrEqual(500);
    }
  });
});
