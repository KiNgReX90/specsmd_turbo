/**
 * AI-DLC Turbo overview, "Maquette": the Code Scaffold as a scale model.
 *
 *   TdMaquette.dress(svg, { geo, nodes, edges, frames, steps, SIZE })
 *     called by the engine (design-engine.js) once the drawing is drawn, on the overview only (body.mq):
 *     the lanes become plates with an edge and a shadow; a part stands on a plinth in the colour of its
 *     module and casts its shadow on the plate. When a person
 *     switches to the drawing (a click or a key of their own) the model assembles in about a second: the
 *     plates slide in, the parts come down in the order the flow reads, the lines are drawn step by step,
 *     the steps and the walk come in. The page opening on the drawing (after the build) assembles it too;
 *     a scripted switch, a slow load, a hidden tab or reduced motion: it is simply there.
 *
 * Uses root.Mq (maquette-page.js).
 */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  const M = () => root.Mq;
  const num = (el, a) => parseFloat(el.getAttribute(a)) || 0;
  let dressedAt = -1e9, opened = false;

  function dress(svg, o) {
    const mq = M();
    if (!mq || !document.body || !document.body.classList.contains('mq') || svg.dataset.mq) return;
    svg.dataset.mq = '1';
    dressedAt = performance.now();
    mq.softFilter(svg, 'mq-soft-td', 6);
    mq.softFilter(svg, 'mq-soft-plate', 10);
    // the plates: an edge under each lane and a shadow on the mat, the width kept with the lane's
    for (const r of svg.querySelectorAll('rect.td-lane')) {
      const cast = r.cloneNode(false), side = r.cloneNode(false);
      cast.setAttribute('class', 'mq-pcast');
      cast.setAttribute('filter', 'url(#mq-soft-plate)');
      side.setAttribute('class', 'mq-lside');
      const sync = () => {
        const w = r.getAttribute('width'), y = num(r, 'y');
        for (const [el, dy] of [[cast, 14], [side, 7]]) { if (w) el.setAttribute('width', w); el.setAttribute('y', y + dy); }
      };
      sync();
      r.before(cast, side);
      new MutationObserver(sync).observe(r, { attributes: true, attributeFilter: ['width', 'y'] });
    }
    // a part on its plinth, the plinth in the colour of its module, its shadow on the plate
    for (const n of o.nodes) {
      const mc = n.tag && n.tag.g && /td-mc(\d)/.exec(n.tag.g.getAttribute('class') || '');
      const base = mq.svgEl('g', { class: 'mq-base ' + (mc ? 'mq-mc' + mc[1] : 'mq-mcx'), 'aria-hidden': 'true' });
      const { x, y, h } = n.b, w = o.SIZE.BW;
      base.append(mq.svgEl('rect', { class: 'mq-cast', x: x + 5, y: y + 14, width: w - 10, height: h, rx: 14, filter: 'url(#mq-soft-td)' }),
        mq.svgEl('rect', { class: 'mq-plinth', x, y: y + 7, width: w, height: h, rx: 10 }));
      n.g.prepend(base);
    }
    // the plates of the labels get an edge, the step numbers are coins
    for (const p of svg.querySelectorAll('.td-plate')) {
      const s = p.cloneNode(false);
      s.setAttribute('class', 'mq-pside');
      s.setAttribute('y', num(p, 'y') + 2.5);
      p.before(s);
    }
    for (const c of svg.querySelectorAll('.td-step circle')) mq.coin(c, 2);
    // a person who switches to the drawing, or a page that opens on it (after the build), sees it assembled;
    // a script, a slow load or a hidden tab gets it whole at once
    const ev = root.event;
    const atLoad = !opened && performance.now() < 1400;
    opened = true;
    const go = !mq.calm() && document.visibilityState === 'visible' && (atLoad || (!!ev && ev.isTrusted));
    requestAnimationFrame(() => { if (go) assemble(svg, o, svg.closest('.td-root')); });
  }

  /** The model put together: the plates, the parts in reading order, the lines step by step. */
  function assemble(svg, o, top) {
    const { play, K, draw } = M();
    play(svg.closest('.td-panel'), K.slab, 0, 560);
    const plates = [...svg.querySelectorAll('rect.td-lane')];
    plates.forEach((r, i) => { for (const el of [r, r.previousElementSibling, r.previousElementSibling && r.previousElementSibling.previousElementSibling]) play(el, K.slide, 80 + i * 60, 480); });
    for (const t of svg.querySelectorAll('.td-lane-t')) play(t, K.fade, 200, 420);
    const visit = (o.geo.flow && o.geo.flow.visit) || [];
    const at = new Map(visit.map((id, i) => [id, i]));
    const nodes = o.nodes.slice().sort((a, b) => (at.has(a.p.id) ? at.get(a.p.id) : 1e3 + a.b.x) - (at.has(b.p.id) ? at.get(b.p.id) : 1e3 + b.b.x));
    nodes.forEach((n, k) => {
      const t = 160 + k * 18;
      play(n.g, K.drop, t, 440);
      play(n.g.querySelector('.mq-cast'), K.land, t, 440);
      if (n.tag) play(n.tag.g, K.drop, t + 30, 400);
    });
    const order = (o.geo.flow && o.geo.flow.order) || [];
    const step = new Map(order.map((id, i) => [id, i]));
    const edges = o.edges.slice().sort((a, b) => (step.has(a.l.id) ? step.get(a.l.id) : 1e3) - (step.has(b.l.id) ? step.get(b.l.id) : 1e3));
    const e0 = 160 + Math.min(nodes.length, 8) * 18 + 130;
    edges.forEach((e, k) => {
      const t = e0 + k * 10;
      draw(e.g.querySelector('path:not(.td-hit)'), t, 300);
      play(e.lg, K.pop, t + 180, 240);
    });
    if (top) {
      const box = top.querySelector('.td-stage > .td-steps');
      if (box) play(box, K.slide, 140, 560);
      const walk = top.querySelector('.td-ctl-l');
      if (walk) play(walk, K.drop, 340, 480);
      const keys = top.querySelector('.td-ctl .td-steps-keys');
      if (keys) play(keys, K.fade, 480, 380);
      const bar = top.querySelector('.td-tbar');
      if (bar) play(bar, K.rise, 100, 480);
      const note = top.querySelector('.td-note');
      if (note) play(note, K.fade, 60, 440);
    }
  }

  root.TdMaquette = { dress };
  if (root.Mq) root.Mq.drawn = () => performance.now() - dressedAt > 400 && dressedAt > 0;
})(typeof globalThis !== 'undefined' ? globalThis : this);
