/**
 * AI-DLC Turbo - Code Scaffold, the filter of the Review tab as one
 * dropdown, over the list of files (design-review-side.js).
 *
 * A button "Filter" (how many are on beside it) opens a menu of items to
 * turn on and off, in groups: what happened to the file (New, Changed,
 * ..., each with its count) and the stories ("US 001", its title beside it),
 * and under them "Clear all filters". A click or Space on an item turns it on
 * or off and the menu stays open; Enter does the same. The keys of a menu:
 * down or up on the button opens it on the first or the last item, down and
 * up go round the items, Home and End to the ends, Escape closes it back to
 * the button, Tab closes it and goes on. A click outside closes it. The menu
 * hangs over the list (design-review.css); while it has the focus, Review's
 * own keys rest (a menu counts as a field to them, design-review.js).
 *
 *   TdReviewFilter.create({ groups: [{ id, label, items: [{ key, label, count, note, title }] }],
 *                           onChange(group, key, on), onClear() })
 *     -> { el, button, menu, set(group, key, on), clear(group), open(at), close(back), isOpen() }
 *
 * set() and clear() change the marks only: they tell no one. Its texts come
 * from the page's string table (TdText, design.review). The page inlines it
 * as window.TdReviewFilter, before the list (design-review-side.js).
 */
(function (root) {
  'use strict';

  const cjs = typeof module !== 'undefined' && module.exports;
  const K = cjs ? require('./design-kit.js') : root.TdKit;
  const TX = cjs ? require('./design-text.js') : root.TdText;
  const tx = (key, vars) => TX.t(`design.review.${key}`, vars);
  const ICON = {
    funnel: '<path d="M3 4.5h14l-5.5 6.5v4.5l-3 1.5v-6z"/>',
    tick: '<path d="M5 10.5l3.2 3L15 6.5"/>',
  };
  const svg = (cls, d) => `<svg class="${cls}" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${d}</svg>`;

  function create(o) {
    const { h } = K;
    const uid = 'td-rv-f' + Math.random().toString(36).slice(2, 8);
    const on = new Map((o.groups || []).map((g) => [g.id, new Set()]));
    const el = h('div', 'td-rv-filter');
    const button = h('button', 'td-rv-fbtn');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = svg('td-i td-rv-fi', ICON.funnel);
    const badge = h('span', 'td-rv-fbadge');
    badge.hidden = true;
    badge.setAttribute('aria-hidden', 'true');
    button.append(h('span', 'td-rv-ft', tx('filter')), badge);
    const menu = h('div', 'td-rv-fmenu');
    menu.id = uid + '-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', tx('filter'));
    menu.hidden = true;
    button.setAttribute('aria-controls', menu.id);

    const items = [];
    for (const g of o.groups || []) {
      if (!g.items || !g.items.length) continue;
      const box = h('div', 'td-rv-fgroup');
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', g.label);
      box.setAttribute('data-group', g.id);
      const t = h('p', 'td-rv-fgt', g.label);
      t.setAttribute('aria-hidden', 'true');
      box.append(t);
      for (const it of g.items) {
        const e = h('div', 'td-rv-fitem');
        e.setAttribute('role', 'menuitemcheckbox');
        e.setAttribute('aria-checked', 'false');
        e.setAttribute('tabindex', '-1');
        e.setAttribute('data-group', g.id);
        e.setAttribute('data-key', it.key);
        if (it.title) e.title = it.title;
        const mark = h('span', 'td-rv-fbox');
        mark.innerHTML = svg('td-i', ICON.tick);
        e.append(mark, h('span', 'td-rv-fl', it.label));
        if (it.note) e.append(h('span', 'td-rv-fnote', it.note));
        if (it.count !== undefined && it.count !== null) e.append(h('span', 'td-rv-fn', String(it.count)));
        e.addEventListener('click', () => flip(e));
        box.append(e);
        items.push(e);
      }
      menu.append(box);
    }
    const foot = h('div', 'td-rv-ffoot');
    const wipe = h('div', 'td-rv-fclear', tx('clearAll'));
    wipe.setAttribute('role', 'menuitem');
    wipe.setAttribute('tabindex', '-1');
    wipe.addEventListener('click', () => { clear(); if (o.onClear) o.onClear(); });
    foot.append(wipe);
    menu.append(foot);
    el.append(button, menu);
    const all = () => [...items, wipe];

    /** The marks and the count on the button, from what is on. */
    function paint() {
      let n = 0;
      for (const e of items) {
        const yes = on.get(e.getAttribute('data-group')).has(e.getAttribute('data-key'));
        e.setAttribute('aria-checked', String(yes));
        if (yes) n += 1;
      }
      badge.textContent = String(n);
      badge.hidden = !n;
      button.classList.toggle('td-rv-fon', n > 0);
      wipe.setAttribute('aria-disabled', String(!n));
      if (n) button.setAttribute('aria-label', tx('filterOn', { n }));
      else button.removeAttribute('aria-label');
    }
    function flip(e) {
      const g = e.getAttribute('data-group'), k = e.getAttribute('data-key');
      const s = on.get(g);
      const now = !s.has(k);
      if (now) s.add(k); else s.delete(k);
      paint();
      if (o.onChange) o.onChange(g, k, now);
    }
    function set(g, k, yes) {
      const s = on.get(g);
      if (!s) return;
      if (yes) s.add(k); else s.delete(k);
      paint();
    }
    function clear(g) {
      for (const [id, s] of on) if (!g || id === g) s.clear();
      paint();
    }

    function outside(ev) { if (!el.contains(ev.target)) close(false); }
    function open(at) {
      if (menu.hidden) {
        menu.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        el.classList.add('td-rv-fopen');
        if (typeof document !== 'undefined') document.addEventListener('pointerdown', outside, true);
      }
      const list = all();
      if (at === 'first') list[0].focus();
      else if (at === 'last') list[list.length - 1].focus();
    }
    function close(back) {
      if (!menu.hidden) {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        el.classList.remove('td-rv-fopen');
        if (typeof document !== 'undefined') document.removeEventListener('pointerdown', outside, true);
      }
      if (back) button.focus();
    }

    button.addEventListener('click', () => { if (menu.hidden) open(); else close(false); });
    button.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      ev.preventDefault();
      ev.stopPropagation();
      open(ev.key === 'ArrowDown' ? 'first' : 'last');
    });
    menu.addEventListener('keydown', (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const list = all();
      const i = list.indexOf(document.activeElement);
      const go = (j) => list[(j + list.length) % list.length].focus();
      switch (ev.key) {
        case 'ArrowDown': go(i + 1); break;
        case 'ArrowUp': go(i < 0 ? list.length - 1 : i - 1); break;
        case 'Home': go(0); break;
        case 'End': go(list.length - 1); break;
        case ' ': case 'Enter': if (i >= 0) list[i].click(); break;
        case 'Escape': case 'Esc': close(true); break;
        case 'Tab': close(false); return;
        default: return;
      }
      ev.preventDefault();
      ev.stopPropagation();
    });

    paint();
    return { el, button, menu, set, clear, open, close, isOpen: () => !menu.hidden };
  }

  const api = { create };
  if (cjs) module.exports = api;
  else root.TdReviewFilter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
