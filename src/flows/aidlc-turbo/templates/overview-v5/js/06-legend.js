/* The legend under the drawing, whose samples are drawn with the same marks as the drawing itself, in the words of
   the build: what was built, or what will come. Each view shows only what it draws. */
(function () {
  'use strict';
  const C4 = window.C4;
  const { el, svgEl, T, statusOf, STATUS, built, plan } = C4.kit;

  const legend = document.getElementById('legend');
  const sample = (w, h, draw) => { const s = svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' }); draw(s); return s; };
  const group = (name) => { const g = el('span', 'lg'); g.append(el('span', 'vh', name)); legend.append(g); return g; };
  const cards = group(T('legend.cards')), wires = group(T('legend.lines'));
  const item = (svg, text, k, to) => { const s = el('span', 'li'); s.dataset.k = k; s.append(svg, text); (to || cards).append(s); };
  const box = (fill, line, sw, dash) => sample(22, 15, (s) => s.append(svgEl('rect', { x: 1, y: 1, width: 20, height: 13, rx: 4, fill, stroke: line, 'stroke-width': sw, 'stroke-dasharray': dash || null })));
  const line = (color, dash) => sample(30, 12, (s) => {
    s.append(svgEl('path', { d: 'M1 6 H24', stroke: color, 'stroke-width': 1.8, fill: 'none', 'stroke-dasharray': dash || null }));
    s.append(svgEl('path', { d: 'M23 2.2 L29 6 L23 9.8 L24.6 6 Z', fill: color }));
  });
  // while a change is open the drawing is the plan: its words and no marks of the build
  const asBuilt = built && !plan;
  item(box('var(--new-fill)', 'var(--new-line)', 2), asBuilt ? T('panel.builtNew') : STATUS.new, 'new');
  item(box('var(--changed-fill)', 'var(--changed-line)', 2), STATUS.changed, 'changed');
  item(box('var(--surface)', 'var(--exist-line)', 1.2), STATUS.existing, 'existing');
  item(box('var(--ext-fill)', 'var(--ext-line)', 1.4, '4 3'), STATUS.ext, 'ext');
  item(line('var(--accent)'), T('legend.intent'), 'intent', wires);
  item(line('var(--wire)'), STATUS.existing, 'old', wires);
  item(line('var(--accent)', '5 3'), T('legend.ends'), 'ends', wires);
  item(sample(20, 20, (s) => {
    s.append(svgEl('circle', { cx: 10, cy: 10, r: 10, fill: 'var(--surface-2)' }));
    const t = svgEl('text', { x: 10, y: 13.9, 'text-anchor': 'middle', fill: 'var(--heading)', style: 'font:700 11px "DM Sans", sans-serif' });
    t.textContent = '3';
    s.append(t);
  }), T(asBuilt ? 'legend.story.built' : 'legend.story.plan'), 'story');
  // the marks of the build, with the same sign as on the cards (01-shapes.js)
  if (asBuilt) {
    const marks = group(T('legend.build'));
    for (const k of ['different', 'added', 'gone']) {
      item(sample(18, 18, (s) => s.append(C4.shapes.bmark(k, '', 9, 9, 8.5))), T(`build.legend.${k}`), 'b-' + k, marks);
    }
  }

  /** Show only what this view draws, so the legend stays one short line. */
  function shown(v) {
    const has = new Set();
    for (const n of v.nodes) {
      has.add(n.kind === 'person' ? 'person' : statusOf(n));
      if ((n.stories || []).length) has.add('story');
      if (n.dev) has.add('b-' + n.dev);
    }
    for (const e of v.edges) { has.add(e.intent ? 'intent' : 'old'); if (e.ends) has.add('ends'); }
    for (const s of legend.querySelectorAll('[data-k]')) s.hidden = !has.has(s.dataset.k);
    for (const g of legend.querySelectorAll('.lg')) g.hidden = !g.querySelector('[data-k]:not([hidden])');
  }
  C4.legend = { shown };
})();
