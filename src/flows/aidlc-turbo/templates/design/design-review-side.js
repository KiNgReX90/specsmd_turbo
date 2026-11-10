/**
 * AI-DLC Turbo - Code Scaffold, the list of files at the left of the Review
 * tab, as GitLab's file browser of a merge request: a list that scrolls,
 * never a dropdown.
 *
 * On top the ways to narrow it: a search on the name or the path (* as a
 * wildcard, "/" goes there from anywhere in the tab), the order (Order of
 * the flow first, Name (A-Z), Folders, Largest change; remembered per
 * viewer) and beside it one dropdown "Filter" (design-review-filter.js) to
 * turn on the kinds in the list (New, Changed, Removed, Different, Added,
 * Not built/used), each with its count, and the stories ("US 001" with its
 * title): one kind or story of a row is enough, the search, the kinds and
 * the stories must all hold (TdReviewList.filter). Under them "n of N files"
 * and "Hide viewed". "x of N viewed" with a thin bar is `prog`, for the head
 * of the list, as GitLab shows it over the files.
 *
 * Then the rows: the icon of the legend for what happened to the file, its
 * name, a muted short path, +n / -n, the mark of a deviation and a tick when
 * viewed. "Folders" shows them as a tree: a folder folds and unfolds, a chain of
 * single folders as one. One row is always chosen: the first on open, the
 * first that shows when a filter hides the chosen one; a filter that hides
 * every row says so plainly, with a way to clear it, and the file shown
 * stays. A listbox (a tree in Map) with the focus on the list itself: up and
 * down choose the row before or after it, Home and End the first and the
 * last, Enter takes the focus to the file; in the tree the arrows also stop
 * on a folder, right unfolds it (or goes into it), left folds it (or goes to
 * the folder it is in), Enter and Space fold and unfold.
 *
 *   TdReviewSide.create({ rows, stories, seen, titleOf(story), onChoose(id, how), onEnter(), orders })
 *     -> { el, list, search, prog, chosen(), shown(), choose(id, how), step(dir), open(id),
 *          nextUnseen(id), refresh(keep), focusSearch(), index(id) }
 *   TdReviewSide.icon(kind) -> the icon of the legend for a row's `icon`
 *   TdReviewSide.count(row, cls) -> +n / -n, or null without a change
 *
 * `rows` are TdReviewList.rows, `seen` TdReviewSeen.create, `orders` the
 * choices of the order control (TdReviewList.ordersOf, else ORDERS). onChoose hears
 * every new choice and how it came: 'start', 'click', 'list' (the keys in
 * the list), 'step' (the next or the one before), 'filter', 'open', 'seen'.
 * step(dir) chooses the next (1) or the one before (-1) in the order shown,
 * open(id) chooses a row after clearing what hides it and brings it in
 * sight. Every text comes from the page's string table (TdText,
 * design.review). The page inlines it as window.TdReviewSide, before the
 * Review tab (design-review.js).
 */
(function (root) {
  'use strict';

  const cjs = typeof module !== 'undefined' && module.exports;
  const K = cjs ? require('./design-kit.js') : root.TdKit;
  const L = () => root.TdReviewList || (cjs ? require('./design-review-list.js') : null);
  const F = () => root.TdReviewFilter || (cjs ? require('./design-review-filter.js') : null);
  const E = () => root.TdEngine;
  const NS = 'http://www.w3.org/2000/svg';
  const TX = cjs ? require('./design-text.js') : root.TdText;
  const t = (key, vars) => TX.t(`design.review.${key}`, vars);
  const ORDER_KEY = 'td-review-order';
  const word = (file) => (file ? t(`file.${file}`) : null);
  const linesOf = (k) => (k === 1 ? t('oneLine') : t('nLines', { n: k }));
  const filesOf = (k) => (k === 1 ? t('oneFile') : t('nFiles', { n: k }));
  const get = (k) => { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } };
  const put = (k, v) => { try { if (root.localStorage) root.localStorage.setItem(k, v); } catch (e) { /* not remembered, works all the same */ } };

  function svg(box, cls) {
    const sv = document.createElementNS(NS, 'svg');
    sv.setAttribute('viewBox', box);
    sv.setAttribute('aria-hidden', 'true');
    sv.setAttribute('focusable', 'false');
    if (cls) sv.setAttribute('class', cls);
    return sv;
  }
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.append(e);
    return e;
  }
  /** The icon of the legend for what happened to the file; a removed file a minus in the same ring. */
  function icon(kind) {
    const s = K.h('span', 'td-rv-si');
    const sv = svg('-14 -14 28 28');
    if (kind === 'removed') {
      const g = el('g', { class: 'td-si td-si-removed', transform: 'scale(1.35)' }, sv);
      el('circle', { r: 10 }, g);
      el('path', { class: 'td-ic', d: 'M-4.6,0 H4.6' }, g);
    } else if (E() && E().statusIcon) E().statusIcon(sv, 0, 0, kind, '');
    s.append(sv);
    return s;
  }
  const line = (d, cls) => { const s = K.h('span', cls); s.innerHTML = `<svg class="td-i" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${d}</svg>`; return s; };
  const CHECK = '<path d="M4.5 10.5l3.6 3.6L15.5 6.5"/>';
  const FOLDER = '<path d="M2.5 6.5a2 2 0 0 1 2-2h3.2l1.8 2h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z"/>';

  /** +n / -n: a count of nothing left out, none at all without a change. */
  function count(r, cls) {
    if (!r.entry || r.entry.omitted || (!r.added && !r.removed)) return null;
    const c = K.h('span', cls || 'td-rv-ct');
    if (r.added || !r.removed) c.append(K.h('span', 'td-rv-plus', '+' + r.added));
    if (r.removed || !r.added) c.append(K.h('span', 'td-rv-min', '−' + r.removed));
    return c;
  }
  /** What a screen reader hears for a row: its name, what happened, the deviation, the lines, viewed. */
  const say = (r, seen) => [r.name, word(r.file), r.devWord, r.added ? t('linesIn', { lines: linesOf(r.added) }) : null,
    r.removed ? t('linesOut', { lines: linesOf(r.removed) }) : null, seen ? t('seenWord') : null].filter(Boolean).join(', ');

  function create(o) {
    const { h } = K;
    const all = o.rows;
    const byId = new Map(all.map((r) => [r.id, r]));
    const uid = 'td-rv-' + Math.random().toString(36).slice(2, 8);
    const ids = new Map(all.map((r, i) => [r.id, `${uid}-f${i}`]));
    const dirIds = new Map();
    const dirId = (k) => { if (!dirIds.has(k)) dirIds.set(k, `${uid}-d${dirIds.size}`); return dirIds.get(k); };
    const saved = get(ORDER_KEY);
    const orders = o.orders || L().ORDERS;
    const st = { q: '', kinds: new Set(), stories: new Set(), hideSeen: false, how: orders.some(([k]) => k === saved) ? saved : 'flow' };
    const closed = new Set();
    let chosen = null, cursor = null, vis = [], lines = [], els = new Map();
    const filt = () => ({ q: st.q, kinds: st.kinds, stories: st.stories, hideSeen: st.hideSeen, seen: (r) => o.seen.has(r) });

    const box = h('div', 'td-rv-sidebox');
    box.id = uid + '-box';
    const tools = h('div', 'td-rv-tools');
    // the search, with "/" as its key
    const find = h('div', 'td-rv-find');
    const search = h('input', 'td-rv-q');
    search.type = 'search';
    search.placeholder = t('search');
    search.setAttribute('aria-label', t('searchLabel'));
    search.setAttribute('aria-keyshortcuts', '/');
    search.setAttribute('autocomplete', 'off');
    search.setAttribute('spellcheck', 'false');
    search.title = t('searchTip');
    const kbd = h('kbd', 'td-rv-kbd', '/');
    kbd.setAttribute('aria-hidden', 'true');
    find.append(search, kbd);
    // the order and "Hide viewed" on one line
    const sort = h('select', 'td-rv-sort');
    sort.setAttribute('aria-label', t('order'));
    sort.title = t('orderTip');
    for (const [k, name] of orders) { const op = h('option', 'td-rv-sortopt', name); op.value = k; sort.append(op); }
    sort.value = st.how;
    const hide = h('label', 'td-rv-hide');
    const hideIn = h('input', 'td-rv-hide-in');
    hideIn.type = 'checkbox';
    hide.append(hideIn, h('span', null, t('hideSeen')));
    // one dropdown to turn on the kinds and the stories in the list
    const n = L().counts(all);
    const filter = F().create({
      groups: [
        { id: 'kinds', label: t('kinds'), items: L().CHIPS.filter(([k]) => n[k]).map(([k, name]) => ({ key: k, label: name, count: n[k] })) },
        { id: 'stories', label: t('stories'), items: (o.stories || []).filter((s) => all.some((r) => r.stories.includes(s.id)))
          .map((s) => ({ key: s.id, label: L().label(s), note: o.titleOf(s), title: t('storySay', { n: Number(s.n) || s.n, title: o.titleOf(s) }) })) },
      ],
      onChange: (g, k, yes) => { const set = g === 'kinds' ? st.kinds : st.stories; if (yes) set.add(k); else set.delete(k); refresh(); },
      onClear: () => { st.kinds.clear(); st.stories.clear(); refresh(); },
    });
    const row = h('div', 'td-rv-trow');
    row.append(sort, filter.el);
    // how many show and how many are viewed
    const sum = h('div', 'td-rv-sum');
    const cnt = h('p', 'td-rv-count');
    const prog = h('div', 'td-rv-prog');
    const progT = h('span', 'td-rv-prog-t');
    const meter = h('span', 'td-rv-meter');
    meter.setAttribute('aria-hidden', 'true');
    const fill = h('i');
    meter.append(fill);
    prog.append(progT, meter);
    sum.append(cnt, hide);
    tools.append(find, row, sum);
    // the rows
    const list = h('div', 'td-rv-list');
    list.id = uid + '-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('tabindex', '0');
    list.setAttribute('aria-label', t('files'));
    const empty = h('div', 'td-rv-empty');
    const emptyT = h('p', 'td-rv-empty-t', t('none'));
    const clear = h('button', 'td-btn td-rv-clear', t('clear'));
    clear.type = 'button';
    empty.append(emptyT, clear);
    empty.hidden = true;
    box.append(tools, list, empty);

    /** A file's row: the icon, the name and its short path, +n / -n, the deviation mark, the tick when viewed. */
    function fileEl(r, level) {
      const tree = level !== undefined;
      const e = h('div', 'td-rv-o' + (r.dev === 'gone' ? ' td-rv-o-gone' : ''));
      e.id = ids.get(r.id);
      e.setAttribute('data-id', r.id);
      e.setAttribute('role', tree ? 'treeitem' : 'option');
      if (tree) { e.setAttribute('aria-level', String(level)); e.style.setProperty('--td-rv-lv', String(level)); }
      const seen = o.seen.has(r);
      e.setAttribute('aria-label', say(r, seen));
      e.title = r.path || r.name;
      const txt = h('span', 'td-rv-txt');
      txt.append(K.soft(h('span', 'td-rv-n'), r.name));
      const end = h('span', 'td-rv-end');
      const c = count(r);
      if (c) end.append(c);
      if (r.dev) {
        const m = h('span', 'td-rv-dv');
        m.title = E() && E().buildTitle ? E().buildTitle(r.part) : r.devWord;
        const sv = svg('-20 -20 40 40', 'td-bi-lg');
        if (E() && E().buildIcon) E().buildIcon(sv, 0, 0, r.dev, '');
        m.append(sv);
        end.append(m);
      }
      if (seen) { const tick = line(CHECK, 'td-rv-tick'); tick.title = t('seen'); end.append(tick); }
      // a list: under the name its short path, the counts and the marks at its end; a tree: all on the name's line
      if (tree) e.append(icon(r.icon), txt, end);
      else {
        const l2 = h('span', 'td-rv-l2');
        l2.append(h('span', 'td-rv-p', r.short || ''), end);
        txt.append(l2);
        e.append(icon(r.icon), txt);
      }
      e.addEventListener('click', () => { cursor = 'f:' + r.id; choose(r.id, 'click'); });
      return e;
    }
    /** A folder's row in the tree: a chevron, the folder, its name (a chain of single folders as one), its files. */
    function dirEl(d, level) {
      const e = h('div', 'td-rv-dir');
      e.id = dirId(d.key);
      e.setAttribute('role', 'treeitem');
      e.setAttribute('aria-level', String(level));
      e.setAttribute('aria-expanded', String(!closed.has(d.key)));
      e.setAttribute('data-key', d.key);
      e.style.setProperty('--td-rv-lv', String(level));
      const files = (x) => x.files.length + x.dirs.reduce((s, y) => s + files(y), 0);
      const k = files(d);
      e.setAttribute('aria-label', t('folder', { name: d.label, files: filesOf(k) }));
      e.title = d.label;
      e.append(line(K.ICON.chev, 'td-rv-chev'), line(FOLDER, 'td-rv-fi'), K.soft(h('span', 'td-rv-dn'), d.label, K.PATH), h('span', 'td-rv-dc', String(k)));
      e.addEventListener('click', () => fold(d.key));
      return e;
    }

    const keyOf = (ln) => (ln.dir ? 'd:' + ln.dir.key : 'f:' + ln.row.id);
    /** The rows as they show now, the choice and the cursor marked. */
    function paint() {
      const tree = st.how === 'tree';
      list.setAttribute('role', tree ? 'tree' : 'listbox');
      lines = tree ? L().lines(L().tree(vis), closed) : vis.map((r) => ({ row: r }));
      els = new Map();
      list.replaceChildren(...lines.map((ln) => {
        const e = ln.dir ? dirEl(ln.dir, ln.level) : fileEl(ln.row, tree ? ln.level : undefined);
        els.set(keyOf(ln), e);
        return e;
      }));
      const N = all.length, seen = o.seen.count(all);
      cnt.textContent = t('shown', { shown: vis.length, files: filesOf(N) });
      progT.textContent = t('progress', { seen, n: N });
      fill.style.setProperty('--td-rv-done', String(N ? Math.round(seen / N * 1000) / 1000 : 0));
      empty.hidden = vis.length > 0;
      list.classList.toggle('td-rv-list-none', !vis.length);
      emptyT.textContent = st.hideSeen && seen === N ? t('done') : t('none');
      mark();
    }
    function mark() {
      for (const [k, e] of els) {
        if (k[0] === 'f') {
          const on = k === 'f:' + chosen;
          e.setAttribute('aria-selected', String(on));
          e.classList.toggle('td-rv-on', on);
        }
        e.classList.toggle('td-rv-cur', k === cursor);
      }
      const c = els.get(cursor) || els.get('f:' + chosen);
      if (c) list.setAttribute('aria-activedescendant', c.id); else list.removeAttribute('aria-activedescendant');
    }
    /** Row `key` in sight inside the list, never the page moved for it. */
    function reveal(key) {
      const e = els.get(key);
      if (!e) return;
      if (typeof e.offsetTop === 'number' && list.clientHeight > 0) {
        const top = e.offsetTop, bot = top + e.offsetHeight;
        if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 6);
        else if (bot > list.scrollTop + list.clientHeight) list.scrollTop = bot - list.clientHeight + 6;
      } else if (typeof e.scrollIntoView === 'function') e.scrollIntoView({ block: 'nearest' });
    }

    /** Run the filters and the order again; without `keep` a hidden choice makes way for the first that shows. */
    function refresh(keep) {
      vis = L().filter(L().order(all, st.how), filt());
      paint();
      if (!keep && vis.length && !vis.some((r) => r.id === chosen)) choose(vis[0].id, 'filter');
    }
    /** The folders a row is in open again; true when one was closed. */
    function unfold(r) {
      let opened = false;
      for (const k of [...closed]) {
        const has = k === '?' ? !r.path : k === '/' ? !!r.path && !r.dir : r.dir === k || r.dir.startsWith(k + '/');
        if (has) { closed.delete(k); opened = true; }
      }
      return opened;
    }
    function choose(id, how) {
      const r = byId.get(id);
      if (!r) return false;
      const was = chosen;
      chosen = id;
      cursor = 'f:' + id;
      if (st.how === 'tree' && unfold(r)) paint(); else mark();
      if (how !== 'click' && how !== 'start') reveal(cursor);
      if (was !== id && o.onChoose) o.onChoose(id, how);
      return true;
    }
    function fold(key) {
      if (closed.has(key)) closed.delete(key); else closed.add(key);
      cursor = 'd:' + key;
      paint();
    }
    function step(dir) {
      if (!vis.length) return null;
      const i = vis.findIndex((r) => r.id === chosen);
      const to = i < 0 ? vis[dir > 0 ? 0 : vis.length - 1] : vis[i + dir];
      if (!to) return null;
      choose(to.id, 'step');
      return to.id;
    }
    function open(id) {
      const r = byId.get(id);
      if (!r) return false;
      const why = L().hides(r, filt());
      if (why.includes('q')) { st.q = ''; search.value = ''; }
      if (why.includes('kinds')) { st.kinds.clear(); filter.clear('kinds'); }
      if (why.includes('stories')) { st.stories.clear(); filter.clear('stories'); }
      if (why.includes('seen')) { st.hideSeen = false; hideIn.checked = false; }
      if (why.length) refresh(true);
      choose(id, 'open');
      reveal('f:' + id);
      return true;
    }
    /** The first file after `id` in the order shown that is not viewed, else the first before it; null when all are. */
    function nextUnseen(id) {
      const i = vis.findIndex((r) => r.id === id);
      const later = [...vis.slice(i + 1), ...vis.slice(0, Math.max(0, i))];
      const r = later.find((x) => x.id !== id && !o.seen.has(x));
      return r ? r.id : null;
    }

    search.addEventListener('input', () => { st.q = search.value || ''; refresh(); });
    search.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' || ev.key === 'Esc') {
        ev.preventDefault();
        if (search.value) { search.value = ''; st.q = ''; refresh(); } else list.focus();
      } else if (ev.key === 'ArrowDown' || ev.key === 'Enter') { ev.preventDefault(); list.focus(); }
    });
    sort.addEventListener('change', () => {
      st.how = sort.value;
      put(ORDER_KEY, st.how);
      refresh();
      reveal(cursor);
    });
    hideIn.addEventListener('change', () => { st.hideSeen = !!hideIn.checked; refresh(); });
    clear.addEventListener('click', () => {
      st.q = '';
      search.value = '';
      st.kinds.clear();
      st.stories.clear();
      st.hideSeen = false;
      hideIn.checked = false;
      filter.clear();
      refresh();
      list.focus();
    });

    // the keys of the list: a file chosen as the cursor moves; in the tree the cursor stops on a folder too
    list.addEventListener('keydown', (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.isComposing) return;
      const keys = lines.map(keyOf);
      const i = keys.indexOf(cursor);
      const ln = lines[i];
      let to;
      switch (ev.key) {
        case 'ArrowDown': to = keys[i < 0 ? 0 : Math.min(keys.length - 1, i + 1)]; break;
        case 'ArrowUp': to = keys[i < 0 ? 0 : Math.max(0, i - 1)]; break;
        case 'Home': to = keys[0]; break;
        case 'End': to = keys[keys.length - 1]; break;
        case 'ArrowRight':
          if (!ln || !ln.dir) return;
          if (closed.has(ln.dir.key)) { fold(ln.dir.key); to = null; } else to = keys[i + 1];
          break;
        case 'ArrowLeft':
          if (!ln) return;
          if (ln.dir && !closed.has(ln.dir.key)) { fold(ln.dir.key); to = null; } else to = ln.parent ? 'd:' + ln.parent : null;
          break;
        case 'Enter': case ' ':
          if (ln && ln.dir) { fold(ln.dir.key); to = null; break; }
          if (ev.key === ' ') return;
          ev.preventDefault();
          if (o.onEnter) o.onEnter();
          return;
        default: return;
      }
      ev.preventDefault();
      if (!to) return;
      if (to[0] === 'f') choose(to.slice(2), 'list');
      else { cursor = to; mark(); reveal(to); }
    });

    refresh(true);
    if (vis.length) choose(vis[0].id, 'start');
    return {
      el: box, list, search, prog, chosen: () => chosen, shown: () => vis.slice(), choose, step, open, nextUnseen, refresh,
      focusSearch: () => { search.focus(); if (typeof search.select === 'function') search.select(); },
      index: (id) => vis.findIndex((r) => r.id === id),
    };
  }

  const api = { create, say, icon, count };
  if (cjs) module.exports = api;
  else root.TdReviewSide = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
