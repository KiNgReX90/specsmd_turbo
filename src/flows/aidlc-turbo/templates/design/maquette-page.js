/**
 * AI-DLC Turbo overview, "Maquette": the page as a scale model being put together.
 *
 * Only how the page looks and moves; every text and every function stays where the template and the
 * drawing put them. On the overview's own page (body.mq) it:
 *   - gives a switch (the tabs Functional, Code Scaffold or Code, Review) a knob that slides;
 *   - sets the words of the title as pieces;
 *   - gives the lifecycle and the test graph their depth each time the page draws them (a side, a shadow);
 *   - assembles the page on load: the board, the title, the first slab and what stands on it; a section
 *     further down assembles when a scroll brings it in. A section a resize brings in, a hidden tab, a
 *     slow load, a headless render or reduced motion: no motion, everything simply there. Every animation
 *     only adds a start state before it plays (fill backwards), so nothing ever waits on it to be seen.
 * The drawing's own depth and assembly: maquette-draw.js, through root.Mq.
 */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  const NS = 'http://www.w3.org/2000/svg';
  const OUT = 'cubic-bezier(.16, 1, .3, 1)';
  const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const on = () => document.body && document.body.classList.contains('mq');
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const shown = (el) => !!el && el.getClientRects().length > 0;

  /* ---------- the motion: a start state and a way to the rest, never an end state of its own ---------- */
  const K = {
    slab: [{ opacity: 0, transform: 'translateY(-30px) scale(1.012)' }, { opacity: 1, offset: 0.45 }, { opacity: 1, transform: 'none' }],
    drop: [{ opacity: 0, transform: 'translateY(-18px) scale(1.03)' }, { opacity: 1, offset: 0.5 }, { opacity: 1, transform: 'none' }],
    word: [{ opacity: 0, transform: 'translateY(-0.55em) rotate(-2deg)' }, { opacity: 1, offset: 0.4 }, { opacity: 1, transform: 'none' }],
    rise: [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
    slide: [{ opacity: 0, transform: 'translateX(-22px)' }, { opacity: 1, transform: 'none' }],
    pop: [{ opacity: 0, transform: 'scale(.35)' }, { opacity: 1, offset: 0.6 }, { opacity: 1, transform: 'none' }],
    fade: [{ opacity: 0 }, { opacity: 1 }],
    beam: [{ opacity: 0.3, transform: 'scaleX(0)' }, { opacity: 1, transform: 'none' }],
    // the shadow of a block that comes down: wide and faint up high, tight and dark when it lands
    land: [{ opacity: 0.1, transform: 'translateY(18px) scale(1.3)' }, { opacity: 1, transform: 'none' }],
  };
  /** One animation of el; `sync` (a time on the document timeline) keeps a redrawn picture in step. */
  function play(el, kf, delay, dur, sync, ease) {
    if (!el || !el.animate) return null;
    const a = el.animate(kf, { duration: dur, delay: Math.max(0, delay), easing: ease || OUT, fill: 'backwards' });
    if (sync != null) a.startTime = sync;
    return a;
  }
  /** A line drawn from its start; a dashed line fades in (a dash would not survive the drawing). */
  function draw(path, delay, dur, sync) {
    if (!path || !path.getTotalLength) return;
    const cs = getComputedStyle(path), dash = cs.strokeDasharray;
    if (dash && dash !== 'none') { play(path, K.fade, delay, dur, sync); return; }
    let L = 0;
    try { L = path.getTotalLength(); } catch (e) { L = 0; }
    if (!L) return;
    const m = cs.markerEnd && cs.markerEnd !== 'none' ? cs.markerEnd : null;
    const a = { strokeDasharray: `${L} ${L}`, strokeDashoffset: L }, b = { strokeDasharray: `${L} ${L}`, strokeDashoffset: 0 };
    const kf = m ? [{ ...a, markerEnd: 'none' }, { ...b, markerEnd: 'none', offset: 0.92 }, { ...b, markerEnd: m }] : [a, b];
    play(path, kf, delay, dur, sync, 'cubic-bezier(.45, 0, .2, 1)');
  }
  const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; };
  const num = (el, a) => parseFloat(el.getAttribute(a)) || 0;
  /** A soft shadow filter in svg, once. */
  function softFilter(svg, id, sd) {
    if (svg.querySelector('#' + id)) return;
    const defs = svg.querySelector('defs') || svg.insertBefore(svgEl('defs'), svg.firstChild);
    const f = svgEl('filter', { id, x: '-30%', y: '-30%', width: '160%', height: '190%' });
    f.append(svgEl('feGaussianBlur', { stdDeviation: sd || 4 }));
    defs.append(f);
  }
  /** A block in svg gets its side under it and its shadow on the ground (both inside its group, so a lift takes the side along). */
  function block(g, face, filter, depth) {
    const x = num(face, 'x'), y = num(face, 'y'), w = num(face, 'width'), h = num(face, 'height'), rx = face.getAttribute('rx') || 0;
    const cast = svgEl('rect', { class: 'mq-cast', x: x + 3, y: y + depth + 4, width: Math.max(0, w - 6), height: h, rx, filter: `url(#${filter})`, 'aria-hidden': 'true' });
    const side = svgEl('rect', { class: 'mq-side', x, y: y + depth, width: w, height: h, rx, 'aria-hidden': 'true' });
    face.before(cast, side);
  }
  function coin(c, dy) {
    const s = c.cloneNode(false);
    s.setAttribute('class', 'mq-cside');
    s.setAttribute('cy', num(c, 'cy') + (dy || 2));
    s.removeAttribute('style');
    c.before(s);
  }

  /* ---------- the pictures of the page: depth each time they are drawn ---------- */
  function dressFlow(svg) {
    if (!svg || svg.dataset.mq) return;
    svg.dataset.mq = '1';
    softFilter(svg, 'mq-soft-flow', 4);
    for (const r of $$('rect.lane-bg, rect.lane-vp, rect.lane-crash', svg)) {
      const g = svgEl('g', { class: 'mq-lane' });
      r.before(g);
      const s = r.cloneNode(false);
      s.setAttribute('class', 'mq-lside');
      s.setAttribute('y', num(r, 'y') + 5);
      g.append(s, r);
      // the lane's name moves along with its plate
      let t = g.nextElementSibling;
      while (t && t.matches('text.lane-label')) { const n = t.nextElementSibling; g.append(t); t = n; }
    }
    for (const g of $$('.fnode', svg)) { const f = $('rect', g); if (f) block(g, f, 'mq-soft-flow', 4); }
    for (const c of $$('.nbadge circle', svg)) coin(c, 2);
    const wl = $('.fwrap .wl rect', svg);
    if (wl) { const s = wl.cloneNode(false); s.setAttribute('class', 'mq-side'); s.setAttribute('y', num(wl, 'y') + 3); wl.before(s); }
  }
  function dressTests(svg) {
    if (!svg || svg.dataset.mq) return;
    svg.dataset.mq = '1';
    softFilter(svg, 'mq-soft-tests', 3.5);
    for (const g of $$('.tnode', svg)) { const f = $('rect', g); if (f) block(g, f, 'mq-soft-tests', 4); }
    for (const c of $$('.tnode .tbc', svg)) coin(c, 2);
  }

  /* ---------- the assembly of the page's pictures ---------- */
  function flowParts(svg, base, sync) {
    $$('.mq-lane', svg).forEach((g, i) => play(g, K.slide, base + i * 45, 460, sync));
    const band = $('.band', svg);
    if (band) play(band, K.rise, base + 70, 420, sync);
    const nodes = $$('.fnode', svg).map((g) => ({ g, r: g.getBBox() })).sort((a, b) => a.r.x - b.r.x || a.r.y - b.r.y);
    const t0 = base + 110;
    nodes.forEach(({ g }, k) => {
      play(g, K.drop, t0 + k * 28, 460, sync);
      play($('.mq-cast', g), K.land, t0 + k * 28, 460, sync);
    });
    $$('.nbadge', svg).forEach((b, k) => play(b, K.pop, t0 + 200 + k * 18, 340, sync));
    const edges = $$('.fedge', svg).map((g) => ({ g, p: $('path', g) })).filter((x) => x.p)
      .map((x) => ({ ...x, at: x.p.getPointAtLength(0) })).sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y);
    const e0 = t0 + 170;
    edges.forEach(({ g, p }, k) => {
      draw(p, e0 + k * 18, 320, sync);
      for (const t of $$('text, .bolt', g)) play(t, K.fade, e0 + k * 18 + 240, 220, sync);
    });
    const wrap = $('.fwrap', svg);
    if (wrap) { play($('.frame', wrap), K.fade, base, 520, sync); play($('.wl', wrap), K.pop, base + 100, 380, sync); }
  }
  function flowAssemble(flow, base, sync) {
    if (!flow) return;
    if (flow.classList.contains('tl')) {
      $$('.ftl-list > li', flow).forEach((li, k) => play(li, li.classList.contains('ftl-step') ? K.drop : K.slide, base + k * 45, 480, sync));
      const fr = $('.ftl-frame', flow);
      if (fr) play(fr, K.fade, base, 400, sync);
      return;
    }
    const svg = $('svg', flow);
    if (svg) flowParts(svg, base, sync);
  }
  /** The slices: a tower per story, built floor on floor from the tables up, a build step after the one before. */
  function towers(grid, base) {
    const plates = $$('.sl-stbg', grid).map((p) => ({ p, r: p.getBoundingClientRect() }));
    plates.forEach(({ p }, i) => play(p, K.rise, base + i * 130, 520));
    $$('.sl-stage', grid).forEach((s, i) => play(s, K.fade, base + 100 + i * 130, 400));
    const corner = $('.sl-corner', grid);
    if (corner) play(corner, K.fade, base, 500);
    const stageOf = (r) => { const cx = r.left + r.width / 2; const i = plates.findIndex((x) => cx >= x.r.left && cx <= x.r.right); return Math.max(0, i); };
    let end = base;
    for (const head of $$('.sl-head', grid)) {
      const id = head.dataset.col, st = stageOf(head.getBoundingClientRect()), t = base + 160 + st * 300;
      play(head, K.drop, t, 520);
      const cards = $$(`.sl-cell[data-col="${CSS.escape(id)}"] .sl-card`, grid).map((c) => ({ c, y: c.getBoundingClientRect().top })).sort((a, b) => b.y - a.y);
      cards.forEach(({ c }, k) => play(c, K.drop, t + 120 + k * 60, 520));
      const foot = $(`.sl-foot[data-col="${CSS.escape(id)}"]`, grid);
      const done = t + 120 + cards.length * 60;
      if (foot) play(foot, K.rise, done + 80, 460);
      end = Math.max(end, done);
    }
    $$('.sl-seam', grid).forEach((s, k) => play(s, K.beam, end - 120 + k * 90, 520));
    const link = $('.sl-tolink', grid);
    if (link) play(link, K.fade, end + 200, 400);
    for (const y of $$('.sl-y, .sl-group', grid)) play(y, K.fade, base + 60, 500);
  }
  function stories(list, base) {
    $$('.sl-mstage', list).forEach((st, i) => {
      play(st, K.rise, base + i * 120, 520);
      $$('.sl-mhead, .sl-mcard, .sl-mused, .sl-foot', st).forEach((c, k) => play(c, K.drop, base + 120 + i * 120 + k * 45, 480));
    });
  }
  function testGraph(box, base) {
    const svg = $('svg', box);
    if (!svg) return;
    const nodes = $$('.tnode', svg).map((g) => ({ g, r: g.getBBox() })).sort((a, b) => a.r.x - b.r.x || a.r.y - b.r.y);
    nodes.forEach(({ g }, k) => { play(g, K.drop, base + k * 90, 520); play($('.mq-cast', g), K.land, base + k * 90, 520); });
    const e0 = base + nodes.length * 90 + 60;
    $$('.tedge', svg).forEach((g, k) => {
      draw($('.ln', g), e0 + k * 120, 520);
      play($('.ah', g), K.fade, e0 + k * 120 + 440, 200);
      for (const x of $$('.tlb, .tlt', g)) play(x, K.pop, e0 + k * 120 + 300, 380);
    });
    const ax = $('.taxis', svg);
    if (ax) play(ax, K.fade, base, 600);
  }
  const cards = (list, base, step) => $$(':scope > *', list).forEach((c, k) => play(c, K.drop, base + k * (step || 90), 560));

  /* ---------- the knob of a switch ---------- */
  function knob(sw) {
    if (!sw || sw.querySelector(':scope > .mq-knob')) return;
    const k = document.createElement('span');
    k.className = 'mq-knob';
    k.setAttribute('aria-hidden', 'true');
    sw.prepend(k);
    sw.classList.add('mq-has-knob');
    let first = true;
    const place = () => {
      const b = $$('button', sw).find((x) => x.getAttribute('aria-pressed') === 'true' || x.getAttribute('aria-selected') === 'true');
      const W = sw.clientWidth, H = sw.clientHeight;
      if (!W) return;
      const cs = getComputedStyle(sw), pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0;
      k.style.left = pl + 'px'; k.style.top = pt + 'px';
      k.style.width = (W - 2 * pl) + 'px'; k.style.height = (H - 2 * pt) + 'px';
      if (!b) { k.style.opacity = '0'; return; }
      k.style.opacity = '';
      const l = b.offsetLeft - pl, r = W - pl - (b.offsetLeft + b.offsetWidth), t = b.offsetTop - pt, bt = H - pt - (b.offsetTop + b.offsetHeight);
      if (first) { k.style.transition = 'none'; first = false; requestAnimationFrame(() => { k.style.transition = ''; }); }
      k.style.clipPath = `inset(${Math.max(0, t)}px ${Math.max(0, r)}px ${Math.max(0, bt)}px ${Math.max(0, l)}px round 999px)`;
    };
    new MutationObserver(place).observe(sw, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-selected', 'class'] });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(place).observe(sw);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    place();
  }

  /* ---------- the title: a piece per word ---------- */
  function pieces(h1) {
    if (!h1 || h1.dataset.mq) return [];
    h1.dataset.mq = '1';
    const words = h1.textContent.split(/\s+/).filter(Boolean);
    h1.textContent = '';
    return words.map((w, i) => {
      if (i) h1.append(' ');
      const s = document.createElement('span');
      s.className = 'mq-w';
      s.textContent = w;
      h1.append(s);
      return s;
    });
  }

  /* ---------- what assembles when a scroll of a person brings it in ---------- */
  const later = [], seen = [];
  let ticking = false, lastInput = -1e9;
  // a scroll right after a wheel, a touch, a key or a press is a person's; a script's scroll moves nothing
  const human = () => performance.now() - lastInput < 1500;
  function check() {
    ticking = false;
    const people = human() && !calm();
    for (let i = later.length - 1; i >= 0; i -= 1) {
      const { el, fn } = later[i];
      if (!el.isConnected) { later.splice(i, 1); continue; }
      if (!shown(el)) continue; // the other view: it waits
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight + 140 && r.bottom > -60) {
        later.splice(i, 1);
        // still under the edge of the screen: it can assemble unseen; already in sight, it stays as it is
        if (people && r.top > innerHeight - 8) fn();
      }
    }
    let k = 0;
    for (let i = 0; i < seen.length; i += 1) {
      const s = seen[i];
      if (!s.el.isConnected) { seen.splice(i--, 1); continue; }
      if (!shown(s.el)) continue;
      const r = s.el.getBoundingClientRect();
      if (r.top >= innerHeight * 0.9) { s.armed = true; continue; }
      if (r.bottom <= 0) continue;
      seen.splice(i--, 1);
      // it came up into sight: it plays where the person looks
      if (s.armed && people) s.fn(k++);
    }
  }
  /** fn() runs once a person's scroll brings el near, while it is still just under the edge of the screen. */
  function whenNear(el, fn) { if (el) later.push({ el, fn }); }
  /** fn(k) runs once a person's scroll brings el up into sight; k counts what came in with it, for a stagger. */
  function whenSeen(el, fn) { if (el) seen.push({ el, fn, armed: shown(el) && el.getBoundingClientRect().top >= innerHeight * 0.9 }); }
  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(check); } }
  function input(ev) { if (ev.isTrusted) lastInput = performance.now(); }

  /* ---------- the load ---------- */
  let T0 = null; // the start of the load assembly on the document timeline, for a picture redrawn during it
  let introEnd = 0;
  const moving = () => T0 != null && document.timeline && document.timeline.currentTime - T0 < introEnd;
  function mastIn(words) {
    const logo = $('.mast .logo'), right = $('.mast-r');
    play(logo, K.slide, 0, 480, T0);
    play(right, K.fade, 100, 500, T0);
    words.forEach((w, i) => play(w, K.word, 60 + i * 36, 520, T0));
    const sum = $('#summary'), more = $('.more');
    [sum, more].filter(Boolean).forEach((el, i) => play(el, K.rise, 200 + i * 60, 500, T0));
    const mv = $('.mast-views');
    if (mv) play(mv, K.rise, 300, 500, T0);
    $$('.mast-chips .td-chip').forEach((c, k) => play(c, K.drop, 360 + k * 40, 420, T0));
  }
  function sectionIn(sec, base, sync) {
    play(sec, K.slab, base, 620, sync);
    const head = $('.sec-head', sec);
    if (head) play(head, K.rise, base + 140, 460, sync);
    $$('.schip', sec).forEach((c, k) => play(c, K.drop, base + 200 + k * 40, 420, sync));
  }
  /** What stands in a section, assembled from `base` on. */
  function insideOf(sec, base) {
    if (sec.id === 'sec-slices') {
      const grid = $('#matrix', sec), list = $('#sl-list', sec);
      if (shown(grid)) towers(grid, base + 140); else if (shown(list)) stories(list, base + 140);
    }
    if (sec.id === 'sec-tests') {
      const g = $('.tgraph', sec), c = $('#tcards', sec);
      if (shown(g)) testGraph(g, base + 140);
      if (c) cards(c, base + 200, 110);
    }
    if (sec.id === 'scope-row') $$('li', sec).forEach((li, k) => play(li, K.pop, base + 80 + k * 24, 420));
  }

  function start() {
    if (!on()) return;
    $$('.views').forEach(knob);
    const words = pieces($('#title'));
    for (const id of ['flow', 'tests']) {
      const box = document.getElementById(id);
      if (!box) continue;
      const dress = id === 'flow' ? dressFlow : dressTests;
      dress($('svg', box));
      // the page draws these again (the web font in, a narrower box): the new picture gets its depth, and
      // during the load assembly it joins in at the point the old one was
      new MutationObserver(() => {
        const svg = $('svg', box);
        if (!svg || svg.dataset.mq) return;
        dress(svg);
        if (id === 'flow' && moving() && !box.classList.contains('tl')) flowParts(svg, flowBase, T0);
      }).observe(box, { childList: true });
    }
    const motion = !calm() && !!document.timeline;
    // a page that took long to get ready does not keep its reader waiting any longer: no load assembly
    const go = motion && document.visibilityState === 'visible' && performance.now() < 1400;
    const secs = $$('main > section').filter(shown);
    let flowBase = 0;
    if (go) { T0 = document.timeline.currentTime; mastIn(words); }
    if (motion) {
      let k = 0;
      for (const sec of secs) {
        const r = sec.getBoundingClientRect();
        if (r.top >= innerHeight) { whenNear(sec, () => sectionIn(sec, 0)); continue; }
        if (!go) continue;
        if (sec.id === 'sec-design') { k++; continue; } // the drawing assembles itself (maquette-draw.js)
        const base = 100 + k * 120;
        sectionIn(sec, base, T0);
        if (sec.matches('.flowpanel')) { flowBase = base + 80; flowAssemble($('#flow', sec), flowBase, T0); } else insideOf(sec, base);
        k++;
      }
      introEnd = 1300;
    }
    // what lies further down assembles when a scroll brings it in (its own parts as they come near)
    for (const [sel, fn] of [['#matrix', (el) => towers(el, 60)], ['#sl-list', (el) => stories(el, 60)], ['.tgraph', (el) => testGraph(el, 80)],
      ['#tcards', (el) => cards(el, 100, 110)], ['#scope', (el) => $$('li', el).forEach((li, k) => play(li, K.pop, k * 24, 420))]]) {
      const el = $(sel);
      if (!motion || !el || (shown(el) && el.getBoundingClientRect().top < innerHeight)) continue;
      whenNear(el, () => fn(el));
    }
    addEventListener('scroll', onScroll, { passive: true });
    for (const t of ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown']) addEventListener(t, input, { passive: true, capture: true });
    // the switch between the views: on a click by a person the view that comes in assembles quickly
    document.addEventListener('click', (ev) => {
      const b = ev.target.closest && ev.target.closest('.views button');
      if (!b || !ev.isTrusted || calm()) return;
      if (b.dataset.view === 'functional') {
        let k = 0;
        for (const sec of $$('main > section').filter(shown)) {
          const r = sec.getBoundingClientRect();
          if (r.top < innerHeight && r.bottom > 0) { play(sec, K.slab, k * 90, 560); k++; }
        }
      } else if (b.dataset.view === 'review') play($('#sec-review'), K.slab, 0, 560);
      else if (root.Mq.drawn && root.Mq.drawn()) play($('#sec-design'), K.slab, 0, 560);
    });
  }

  root.Mq = { play, draw, K, OUT, calm, knob, block, coin, softFilter, svgEl, whenNear, whenSeen, shown, drawn: null };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
