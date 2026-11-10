/**
 * The page after the build as the Review tab reads it: a design model with its
 * build, the diffs per file and the steps, small enough to know every answer by
 * heart, and a fake document dressed for the view (closest, remove,
 * insertBefore, keys aimed at an element). The intent is invented: the order
 * inbox of Acme Shop reads only the reply of a basket message. reviewModel()
 * and reviewDom() serve the Review tab of the overview
 * (templates/design/design-review*.js); v5Model() is the same intent as the
 * v5 page model after the build, for the tests of the embed and the merge
 * request links.
 *
 * The steps, as TdLayout.flowOf numbers them: 1 start -> loop, 2 loop ->
 * parser, 3 loop -> cache, 4 loop -> factory, 5 start -> check, 6 check ->
 * status, 7 sql -> table. old and failure take part in no step; old comes
 * before failure in the drawing.
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import path from 'path';
import { fakeDom } from './aidlc-turbo-design-fake-dom';

const FLOW = path.resolve(__dirname, '../../../flows/aidlc-turbo');
export const DESIGN = path.join(FLOW, 'templates/design');
const req = createRequire(import.meta.url);
const G = globalThis as any;

/** A script of the page, run again in the test's fake document (it reads its globals when it loads). */
export function load(f: string) {
  const file = path.join(DESIGN, f);
  delete req.cache[file];
  return req(file);
}

/** The folder of the invented application's code, and its inbox processor. */
export const APP = 'shop/src/main/java/com/acme/shop';
const NEW = (n: number) => `@@ -0,0 +1,${n} @@\n` + Array.from({ length: n }, (_, i) => `+line ${i + 1}`).join('\n') + '\n';
export const DIFFS: Record<string, any> = {
  [`${APP}/jobs/Task.java`]: { text: '@@ -10,4 +10,6 @@ class Task {\n ctx\n-a\n+b\n+c\n+d\n ctx\n', added: 3, removed: 1, truncated: 0 },
  [`${APP}/inbox/IncomingProcessor.java`]: { text: '@@ -1,25 +1,15 @@\n' + '-x\n'.repeat(20) + '+y\n'.repeat(10), added: 10, removed: 20, truncated: 0 },
  [`${APP}/inbox/BasketParser.java`]: { text: '@@ -59,2 +59,7 @@\n ctx\n' + '+p\n'.repeat(5) + ' ctx\n', added: 5, removed: 0, truncated: 0 },
  [`${APP}/inbox/TimeoutCheck.java`]: { text: NEW(40), added: 40, removed: 0, truncated: 0 },
  [`${APP}/util/OldHelper.java`]: { text: '@@ -1,3 +0,0 @@\n-a\n-b\n-c\n', added: 0, removed: 3, truncated: 0 },
  'sql/seeds/2026/01_seed.tbl.sql': { text: NEW(3), added: 3, removed: 0, truncated: 0 },
  [`${APP}/inbox/BasketFailure.java`]: { text: NEW(12), added: 12, removed: 0, truncated: 0 },
};

/** The model the page carries after the build (designModel + applyBuild + addDiffs), by hand. */
export function reviewModel() {
  const P = (id: string, name: string, p: string | null, status: string, kind: string, build: any, extra: any = {}) => ({
    id, name, path: p, status, kind, layer: 'server', module: 'm', build, what: `What ${name} does.`, stories: [] as string[],
    confidence: { level: 'green', reasons: [] }, ...extra,
  });
  const parts = [
    P('loop', 'IncomingProcessor', `${APP}/inbox/IncomingProcessor.java`, 'changed', 'class',
      { state: 'different', story: '001', story_name: '1. Only the reply', plan: 'reads the whole message', built: 'reads only the reply', why: 'The old path fell away.' }),
    P('start', 'Task', `${APP}/jobs/Task.java`, 'changed', 'job', { state: 'as_planned', story: '001', why: null }),
    P('factory', 'ProcessorFactory', `${APP}/inbox/ProcessorFactory.java`, 'existing', 'class', null),
    P('parser', 'BasketParser', `${APP}/inbox/BasketParser.java`, 'changed', 'abstract class', { state: 'as_planned', story: '002', why: null }),
    P('cache', 'BasketCache', null, 'new', 'class', { state: 'gone', story: '002', story_name: '2. Empty reply fails', plan: 'keeps the replies', why: 'Turned out not to be needed.' }),
    P('check', 'TimeoutCheck', `${APP}/inbox/TimeoutCheck.java`, 'new', 'class', { state: 'as_planned', story: '003', why: null }),
    P('status', 'BasketStatus', `${APP}/inbox/BasketStatus.java`, 'existing', 'enum',
      { state: 'gone', story: '001', story_name: '1. Only the reply', plan: 'uses the status', why: 'Another status turned out better.' }),
    P('old', 'OldHelper', `${APP}/util/OldHelper.java`, 'changed', 'class', { state: 'as_planned', story: '002', why: null }),
    P('sql', '01_seed.tbl.sql', 'sql/seeds/2026/01_seed.tbl.sql', 'new', 'SQL script', { state: 'as_planned', story: '001', why: null }),
    P('table', 'BASKETS', 'sql/seeds/2025/01_baskets.tbl.sql', 'existing', 'table', null),
    P('remote', 'RemoteThing', 'src/Remote.java', 'changed', 'class', { state: 'as_planned', story: '001', why: null }, { repo: 'other-repo' }),
    P('failure', 'BasketFailure', `${APP}/inbox/BasketFailure.java`, 'new', 'class',
      { state: 'added', story: '003', story_name: '3. Stuck to failed', plan: null, built: 'A helper that sets a message to failed.', why: 'Two places needed it.' }),
  ];
  const L = (from: string, to: string, step: string) => ({ id: `${from}-${to}`, from, to, kind: 'calls', label: step, step, code: null, proof: null, adds: null });
  const links = [
    L('start', 'loop', 'The task starts the processing'), L('loop', 'parser', 'Reads the reply'), L('loop', 'cache', 'Keeps the reply'),
    L('loop', 'factory', 'Picks the processor'), L('start', 'check', 'Checks the waiting time'), L('check', 'status', 'Sets the status'),
    L('sql', 'table', 'Fills the table'),
  ];
  const S = (id: string, title: string, builds: Record<string, string>) => ({
    id, n: String(Number(id)), title, summary: null, builds, uses: [],
    parts: Object.keys(builds), modules: [], links: links.filter((l) => l.from in builds && l.to in builds).map((l) => l.id),
  });
  const stories = [
    S('001', 'Only the reply', { start: 'starts the processing', loop: 'reads the reply', sql: 'fills the domain', status: 'uses the status', remote: 'calls' }),
    S('002', 'Empty reply fails', { parser: 'reads an empty reply', cache: 'keeps the reply', old: 'goes away' }),
    S('003', 'Stuck to failed', { check: 'checks the waiting time' }),
  ];
  for (const p of parts) p.stories = stories.filter((s) => p.id in s.builds).map((s) => s.id);
  parts.find((p) => p.id === 'failure')!.stories = ['003'];
  return {
    summary: 'The order inbox.', lanes: [{ id: 'server', name: 'Server' }], modules: [{ id: 'm', name: 'shop', status: 'changed', what: null, path: APP, stories: [] }],
    frames: [], parts, links, stories,
    build: {
      stories: stories.map((s) => ({ id: s.id, n: s.n, built: null, different: [], extra: [], gone: [] })),
      different: 1, extra: 1, gone: 2,
      changes: { loop: [{ story: '001', text: 'Now reads only the reply.' }] },
      diffs: { ...DIFFS },
    },
  };
}

export const TITLES = { '001': 'The inbox reads only the reply', '002': 'An empty reply to a lookup fails', '003': 'A stuck message goes to failed' };
/** The rows in lifecycle order, by part id. */
export const LIFECYCLE = ['start', 'loop', 'parser', 'cache', 'check', 'status', 'sql', 'old', 'failure'];

// enough of a selector for the view's lookups: a role, a tag or a class, with :not(.class) after it
const one = (e: any, s: string) => {
  const m = /^(?:\[role="([^"]+)"\]|([a-z][a-z0-9]*)|\.([\w-]+))((?::not\(\.[\w-]+\))*)$/.exec(s.trim());
  if (!m || !e || !e.attrs) return false;
  if ([...m[4].matchAll(/:not\(\.([\w-]+)\)/g)].some((x) => e.classList.contains(x[1]))) return false;
  return m[1] ? e.attrs.role === m[1] : m[2] ? e.tag === m[2] : e.classList.contains(m[3]);
};
const climb = (e: any, sel: string) => { for (let x = e; x; x = x.parent) if (sel.split(',').some((s) => one(x, s))) return x; return null; };

/** A fake document for the view, the page's scripts loaded as the page inlines them; a localStorage of its own. */
export function reviewDom(o: { store?: Map<string, string> | 'throws' } = {}) {
  const d = reviewBase(o);
  G.TdKit = load('design-kit.js');
  G.TdFit = load('design-fit.js');
  G.TdEngine = load('design-engine.js');
  G.TdBuild = load('design-built.js');
  G.TdLayout = load('design-layout.js');
  G.TdAbout = load('design-about.js');
  G.TdDiff = load('design-diff.js');
  G.TdGrip = load('design-grip.js');
  G.TdSwap = load('design-swap.js');
  G.TdRoom = load('design-room.js');
  G.TdReviewList = load('design-review-list.js');
  G.TdReviewSeen = load('design-review-seen.js');
  G.TdReviewSide = load('design-review-side.js');
  load('design-review.js');
  return d;
}

/** The fake document dressed for the view (closest, remove, insertBefore, contains), its globals, a localStorage of its own. */
function reviewBase(o: { store?: Map<string, string> | 'throws' } = {}) {
  const d = fakeDom();
  const make = d.doc.createElement;
  const dress = (e: any) => {
    e.closest = (sel: string) => climb(e, sel);
    e.remove = () => { if (e.parent) e.parent.children = e.parent.children.filter((c: any) => c !== e); e.parent = null; };
    e.insertBefore = (x: any, ref: any) => { const i = e.children.indexOf(ref); e.children.splice(i < 0 ? e.children.length : i, 0, x); x.parent = e; };
    e.contains = (x: any) => { for (let y = x; y; y = y.parent) if (y === e) return true; return false; };
    e.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 30, width: 300, height: 30 });
    e.blur = () => { if (d.doc.activeElement === e) d.doc.activeElement = null; };
    return e;
  };
  d.doc.createElement = (t: string) => dress(make(t));
  d.doc.createElementNS = (_ns: string, t: string) => dress(make(t));
  dress(d.body);
  G.Element = { [Symbol.hasInstance]: (x: any) => !!(x && x.tag) };
  Object.assign(G, { requestAnimationFrame: (f: () => void) => { f(); return 0; }, cancelAnimationFrame() {}, innerWidth: 1440, innerHeight: 900 });
  delete G.matchMedia;
  delete G.ResizeObserver;
  if (o.store === 'throws') {
    G.localStorage = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  } else {
    const m = o.store || new Map<string, string>();
    G.localStorage = { getItem: (k: string) => (m.has(k) ? m.get(k) : null), setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); } };
  }
  return d;
}

/** A key as a browser sends it: the document's capture listeners, the target and up, then the document's others. */
export function press(d: any, target: any, key: string, extra: Record<string, unknown> = {}) {
  const ev: any = { key, target, defaultPrevented: false, stopped: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra };
  ev.preventDefault = () => { ev.defaultPrevented = true; };
  ev.stopPropagation = () => { ev.stopped = true; };
  const ls = d.docListeners.filter((l: any) => l.type === 'keydown');
  for (const l of ls.filter((x: any) => x.capture)) { l.fn(ev); if (ev.stopped) return ev; }
  for (let x = target; x; x = x.parent) { for (const fn of (x.listeners && x.listeners.keydown) || []) fn(ev); if (ev.stopped) return ev; }
  for (const l of ls.filter((x: any) => !x.capture)) { l.fn(ev); if (ev.stopped) return ev; }
  return ev;
}

/** An event of `type` on `el` (input, change, click), its listeners only. */
export function fire(el: any, type: string, extra: Record<string, unknown> = {}) {
  const ev: any = { type, target: el, defaultPrevented: false, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {}, ...extra };
  for (const fn of (el.listeners && el.listeners[type]) || []) fn(ev);
  return ev;
}

/** The view mounted for the fixture after the build; `went` hears "View in the flow". */
export function mountReview(d: any, o: any = {}) {
  const box = d.node('div');
  const went: string[] = [];
  const api = G.TdReview.mount(box, o.model || reviewModel(), { titles: TITLES, phase: 'construction', onFlow: (id: string) => went.push(id), ...o.opts });
  const q = (cls: string) => d.all(box, cls);
  const one = (cls: string) => q(cls)[0];
  const list = () => one('td-rv-list');
  const opts = () => q('td-rv-o');
  const optIds = () => opts().map((x: any) => x.dataset ? x.dataset.id : x.attrs['data-id']);
  const chosen = () => { const s = opts().find((x: any) => x.getAttribute('aria-selected') === 'true'); return s ? s.attrs['data-id'] : null; };
  const head = () => one('td-rv-name');
  const shownName = () => (head() ? head().textContent : null);
  return { box, api, went, q, one, list, opts, optIds, chosen, head, shownName };
}

/** The checkable items of one group of the filter dropdown ('kinds' or 'stories'), as the dropdown holds them. */
export function filterItems(d: any, box: any, group: string) {
  const g = d.all(box, 'td-rv-fgroup').find((x: any) => x.getAttribute('data-group') === group);
  return g ? d.all(g, 'td-rv-fitem') : [];
}

// ---------- The v5 page model after the build, for the embed and the merge request links ----------

export const LOOP = `${APP}/inbox/IncomingProcessor.java`;
/** The page model after the build (v5Model with its build block), by hand: the same intent as reviewModel(). */
export function v5Model(): any {
  const P = (id: string, name: string, p: string | null, status: string, kind: string, extra: any = {}) => ({
    id, name, kind, sub: null, status, path: p, what: `What ${name} does.`, near: [] as string[], stories: [] as string[], layer: 'server', module: 'm', lines: null, ...extra,
  });
  const list = [
    P('loop', 'IncomingProcessor', LOOP, 'changed', 'class'),
    P('start', 'Task', `${APP}/jobs/Task.java`, 'changed', 'job'),
    P('factory', 'ProcessorFactory', `${APP}/inbox/ProcessorFactory.java`, 'existing', 'class'),
    P('parser', 'BasketParser', `${APP}/inbox/BasketParser.java`, 'changed', 'abstract class'),
    P('cache', 'BasketCache', null, 'new', 'class'),
    P('check', 'TimeoutCheck', `${APP}/inbox/TimeoutCheck.java`, 'new', 'class'),
    P('status', 'BasketStatus', `${APP}/inbox/BasketStatus.java`, 'existing', 'enum'),
    P('old', 'OldHelper', `${APP}/util/OldHelper.java`, 'changed', 'class'),
    P('sql', '01_seed.tbl.sql', 'sql/seeds/2026/01_seed.tbl.sql', 'new', 'SQL script', { layer: 'database' }),
    P('table', 'BASKETS', 'sql/seeds/2025/01_baskets.tbl.sql', 'existing', 'table', { layer: 'database' }),
    P('remote', 'RemoteThing', 'src/Remote.java', 'changed', 'class'),
    P('failure', 'BasketFailure', `${APP}/inbox/BasketFailure.java`, 'new', 'class'),
  ];
  const builds: Record<string, string[]> = { '001': ['start', 'loop', 'sql', 'status', 'remote'], '002': ['parser', 'cache', 'old'], '003': ['check', 'failure'] };
  for (const p of list) p.stories = Object.keys(builds).filter((s) => builds[s].includes(p.id));
  const L = (from: string, to: string, step: string) => ({ id: `${from}-${to}`, from, to, kind: 'calls', label: step, code: null, step, intent: true, stories: null });
  const links = [
    L('start', 'loop', 'The task starts the processing'), L('loop', 'parser', 'Reads the reply'), L('loop', 'cache', 'Keeps the reply'),
    L('loop', 'factory', 'Picks the processor'), L('start', 'check', 'Checks the waiting time'), L('check', 'status', 'Sets the status'),
    L('sql', 'table', 'Fills the table'),
  ];
  const S = (id: string, short: string) => ({ id, n: Number(id), title: (TITLES as any)[id], short });
  const stories = [S('001', 'Only the reply'), S('002', 'Empty reply fails'), S('003', 'Stuck to failed')];
  return {
    title: 'Order inbox', phase: 'construction', version: '29-10-2026 12:00', mr: null, mrN: null, intentBranch: null,
    stories, parts: Object.fromEntries(list.map((p) => [p.id, p])), links,
    modules: { m: { id: 'm', name: 'shop', status: 'changed', path: APP, what: null, stories: [] } },
    build: {
      stories: [
        { id: '001', n: '1', built: 'Reads only the reply of a message.',
          different: [{ id: 'loop', name: 'IncomingProcessor', path: LOOP, plan: 'reads the whole message', built: 'reads only the reply', why: 'The old path fell away.' }],
          extra: [], gone: [{ id: 'status', name: 'BasketStatus', path: `${APP}/inbox/BasketStatus.java`, plan: 'uses the status', why: 'Another status turned out better.' }] },
        { id: '002', n: '2', built: null,
          different: [{ id: 'm', name: 'shop', path: APP, plan: 'gets a folder for the replies', built: 'the replies are in inbox', why: null }],
          extra: [], gone: [{ id: 'cache', name: 'BasketCache', path: null, plan: 'keeps the replies', why: 'Turned out not to be needed.' }] },
        { id: '003', n: '3', built: 'Sets a stuck message to failed.', different: [],
          extra: [{ file: `${APP}/inbox/BasketFailure.java`, name: 'BasketFailure', built: 'A helper that sets a message to failed.', why: 'Two places needed it.' }], gone: [] },
      ],
      different: 2, extra: 1, gone: 2,
      changes: { loop: [{ story: '001', text: 'Now reads only the reply.' }] },
      diffs: JSON.parse(JSON.stringify(DIFFS)),
    },
  };
}
