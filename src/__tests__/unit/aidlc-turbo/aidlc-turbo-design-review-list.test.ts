/**
 * Unit tests for what the Review tab lists and how (design-review-list.js,
 * design-review-seen.js), without a document:
 * - which parts are listed: every part with a diff, every part with a build
 *   deviation (different, added, not built, not used) even without one;
 *   never an unchanged existing part, nothing before the build;
 * - a row: the file name, a short path, what the diff did to the file, the
 *   deviation in the words of the drawing, +n / -n, its stories;
 * - the orders: the flow (the first step a part takes part in, then the
 *   drawing; no step last), the name, the folder tree (GitLab's: a chain of
 *   single folders as one, folders first, files by name), the largest change;
 * - the filters: a search on name or path with * as a wildcard, the kinds,
 *   the stories, viewed ones hidden;
 * - "Viewed" remembered per viewer and per intent, forgotten when the
 *   file's change is another, and working without a localStorage;
 * - the names of the orders and the kinds come from the string table, in the
 *   language of the page.
 * The tests read the English table (templates/lang/en.json).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { reviewModel, load, LIFECYCLE, APP } from './aidlc-turbo-design-review-fixture';

const G = globalThis as any;
let L: any;
beforeEach(() => {
  G.TdBuild = load('design-built.js');
  L = load('design-review-list.js');
});
const ids = (rows: any[]) => rows.map((r) => r.id);
const all = () => L.rows(reviewModel(), { built: true });

describe('aidlc-turbo Review: which parts are listed', () => {
  it('every part with a diff and every part with a deviation, nothing else', () => {
    expect(ids(all()).sort()).toEqual([...LIFECYCLE].sort());
    // an existing part the build left alone, an existing table, a changed part in another repo without a deviation
    for (const id of ['factory', 'table', 'remote']) expect(ids(all())).not.toContain(id);
  });

  it('nothing before the build, or on a page without its build', () => {
    expect(L.rows(reviewModel(), { built: false })).toEqual([]);
    const m: any = reviewModel();
    delete m.build;
    expect(L.rows(m, { built: true })).toEqual([]);
  });

  it('a row: the file name, a short path, what the diff did, the deviation, the counts and its stories', () => {
    const r = Object.fromEntries(all().map((x: any) => [x.id, x]));
    expect(r.loop).toMatchObject({ name: 'IncomingProcessor.java', path: `${APP}/inbox/IncomingProcessor.java`,
      dir: `${APP}/inbox`, short: 'shop/…/shop/inbox', file: 'changed', icon: 'changed', dev: 'different', devWord: 'different',
      added: 10, removed: 20, stories: ['001'] });
    expect(r.check).toMatchObject({ file: 'new', icon: 'new', dev: null, added: 40, removed: 0, stories: ['003'] });
    expect(r.old).toMatchObject({ file: 'removed', icon: 'removed', added: 0, removed: 3, stories: ['002'] });
    expect(r.failure).toMatchObject({ file: 'new', dev: 'added', devWord: 'added', stories: ['003'] });
    // a part not built has no file change: its planned status shows, and its name without a path
    expect(r.cache).toMatchObject({ name: 'BasketCache', path: null, dir: '', file: null, icon: 'new', dev: 'gone', devWord: 'not built', added: 0, removed: 0, entry: null });
    expect(r.status).toMatchObject({ file: null, icon: 'existing', dev: 'gone', devWord: 'not used' });
    // a short path keeps a short folder whole
    expect(r.sql).toMatchObject({ name: '01_seed.tbl.sql', short: 'sql/seeds/2026' });
  });

  it('a file the page left out for its size still shows, its status from the drawing', () => {
    const m: any = reviewModel();
    m.build.diffs[`${APP}/inbox/TimeoutCheck.java`] = { omitted: true };
    const r = L.rows(m, { built: true }).find((x: any) => x.id === 'check');
    expect(r).toMatchObject({ file: 'new', added: 0, removed: 0 });
    expect(r.entry).toEqual({ omitted: true });
  });

  it('a story label as on the step box: "US 001"', () => {
    expect(L.label({ n: '1' })).toBe('US 001');
    expect(L.label({ n: '12' })).toBe('US 012');
    expect(L.label({ n: 'A' })).toBe('US A');
  });
});

describe('aidlc-turbo Review: the orders', () => {
  it('the order of the flow: by the first step a part takes part in (from before to), then the drawing; no step last, in drawing order', () => {
    expect(ids(L.order(all(), 'flow'))).toEqual(LIFECYCLE);
    expect(all().find((r: any) => r.id === 'cache').first).toBe(3);
    expect(all().find((r: any) => r.id === 'failure').first).toBeNull();
  });

  it('the name (A-Z): by the file name, digits first, case aside', () => {
    expect(ids(L.order(all(), 'name'))).toEqual(['sql', 'cache', 'failure', 'parser', 'status', 'loop', 'old', 'start', 'check']);
  });

  it('the largest change: most lines first, a tie in flow order, no change last', () => {
    expect(ids(L.order(all(), 'size'))).toEqual(['check', 'loop', 'failure', 'parser', 'start', 'sql', 'old', 'cache', 'status']);
  });

  it('the four orders, the order of the flow first; without a drawing the order of the build', () => {
    expect(L.ORDERS).toEqual([['flow', 'Order of the flow'], ['name', 'Name (A-Z)'], ['tree', 'Folders'], ['size', 'Largest change']]);
    expect(L.ordersOf(reviewModel())).toEqual(L.ORDERS);
    expect(L.ordersOf({ ...reviewModel(), drawing: false })[0]).toEqual(['flow', 'Order of the build']);
  });

  it('the folders as GitLab shows them, a chain of single folders as one, folders first, files by name, no path last', () => {
    const t = L.tree(all());
    expect(t.map((n: any) => n.label)).toEqual([APP, 'sql/seeds/2026', 'Without a path']);
    const app = t[0];
    expect(app.dirs.map((n: any) => n.label)).toEqual(['inbox', 'jobs', 'util']);
    expect(app.files).toEqual([]);
    expect(ids(app.dirs[0].files)).toEqual(['failure', 'parser', 'status', 'loop', 'check']);
    expect(ids(app.dirs[1].files)).toEqual(['start']);
    expect(app.dirs[0].key).toBe(`${APP}/inbox`);
    expect(ids(t[1].files)).toEqual(['sql']);
    expect(ids(t[2].files)).toEqual(['cache']);
    // the files of the tree in the order it shows them
    expect(ids(L.order(all(), 'tree'))).toEqual(['failure', 'parser', 'status', 'loop', 'check', 'start', 'old', 'sql', 'cache']);
  });

  it('the folders: one common folder above everything is one folder, collapsed', () => {
    const rows = all().filter((r: any) => r.path && r.path.startsWith('shop/'));
    const t = L.tree(rows);
    expect(t.map((n: any) => n.label)).toEqual([APP]);
    expect(t[0].dirs.map((n: any) => n.label)).toEqual(['inbox', 'jobs', 'util']);
  });
});

describe('aidlc-turbo Review: the filters', () => {
  const by = (o: any) => ids(L.filter(L.order(all(), 'flow'), { q: '', kinds: new Set(), stories: new Set(), hideSeen: false, seen: () => false, ...o }));

  it('a search on the name or the path, case aside', () => {
    expect(by({ q: 'basket' })).toEqual(['parser', 'cache', 'status', 'failure']);
    expect(by({ q: 'INBOX' })).toEqual(['loop', 'parser', 'check', 'status', 'failure']);
    expect(by({ q: '  task ' })).toEqual(['start']);
    expect(by({ q: 'tbl.sql' })).toEqual(['sql']);
    expect(by({ q: 'tbl?sql' })).toEqual([]);
    expect(by({ q: 'nowhere' })).toEqual([]);
  });

  it('* as a wildcard: *Processor is every name that ends in Processor, *.sql every SQL file', () => {
    expect(by({ q: '*Processor' })).toEqual(['loop']);
    expect(by({ q: '*processor' })).toEqual(['loop']);
    expect(by({ q: '*.sql' })).toEqual(['sql']);
    expect(by({ q: 'Basket*' })).toEqual(['parser', 'cache', 'status', 'failure']);
    expect(by({ q: '*/util/*' })).toEqual(['old']);
    expect(by({ q: '*' })).toEqual(LIFECYCLE);
  });

  it('the kinds: one of them is enough, the counts per kind', () => {
    expect(by({ kinds: new Set(['new']) })).toEqual(['check', 'sql', 'failure']);
    expect(by({ kinds: new Set(['changed']) })).toEqual(['start', 'loop', 'parser']);
    expect(by({ kinds: new Set(['removed']) })).toEqual(['old']);
    expect(by({ kinds: new Set(['different']) })).toEqual(['loop']);
    expect(by({ kinds: new Set(['added']) })).toEqual(['failure']);
    expect(by({ kinds: new Set(['gone']) })).toEqual(['cache', 'status']);
    expect(by({ kinds: new Set(['new', 'gone']) })).toEqual(['cache', 'check', 'status', 'sql', 'failure']);
    expect(L.counts(all())).toEqual({ new: 3, changed: 3, removed: 1, different: 1, added: 1, gone: 2 });
    expect(L.CHIPS).toEqual([['new', 'New'], ['changed', 'Changed'], ['removed', 'Removed'], ['different', 'Different'], ['added', 'Added'], ['gone', 'Not built/used']]);
  });

  it('the stories: one of them is enough; with the search and the kinds all must hold', () => {
    expect(by({ stories: new Set(['001']) })).toEqual(['start', 'loop', 'status', 'sql']);
    expect(by({ stories: new Set(['001', '003']) })).toEqual(['start', 'loop', 'check', 'status', 'sql', 'failure']);
    expect(by({ stories: new Set(['001']), kinds: new Set(['new']) })).toEqual(['sql']);
    expect(by({ stories: new Set(['001']), q: 'inbox' })).toEqual(['loop', 'status']);
  });

  it('viewed ones hidden', () => {
    const seen = (r: any) => ['start', 'check'].includes(r.id);
    expect(by({ hideSeen: true, seen })).toEqual(['loop', 'parser', 'cache', 'status', 'sql', 'old', 'failure']);
    expect(by({ hideSeen: false, seen })).toEqual(LIFECYCLE);
  });

  it('what hides a row: the filters to clear for it', () => {
    const r = all().find((x: any) => x.id === 'check');
    const f = { q: 'basket', kinds: new Set(['gone']), stories: new Set(['003']), hideSeen: true, seen: () => true };
    expect(L.hides(r, f).sort()).toEqual(['kinds', 'q', 'seen']);
    expect(L.hides(r, { q: '', kinds: new Set(), stories: new Set(), hideSeen: false, seen: () => false })).toEqual([]);
  });
});

describe('aidlc-turbo Review: Viewed, remembered', () => {
  const store = () => { const m = new Map<string, string>(); return { m, ls: { getItem: (k: string) => (m.has(k) ? m.get(k) : null), setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } } }; };

  it('per viewer and per intent: another page of the same intent knows it, another intent not', () => {
    const s = store();
    G.localStorage = s.ls;
    const S = load('design-review-seen.js');
    const r = all().find((x: any) => x.id === 'loop');
    const a = S.create('intent-a');
    expect(a.has(r)).toBe(false);
    a.set(r, true);
    expect(a.has(r)).toBe(true);
    expect(S.create('intent-a').has(r)).toBe(true);
    expect(S.create('intent-b').has(r)).toBe(false);
    expect(S.create('intent-a').count(all())).toBe(1);
    a.set(r, false);
    expect(S.create('intent-a').has(r)).toBe(false);
  });

  it('a file whose change is another since is no longer viewed', () => {
    G.localStorage = store().ls;
    const S = load('design-review-seen.js');
    const r = all().find((x: any) => x.id === 'loop');
    S.create('x').set(r, true);
    const m: any = reviewModel();
    m.build.diffs[r.path] = { ...m.build.diffs[r.path], text: m.build.diffs[r.path].text + '+z\n', added: 11 };
    const again = L.rows(m, { built: true }).find((x: any) => x.id === 'loop');
    expect(S.create('x').has(again)).toBe(false);
  });

  it('works without a localStorage, and with one that throws: remembered for the page only', () => {
    delete G.localStorage;
    let S = load('design-review-seen.js');
    const r = all()[0];
    const a = S.create('x');
    a.set(r, true);
    expect(a.has(r)).toBe(true);
    G.localStorage = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
    S = load('design-review-seen.js');
    const b = S.create('x');
    expect(() => b.set(r, true)).not.toThrow();
    expect(b.has(r)).toBe(true);
  });
});
