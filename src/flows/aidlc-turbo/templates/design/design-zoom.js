/**
 * AI-DLC Turbo - Code Scaffold, the drawing on a desktop page at a size people can read.
 *
 * On a desktop the drawing's box takes the room the window has left
 * (design-room.js). In that box the drawing opens readable on the step held
 * (TdRoom.zoom), or whole and centred where the whole already fits at a
 * readable size; never the whole drawing shrunk until nobody can read it.
 * A step shows both its parts whole where it can: zoomed out for it a little,
 * not under TdRoom.LOW (TdRoom.fitZoom); where not even that does, readable,
 * the part it goes to whole, and a marker at the edge where the step's line
 * leaves the box names the part out of sight ("← RetryPromoter"); a click on
 * it pans there, and a marker then names the other end. When the step
 * changes (Previous, Next, the arrows, a step picked, Play) the
 * drawing glides to it at the step's zoom; a part clicked or reached with
 * the arrows pans it along, the zoom kept; what is in sight already moves
 * nothing, and a part under the box of the step comes out above it. When
 * its box changes size (the page still opening, the window resized) it lies
 * on the step again, unless the viewer dragged or zoomed it.
 *
 * As in the full-screen view (design-view.js): the buttons at the bottom
 * right and the keys + and - zoom in steps of 10 percent (TdView.stepZoom),
 * the percentage can be typed (TdView.zoomField), and "Fit" (or 0) shows
 * the whole drawing; pressed again it goes back to readable on the step. Ctrl
 * with the wheel (a pinch on a touchpad) zooms at the pointer, while the
 * wheel alone scrolls the page. A mouse drags the drawing; a drag pauses
 * playing and never counts as a click. Zoomed by the viewer, every step
 * keeps that zoom.
 *
 *   TdZoom.create({ dz, geo, box, svgOf(), vbOf(svg), size(svg, vb, s), btn, hold(), live(), current(), name(id) })
 *     -> { el, layout(), off(), isOn(), reveal(at), state(), restore(st) }
 *
 * `dz` is the drawing's box: its padding is the walk over it and the line of
 * keys under it, what is left the free room. `box` is the box of the step
 * (design-stepbox.js), `current()` what is held now ({ link }, { part }, or
 * null), `live()` whether the drawing shows (the keys work only then),
 * `name(id)` a part's name as the drawing shows it. The
 * panel puts `el` in the drawing's frame and calls layout() on every fit of
 * the page; off() hands the drawing back to the page and the full-screen
 * view, which size it themselves. state() is the zoom chosen, restore(st)
 * takes it over when the drawing is drawn again (design-filter.js). Its texts
 * come from the page's string table (TdText, design.zoom). The page inlines
 * it as window.TdZoom, after the room, before the panel.
 */
(function (root) {
  'use strict';

  const MAX = 2; // zoomed in no further than this
  const GLIDE = 360; // the glide to the step, a little longer than its transition (design-zoom.css)
  const DRAG = 5; // a press that moves less stays a click
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const R = () => root.TdRoom;
  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const tx = (key, vars) => TX.t(`design.zoom.${key}`, vars);

  function create(o) {
    const { dz } = o;
    const K = root.TdKit;
    let on = false;
    let mode = 'read'; // 'read': readable on the step (whole where that fits); 'fit': the whole; 'free': the viewer's zoom
    let z = null; // { s, tx, ty }: the zoom and where the drawing lies in its box
    let free = null, vb = null, whole = false, fresh = true, timer = null;
    let auto = true, seen = ''; // auto: where it lies is ours, not the viewer's; seen: the size of the room last laid out
    const hold = () => { if (o.hold) o.hold(); };

    const el = K.h('div', 'td-zoom td-pz');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', tx('label'));
    const out = o.btn('td-zb', 'minus', null, tx('out'));
    const inn = o.btn('td-zb', 'plus', null, tx('in'));
    const pct = root.TdView.zoomField({ get: () => (z ? z.s : 1), set: (s) => { hold(); zoomAt(s); } });
    const fitB = o.btn('td-zb td-fitb', 'fit', tx('fit'), tx('fitTip'));
    fitB.setAttribute('aria-pressed', 'false');
    el.append(out, pct.el, inn, fitB);
    // the markers of a step's part out of sight, the part it comes from and the part it goes to
    const marks = ['from', 'to'].map((end) => {
      const b = K.h('button', 'td-src');
      b.type = 'button';
      b.hidden = true;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); if (!b.part) return; hold(); go(b.part); });
      dz.append(b);
      return { end, b };
    });

    /** The free room: the box less its padding (the walk over it, the keys under it). */
    function room() {
      const cs = typeof root.getComputedStyle === 'function' ? root.getComputedStyle(dz) : null;
      const px = (k) => (cs ? parseFloat(cs[k]) || 0 : 0);
      return { x0: px('paddingLeft'), x1: dz.clientWidth - px('paddingRight'), y0: px('paddingTop'), y1: dz.clientHeight - px('paddingBottom') };
    }
    const all = () => R().scale(free.x1 - free.x0, free.y1 - free.y0, vb);
    const lo = () => Math.min(R().READ, all());
    /** The box of the step where it lies over the room, in the box's pixels; else null. */
    function cover() {
      const b = o.box;
      if (!b || b.hidden || typeof b.getBoundingClientRect !== 'function') return null;
      const r = b.getBoundingClientRect(), d = dz.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const ox = d.left + (dz.clientLeft || 0), oy = d.top + (dz.clientTop || 0);
      const c = { l: r.left - ox, r: r.right - ox, top: r.top - oy, bottom: r.bottom - oy };
      const over = c.r > free.x0 && c.l < free.x1 && c.bottom > free.y0 && c.top < free.y1;
      const zb = rect(el); // the zoom over the bottom right: no part under it either
      return over ? { ...c, also: zb ? [zb] : [] } : null;
    }

    const r1 = (v) => Math.round(v * 10) / 10;
    /** At its zoom and place; with a glide from `from`, across another zoom too (drawn at the new one, scaled back first). */
    function paint(glide, from) {
      const svg = o.svgOf();
      if (!svg || !z) return;
      const rescale = glide && from && Math.abs(from.s - z.s) > 1e-3;
      if (rescale) dz.classList.remove('td-glide');
      o.size(svg, vb, z.s);
      if (rescale) {
        svg.style.transform = `translate(${r1(from.tx)}px, ${r1(from.ty)}px) scale(${from.s / z.s})`;
        if (typeof svg.getBoundingClientRect === 'function') svg.getBoundingClientRect(); // laid out there first
      }
      if (glide) {
        dz.classList.add('td-glide');
        clearTimeout(timer);
        timer = setTimeout(() => dz.classList.remove('td-glide'), GLIDE);
      }
      svg.style.transform = `translate(${r1(z.tx)}px, ${r1(z.ty)}px)${rescale ? ' scale(1)' : ''}`;
      pct.show(z.s);
      whole = z.s <= all() + 1e-3;
      const still = whole && mode === 'read' && R().zoom(free, vb).whole; // whole at a readable size: nothing to toggle
      fitB.setAttribute('aria-pressed', String(whole));
      fitB.disabled = still;
      fitB.title = whole && !still ? tx('readTip') : tx('fitTip');
      out.disabled = z.s <= lo() + 1e-3;
      inn.disabled = z.s >= MAX - 1e-3;
      dz.classList.toggle('td-grab', vb.w * z.s > free.x1 - free.x0 + 1 || vb.h * z.s > free.y1 - free.y0 + 1);
      mark();
    }
    /** The step's parts out of sight, each named by its marker at the edge where the step's line leaves the box. */
    function mark() {
      const e = on && z ? R().ends(o.geo, o.current && o.current()) : null, c = cover();
      // never on the step's parts: what shows of them is in the way too
      const parts = e ? [e.from, e.to].map((p) => clip(p)) : [];
      for (const { end, b } of marks) {
        const part = e && e[end];
        if (!part || R().seen(part, z.s, z.tx, z.ty, free, c) >= R().SEEN) { b.hidden = true; b.part = null; continue; }
        const ex = R().exit(e, end, z.s, z.tx, z.ty, free) || cut(part, c);
        const name = (o.name && o.name(part.id)) || part.id, arrow = { l: '←', r: '→', t: '↑', b: '↓', box: '↓' }[ex.edge];
        b.textContent = ex.edge === 'r' ? `${name} ${arrow}` : `${arrow} ${name}`;
        b.setAttribute('aria-label', `${end === 'from' ? tx('toStart') : tx('toEnd')}: ${name}`);
        b.title = end === 'from' ? tx('startsHere') : tx('endsHere');
        b.part = part.id;
        b.hidden = false;
        const p = R().spot(ex.edge === 'box' ? { edge: 'b', x: ex.x, y: ex.y } : ex, { w: b.offsetWidth || 0, h: b.offsetHeight || 0 },
          ex.edge === 'box' ? { ...free, y1: ex.y } : free, [c, rect(el), ...parts]);
        b.style.left = `${Math.round(p.left)}px`;
        b.style.top = `${Math.round(p.top)}px`;
      }
    }
    /** No line out of the box toward it: the edge it is cut off at, else (under the box of the step) just over that box. */
    function cut(part, c) {
      const l = z.tx + part.x * z.s, t = z.ty + part.y * z.s, r = l + part.w * z.s, b = t + part.h * z.s;
      const x = clamp((l + r) / 2, free.x0, free.x1), y = clamp((t + b) / 2, free.y0, free.y1);
      const edge = l < free.x0 ? 'l' : r > free.x1 ? 'r' : t < free.y0 ? 't' : b > free.y1 ? 'b' : 'box';
      return { edge, x, y: edge === 'box' && c ? c.top : y };
    }
    /** What shows of a part, in the box's pixels; null when nothing does. */
    function clip(p) {
      const l = Math.max(free.x0, z.tx + p.x * z.s), r = Math.min(free.x1, z.tx + (p.x + p.w) * z.s);
      const t = Math.max(free.y0, z.ty + p.y * z.s), b = Math.min(free.y1, z.ty + (p.y + p.h) * z.s);
      return r > l && b > t ? { l, r, top: t, bottom: b } : null;
    }
    /** An element over the box (the zoom), in the box's pixels. */
    function rect(x) {
      if (!x || typeof x.getBoundingClientRect !== 'function' || typeof dz.getBoundingClientRect !== 'function') return null;
      const r = x.getBoundingClientRect(), d = dz.getBoundingClientRect();
      if (!r || !r.width) return null;
      const ox = d.left + (dz.clientLeft || 0), oy = d.top + (dz.clientTop || 0);
      return { l: r.left - ox, r: r.right - ox, top: r.top - oy, bottom: r.bottom - oy };
    }
    /** The zoom for what is held: a step's own (its two parts whole), else readable. */
    const zoomFor = (at) => R().fitZoom(free, cover(), (R().ends(o.geo, at) || {}).box);

    /** Fit it in its box again: on every fit of the page, after a resize, a fold, another story. */
    function layout(opt) {
      const svg = o.svgOf();
      vb = svg ? o.vbOf(svg) : null;
      if (!vb) return;
      free = room();
      if (free.x1 - free.x0 < 40 || free.y1 - free.y0 < 40) return;
      on = true;
      const size = `${Math.round(free.x1 - free.x0)}x${Math.round(free.y1 - free.y0)}`;
      const grew = !!seen && size !== seen; // the page opens before the stage has its height, a window resized
      seen = size;
      const read = R().zoom(free, vb);
      const s = mode === 'fit' ? all() : mode === 'read' ? (read.whole ? read.s : zoomFor(o.current && o.current())) : clamp(z ? z.s : read.s, lo(), MAX);
      const moved = !z || Math.abs(s - z.s) > 1e-3;
      if (mode === 'fit' || (mode === 'read' && read.whole)) z = { s, ...R().keep(free, vb, s, 0, 0) };
      else if (fresh || moved || (opt && opt.focus) || (grew && auto)) {
        z = { s, ...(R().show(free, cover(), vb, s, R().boxes(o.geo, o.current && o.current())) || R().keep(free, vb, s, 0, 0)) };
        auto = true;
      } else z = { s, ...R().keep(free, vb, s, z.tx, z.ty, z) };
      fresh = false;
      paint(opt && opt.glide);
    }
    function off() {
      if (!on) return;
      on = false;
      const svg = o.svgOf();
      if (svg) svg.style.transform = '';
      for (const { b } of marks) b.hidden = true;
      dz.classList.remove('td-glide', 'td-grab', 'td-dragging');
      drag = null;
    }

    /** A step: to it at its own zoom (readable, zoomed by the viewer: that zoom). Anything: pan to it when it is out of sight. */
    function reveal(at) {
      if (!on || !z) return;
      const c = cover(), list = R().boxes(o.geo, at);
      if (mode === 'read' && at && at.link && !R().zoom(free, vb).whole) {
        const s = zoomFor(at);
        if (Math.abs(s - z.s) > 1e-3) {
          const from = z;
          z = { s, ...(R().show(free, c, vb, s, list) || R().keep(free, vb, s, z.tx, z.ty)) };
          auto = true;
          paint(true, from);
          return;
        }
      }
      const f = R().follow(z, free, c, vb, list);
      if (!f.moved) { mark(); return; }
      z = { s: z.s, tx: f.tx, ty: f.ty };
      auto = true;
      paint(true);
    }
    /** A marker clicked: to the part it names, the zoom kept. */
    function go(id) {
      if (!on || !z) return;
      const f = R().follow(z, free, cover(), vb, R().boxes(o.geo, { part: id }));
      z = { s: z.s, tx: f.tx, ty: f.ty };
      auto = false;
      paint(true);
    }

    /** Zoom to s around the point (cx, cy) of the box, the middle of the free room when none is given. */
    function zoomAt(s, cx, cy) {
      if (!on || !z) return;
      const x = cx === undefined ? (free.x0 + free.x1) / 2 : cx, y = cy === undefined ? (free.y0 + free.y1) / 2 : cy;
      const to = clamp(s, lo(), MAX), k = to / z.s;
      z = { s: to, ...R().keep(free, vb, to, x - (x - z.tx) * k, y - (y - z.ty) * k) };
      mode = 'free';
      auto = false;
      paint();
    }
    const step = (dir) => { hold(); if (z) zoomAt(root.TdView.stepZoom(z.s, dir)); };
    /** "Fit": the whole drawing; pressed again, back to readable on the step. */
    function toggle() {
      if (!on || fitB.disabled) return;
      hold();
      mode = whole ? 'read' : 'fit';
      layout({ focus: true });
    }
    out.addEventListener('click', () => step(-1));
    inn.addEventListener('click', () => step(1));
    fitB.addEventListener('click', toggle);

    const local = (ev) => { const r = dz.getBoundingClientRect(); return { x: ev.clientX - r.left - (dz.clientLeft || 0), y: ev.clientY - r.top - (dz.clientTop || 0) }; };
    // Ctrl with the wheel, or a pinch on a touchpad (the browser sends it so): zoom at the pointer; the wheel alone scrolls the page
    dz.addEventListener('wheel', (ev) => {
      if (!on || !z || !(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      hold();
      const d = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1), p = local(ev);
      zoomAt(z.s * Math.exp(-d * 0.01), p.x, p.y);
    }, { passive: false });

    // a mouse drags the drawing; a drag is never a click on what it started on
    let drag = null, dragged = false;
    dz.addEventListener('pointerdown', (ev) => {
      if (!on || !z || ev.button !== 0 || ev.pointerType === 'touch' || marks.some((m) => m.b === ev.target)) return;
      dragged = false;
      drag = { x: ev.clientX, y: ev.clientY, tx: z.tx, ty: z.ty, id: ev.pointerId, live: false };
    });
    dz.addEventListener('pointermove', (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.live) {
        if (Math.hypot(dx, dy) < DRAG) return;
        drag.live = true;
        auto = false;
        hold();
        try { dz.setPointerCapture(drag.id); } catch (e) { /* the pointer is gone */ }
        dz.classList.add('td-dragging');
      }
      z = { s: z.s, ...R().keep(free, vb, z.s, drag.tx + dx, drag.ty + dy, drag) };
      paint();
    });
    const end = (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      if (drag.live) dragged = true;
      drag = null;
      dz.classList.remove('td-dragging');
    };
    dz.addEventListener('pointerup', end);
    dz.addEventListener('pointercancel', end);
    dz.addEventListener('click', (ev) => {
      if (!dragged) return;
      dragged = false;
      ev.stopImmediatePropagation();
      ev.stopPropagation();
      ev.preventDefault();
    }, true);

    // the keys of the full-screen view: + and - zoom, 0 shows the whole (and back)
    if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('keydown', (ev) => {
      if (!on || !z || ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || !(o.live && o.live())) return;
      const t = ev.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable)) return;
      const k = { '+': 1, '=': 1, '-': -1, _: -1 }[ev.key];
      if (k) { ev.preventDefault(); step(k); } else if (ev.key === '0') { ev.preventDefault(); toggle(); }
    });

    return {
      el, layout, off, reveal,
      isOn: () => on,
      state: () => ({ mode, s: z ? z.s : null, whole }),
      restore(st) { if (!st) return; mode = st.mode || 'read'; if (st.s) z = { s: st.s, tx: 0, ty: 0 }; fresh = true; },
    };
  }

  const api = { create, MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdZoom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
