/**
 * AI-DLC Turbo - Code Scaffold, the drawing.
 *
 * Draws the geometry of design-layout.js as one SVG: the lanes, the blocks
 * with their status icon, confidence bar (before the build only), kind label, bands and module tag,
 * the links with their labels. Text is measured here, in the browser, and
 * fitted by the rules of design-fit.js: a second line before it gets
 * smaller, smaller before it is cut. Every colour comes from a class in
 * design.css. The page inlines it as window.TdEngine; design-panel.js wires
 * the clicks and the story choice. After the build (opts.built) a part
 * that deviated gets a mark on its corner and a pill ("different", "added",
 * "not built" or "not used"), a module built otherwise a
 * coloured border and a dot on its tag. While a change the user asked for is
 * open (model.plan) the drawing is the plan with that change in it, not yet
 * what was built: it carries none of those marks, on no part, no module and
 * no line. Review still lists every deviation.
 */
(function (root) {
  'use strict';

  const F = typeof module !== 'undefined' && module.exports ? require('./design-fit.js') : root.TdFit;
  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const NS = 'http://www.w3.org/2000/svg';
  // the words of a status, as the legend says them (TdText, design.status and design.moduleStatus): before the
  // build the plan, after it what happened; `gone` for what the build left out, beside its mark "not built" or "not used"
  const STATES = ['new', 'existing', 'changed'];
  const wordsOf = (group, when) => Object.fromEntries(STATES.map((k) => [k, TX.t(`design.${group}.${when}.${k}`)]));
  const low = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '');
  /**
   * The status word of part x (module x with `mod`): after the build (`built`) what happened, before it
   * the plan. A part the build left out says what it is, never that it was built or used: its mark says
   * "not built" or "not used".
   */
  function statusOf(x, built, mod) {
    const when = !built ? 'plan' : x.build && x.build.state === 'gone' ? 'gone' : 'built';
    return STATES.includes(x.status) ? TX.t(`design.${mod ? 'moduleStatus' : 'status'}.${when}.${x.status}`) : '';
  }
  const level = (k) => TX.t(`design.level.${k}`);
  const kindOf = F.kindOf;
  const builtOther = (x) => !!(x && x.build && x.build.state === 'different');

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (parent) parent.append(e);
    return e;
  }
  function txt(parent, attrs, s) {
    const t = el('text', attrs, parent);
    t.textContent = s;
    return t;
  }
  /** A measure for the fit rules: the width of `s` at `fs` px in the font of text `t`. */
  const measureOf = (t) => (s, fs) => { t.style.fontSize = fs + 'px'; t.textContent = s; return t.getComputedTextLength(); };
  const baseOf = (t) => { t.style.fontSize = ''; return parseFloat(getComputedStyle(t).fontSize); };
  /** Write a fit into text `t`: one line as its text, two as lines `dy` apart. */
  function put(t, fitted, dy) {
    const x = t.getAttribute('x');
    t.textContent = '';
    t.style.fontSize = fitted.fs + 'px';
    if (fitted.lines.length === 1) { t.textContent = fitted.lines[0]; return; }
    fitted.lines.forEach((l, i) => { el('tspan', i ? { x, dy } : { x }, t).textContent = l; });
  }
  /** One line in its room: smaller down to `min`, then cut at its end. */
  const fitLine = (t, s, max, min) => put(t, F.lineFit(s, measureOf(t), max, baseOf(t), min));

  // three statuses, so an icon on the border says it: a sparkle (new), arrows going round (used as is), a pencil
  const sparkle = (cx, cy, r) => {
    const a = r * 0.06;
    return `M${cx},${cy - r} Q${cx + a},${cy - a} ${cx + r},${cy} Q${cx + a},${cy + a} ${cx},${cy + r} Q${cx - a},${cy + a} ${cx - r},${cy} Q${cx - a},${cy - a} ${cx},${cy - r} Z`;
  };
  function statusIcon(parent, cx, cy, s, label) {
    const g = el('g', { class: 'td-si td-si-' + s, transform: `translate(${cx},${cy}) scale(1.35)` }, parent);
    if (label) el('title', {}, g).textContent = label;
    el('circle', { r: 10 }, g);
    if (s === 'new') {
      el('path', { class: 'td-ic', d: sparkle(-1, 1, 5.6) }, g);
      el('path', { class: 'td-ic', d: sparkle(4.1, -4.1, 2.2), opacity: 0.92 }, g);
    }
    if (s === 'changed') el('path', { class: 'td-ic', d: 'M-4.6,4.6 L-3.8,1.4 L1.9,-4.3 L4.3,-1.9 L-1.4,3.8 Z' }, g);
    if (s === 'existing') {
      const R = 5.2;
      const rad = (a) => a * Math.PI / 180;
      const f = (v) => v.toFixed(2);
      for (let k = 0; k < 3; k += 1) {
        const a0 = rad(-72 + k * 120);
        const a1 = a0 + rad(70);
        const x1 = R * Math.cos(a1);
        const y1 = R * Math.sin(a1);
        el('path', { class: 'td-arc', d: `M${f(R * Math.cos(a0))},${f(R * Math.sin(a0))} A${R},${R} 0 0 1 ${f(x1)},${f(y1)}` }, g);
        const d = [-Math.sin(a1), Math.cos(a1)];
        const n = [-d[1], d[0]];
        el('path', { class: 'td-ic', d: `M${f(x1 + d[0] * 2.5)},${f(y1 + d[1] * 2.5)} L${f(x1 + n[0] * 2.1)},${f(y1 + n[1] * 2.1)} L${f(x1 - n[0] * 2.1)},${f(y1 - n[1] * 2.1)} Z` }, g);
      }
    }
    return g;
  }
  const BSTATE = { different: true, added: true, gone: true };
  const mark = (s) => (BSTATE[s] ? TX.t(`design.mark.${s}`) : '');
  /** The title of the mark of part p, in the words of the legend: as BSTATE, "Not used" for an existing part drawn to be used and not used. */
  const buildTitle = (p) => (p.build.state === 'gone' && p.status === 'existing' ? TX.t('design.mark.unused') : mark(p.build.state));
  /** The mark of the build on the top left corner of a part, large: ≠ different, + added, − not built or not used. `title` '' (the legend): none. */
  function buildIcon(parent, cx, cy, s, title) {
    const g = el('g', { class: 'td-bi td-bi-' + s, transform: `translate(${cx},${cy})` }, parent);
    const tip = title === undefined ? mark(s) : title;
    if (tip) el('title', {}, g).textContent = tip;
    el('circle', { r: 19 }, g);
    if (s === 'added') el('path', { class: 'td-bi-ic', d: 'M-7.5,0 H7.5 M0,-7.5 V7.5' }, g);
    if (s === 'gone') el('path', { class: 'td-bi-ic', d: 'M-7.5,0 H7.5' }, g);
    if (s === 'different') el('path', { class: 'td-bi-ic', d: 'M-7.5,-3.6 H7.5 M-7.5,3.6 H7.5 M3.2,-8.8 L-3.2,8.8' }, g);
    return g;
  }
  function badge(parent, cx, cy, r) {
    const g = el('g', { class: 'td-nb' }, parent);
    el('circle', { cx, cy, r: r || 10 }, g);
    return txt(g, { x: cx, y: cy + 4.5, 'text-anchor': 'middle' }, '');
  }
  /** Move a story number (the text badge() returned) to cx, cy. */
  function moveBadge(nb, cx, cy) {
    nb.previousElementSibling.setAttribute('cx', cx);
    nb.previousElementSibling.setAttribute('cy', cy);
    nb.setAttribute('x', cx);
    nb.setAttribute('y', cy + 4.5);
  }

  function defsOf(svg) {
    const defs = el('defs', {}, svg);
    const sg = el('linearGradient', { id: 'td-si-grad', x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
    el('stop', { offset: 0, class: 'td-sg-a' }, sg);
    el('stop', { offset: 1, class: 'td-sg-b' }, sg);
    // a head of its own size, not the line's: a thicker line (a story, a step lit) keeps the same head
    const heads = [['td-arr', 'var(--td-edge)', 12], ['td-arr-b', 'var(--td-violet)', 12], ['td-arr-q', 'var(--td-edge-q, var(--td-edge))', 9.5], ['td-arr-h', 'var(--td-hot)', 12], ['td-arr-g', 'var(--td-add-line)', 12]];
    for (const [id, color, size] of heads) {
      const m = el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerUnits: 'userSpaceOnUse', markerWidth: size, markerHeight: size, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0,0 L10,5 L0,10 z', style: 'fill: ' + color }, m);
    }
    return defs;
  }

  /**
   * One block: the fill, the bands, the confidence bar, the outline, the icon, the labels and the texts.
   * The confidence bar only before the build, where the reviewer checks those parts before approving;
   * after it the place of the bar is part of the fill, and the block's name says no certainty.
   */
  function drawBlock(parent, defs, b, p, SIZE, built, marks) {
    const { BW, NH, BAND, ZB } = SIZE;
    const { x, y, h } = b;
    const level = p.confidence ? p.confidence.level : 'green';
    const bstate = marks && p.build && BSTATE[p.build.state] ? p.build.state : null;
    const sure = built ? '' : `, ${TX.t('design.certainty', { level: TX.t(`design.level.${level}`) })}`;
    const g = el('g', { class: `td-node td-st-${p.status}${bstate ? ' td-bs-' + bstate : ''}`, 'data-id': p.id, tabindex: 0, role: 'button',
      'aria-label': `${p.name}, ${kindOf(p.kind)}, ${low(statusOf(p, built))}${bstate ? ', ' + low(buildTitle(p)) : ''}${sure}` }, parent);
    const cp = el('clipPath', { id: 'td-cp-' + p.id }, defs);
    el('rect', { x, y, width: BW, height: h, rx: 10 }, cp);
    const inner = el('g', { 'clip-path': `url(#td-cp-${p.id})` }, g);
    el('rect', { class: 'td-fill', x, y, width: BW, height: h }, inner);
    const tx = x + ZB + 14;
    const band = b.start ? startBand(inner, x, y, BW, b.top, b.start) : null;
    const texts = [];
    b.bands.forEach((band, k) => {
      const by = y + (b.top || 0) + (b.body || NH) + k * BAND;
      const bm = by + BAND / 2;
      if (band === 'open') {
        el('rect', { class: 'td-op-band', x, y: by, width: BW, height: BAND }, inner);
        el('line', { class: 'td-op-line', x1: x, x2: x + BW, y1: by, y2: by }, inner);
        const q = el('g', { class: 'td-op-q' }, inner);
        el('circle', { cx: tx + 7, cy: bm, r: 9 }, q);
        txt(q, { x: tx + 7, y: bm + 4.3, 'text-anchor': 'middle' }, '?');
        texts.push({ t: txt(inner, { class: 'td-op-t', x: tx + 23, y: bm + 5 }, ''), s: TX.t('design.stillOpen', { text: p.open }) });
      } else {
        const st = p.right.status === 'new' ? 'new' : 'existing';
        el('rect', { class: 'td-lk-' + st, x, y: by, width: BW, height: BAND }, inner);
        el('line', { class: 'td-lockline', x1: x, x2: x + BW, y1: by, y2: by }, inner);
        const lk = el('g', { transform: `translate(${tx},${bm - 8}) scale(1.15)`, class: `td-lk-${st}-t` }, inner);
        el('rect', { x: 0, y: 5, width: 10, height: 7, rx: 1.5 }, lk);
        el('path', { d: 'M2.2,5 V3.6 a2.8,2.8 0 0 1 5.6,0 V5', fill: 'none', 'stroke-width': 1.4 }, lk);
        texts.push({ t: txt(inner, { class: `td-lt td-lk-${st}-t`, x: tx + 23, y: bm + 5 }, ''), s: p.right.short || TX.t('design.right') });
      }
    });
    if (!built) {
      el('rect', { class: 'td-zk-' + level, x, y, width: ZB, height: h }, inner);
      el('line', { class: 'td-zk-sep', x1: x + ZB, x2: x + ZB, y1: y, y2: y + h }, inner);
    }
    if (bstate === 'added' || bstate === 'gone') el('rect', { class: 'td-outline-u', x, y, width: BW, height: h, rx: 10 }, g);
    el('rect', { class: 'td-outline', x, y, width: BW, height: h, rx: 10 }, g);
    statusIcon(g, x + BW - 24, y, p.status, statusOf(p, built));
    // on the corner itself, clear of the kind label and the name
    if (bstate) buildIcon(g, x + 1, y - 1, bstate, buildTitle(p));
    const pills = F.pillsOf(p, marks).map((x) => ({ r: el('rect', { class: `td-${x.cls}-r`, height: 21, rx: x.cls === 'pk' ? 6 : 10.5 }, g), t: txt(g, { class: `td-${x.cls}-t` }, x.text) }));
    const nm = txt(g, { class: 'td-nm', x: tx }, p.name);
    const sb = txt(g, { class: 'td-sb', x: tx }, '');
    el('title', {}, g).textContent = `${p.name}${p.sub ? ': ' + p.sub : ''}`;
    const nb = badge(g, x + BW - 56, y);
    return { g, b, p, pills, nm, sb, nb, texts, tx, band };
  }

  /**
   * The orange band on top of a block where the flow starts: "START" and
   * what sets it going, low in the band, under the status icon and the
   * story number that sit on its top edge.
   */
  function startBand(parent, x, y, w, h, s) {
    const g = el('g', { class: 'td-start' + (s.n && s.n > 1 ? ' td-start-2' : '') }, parent);
    el('rect', { class: 'td-start-r', x, y, width: w, height: h }, g);
    const cx = x + 22;
    const cy = y + h - 14;
    el('path', { class: 'td-start-i', d: `M${cx - 5},${cy - 6.5} L${cx + 6.5},${cy} L${cx - 5},${cy + 6.5} Z` }, g);
    const t = txt(g, { class: 'td-start-t', x: x + 36, y: cy + 5 }, '');
    el('tspan', {}, t).textContent = s.n ? `START ${s.n}` : 'START';
    const tw = el('tspan', { class: 'td-start-w', dx: 8 }, t);
    return { t, tw, s: s.trigger };
  }
  /** The start text in its band: smaller down to 11 px, then what sets it going is cut. */
  function fitStart(band, max) {
    const { t, tw, s } = band;
    tw.textContent = s;
    let fs = baseOf(t);
    while (t.getComputedTextLength() > max && fs > 11) { fs -= 0.5; t.style.fontSize = fs + 'px'; }
    if (t.getComputedTextLength() <= max) return;
    const lead = t.getComputedTextLength() - tw.getComputedTextLength() + 10;
    tw.textContent = F.cutEnd(s, max - lead, (v) => { tw.textContent = v; return tw.getComputedTextLength(); });
  }

  /** Lay out the module tag of a part: its text fitted to `max`, a dot when built otherwise, its story number right of it. */
  function layoutTag(tg, max) {
    const { f, fn, r } = tg;
    const dot = tg.dot ? 10 : 0;
    const fitted = F.tagFit(tg.name, measureOf(fn), max - 16 - dot, baseOf(fn));
    put(fn, fitted);
    fn.setAttribute('y', f.y + f.h / 2 + fitted.fs * 0.28);
    const w = Math.ceil(fn.getComputedTextLength()) + 16 + dot;
    r.setAttribute('width', w);
    if (tg.dot) tg.dot.setAttribute('cx', f.x + w - 10);
    if (tg.nb) moveBadge(tg.nb, f.x + w + 13, f.y + f.h / 2);
  }
  function pill(pl, x, y, w) {
    pl.r.setAttribute('x', x);
    pl.r.setAttribute('y', y);
    pl.r.setAttribute('width', w);
    pl.t.setAttribute('x', x + F.PILL_PAD / 2);
    pl.t.setAttribute('y', y + 14);
  }

  /**
   * Place the texts of every block: the labels on the top row left of the
   * icon (what does not fit there on a second row), the tag, the name and
   * the summary centred between the labels and the tag, and the texts of
   * the bands.
   */
  function layoutText(nodes, SIZE) {
    const max = SIZE.BW - SIZE.ZB - 28;
    for (const n of nodes) {
      const x = n.b.x;
      const y0 = n.b.y + (n.b.top || 0);
      const body = n.b.body || SIZE.NH;
      const tagY = y0 + body - SIZE.TAG_PAD - SIZE.TAG_H;
      const rows = F.pillRows(n.pills, SIZE.PILLS, (pl) => pl.t.getComputedTextLength());
      const px = [n.tx, n.tx];
      n.pills.forEach((pl, k) => {
        const w = pl.t.getComputedTextLength() + F.PILL_PAD;
        // the first row starts under the story number on the top edge
        pill(pl, px[rows[k]], y0 + 14 + rows[k] * SIZE.PILL2, w);
        px[rows[k]] += w + F.PILL_GAP;
      });
      if (n.tag) layoutTag(n.tag, x + SIZE.BW - 14 - (n.tag.nb ? SIZE.TAG_NB : 0) - n.tag.f.x);
      // the name and the summary take a second line only where the body has the room for it
      n.nm.setAttribute('x', n.tx);
      const top = y0 + 35 + (rows.includes(1) ? SIZE.PILL2 : 0);
      const avail = tagY - top;
      const need = (nl, ndy, sl, sdy) => 13 + (nl - 1) * ndy + (sl ? 24 + (sl - 1) * sdy : 0) + 4;
      let name = F.nameFit(n.p.name, measureOf(n.nm), max, baseOf(n.nm), 2);
      if (name.lines.length === 2 && need(2, Math.round(name.fs * 1.2), n.p.sub ? 1 : 0, 0) > avail) name = F.nameFit(n.p.name, measureOf(n.nm), max, baseOf(n.nm), 1);
      const ndy = Math.round(name.fs * 1.2);
      // with less room than the layout meant (an estimate that fell short) the summary drops its second line, at worst itself
      const most = need(name.lines.length, ndy, 2, 18) <= avail ? 2 : need(name.lines.length, ndy, 1, 0) <= avail ? 1 : 0;
      const sub = n.p.sub && most ? F.subFit(n.p.sub, measureOf(n.sb), max, most, baseOf(n.sb)) : null;
      const sdy = sub ? Math.round(sub.fs * 1.2) : 0;
      put(n.nm, name, ndy);
      if (sub) put(n.sb, sub, sdy); else n.sb.textContent = '';
      const high = need(name.lines.length, ndy, sub ? sub.lines.length : 0, sdy);
      const first = top + Math.max(0, (avail - high) / 2) + 13;
      n.nm.setAttribute('y', first);
      n.sb.setAttribute('y', first + (name.lines.length - 1) * ndy + 24);
      for (const { t, s } of n.texts) fitLine(t, s, SIZE.BW - SIZE.ZB - 52, 11);
      // the room left of the right edge, less the 8 between START and what sets it going
      if (n.band) fitStart(n.band, SIZE.BW - 36 - 14 - 8);
    }
  }

  /** The tooltip of a line: the step, from and to, its label in the record's language and the call in the code. */
  function tipOf(l, ml, partName) {
    const head = `${l.step ? l.step + '. ' : ''}${partName.get(l.from) || l.from} \u2192 ${partName.get(l.to) || l.to}`;
    if (ml.kind === 'builds_on') return `${head}: ${TX.t('design.buildsOn')}`;
    return [head, ml.label, ml.code].filter(Boolean).join('\n');
  }

  /** A step number in a circle. */
  function stepDot(parent, cx, cy, n, r) {
    const g = el('g', { class: 'td-step' }, parent);
    el('circle', { cx, cy, r }, g);
    txt(g, { x: cx, y: cy + 4.7, 'text-anchor': 'middle' }, String(n));
    return g;
  }

  /** A label: a plate beside its line with the step number and the text, or only the number on the line. */
  function drawLabel(lg, lab) {
    const L = root.TdLabels;
    const { x, y, w, h } = lab.box;
    if (lab.kind === 'badge') {
      stepDot(lg, x + w / 2, y + h / 2, lab.n, 11.5).classList.add('td-step-b');
      return;
    }
    el('rect', { class: 'td-plate', x, y, width: w, height: h, rx: 7 }, lg);
    let tx = x + L.PAD;
    if (lab.n) {
      stepDot(lg, tx + L.NUM / 2, y + L.PLATE_H / 2, lab.n, L.NUM / 2);
      tx += L.NUM + L.GAP_NUM;
    }
    const room = x + w - L.PAD - tx;
    lab.lines.forEach((line, i) => {
      fitLine(txt(lg, { class: 'td-pl-t', x: tx, y: y + 18 + i * L.LINE }, ''), line, room, 11);
    });
  }

  /**
   * The drawing keeps its own width: the lanes never stretch into an empty
   * band beside the drawing. `width` is accepted for the panel, which sizes
   * the svg itself.
   */
  function fitTo(svg, lanes, geo) {
    svg.setAttribute('width', geo.width);
    svg.setAttribute('viewBox', `0 0 ${geo.width} ${geo.height}`);
    for (const l of lanes) l.el.setAttribute('width', l.w || geo.width - l.x);
  }

  /** Draw the whole thing into `host`. Returns the elements, for the panel to wire. */
  function draw(host, model, geo, SIZE, opts) {
    const built = !!(opts && opts.built);
    // while a change the user asked for is open the drawing is the plan: none of the marks of the build on it
    const marks = built && !(model && model.plan);
    // its own size, one unit a pixel: a drawing with few parts never grows to fill the page
    const svg = el('svg', { class: 'td-svg', viewBox: `0 0 ${geo.width} ${geo.height}`, width: geo.width, height: geo.height, role: 'img', 'aria-label': 'Code Scaffold' }, host);
    const defs = defsOf(svg);
    const gl = el('g', {}, svg);
    const lanes = geo.lanes.map((l) => {
      const r = el('rect', { class: 'td-lane td-' + l.fill, x: l.x, y: l.y, width: l.w, height: l.h, rx: 12 }, gl);
      txt(gl, { class: 'td-lane-t', x: SIZE.X0, y: l.y + 26 }, l.name);
      return { el: r, x: l.x, w: l.w };
    });
    const mods = new Map(model.modules.map((m) => [m.id, m]));
    const ge = el('g', {}, svg);
    const gn = el('g', {}, svg);
    const glab = el('g', {}, svg);
    const links = new Map(model.links.map((l) => [l.id, l]));
    const partName = new Map(model.parts.map((p) => [p.id, p.name]));
    const gone = new Set(marks ? model.parts.filter((p) => p.build && p.build.state === 'gone').map((p) => p.id) : []);
    const edges = geo.links.map((l) => {
      const ml = links.get(l.id) || {};
      const bcls = marks && ml.build && ml.build.state === 'added' ? ' td-edge-added' : gone.has(l.from) || gone.has(l.to) ? ' td-edge-gone' : '';
      const g = el('g', { class: 'td-edge' + (ml.kind === 'builds_on' ? ' td-base' : '') + (l.quiet ? ' td-quiet' : '') + bcls, 'data-id': l.id }, ge);
      const d = 'M' + l.points.map((pt) => pt.join(',')).join(' L');
      el('path', { d }, g);
      el('path', { d, class: 'td-hit' }, g);
      el('title', {}, g).textContent = tipOf(l, ml, partName);
      const lg = el('g', { class: 'td-elab td-pl-' + (l.label ? l.label.bg : 'page') + (l.quiet ? ' td-elab-q' : '') + (bcls === ' td-edge-gone' ? ' td-elab-gone' : ''), 'data-id': l.id }, glab);
      if (l.label) drawLabel(lg, l.label);
      return { l, g, lg };
    });
    const parts = new Map(model.parts.map((p) => [p.id, p]));
    const nodes = geo.blocks.map((b) => drawBlock(gn, defs, b, parts.get(b.id), SIZE, built, marks));
    // the module of a part as a tag inside it, drawn right after the part so it fades with it: a plain label, the
    // pointer goes through it to the part (design-layout.css), no focus stop, no tooltip of its own
    const order = new Map(model.modules.map((m, i) => [m.id, i]));
    const nodeOf = new Map(nodes.map((n) => [n.p.id, n]));
    const frames = [];
    for (const t of geo.tags || []) {
      const n = nodeOf.get(t.part);
      if (!n) continue;
      const m = t.lane ? null : mods.get(t.module) || { id: t.module, name: t.name, status: 'existing' };
      // a lane, not a module: only its name
      const g = t.lane ? el('g', { class: 'td-mtag td-ltag', 'aria-hidden': 'true' })
        : el('g', { class: `td-frame td-mtag td-mc${(order.get(t.module) || 0) % 6}`, 'data-id': m.id, 'aria-hidden': 'true' });
      n.g.after(g);
      const other = marks && m && builtOther(m);
      if (other) g.classList.add('td-mt-built');
      const r = el('rect', { class: 'td-mt-r', x: t.x, y: t.y, width: t.w, height: t.h, rx: 5 }, g);
      const fn = txt(g, { class: 'td-mt-t', x: t.x + 8, y: t.y + t.h / 2 + 4.5 }, '');
      const dot = other ? el('circle', { class: 'td-mt-dot', cy: t.y + t.h / 2, r: 3.5 }, g) : null;
      const tg = { f: { id: t.id, x: t.x, y: t.y, w: t.w, h: t.h }, m, g, fn, r, dot, name: t.name, nb: m ? badge(g, t.x + t.w + 13, t.y + t.h / 2, 9) : null };
      n.tag = tg;
      if (m) frames.push(tg);
    }
    // the walk over the steps and the legend panel (design-steps.js); design-panel.js puts them where they go
    const steps = root.TdSteps ? root.TdSteps.create(model, geo, svg, edges, nodes) : null;
    const relayout = () => layoutText(nodes, SIZE);
    relayout();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
    // the overview's look (maquette-draw.js): the plates, the parts' depth and their assembly
    if (root.TdMaquette) root.TdMaquette.dress(svg, { geo, nodes, edges, frames, steps, SIZE });
    return { svg, nodes, frames, edges, steps, fit: (width) => fitTo(svg, lanes, geo, width) };
  }

  const api = {
    draw, fitTo, statusIcon, buildIcon, buildTitle, statusOf, kindOf,
    get STATUS() { return wordsOf('status', 'plan'); },
    get MSTATUS() { return wordsOf('moduleStatus', 'plan'); },
    get LEVEL() { return Object.fromEntries(['green', 'orange', 'red'].map((k) => [k, level(k)])); },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
