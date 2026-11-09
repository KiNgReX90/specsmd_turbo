/**
 * AI-DLC Turbo - Code Scaffold, the steps and the legend beside the drawing.
 *
 * The walk over the steps: play (design-play.js), "Previous" and "Next"
 * (or the arrow keys) in number order, and between them where you are; a
 * step is always held (design-chosen.js), only a story without steps holds
 * none and says "No steps". A step picked lights up its line and the
 * two parts it joins; the details show the part it goes to (design-show.js).
 * With a story chosen only its steps are walked.
 *
 * The panel beside the drawing (`box`) holds the legend: beside the drawing
 * on a wide page, else under it. Folded or open is remembered per viewer,
 * where the browser allows it; without that choice the panel folds where the
 * drawing beside it would get too small (`fold(v)`, not remembered).
 *
 * The engine (design-engine.js) makes it with the drawing; design-panel.js
 * puts the walk and its keys over the drawing and the box where it goes; the
 * walk comes along into the full-screen view (design-view.js). On the page the
 * drawing starts under the walk: band(ctl, left) measures the room the row of
 * the walk (wrapped or not) takes, sets it as
 * --td-ctl-h on the drawing's box (design-steps.css) and returns a reader of
 * it for the fit; while the walk is hidden (the preview) it keeps the last.
 *
 * The keys along the drawing say what Space and the arrows do; the up and
 * down keys show only while a block has the focus (td-near, design-browse.js
 * sets it and the words beside them).
 *
 *   TdSteps.create(model, geo, svg, edges, nodes)
 *     -> { box, nav, keys, band(ctl, left), legend(el), pin(id), go(id), current(), ids(), number(id), total, walk(dir, how), reach(id), filter(ids),
 *          on(fn(id, pinned, how)), onAt(fn(pinned)), onFold(fn), folded(), saved(), fold(v) }
 *   `how` is 'walk' (previous, next, the arrows, the walk under the details, go) or 'play'; `total` counts all steps.
 */
(function (root) {
  'use strict';

  const KEY = 'td-steps-folded';
  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const t = (key, vars) => TX.t(`design.steps.${key}`, vars);
  const ICON = { prev: '<path d="M12 5l-5 5 5 5"/>', next: '<path d="M8 5l5 5-5 5"/>',
    fold: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M8 3.5v13M14 8l-2 2 2 2"/>',
    side: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M8 3.5v13"/>' };

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function btn(cls, icon, label, title) {
    const b = h('button', 'td-btn ' + cls);
    b.type = 'button';
    b.innerHTML = `<svg class="td-i" viewBox="0 0 20 20" aria-hidden="true">${ICON[icon]}</svg>`;
    if (label) b.append(h('span', null, label));
    if (title) { b.title = title; if (!label) b.setAttribute('aria-label', title); }
    return b;
  }
  /** The viewer's own choice: true folded, false open, null never chosen. */
  const load = () => { try { const v = root.localStorage.getItem(KEY); return v === null ? null : v === '1'; } catch (e) { return null; } };
  const save = (v) => { try { root.localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* not remembered, works all the same */ } };

  function create(model, geo, svg, edges, nodes) {
    const flow = geo.flow;
    if (!flow || !flow.order.length) return null;
    const links = new Map(model.links.map((l) => [l.id, l]));
    const all = flow.order.filter((id) => links.has(id));
    const num = new Map(flow.order.map((id, i) => [id, i + 1]));
    const total = all.length;

    // the panel beside the drawing: the legend; folded only a slim rail with the way back
    const box = h('section', 'td-steps');
    box.setAttribute('aria-label', t('legend'));
    const rail = btn('td-steps-rail', 'side', t('legend'), t('openLegend'));
    rail.setAttribute('aria-expanded', 'false');
    const inner = h('div', 'td-steps-in');
    const top = h('div', 'td-steps-top');
    const head = h('div', 'td-steps-head');
    const fold = btn('td-steps-fold', 'fold', null, t('foldLegend'));
    fold.setAttribute('aria-expanded', 'true');
    head.append(h('h3', 'td-steps-t', t('legend')), fold);
    top.append(head);
    const lgPane = h('div', 'td-steps-lg');
    inner.append(top, lgPane);
    box.append(rail, inner);
    /** Take the legend into the panel. */
    const legend = (el) => lgPane.replaceChildren(el);

    // the walk: back, where you are, on (play puts its button in front); a fixed row, so the buttons
    // keep their place whatever the line between them says
    const nav = h('div', 'td-steps-nav');
    const prev = btn('td-steps-prev', 'prev', null, t('prev'));
    const next = btn('td-steps-next', 'next', null, t('next'));
    next.classList.add('td-next');
    const at = h('span', 'td-steps-at');
    at.setAttribute('aria-live', 'polite');
    nav.append(prev, at, next);
    // the keys, for the walk over the drawing (design-panel.js puts them in one line along its bottom); only
    // where there is a keyboard (design-steps.css hides them on touch); on the overview only with its ? on (class how)
    // (its last text says what the arrows do: design-browse.js changes it while a block has the focus)
    const keys = h('p', 'td-steps-keys how');
    const kbd = (raw) => { const s = h('span'); s.innerHTML = raw; return s; };
    const arrow = (title, d, cls) => `<kbd title="${title}"${cls ? ` class="${cls}"` : ''}><svg viewBox="0 0 12 12"><path d="${d}"/></svg></kbd>`;
    keys.append(kbd(`<kbd>${t('space')}</kbd>`), h('span', null, t('playPause')),
      kbd(arrow(t('left'), 'M10 6H2.5M5.5 3L2.5 6l3 3') + arrow(t('right'), 'M2 6h7.5M6.5 3l3 3-3 3')
        + arrow(t('up'), 'M6 10V2.5M3 5.5L6 2.5l3 3', 'td-k-ud') + arrow(t('down'), 'M6 2v7.5M3 6.5l3 3 3-3', 'td-k-ud')),
      h('span', null, t('prevNext')));

    let pinned = null;
    let only = null; // the step ids of the chosen story, or null for all
    const heard = [];
    const ats = []; // who follows the pinned step, as the line between back and on does
    const tell = (id, how) => { for (const fn of heard) fn(id, pinned === id, how); };
    const shown = () => all.filter((id) => !only || only.has(id));

    function light(id) {
      svg.classList.toggle('td-trace', !!id);
      const l = id ? links.get(id) : null;
      for (const e of edges) {
        e.g.classList.toggle('td-hot', e.l.id === id);
        e.lg.classList.toggle('td-hot', e.l.id === id);
      }
      for (const n of nodes) n.g.classList.toggle('td-hot', !!l && (n.p.id === l.from || n.p.id === l.to));
      const vis = shown(), i = pinned ? vis.indexOf(pinned) : -1, n = vis.length;
      at.textContent = num.has(pinned) ? t('stepOf', { n: num.get(pinned), total }) : n === 1 ? t('oneStep') : n ? t('nSteps', { n }) : t('noSteps');
      prev.disabled = i <= 0;
      next.disabled = !vis.length || i === vis.length - 1;
      for (const fn of ats) fn(pinned);
    }
    function pin(id) {
      pinned = id || null;
      light(pinned);
    }
    function walk(dir, how) {
      const vis = shown();
      if (!vis.length) return null;
      const i = pinned ? vis.indexOf(pinned) : -1;
      const j = i < 0 ? 0 : i + dir;
      if (j < 0 || j >= vis.length) return null;
      pin(vis[j]);
      tell(vis[j], how || 'walk');
      return vis[j];
    }
    /** A step picked (on the story card): held, and told as a walk to it. */
    function go(id) {
      if (!links.has(id)) return;
      pin(id);
      tell(id, 'walk');
    }
    prev.addEventListener('click', () => walk(-1));
    /** On the page a step walked to scrolls the page to its line when that is out of sight. */
    function reach(id) {
      const e = edges.find((x) => x.l.id === id);
      if (!e) return;
      const r = (e.lg.firstChild ? e.lg : e.g).getBoundingClientRect();
      if (r.top >= 0 && r.bottom <= innerHeight) return;
      scrollBy({ top: r.top + r.height / 2 - innerHeight / 2, behavior: 'smooth' });
    }
    next.addEventListener('click', () => walk(1));

    /** With a story chosen only its steps are walked; `ids` null walks them all again. */
    function filter(ids) {
      only = ids ? new Set(ids) : null;
      if (pinned && only && !only.has(pinned)) pin(null); else light(pinned);
    }

    let held = 72; // the room the walk takes over the drawing, as measured last
    function band(ctl, left) {
      const under = (el) => (el && el.offsetParent ? el.offsetTop + el.offsetHeight : 0);
      const measure = () => {
        const most = under(left);
        if (!most) return; // hidden: what it took stays reserved, so the fit never flips
        held = most + 12;
        (ctl.parentElement || ctl).style.setProperty('--td-ctl-h', held + 'px');
      };
      measure();
      if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(measure); ro.observe(left); ro.observe(ctl); }
      return () => held;
    }

    const folds = [];
    let isFolded = load() === true;
    /** `auto`: the page folds or opens it for the room it has; only the viewer's own choice is remembered. */
    function setFolded(v, auto) {
      if (auto && v === isFolded) return;
      isFolded = v;
      box.classList.toggle('td-folded', v);
      fold.setAttribute('aria-expanded', String(!v));
      rail.setAttribute('aria-expanded', String(!v));
      if (auto) return;
      save(v);
      for (const fn of folds) fn(v);
    }
    box.classList.toggle('td-folded', isFolded);
    fold.addEventListener('click', () => { setFolded(true); rail.focus({ preventScroll: true }); });
    rail.addEventListener('click', () => { setFolded(false); fold.focus({ preventScroll: true }); });
    light(null);

    return { box, nav, keys, band, legend, pin, go, walk, reach, filter, ids: shown, current: () => pinned, number: (id) => num.get(id) || null, total,
      folded: () => isFolded, saved: load, fold: (v) => setFolded(!!v, true),
      on: (fn) => heard.push(fn), onAt: (fn) => { ats.push(fn); fn(pinned); }, onFold: (fn) => folds.push(fn) };
  }

  root.TdSteps = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
