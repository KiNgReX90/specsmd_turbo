/**
 * AI-DLC Turbo - Code Scaffold, the details of a part one after the other.
 *
 * The parts go in the drawing's reading order: band by band from the top,
 * in a band column by column from the left (a column per call depth, so the
 * flow reads on), top to bottom in a column. Under the details of a block
 * chosen the chevrons around "n of N" (previous and next, named in their
 * tooltip, with the arrow key only where it does the same) go to the part
 * before and after it, as a click on that part does; the walk stops at the
 * first and the last part. The arrow keys walk
 * the steps (design-play.js); only a drawing without steps lets them walk
 * the parts while a part is chosen. This listens first and takes only the
 * keys it uses. A block with the focus keeps the arrows for itself
 * (design-near.js): this leaves them alone then.
 *
 * Under the details of the part a step goes to (design-show.js) the walk
 * goes step by step instead (stepNav): "Step n of N", the chevrons a step
 * back or on, as the arrows and the walk over the drawing do.
 *
 * The keys along the drawing say what the arrows do: the next step, and
 * while a block has the focus the block in that direction, with the up and
 * down keys shown (td-near).
 *
 * first() is the first block of the walk: what a drawing without steps
 * chooses when nothing else is (design-chosen.js).
 *
 * The words come from the page's string table (TdText, design.browse).
 *
 *   TdBrowse.order(geo) -> [part ids in reading order]
 *   TdBrowse.create({ detail, geo, model, keys, steps, selected(), go(id) })
 *     -> { order, first(), nav(id), stepNav(id), walk(dir) }
 *
 * `keys` is the line of keys over the drawing (its last text names what the
 * arrows do); `steps` the walk over the steps (design-steps.js); `go(id)`
 * chooses that part as a click does. nav(id) is the walk under a part's
 * details, stepNav(id) the one under a step's part. The page inlines it as
 * window.TdBrowse, before the panel.
 */
(function (root) {
  'use strict';

  const K = typeof module !== 'undefined' && module.exports ? require('./design-kit.js') : root.TdKit;
  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const t = (key, vars) => TX.t(`design.browse.${key}`, vars);
  const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="tab"], [role="slider"], [role="listbox"], [role="separator"]';
  const DIALOG = '[role="dialog"]:not(.td-fs)'; // another dialog over the page keeps its keys
  const BLOCK = '.td-node'; // a block with the focus keeps the arrows (design-near.js)

  /** Band by band (by the top of its band), then column by column, then top to bottom. */
  function order(geo) {
    const top = new Map((geo.lanes || []).map((l) => [l.id, l.y]));
    const bandY = (b) => (top.has('band-' + b.band) ? top.get('band-' + b.band) : 0);
    return (geo.blocks || []).slice()
      .sort((a, b) => bandY(a) - bandY(b) || (a.band || 0) - (b.band || 0) || a.x - b.x || a.y - b.y)
      .map((b) => b.id);
  }

  function create(o) {
    const { detail } = o;
    const names = new Map(o.model.parts.map((p) => [p.id, p.name]));
    const ids = order(o.geo).filter((id) => names.has(id));
    const keyT = o.keys && o.keys.lastElementChild;
    const stepKeys = keyT ? keyT.textContent : '';
    let last = {}; // the buttons of the newest walk: the focus moves to them after a press

    const partOn = () => { const s = o.selected(); return !!s && s.kind === 'part'; };
    let near = false; // a block of this drawing has the focus
    /** What the arrows do, told along the drawing: a block in the focus, else the steps (the parts without steps). */
    const hint = () => {
      if (!keyT) return;
      o.keys.classList.toggle('td-near', near);
      keyT.textContent = near ? t('nearKeys') : o.steps ? stepKeys : t('partKeys');
    };
    hint();
    const block = (el) => !!(el && typeof el.closest === 'function' && el.closest(BLOCK));
    if (typeof document !== 'undefined' && o.keys) {
      document.addEventListener('focusin', (ev) => { const v = block(ev.target); if (v !== near) { near = v; hint(); } });
      document.addEventListener('focusout', (ev) => { if (near && block(ev.target) && !block(ev.relatedTarget)) { near = false; hint(); } });
    }

    /** The part `dir` from the one chosen, chosen as a click would; null at an end or without a part. */
    function walk(dir) {
      const s = o.selected();
      const i = s && s.kind === 'part' ? ids.indexOf(s.id) : -1;
      const to = i < 0 ? null : ids[i + dir];
      if (!to) return null;
      o.go(to);
      return to;
    }

    /** A row of the walk: the chevron before, where it is, the chevron after; each only where it goes somewhere. */
    function row(cls, label, count, add) {
      const w = K.h('div', 'td-walk td-browse' + (cls ? ' ' + cls : ''));
      w.setAttribute('role', 'group');
      w.setAttribute('aria-label', label);
      const mine = {};
      const put = (b, icon, go) => {
        if (!b) return;
        b.addEventListener('click', () => {
          if (!go()) return;
          const f = last[icon] || last.prev || last.next;
          if (f) f.focus({ preventScroll: true });
        });
        mine[icon] = b;
        w.append(b);
      };
      put(add(-1), 'prev', () => add.go(-1));
      w.append(count);
      put(add(1), 'next', () => add.go(1));
      last = mine;
      return w;
    }

    /** Previous, where the part is in the order, next: each only where there is one. */
    function nav(id) {
      const i = ids.indexOf(id);
      if (i < 0 || ids.length < 2) return null;
      // a chevron only, as the walk of the steps: its tooltip and its label say where it goes
      const add = (dir) => {
        const to = ids[i + dir];
        const which = dir < 0 ? 'prev' : 'next';
        // the arrow key is named only where it does the same: a drawing without steps
        return to ? K.btn('td-walkb td-' + which, which, null, t(`${o.steps ? 'goPartNoKey' : 'goPart'}.${which}`, { name: names.get(to) })) : null;
      };
      add.go = (dir) => walk(dir);
      const n = K.h('span', 'td-walkn', t('nOfN', { n: i + 1, total: ids.length }));
      n.setAttribute('aria-label', t('elementNOfN', { n: i + 1, total: ids.length }));
      return row('', t('partWalk'), n, add);
    }

    /** Under the details of a step's part: the step before, "Step n of N", the step after; each only where there is one. */
    function stepNav(id) {
      const st = o.steps, n = st && st.number(id);
      if (!n) return null;
      const all = st.ids(), i = all.indexOf(id);
      const add = (dir) => {
        const to = i < 0 ? null : all[i + dir];
        const which = dir < 0 ? 'prev' : 'next';
        return to ? K.btn('td-walkb td-' + which, which, null, t(`goStep.${which}`, { n: st.number(to) })) : null;
      };
      add.go = (dir) => st.walk(dir);
      const at = K.h('span', 'td-walkn', t('stepNOfN', { n, total: st.total }));
      at.setAttribute('aria-label', t('stepNOfN', { n, total: st.total }));
      return row('td-walk-step', t('stepWalk'), at, add);
    }

    // a drawing without steps: the arrows walk the parts, first in line (capture), so play never sees them
    if (typeof document !== 'undefined' && !o.steps) document.addEventListener('keydown', (ev) => {
      if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey || ev.isComposing) return;
      const dir = { ArrowLeft: -1, ArrowRight: 1 }[ev.key];
      if (!dir || !partOn() || detail.hidden || !detail.getClientRects().length) return;
      const el = ev.target && typeof ev.target.closest === 'function' ? ev.target : null;
      if (el && (el.closest(FIELD) || el.closest(DIALOG) || el.closest(BLOCK))) return;
      ev.preventDefault();
      walk(dir);
    }, true);

    return { order: ids, first: () => ids[0] || null, nav, stepNav, walk };
  }

  const api = { order, create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdBrowse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
