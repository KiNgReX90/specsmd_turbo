/**
 * Unit tests for the filter of the Review tab as one dropdown (design-review-filter.js), and the headings of
 * the details that stand out:
 * - a button "Filter" that opens a menu of checkable items, grouped: what happened to the file (with its count)
 *   and the stories ("US 001" with its title); how many are on, on the button;
 * - a click or Space toggles an item and the menu stays open; "Clear all filters" turns them all off;
 * - the keys of a menu: down and up go round, Home and End, Escape closes it back to the button; a click
 *   outside closes it; Review's own keys (j, k, /) do nothing while it has the focus;
 * - "What it does" and "What changed" in bold, in the magenta ink of the page (not the night of the headings), light only.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { reviewDom, mountReview, filterItems, press, load, DESIGN } from './aidlc-turbo-design-review-fixture';

const read = (f: string) => readFileSync(path.join(DESIGN, f), 'utf8');
let d: any;
beforeEach(() => { d = reviewDom(); });

const GROUPS = [
  { id: 'kinds', label: 'Change', items: [{ key: 'new', label: 'New', count: 3 }, { key: 'changed', label: 'Changed', count: 2 }] },
  { id: 'stories', label: 'Stories', items: [{ key: '001', label: 'US 001', note: 'Only the reply', title: 'Story 1: Only the reply' }] },
];
function make() {
  const heard: any[] = [];
  let cleared = 0;
  const f = load('design-review-filter.js').create({ groups: GROUPS, onChange: (g: string, k: string, on: boolean) => heard.push([g, k, on]), onClear: () => { cleared += 1; } });
  d.body.append(f.el);
  const items = () => d.all(f.menu, 'td-rv-fitem');
  return { f, heard, items, cleared: () => cleared };
}

describe('aidlc-turbo Review filter: one dropdown', () => {
  it('a button "Filter" that says it opens a menu, the menu closed at first', () => {
    const { f } = make();
    expect(f.button.tag).toBe('button');
    expect(d.all(f.button, 'td-rv-ft')[0].textContent).toBe('Filter');
    expect(f.button.getAttribute('aria-haspopup')).toBe('menu');
    expect(f.button.getAttribute('aria-expanded')).toBe('false');
    expect(f.button.getAttribute('aria-controls')).toBe(f.menu.id);
    expect(f.menu.getAttribute('role')).toBe('menu');
    expect(f.menu.hidden).toBe(true);
  });

  it('the items in their groups, each a checkbox of the menu, off', () => {
    const { f, items } = make();
    const groups = d.all(f.menu, 'td-rv-fgroup');
    expect(groups.map((g: any) => [g.getAttribute('role'), g.getAttribute('aria-label')])).toEqual([['group', 'Change'], ['group', 'Stories']]);
    expect(groups.map((g: any) => d.all(g, 'td-rv-fgt')[0].textContent)).toEqual(['Change', 'Stories']);
    expect(items().map((x: any) => [x.getAttribute('role'), x.getAttribute('aria-checked'), x.getAttribute('tabindex')]))
      .toEqual([['menuitemcheckbox', 'false', '-1'], ['menuitemcheckbox', 'false', '-1'], ['menuitemcheckbox', 'false', '-1']]);
    expect(d.all(items()[0], 'td-rv-fn')[0].textContent).toBe('3');
    expect(d.all(items()[2], 'td-rv-fnote')[0].textContent).toBe('Only the reply');
    expect(items()[2].title).toBe('Story 1: Only the reply');
  });

  it('a click opens it; a click on an item turns it on or off and the menu stays; the button counts what is on', () => {
    const { f, heard, items } = make();
    f.button.click();
    expect(f.menu.hidden).toBe(false);
    expect(f.button.getAttribute('aria-expanded')).toBe('true');
    items()[0].click();
    items()[2].click();
    expect(heard).toEqual([['kinds', 'new', true], ['stories', '001', true]]);
    expect(items()[0].getAttribute('aria-checked')).toBe('true');
    expect(f.menu.hidden).toBe(false);
    const badge = d.all(f.button, 'td-rv-fbadge')[0];
    expect(badge.textContent).toBe('2');
    expect(badge.hidden).toBe(false);
    expect(f.button.getAttribute('aria-label')).toBe('Filter, 2 on');
    items()[0].click();
    expect(heard[2]).toEqual(['kinds', 'new', false]);
    expect(badge.textContent).toBe('1');
  });

  it('"Clear all filters" turns all off and says so once; set() and clear() change the marks without a word', () => {
    const { f, heard, items, cleared } = make();
    f.set('kinds', 'changed', true);
    expect(items()[1].getAttribute('aria-checked')).toBe('true');
    expect(heard).toEqual([]);
    const wipe = d.all(f.menu, 'td-rv-fclear')[0];
    expect(wipe.getAttribute('role')).toBe('menuitem');
    expect(wipe.textContent).toBe('Clear all filters');
    wipe.click();
    expect(cleared()).toBe(1);
    expect(items().every((x: any) => x.getAttribute('aria-checked') === 'false')).toBe(true);
    f.set('stories', '001', true);
    f.clear('stories');
    expect(items()[2].getAttribute('aria-checked')).toBe('false');
    expect(d.all(f.button, 'td-rv-fbadge')[0].hidden).toBe(true);
  });

  it('the keys of a menu: down on the button opens it on the first, round with down and up, Space toggles, Escape back to the button', () => {
    const { f, heard, items } = make();
    press(d, f.button, 'ArrowDown');
    expect(f.menu.hidden).toBe(false);
    expect(d.doc.activeElement).toBe(items()[0]);
    press(d, items()[0], 'ArrowUp');
    expect(d.doc.activeElement).toBe(d.all(f.menu, 'td-rv-fclear')[0]);
    press(d, d.doc.activeElement, 'ArrowDown');
    expect(d.doc.activeElement).toBe(items()[0]);
    press(d, items()[0], 'End');
    expect(d.doc.activeElement).toBe(d.all(f.menu, 'td-rv-fclear')[0]);
    press(d, d.doc.activeElement, 'Home');
    press(d, items()[0], ' ');
    expect(heard).toEqual([['kinds', 'new', true]]);
    const esc = press(d, items()[0], 'Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(f.menu.hidden).toBe(true);
    expect(d.doc.activeElement).toBe(f.button);
  });

  it('a click outside closes it', () => {
    const { f } = make();
    f.button.click();
    for (const l of d.docListeners.filter((x: any) => x.type === 'pointerdown')) l.fn({ target: d.body });
    expect(f.menu.hidden).toBe(true);
  });
});

describe('aidlc-turbo Review filter: in the tab', () => {
  it('on top of the list beside the search, no chips left; Review\'s keys rest while the menu has the focus', () => {
    const v = mountReview(d);
    expect(v.q('td-rv-chip')).toHaveLength(0);
    expect(v.q('td-rv-fbtn')).toHaveLength(1);
    const first = filterItems(d, v.box, 'kinds')[0];
    const was = v.chosen();
    press(d, first, 'j');
    expect(v.chosen()).toBe(was);
  });

  it('is inlined before the list that uses it, its style with the tab\'s, under 500 lines', () => {
    const assets = require(path.resolve(DESIGN, '../../scripts/lib/design-assets.cjs'));
    const at = (f: string) => assets.DESIGN_JS.indexOf(f);
    expect(at('design-review-filter.js')).toBeGreaterThan(-1);
    expect(at('design-review-filter.js')).toBeLessThan(at('design-review-side.js'));
    expect(read('design-review-filter.js').split('\n').length).toBeLessThanOrEqual(500);
    expect(read('design-review.css')).toMatch(/\.td-rv-fmenu \{[^}]*position: absolute;/);
  });
});

describe('aidlc-turbo details: the headings stand out', () => {
  it('"What it does" and "What changed" bold in the magenta ink of the page, light only', () => {
    expect(read('design-about.css')).toMatch(/\.td-dsec-t \{[^}]*font: 700 [^}]*color: var\(--td-subhead\);/);
    const tokens = read('design.css');
    expect(tokens).toMatch(/:root \{[^}]*--td-subhead: #A800A8;/);
    expect(tokens).not.toMatch(/data-theme|prefers-color-scheme: dark/);
  });
});
