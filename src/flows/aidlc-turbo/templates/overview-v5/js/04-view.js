/* The drawing in its window: paints a laid-out view, sizes it to the zoom, swaps one drawing for the next (into the
   element you open, out onto the one you came from), opens it on its subject and scrolls chosen cards into view. The
   page (10-app.js) keeps what is shown and chosen. */
(function () {
  'use strict';
  const C4 = window.C4;
  const { el, svgEl, KIND } = C4.kit;
  const S = C4.shapes;
  const L = C4.layout;

  /** ctx: { state, captionOf(v), reduce(), side, zoomv } */
  function create(canvas, ctx) {
    const { state, captionOf, reduce } = ctx;
    function paint(l) {
      const { v, res, specs, gedges } = l;
      const W = Math.ceil(res.width), H = Math.ceil(res.height);
      const svg = svgEl('svg', { class: 'drawing', viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': `${v.title}. ${captionOf(v)}` });
      S.markers(svg);
      const pos = new Map();
      const place = (list, ox, oy) => { for (const c of list || []) { pos.set(c.id, { x: ox + c.x, y: oy + c.y, w: c.width, h: c.height }); if (c.children) place(c.children, ox + c.x, oy + c.y); } };
      place(res.children, 0, 0);
      // the lines and their words are read out with the cards and in the inspector, never as loose text
      const back = svgEl('g', {}), lines = svgEl('g', { 'aria-hidden': 'true' }), nodes = svgEl('g', {}), labels = svgEl('g', { 'aria-hidden': 'true' });
      const top = svgEl('g', { 'aria-hidden': 'true' });
      if (v.boundary && pos.get('__b')) {
        const type = v.boundary.type || (v.level === 2 ? `[${KIND.system}]` : `[${KIND.container}${v.boundary.tech ? ': ' + v.boundary.tech : ''}]`);
        S.boundary(back, pos.get('__b'), v.boundary.name, type, top);
      }
      (res.edges || []).forEach((e, i) => {
        const sec = (e.sections || [])[0];
        if (!sec) return;
        const off = e.container && e.container !== 'root' && pos.get(e.container) ? pos.get(e.container) : { x: 0, y: 0 };
        const pts = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint].map((q) => ({ x: q.x + off.x, y: q.y + off.y }));
        const l0 = (e.labels || [])[0];
        const lab = l0 && gedges[i]._lab ? { x: l0.x + off.x, y: l0.y + off.y, width: l0.width, height: l0.height, ...gedges[i]._lab } : null;
        S.edge(lines, labels, gedges[i]._meta, pts, lab, gedges[i]._up);
      });
      for (const n of readingOrder(v.nodes, pos)) { const p = pos.get(n.id); S.draw(nodes, n, specs.get(n.id), p.x, p.y, state.story); }
      svg.append(back, lines, nodes, labels, top);
      return { v, svg, W, H, pos, dir: l.dir };
    }
    /** The cards in the order the eye reads them, so Tab does too: row by row from the top, each row from the left. */
    function readingOrder(list, pos) {
      const rows = [];
      for (const n of list.filter((x) => pos.get(x.id)).sort((a, b) => pos.get(a.id).y - pos.get(b.id).y)) {
        const y = pos.get(n.id).y, r = rows[rows.length - 1];
        if (r && y - r.y < 24) r.ns.push(n); else rows.push({ y, ns: [n] });
      }
      return rows.flatMap((r) => r.ns.sort((a, b) => pos.get(a.id).x - pos.get(b.id).x));
    }

    /** The room the drawing has in the window, inside the canvas's own margin. */
    const room = () => ({ w: canvas.clientWidth - 48, h: canvas.clientHeight - 96 });
    /** The part of the canvas a card can be seen in: all of it but the corner strip under the zoom tools. */
    const seen = () => { const c = canvas.getBoundingClientRect(), low = 64; return { left: c.left, right: c.right, top: c.top, bottom: c.bottom - low, width: c.width, height: c.height - low }; };
    /** The scale that shows the whole drawing. */
    const fitOf = (d) => { const r = room(); return Math.min(1, Math.max(Math.min(r.w / d.W, r.h / d.H), 0.1)); };
    /** A view opens whole, unless its text would get too small to read: then it scrolls, or drags. "Fit" always
     *  shows it whole, and stays so from view to view until you zoom yourself. */
    function scaleOf(d) {
      if (state.scale === 'fit') return fitOf(d);
      if (state.scale) return state.scale;
      return L.opening(fitOf(d));
    }
    function size(d) {
      const s = scaleOf(d);
      d.svg.setAttribute('width', Math.round(d.W * s));
      d.svg.setAttribute('height', Math.round(d.H * s));
      ctx.zoomv.value = `${Math.round(s * 100)}%`;
      ctx.zoomv.textContent = `${Math.round(s * 100)}%`;
      canvas.classList.toggle('can-pan', canvas.scrollWidth > canvas.clientWidth + 2 || canvas.scrollHeight > canvas.clientHeight + 2);
      return s;
    }

    /** Swap the drawing: into the element you opened, out onto the one you came from, or sideways. */
    function swap(d, dir, origin) {
      const pane = el('div', 'pane');
      pane.append(d.svg);
      const old = canvas.querySelector(':scope > .pane');
      const at = (p, id) => {
        const n = id && p.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
        if (!n) return '50% 30%';
        const r = n.getBoundingClientRect(), pr = p.getBoundingClientRect();
        return `${r.left - pr.left + r.width / 2}px ${r.top - pr.top + r.height / 2}px`;
      };
      if (!old) { canvas.replaceChildren(pane); size(d); home(d); return; }
      const fromAt = dir === 'in' ? at(old, origin) : '50% 30%';
      const ghost = el('div', 'ghost');
      const top = canvas.scrollTop, left = canvas.scrollLeft;
      canvas.replaceChildren(pane, ghost);
      ghost.append(old);
      old.style.translate = `${-left}px ${-top}px`;
      size(d);
      home(d);
      if (reduce()) { ghost.remove(); return; }
      const ease = 'cubic-bezier(.22,1,.36,1)';
      old.style.transformOrigin = fromAt;
      const outFrames = dir === 'in' ? [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }]
        : dir === 'out' ? [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.82)', opacity: 0 }]
        : [{ opacity: 1 }, { opacity: 0 }];
      const a = old.animate(outFrames, { duration: dir === 'side' ? 160 : 260, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
      a.onfinish = () => ghost.remove();
      pane.style.transformOrigin = dir === 'out' ? at(pane, origin) : dir === 'in' ? '50% 0%' : '50% 30%';
      const inFrames = dir === 'in' ? [{ transform: 'scale(.9)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }]
        : dir === 'out' ? [{ transform: 'scale(1.18)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }]
        : [{ transform: 'translateX(18px)', opacity: 0 }, { transform: 'none', opacity: 1 }];
      // the new drawing takes no clicks while it is still fading in: a quick second double-click would hit a card unseen
      const an = pane.animate(inFrames, { duration: 380, delay: dir === 'side' ? 60 : 120, easing: ease, fill: 'backwards' });
      pane.style.pointerEvents = 'none';
      an.onfinish = an.oncancel = () => { pane.style.pointerEvents = ''; };
    }

    /** What a view is about: the element it zooms into (its dashed border), else what this intent built or changed. */
    function subjectOf(d) {
      const v = d.v;
      if (v.boundary && d.pos.get('__b')) return d.pos.get('__b');
      const ids = v.scope || v.nodes.filter((n) => !n.ext && n.kind !== 'person' && (n.status === 'new' || n.status === 'changed')).map((n) => n.id);
      const ps = ids.map((id) => d.pos.get(id)).filter(Boolean);
      if (!ps.length) return { x: 0, y: 0, w: d.W, h: d.H };
      const x = Math.min(...ps.map((p) => p.x)), y = Math.min(...ps.map((p) => p.y));
      return { x, y, w: Math.max(...ps.map((p) => p.x + p.w)) - x, h: Math.max(...ps.map((p) => p.y + p.h)) - y };
    }
    /** A drawing larger than its window opens on its subject: in the middle when it fits, else from its top left. */
    function home(d) {
      const b = subjectOf(d), r = d.svg.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      const s = r.width / d.W;
      const ox = r.left - c.left + canvas.scrollLeft, oy = r.top - c.top + canvas.scrollTop;
      const along = (o, lo, size, room) => (size > room - 48 ? o + lo - 24 : o + lo + size / 2 - room / 2);
      // never open on a card cut in two by the top or left edge: show it whole while the subject still fits, else skip it
      const cards = [...d.pos.entries()].filter(([id]) => id !== '__b').map(([, p]) => p);
      const unclip = (t, o, at, size, end, room) => {
        const p = cards.find((q) => o + q[at] * s < t && t < o + (q[at] + q[size]) * s);
        if (!p) return t;
        const lo = o + p[at] * s - 16;
        return end <= lo + room ? lo : o + (p[at] + p[size]) * s + 16;
      };
      const y = unclip(along(oy, b.y * s, b.h * s, canvas.clientHeight - 64), oy, 'y', 'h', oy + (b.y + b.h) * s, canvas.clientHeight - 64);
      const x = unclip(along(ox, b.x * s, b.w * s, canvas.clientWidth), ox, 'x', 'w', ox + (b.x + b.w) * s, canvas.clientWidth);
      canvas.scrollTo(Math.max(0, x), Math.max(0, y));
    }
    /** Scroll the drawing so these cards are in view, in the middle when they fit; on a small screen the drawing too. */
    function reveal(ids) {
      const cards = ids.map((id) => canvas.querySelector(`.pane .node[data-id="${CSS.escape(id)}"]`)).filter(Boolean);
      if (!cards.length) return;
      const c = canvas.getBoundingClientRect(), v = seen();
      const box = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
      for (const n of cards) {
        const r = n.getBoundingClientRect();
        box.l = Math.min(box.l, r.left); box.t = Math.min(box.t, r.top); box.r = Math.max(box.r, r.right); box.b = Math.max(box.b, r.bottom);
      }
      const behavior = reduce() ? 'auto' : 'smooth';
      if (box.l < v.left || box.r > v.right || box.t < v.top || box.b > v.bottom) {
        const along = (lo, hi, from, size, now) => (hi - lo > size - 48 ? lo - from + now - 24 : (lo + hi) / 2 - from + now - size / 2);
        canvas.scrollTo({ left: along(box.l, box.r, v.left, v.width, canvas.scrollLeft), top: along(box.t, box.b, v.top, v.height, canvas.scrollTop), behavior });
      }
      // on a small screen the page scrolls too: bring the drawing's window into view, unless you are reading the inspector
      if ((c.top < 0 || c.bottom > innerHeight) && !ctx.side.contains(document.activeElement)) {
        canvas.scrollIntoView({ block: c.height <= innerHeight ? 'center' : 'start', behavior });
      }
    }

    return { paint, size, swap, home, reveal, room, seen, fitOf, scaleOf };
  }

  C4.view = { create };
})();

