/* The page: which view of the C4 model is shown, what is chosen, which story is pinned. Draws a laid-out view, zooms
   between levels the way C4 reads (into the element you open, out onto the element you came from) and lights up
   relations and stories. It opens on the system context. The frame keeps no address of its own: the overview around
   it has one, and a step of the frame would land in the browser's back button of the overview. Other modules hook in
   with C4.app.on(event, fn): 'show' (a view opened), 'story' (a story pinned or let go). */
(function () {
  'use strict';
  const C4 = window.C4;
  const M = C4.model;
  const { el, T, count, built } = C4.kit;
  const L = C4.layout;
  const $ = (id) => document.getElementById(id);
  L.init(M);

  // what a view shows, under its title in the inspector: the model's own words for it when it has them
  const tense = built ? 'built' : 'plan';
  const CAPTION = { context: T(`caption.context.${tense}`), containers: T('caption.containers') };
  const nameOf = (v) => ((M.containers || {})[v.of] || {}).name || v.title;
  const captionOf = (v) => v.caption || CAPTION[v.key]
    || (v.level === 3 ? T(`caption.components.${tense}`, { name: nameOf(v) }) : v.level === 4 ? T('caption.code', { name: v.title }) : '');
  const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = { key: 'context', sel: null, story: null, hover: null, scale: null, comp: null };
  const hooks = {};
  const emit = (ev, ...a) => (hooks[ev] || []).forEach((f) => f(...a));
  let cur = null;
  let nav = 0;

  // ---------- the parts of the page ----------
  const panel = C4.panel.mount($('side'), M, {
    select: (id) => select(id), hover: (id) => { state.hover = id; lights(); }, pick: (id) => pick(id),
    go: (key, sel) => go(key, { select: sel }), zoom: (id) => zoomInto(id), clear: () => (state.sel ? select(null) : pick(null)),
  });
  const pathbar = C4.path.mount($('path'), M, L, { go });
  const canvas = $('canvas');
  const board = $('board');

  // ---------- drawing ----------
  const V = C4.view.create(canvas, { state, captionOf, reduce, side: $('side'), zoomv: $('zoomv') });
  const { paint, size, swap, reveal, room, seen, scaleOf } = V;
  let sl = 0;
  canvas.addEventListener('scroll', () => { cancelAnimationFrame(sl); sl = requestAnimationFrame(storyNotice); }, { passive: true });

  async function go(key, opts) {
    const o = opts || {};
    const v = L.viewOf(key);
    if (!v) return;
    const my = ++nav;
    let l;
    try { l = await L.layout(key, room()); } catch (e) {
      canvas.replaceChildren(el('p', 'wait', T('drawing.failed')));
      return;
    }
    if (my !== nav) return;
    const from = cur ? cur.v.key : null;
    const dir = !from ? 'none' : L.levelOf(key) > L.levelOf(from) ? 'in' : L.levelOf(key) < L.levelOf(from) ? 'out' : 'side';
    // the drawing is rebuilt: focus that was in it, or on the path, moves to the card you land on
    const ae = document.activeElement;
    const take = !!from && (!ae || ae === document.body || canvas.contains(ae) || $('path').contains(ae));
    if (from !== key && state.scale !== 'fit') state.scale = null;
    state.key = key;
    if (key.startsWith('code:')) state.comp = key.slice(5);
    state.sel = canSelect(v, o.select) ? o.select : null;
    state.hover = null;
    const d = paint(l);
    swap(d, dir, dir === 'in' ? o.origin : o.select);
    cur = d;
    $('vtitle').textContent = v.title;
    C4.legend.shown(v);
    pathbar.render(state);
    lights();
    side();
    if (take) focusCard(state.sel);
    if (from !== key) say(T('say.view', { title: v.title, level: v.level }));
    if (state.sel) reveal([state.sel]); else if (state.story) revealLit();
    emit('show', state);
  }
  /** A card of this view. */
  const canSelect = (v, id) => !!id && v.nodes.some((n) => n.id === id);
  function focusCard(id) {
    const pane = canvas.querySelector(':scope > .pane');
    // nothing chosen: the first card of what the view is about, not a neighbour around it
    const own = cur && (cur.v.scope || (cur.v.boundary ? cur.v.boundary.children : null));
    const first = own && pane && [...pane.querySelectorAll('.node')].find((x) => own.includes(x.dataset.id));
    const n = pane && ((id && pane.querySelector(`.node[data-id="${CSS.escape(id)}"]`)) || first || pane.querySelector('.node'));
    if (n) n.focus({ preventScroll: true });
  }
  /** A word for a screen reader: which view opened, what was chosen. */
  function say(text) {
    const live = $('live');
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = text; });
  }
  /** Into the view a card opens, or out onto the element that holds this view; each done once the view shows. */
  function zoomInto(id) {
    const n = cur && cur.v.nodes.find((x) => x.id === id);
    return n && n.zoom ? go(n.zoom, { origin: id }) : Promise.resolve();
  }
  function zoomOut() {
    const p = cur && L.parentOf(cur.v.key);
    return p ? go(p.key, { select: p.at }) : Promise.resolve();
  }
  const revealLit = () => { if (cur) reveal([...cur.svg.querySelectorAll('.node.lit')].map((n) => n.dataset.id)); };

  // ---------- what is lit ----------
  function lights() {
    if (!cur) return;
    const svg = cur.svg;
    for (const x of svg.querySelectorAll('.lit, .on')) x.classList.remove('lit', 'on');
    for (const x of svg.querySelectorAll('[aria-current]')) x.removeAttribute('aria-current');
    // the card under the pointer, then the chosen one; else the pinned story
    const story = state.story;
    const id = state.hover || state.sel;
    const lit = (sel) => svg.querySelectorAll(sel).forEach((x) => x.classList.add('lit'));
    const has = (x) => cur.v.nodes.some((n) => n.id === x);
    // something pointed at that this drawing leaves out lights nothing
    let any = !!id && has(id);
    if (any) {
      lit(`.node[data-id="${CSS.escape(id)}"]`);
      for (const e of svg.querySelectorAll('.edge, .elabel')) {
        if (e.dataset.from !== id && e.dataset.to !== id) continue;
        e.classList.add('lit');
        for (const end of [e.dataset.from, e.dataset.to]) lit(`.node[data-id="${CSS.escape(end)}"]`);
      }
    } else if (!id && story) {
      const on = new Set(cur.v.nodes.filter((n) => (n.stories || []).includes(story)).map((n) => n.id));
      for (const n of svg.querySelectorAll('.node')) n.classList.toggle('lit', on.has(n.dataset.id));
      for (const e of svg.querySelectorAll('.edge, .elabel')) e.classList.toggle('lit', on.has(e.dataset.from) && on.has(e.dataset.to));
      any = on.size > 0;
    }
    // a story that touches nothing here dims nothing: a word says so instead
    svg.classList.toggle('dim', any);
    storyNotice();
    if (state.sel) svg.querySelectorAll(`.node[data-id="${CSS.escape(state.sel)}"]`).forEach((n) => { n.classList.add('on'); n.setAttribute('aria-current', 'true'); });
    for (const b of svg.querySelectorAll('.sbadge')) b.classList.toggle('hot', b.dataset.us === story);
  }
  /** What a story touched, when the drawing cannot show it all: nothing here, or how much lies out of view and where. */
  function storyNotice() {
    if (!cur) return;
    const u = !state.hover && !state.sel && state.story ? M.stories.find((x) => x.id === state.story) : null;
    if (!u) { notice(null); return; }
    const lit = [...cur.svg.querySelectorAll('.node.lit')];
    if (!lit.length) { notice(T(built && u.files && u.files === u.tests ? 'notice.onlyTests' : 'notice.nothingHere', { n: u.n })); return; }
    const c = seen();
    const out = lit.map((n) => n.getBoundingClientRect()).filter((r) => r.right < c.left + 8 || r.left > c.right - 8 || r.bottom < c.top + 8 || r.top > c.bottom - 8);
    if (!out.length) { notice(null); return; }
    const dx = out.reduce((a, r) => a + (r.left + r.right) / 2, 0) / out.length - (c.left + c.right) / 2;
    const dy = out.reduce((a, r) => a + (r.top + r.bottom) / 2, 0) / out.length - (c.top + c.bottom) / 2;
    const where = T(`notice.dir.${Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'down' : 'up') : dx > 0 ? 'right' : 'left'}`);
    const all = out.length === lit.length;
    const key = all ? (out.length === 1 ? 'notice.allOne' : 'notice.allMany') : (out.length === 1 ? 'notice.someOne' : 'notice.someMany');
    notice(T(key, { n: u.n, elements: count('words.element', lit.length), k: out.length, where }));
  }
  function notice(text) {
    const n = $('notice');
    if (n.textContent !== (text || '')) n.textContent = text || '';
    n.hidden = !text;
  }
  function side() {
    if (!cur) return;
    const v = cur.v;
    const n = state.sel && v.nodes.find((x) => x.id === state.sel);
    if (n) panel.node(v, n, state.story);
    else if (state.story) panel.story(state.story);
    else panel.idle(v, captionOf(v));
  }
  function select(id) {
    state.sel = id || null;
    lights();
    side();
    if (!id) return;
    reveal([id]);
    const n = cur && cur.v.nodes.find((x) => x.id === id);
    if (n) say(T('say.chosen', { name: n.name }));
  }
  function pick(id) {
    const was = state.story;
    state.story = id || null;
    if (state.story) state.sel = null;
    lights();
    side();
    emit('story', state);
    if (state.story) { if (!was) state.before = state.scale; fitLit(); }
    else if (was && cur) { state.scale = state.before || null; state.before = null; size(cur); storyNotice(); }
  }
  /** A pinned story's cards all in view: zoom out as far as that takes (not below 40%), then centre them. */
  function fitLit() {
    if (!cur) return;
    const ids = [...cur.svg.querySelectorAll('.node.lit')].map((n) => n.dataset.id);
    const ps = ids.map((i) => cur.pos.get(i)).filter(Boolean);
    if (!ps.length) return;
    const x = Math.min(...ps.map((p) => p.x)), y = Math.min(...ps.map((p) => p.y));
    const w = Math.max(...ps.map((p) => p.x + p.w)) - x, h = Math.max(...ps.map((p) => p.y + p.h)) - y;
    const r = room(), need = Math.min(r.w / w, r.h / h);
    if (need < scaleOf(cur)) { state.scale = Math.max(0.4, need); size(cur); }
    reveal(ids);
    setTimeout(storyNotice, 450);
  }

  // ---------- the pointer and the keys ----------
  C4.input.mount(canvas, { state, select, pick, zoomInto, zoomOut, lights, zoomBy: (d) => zoomBy(d), fit: () => fit() });

  // ---------- tools ----------
  const step = (s, dir) => Math.min(2, Math.max(0.1, (dir > 0 ? Math.floor(s * 10 + 1e-6) + 1 : Math.ceil(s * 10 - 1e-6) - 1) / 10));
  const zoomBy = (dir) => { if (!cur) return; state.scale = step(scaleOf(cur), dir); size(cur); };
  const fit = () => { if (!cur) return; state.scale = 'fit'; size(cur); };
  $('zin').addEventListener('click', () => zoomBy(1));
  $('zout').addEventListener('click', () => zoomBy(-1));
  $('zfit').addEventListener('click', fit);
  // full screen takes the inspector along, so a chosen card still shows what it is
  const stage = board.parentElement;
  $('zfull').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement, b = $('zfull');
    const label = T(on ? 'tools.fullClose' : 'tools.full');
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', label);
    b.title = label;
    if (state.scale !== 'fit') state.scale = null;
    if (cur) size(cur);
  });
  let rt = 0;
  new ResizeObserver(() => { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => { if (cur && (!state.scale || state.scale === 'fit')) size(cur); }); }).observe(canvas);

  C4.app = { go, select, pick, zoomInto, zoomOut, lights, reveal, say, panel, state: () => ({ ...state }), cur: () => cur,
    on: (ev, fn) => { (hooks[ev] = hooks[ev] || []).push(fn); } };

  // ---------- start ----------
  const ready = document.fonts && document.fonts.load
    ? Promise.all(['700 14px "DM Sans"', '400 12.5px "DM Sans"', '600 11.5px "DM Sans"', '500 11.5px "DM Sans"', '650 11.5px "DM Sans"'].map((f) => document.fonts.load(f))).catch(() => {})
    : Promise.resolve();
  ready.then(() => go('context'));
})();
