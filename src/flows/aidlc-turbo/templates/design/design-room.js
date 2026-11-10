/**
 * AI-DLC Turbo - Code Scaffold, the drawing's view in one look on a desktop.
 *
 * On a desktop (a window 1280 wide or more, no finger) the legend, the
 * drawing with its controls and keys, and the details panel take the height
 * the window has left: the window less what stands above the stage (the
 * masthead, the switch of the views, the note) and what stands below it
 * (the questions, the footer line), so the whole view shows without a scroll
 * of the page. Each scrolls inside itself where it needs to, and the drawing
 * shrinks to fit that height and the width (never larger than drawn). Where
 * that leaves less than FLOOR (the plan page, with its note and the story
 * over the drawing) the view takes the window's height less what stands
 * below it and a GAP, so one scroll down shows the view and what is under it
 * whole; never less than FLOOR, where the page scrolls. Elsewhere (a phone, a
 * tablet, a narrow window) the page keeps its own height.
 *
 *   TdRoom.on({ view, touch }) -> whether the view fits the window
 *   TdRoom.measure(stage) -> { top, after }  the page above and below the stage, in pixels
 *   TdRoom.fit({ inner, top, after }) -> the height the stage may take
 *   TdRoom.scale(w, room, vb) -> the size of the drawing in that room
 *   TdRoom.watch(fn) -> fn() whenever the masthead gets another height
 *
 * In that room the drawing opens at a size people can read (design-zoom.js
 * pans and zooms it there): the whole drawing where it fits the free room at
 * READ or more (never larger than drawn), else READ, on the step held. The
 * free room is the drawing's box less the walk over it and the keys under
 * it, `{ x0, x1, y0, y1 }` in pixels of the box; a box asked for is in the
 * drawing's own units.
 *
 *   TdRoom.zoom(free, vb) -> { s, whole }  the zoom the page opens at
 *   TdRoom.place(free, aim, vb, s, box) -> { tx, ty }  where the drawing lies for `box` in the middle of
 *     `aim` (the free room, or the part of it above the box of the step): an axis where the drawing fits
 *     the free room centred, else never an empty strip along an edge of `aim`
 *   TdRoom.keep(free, vb, s, tx, ty, was) -> { tx, ty }  kept in its room (a drag, a zoom, a resize); off
 *     its edge only as far as it lay before (`was`, moved beside the box of the step)
 *   TdRoom.boxes(geo, at) -> [box]  what to show for `at` ({ link }, { part }, { module }, { point },
 *     nothing: START 1), the largest first: a step's two parts with its line, then the part it goes to
 *   TdRoom.show(free, cover, vb, s, boxes) -> { tx, ty }  the first box that fits the room at s, placed
 *     clear of `cover`, the box of the step over the drawing ({ l, r, top, bottom } in the box, or null; its
 *     `also`, what else lies over the room, the zoom): in the free room, else above it or beside it
 *   TdRoom.follow(view, free, cover, vb, boxes) -> { tx, ty, moved }  the drawing follows the step: in
 *     sight already it stays, else shown; the zoom of `view` ({ s, tx, ty }) kept
 *
 * A step shows both its parts whole where that can be: its zoom is READ, or less, down to LOW, where that
 * brings the two parts and the room around them whole into a room clear of the box of the step. Where not
 * even LOW does, READ: the part it goes to whole, and a marker at the edge of the room names the part out of
 * sight, where the step's line leaves the room (design-zoom.js).
 *
 *   TdRoom.ends(geo, at) -> { from, to, points, box } | null  a step's two parts, its line, the box around them
 *   TdRoom.fitZoom(free, cover, box) -> s  the zoom for a step's two parts (`box`, from ends)
 *   TdRoom.exit(ends, 'from' | 'to', s, tx, ty, room) -> { edge, x, y } | null  where the line leaves the room
 *     toward that part ('l', 'r', 't', 'b'); no line in sight: the way from the middle of the room to it
 *   TdRoom.spot(exit, { w, h }, room, [rect]) -> { left, top }  the marker at that edge, inside the room, clear
 *     of each rect ({ l, r, top, bottom }: the box of the step, the zoom)
 *   TdRoom.seen(block, s, tx, ty, room, cover) -> how much of a part shows (0 to 1), clear of the box of the
 *     step; from SEEN on it needs no marker (cut at an edge, the most of it in sight)
 *
 * What stands above and below is measured from the page as laid out: the
 * top of the stage, and the lowest bottom of the body's children with their
 * bottom margin, overlays fixed to the window left out; by the offsets of
 * the layout, never by the boxes on screen, which the intro of the page
 * (maquette-page.js) still slides about for a moment. The page keeps the
 * height of its masthead in --masthead-h on :root (it changes on a resize,
 * when the fonts come in, with "Read more" and when its chips wrap);
 * watch() hears each new height, so the view fits again
 * under it. The page inlines it as window.TdRoom, before the panel
 * (design-panel.js).
 */
(function (root) {
  'use strict';

  const DESK = 1280; // from this window width the view fits the window
  const FLOOR = 420; // never lower than this: a low window lets the page scroll instead
  const GAP = 16; // over the view when the page is scrolled to it
  const READ = 0.8; // readable: the smallest text of a block (11 to 12.5 px drawn) stays around 9 to 10 px
  const PAD = 16; // around what is shown: the plinth, the shadow and the module tag of a block
  const M = 8; // in sight: this far inside the room
  const LOW = 0.65; // a step's two parts whole: zoomed out no further than this (under it the names get too small)
  const EDGE = 6; // a marker this far inside the room
  const SEEN = 0.6; // a part this much in sight needs no marker

  const on = (o) => o.view >= DESK && !o.touch;

  /** Where the layout puts it on the page: by its offsets, so a transform (the intro sliding a block in) counts not. */
  const pageTop = (el) => { let y = 0; for (let e = el; e; e = e.offsetParent) y += e.offsetTop || 0; return y; };
  function measure(stage) {
    const top = pageTop(stage), bottom = top + (stage.offsetHeight || 0);
    let end = bottom;
    for (const el of (document.body && document.body.children) || []) {
      const cs = root.getComputedStyle ? root.getComputedStyle(el) : null;
      if (cs && (cs.position === 'fixed' || cs.position === 'absolute' || cs.display === 'none')) continue;
      if (!el.offsetHeight) continue;
      end = Math.max(end, pageTop(el) + el.offsetHeight + (cs ? parseFloat(cs.marginBottom) || 0 : 0));
    }
    return { top: Math.round(top), after: Math.max(0, Math.round(end - bottom)) };
  }

  /** The room under what stands above; too little of it, the window less what stands below (one scroll shows it whole). */
  function fit(o) {
    const h = Math.floor(o.inner - o.top - o.after);
    return h >= FLOOR ? h : Math.max(FLOOR, Math.floor(o.inner - o.after - GAP));
  }
  const scale = (w, room, vb) => Math.min(1, w / vb.w, room / vb.h);

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function zoom(free, vb) {
    const all = scale(free.x1 - free.x0, free.y1 - free.y0, vb);
    return all >= READ ? { s: all, whole: true } : { s: READ, whole: false };
  }
  /**
   * One axis: the drawing `len` long at s, `c` the middle of what is shown in the middle of a0..a1; centred
   * where it fits the room f0..f1. Its edges stay on the room's, or on the room aimed at where that is
   * smaller: only the strip the box of the step takes up may stay empty.
   */
  const axis = (f0, f1, a0, a1, len, s, c) => (len * s <= f1 - f0 ? f0 + (f1 - f0 - len * s) / 2
    : clamp((a0 + a1) / 2 - c * s, Math.min(f1, a1) - len * s, Math.max(f0, a0)));
  function place(free, aim, vb, s, box) {
    return { tx: axis(free.x0, free.x1, aim.x0, aim.x1, vb.w, s, box.x + box.w / 2),
      ty: axis(free.y0, free.y1, aim.y0, aim.y1, vb.h, s, box.y + box.h / 2) };
  }
  /** One axis kept in the room; where it lay (`was`, beside the box of the step) it may stay, never further out. */
  const hold = (f0, f1, len, t, was) => (len <= f1 - f0 ? f0 + (f1 - f0 - len) / 2
    : clamp(t, Math.min(f1 - len, was === undefined ? Infinity : was), Math.max(f0, was === undefined ? -Infinity : was)));
  const keep = (free, vb, s, tx, ty, was) => ({
    tx: hold(free.x0, free.x1, vb.w * s, tx, was && was.tx),
    ty: hold(free.y0, free.y1, vb.h * s, ty, was && was.ty),
  });

  /** The box around rectangles and points, with room for a block's plinth and tag. */
  function around(rects) {
    const rs = rects.filter(Boolean);
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
    const w = Math.max(...rs.map((r) => r.x + (r.w || 0))) - x, h = Math.max(...rs.map((r) => r.y + (r.h || 0))) - y;
    return { x: x - PAD, y: y - PAD, w: w + 2 * PAD, h: h + 2 * PAD, pad: PAD };
  }
  /** The parts themselves, without the room around them. */
  const core = (b) => (b.pad ? { x: b.x + b.pad, y: b.y + b.pad, w: b.w - 2 * b.pad, h: b.h - 2 * b.pad } : b);
  function boxes(geo, at) {
    const block = (id) => (geo.blocks || []).find((b) => b.id === id) || null;
    const l = at && at.link && (geo.links || []).find((x) => x.id === at.link);
    if (l) {
      const ends = [block(l.from), block(l.to)], line = (l.points || []).map(([x, y]) => ({ x, y }));
      const lb = l.label && l.label.box;
      return [around([...ends, ...line]), around(ends), around([ends[1] || lb || line[line.length - 1]])].filter(Boolean);
    }
    if (at && at.point) return [{ x: at.point[0], y: at.point[1], w: 0, h: 0 }];
    const tags = at && at.module ? (geo.tags || []).filter((t) => t.module === at.module) : [];
    if (tags.length) return [around(tags), around([tags[0]])];
    const id = (at && at.part) || ((geo.flow && geo.flow.starts && geo.flow.starts[0]) || {}).id;
    const b = block(id) || (geo.blocks || [])[0];
    return b ? [around([b])] : [];
  }
  const over = (r, o) => o.r > r.x0 && o.l < r.x1 && o.bottom > r.y0 && o.top < r.y1;
  /**
   * The free room, then the parts of it the box of the step leaves whole: above it, right and left of it; where
   * the zoom (`cover.also`) lies over one of those, that one also above the zoom and left of it.
   */
  function rooms(free, cover) {
    const out = [free];
    if (!cover) return out;
    if (cover.top - M - free.y0 >= 120) out.push({ ...free, y1: Math.min(free.y1, cover.top - M) });
    if (free.x1 - cover.r - M >= 160) out.push({ ...free, x0: Math.max(free.x0, cover.r + M) });
    if (cover.l - M - free.x0 >= 160) out.push({ ...free, x1: Math.min(free.x1, cover.l - M) });
    for (const o of cover.also || []) {
      for (const r of out.slice()) {
        if (!over(r, o)) continue;
        if (o.top - M - r.y0 >= 120) out.push({ ...r, y1: Math.min(r.y1, o.top - M) });
        if (o.l - M - r.x0 >= 160) out.push({ ...r, x1: Math.min(r.x1, o.l - M) });
      }
    }
    return out;
  }
  /** Box b at s, the drawing at tx, ty: inside room a, clear of the box of the step and what else lies over the room (`cover.also`: the zoom). */
  function clear(b, s, tx, ty, a, cover) {
    const l = tx + b.x * s, t = ty + b.y * s, r = l + b.w * s, e = t + b.h * s;
    if (l < a.x0 - 1 || t < a.y0 - 1 || r > a.x1 + 1 || e > a.y1 + 1) return false;
    const off = (o) => r <= o.l || l >= o.r || e <= o.top || t >= o.bottom;
    return !cover || (off(cover) && (cover.also || []).every(off));
  }
  /** Shift t so the stretch from lo to hi (at t 0) lies inside a0..a1, as far as the drawing's edges let it. */
  function into(t, lo, hi, a0, a1, f0, f1, size) {
    if (size <= f1 - f0) return t; // centred: all of it in sight
    const m = Math.max(0, Math.min(M, (a1 - a0 - hi + lo) / 2));
    const d = t + lo < a0 + m ? a0 + m - t - lo : t + hi > a1 - m ? a1 - m - t - hi : 0;
    return clamp(t + d, Math.min(f1, a1) - size, Math.max(f0, a0));
  }
  /** Aimed at box c in room a, box b in it whole: as much of c as the room takes. */
  const lean = (free, a, vb, s, c, b) => {
    const p = place(free, a, vb, s, c);
    return { tx: into(p.tx, b.x * s, (b.x + b.w) * s, a.x0, a.x1, free.x0, free.x1, vb.w * s),
      ty: into(p.ty, b.y * s, (b.y + b.h) * s, a.y0, a.y1, free.y0, free.y1, vb.h * s) };
  };
  const fits = (b, a, s, m) => b.w * s <= a.x1 - a.x0 - 2 * m && b.h * s <= a.y1 - a.y0 - 2 * m;
  /**
   * Where the drawing lies to show the first box that fits whole in the free room, or else in the room above
   * or beside the box of the step, clear of it: with the room around its parts, else the parts alone. Where a
   * larger box comes before it (a step's two parts with its line) that is aimed at, so as much of the step
   * shows as the room takes. Nothing fits: the smallest whole in sight all the same.
   */
  function show(free, cover, vb, s, list) {
    if (!list.length) return null;
    for (const b of list) {
      for (const tight of [false, true]) {
        const k = tight ? core(b) : b;
        for (const a of rooms(free, cover)) {
          if (!fits(k, a, s, tight ? 0 : M)) continue;
          const p = lean(free, a, vb, s, list[0], k);
          if (clear(k, s, p.tx, p.ty, a, cover)) return b === list[0] ? p : lift(free, cover, vb, s, core(list[0]), core(b), p);
        }
      }
    }
    return lean(free, free, vb, s, list[0], list.find((b) => fits(b, free, s, M)) || list[list.length - 1]);
  }
  /** The area of box b at s, the drawing at p, under the box of the step. */
  const under = (b, s, p, c) => Math.max(0, Math.min(p.tx + (b.x + b.w) * s, c.r) - Math.max(p.tx + b.x * s, c.l))
    * Math.max(0, Math.min(p.ty + (b.y + b.h) * s, c.bottom) - Math.max(p.ty + b.y * s, c.top));
  /**
   * Box b shows whole and clear at p, the step's larger box c does not fit clear: the drawing lifted as far as
   * b stays in the room, when that brings more of c out from under the box of the step.
   */
  function lift(free, cover, vb, s, c, b, p) {
    if (!cover) return p;
    const top = free.y0 + PAD * s; // the corner icon of a block stays in sight
    const up = { tx: p.tx, ty: hold(free.y0, free.y1, vb.h * s, Math.max(top - c.y * s, top - b.y * s), p.ty) };
    return clear(b, s, up.tx, up.ty, free, cover) && under(c, s, up, cover) < under(c, s, p, cover) ? up : p;
  }
  function follow(view, free, cover, vb, list) {
    // in sight: the first box that fits with the room around its parts, else the parts alone
    const { s, tx, ty } = view, roomy = list.find((x) => fits(x, free, s, M));
    const b = roomy || list.find((x) => fits(core(x), free, s, 0)) || list[list.length - 1];
    if (!b || clear(roomy ? b : core(b), s, tx, ty, free, cover)) return { tx, ty, moved: false };
    const p = show(free, cover, vb, s, list);
    const moved = Math.abs(p.tx - tx) > 0.5 || Math.abs(p.ty - ty) > 0.5;
    return moved ? { ...p, moved } : { tx, ty, moved };
  }

  /** A step's two parts and its line, and the box around the parts with the room around them; else null. */
  function ends(geo, at) {
    const l = at && at.link && (geo.links || []).find((x) => x.id === at.link);
    const block = (id) => (geo.blocks || []).find((b) => b.id === id) || null;
    const from = l && block(l.from), to = l && block(l.to);
    return from && to ? { from, to, points: l.points || [], box: around([from, to]) } : null;
  }
  /**
   * The zoom for a step's two parts: READ where they fit a room clear of the box of the step, else as much less as
   * that takes, not under LOW. Half the room around them counts (with M, enough for a corner icon and a plinth).
   */
  function fitZoom(free, cover, box) {
    if (!box) return READ;
    const w = box.w - (box.pad || 0), h = box.h - (box.pad || 0);
    const rs = cover ? rooms(free, cover).filter((r) => !over(r, cover) && !(cover.also || []).some((o) => over(r, o))) : [free];
    const best = Math.max(0, ...rs.map((a) => Math.min((a.x1 - a.x0 - 2 * M) / w, (a.y1 - a.y0 - 2 * M) / h)));
    return best >= READ || best < LOW ? READ : Math.floor(best * 100) / 100;
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  /** Where the stretch from p (in room a) to q (out of it) crosses the edge of a. */
  function cross(p, q, a) {
    let best = null;
    for (const [edge, t] of [['l', (a.x0 - p[0]) / (q[0] - p[0])], ['r', (a.x1 - p[0]) / (q[0] - p[0])],
      ['t', (a.y0 - p[1]) / (q[1] - p[1])], ['b', (a.y1 - p[1]) / (q[1] - p[1])]]) {
      if (!(t >= 0 && t <= 1)) continue;
      const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
      const on = edge === 'l' || edge === 'r' ? y >= a.y0 - 0.5 && y <= a.y1 + 0.5 : x >= a.x0 - 0.5 && x <= a.x1 + 0.5;
      if (on && (!best || t < best.t)) best = { t, edge, x: r1(x), y: r1(y) };
    }
    return best && { edge: best.edge, x: best.x, y: best.y };
  }
  function exit(e, far, s, tx, ty, a) {
    const inside = ([x, y]) => x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1;
    const mid = (b) => [tx + (b.x + b.w / 2) * s, ty + (b.y + b.h / 2) * s];
    const pts = e.points.map(([x, y]) => [tx + x * s, ty + y * s]);
    if (far === 'from') pts.reverse(); // from the end in sight toward the part out of it
    const i = pts.findIndex(inside);
    if (i >= 0) for (let k = i; k < pts.length - 1; k++) if (!inside(pts[k + 1])) return cross(pts[k], pts[k + 1], a);
    const c = [(a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2], q = mid(far === 'from' ? e.from : e.to);
    return inside(q) ? null : cross(c, q, a);
  }
  /** The part of a rectangle's area inside a and, of that, under c. */
  const overlap = (l, t, r, b, o) => Math.max(0, Math.min(r, o.r) - Math.max(l, o.l)) * Math.max(0, Math.min(b, o.bottom) - Math.max(t, o.top));
  function seen(b, s, tx, ty, a, cover) {
    const l = tx + b.x * s, t = ty + b.y * s, r = l + b.w * s, e = t + b.h * s, area = (r - l) * (e - t);
    if (!(area > 0)) return 0;
    const room = { l: a.x0, r: a.x1, top: a.y0, bottom: a.y1 }, inside = overlap(l, t, r, e, room);
    const under = cover ? overlap(Math.max(l, a.x0), Math.max(t, a.y0), Math.min(r, a.x1), Math.min(e, a.y1), cover) : 0;
    return Math.max(0, inside - under) / area;
  }
  const hits = (p, w, h, o) => p.left < o.r && p.left + w > o.l && p.top < o.bottom && p.top + h > o.top;
  /**
   * The marker at its edge, inside the room. Where it would lie on the box of the step, the zoom or a part of
   * the step: moved just past what is in its way (left, right, over or under it), and again from there, a few
   * times; the nearest place clear of all.
   */
  function spot(ex, size, a, rects) {
    const { w, h } = size, os = rects.filter(Boolean);
    const fit = (p) => ({ left: clamp(p.left, a.x0 + EDGE, a.x1 - EDGE - w), top: clamp(p.top, a.y0 + EDGE, a.y1 - EDGE - h) });
    const p0 = fit({ left: ex.edge === 'l' ? a.x0 + EDGE : ex.edge === 'r' ? a.x1 - EDGE - w : ex.x - w / 2,
      top: ex.edge === 't' ? a.y0 + EDGE : ex.edge === 'b' ? a.y1 - EDGE - h : ex.y - h / 2 });
    const tried = new Set(), ok = [];
    let level = [p0];
    for (let depth = 0; depth < 4 && level.length; depth++) {
      const next = [];
      for (const p of level) {
        const key = `${Math.round(p.left)},${Math.round(p.top)}`;
        if (tried.has(key)) continue;
        tried.add(key);
        const by = os.filter((o) => hits(p, w, h, o));
        if (!by.length) { ok.push(p); continue; }
        for (const o of by) next.push(...[{ ...p, left: o.l - EDGE - w }, { ...p, left: o.r + EDGE },
          { ...p, top: o.top - EDGE - h }, { ...p, top: o.bottom + EDGE }].map(fit));
      }
      level = next;
    }
    const far = (p) => Math.abs(p.left - p0.left) + Math.abs(p.top - p0.top);
    return ok.sort((x, y) => far(x) - far(y))[0] || p0;
  }

  function watch(fn) {
    const html = typeof document !== 'undefined' && document.documentElement;
    if (!html || typeof MutationObserver === 'undefined') return;
    let was = '';
    new MutationObserver(() => {
      const st = html.style;
      const now = st && typeof st.getPropertyValue === 'function' ? st.getPropertyValue('--masthead-h') : '';
      if (now === was) return;
      was = now;
      fn();
    }).observe(html, { attributes: true, attributeFilter: ['style'] });
  }

  const api = { on, measure, fit, scale, watch, zoom, place, keep, boxes, show, follow, ends, fitZoom, exit, spot, seen, DESK, FLOOR, GAP, READ, LOW, SEEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdRoom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
