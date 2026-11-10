/**
 * AI-DLC Turbo - Code Scaffold, the small rules the panel, the steps and the
 * full-screen view share.
 *
 *   TdKit.fit({ view, full, room, vb, steps, folded }) -> { pv, side, fold }
 *     where the legend panel of a drawing with steps goes on the page: on a
 *     desktop page (`view`, the window, 1280 wide or more) beside the
 *     drawing, open or folded as the viewer chose (`folded`; `fold` null when
 *     never chosen); narrower under it, with a preview where the whole width
 *     shows the drawing too small to read.
 *   TdKit.narrow(w)  never chosen, the legend folds to its rail where the
 *     drawing beside it open gets `w` wide, less than NARROW.
 *   TdKit.drawOpen(full, pane) -> the width the drawing gets on a stage
 *     `full` wide beside the open legend and a details panel `pane` wide
 *     (null: none beside it), as design-steps.css and design-pane.css lay
 *     them out (the legend 340, its rail 52, 16 between them).
 *   TdKit.covers(view, rects) -> { l, r, b }
 *     how far sheets and drawers reach into the full-screen view, from the
 *     left, the right and the bottom (a column beside the view hides nothing).
 *   TdKit.breaks(text) -> [segment]
 *     where a code name or a path may wrap: between the words of a class
 *     name, after a slash, a dot, an underscore or a bracket.
 *   TdKit.soft(el, text)  puts the text in `el` with those breaks (<wbr>),
 *     keeping a hyphenated piece whole ("shop-billing").
 *   TdKit.btn(cls, icon, label, title), TdKit.ICON  the buttons with an icon.
 *   TdKit.lead(el, text)  the first sentence in `el`, the rest behind "More"
 *     (a button that shows it, and hides it again with "Less"), in the page's
 *     language (TdText).
 *   TdKit.h(tag, cls, text)  an element; TdKit.dl()  a list of details with
 *     row(label, value, cls): a value is text, a node or a list of them, and
 *     a 'td-code' value wraps between the parts of its path.
 */
(function (root) {
  'use strict';

  const TX = typeof module !== 'undefined' && module.exports ? require('./design-text.js') : root.TdText;

  const DESK = 1280; // from this window width the legend panel sits beside the drawing
  const PREVIEW = 0.65; // below this on the whole width a narrower page shows a preview
  const NARROW = 720; // a drawing less wide than this beside the open legend: the legend starts folded (it reads at 80 percent)
  const LEGEND = 340, RAIL = 52, GAP = 16; // the open legend, a folded panel's rail, the room between them (design-steps.css)
  const narrow = (w) => w < NARROW;
  const drawOpen = (full, pane) => full - LEGEND - GAP - (pane === null || pane === undefined ? 0 : pane + GAP);

  /** The drawing's size for a width: the width, or the screen height while that keeps it at 0.75 or more. */
  function scaleFor(w, room, vb) {
    const wFit = Math.min(1, w / vb.w), hFit = room / vb.h;
    return hFit >= wFit ? wFit : hFit >= 0.75 ? hFit : wFit;
  }
  function fit(o) {
    const side = !!o.steps && o.view >= DESK;
    const pv = !side && scaleFor(o.full, o.room, o.vb) < PREVIEW;
    return { pv, side, fold: side && (o.folded === true || o.folded === false) ? o.folded : null };
  }

  function covers(view, rects) {
    const out = { l: 0, r: 0, b: 0 };
    for (const r of rects) {
      if (!r || !r.width || !r.height) continue;
      if (r.right <= view.left || r.left >= view.right || r.bottom <= view.top || r.top >= view.bottom) continue;
      if (r.width >= view.width * 0.9) out.b = Math.max(out.b, Math.round(view.bottom - r.top));
      else if (r.left - view.left < view.right - r.right) out.l = Math.max(out.l, Math.round(r.right - view.left));
      else out.r = Math.max(out.r, Math.round(view.right - r.left));
    }
    return out;
  }

  // after / _ . ( or a comma right before a letter or digit; before a capital that starts a word
  const BREAK = /(?<=[/_.(]|,(?=\S))(?=\w)|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/;
  const EXT = /^[a-z0-9]{1,4}(?![\w])/; // a file extension: stays with the name before it
  const PATH = /(?<=\/)(?=\w)/; // a path: only after a slash, so a file name moves to the next line whole
  const UNDER = /(?<=_)(?=\w)/; // inside a long file name: only after an underscore
  function breaks(text, re) {
    const out = [];
    for (const seg of text ? String(text).split(re || BREAK) : []) {
      if (out.length && out[out.length - 1].endsWith('.') && EXT.test(seg)) out[out.length - 1] += seg;
      else if (seg) out.push(seg);
    }
    return out;
  }

  function soft(el, text, re) {
    const doc = el.ownerDocument || document;
    breaks(text, re).forEach((seg, i) => {
      if (i) el.append(doc.createElement('wbr'));
      // a file name with underscores in a path moves to the next line whole, and breaks after an
      // underscore only when it is longer than the line
      if (re === PATH && seg.includes('_')) {
        el.append(soft(h('span', 'td-ib'), seg, UNDER));
        return;
      }
      // a word like shop-billing stays whole; the rest wraps at its spaces as usual
      for (const w of seg.split(/( +)/)) {
        if (!w) continue;
        if (/\p{L}-\p{L}/u.test(w)) {
          const s = doc.createElement('span');
          s.className = 'td-nw';
          s.textContent = w;
          el.append(s);
        } else el.append(doc.createTextNode(w));
      }
    });
    return el;
  }

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function dl() {
    const el = h('dl', 'td-dl');
    el.row = (k, v, cls) => {
      if (!v || (Array.isArray(v) && !v.length)) return;
      const dd = h('dd', cls || null), code = cls === 'td-code';
      if (!Array.isArray(v)) { if (typeof v !== 'string') dd.append(v); else if (code) soft(dd, v, PATH); else dd.textContent = v; }
      else for (const x of v) dd.append(typeof x !== 'string' ? x : code ? soft(h('div', 'td-c'), x, PATH) : h('div', null, x));
      el.append(h('dt', null, k), dd);
    };
    return el;
  }

  function lead(el, text) {
    const [, first, rest] = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(text) || [null, text, ''];
    el.textContent = first;
    if (!rest) return el;
    const r = h('span', 'td-sb-rest', ' ' + rest), more = h('button', 'td-sb-more', TX.t('design.more'));
    r.hidden = true;
    more.type = 'button';
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => {
      r.hidden = !r.hidden;
      more.textContent = r.hidden ? TX.t('design.more') : TX.t('design.less');
      more.setAttribute('aria-expanded', String(!r.hidden));
    });
    el.append(r, ' ', more);
    return el;
  }

  const ICON = { full: '<path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5"/>', close: '<path d="M5 5l10 10M15 5L5 15"/>',
    shrink: '<path d="M7.5 3v4.5H3M12.5 3v4.5H17M17 12.5h-4.5V17M3 12.5h4.5V17"/>',
    plus: '<path d="M10 4.5v11M4.5 10h11"/>', minus: '<path d="M4.5 10h11"/>',
    fit: '<path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/><rect x="7" y="7.5" width="6" height="5" rx="1"/>',
    side: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M8 3.5v13"/>', chev: '<path d="M6 8l4 4 4-4"/>',
    prev: '<path d="M12 5l-5 5 5 5"/>', next: '<path d="M8 5l5 5-5 5"/>',
    list: '<path d="M8 5.5h9M8 10h9M8 14.5h9M3.5 5.5h.5M3.5 10h.5M3.5 14.5h.5"/>' };
  function btn(cls, icon, label, title) {
    const b = h('button', 'td-btn ' + cls);
    b.type = 'button';
    b.innerHTML = `<svg class="td-i" viewBox="0 0 20 20" aria-hidden="true">${ICON[icon]}</svg>`;
    if (label) b.append(h('span', null, label));
    if (title) { b.title = title; if (!label) b.setAttribute('aria-label', title); }
    return b;
  }

  const api = { fit, narrow, drawOpen, NARROW, LEGEND, RAIL, scaleFor, covers, breaks, soft, lead, h, dl, btn, ICON, PREVIEW, PATH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TdKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
