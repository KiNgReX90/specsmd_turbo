/**
 * AI-DLC Turbo - Code Scaffold, the Review tab of the overview after the
 * build: the changed files as a merge request in GitLab, no drawing.
 *
 * At the left the list of files (design-review-side.js): every part with a
 * change in the code and every part whose build deviated, in the order of
 * the flow, to search, filter and order as in GitLab. It folds to a slim
 * rail and its width moves by the handle on its edge (design-grip.js), both
 * remembered per viewer; a desktop window under 1100 wide starts with it
 * folded until the viewer chooses. At the right the file chosen: a head with
 * the icon of the legend and the name, the path, +n / -n, the state pill (a
 * deviation is told by its card in the details, never by a pill here),
 * "Viewed", "View in the flow" (`onFlow(id)`: the tab switch opens the
 * Flow tab on that part; not for a file the drawing leaves out) and, once the push recorded them, "GitLab": the
 * file in the merge request of each story that built it, else in the
 * intent's (TdReviewList.links), in a new tab; under it the details and
 * the change in the code side by side, never stacked on a desktop, each
 * column scrolling on its own, the divider between them as in the Flow tab
 * (design-grip.js, the split remembered apart). The details are those of
 * the Flow tab (design-about.js: what it does, what changed, the card of a
 * deviation, in the flow) with the story labels "US 001" on top; the
 * change is that of design-diff.js, its own head left out (the file's head
 * says it), or a plain line where the part has none. Another file fades over
 * (design-swap.js, instant without motion).
 *
 * The tab fits the window under the masthead as the drawing does
 * (design-room.js); it measures again whenever it shows, so it also works
 * when mounted into a container that was hidden until then. On a phone (a
 * window up to 600 wide) the list is a bar on top that opens and closes,
 * then the details, then the change, and the page scrolls.
 *
 * "Viewed" marks a file as viewed (design-review-seen.js, per viewer and per
 * intent: the page's own place) and goes on to the next file not viewed, as
 * GitLab does. The keys, anywhere in the tab unless typing in a field: "/"
 * to the search, "]" or "j" the next file, "[" or "k" the one before. A new
 * file chosen is told once to a screen reader (a polite live region); in
 * the list the list itself tells it.
 *
 *   TdReview.mount(container, model, { titles, phase, onFlow }) -> { open(partId), el }
 *
 * `titles` maps a story id to its full title; `phase` construction with
 * model.build is the page after the build (before it the tab says the files
 * come after the build). open(partId) chooses that file, clearing what hides
 * it, its row in sight; false for a part that is not in the list. Every text
 * comes from the page's string table (TdText, design.review). The page
 * inlines it as window.TdReview, after what it reads.
 */
(function (root) {
  'use strict';

  const cjs = typeof module !== 'undefined' && module.exports;
  const need = (g, f) => root[g] || (cjs ? require('./' + f) : null);
  const K = need('TdKit', 'design-kit.js');
  const TX = need('TdText', 'design-text.js');
  const tx = (key, vars) => TX.t(`design.review.${key}`, vars);
  const PHONE = 600; // up to this window width the list is a bar over the file
  const FOLD_UNDER = 1100; // a desktop window narrower than this starts with the list folded
  const W = { key: 'td-review-list-w', base: 300, min: 200, max: 480, step: 20 };
  const FOLD = 'td-review-list-folded';
  const SPLIT = { key: 'td-review-split', base: 40, a: 220, b: 300, sep: 12, step: 5 };
  // a field, or the open menu of the filter (design-review-filter.js): the tab's own keys rest there
  const FIELD = 'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="menu"]';
  const DIALOG = '[role="dialog"]';
  const word = (file) => (file ? tx(`file.${file}`) : null);
  const linesOf = (k) => (k === 1 ? tx('oneLine') : tx('nLines', { n: k }));
  const ICON = { fold: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M8 3.5v13M13.5 8l-2 2 2 2"/>',
    rail: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M8 3.5v13M11.5 8l2 2-2 2"/>' };
  const get = (k) => { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } };
  const put = (k, v) => { try { if (!root.localStorage) return; if (v === null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v); } catch (e) { /* works all the same */ } };
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const tenth = (v) => Math.round(v * 10) / 10;
  const phone = () => { try { if (root.matchMedia) return root.matchMedia(`(max-width: ${PHONE}px)`).matches; } catch (e) { /* by the width */ } return (root.innerWidth || 1440) <= PHONE; };
  /** Typing in a field: a text box, a list to pick from, an editable text; a checkbox or a button is not. */
  const typing = (t) => { const f = t && typeof t.closest === 'function' ? t.closest(FIELD) : null; return !!f && !/^(checkbox|radio|button|submit|reset)$/.test(String(f.type || '')); };
  const btn = (cls, icon, label, title) => {
    const b = K.h('button', 'td-btn ' + cls);
    b.type = 'button';
    b.innerHTML = `<svg class="td-i" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${icon}</svg>`;
    if (label) b.append(K.h('span', null, label));
    if (title) { b.title = title; if (!label) b.setAttribute('aria-label', title); }
    return b;
  };

  function mount(container, model, opts) {
    const { h } = K;
    const o = opts || {};
    const RL = need('TdReviewList', 'design-review-list.js'), RS = need('TdReviewSeen', 'design-review-seen.js'), Side = need('TdReviewSide', 'design-review-side.js');
    const A = need('TdAbout', 'design-about.js'), D = need('TdDiff', 'design-diff.js'), Swap = need('TdSwap', 'design-swap.js'), Grip = need('TdGrip', 'design-grip.js');
    const E = root.TdEngine, Room = root.TdRoom, Lay = need('TdLayout', 'design-layout.js'), B = need('TdBuild', 'design-built.js');
    const built = o.phase === 'construction' && model && model.build ? model.build : null;
    const rows = RL.rows(model, { built: !!built });
    // a part the drawing shows: its layer is one of the lanes
    const drawn = new Set(((model && model.lanes) || []).map((l) => l.id));
    const rootEl = h('section', 'td-rv');
    rootEl.setAttribute('aria-label', tx('aria'));
    if (!rows.length) {
      rootEl.classList.add('td-rv-nothing');
      rootEl.append(h('p', 'td-rv-none', built ? tx('nothingBuilt') : tx('nothingYet')));
      container.replaceChildren(rootEl);
      return { open: () => false, el: rootEl };
    }
    const titles = o.titles || {};
    const titleOf = (s) => titles[s.id] || s.title;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const scope = o.intent || (root.location && root.location.pathname) || '';
    const seen = RS.create(scope);
    const order = Lay && Lay.flowOf ? Lay.flowOf(model).order : [];
    const about = A.create(model, { built, order });

    // what a screen reader hears once per file; the gradient of the new-icon, in a box of its own that never hides
    const live = h('p', 'td-rv-live');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    const defs = h('span', 'td-rv-defs');
    defs.setAttribute('aria-hidden', 'true');
    defs.innerHTML = '<svg width="0" height="0" focusable="false"><defs><linearGradient id="td-rv-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="td-sg-a"/><stop offset="1" class="td-sg-b"/></linearGradient></defs></svg>';

    // the list at the left: a bar on a phone, a column with a head, a rail when folded, a handle on its edge
    const aside = h('aside', 'td-rv-side');
    aside.setAttribute('aria-label', tx('files'));
    const bar = h('button', 'td-rv-bar');
    bar.type = 'button';
    bar.setAttribute('aria-expanded', 'false');
    const barT = h('span', 'td-rv-bar-t'), barN = h('span', 'td-rv-bar-n');
    bar.append(h('span', 'td-rv-bar-l', tx('files')), barT, barN);
    bar.insertAdjacentHTML('beforeend', `<svg class="td-i td-rv-bar-c" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${K.ICON.chev}</svg>`);
    const shead = h('div', 'td-rv-shead');
    const foldB = btn('td-rv-fold', ICON.fold, null, tx('fold'));
    const st = h('h2', 'td-rv-st', tx('files'));
    shead.append(st, foldB);
    const rail = btn('td-rv-rail', ICON.rail, null, tx('unfold'));
    rail.append(h('span', 'td-rv-rail-t', tx('files')));
    const grip = h('div', 'td-rv-grip');
    for (const [k, v] of [['role', 'separator'], ['aria-orientation', 'vertical'], ['tabindex', '0'], ['aria-label', tx('listWidth')],
      ['aria-valuemin', String(W.min)], ['aria-valuemax', String(W.max)]]) grip.setAttribute(k, v);
    grip.title = tx('listWidthTip');

    // the file at the right: the box another file fades over in
    const main = h('div', 'td-rv-main');
    const file = h('div', 'td-rv-file');
    main.append(file);

    let shown = null; // the file the right side shows
    let told = null; // the file told to a screen reader last
    let nameEl = null; // the name of the file shown, where Enter in the list takes the focus
    let side = null;

    /** The head of the file: the icon and the name, the path, +n / -n, the state pill and the kind, Viewed and the way to the flow. */
    function headOf(r) {
      const p = r.part;
      const hd = h('header', 'td-rv-head');
      const title = h('div', 'td-rv-title');
      const name = K.soft(h('h2', 'td-rv-name'), r.name);
      name.setAttribute('tabindex', '-1');
      title.append(Side.icon(r.icon), name);
      const sub = h('div', 'td-rv-sub');
      if (r.path) sub.append(K.soft(h('code', 'td-rv-path'), (p.repo ? p.repo + ': ' : '') + r.path, K.PATH));
      const meta = h('div', 'td-rv-meta');
      const c = Side.count(r, 'td-rv-ct td-rv-hct');
      if (c) { c.title = tx('countTip', { added: linesOf(r.added), removed: linesOf(r.removed) }); meta.append(c); }
      const word = E && E.statusOf ? E.statusOf(p, true) : '';
      if (word && p.status) meta.append(h('span', 'td-pill td-' + p.status, word));
      const kind = E && E.kindOf ? E.kindOf(p.kind) : null;
      if (kind) meta.append(h('span', 'td-kind', kind));
      sub.append(meta);
      const acts = h('div', 'td-rv-acts');
      const lab = h('label', 'td-rv-seen');
      const box = h('input', 'td-rv-seen-in');
      box.type = 'checkbox';
      box.checked = seen.has(r);
      box.title = tx('seenTip');
      lab.append(box, h('span', null, tx('seen')));
      box.addEventListener('change', () => viewed(r, !!box.checked));
      acts.append(lab);
      // a part the build added while a change is open stands outside the drawing of the plan: no way into it
      if (typeof o.onFlow === 'function' && r.drawn !== false && drawn.has(r.part.layer)) {
        const f = btn('td-rv-flow', '<path d="M3 10h9M9 6l4 4-4 4"/><circle cx="16" cy="10" r="1.6"/>', tx('toFlow'), tx('toFlowTip'));
        f.addEventListener('click', () => o.onFlow(r.id));
        acts.append(f);
      }
      const mrs = RL.links(r, model.build && model.build.links);
      for (const l of mrs) {
        const s = l.story && model.stories.find((x) => x.id === l.story);
        const a = h('a', 'td-btn td-rv-gl');
        a.href = l.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.innerHTML = '<svg class="td-i" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M11 3.5h5.5V9M16.5 3.5 9 11M14 12v3.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1H8"/></svg>';
        a.append(h('span', null, mrs.length > 1 && s ? `${l.host} ${RL.label(s)}` : l.host));
        a.title = l.story ? tx('mrStory', { name: r.name, n: Number(l.story) || l.story, host: l.host }) : tx('mrIntent', { name: r.name, host: l.host });
        acts.append(a);
      }
      hd.append(title, acts, sub);
      return { hd, name, box };
    }

    /** The story labels on top of the details: "US 001", the title in the tooltip. */
    function storiesOf(r) {
      const of = model.stories.filter((s) => r.stories.includes(s.id));
      if (!of.length) return null;
      const box = h('div', 'td-rv-usrow');
      box.append(h('span', 'td-rv-usl', of.length > 1 ? tx('stories') : tx('story')));
      for (const s of of) {
        const say = tx('storySay', { n: Number(s.n) || s.n, title: titleOf(s) });
        const us = h('span', 'td-rv-us', RL.label(s));
        us.title = say;
        us.setAttribute('role', 'img');
        us.setAttribute('aria-label', say);
        box.append(us);
      }
      return box;
    }

    /** Where the part has no change in the code: why, in one line. */
    function noCode(r) {
      if (r.dev === 'gone') return B && B.unused && B.unused(r.part) ? tx('notUsed') : tx('notBuilt');
      return tx('noFile');
    }

    /** The details and the change side by side, the divider between them. */
    function colsOf(r) {
      const cols = h('div', 'td-rv-cols');
      const det = h('div', 'td-rv-det');
      det.setAttribute('role', 'region');
      det.setAttribute('aria-label', tx('detailsOf', { name: r.name }));
      det.setAttribute('tabindex', '0');
      const us = storiesOf(r);
      if (us) det.append(us);
      const facts = about.about('part', r.part);
      det.append(facts || h('p', 'td-rv-nodet', tx('noDetails')));
      const sep = h('div', 'td-dsep');
      cols.append(det, sep, codeOf(r));
      return { cols, sep };
    }

    /** The change; above it, when more than one story changed the file, All and a button per story. */
    function codeOf(r) {
      const code = h('div', 'td-rv-code');
      if (!r.entry) { code.append(h('p', 'td-rv-nocode', noCode(r))); return code; }
      const per = r.entry.stories && Object.keys(r.entry.stories).length > 1 ? r.entry.stories : null;
      const view = h('div', 'td-rv-view');
      if (per) {
        const bar = h('div', 'td-rv-per');
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', tx('perStory'));
        const pick = (id) => {
          view.replaceChildren(D.view(id ? per[id] : r.entry, r.part));
          for (const b of bar.children) b.setAttribute('aria-pressed', String(b.getAttribute('data-per') === (id || '')));
        };
        for (const id of ['', ...Object.keys(per).sort()]) {
          const s = model.stories.find((x) => x.id === id);
          const b = h('button', 'td-btn td-rv-perb', id ? RL.label(s || { n: id }) : tx('all'));
          b.type = 'button';
          b.setAttribute('data-per', id);
          b.title = !id ? tx('allTip') : s ? tx('onlyStoryTitle', { n: Number(id) || id, title: titleOf(s) }) : tx('onlyStory', { n: Number(id) || id });
          b.addEventListener('click', () => pick(id));
          bar.append(b);
        }
        code.append(bar);
        pick('');
      } else view.append(D.view(r.entry, r.part));
      code.append(view);
      return code;
    }

    // the divider before the code: the share of the details in percent, remembered
    let share = Number(get(SPLIT.key));
    if (!(share > 0 && share < 100)) share = SPLIT.base;
    let sep = null;
    const room = () => { const c = sep && sep.parentElement; return c && c.clientWidth ? c.clientWidth - SPLIT.sep : 0; };
    function bounds() {
      const r = room();
      return r > SPLIT.a + SPLIT.b ? [SPLIT.a / r * 100, 100 - SPLIT.b / r * 100] : [10, 90];
    }
    const cur = () => { const [lo, hi] = bounds(); return clamp(share, lo, hi); };
    function paintSplit() {
      const p = tenth(cur());
      rootEl.style.setProperty('--td-rv-a', p + 'fr');
      rootEl.style.setProperty('--td-rv-b', tenth(100 - p) + 'fr');
      if (!sep) return;
      const [lo, hi] = bounds(), n = Math.round(p);
      sep.setAttribute('aria-valuenow', String(n));
      sep.setAttribute('aria-valuemin', String(Math.round(lo)));
      sep.setAttribute('aria-valuemax', String(Math.round(hi)));
      sep.setAttribute('aria-valuetext', tx('splitText', { a: n, b: 100 - n }));
    }
    function wire(s) {
      sep = s;
      for (const [k, v] of [['role', 'separator'], ['aria-orientation', 'vertical'], ['tabindex', '0'], ['aria-label', tx('split')]]) s.setAttribute(k, v);
      s.title = tx('splitTip');
      Grip.bind(s, { axis: 'x', dir: 1, step: SPLIT.step, value: cur,
        per: () => { const r = room(); return r > 0 ? r / 100 : 1; },
        set: (v) => { const [lo, hi] = bounds(); share = tenth(clamp(v, lo, hi)); paintSplit(); },
        keep: () => put(SPLIT.key, String(share)),
        reset: () => { share = SPLIT.base; put(SPLIT.key, null); paintSplit(); },
        on: () => !phone() && s.getClientRects().length > 0 });
      paintSplit();
    }

    /** Show file `id` at the right: the old one fades over into it; the focus on Viewed stays on Viewed. */
    function render(id) {
      const r = byId.get(id);
      if (!r) return;
      const kept = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('td-rv-seen-in');
      shown = id;
      const body = h('div', 'td-rv-fbody');
      const { cols, sep: s } = colsOf(r);
      const hd = headOf(r);
      nameEl = hd.name;
      body.append(hd.hd, cols);
      Swap.put(file, null, body);
      wire(s);
      barT.textContent = r.name;
      where(id);
      if (kept) hd.box.focus({ preventScroll: true });
    }
    /** Where the file stands in the list, on the bar of a phone: "3/12". */
    function where(id) {
      const i = side ? side.index(id) : -1;
      barN.textContent = i < 0 ? '' : `${i + 1}/${side.shown().length}`;
    }
    /** A new choice: shown, and told once to a screen reader unless the list tells it itself. */
    function chosen(id, how) {
      render(id);
      if (how === 'click' && phone()) setBar(false);
      if (how === 'start' || how === 'list' || id === told) return;
      told = id;
      const r = byId.get(id), all = side.shown(), i = side.index(id);
      live.textContent = tx('told', { what: [r.name, word(r.file), r.devWord].filter(Boolean).join(', '), i: i + 1, n: all.length });
    }
    /** Viewed on or off; on goes on to the next file not viewed. */
    function viewed(r, on) {
      const next = on ? side.nextUnseen(r.id) : null;
      seen.set(r, on);
      if (next) side.choose(next, 'seen');
      side.refresh();
    }
    const focusFile = () => { if (nameEl) nameEl.focus(); };

    // the list folds to a rail and gets wider or narrower by its handle; a phone has the bar instead
    let w = Number(get(W.key));
    if (!(w >= W.min && w <= W.max)) w = W.base;
    const f0 = get(FOLD);
    let folded = f0 === '1' || (f0 === null && (root.innerWidth || 1440) < FOLD_UNDER);
    const maxW = () => { const all = rootEl.clientWidth || 0; return all ? clamp(all - 640, W.min, W.max) : W.max; };
    function paintList() {
      rootEl.classList.toggle('td-rv-folded', folded);
      rootEl.style.setProperty('--td-rv-list-w', clamp(w, W.min, maxW()) + 'px');
      grip.setAttribute('aria-valuenow', String(w));
      foldB.setAttribute('aria-expanded', String(!folded));
      rail.setAttribute('aria-expanded', String(!folded));
    }
    function setFold(v) {
      folded = v;
      put(FOLD, v ? '1' : '0');
      paintList();
      (v ? rail : foldB).focus({ preventScroll: true });
    }
    foldB.addEventListener('click', () => setFold(true));
    rail.addEventListener('click', () => setFold(false));
    Grip.bind(grip, { axis: 'x', dir: 1, step: W.step, value: () => w,
      set: (v) => { w = Math.round(clamp(v, W.min, maxW())); paintList(); },
      keep: () => put(W.key, String(w)), reset: () => { w = W.base; put(W.key, null); paintList(); },
      on: () => !folded && !phone() });
    function setBar(v) {
      rootEl.classList.toggle('td-rv-listopen', v);
      bar.setAttribute('aria-expanded', String(v));
    }
    bar.addEventListener('click', () => setBar(!rootEl.classList.contains('td-rv-listopen')));

    // the keys of the tab: / to the search, ] or j the next file, [ or k the one before; not while typing
    const visible = () => rootEl.getClientRects().length > 0;
    document.addEventListener('keydown', (ev) => {
      if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || !visible()) return;
      const t = ev.target && typeof ev.target.closest === 'function' ? ev.target : null;
      if (typing(t) || (t && t.closest(DIALOG))) return;
      if (ev.key === '/') {
        ev.preventDefault();
        if (phone()) setBar(true); else if (folded) { folded = false; paintList(); }
        side.focusSearch();
        return;
      }
      const dir = { ']': 1, j: 1, '[': -1, k: -1 }[ev.key];
      if (!dir) return;
      ev.preventDefault();
      side.step(dir);
    });

    // the height the window has left under the masthead, measured whenever the tab shows or the page moves
    function fit(again) {
      if (!visible()) return;
      paintList();
      paintSplit();
      if (phone() || !Room) { rootEl.style.setProperty('--td-rv-h', ''); return; }
      const H = Room.fit({ inner: root.innerHeight || 900, ...Room.measure(rootEl) });
      if (rootEl.style.getPropertyValue && rootEl.style.getPropertyValue('--td-rv-h') === H + 'px') return;
      rootEl.style.setProperty('--td-rv-h', H + 'px');
      if (!again) fit(true); // what stands below may have moved with it
    }
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => fit());
      ro.observe(rootEl);
      if (document.body) ro.observe(document.body);
    }
    if (typeof root.addEventListener === 'function') root.addEventListener('resize', () => fit());
    if (Room && Room.watch) Room.watch(() => fit());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fit());
    // the list last: it chooses its first file at once, which the right side shows
    side = Side.create({ rows, stories: model.stories, seen, titleOf, onChoose: (id, how) => chosen(id, how), onEnter: focusFile, orders: RL.ordersOf(model) });
    bar.setAttribute('aria-controls', side.el.id);
    shead.insertBefore(side.prog, foldB); // how many are viewed, as GitLab shows it over the files
    aside.append(bar, shead, side.el, rail, grip);
    rootEl.append(live, defs, aside, main);
    container.replaceChildren(rootEl);
    paintList();
    fit();
    if (side.chosen() && shown !== side.chosen()) render(side.chosen());
    where(side.chosen());

    return { open: (id) => side.open(id), el: rootEl };
  }

  const api = { mount };
  root.TdReview = api;
  if (cjs) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
