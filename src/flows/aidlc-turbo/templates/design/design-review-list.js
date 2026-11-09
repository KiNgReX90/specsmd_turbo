/**
 * AI-DLC Turbo - Code Scaffold, what the Review tab lists and in which order,
 * as GitLab's file browser of a merge request.
 *
 * After the build (`built`) a row per part with a change in the code on the
 * page (model.build.diffs, as TdDiff.entry finds it), and per part whose
 * build deviated from the design (different, added, not built, not used)
 * even without one; an existing part the build left alone
 * gets no row. Before the build, or on a page without its build, nothing.
 *
 * While a change the user asked for is open (model.plan) the drawing is the
 * plan, and the parts the build added stand apart in model.build.parts: they
 * are no part of it. Review lists them all the same, as files outside the
 * drawing (`drawn` false), so nothing the build made is lost.
 *
 * A row: the file name (the part's name where it has no file), its folder
 * and a short form of it (the first folder and the last two), what the
 * change did to the file (`file`: new, changed or removed by its first
 * hunk; null without a change), the icon of the legend for it (`icon`), the
 * deviation and its word on the drawing (TdBuild.pillOf), whether the drawing
 * holds it (`drawn`), the lines that came in and went out, the stories that
 * built or changed it, and where it stands in the flow: the first numbered
 * step it takes part in, from it or to it (TdLayout.flowOf numbers them as
 * the drawing does), and its place in the drawing's reading order.
 *
 *   TdReviewList.rows(model, { built }) -> [row]
 *   TdReviewList.order(rows, how) -> rows in the order `how`:
 *     flow  Order of the flow: by the first step (from before to), then
 *           the drawing; a part in no step last, in drawing order; a file
 *           the drawing leaves out (a test, a fix script: a part outside the
 *           lanes with `near`) right after the part it belongs to, by name
 *     name  Name (A-Z): by the file name, digits first, case aside
 *     tree  Folders: the files as the tree of folders shows them
 *     size  Largest change: most lines first; no change last
 *   TdReviewList.tree(rows) -> [folder]  as GitLab shows them: a chain of
 *     single folders as one ({ key, label, dirs, files }), folders first and
 *     by name, files by name; a part without a path in "Without a path" last
 *   TdReviewList.lines(tree, closed) -> [{ dir | row, level, parent }]  the
 *     tree as rows, without what is in a folder whose key is in `closed`
 *   TdReviewList.filter(rows, { q, kinds, stories, hideSeen, seen(row) })
 *     the search on the name or the path (case aside; * any text, then the
 *     whole name or path must fit), one of the kinds and one of the stories
 *     (when any is chosen), the viewed ones hidden; hides(row, f) the parts
 *     of the filter that hide that row ('q', 'kinds', 'stories', 'seen')
 *   TdReviewList.counts(rows) -> { new, changed, removed, different, added, gone }
 *   TdReviewList.label(story) -> "US 001"
 *   TdReviewList.ordersOf(model) -> ORDERS; on a page without a drawing
 *     (model.drawing false) the first is "Order of the build": the parts
 *     in the order the build made them, there is no flow
 *   TdReviewList.links(row, model.build.links) -> [{ story, host, url }]
 *     the merge request of every story of the row that has one, else the
 *     intent's, else none (lib/review-links.cjs); a GitLab one opens on the
 *     file in its changes (`/diffs#` and the file's anchor), another as it is
 *
 * The names of the orders, the kinds, the folder without a path and the top
 * folder come from the page's string table (TdText, design.review): ORDERS,
 * CHIPS and LOOSE are read when they are asked for.
 *
 * Pure: no document. The page inlines it as window.TdReviewList, after the
 * layout and TdBuild, before the Review tab (design-review.js).
 */
(function (root) {
  'use strict';

  const cjs = typeof module !== 'undefined' && module.exports;
  const Lay = () => root.TdLayout || (cjs ? require('./design-layout.js') : null);
  const B = () => root.TdBuild || (cjs ? require('./design-built.js') : null);
  const TX = cjs ? require('./design-text.js') : root.TdText;
  const t = (key, vars) => TX.t(`design.review.${key}`, vars);
  const ORDER_KEYS = ['flow', 'name', 'tree', 'size'];
  const CHIP_KEYS = ['new', 'changed', 'removed', 'different', 'added', 'gone'];
  const orders = () => ORDER_KEYS.map((k) => [k, t(`orders.${k}`)]);
  const chips = () => CHIP_KEYS.map((k) => [k, t(`chips.${k}`)]);
  const DEV = new Set(['different', 'added', 'gone']);
  const LOOSE = () => t('loose'); // the parts without a path, last in the tree
  const TOP = () => t('top'); // a file at the top of the repo
  const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/m;
  const ABC = typeof Intl !== 'undefined' ? new Intl.Collator('en', { numeric: true, sensitivity: 'base' }) : null;
  const abc = (a, b) => (ABC ? ABC.compare(a, b) : a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);

  const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const num = (id) => (/^\d+$/.test(String(id)) ? String(Number(id)) : String(id));
  const base = (p) => String(p).split('/').pop();
  const hasExt = (p) => /\.[a-z0-9]+$/i.test(base(p));
  const stem = (name) => String(name).replace(/\.[^.]+$/, '') || String(name);

  function label(s) {
    const n = String(s && s.n !== undefined && s.n !== null ? s.n : '');
    return 'US ' + (/^\d+$/.test(n) ? n.padStart(3, '0') : n);
  }

  /** The parts of the drawing, and, while a change is open, the parts the build added that stand apart (loose). */
  function partsOf(model) {
    const own = (model && model.parts) || [];
    const apart = Object.values((model && model.build && model.build.parts) || {}).map((p) => ({ ...p, loose: true }));
    return apart.length ? [...own, ...apart] : own;
  }

  /** The first folder and the last two: app/.../orders/inbox; a short folder whole. */
  function short(dir) {
    const segs = String(dir || '').split('/').filter(Boolean);
    return segs.length <= 3 ? segs.join('/') : `${segs[0]}/…/${segs.slice(-2).join('/')}`;
  }

  /** The change of the part's file on the page, as TdDiff.entry finds it; null without one. */
  function entryOf(build, p) {
    const diffs = build && build.diffs;
    if (!diffs || !p || !p.path || p.repo || !own(diffs, p.path)) return null;
    return diffs[p.path] || null;
  }

  /** What the change did to the file: new or removed by its first hunk, else changed; null without a change. */
  function fileOf(e, p) {
    if (!e) return null;
    if (e.omitted) return p.status === 'new' ? 'new' : 'changed';
    const m = HUNK.exec(e.text || '');
    if (m && m[1] === '0' && m[2] === '0') return 'new';
    if (m && m[3] === '0' && m[4] === '0') return 'removed';
    return 'changed';
  }
  const lines = (e, sign) => String((e && e.text) || '').split('\n').filter((l) => l[0] === sign).length;
  const amount = (e, k, sign) => (!e || e.omitted ? 0 : Number.isFinite(e[k]) ? e[k] : lines(e, sign));

  /** The stories that built or changed part p: those whose drawing builds it, the one its build names, those whose builder wrote of it. */
  function storiesOf(model, p) {
    const mine = new Set((p.stories || []).map(num));
    if (p.build && p.build.story) mine.add(num(p.build.story));
    for (const c of ((model.build && model.build.changes) || {})[p.id] || []) if (c && c.story) mine.add(num(c.story));
    return model.stories.filter((s) => mine.has(num(s.id)) || own(s.builds, p.id)).map((s) => s.id);
  }

  function rows(model, o) {
    const b = model && model.build;
    if (!o || !o.built || !b) return [];
    const L = Lay();
    const parts = partsOf(model);
    const flow = L && L.flowOf ? L.flowOf(model) : { steps: new Map(), visit: model.parts.map((p) => p.id) };
    // the first numbered step of each part, and whether it is where the step starts (0) or where it goes (1)
    const first = new Map();
    for (const l of model.links) {
      const n = flow.steps.get(l.id);
      if (!n) continue;
      for (const [id, side] of [[l.from, 0], [l.to, 1]]) {
        const f = first.get(id);
        if (!f || n < f[0]) first.set(id, [n, side]);
      }
    }
    const at = new Map(flow.visit.map((id, i) => [id, i]));
    const out = [];
    for (const p of parts) {
      const e = entryOf(b, p);
      const dev = p.build && DEV.has(p.build.state) ? p.build.state : null;
      if (!e && !dev) continue;
      const path = p.path || null;
      const file = path && hasExt(path);
      const name = file ? base(path) : p.name || p.id;
      const dir = !path ? '' : file ? path.split('/').slice(0, -1).join('/') : path;
      const kind = fileOf(e, p);
      const added = amount(e, 'added', '+'), removed = amount(e, 'removed', '-');
      // a file the drawing leaves out stands right after the drawn part it belongs to (near)
      const near = !first.has(p.id) && p.near && at.has(p.near) ? p.near : null;
      const f = first.get(near || p.id);
      out.push({
        id: p.id, part: p, name, stem: stem(name), path, dir, short: short(dir), drawn: !p.loose,
        file: kind, icon: kind || (p.status === 'new' || p.status === 'changed' ? p.status : 'existing'),
        dev, devWord: dev && B() ? B().pillOf(p) : null, entry: e, added, removed, size: e ? added + removed : -1,
        stories: storiesOf(model, p), first: f ? f[0] : null, side: f ? f[1] : 0, at: at.has(near || p.id) ? at.get(near || p.id) : Infinity, after: near ? 1 : 0,
      });
    }
    return out;
  }

  const INF = Infinity;
  const flowCmp = (a, b) => (a.first === null ? INF : a.first) - (b.first === null ? INF : b.first) || a.side - b.side || a.at - b.at
    || a.after - b.after || (a.after ? abc(a.name, b.name) : 0);
  const nameCmp = (a, b) => abc(a.name, b.name) || abc(a.path || '', b.path || '') || flowCmp(a, b);

  function tree(rs) {
    const top = { name: '', key: '', dirs: new Map(), files: [] };
    const loose = [];
    for (const r of rs) {
      if (!r.path) { loose.push(r); continue; }
      let at = top;
      for (const seg of r.dir.split('/').filter(Boolean)) {
        if (!at.dirs.has(seg)) at.dirs.set(seg, { name: seg, key: at.key ? `${at.key}/${seg}` : seg, dirs: new Map(), files: [] });
        at = at.dirs.get(seg);
      }
      at.files.push(r);
    }
    /** A folder as shown: a chain of single folders as one, folders by name, files by name. */
    function shape(n) {
      let label = n.name, cur = n;
      while (cur.dirs.size === 1 && !cur.files.length) {
        cur = [...cur.dirs.values()][0];
        label += '/' + cur.name;
      }
      return { key: cur.key, label, dirs: [...cur.dirs.values()].sort((a, b) => abc(a.name, b.name)).map(shape), files: cur.files.slice().sort(nameCmp) };
    }
    const out = [...top.dirs.values()].sort((a, b) => abc(a.name, b.name)).map(shape);
    if (top.files.length) out.push({ key: '/', label: TOP(), dirs: [], files: top.files.slice().sort(nameCmp) });
    if (loose.length) out.push({ key: '?', label: LOOSE(), dirs: [], files: loose.slice().sort(nameCmp) });
    return out;
  }

  /** The tree as rows, a folder in `closed` without what is in it. */
  function linesOf(t, closed) {
    const out = [];
    const walk = (n, level, parent) => {
      out.push({ dir: n, level, parent });
      if (closed && closed.has(n.key)) return;
      for (const d of n.dirs) walk(d, level + 1, n.key);
      for (const r of n.files) out.push({ row: r, level: level + 1, parent: n.key });
    };
    for (const n of t) walk(n, 1, null);
    return out;
  }

  function order(rs, how) {
    if (how === 'tree') return linesOf(tree(rs), null).filter((x) => x.row).map((x) => x.row);
    const out = rs.slice();
    if (how === 'name') return out.sort(nameCmp);
    if (how === 'size') return out.sort((a, b) => b.size - a.size || flowCmp(a, b));
    return out.sort(flowCmp);
  }

  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  /** Whether row r fits the search q: a piece of its name or path, or with * the whole of one of them. */
  function matcher(q) {
    const t = String(q || '').trim().toLowerCase();
    if (!t) return () => true;
    const fields = (r) => [r.name, r.stem, r.part && r.part.name, r.path].filter(Boolean).map((s) => String(s).toLowerCase());
    if (!t.includes('*')) return (r) => fields(r).some((f) => f.includes(t));
    const re = new RegExp('^' + t.split('*').map(esc).join('.*') + '$');
    return (r) => fields(r).some((f) => re.test(f));
  }

  const kindsOf = (r) => [r.file, r.dev].filter(Boolean);
  const any = (set) => !!set && set.size > 0;
  function hides(r, f) {
    const out = [];
    if (!matcher(f.q)(r)) out.push('q');
    if (any(f.kinds) && !kindsOf(r).some((k) => f.kinds.has(k))) out.push('kinds');
    if (any(f.stories) && !r.stories.some((s) => f.stories.has(s))) out.push('stories');
    if (f.hideSeen && f.seen && f.seen(r)) out.push('seen');
    return out;
  }
  function filter(rs, f) {
    const fit = matcher(f.q);
    const rest = { ...f, q: '' };
    return rs.filter((r) => fit(r) && !hides(r, rest).length);
  }

  function counts(rs) {
    const out = {};
    for (const k of CHIP_KEYS) out[k] = rs.filter((r) => kindsOf(r).includes(k)).length;
    return out;
  }

  /** The orders of the list; without a drawing the first is the order of the build. */
  const ordersOf = (model) => (model && model.drawing === false ? [['flow', t('orders.build')], ...orders().slice(1)] : orders());

  const GITLAB = /\/-\/merge_requests\/\d+\/?$/;
  const hostOf = (url) => (/\/-\/merge_requests\//.test(url) ? 'GitLab' : /^https?:\/\/github\.com\//.test(url) ? 'GitHub' : t('mrHost'));

  function links(r, L) {
    if (!r || !L) return [];
    const p = r.part || {};
    const anchor = p.path && L.anchors && own(L.anchors, p.path) ? L.anchors[p.path] : null;
    const to = (url) => (anchor && GITLAB.test(url) ? `${url.replace(/\/$/, '')}/diffs#${anchor}` : url);
    const mine = (r.stories || []).filter((s) => L.stories && own(L.stories, s)).map((s) => ({ story: s, host: hostOf(L.stories[s]), url: to(L.stories[s]) }));
    if (mine.length) return mine;
    return L.intent ? [{ story: null, host: hostOf(L.intent), url: to(L.intent) }] : [];
  }

  const api = {
    rows, order, tree, lines: linesOf, filter, hides, matcher, counts, kindsOf, label, short, links, ordersOf, partsOf,
    get ORDERS() { return orders(); }, get CHIPS() { return chips(); }, get LOOSE() { return LOOSE(); },
  };
  if (cjs) module.exports = api;
  else root.TdReviewList = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
