/**
 * AI-DLC Turbo - Code Scaffold, the details in a panel of their own right of
 * the drawing.
 *
 * The mirror of the legend left of the drawing (design-steps.js): on a
 * desktop page the panel always stands right of the drawing, which shrinks
 * to make room, never under it. It has one view: the details of one element
 * (design-show.js), text only; the change in the code is in the Review tab.
 * Something is always chosen (design-chosen.js), so the details always
 * show. Only where nothing can be chosen, a story without steps (or a
 * drawing without blocks), a calm word says so, and the drawing never
 * changes width for it. A head names the panel ("Details") and folds it to
 * a slim rail that reads "Details" (its tooltip names what is shown), as
 * the legend folds to its rail; another block chosen while it is folded
 * keeps it folded, and the arrows still walk. Its left edge is a handle
 * with a grip (TdGrip, design-grip.js): drag it (a mouse, a pen, a finger)
 * or use the arrow keys, Home and End, to make the panel wider or narrower,
 * between MIN and the room the drawing keeps to stay readable; a double
 * click puts back the width it opens at (OPEN, a width that suits text).
 * Folded or open and the width are remembered per viewer, where the
 * browser allows it.
 *
 * A desktop window without room for the open panel beside the drawing keeps
 * it at the side as its rail; opened from there it lies over the drawing
 * (td-dtight) until folded again, without touching the viewer's own fold. A
 * phone and the preview keep the details under the drawing as they were.
 *
 *   TdPane.create(detail, { host, draw, steps, desk(), onChange })
 *     -> { el, grip, place(full), width(), folded() }
 *
 * `detail` is the panel's box of details (design-panel.js), `host` the root
 * of the drawing that carries td-dbeside, `draw` the drawing's box beside the
 * panel, `steps` whether the drawing has steps (the calm word names what is
 * missing), `desk()` whether the viewer is at a desktop (no finger).
 * place(full) puts the panel beside the drawing where the stage is `full`
 * wide (0 for the preview) and says whether it did; `onChange()` hears that
 * the room of the drawing changed (the panel came, went, folded, or got
 * another width), at most once a frame. Details fading out (td-dgone,
 * design-swap.js) no longer count: their name is the old part's. The words
 * come from the page's string table (TdText, design.pane). The page
 * inlines it as window.TdPane, after TdGrip, before the panel.
 */
(function (root) {
  'use strict';

  const cjs = typeof module !== 'undefined' && module.exports;
  const K = cjs ? require('./design-kit.js') : root.TdKit;
  const TdGrip = cjs ? require('./design-grip.js') : root.TdGrip;
  const TX = cjs ? require('./design-text.js') : root.TdText;
  const t = (key, vars) => TX.t(`design.pane.${key}`, vars);
  const MIN = 320; // never narrower: the details still read
  const OPEN = 400; // the width it opens at: a column of text, the drawing gets the rest
  const DRAW = 400; // what the drawing keeps beside the panel at least
  const ROOM = 340; // the drawing beside the panel: from MIN + ROOM the open panel stands beside it
  const NEED = MIN + ROOM;
  const TIGHT = 560; // from here to NEED a desktop keeps the panel at the side as its rail, opening over the drawing
  const STEP = 40; // one arrow key
  const KEY_W = 'td-details-width';
  const KEY_F = 'td-details-folded';
  const ICON = { fold: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M12 3.5v13M6 8l2 2-2 2"/>',
    side: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M12 3.5v13"/>',
    pick: '<path d="M5.5 3.5l9.5 5.6-4.2 1.2 2.6 4.6-2 1.1-2.6-4.6-3.3 3z"/>' };
  // nothing to choose: only these leave the details empty
  const EMPTY = (steps) => t(steps ? 'emptySteps' : 'emptyBlocks');

  const get = (k) => { try { return root.localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => {
    try { if (v === null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v); } catch (e) { /* not remembered, works all the same */ }
  };
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  function button(cls, icon, title) {
    const b = K.h('button', 'td-btn ' + cls);
    b.type = 'button';
    b.innerHTML = `<svg class="td-i" viewBox="0 0 20 20" aria-hidden="true">${ICON[icon]}</svg>`;
    b.title = title;
    b.setAttribute('aria-label', title);
    return b;
  }

  function create(detail, o) {
    const { h } = K;
    const el = h('section', 'td-dpane td-dpane-none');
    el.id = 'td-dpane-' + Math.random().toString(36).slice(2, 8);
    el.setAttribute('aria-label', t('rail'));
    const grip = h('div', 'td-dgrip');
    for (const [k, v] of [['role', 'separator'], ['aria-orientation', 'vertical'], ['tabindex', '0'], ['aria-controls', el.id],
      ['aria-label', t('grip')], ['aria-valuemin', String(MIN)]]) grip.setAttribute(k, v);
    grip.title = t('gripTip');
    // folded only the rail, with the way back; open the head with the way to fold it
    const rail = button('td-dpane-rail', 'side', t('unfold'));
    rail.append(h('span', 'td-dpane-name', t('rail')));
    const top = h('div', 'td-dpane-top');
    const fold = button('td-dfold', 'fold', t('fold'));
    top.append(fold, h('h3', 'td-dpane-t', t('rail')));
    // nothing to choose: said calmly, where the details come
    const empty = h('div', 'td-dpane-empty');
    empty.innerHTML = `<svg class="td-i" viewBox="0 0 20 20" aria-hidden="true">${ICON.pick}</svg>`;
    empty.append(h('p', 'td-dpane-empty-t', EMPTY(!!o.steps)));
    if (!detail.id) detail.id = el.id + '-d';
    el.append(grip, rail, top, empty, detail);

    const saved = Number(get(KEY_W));
    let want = Number.isFinite(saved) && saved >= MIN ? Math.round(saved) : OPEN; // the width the viewer chose
    let now = 0; // the width it has
    let beside = false;
    let tight = false; // a desktop without room for it open: the rail at the side, open over the drawing
    let tightOpen = false;
    let folded = get(KEY_F) === '1'; // the viewer's own fold
    let frame = 0;
    let shown = null; // the name in the details, as told last

    function changed() {
      if (!o.onChange || frame) return;
      frame = 1;
      const go = () => { frame = 0; o.onChange(); };
      if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(go); else go();
    }
    const shut = () => (tight ? !tightOpen : folded);
    const seen = () => beside && !shut();
    const open = () => seen() && !tight; // the edge works: beside, open, not over the drawing
    /** The widest it may get: what it and the drawing have together, less what the drawing keeps. */
    const most = () => Math.max(MIN, Math.round((el.offsetWidth || 0) + ((o.draw && o.draw.clientWidth) || 0) - DRAW));
    function set(w) {
      now = w;
      el.style.setProperty('--td-dpane-w', w + 'px');
      grip.setAttribute('aria-valuenow', String(w));
      grip.setAttribute('aria-valuetext', t('width', { w }));
    }
    /** `w` inside its bounds now. */
    function resize(w) {
      const max = most();
      grip.setAttribute('aria-valuemax', String(max));
      want = clamp(Math.round(w), MIN, max);
      if (want !== now) { set(want); changed(); }
    }
    /** The width the viewer chose, inside the room there is now (a window that shrank); the choice stays. */
    function fit() {
      if (!open()) { if (!now) set(want); return; }
      const max = most();
      grip.setAttribute('aria-valuemax', String(max));
      const w = Math.min(want, max);
      if (w !== now) set(w);
    }

    function paintFold() {
      const v = shut();
      el.classList.toggle('td-dfolded', v);
      fold.setAttribute('aria-expanded', String(!v));
      rail.setAttribute('aria-expanded', String(!v));
    }
    /** Over the drawing it opens and folds for now; beside it as the viewer chose, remembered. */
    function setFold(v) {
      if (tight) tightOpen = !v;
      else { folded = v; put(KEY_F, v ? '1' : '0'); }
      paintFold();
      fit();
      if (!tight) changed();
    }
    paintFold();
    fold.addEventListener('click', () => { setFold(true); rail.focus({ preventScroll: true }); });
    rail.addEventListener('click', () => { setFold(false); fold.focus({ preventScroll: true }); });

    // the left edge: left makes the panel wider, right narrower; Home and End its bounds
    TdGrip.bind(grip, { axis: 'x', dir: -1, step: STEP, value: () => now, set: resize, on: open,
      keep: () => put(KEY_W, String(want)), reset: () => { resize(OPEN); put(KEY_W, null); } });

    /** In the details what they show now, not the old ones fading out (design-swap.js). */
    const find = (q) => [...detail.children].filter((c) => c && c.classList && !c.classList.contains('td-dgone')).map((c) => c.querySelector(q)).find(Boolean) || null;
    /** What the details show: the calm word without them, the rail's tooltip named after them, a new block from the top. */
    function sync() {
      const none = !!detail.hidden;
      el.classList.toggle('td-dpane-none', none);
      const head = find('.td-dhead h3');
      const name = !none && head ? head.textContent.replace(/\s+/g, ' ').trim() : '';
      const tip = name ? t('unfoldName', { name }) : t('unfold');
      rail.title = tip;
      rail.setAttribute('aria-label', tip);
      if (name !== shown && detail.parentElement === el) detail.scrollTop = 0;
      shown = name;
    }
    if (typeof MutationObserver !== 'undefined') new MutationObserver(sync).observe(detail, { attributes: true, attributeFilter: ['hidden', 'class'], childList: true });
    sync();

    function place(full) {
      const desk = !o.desk || o.desk();
      const was = tight;
      beside = full >= NEED || (desk && full >= TIGHT);
      tight = beside && full < NEED;
      if (tight && !was) tightOpen = false; // narrow again: the rail first, the drawing in sight
      if (o.host) {
        o.host.classList.toggle('td-dbeside', beside);
        o.host.classList.toggle('td-dtight', tight);
      }
      paintFold();
      fit();
      return beside;
    }

    return { el, grip, place, width: () => now, folded: shut };
  }

  const api = { create, MIN, OPEN, DRAW, NEED, TIGHT, STEP };
  if (cjs) module.exports = api;
  else root.TdPane = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
