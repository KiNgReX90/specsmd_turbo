/**
 * AI-DLC Turbo - the views of the overview page: the tabs on the masthead.
 *
 * Before the build two tabs, "Functional | Code Scaffold"; after it three,
 * "Functional | Code | Review": before the build the drawing is the Code
 * Scaffold to approve, after it the code as it was built. The link to the
 * drawing is #flow either way. Functional (#functional) shows the page without
 * the drawing and without Review, the drawing's tab only the drawing
 * (design-panel.js), Review only the changes file by file (window.TdReview,
 * design-review.js). The body says which: view-tech on the flow view and on
 * Review (the wide layout under the masthead), view-review on Review.
 *
 * The switch is a tablist that looks as the switch before it (the class
 * views, the knob of maquette-page.js): one tab in the Tab order, the chosen
 * one; left and right on the focused switch go to the tab before or after
 * it (round), Home and End to the first and the last; the key goes no
 * further, so the drawing and the page keep their own keys (they leave a
 * tab alone). A click or a key shows the tab and sets the link to it:
 * #functional, #flow or #review. A click of the mouse then lets go of the
 * focus, so the arrows walk the drawing at once.
 *
 * route(hash) says what a link opens: #functional, #flow, #review and
 * #review/<part> (Review on that file, after the build only); a story
 * (#story-2), a part or a module of the drawing opens the flow view there
 * (`follow`); something on the functional side opens
 * Functional; anything else the view the page opened on before (the flow
 * view after the build and on the saved Code Scaffold page, Functional before it).
 *
 * A page without a drawing (an intent built before the Code Scaffold, its
 * changed files as the parts: design.drawing false) has no flow view: two
 * tabs, "Functional | Review", made without `flow`, and `route` with
 * flow: false opens Review wherever it would open the flow view.
 *
 * Review mounts the other view the first time it shows, once:
 * TdReview.mount(container, model, { titles, phase, onFlow }) -> { open(part) }.
 * Without TdReview on the page a short word stands in its place. On a
 * desktop (TdRoom.on) the box gets the height the window has under the
 * masthead, again on a resize and when the masthead changes; elsewhere its
 * own.
 *
 * The way back: the link to the flow in Review leads to the flow view; the
 * masthead then holds the way back to Review beside the tabs, with the file it
 * came from, until Review shows again. A click goes back to that file,
 * however far the viewer walked the drawing (`onBack(part)`); the page shows
 * it only in the flow view.
 *
 *   TdTabs.views(review, flow = true, built = review) -> [[id, label], ...]
 *   TdTabs.create({ page, flow, review, built, onShow(view) }) -> { el, show(view), get() }
 *   TdTabs.route(hash, { review, built, flow, drawing(h), func(h) }) -> { view, part, follow }
 *   TdTabs.reviewer(container, { model, titles, phase, onFlow }) -> { show(), open(part), fit(), mounted() }
 *   TdTabs.back({ onBack(part) }) -> { el, set(part, file), clear(), at() }
 *
 * `page` holds the sections of the page, `flow` is the drawing's section,
 * `review` Review's (null before the build). `built` names the drawing's
 * tab: Code after the build, Code Scaffold before it; without it Review says. The page inlines it as
 * window.TdTabs, after the panel (lib/design-assets.cjs). Its words come from
 * the page's string table (TdText, design.tabs).
 *
 * The page may also hold the v5 page (lib/overview-page.cjs withEmbed: the
 * JSON block #v5-embed, the whole page as one string, parsed before the
 * page's script; this code names no script tag, as it is inlined in one),
 * for a tab of its own: C4 model (#c4) when its model has a system context.
 * The order: Functional, Code Scaffold (Code), C4 model, Review. embed()
 * reads the block once and adds a section per tab to the page, as wide as
 * the drawing's and hidden until its tab shows; the body says view-embed
 * while one shows. The first time a tab shows, its box gets a frame with the
 * v5 page, told before it runs how the switches Details and ? stand
 * (window.C4_EMBED, right after <head>); the page keeps nothing in the
 * browser's storage then. A change after that goes to every frame made as a
 * message, { type: 'turbo-switches', details, help } to any origin:
 * the only way that works wherever the page opens (a file, an artifact in its
 * sandbox, a Confluence attachment). On a desktop the box takes the height
 * under the masthead, as Review's; elsewhere a high window of its own.
 *
 *   TdTabs.views(review, flow, built, { c4 }) -> the views with those tabs
 *   TdTabs.embed({ page, details = true, help = false }) -> null | { has: { c4 }, sections, show(view), set({ details, help }), state() }
 *   TdTabs.create({ ..., embed }) and TdTabs.route(hash, { ..., c4 }) take them along
 */
(function (root) {
  'use strict';

  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const t = (key, vars) => TX.t('design.tabs.' + key, vars);
  // the views in their order, and the key of each one's name in the string table
  const ORDER = [['functional', 'functional'], ['flow', 'flow'], ['c4', 'c4'], ['review', 'review']];
  const viewList = () => ORDER.map(([v, key]) => [v, t(key)]);
  const MOVE = { ArrowLeft: -1, ArrowRight: 1 };
  // the views that are the v5 page in a frame
  const EMBEDDED = new Set(['c4']);
  const isEmbedded = (v) => EMBEDDED.has(v);

  const views = (review, flow = true, built = !!review, embed = null) => viewList()
    .filter(([v]) => (review || v !== 'review') && (flow || v !== 'flow') && (!isEmbedded(v) || !!(embed && embed[v])))
    .map(([v, label]) => [v, v === 'flow' && built ? t('built') : label]);
  const setHash = (h) => { try { root.history.replaceState(null, '', h); } catch (e) { /* the view shows all the same */ } };
  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function create(o) {
    const host = o.embed || null;
    const list = views(!!o.review, !!o.flow, o.built === undefined ? !!o.review : !!o.built, host && host.has);
    const el = h('div', 'views');
    el.setAttribute('role', 'tablist');
    el.setAttribute('aria-label', t('aria'));
    let now = null;
    const panel = { flow: o.flow, review: o.review, ...(host ? host.sections : {}) };
    // what Functional leaves out: the drawing, Review and the tabs of the v5 page
    const apart = [o.flow, o.review, ...(host ? Object.values(host.sections) : [])].filter(Boolean);
    const tabs = list.map(([v, label]) => {
      const b = h('button', null, label);
      b.type = 'button';
      b.id = 'tab-' + v;
      b.setAttribute('role', 'tab');
      b.setAttribute('data-view', v);
      b.setAttribute('aria-selected', 'false');
      b.setAttribute('tabindex', '-1');
      if (panel[v] && panel[v].id) b.setAttribute('aria-controls', panel[v].id);
      // a click of the mouse leaves the focus to the page, so the arrows walk the drawing; Enter or Space keeps it
      b.addEventListener('click', (ev) => { pick(v); if (ev && ev.detail > 0 && typeof b.blur === 'function') b.blur(); });
      b.addEventListener('keydown', (ev) => key(ev, v));
      el.append(b);
      return { v, b };
    });

    /** Show `view`: its tab chosen, only its sections; false for a view the page has not. */
    function show(view) {
      if (!tabs.some((t) => t.v === view)) return false;
      now = view;
      for (const t of tabs) {
        t.b.setAttribute('aria-selected', String(t.v === view));
        t.b.setAttribute('tabindex', t.v === view ? '0' : '-1');
      }
      const own = panel[view];
      for (const n of [...o.page.children]) {
        n.classList.toggle('view-off', own ? n !== own : apart.includes(n));
      }
      document.body.classList.toggle('view-tech', view !== 'functional');
      document.body.classList.toggle('view-review', view === 'review');
      document.body.classList.toggle('view-embed', isEmbedded(view));
      if (host && isEmbedded(view)) host.show(view);
      if (o.onShow) o.onShow(view);
      return true;
    }
    /** A tab chosen by the viewer: shown, and the link names it. */
    function pick(view) {
      if (show(view)) setHash('#' + view);
    }
    function key(ev, view) {
      if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      const i = tabs.findIndex((t) => t.v === view), n = tabs.length;
      const to = ev.key in MOVE ? (i + MOVE[ev.key] + n) % n : ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : -1;
      if (to < 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      tabs[to].b.focus();
      pick(tabs[to].v);
    }
    return { el, show, get: () => now };
  }

  function route(hash, o) {
    let raw = '';
    try { raw = decodeURIComponent(String(hash || '').replace(/^#/, '')); } catch (e) { raw = ''; }
    const at = raw.split(',')[0];
    const out = (view, part, follow) => ({ view, part: part || null, follow: !!follow });
    const rv = /^review(?:\/(.+))?$/.exec(at);
    if (rv && o.review) return out('review', rv[1]);
    if (at === 'c4' && o.c4) return out(at);
    // without a drawing, what the flow view would show is in Review
    const flow = o.flow !== false || !o.review ? (follow) => out('flow', null, follow) : () => out('review');
    if (at === 'flow') return flow(false);
    if (at === 'functional') return out('functional');
    if (at && o.drawing && o.drawing(at)) return flow(true);
    if (at && o.func && o.func(at)) return out('functional');
    return o.built ? flow(false) : out('functional');
  }

  function reviewer(container, o) {
    let api = null, done = false, heard = false;
    function fit() {
      const R = root.TdRoom, V = root.TdView;
      if (!R || !container.getClientRects().length) return;
      const one = R.on({ view: root.innerWidth, touch: !!(V && V.touchy && V.touchy()) });
      container.style.height = one ? R.fit({ inner: root.innerHeight, ...R.measure(container) }) + 'px' : '';
    }
    function mount() {
      if (done) return api;
      done = true;
      const T = root.TdReview;
      if (T && typeof T.mount === 'function') api = T.mount(container, o.model, { titles: o.titles, phase: o.phase, onFlow: o.onFlow }) || null;
      else container.replaceChildren(h('p', 'rv-wait', t('wait')));
      if (!heard) {
        heard = true;
        if (typeof root.addEventListener === 'function') root.addEventListener('resize', fit);
        if (root.TdRoom && root.TdRoom.watch) root.TdRoom.watch(fit); // the masthead got another height
      }
      return api;
    }
    function show() { mount(); fit(); }
    function open(id) {
      show();
      if (api && id && typeof api.open === 'function') api.open(id);
    }
    return { show, open, fit, mounted: () => done };
  }

  function back(o) {
    const el = h('button', 'mast-back');
    el.type = 'button';
    el.hidden = true;
    let at = null;
    el.addEventListener('click', () => { if (at && o.onBack) o.onBack(at); });
    function set(id, file) {
      at = id;
      el.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10H5M9.5 5.5 5 10l4.5 4.5"/></svg>';
      el.append(h('span', 'mast-back-t', t('back')));
      if (file) el.append(h('span', 'mast-back-f', file));
      el.title = file ? t('backTo', { file }) : t('back');
      el.hidden = false;
    }
    function clear() { at = null; el.hidden = true; }
    return { el, set, clear, at: () => at };
  }

  // ---------- the tabs of the v5 page ----------
  // written with \x3c, so this code inlined in the page's own script neither opens nor closes a script tag there
  const DATA = '\x3cscript>window.C4 = { model: ';
  const DATA_END = ' };\x3c/script>';
  /** The v5 page the page holds, and its model (lib/v5-page.cjs dataBlock); null without one. */
  function held() {
    const src = document.getElementById ? document.getElementById('v5-embed') : null;
    let html = null;
    try { html = src ? JSON.parse(src.textContent) : null; } catch (e) { html = null; }
    if (typeof html !== 'string') return null;
    const at = html.indexOf(DATA);
    const end = at < 0 ? -1 : html.indexOf(DATA_END, at);
    let model = null;
    try { model = end < 0 ? null : JSON.parse(html.slice(at + DATA.length, end)); } catch (e) { model = null; }
    return model && typeof model === 'object' ? { html, model } : null;
  }

  function embed(o) {
    const v5 = held();
    if (!v5) return null;
    const M = v5.model;
    const has = { c4: !!(M.views && M.views.context) };
    if (!has.c4) return null;
    const state = { details: o.details !== false, help: o.help === true };
    const sections = {}, boxes = {}, labels = {}, frames = new Map();
    for (const [v, label] of viewList()) {
      if (!isEmbedded(v) || !has[v]) continue;
      const sec = h('section', 'panel td-panel td-embed view-off');
      sec.id = 'sec-' + v;
      sec.setAttribute('aria-label', label);
      const box = h('div', 'td-embed-box');
      sec.append(box);
      o.page.append(sec);
      sections[v] = sec;
      boxes[v] = box;
      labels[v] = label;
    }

    /** The v5 page: told how the switches stand before its code runs. */
    function srcdoc() {
      const set = `\x3cscript>window.C4_EMBED = ${JSON.stringify(state)};\x3c/script>`;
      const at = v5.html.indexOf('<head>');
      return at < 0 ? set + v5.html : v5.html.slice(0, at + 6) + set + v5.html.slice(at + 6);
    }
    function post(f) {
      try { if (f.contentWindow) f.contentWindow.postMessage({ type: 'turbo-switches', ...state }, '*'); } catch (e) { /* the frame is gone */ }
    }
    function fit() {
      const R = root.TdRoom, V = root.TdView;
      const one = !!R && R.on({ view: root.innerWidth, touch: !!(V && V.touchy && V.touchy()) });
      for (const box of Object.values(boxes)) {
        if (!box.getClientRects().length) continue;
        box.style.height = one ? R.fit({ inner: root.innerHeight, ...R.measure(box) }) + 'px' : '';
      }
    }
    let heard = false;
    function show(v) {
      if (!boxes[v]) return;
      if (!frames.has(v)) {
        const f = h('iframe');
        f.title = labels[v];
        f.setAttribute('allowfullscreen', '');
        // once loaded it hears how the switches stand, should they have changed while it loaded
        f.addEventListener('load', () => post(f));
        f.srcdoc = srcdoc();
        boxes[v].append(f);
        frames.set(v, f);
      }
      if (!heard) {
        heard = true;
        if (typeof root.addEventListener === 'function') root.addEventListener('resize', fit);
        if (root.TdRoom && root.TdRoom.watch) root.TdRoom.watch(fit); // the masthead got another height
      }
      fit();
    }
    /** The switches changed: every frame made hears it; one made later starts so. */
    function set(next) {
      const n = next || {};
      if (typeof n.details === 'boolean') state.details = n.details;
      if (typeof n.help === 'boolean') state.help = n.help;
      frames.forEach(post);
    }
    return { has, sections, show, set, state: () => ({ ...state }) };
  }

  const api = { views, create, route, reviewer, back, embed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdTabs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
