/* How each C4 element is drawn. measure(n) decides a card's size and where every line of text goes; draw(...)
   paints exactly that, so the layout and the picture never disagree. A card: an icon tile and the name, the type in
   C4's brackets, a short description, and a footer with the status and the numbers of the stories that touched it.
   What changed carries the colour and the heavier border; a person is a light card under a light head, and from level
   2 on, where level 1 already said who they are, one line with their name. */
(function () {
  'use strict';
  const C4 = window.C4;
  const { svgEl, glyph, FONT, width, wrap, T, STATUS, KIND, storyNo } = C4.kit;

  const W = { person: 216, system: 252, container: 268, db: 252, component: 236, code: 244, ref: 236 };
  const P = 14;
  const TILE = 26;
  const FOOT = 30;
  const COLORS = {
    new: { fill: 'var(--new-fill)', line: 'var(--new-line)', ink: 'var(--new)', tile: 'var(--tile-new)', chip: 'var(--chip)' },
    changed: { fill: 'var(--changed-fill)', line: 'var(--changed-line)', ink: 'var(--changed)', tile: 'var(--tile-changed)', chip: 'var(--chip)' },
    existing: { fill: 'var(--surface)', line: 'var(--exist-line)', ink: 'var(--ink-2)', tile: 'var(--surface-2)', chip: 'var(--surface-2)' },
    ext: { fill: 'var(--ext-fill)', line: 'var(--ext-line)', ink: 'var(--ext-ink)', tile: 'var(--tile-ext)', chip: 'var(--chip)' },
  };
  const tone = (n) => COLORS[n.ext ? 'ext' : n.status] || COLORS.existing;
  const iconOf = (n) => n.icon || (n.kind === 'person' ? 'person' : n.kind === 'db' ? 'db' : n.kind === 'container' ? 'app'
    : n.ext ? 'globe' : n.kind === 'system' ? 'system' : 'code');
  const zoomable = (n) => !!n.zoom;

  // ---------- the marks of the build ----------
  // a file whose build deviated from the approved Code Scaffold: a border in the colour of its mark, solid when built
  // otherwise, dashed when it came in or was not built, and the mark on its top left corner
  const BLINE = { different: null, added: '9 5', gone: '4 4' };
  const BSIGN = { different: 'M-7.5,-3.6 H7.5 M-7.5,3.6 H7.5 M3.2,-8.8 L-3.2,8.8', added: 'M-7.5,0 H7.5 M0,-7.5 V7.5', gone: 'M-7.5,0 H7.5' };
  /** The deviation of part p from the approved Code Scaffold, after the build (C4.build): { dev: different | added |
   *  gone, devTitle: the words of its mark }; {} built as drawn, before the build, or while a change is open
   *  (kit.plan): then the drawing is the plan. */
  function buildOf(p) {
    const B = C4.build;
    const d = C4.kit.built && !C4.kit.plan && B && p ? B.devOf(C4.model, p) : null;
    return d ? { dev: d.state, devTitle: B.markTitle(p, d) } : {};
  }
  /** The mark of the build as a group at cx, cy of radius r; `title` '' (the legend, the inspector): none. */
  function bmark(s, title, cx, cy, r) {
    const g = svgEl('g', { class: 'bmark bmark-' + s, transform: `translate(${cx},${cy}) scale(${r / 19})` });
    if (title) { const tip = svgEl('title', {}); tip.textContent = title; g.append(tip); }
    g.append(svgEl('circle', { r: 19 }), svgEl('path', { class: 'bmark-ic', d: BSIGN[s] }));
    return g;
  }

  /** The type line in C4's brackets: [Component: shop-billing], [External: Payment provider]; `type` says it outright. */
  function typeText(n) {
    if (n.type) return `[${n.type}]`;
    if (n.kind === 'person') return `[${KIND.person}]`;
    if (n.kind === 'code') return `[${n.tech || KIND.code}]`;
    if (n.kind === 'ref') return n.ext ? `[${KIND.ext}${n.tech ? ': ' + n.tech : ''}]` : `[${KIND.component}: ${n.tech || KIND.component}]`;
    const k = n.ext ? KIND.ext : KIND[n.kind] || KIND.element;
    return `[${k}${n.tech ? ': ' + n.tech : ''}]`;
  }

  /** The size of a card and the place of every text line in it. `wide`, or the card's own `w`: a width for this card
   *  instead of its kind's. `foot`: a footer with the story numbers on a person or outside system too. */
  function measure(n, wide) {
    const rows = [];
    if (n.kind === 'person' && n.compact) {
      const t = wrap(n.name, FONT.name, 236, 1)[0];
      const w = Math.ceil(Math.max(150, width(t, FONT.name) + 62));
      rows.push({ t, font: FONT.name, fill: 'var(--person)', x: 44, y: 27 });
      return { w, h: 44, rows, footer: null, person: true, compact: true };
    }
    const w = wide || n.w || W[n.kind] || 236;
    if (n.kind === 'person') {
      let y = 24 + 18;
      const inner = w - 2 * P;
      for (const t of wrap(n.name, FONT.name, inner, 2)) { rows.push({ t, font: FONT.name, fill: 'var(--person)', x: w / 2, y: y + 13, mid: true }); y += 18; }
      rows.push({ t: `[${KIND.person}]`, font: FONT.type, fill: 'var(--ink-3)', x: w / 2, y: y + 12, mid: true }); y += 16 + 6;
      for (const t of wrap(n.desc, FONT.desc, inner, n.lines || 3)) { rows.push({ t, font: FONT.desc, fill: 'var(--ink-2)', x: w / 2, y: y + 13, mid: true }); y += 17.5; }
      const footer = n.foot ? footerOf(n, w) : null;
      if (footer) { footer.y = y + 8; y = footer.y + FOOT - P; }
      return { w, h: Math.ceil(y + P), rows, footer, person: true };
    }
    const cyl = n.kind === 'db' || (n.kind === 'ref' && n.db);
    const top = cyl ? 24 : P;
    const tile = !cyl;
    const nx = tile ? P + TILE + 10 : P;
    const nameFont = n.kind === 'code' ? FONT.code : n.kind === 'system' || n.kind === 'container' || n.kind === 'db' ? FONT.big : FONT.name;
    const names = wrap(n.name, nameFont, w - nx - P, n.kind === 'code' ? 3 : 2);
    const lh = n.kind === 'code' ? 17 : 18;
    let y = top;
    const nameH = names.length * lh;
    const head = tile ? Math.max(TILE, nameH + 2) : nameH;
    const y0 = tile && nameH < TILE ? top + (TILE - nameH) / 2 : top;
    names.forEach((t, i) => rows.push({ t, font: nameFont, fill: 'var(--ink)', x: nx, y: y0 + i * lh + (n.kind === 'code' ? 12.5 : 13.5) }));
    y += head + 6;
    for (const t of wrap(typeText(n), FONT.type, w - 2 * P, 2)) { rows.push({ t, font: FONT.type, fill: 'var(--ink-3)', x: P, y: y + 12 }); y += 16; }
    const desc = wrap(n.desc, FONT.desc, w - 2 * P, n.lines || (n.kind === 'ref' ? 2 : n.kind === 'system' || n.kind === 'container' || n.kind === 'db' ? 4 : 3));
    if (desc.length) y += 5;
    for (const t of desc) { rows.push({ t, font: FONT.desc, fill: 'var(--ink-2)', x: P, y: y + 13 }); y += 17.5; }
    const footer = n.kind === 'ref' || (n.ext && !n.foot) ? null : footerOf(n, w);
    if (footer) { footer.y = y + 10; y = footer.y + FOOT; } else y += P - 2;
    if (cyl) y += 6;
    return { w, h: Math.ceil(y), rows, footer, tile, cyl, top };
  }

  /** The same height for every card of a row: a person's text stays in the middle, a footer at the bottom. */
  function stretch(s, h) {
    if (!(h > s.h) || s.compact) return;
    const extra = h - s.h;
    if (s.person) for (const r of s.rows) r.y += extra / 2;
    if (s.footer) s.footer.y += extra;
    s.h = h;
  }

  /** Status at the left, the story numbers at the right (as many as fit, then +n); `word: ''` leaves the status out and
   *  puts the numbers in the middle. */
  function footerOf(n, w) {
    const word = n.word != null ? n.word : STATUS[n.ext ? 'ext' : n.status] || STATUS.existing;
    const ww = word ? width(word, FONT.foot) + 14 : 0;
    const ids = n.stories || [];
    const fit = Math.max(0, Math.floor((w - 2 * P - ww - 8 + 4) / 24));
    const shown = ids.length > fit ? ids.slice(0, Math.max(0, fit - 1)) : ids;
    return { word, ids: shown, more: ids.length - shown.length };
  }

  /** What a card says to a screen reader: its name, what it is, its status, its mark, its stories, and how to zoom. */
  function labelOf(n) {
    const low = (t) => String(t || '').charAt(0).toLowerCase() + String(t || '').slice(1);
    const what = n.kind === 'person' ? KIND.person : n.ext ? STATUS.ext : KIND[n.kind] || '';
    return [`${n.name}, ${low(what)}`,
      n.kind !== 'person' && !n.ext && n.status ? low(STATUS[n.status]) : null,
      n.dev ? low(n.devTitle) : null,
      (n.stories || []).length ? T('card.stories', { list: n.stories.map(storyNo).join(', ') }) : null,
    ].filter(Boolean).join(', ') + (zoomable(n) ? `. ${T('card.enterZooms')}` : '');
  }

  // ---------- painting ----------
  function draw(layer, n, s, x, y, story) {
    const c = tone(n);
    const g = svgEl('g', { class: 'node' + (n.dev ? ' bs-' + n.dev : ''), transform: `translate(${x},${y})`, tabindex: '0', role: 'button', 'data-id': n.id, 'aria-label': labelOf(n) });
    const lift = svgEl('g', { class: 'lift' });
    const card = svgEl('g', { class: 'card' });
    const r = s.compact ? 22 : n.kind === 'person' ? 18 : 12;
    const hero = !n.ext && (n.status === 'new' || n.status === 'changed');
    lift.append(svgEl('rect', { class: 'ring', x: -5, y: -5, width: s.w + 10, height: s.h + 10, rx: r + 5, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2 }));
    if (s.compact) {
      card.append(svgEl('rect', { x: 0.7, y: 0.7, width: s.w - 1.4, height: s.h - 1.4, rx: r, fill: 'var(--surface)', stroke: 'var(--person)', 'stroke-width': 1.4 }),
        svgEl('circle', { cx: 22, cy: 22, r: 13, fill: 'var(--surface-3)' }), glyph('person', 13, 13, 18, 'var(--person)'));
    } else if (n.kind === 'person') {
      card.append(svgEl('rect', { x: 0.7, y: 24.7, width: s.w - 1.4, height: s.h - 25.4, rx: r, fill: 'var(--surface)', stroke: 'var(--person)', 'stroke-width': 1.4 }),
        svgEl('circle', { cx: s.w / 2, cy: 20, r: 15, fill: 'var(--surface)' }),
        svgEl('circle', { cx: s.w / 2, cy: 20, r: 12, fill: 'var(--surface-3)', stroke: 'var(--person)', 'stroke-width': 1.4 }));
    } else if (s.cyl) {
      const ry = 11, w = s.w, h = s.h;
      const dash = n.ext ? '6 4' : null;
      const sw = hero ? 2 : 1.4;
      card.append(svgEl('path', { d: `M0 ${ry} a${w / 2} ${ry} 0 0 1 ${w} 0 v${h - 2 * ry} a${w / 2} ${ry} 0 0 1 ${-w} 0 Z`, fill: c.fill, stroke: c.line, 'stroke-width': sw, 'stroke-dasharray': dash }),
        svgEl('ellipse', { cx: w / 2, cy: ry, rx: w / 2, ry, fill: c.tile, stroke: c.line, 'stroke-width': sw, 'stroke-dasharray': dash }));
    } else {
      const sw = hero ? 2 : n.ext ? 1.4 : 1.2;
      card.append(svgEl('rect', { x: sw / 2, y: sw / 2, width: s.w - sw, height: s.h - sw, rx: r, fill: c.fill, stroke: c.line, 'stroke-width': sw,
        'stroke-dasharray': n.ext ? '6 4' : null }));
    }
    if (s.tile) {
      card.append(svgEl('rect', { x: P, y: s.top, width: TILE, height: TILE, rx: 8, fill: c.tile }));
      card.append(glyph(iconOf(n), P + 5, s.top + 5, 16, c.ink));
    }
    for (const row of s.rows) {
      const t = svgEl('text', { x: row.x, y: row.y, fill: row.fill, 'text-anchor': row.mid ? 'middle' : null, style: `font:${row.font}` });
      t.textContent = row.t;
      card.append(t);
    }
    if (s.footer) card.append(footer(n, s, c, story));
    if (n.dev && !s.person && !s.cyl) {
      card.append(svgEl('rect', { class: 'bline', x: 0, y: 0, width: s.w, height: s.h, rx: r, fill: 'none', 'stroke-dasharray': BLINE[n.dev] }),
        bmark(n.dev, n.devTitle, 1, 1, 13));
    }
    if (zoomable(n)) {
      // a round button on the corner, out of the way of the name
      const z = svgEl('g', { class: 'zoomer', 'data-zoom': n.id });
      const tip = svgEl('title', {});
      tip.textContent = T('card.zoomTip');
      z.append(tip, svgEl('circle', { cx: s.w - 3, cy: 3, r: 13, fill: 'var(--accent)', stroke: 'var(--surface)', 'stroke-width': 2.5 }),
        glyph('zoom', s.w - 3 - 8, 3 - 8, 16, 'var(--on-accent)'));
      card.append(z);
    }
    lift.append(card);
    g.append(lift);
    layer.append(g);
    return g;
  }

  function footer(n, s, c, story) {
    const f = s.footer;
    const g = svgEl('g', { class: 'foot' });
    // a person's card starts below its head, so its footer line runs inside the border
    const inset = s.person ? 1.4 : 0;
    g.append(svgEl('line', { x1: inset, x2: s.w - inset, y1: f.y, y2: f.y, stroke: 'var(--foot-line)', 'stroke-width': 1 }));
    const cy = f.y + FOOT / 2 + 0.5;
    if (f.word) {
      g.append(svgEl('circle', { cx: P + 3.5, cy, r: 3.5, fill: c.ink }));
      const t = svgEl('text', { x: P + 12, y: cy + 4, fill: c.ink, style: `font:${FONT.foot}` });
      t.textContent = f.word;
      g.append(t);
    }
    const items = f.more > 0 ? [...f.ids, '+' + f.more] : f.ids;
    let x = f.word ? s.w - P - 10 : s.w / 2 + ((items.length - 1) * 24) / 2;
    const tipKey = C4.kit.built && !C4.kit.plan ? 'card.storyTip.built' : 'card.storyTip.plan';
    for (const id of [...items].reverse()) {
      const more = String(id).startsWith('+');
      const b = svgEl('g', { class: 'sbadge' + (id === story ? ' hot' : ''), 'data-us': id });
      if (!more) { const tip = svgEl('title', {}); tip.textContent = T(tipKey, { n: storyNo(id) }); b.append(tip); }
      b.append(svgEl('circle', { cx: x, cy, r: 10, fill: c.chip }));
      const tx = svgEl('text', { x, y: cy + 3.9, 'text-anchor': 'middle', fill: 'var(--heading)', style: `font:${FONT.badge}` });
      tx.textContent = more ? id : storyNo(id);
      b.append(tx);
      g.append(b);
      x -= 24;
    }
    return g;
  }

  /** An orthogonal line with rounded bends. */
  function roundPath(pts, rad) {
    let d = `M${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
      const r = Math.min(rad, l1 / 2, l2 / 2);
      if (r < 0.5) { d += ` L${b.x} ${b.y}`; continue; }
      const p1 = { x: b.x + ((a.x - b.x) / l1) * r, y: b.y + ((a.y - b.y) / l1) * r };
      const p2 = { x: b.x + ((c.x - b.x) / l2) * r, y: b.y + ((c.y - b.y) / l2) * r };
      d += ` L${p1.x} ${p1.y} Q${b.x} ${b.y} ${p2.x} ${p2.y}`;
    }
    const z = pts[pts.length - 1];
    return d + ` L${z.x} ${z.y}`;
  }

  function markers(svg) {
    const defs = svgEl('defs', {});
    for (const [id, color] of [['c4-arr-intent', 'var(--accent)'], ['c4-arr-old', 'var(--wire)']]) {
      const m = svgEl('marker', { id, viewBox: '0 0 10 10', refX: '8.6', refY: '5', markerWidth: '8.5', markerHeight: '8.5', orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' });
      m.append(svgEl('path', { d: 'M1 1.2 L9 5 L1 8.8 L2.8 5 Z', fill: color }));
      defs.append(m);
    }
    svg.append(defs);
  }

  /** A relation: a soft halo that shows when it lights up, the line itself, and its text as a pill on the line. */
  function edge(lineLayer, labelLayer, meta, pts, label, up) {
    const d = roundPath(pts, 10);
    const color = meta.intent ? 'var(--accent)' : 'var(--wire)';
    const g = svgEl('g', { class: 'edge' + (up ? ' rev' : '') + (meta.quiet ? ' quiet' : '') + (meta.gone ? ' gone' : ''), 'data-from': meta.from, 'data-to': meta.to });
    g.append(svgEl('path', { class: 'halo', d, fill: 'none', stroke: color, 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const arrow = `url(#${meta.intent ? 'c4-arr-intent' : 'c4-arr-old'})`;
    g.append(svgEl('path', { class: 'wire', d, fill: 'none', stroke: color, 'stroke-width': meta.intent ? 1.7 : 1.25,
      'stroke-dasharray': meta.ends ? '7 5' : null, 'marker-end': meta.both || !up ? arrow : null, 'marker-start': meta.both || up ? arrow : null }));
    lineLayer.append(g);
    if (!label) return;
    const lg = svgEl('g', { class: 'elabel' + (meta.gone ? ' gone' : ''), 'data-from': meta.from, 'data-to': meta.to });
    lg.append(svgEl('rect', { x: label.x, y: label.y, width: label.width, height: label.height, rx: 8, fill: 'var(--surface)',
      stroke: meta.intent ? 'var(--pill-intent)' : 'var(--line-strong)', 'stroke-width': 1 }));
    let yy = label.y + 15.5;
    for (const t of label.lines) {
      const tx = svgEl('text', { x: label.x + label.width / 2, y: yy, 'text-anchor': 'middle', fill: meta.intent ? 'var(--ink)' : 'var(--ink-2)', style: `font:${FONT.label}` });
      tx.textContent = t;
      lg.append(tx);
      yy += 15;
    }
    if (label.tech) {
      const tx = svgEl('text', { x: label.x + label.width / 2, y: yy - 0.5, 'text-anchor': 'middle', fill: 'var(--ink-3)', style: `font:${FONT.tech}` });
      tx.textContent = label.tech;
      lg.append(tx);
    }
    labelLayer.append(lg);
  }

  /** The dashed border of what the view zooms into, its name and type inside at the bottom left, as C4 draws it; with
   *  `words` its name and type go there, over the lines, so a line passing under them never cuts them. */
  function boundary(layer, b, name, type, words) {
    layer.append(svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 18, fill: 'var(--bound-fill)', stroke: 'var(--line-strong)', 'stroke-width': 1.3, 'stroke-dasharray': '7 5' }));
    const halo = { stroke: 'var(--canvas)', 'stroke-width': 5, 'stroke-linejoin': 'round', 'paint-order': 'stroke' };
    const t = svgEl('text', { x: b.x + 20, y: b.y + b.h - 30, fill: 'var(--heading)', style: `font:${FONT.bound}`, ...halo });
    t.textContent = name;
    const t2 = svgEl('text', { x: b.x + 20, y: b.y + b.h - 13, fill: 'var(--ink-3)', style: `font:${FONT.btype}`, ...halo });
    t2.textContent = type;
    (words || layer).append(t, t2);
  }

  C4.shapes = { measure, stretch, draw, edge, boundary, markers, roundPath, typeText, iconOf, tone, buildOf, bmark };
})();
