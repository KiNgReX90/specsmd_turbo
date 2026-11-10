/* The small tools every part of the C4 model shares: making elements, the page's fixed texts, measuring and wrapping
   text the way the canvas draws it, dates, one icon set drawn on a 24 grid with round strokes, and whether the intent
   is built (the page made at the construction, or every story merged): the words of the page follow it, built in the
   past ("Already existed"), before the build what will come ("Will change").

   The page runs inside the overview, in a frame: the overview sets window.C4_EMBED ({ details, help }) before this
   code runs, and later sends { type: 'turbo-switches', details, help } from the window around this one. The two
   switches follow it (07-switches.js); nothing is kept in the browser's storage, so the page works wherever the
   overview opens (a file, a sandboxed artifact, an attachment). Every fixed text comes from the string table the
   page carries in its JSON text block, id v5-text (lib/v5-page.cjs). */
(function () {
  'use strict';
  const C4 = (window.C4 = window.C4 || {});
  const NS = 'http://www.w3.org/2000/svg';

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    return e;
  };

  // ---------- the fixed texts ----------
  const TEXT = (() => {
    try {
      const block = document.getElementById('v5-text');
      const t = block ? JSON.parse(block.textContent) : null;
      return t && typeof t === 'object' ? t : {};
    } catch (e) { return {}; }
  })();
  /** The value under a dotted key, whatever it is; undefined when the table has none. */
  function raw(key) {
    let v = TEXT;
    for (const k of String(key).split('.')) v = v && typeof v === 'object' ? v[k] : undefined;
    return v;
  }
  /** One text by its dotted key, {name} filled from vars; the key itself when the table has no such text. */
  function T(key, vars) {
    const v = raw(key);
    if (typeof v !== 'string') return key;
    return vars ? v.replace(/\{(\w+)\}/g, (m, n) => (vars[n] === undefined ? m : String(vars[n]))) : v;
  }
  /** The word for n of a thing: `key` holds { one, many }. */
  const noun = (key, n) => T(`${key}.${n === 1 ? 'one' : 'many'}`);
  /** A count with its word: 1 file, 3 files. */
  const count = (key, n) => `${n} ${noun(key, n)}`;

  // ---------- icons ----------
  const ICONS = {
    screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M3 8h18M9 21h6M12 17v4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    table: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M3.5 14.8h17M10 9.5V20"/>',
    script: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    plug: '<path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0zM12 17v4"/>',
    system: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/>',
    app: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/><path d="M6.5 6.5h.01M9 6.5h.01"/>',
    db: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M18 8.6a9 9 0 0 1-9 9"/>',
    merge: '<circle cx="18" cy="18" r="2.6"/><circle cx="6" cy="6" r="2.6"/><path d="M6 21V8.6a9 9 0 0 0 9 9"/>',
    mr: '<circle cx="18" cy="18" r="2.6"/><circle cx="6" cy="6" r="2.6"/><path d="M13 6h3a2 2 0 0 1 2 2v7.4M6 8.6V21"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
    tick: '<path class="tick" d="m5 12.5 4.5 4.5L19 7.5"/>',
    zoom: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M11 8.2v5.6M8.2 11h5.6"/>',
    out: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    in: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  };
  /** An icon for the page's HTML. */
  function icon(name, cls) {
    const s = svgEl('svg', { viewBox: '0 0 24 24', class: cls || 'ic', 'aria-hidden': 'true', focusable: 'false' });
    s.innerHTML = ICONS[name] || ICONS.code;
    return s;
  }
  /** An icon inside the drawing, `size` pixels square at x, y. */
  function glyph(name, x, y, size, color) {
    const g = svgEl('g', { transform: `translate(${x},${y}) scale(${size / 24})`, fill: 'none', stroke: color,
      'stroke-width': (1.6 * 24) / size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    g.innerHTML = ICONS[name] || ICONS.code;
    return g;
  }

  // ---------- text, measured as the canvas will draw it ----------
  const ctx = document.createElement('canvas').getContext('2d');
  const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';
  const FONT = {
    name: '700 14px "DM Sans", system-ui, sans-serif', big: '750 15px "DM Sans", system-ui, sans-serif',
    code: `650 13px ${MONO}`, type: '500 12.5px "DM Sans", system-ui, sans-serif', desc: '400 13px "DM Sans", system-ui, sans-serif',
    foot: '650 12px "DM Sans", system-ui, sans-serif', label: '600 12.5px "DM Sans", system-ui, sans-serif',
    tech: '500 12px "DM Sans", system-ui, sans-serif', bound: '700 13px "DM Sans", system-ui, sans-serif',
    btype: '500 12px "DM Sans", system-ui, sans-serif', badge: '700 12px "DM Sans", system-ui, sans-serif',
  };
  const width = (t, font) => { ctx.font = font; return ctx.measureText(t).width; };
  /** A word too wide for one line breaks at its humps (GiftCard|Ledger), else anywhere, but never leaves a stub of
   *  fewer than four letters on a line of its own. */
  function split(word, font, max) {
    if (width(word, font) <= max) return [word];
    const pieces = word.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[_./-])/).flatMap((h) => (width(h, font) > max ? [...h] : [h]));
    const out = [];
    let cur = '';
    for (const h of pieces) {
      if (cur && width(cur + h, font) > max) { out.push(cur); cur = h; } else cur += h;
    }
    if (cur) out.push(cur);
    for (let i = out.length - 1; i > 0 && out[i].length < 4; i--) {
      const take = Math.min(4 - out[i].length, out[i - 1].length - 4);
      if (take <= 0) break;
      out[i] = out[i - 1].slice(-take) + out[i];
      out[i - 1] = out[i - 1].slice(0, -take);
    }
    return out;
  }
  /** Lines of at most `max` pixels, at most `lines` of them, the last cut after a whole word with an ellipsis. */
  function wrap(text, font, max, lines) {
    const out = [];
    let cur = '';
    for (const w of String(text || '').split(/\s+/).filter(Boolean).flatMap((x) => split(x, font, max))) {
      const t = cur ? cur + ' ' + w : w;
      if (width(t, font) <= max || !cur) cur = t; else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    if (lines && out.length > lines) {
      const keep = out.slice(0, lines);
      let last = keep[lines - 1];
      while (last.length > 1 && width(last + ' …', font) > max) last = /\s/.test(last) ? last.replace(/\s*\S+$/, '') : last.slice(0, -1);
      keep[lines - 1] = last.replace(/[\s,;:.]+$/, '') + ' …';
      return keep;
    }
    return out;
  }
  /** A line's text as the drawing shows it: its first two phrases, each with a capital, and how many more in words. */
  const capFirst = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
  const joinLabels = (labels) => labels.slice(0, 2).map(capFirst).join(' · ') + (labels.length > 2 ? ` · ${T('more', { n: labels.length - 2 })}` : '');

  // ---------- dates and words ----------
  const MONTHS = Array.isArray(raw('months')) ? raw('months') : [];
  const day = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()] || d.getMonth() + 1}`; };
  /** Built: the page is made at the construction, or every story is merged into the intent branch. */
  const isBuilt = (M) => !!M && (M.phase === 'construction' || ((M.stories || []).length > 0 && M.stories.every((u) => !!u.merged)));
  const built = isBuilt(C4.model);
  /** A change the user asked for after the build is planned and not built yet (model.plan): the drawings show the
   *  plan, without the marks of the build. */
  const plan = built && !!(C4.model && C4.model.plan);
  /** The intent's own system in the C4 model: the system without ext (with several, the one whose containers the
   *  model draws), null when the model has none. Its name is SYSTEM ("the system" when the model names none): every
   *  "outside" says it. Its id is OWN: the card of the system context that zooms into the containers. */
  function ownOf(M) {
    const inside = Object.entries((M && M.systems) || {}).filter(([, s]) => s && !s.ext && s.name).map(([id, s]) => ({ ...s, id: s.id || id }));
    const drawn = ((M && M.views && M.views.containers) || {}).boundary;
    return inside.find((s) => drawn && s.id === drawn.id) || inside[0] || null;
  }
  const OWN_SYSTEM = ownOf(C4.model);
  const SYSTEM = OWN_SYSTEM ? OWN_SYSTEM.name : T('theSystem');
  const OWN = OWN_SYSTEM ? OWN_SYSTEM.id : null;
  /** A story as the page names it: its number, without its zeros (007 is 7). */
  const storyNo = (id) => String(Number(id) || id);
  const STATUS = { ...(built && !plan ? raw('status.built') : raw('status.plan')), ext: T('status.ext', { system: SYSTEM }) };
  const KIND = raw('kind') || {};
  const PART_KIND = raw('partKind') || {};
  const statusOf = (n) => (n.ext ? 'ext' : n.status || 'existing');

  /** Copy text; the button shows a tick for a moment. */
  async function copy(text, button) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      try {
        const t = el('textarea');
        t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.append(t); t.select(); ok = document.execCommand('copy'); t.remove();
      } catch (e2) { ok = false; }
    }
    if (!button) return ok;
    const label = button.getAttribute('aria-label');
    button.replaceChildren(icon(ok ? 'tick' : 'copy'));
    button.classList.toggle('done', ok);
    button.setAttribute('aria-label', ok ? T('copy.done') : T('copy.failed'));
    clearTimeout(button._t);
    button._t = setTimeout(() => { button.replaceChildren(icon('copy')); button.classList.remove('done'); button.setAttribute('aria-label', label); }, 1500);
    return ok;
  }

  // ---------- the switches the overview around this frame sets ----------
  const E = window.C4_EMBED && typeof window.C4_EMBED === 'object' ? window.C4_EMBED : {};
  const heard = [];
  const switches = { details: E.details !== false, help: E.help === true, on: (fn) => { heard.push(fn); } };
  window.addEventListener('message', (ev) => {
    const d = ev && ev.data, around = window.parent;
    if (!around || around === window || ev.source !== around || !d || d.type !== 'turbo-switches') return;
    if (typeof d.details === 'boolean') switches.details = d.details;
    if (typeof d.help === 'boolean') switches.help = d.help;
    heard.forEach((fn) => fn(switches));
  });

  C4.kit = { el, svgEl, icon, glyph, T, raw, noun, count, FONT, MONO, width, wrap, capFirst, joinLabels, day, SYSTEM, OWN, STATUS, KIND,
    PART_KIND, statusOf, storyNo, copy, isBuilt, built, plan, switches };
})();
