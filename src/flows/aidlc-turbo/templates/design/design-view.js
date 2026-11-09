/**
 * AI-DLC Turbo - Code Scaffold, the drawing on full screen.
 *
 * Moves the drawing, the chips, the legend and the details of the panel
 * (design-panel.js) into a view over the whole window: zoom with the buttons
 * and the keys + and - in steps of 10 percent (`stepZoom`), the percentage
 * typed between them (`zoomField`), the wheel, two
 * fingers or a double tap; drag with the mouse or one
 * finger; Esc or Close goes back. With a mouse it asks the browser for real
 * full screen as well; where that is refused (a frame) the view still covers
 * the window, and the page behind it stays put.
 *
 * On a touch screen the view opens at a readable size on START 1, or on the
 * step or the spot it was opened for, instead of the whole drawing at a size
 * nobody can read. The zoom buttons and the legend sit at the bottom, within
 * reach of a thumb; on a narrow screen the details and the legend open as
 * sheets from the bottom. A single tap waits a moment, so a double tap only
 * zooms.
 *
 * The walk over the steps comes along at the top left, the details of the
 * panel at the right (the block chosen or the part the step goes to, design-show.js;
 * on a desktop in a frame to drag and to fold, design-float.js),
 * the line of its keys (`hint`) at the bottom, and the box of the step held
 * (`box`, design-stepbox.js), which stays inside the view and is its own to
 * drag: the view never pans, zooms or lets go under it. reveal(at) pans to
 * a step only when it is out of sight and keeps the zoom; it counts what a
 * sheet or a drawer covers (TdKit.covers), and opening a sheet reveals what
 * was chosen, or what was in the middle. Touching, dragging or zooming the
 * drawing and leaving the view pause playing (design-play.js). The chips
 * take a row of their own when they do not fit beside the title; on a phone
 * they show only their numbers and the title names the story chosen. The
 * hint on how to move fades after a few seconds or the first touch. With
 * `keep` a view drawn again (design-filter.js) takes over the overlay and the
 * browser's full screen of the one before.
 *
 *   TdView.create({ dz, ctl, detail, chips, bar, keys, hint, box, play, how, btn, svgOf, vbOf, title,
 *                   size, geo, drawn, current, onClose, onBlank })
 *     -> { open(at, keep), close(keep), isOpen, refit, focus, reveal, roomFor, touchy, touched }
 *   TdView.zoomField({ get(), set(s) }) -> { el, show(s) }
 *   TdView.stepZoom(s, dir) -> the zoom 10 percent up (dir 1) or down (-1), an odd one to the round ten first
 *
 * `at` is { link }, { part }, { module } or { point: [x, y] } in the drawing's own units;
 * `current()` names what is chosen now, or null.
 */
(function (root) {
  'use strict';

  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;
  const tv = (key, vars) => TX.t(`design.view.${key}`, vars);
  const PAD = 28;
  const TIP = 4000; // the hint on how to move stays this long
  const READ = 0.9; // the size a phone opens at: the smallest text stays around 10 px
  const WIDE = '(min-width: 900px)'; // from here the legend is a column beside the drawing, below it a sheet
  const narrow = () => typeof matchMedia === 'function' && !matchMedia(WIDE).matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  let lastType = null;
  if (typeof addEventListener === 'function') addEventListener('pointerdown', (ev) => { lastType = ev.pointerType || 'mouse'; }, true);
  const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  /** The last tap was a finger (or, before any, the screen is a touch screen). */
  const touchy = () => (lastType ? lastType === 'touch' : coarse());
  const touched = () => lastType === 'touch';

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /** The next zoom a step away: 10 percent up or down, an odd zoom (a wheel, a pinch, the fit) to the round ten first. */
  function stepZoom(s, dir) {
    const tens = Math.round(s * 1000) / 100;
    return (dir > 0 ? Math.floor(tens + 1e-6) + 1 : Math.ceil(tens - 1e-6) - 1) * 10 / 100;
  }

  /** The zoom as a field: it reads "100%"; a number typed (a % and a comma are fine) sets it on Enter or on
   *  leaving the field, `set(s)` clamps it; anything else puts it back, as Escape does. The up and down arrows
   *  step as the buttons. show(s) writes the zoom, never over what is being typed. */
  function zoomField(o) {
    const el = h('input', 'td-pct');
    el.type = 'text';
    for (const [k, v] of [['aria-label', tv('zoomField')], ['inputmode', 'decimal'], ['autocomplete', 'off'], ['spellcheck', 'false'], ['enterkeyhint', 'done']]) el.setAttribute(k, v);
    el.title = tv('zoomFieldTip');
    let shown = '', fresh = false;
    const show = (s, force) => { if (force || document.activeElement !== el) el.value = shown = Math.round(s * 100) + '%'; };
    const typed = () => { const m = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(el.value), n = m ? parseFloat(m[1].replace(',', '.')) : 0; return n > 0 ? n / 100 : null; };
    function commit() {
      const s = el.value === shown ? null : typed();
      if (s) o.set(s);
      show(o.get(), true);
    }
    el.addEventListener('focus', () => { fresh = true; el.select(); });
    el.addEventListener('mouseup', (ev) => { if (fresh) ev.preventDefault(); fresh = false; }); // the click that focused it keeps the text selected
    el.addEventListener('blur', commit);
    el.addEventListener('keydown', (ev) => {
      const step = { ArrowUp: 1, ArrowDown: -1 }[ev.key];
      if (ev.key === 'Escape') { ev.preventDefault(); show(o.get(), true); el.blur(); return; } // the view stays open
      if (ev.key !== 'Enter' && !step) return;
      ev.preventDefault();
      if (step) { o.set(stepZoom(o.get(), step)); show(o.get(), true); } else commit();
      el.select();
    });
    return { el, show };
  }

  function create(c) {
    const { dz, detail } = c;
    const float = root.TdFloat.create({ detail }); // on a desktop the details float in a frame of their own
    let fs = null; // the view while it is open
    let sideOpen = false;
    const hold = () => c.play && c.play.stop(); // the viewer moves the drawing: playing pauses

    function place() {
      const svg = c.svgOf(), vb = c.vbOf(svg);
      if (!fs || !vb) return;
      if (fs.touch) keepInView(vb);
      c.size(svg, vb, fs.s);
      dz.style.left = fs.tx + 'px';
      dz.style.top = fs.ty + 'px';
      fs.pct.show(fs.s);
    }
    // on a touch screen a quarter of the view stays drawing, so a flick never loses it
    function keepInView(vb) {
      const W = fs.view.clientWidth, H = fs.view.clientHeight, w = vb.w * fs.s, hh = vb.h * fs.s;
      const mx = Math.min(W / 4, w), my = Math.min(H / 4, hh);
      fs.tx = clamp(fs.tx, mx - w, W - mx);
      fs.ty = clamp(fs.ty, my - hh, H - my);
    }
    function fitView() {
      const vb = c.vbOf(c.svgOf());
      if (!fs || !vb) return;
      const W = fs.view.clientWidth, H = fs.view.clientHeight;
      if (!W || !H) return;
      const below = fs.touch ? 72 : 44; // the controls, or the keys and the hint, under the drawing
      // the walk at the top left (a row or two): the drawing starts under it
      const under = (el) => (el && el.offsetParent ? el.offsetTop + el.offsetHeight + 10 : 0);
      const top = c.ctl ? Math.max(68, under(c.ctl.querySelector('.td-ctl-l'))) : PAD;
      fs.s = clamp(Math.min((W - 2 * PAD) / vb.w, (H - top - below) / vb.h), 0.1, 1.25);
      fs.tx = (W - vb.w * fs.s) / 2;
      fs.ty = Math.max(top, (H - below + top - vb.h * fs.s) / 2);
      fs.fitted = true;
      fs.last = null;
      place();
    }
    function zoomAt(f, cx, cy) {
      const s = clamp(fs.s * f, 0.15, 3), k = s / fs.s;
      fs.tx = cx - (cx - fs.tx) * k;
      fs.ty = cy - (cy - fs.ty) * k;
      fs.s = s;
      fs.fitted = false;
      fs.last = null;
      place();
    }
    const zoomBy = (f) => fs && zoomAt(f, fs.view.clientWidth / 2, fs.view.clientHeight / 2);
    const zoomStep = (dir) => fs && zoomBy(stepZoom(fs.s, dir) / fs.s);

    /** The part of the view no sheet, drawer or control covers: from x0 to x1, from y0 (under the walk) to y1. */
    function free() {
      const W = fs.view.clientWidth, H = fs.view.clientHeight, vr = fs.view.getBoundingClientRect();
      // the walk at the top (a row or two): what is shown never goes under it
      const under = (el) => (el && el.offsetParent ? el.offsetTop + el.offsetHeight + 10 : 0);
      const y0 = c.ctl ? under(c.ctl.querySelector('.td-ctl-l')) : 0;
      const els = [detail, fs.side].filter((el) => el && !el.hidden);
      const k = root.TdKit.covers(vr, els.map((el) => el.getBoundingClientRect()));
      return { x0: k.l, x1: Math.max(k.l + 40, W - k.r), y0, y1: Math.max(y0 + 40, H - k.b) };
    }
    /** The box to show for `at`: a line with its label, a block, a module, a spot; START 1 when nothing is asked. */
    function target(at) {
      const g = c.geo;
      const l = at && at.link && g.links.find((x) => x.id === at.link);
      if (l) {
        const xs = l.points.map((p) => p[0]), ys = l.points.map((p) => p[1]);
        const lb = l.label && l.label.box;
        const all = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        return { all, core: lb || { x: all.x + all.w / 2, y: all.y + all.h / 2, w: 0, h: 0 } };
      }
      if (at && at.point) return { core: { x: at.point[0], y: at.point[1], w: 0, h: 0 } };
      const tags = at && at.module ? (g.tags || []).filter((t) => t.module === at.module) : [];
      if (tags.length) {
        const x = Math.min(...tags.map((t) => t.x)), y = Math.min(...tags.map((t) => t.y));
        const all = { x, y, w: Math.max(...tags.map((t) => t.x + t.w)) - x, h: Math.max(...tags.map((t) => t.y + t.h)) - y };
        return { all, core: tags[0] };
      }
      const id = (at && at.part) || ((g.flow && g.flow.starts[0]) || {}).id;
      const b = g.blocks.find((x) => x.id === id) || g.blocks[0];
      return b ? { core: { x: b.x, y: b.y, w: b.w, h: b.h } } : null;
    }
    /** Show `at` in the middle of what a sheet leaves free (START 1 in its upper third), at a readable
     *  size on a touch screen. A drawing larger than the free part runs to its edges, never leaving a strip. */
    function focus(at) {
      const vb = c.vbOf(c.svgOf()), t = target(at);
      if (!fs || !vb || !t) return;
      const { x0, x1, y0, y1 } = free(), W = x1 - x0, Hf = y1 - y0;
      const s = fs.touch ? Math.max(fs.s, READ) : fs.s;
      const fits = t.all && t.all.w * s < W - 2 * PAD && t.all.h * s < Hf - 2 * PAD;
      const b = fits ? t.all : t.core;
      const w = vb.w * s, hh = vb.h * s;
      fs.s = s;
      fs.last = at || {}; // what a sheet coming up keeps in sight; {} is START 1
      fs.tx = w + 2 * PAD > W ? clamp(x0 + W / 2 - (b.x + b.w / 2) * s, x1 - w, x0) : x0 + (W - w) / 2;
      fs.ty = hh + 2 * PAD > Hf ? clamp(y0 + (at ? Hf / 2 : Hf / 3) - (b.y + b.h / 2) * s, y1 - hh, y0) : y0 + (Hf - hh) / 2;
      fs.fitted = false;
      place();
    }
    /** Pan to `at` only when it is (partly) out of sight; the zoom stays. */
    function reveal(at) {
      const t = target(at);
      if (!fs || !t) return;
      const { x0, x1, y0, y1 } = free(), s = fs.s;
      const whole = t.all && t.all.w * s < x1 - x0 - 2 * PAD && t.all.h * s < y1 - y0 - 2 * PAD;
      const b = whole ? t.all : t.core;
      const bx = fs.tx + b.x * s, by = fs.ty + b.y * s;
      fs.last = at;
      if (bx >= x0 + 8 && by >= y0 + 8 && bx + b.w * s <= x1 - 8 && by + b.h * s <= y1 - 8 && !(fs.touch && s < READ)) return;
      fs.view.classList.add('td-glide');
      clearTimeout(fs.glide);
      fs.glide = setTimeout(() => fs && fs.view.classList.remove('td-glide'), 360);
      focus(at);
    }

    /** The drawing's point in the middle of what the view shows now. */
    function mid() {
      const { x0, x1, y0, y1 } = free();
      return { point: [((x0 + x1) / 2 - fs.tx) / fs.s, ((y0 + y1) / 2 - fs.ty) / fs.s] };
    }
    /** The chips beside the title while they fit, else on a row of their own; on a phone by their numbers only.
     *  A strip that still scrolls fades at its edge. */
    function chipRow() {
      if (!fs) return;
      const ch = c.chips, over = () => ch.scrollWidth > ch.clientWidth + 1;
      fs.ov.classList.remove('td-chips-row', 'td-chips-num');
      if (over()) fs.ov.classList.add(fs.touch && innerWidth <= 560 ? 'td-chips-num' : 'td-chips-row');
      storyTitle();
      fade();
    }
    function storyTitle() {
      const on = fs.ov.classList.contains('td-chips-num') && c.chips.querySelector('.td-chip.td-on:not(.td-all)');
      const b = on && on.querySelector('.td-badge');
      if (!on) fs.title.textContent = c.title || 'Code Scaffold';
      else fs.title.replaceChildren(b.cloneNode(true), h('span', null, on.textContent.slice(b.textContent.length).trim()));
    }
    function fade() {
      const ch = c.chips, more = ch.scrollWidth - ch.clientWidth;
      ch.classList.toggle('td-fade-l', more > 1 && ch.scrollLeft > 2);
      ch.classList.toggle('td-fade-r', more > 1 && ch.scrollLeft < more - 2);
    }
    /** Details open beside the drawing: the legend column makes way when the drawing keeps too little room. */
    function roomFor() {
      if (!fs || !sideOpen || narrow() || detail.hidden) return;
      const f = free();
      if (f.x1 - f.x0 >= 560) return;
      sideOpen = false;
      fs.showSide();
      if (fs.fitted) fitView();
    }

    /** `keep` (from close(true) of the view drawn before): its overlay, and the browser's full screen, go on. */
    function open(at, keep) {
      if (fs) { if (at) focus(at); return; }
      const touch = touchy(), x = keep ? keep.x : scrollX, y = keep ? keep.y : scrollY; // before the page shrinks
      const ov = keep ? keep.ov : h('div', 'td-fs td-root' + (touch ? ' td-touch' : ''));
      if (keep) { ov.replaceChildren(); ov.classList.toggle('td-touch', touch); sideOpen = keep.side; }
      for (const [k, v] of [['role', 'dialog'], ['aria-modal', 'true'], ['aria-label', tv('label', { title: c.title || 'Code Scaffold' })]]) ov.setAttribute(k, v);
      const top = h('div', 'td-fs-top'), slot = h('div', 'td-fs-chips'), tools = h('div', 'td-fs-tools');
      const sideB = c.btn('td-sideb', 'side', TX.t('design.legend.title'), tv('side'));
      const dock = h('div', 'td-fs-dock');
      dock.append(sideB);
      const out = c.btn('td-zb', 'minus', null, tv('zoomOut')), inn = c.btn('td-zb', 'plus', null, tv('zoomIn'));
      const zf = zoomField({ get: () => (fs ? fs.s : 1), set: (s) => { if (fs) { hold(); zoomBy(s / fs.s); } } });
      const fitB = c.btn('td-zb td-fitb', 'fit', tv('fit'), tv('fitTip'));
      const closeB = c.btn('td-closeb', 'close', tv('close'), tv('closeTip'));
      const zoom = h('div', 'td-zoom');
      zoom.append(out, zf.el, inn, fitB);
      // a finger finds the legend and the zoom in one bar at the bottom of the drawing, a mouse in the bar on top
      const ctl = h('div', 'td-fs-ctl');
      if (touch) { ctl.append(dock, zoom); tools.append(closeB); } else tools.append(dock, zoom, closeB);
      const title = h('h2', 'td-fs-title', c.title || 'Code Scaffold');
      top.append(title, slot, tools);
      const body = h('div', 'td-fs-body'), side = h('aside', 'td-fs-side'), view = h('div', 'td-fs-view');
      side.setAttribute('aria-label', tv('sideTitle'));
      const sideHead = h('div', 'td-side-h'), sideX = c.btn('td-side-x', 'close', null, tv('closeLegend'));
      sideHead.append(h('h3', null, tv('sideTitle')), sideX);
      const moved = [c.chips, c.bar, c.keys, c.ctl, dz, detail, c.hint, c.box].filter(Boolean).map((el) => { const m = document.createComment('td'); el.replaceWith(m); return [el, m]; });
      body.append(side, view);
      ov.append(top, body);
      slot.append(c.chips);
      // the legend first: that is what the button promises; the story and how to use the view under it
      side.append(sideHead, c.keys, c.bar, h('p', 'td-fs-how', c.how(touch)));
      if (c.ctl) view.append(c.ctl);
      const det = touch ? detail : float.take();
      view.append(dz, det, ...(c.hint ? [c.hint] : []), ...(c.box ? [c.box] : []), h('p', 'td-fs-tip', tv(touch ? 'tipTouch' : 'tip')));
      if (touch) view.append(ctl);
      // a sheet that comes up keeps in sight what was chosen, or else what was in the middle of the view
      const showSide = (was) => {
        const at = was && fs && ((c.current && c.current()) || fs.last || mid());
        ov.classList.toggle('td-side-on', sideOpen);
        sideB.setAttribute('aria-pressed', String(sideOpen));
        if (at) reveal(at);
      };
      showSide();
      if (!keep) document.body.append(ov);
      if (!touch) float.place();
      document.documentElement.classList.add('td-fs-lock');
      fs = { ov, view, side, title, pct: zf, moved, showSide, s: 1, tx: 0, ty: 0, fitted: true, full: !!keep && keep.full, touch,
        back: keep ? keep.back : document.activeElement, x, y };
      if (c.drawn.fit) c.drawn.fit(0);
      chipRow();
      fitView();
      if (c.box && c.box.tdPlace) c.box.tdPlace(); // the step box inside the view
      if (touch && (fs.s < 0.7 || at)) focus(at);
      // the hint on how to move goes by itself, or at the first touch, click, wheel or key
      const used = () => { if (fs) ov.classList.add('td-used'); };
      fs.tip = setTimeout(used, TIP);
      for (const t of ['pointerdown', 'wheel', 'keydown']) ov.addEventListener(t, used, { capture: true, passive: true });
      c.chips.addEventListener('scroll', fade, { passive: true });
      c.chips.addEventListener('click', storyTitle);

      out.onclick = () => { hold(); zoomStep(-1); };
      inn.onclick = () => { hold(); zoomStep(1); };
      fitB.onclick = () => { hold(); fitView(); };
      closeB.onclick = () => close();
      sideB.onclick = () => { sideOpen = !sideOpen; showSide(sideOpen); if (fs.fitted) fitView(); };
      sideX.onclick = () => { sideOpen = false; showSide(); sideB.focus(); };
      view.addEventListener('wheel', (ev) => {
        if (ev.target.closest('.td-detail, .td-fdet, .td-fs-ctl, .td-ctl, .td-sbox')) return;
        ev.preventDefault();
        hold();
        const d = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1);
        const r = view.getBoundingClientRect();
        zoomAt(Math.exp(-d * (ev.ctrlKey ? 0.01 : 0.0015)), ev.clientX - r.left, ev.clientY - r.top);
      }, { passive: false });
      gestures(ov, view, side, showSide);
      if (typeof ResizeObserver !== 'undefined') {
        fs.ro = new ResizeObserver(() => { if (fs && fs.fitted) fitView(); });
        fs.ro.observe(view);
        fs.rt = new ResizeObserver(() => chipRow());
        fs.rt.observe(top);
      }

      if (!keep) closeB.focus();
      // real full screen as well, with a mouse; refused (a locked frame) the view still covers the window.
      // Not for a finger: a phone often refuses it, and inside it a sheet may no longer scroll by touch.
      if (!touch && !keep) try { const p = ov.requestFullscreen && ov.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* refused */ }
    }

    /** Drag with the mouse or one finger, pinch with two, a double tap zooms; a drag never counts as a click. */
    function gestures(ov, view, side, showSide) {
      const pts = new Map();
      let drag = null, pinch = null, dragged = false, tap = null, passing = false;
      const local = (ev) => { const r = view.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
      const pair = () => {
        const [a, b] = [...pts.values()];
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
      };
      const sheet = (el) => el.getBoundingClientRect().width >= view.getBoundingClientRect().width * 0.9;
      view.addEventListener('pointerdown', (ev) => {
        // the controls over the drawing (the walk, its keys, its stories, the step box) take their own taps and clicks
        if ((ev.pointerType === 'mouse' && ev.button !== 0) || ev.target.closest('.td-detail, .td-fdet, .td-fs-ctl, .td-ctl, .td-sbox')) return;
        hold();
        if (!pts.size) dragged = false;
        pts.set(ev.pointerId, local(ev));
        ov.classList.add('td-used');
        // a touch on the drawing puts the legend sheet away
        if (sideOpen && fs.touch && sheet(side)) { sideOpen = false; showSide(); }
        if (pts.size === 1) drag = { ...local(ev), tx: fs.tx, ty: fs.ty, id: ev.pointerId, on: false };
        else if (pts.size === 2) {
          drag = null;
          dragged = true;
          pinch = { m: pair(), s: fs.s, tx: fs.tx, ty: fs.ty };
          for (const id of pts.keys()) try { view.setPointerCapture(id); } catch (e) { /* the pointer is gone */ }
        }
      });
      ov.addEventListener('pointermove', (ev) => {
        if (!pts.has(ev.pointerId)) return;
        pts.set(ev.pointerId, local(ev));
        if (pinch && pts.size >= 2) {
          const m = pair(), k = clamp(pinch.s * m.d / pinch.m.d, 0.15, 3) / pinch.s;
          Object.assign(fs, { s: pinch.s * k, tx: m.x - (pinch.m.x - pinch.tx) * k, ty: m.y - (pinch.m.y - pinch.ty) * k, fitted: false, last: null });
          place();
          return;
        }
        if (!drag || drag.id !== ev.pointerId) return;
        const p = pts.get(ev.pointerId), dx = p.x - drag.x, dy = p.y - drag.y;
        if (!drag.on) {
          if (Math.hypot(dx, dy) < (ev.pointerType === 'touch' ? 8 : 5)) return;
          drag.on = true;
          try { view.setPointerCapture(drag.id); } catch (e) { /* the pointer is gone */ }
          view.classList.add('td-panning');
        }
        Object.assign(fs, { tx: drag.tx + dx, ty: drag.ty + dy, fitted: false, last: null });
        place();
      });
      const end = (ev) => {
        if (!pts.has(ev.pointerId)) return;
        pts.delete(ev.pointerId);
        if (drag && drag.on) dragged = true;
        if (pinch && pts.size === 1) { // one finger left: it drags on from where it is
          pinch = null;
          const [id, p] = [...pts.entries()][0];
          drag = { x: p.x, y: p.y, tx: fs.tx, ty: fs.ty, id, on: true };
          return;
        }
        if (!pts.size) { drag = null; pinch = null; view.classList.remove('td-panning'); }
      };
      ov.addEventListener('pointerup', end);
      ov.addEventListener('pointercancel', end);
      // a finger's tap waits a moment: a second tap close by zooms (in to readable, or back out to the whole)
      const fire = (t) => {
        if (!fs || !t.el.isConnected) return;
        if (!t.el.closest('.td-node, .td-frame, .td-edge, .td-elab')) { if (c.onBlank) c.onBlank(); return; }
        passing = true;
        try { t.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: t.cx, clientY: t.cy })); } finally { passing = false; }
      };
      view.addEventListener('click', (ev) => {
        if (passing || ev.target.closest('.td-fs-ctl, .td-ctl, .td-sbox')) return;
        if (dragged) { ev.stopPropagation(); ev.preventDefault(); dragged = false; return; }
        if (ev.target.closest('.td-detail, .td-fdet')) return;
        if (lastType !== 'touch') {
          // a click around the drawing counts as one on its empty space (on the drawing the panel hears it)
          if (!ev.target.closest('.td-dz') && c.onBlank) c.onBlank();
          return;
        }
        ev.stopPropagation();
        ev.preventDefault();
        const p = local(ev);
        if (tap && Math.hypot(p.x - tap.x, p.y - tap.y) < 40) {
          clearTimeout(tap.timer);
          tap = null;
          if (fs.s < 0.8) zoomAt(1 / fs.s, p.x, p.y); else fitView();
          return;
        }
        if (tap) { clearTimeout(tap.timer); fire(tap); }
        const t = { ...p, el: ev.target, cx: ev.clientX, cy: ev.clientY };
        t.timer = setTimeout(() => { tap = null; fire(t); }, 260);
        tap = t;
      }, true);
    }

    /** With `keep` the overlay stays, in full screen, for the view drawn next: returned as open(at, keep) takes it. */
    function close(keep) {
      if (!fs) return null;
      const f = fs;
      fs = null;
      hold();
      if (!keep && document.fullscreenElement === f.ov && document.exitFullscreen) {
        try { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* already out */ }
      }
      for (const [el, m] of f.moved) m.replaceWith(el);
      if (c.box && c.box.tdPlace) c.box.tdPlace(); // the step box back on the page
      dz.style.left = dz.style.top = '';
      if (f.ro) { f.ro.disconnect(); f.rt.disconnect(); }
      clearTimeout(f.tip);
      c.chips.removeEventListener('scroll', fade);
      c.chips.removeEventListener('click', storyTitle);
      c.chips.classList.remove('td-fade-l', 'td-fade-r');
      if (keep) return { ov: f.ov, full: f.full, back: f.back, x: f.x, y: f.y, side: sideOpen };
      f.ov.remove();
      document.documentElement.classList.remove('td-fs-lock');
      if (c.onClose) c.onClose();
      if (f.back && f.back.focus) f.back.focus({ preventScroll: true });
      // the page shrank while its parts were in the view: back to where it was, at once, not smoothly
      const html = document.documentElement.style, was = html.scrollBehavior;
      html.scrollBehavior = 'auto';
      scrollTo(f.x, f.y);
      html.scrollBehavior = was;
    }

    document.addEventListener('keydown', (ev) => {
      if (!fs || ev.ctrlKey || ev.metaKey || ev.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
      const k = { '+': 1, '=': 1, '-': -1, _: -1 }[ev.key];
      if (k) { ev.preventDefault(); hold(); zoomStep(k); } else if (ev.key === '0') { ev.preventDefault(); hold(); fitView(); }
    });
    // leaving the browser's full screen (Esc there never reaches the page) also closes the view
    document.addEventListener('fullscreenchange', () => {
      if (!fs) return;
      if (document.fullscreenElement === fs.ov) fs.full = true;
      else if (fs.full) { fs.full = false; close(); }
    });
    // Safari zooms the page on a pinch whatever touch-action says; not while the view is open
    for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (ev) => { if (fs) ev.preventDefault(); }, { passive: false });

    return { open, close, isOpen: () => !!fs, refit: () => fs && fs.fitted && fitView(), focus: (at) => fs && focus(at),
      reveal: (at) => fs && reveal(at), roomFor, touchy, touched };
  }

  root.TdView = { create, touchy, touched, zoomField, stepZoom };
})(typeof globalThis !== 'undefined' ? globalThis : this);
