/**
 * Unit tests for the Review tab on the overview after the build
 * (design-review.js, design-review-side.js), in a fake document, the part
 * of it a reviewer drives (the rest: aidlc-turbo-design-review.test.ts):
 * - "Viewed" per file, remembered, on to the next unviewed file;
 * - the keys: the arrows, Home, End and Enter in the list, / for the search,
 *   ] or j and [ or k anywhere in the tab unless typing; one announcement;
 * - open(partId) clears a filter that hides the file;
 * - always one file chosen, measured whenever it shows.
 * Every text is the English string table's (templates/lang/en.json).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { reviewDom, mountReview, filterItems, press, fire, load, LIFECYCLE, DESIGN, APP } from './aidlc-turbo-design-review-fixture';

const G = globalThis as any;
const read = (f: string) => { try { return readFileSync(path.join(DESIGN, f), 'utf8'); } catch { return ''; } };

let d: any;
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  d = reviewDom({ store });
});

const mount = (o: any = {}) => mountReview(d, o);

describe('aidlc-turbo Review: Viewed', () => {
  it('a check marks the file viewed: the tick in the list, the progress, remembered for the next page; on to the next unviewed file', () => {
    const v = mount();
    const seen = v.one('td-rv-seen-in');
    expect(seen.checked).toBe(false);
    seen.checked = true;
    fire(seen, 'change');
    expect(d.all(v.opts()[0], 'td-rv-tick')).toHaveLength(1);
    expect(v.opts()[0].getAttribute('aria-label')).toContain('viewed');
    expect(v.one('td-rv-prog').textContent).toContain('1 of 9 viewed');
    expect(v.chosen()).toBe('loop');
    const again = mount();
    expect(d.all(again.opts()[0], 'td-rv-tick')).toHaveLength(1);
    expect(again.one('td-rv-prog').textContent).toContain('1 of 9 viewed');
    // unchecked again: no longer viewed, the file stays
    again.opts()[0].click();
    const s2 = again.one('td-rv-seen-in');
    expect(s2.checked).toBe(true);
    s2.checked = false;
    fire(s2, 'change');
    expect(again.chosen()).toBe('start');
    expect(d.all(again.opts()[0], 'td-rv-tick')).toHaveLength(0);
  });

  it('works without a localStorage', () => {
    d = reviewDom({ store: 'throws' });
    const v = mount();
    const seen = v.one('td-rv-seen-in');
    seen.checked = true;
    expect(() => fire(seen, 'change')).not.toThrow();
    expect(d.all(v.opts()[0], 'td-rv-tick')).toHaveLength(1);
  });
});

describe('aidlc-turbo Review: the keys', () => {
  it('in the list: down and up move the choice, Home and End, Enter takes the focus to the file', () => {
    const v = mount();
    const list = v.list();
    list.focus();
    press(d, list, 'ArrowDown');
    expect(v.chosen()).toBe('loop');
    press(d, list, 'ArrowDown');
    expect(v.chosen()).toBe('parser');
    press(d, list, 'ArrowUp');
    expect(v.chosen()).toBe('loop');
    press(d, list, 'End');
    expect(v.chosen()).toBe('failure');
    press(d, list, 'Home');
    expect(v.chosen()).toBe('start');
    const ev = press(d, list, 'ArrowUp');
    expect(ev.defaultPrevented).toBe(true);
    expect(v.chosen()).toBe('start');
    press(d, list, 'Enter');
    expect(d.doc.activeElement).toBe(v.head());
  });

  it('in the tree: right and left unfold and fold a folder, the arrows pass the folders', () => {
    const v = mount();
    const sel = v.one('td-rv-sort');
    sel.value = 'tree';
    fire(sel, 'change');
    const list = v.list();
    list.focus();
    press(d, list, 'Home');
    expect(list.getAttribute('aria-activedescendant')).toBe(v.q('td-rv-dir')[0].id);
    press(d, list, 'ArrowLeft');
    expect(v.q('td-rv-dir')[0].getAttribute('aria-expanded')).toBe('false');
    press(d, list, 'ArrowRight');
    expect(v.q('td-rv-dir')[0].getAttribute('aria-expanded')).toBe('true');
    press(d, list, 'ArrowDown');
    press(d, list, 'ArrowDown');
    expect(v.chosen()).toBe('failure');
  });

  it('/ goes to the search; ] and j the next file, [ and k the one before, anywhere in the tab', () => {
    const v = mount();
    const ev = press(d, d.body, '/');
    expect(ev.defaultPrevented).toBe(true);
    expect(d.doc.activeElement).toBe(v.one('td-rv-q'));
    d.doc.activeElement = null;
    press(d, d.body, 'j');
    expect(v.chosen()).toBe('loop');
    press(d, d.body, ']');
    expect(v.chosen()).toBe('parser');
    press(d, d.body, 'k');
    expect(v.chosen()).toBe('loop');
    press(d, d.body, '[');
    expect(v.chosen()).toBe('start');
    press(d, d.body, '[');
    expect(v.chosen()).toBe('start');
  });

  it('not while typing in a field, nor with a modifier, nor when the tab is hidden', () => {
    const v = mount();
    const s = v.one('td-rv-q');
    expect(press(d, s, 'j').defaultPrevented).toBe(false);
    expect(press(d, s, '/').defaultPrevented).toBe(false);
    expect(v.chosen()).toBe('start');
    press(d, d.body, 'j', { ctrlKey: true });
    expect(v.chosen()).toBe('start');
    v.box.children[0].hidden = true;
    press(d, d.body, 'j');
    expect(v.chosen()).toBe('start');
  });

  it('the file chosen is told to a screen reader once, politely', () => {
    const v = mount();
    const live = v.one('td-rv-live');
    expect(live.getAttribute('aria-live')).toBe('polite');
    press(d, d.body, 'j');
    expect(live.textContent).toBe('IncomingProcessor.java, changed, different. File 2 of 9.');
    // the details are not read aloud on top of it
    expect(v.q('td-rv-file').every((x: any) => !x.getAttribute('aria-live'))).toBe(true);
  });
});

describe('aidlc-turbo Review: open(partId)', () => {
  it('chooses the file, its row in sight', () => {
    const v = mount();
    expect(v.api.open('check')).toBe(true);
    expect(v.chosen()).toBe('check');
    expect(v.opts()[LIFECYCLE.indexOf('check')].scrolled).toBeGreaterThan(0);
  });

  it('clears a filter that hides it, and only that one', () => {
    const v = mount();
    const s = v.one('td-rv-q');
    s.value = 'basket';
    fire(s, 'input');
    const story = filterItems(d, v.box, 'stories')[2];
    story.click();
    expect(v.optIds()).toEqual(['failure']);
    v.api.open('check');
    expect(s.value).toBe('');
    expect(story.getAttribute('aria-checked')).toBe('true');
    expect(v.optIds()).toEqual(['check', 'failure']);
    expect(v.chosen()).toBe('check');
  });

  it('a part that is not in the list: nothing changes', () => {
    const v = mount();
    expect(v.api.open('factory')).toBe(false);
    expect(v.chosen()).toBe('start');
  });
});

describe('aidlc-turbo Review: always one chosen, measured on show', () => {
  it('a filter that hides the chosen file chooses the first that shows; a folded folder keeps its file chosen', () => {
    const v = mount();
    v.opts()[1].click();
    expect(v.chosen()).toBe('loop');
    filterItems(d, v.box, 'kinds')[0].click(); // New
    expect(v.chosen()).toBe('check');
    expect(v.shownName()).toBe('TimeoutCheck.java');
    const sel = v.one('td-rv-sort');
    sel.value = 'tree';
    fire(sel, 'change');
    // only new files: shop/.../inbox as one folder (TimeoutCheck and BasketFailure), then sql/seeds/2026
    expect(v.q('td-rv-dir').map((x: any) => d.all(x, 'td-rv-dn')[0].textContent)).toEqual([`${APP}/inbox`, 'sql/seeds/2026']);
    v.q('td-rv-dir')[0].click();
    expect(v.optIds()).toEqual(['sql']);
    expect(v.shownName()).toBe('TimeoutCheck.java');
    // the one before is in the folded folder: it opens again
    press(d, d.body, 'k');
    expect(v.chosen()).toBe('failure');
    expect(v.q('td-rv-dir')[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('mounted while hidden it takes no height; once it shows it fits the window', () => {
    const fits: any[] = [];
    let ro: any = null;
    G.ResizeObserver = class { constructor(cb: any) { ro = cb; } observe() {} };
    G.TdRoom = { fit: (o: any) => { fits.push(o); return 640; }, measure: () => ({ top: 160, after: 40 }), watch() {} };
    const make = d.doc.createElement;
    let rootEl: any = null;
    d.doc.createElement = (t: string) => { const e = make(t); if (t === 'section' && !rootEl) { rootEl = e; e.offscreen = true; } return e; };
    mount();
    expect(fits).toHaveLength(0);
    expect(rootEl.style['--td-rv-h']).toBeUndefined();
    rootEl.offscreen = false;
    ro([]);
    expect(fits.length).toBeGreaterThan(0);
    expect(rootEl.style['--td-rv-h']).toBe('640px');
  });
});

describe('aidlc-turbo Review: nothing to review', () => {
  it('before the build the tab says so plainly', () => {
    const v = mount({ opts: { phase: 'inception' } });
    expect(v.opts()).toHaveLength(0);
    expect(v.box.children[0].textContent).toContain('After the build the changed files are listed here.');
  });
});

describe('aidlc-turbo Review: its look', () => {
  const css = read('design-review.css');
  it('the details and the change side by side on a desktop; stacked only on a phone', () => {
    expect(css).toMatch(/\.td-rv-cols\s*\{[^}]*grid-template-columns:\s*minmax\(/);
    const phone = /@media \(max-width: 600px\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(phone).toBeTruthy();
    expect(phone![1]).toMatch(/\.td-rv-cols\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    // no other width stacks them
    const outside = css.replace(phone![0], '');
    expect(outside).not.toMatch(/\.td-rv-cols\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)\s*;/);
  });

  it('fits the window under the masthead, each column scrolling on its own', () => {
    expect(css).toContain('var(--td-rv-h');
    expect(css).toContain('--masthead-h');
    expect(css).toMatch(/\.td-rv-det\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.td-rv-list\s*\{[^}]*overflow-y:\s*auto/);
  });

  it('the page\'s tokens only, focus rings, less motion where asked', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgb\(/);
    expect(css).toContain(':focus-visible');
    expect(css).toContain('prefers-reduced-motion');
  });

  it('without an em-dash, a doc comment on top, under 500 lines', () => {
    for (const f of ['design-review.js', 'design-review-side.js', 'design-review-list.js', 'design-review-seen.js', 'design-review-filter.js', 'design-review.css']) {
      const src = read(f);
      expect(src, f).not.toMatch(/\u2014/);
      expect(src.startsWith('/*'), f).toBe(true);
      expect(src.split('\n').length, f).toBeLessThanOrEqual(500);
    }
  });

  it('the list tells a viewer how it is built: TdReviewList loads in Node too', () => {
    expect(typeof load('design-review-list.js').rows).toBe('function');
  });
});
