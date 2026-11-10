/**
 * Unit tests for the Review tab on the overview after the build
 * (design-review.js, design-review-side.js, design-review.css), in a fake
 * document:
 * - the contract the tab switch mounts it by: TdReview.mount(container,
 *   model, { titles, phase, onFlow }) -> { open(partId) }, inlined after
 *   what it reads;
 * - the list of files at the left, as GitLab's: a scrollable listbox, never
 *   a dropdown, one row always chosen (the first on open), a status icon, the
 *   name, a short path, +n / -n, a deviation mark, a tick when viewed;
 * - the orders and the tree of folders, the search, the kinds, the stories,
 *   "Hide viewed", "n of N files" and "x of N viewed";
 * - the chosen file at the right: its head, then its details and its change
 *   side by side with the divider between them;
 * - "Viewed", the keys and open(partId): aidlc-turbo-design-review-keys.test.ts;
 * - its look: side by side on a desktop, stacked only on a phone, the
 *   page's tokens, focus rings, less motion, files under 500 lines.
 * Every text is the English string table's (templates/lang/en.json).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import { reviewDom, mountReview, filterItems, press, fire, LIFECYCLE, APP } from './aidlc-turbo-design-review-fixture';

const G = globalThis as any;
const req = createRequire(import.meta.url);
const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
const EN = req(path.join(FLOW, 'templates/lang/en.json')).design;

let d: any;
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  d = reviewDom({ store });
});

const mount = (o: any = {}) => mountReview(d, o);

describe('aidlc-turbo Review: the contract', () => {
  it('window.TdReview.mount(container, model, { titles, phase, onFlow }) puts the view in the container and returns open(partId)', () => {
    const v = mount();
    expect(typeof v.api.open).toBe('function');
    expect(v.box.children).toHaveLength(1);
    expect(v.box.children[0].classList.contains('td-rv')).toBe(true);
  });

  it('is inlined after what it reads, before the panel; its style with the drawing\'s', () => {
    const assets = req(path.join(FLOW, 'scripts/lib/design-assets.cjs'));
    const at = (f: string) => assets.DESIGN_JS.indexOf(f);
    for (const f of ['design-review-list.js', 'design-review-seen.js', 'design-review-side.js', 'design-review.js']) {
      expect(at(f), f).toBeGreaterThan(-1);
      for (const dep of ['design-kit.js', 'design-layout.js', 'design-built.js', 'design-engine.js']) expect(at(dep), `${dep} before ${f}`).toBeLessThan(at(f));
    }
    for (const dep of ['design-about.js', 'design-diff.js', 'design-grip.js', 'design-swap.js', 'design-room.js', 'design-review-list.js', 'design-review-seen.js', 'design-review-side.js']) {
      expect(at(dep), `${dep} before design-review.js`).toBeLessThan(at('design-review.js'));
    }
    expect(assets.DESIGN_CSS).toContain('design-review.css');
    expect(assets.DESIGN_CSS.indexOf('design-review.css')).toBeGreaterThan(assets.DESIGN_CSS.indexOf('design-diff.css'));
  });
});

describe('aidlc-turbo Review: the list of files', () => {
  it('a scrollable listbox of every file to review, in the order of the flow, never a dropdown', () => {
    const v = mount();
    expect(v.list().getAttribute('role')).toBe('listbox');
    expect(v.list().getAttribute('aria-label')).toBe('Files');
    expect(v.list().getAttribute('tabindex')).toBe('0');
    expect(v.optIds()).toEqual(LIFECYCLE);
    for (const o of v.opts()) expect(o.getAttribute('role')).toBe('option');
    // the only select is the order of the list
    expect(d.all(v.box, 'td-rv-sort')).toHaveLength(1);
    expect(v.q('td-pick')).toHaveLength(0);
  });

  it('one row chosen from the start: the first, its file shown', () => {
    const v = mount();
    expect(v.chosen()).toBe('start');
    expect(v.list().getAttribute('aria-activedescendant')).toBe(v.opts()[0].id);
    expect(v.shownName()).toBe('Task.java');
  });

  it('a row: the status icon, the name, a short path, +n / -n, the deviation mark; the tick when viewed', () => {
    const v = mount();
    const loop = v.opts()[1];
    expect(d.all(loop, 'td-rv-si')).toHaveLength(1);
    expect(d.all(loop, 'td-rv-n')[0].textContent).toBe('IncomingProcessor.java');
    expect(d.all(loop, 'td-rv-p')[0].textContent).toBe('shop/\u2026/shop/inbox');
    expect(d.all(loop, 'td-rv-plus')[0].textContent).toBe('+10');
    expect(d.all(loop, 'td-rv-min')[0].textContent).toBe('\u221220');
    const dv = d.all(loop, 'td-rv-dv')[0];
    expect(dv.title).toBe(EN.mark.different);
    expect(loop.getAttribute('aria-label')).toBe('IncomingProcessor.java, changed, different, 10 lines added, 20 lines removed');
    expect(d.all(v.opts()[0], 'td-rv-dv')).toHaveLength(0);
    // a new file has no "-0", a removed one no "+0", a part not built neither
    const at = (id: string) => v.opts()[LIFECYCLE.indexOf(id)];
    expect(d.all(at('check'), 'td-rv-min')).toHaveLength(0);
    expect(d.all(at('old'), 'td-rv-plus')).toHaveLength(0);
    expect(d.all(at('cache'), 'td-rv-ct')).toHaveLength(0);
    expect(d.all(at('check'), 'td-rv-tick')).toHaveLength(0);
  });

  it('a click chooses a row and shows its file', () => {
    const v = mount();
    v.opts()[4].click();
    expect(v.chosen()).toBe('check');
    expect(v.shownName()).toBe('TimeoutCheck.java');
  });

  it('"n of N files" and "x of N viewed"', () => {
    const v = mount();
    expect(v.one('td-rv-count').textContent).toBe('9 of 9 files');
    expect(v.one('td-rv-prog').textContent).toContain('0 of 9 viewed');
  });
});

describe('aidlc-turbo Review: the orders and the tree', () => {
  it('the order control at the top of the list, the flow first; another order shows the rows in it', () => {
    const v = mount();
    const sel = v.one('td-rv-sort');
    expect(sel.tag).toBe('select');
    expect(sel.getAttribute('aria-label')).toBe('Order');
    expect(d.all(sel, 'td-rv-sortopt').map((x: any) => x.textContent)).toEqual(['Order of the flow', 'Name (A-Z)', 'Folders', 'Largest change']);
    expect(sel.value).toBe('flow');
    sel.value = 'name';
    fire(sel, 'change');
    expect(v.optIds()).toEqual(['sql', 'cache', 'failure', 'parser', 'status', 'loop', 'old', 'start', 'check']);
    expect(v.chosen()).toBe('start'); // the file chosen stays chosen
    sel.value = 'size';
    fire(sel, 'change');
    expect(v.optIds()[0]).toBe('check');
  });

  it('Folders: a tree of folders that fold, the files in them; a chain of single folders as one', () => {
    const v = mount();
    const sel = v.one('td-rv-sort');
    sel.value = 'tree';
    fire(sel, 'change');
    expect(v.list().getAttribute('role')).toBe('tree');
    const dirs = v.q('td-rv-dir');
    expect(dirs.map((x: any) => d.all(x, 'td-rv-dn')[0].textContent)).toEqual([APP, 'inbox', 'jobs', 'util', 'sql/seeds/2026', 'Without a path']);
    expect(dirs[1].getAttribute('aria-label')).toBe('Folder inbox, 5 files');
    expect(dirs[0].getAttribute('role')).toBe('treeitem');
    expect(dirs[0].getAttribute('aria-expanded')).toBe('true');
    expect(dirs[1].getAttribute('aria-level')).toBe('2');
    expect(v.opts().map((x: any) => x.getAttribute('aria-level'))).toEqual(['3', '3', '3', '3', '3', '3', '3', '2', '2']);
    expect(v.opts().every((x: any) => x.getAttribute('role') === 'treeitem')).toBe(true);
    // in a tree the path is the folder's: no short path on the row
    expect(d.all(v.opts()[0], 'td-rv-p')).toHaveLength(0);
    // a folder folds and unfolds by a click
    dirs[1].click();
    expect(v.q('td-rv-dir')[1].getAttribute('aria-expanded')).toBe('false');
    expect(v.optIds()).toEqual(['start', 'old', 'sql', 'cache']);
    v.q('td-rv-dir')[1].click();
    expect(v.optIds()).toHaveLength(9);
  });
});

describe('aidlc-turbo Review: the filters', () => {
  it('the search box filters by name or path, * as a wildcard; the count follows', () => {
    const v = mount();
    const s = v.one('td-rv-q');
    expect(s.tag).toBe('input');
    expect(s.type).toBe('search');
    expect(s.getAttribute('aria-label')).toBe('Search a file by name or path');
    expect(s.placeholder).toBe('Search, e.g. *Processor');
    s.value = '*Processor';
    fire(s, 'input');
    expect(v.optIds()).toEqual(['loop']);
    expect(v.one('td-rv-count').textContent).toBe('1 of 9 files');
    // the file chosen was hidden: the first that shows is chosen
    expect(v.chosen()).toBe('loop');
    expect(v.shownName()).toBe('IncomingProcessor.java');
  });

  it('an empty result says so plainly, with a way to clear the filters', () => {
    const v = mount();
    const s = v.one('td-rv-q');
    s.value = 'nowhere';
    fire(s, 'input');
    expect(v.opts()).toHaveLength(0);
    const e = v.one('td-rv-empty');
    expect(e.hidden).toBe(false);
    expect(e.textContent).toContain('No file fits this filter.');
    // the file shown stays
    expect(v.shownName()).toBe('Task.java');
    d.all(e, 'td-rv-clear')[0].click();
    expect(v.optIds()).toEqual(LIFECYCLE);
    expect(s.value).toBe('');
  });

  it('a filter per kind in the list, with its count, in the dropdown; one or more, checked', () => {
    const v = mount();
    const it = filterItems(d, v.box, 'kinds');
    expect(it.map((c: any) => [d.all(c, 'td-rv-fl')[0].textContent, d.all(c, 'td-rv-fn')[0].textContent]))
      .toEqual([['New', '3'], ['Changed', '3'], ['Removed', '1'], ['Different', '1'], ['Added', '1'], ['Not built/used', '2']]);
    expect(it.every((c: any) => c.getAttribute('aria-checked') === 'false')).toBe(true);
    it[5].click();
    expect(it[5].getAttribute('aria-checked')).toBe('true');
    expect(v.optIds()).toEqual(['cache', 'status']);
    it[0].click();
    expect(v.optIds()).toEqual(['cache', 'check', 'status', 'sql', 'failure']);
  });

  it('a story filter, US 001 and on, its title beside it, in the same dropdown', () => {
    const v = mount();
    const it = filterItems(d, v.box, 'stories');
    expect(it.map((c: any) => d.all(c, 'td-rv-fl')[0].textContent)).toEqual(['US 001', 'US 002', 'US 003']);
    expect(d.all(it[0], 'td-rv-fnote')[0].textContent).toBe('The inbox reads only the reply');
    expect(it[0].title).toBe('Story 1: The inbox reads only the reply');
    it[1].click();
    expect(v.optIds()).toEqual(['parser', 'cache', 'old']);
  });

  it('"Hide viewed" hides the files marked as viewed', () => {
    const v = mount();
    const seen = v.one('td-rv-seen-in');
    seen.checked = true;
    fire(seen, 'change');
    const hide = v.one('td-rv-hide-in');
    expect(hide.type).toBe('checkbox');
    hide.checked = true;
    fire(hide, 'change');
    expect(v.optIds()).not.toContain('start');
    expect(v.optIds()).toHaveLength(8);
  });
});

describe('aidlc-turbo Review: the file chosen', () => {
  it('a head: the status icon and the name, the path, +n / -n, the state pill, Viewed and "View in the flow"', () => {
    const v = mount();
    v.opts()[1].click();
    const h = v.one('td-rv-head');
    expect(d.all(h, 'td-rv-si')).toHaveLength(1);
    expect(v.head().tag).toBe('h2');
    expect(v.head().getAttribute('tabindex')).toBe('-1');
    expect(d.all(h, 'td-rv-path')[0].textContent).toBe(`${APP}/inbox/IncomingProcessor.java`);
    expect(d.all(h, 'td-rv-plus')[0].textContent).toBe('+10');
    // the state pill only: the deviation is told by the card in the details, never by a pill in the head
    expect(d.all(h, 'td-pill').map((x: any) => x.textContent)).toEqual([EN.status.built.changed]);
    expect(h.textContent).not.toMatch(/different/i);
    expect(d.all(h, 'td-rv-ct')[0].title).toBe('10 lines added, 20 lines removed');
    const seen = d.all(h, 'td-rv-seen-in')[0];
    expect(seen.type).toBe('checkbox');
    expect(d.all(h, 'td-rv-seen')[0].textContent).toContain('Viewed');
    expect(seen.title).toBe('Mark this file as viewed');
    const flow = d.all(h, 'td-rv-flow')[0];
    expect(flow.textContent).toContain('View in the flow');
    expect(flow.title).toBe('Show this part in the drawing, on the Flow tab');
    flow.click();
    expect(v.went).toEqual(['loop']);
  });

  it('no "View in the flow" without onFlow', () => {
    const v = mount({ opts: { onFlow: undefined } });
    expect(v.q('td-rv-flow')).toHaveLength(0);
  });

  it('the details and the change side by side, the divider between them; the details as in the Flow tab, with the story labels', () => {
    const v = mount();
    v.opts()[1].click();
    const cols = v.one('td-rv-cols');
    expect(cols.children.map((c: any) => c.className.split(' ')[0])).toEqual(['td-rv-det', 'td-dsep', 'td-rv-code']);
    const sep = cols.children[1];
    expect(sep.getAttribute('role')).toBe('separator');
    expect(sep.getAttribute('tabindex')).toBe('0');
    const det = cols.children[0];
    expect(d.all(det, 'td-dsec-t').map((x: any) => x.textContent)).toEqual([EN.about.what, EN.about.changed]);
    expect(d.all(det, 'td-ddev-t')[0].textContent).toContain(EN.about.different);
    expect(d.all(det, 'td-dflow')[0].textContent).toContain('step');
    expect(det.getAttribute('aria-label')).toBe('Details of IncomingProcessor.java');
    expect(d.all(det, 'td-rv-us').map((x: any) => x.textContent)).toEqual(['US 001']);
    expect(d.all(cols.children[2], 'td-diff')).toHaveLength(1);
    // each column scrolls on its own: the details by keys too
    expect(det.getAttribute('tabindex')).toBe('0');
  });

  it('a part without a change in the code says so beside its details', () => {
    const v = mount();
    v.opts()[LIFECYCLE.indexOf('cache')].click();
    const code = v.one('td-rv-code');
    expect(d.all(code, 'td-diff')).toHaveLength(0);
    expect(code.textContent).toBe('No change in the code: this part was not built.');
    v.opts()[LIFECYCLE.indexOf('status')].click();
    expect(v.one('td-rv-code').textContent).toBe('No change in the code: this part was not used.');
  });

  it('the divider moves by the keys and is remembered', () => {
    const v = mount();
    const sep = v.one('td-rv-cols').children[1];
    const before = Number(sep.getAttribute('aria-valuenow'));
    press(d, sep, 'ArrowRight');
    expect(Number(v.one('td-rv-cols').children[1].getAttribute('aria-valuenow'))).toBe(before + 5);
    expect(store.get('td-review-split')).toBe(String(before + 5));
  });
});
